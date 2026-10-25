/**
 * Calibration math for `scripts/calibrate.mjs` (spec 14.6, reworked by
 * 16.1/16.2/16.4 and fixed by 18.6). Pure helpers, no side effects on
 * import, so the tests can drive them with fake measurements.
 *
 * The search range is 0–60 blocks (16.1) and every "which way is harder"
 * decision goes through `hardnessDirection(course)` (16.2): more blocks
 * make the escape course harder and the trapper course easier.
 *
 * 18.6: the block counts are **not** monotone across levels (the AI gets
 * stronger at L7/L14, so a later level's best count may move the other
 * way). Inside one level the three centers follow the difficulty order of
 * 16.2 and the ranges never overlap; across levels only the achieved rate
 * per difficulty is checked (`nonMonotoneRises`).
 */
import { jobKey } from './pool.mjs';
import { hardnessDirection } from '../src/game/play/blocks.js';

/** `[L1, L20]` target win rates of the `normal` profile per difficulty. */
export const TARGETS = {
  easy: [0.95, 0.4],
  normal: [0.8, 0.25],
  hard: [0.65, 0.1],
};

export const BLOCKS_MIN = 0;
/** 16.1: the sweep/calibration search range grew from 0–40 to 0–60. */
export const BLOCKS_MAX = 60;
/** A level is reported UNREACHABLE outside this band (±7 points). */
export const UNREACHABLE_TOL = 0.07;
export const LEVEL_COUNT = 20;

/**
 * The target win rate of `difficulty` at `level` (linear between L1/L20).
 * @param {'easy'|'normal'|'hard'} difficulty
 * @param {number} level
 * @returns {number}
 */
export function targetRate(difficulty, level) {
  const [a, b] = TARGETS[difficulty] ?? TARGETS.normal;
  const t = (Math.min(Math.max(Math.floor(level) || 1, 1), LEVEL_COUNT) - 1) / (LEVEL_COUNT - 1);
  return a + (b - a) * t;
}

/**
 * Binary-search the block count whose simulated win rate is closest to
 * the target (14.6). `rate` falls with more blocks in the escape course
 * and rises with them in the trapper course (`increasing`). Every probe
 * of a setting replays the same seeded games (`sim.seedFor` leaves the
 * block count out), so the noisy rates still compare like with like.
 * @param {(blocks:number)=>number|Promise<number>} probe simulated win rate
 * @param {{difficulty:'easy'|'normal'|'hard', level:number, increasing:boolean,
 *          maxBlocks?:number}} opts
 * @returns {Promise<{blocks:number, rate:number, target:number, diff:number,
 *                    probes:number, unreachable:boolean}>}
 */
export async function searchBlocks(probe, opts) {
  const { difficulty, level, increasing } = opts;
  const maxBlocks = opts.maxBlocks ?? BLOCKS_MAX;
  const target = targetRate(difficulty, level);
  let lo = BLOCKS_MIN;
  let hi = maxBlocks;
  let best = { blocks: BLOCKS_MIN, rate: NaN, diff: Infinity };
  let probes = 0;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    const rate = await probe(mid);
    probes++;
    const diff = Math.abs(rate - target);
    if (diff < best.diff) best = { blocks: mid, rate, diff };
    const needMoreBlocks = increasing ? rate < target : rate > target;
    if (needMoreBlocks) lo = mid + 1;
    else hi = mid - 1;
  }
  return {
    blocks: best.blocks,
    rate: best.rate,
    target,
    diff: best.diff,
    probes,
    unreachable: best.diff > UNREACHABLE_TOL,
  };
}

/**
 * Does the simulated rate rise with more blocks (14.6)? Yes for the
 * trapper course (the player is the trapper), no for the escape course —
 * i.e. exactly when `hardnessDirection` is negative (16.2).
 * @param {string} course
 * @returns {boolean}
 */
export function increasingFor(course) {
  return hardnessDirection(course) < 0;
}

/**
 * Batched binary search over many settings at once (14.6, fixed in 15.2):
 * one probe round per level of the search tree, so every still-open
 * setting is played in the same worker pool round.
 *
 * `probe(jobs)` plays the jobs and must return **one result per job,
 * each echoing the job's `key`** (as `pool.runJobs` does). The results
 * are matched to the settings **by key**, never by arrival order, and a
 * missing, duplicated or foreign key throws — before this fix the pool
 * returned the per-worker chunks flattened, the settings were fed a
 * permutation of the probe results, and the search wandered off the
 * monotone response into UNREACHABLE.
 *
 * Every probe (and its `draws`) is reported through `opts.onProbe`: a
 * draw (move cap / no legal move) must be visible, never silently
 * counted as a loss.
 *
 * @param {Array<{course:string, difficulty:string, level:number,
 *                lo?:number, hi?:number, best?:object|null}>} settings
 * @param {(jobs:Array<object>)=>Promise<Array<object>>} probe
 * @param {{games?:number, seedBase?:number,
 *          onProbe?:(info:object)=>void}} [opts]
 * @returns {Promise<Array<object>>} the same settings, mutated: `best`
 *                                   is `{blocks, rate, draws, diff}`
 */
export async function batchedSearch(settings, probe, opts = {}) {
  const games = Math.max(1, Math.floor(opts.games ?? 1));
  const seedBase = opts.seedBase ?? 0;
  const onProbe = typeof opts.onProbe === 'function' ? opts.onProbe : null;
  for (const s of settings) {
    if (s.lo === undefined) s.lo = BLOCKS_MIN;
    if (s.hi === undefined) s.hi = BLOCKS_MAX;
    if (s.best === undefined) s.best = null;
  }
  while (settings.some((s) => s.lo <= s.hi)) {
    /** @type {Array<object>} */
    const jobs = [];
    /** @type {Array<object>} */
    const owners = [];
    for (const s of settings) {
      if (s.lo > s.hi) continue;
      s.mid = Math.floor((s.lo + s.hi) / 2);
      jobs.push({
        rules: 'gimmick',
        course: s.course,
        difficulty: s.difficulty,
        level: s.level,
        profile: 'normal',
        blocks: s.mid,
        games,
        seedBase,
      });
      owners.push(s);
    }
    const results = await probe(jobs);
    if (!Array.isArray(results) || results.length !== jobs.length) {
      throw new Error(`calibrate: probe returned ${results && results.length} results for ${jobs.length} jobs`);
    }
    // 15.2: match every result to its job by the setting key
    /** @type {Map<string, object>} */
    const byKey = new Map();
    for (const r of results) {
      if (!r || typeof r.key !== 'string') throw new Error('calibrate: result without a setting key');
      if (byKey.has(r.key)) throw new Error(`calibrate: duplicate result key ${r.key}`);
      byKey.set(r.key, r);
    }
    for (let i = 0; i < owners.length; i++) {
      const s = owners[i];
      const key = jobKey(jobs[i]);
      const r = byKey.get(key);
      if (!r) throw new Error(`calibrate: no result for job ${i} (${key})`);
      const rate = r.rate;
      const draws = r.draws || 0;
      const target = targetRate(s.difficulty, s.level);
      const diff = Math.abs(rate - target);
      if (onProbe) {
        onProbe({
          course: s.course,
          difficulty: s.difficulty,
          level: s.level,
          blocks: s.mid,
          rate,
          draws,
          games: r.games ?? games,
          target,
        });
      }
      if (s.best === null || diff < s.best.diff) s.best = { blocks: s.mid, rate, draws, diff };
      const needMoreBlocks = increasingFor(s.course) ? rate < target : rate > target;
      if (needMoreBlocks) s.lo = s.mid + 1;
      else s.hi = s.mid - 1;
    }
  }
  return settings;
}

/**
 * Order the three centers of each level (16.2, 18.6): inside one level a
 * harder difficulty never gets an *easier* block count — more blocks in
 * the escape course, fewer in the trapper course (`hardnessDirection`).
 * "Nearest ordered value" = clamp to the neighbor that caused the
 * violation.
 *
 * There is deliberately **no** across-level constraint anymore (18.6):
 * the AI gets stronger at L7/L14, so a later level's best block count
 * has to be free to move the other way. Across levels the *achieved
 * rate* is checked instead — see `nonMonotoneRises`.
 * @param {Record<string, Record<string, number[]>>} by course → difficulty → blocks
 * @returns {the same object, mutated}
 */
export function orderCenters(by) {
  for (const course of Object.keys(by)) {
    const asc = hardnessDirection(course) > 0;
    // across difficulties, per level (18.6: the only ordering left)
    for (let i = 0; i < by[course].easy.length; i++) {
      if (asc) {
        by[course].normal[i] = Math.max(by[course].normal[i], by[course].easy[i]);
        by[course].hard[i] = Math.max(by[course].hard[i], by[course].normal[i]);
      } else {
        by[course].normal[i] = Math.min(by[course].normal[i], by[course].easy[i]);
        by[course].hard[i] = Math.min(by[course].hard[i], by[course].normal[i]);
      }
    }
  }
  return by;
}

/** 18.6: an achieved-rate step up of more than 3 points is NON-MONOTONE. */
export const RATE_RISE_TOL = 0.03;

/**
 * The 18.6 across-level check: for one course+difficulty the achieved
 * rate should be non-increasing from L1 to L20. Every step up of more
 * than `RATE_RISE_TOL` (3 points) is reported for the designer to look
 * at. Levels without data (`NaN`) are skipped; a rise is then measured
 * against the previous level that has data.
 * @param {number[]} rates the per-level achieved rates, L1 first
 * @returns {Array<{level:number, rate:number, prevLevel:number,
 *                  prev:number, rise:number}>}
 */
export function nonMonotoneRises(rates) {
  /** @type {Array<{level:number, rate:number, prevLevel:number, prev:number, rise:number}>} */
  const out = [];
  let prev = null;
  let prevLevel = 0;
  for (let i = 0; i < rates.length; i++) {
    const r = rates[i];
    if (!Number.isFinite(r)) continue;
    if (prev !== null && r - prev > RATE_RISE_TOL) {
      out.push({ level: i + 1, rate: r, prevLevel, prev, rise: r - prev });
    }
    prev = r;
    prevLevel = i + 1;
  }
  return out;
}

/**
 * Isotonic regression of a win-rate curve over ascending block counts,
 * in the course's hardness direction (16.2/16.4): pool-adjacent-violators
 * with block-constant segments. In the escape course (+1) the rate must be
 * **non-increasing** in blocks; in the trapper course (-1) it must be
 * non-decreasing. Ties keep their measurement order.
 * @param {number[]} values rates over ascending block counts
 * @param {number} direction `hardnessDirection(course)` (+1 / -1)
 * @returns {number[]} the smoothed rates (same length)
 */
export function isotonicBlocks(values, direction) {
  const n = values.length;
  if (n === 0) return [];
  if (n === 1) return [values[0]];
  // PAVA solves "non-decreasing"; flip the values for the escape course
  const sign = direction > 0 ? -1 : 1;
  /** @type {Array<{sum:number, count:number}>} */
  const pools = [];
  for (const v of values) {
    let sum = sign * v;
    let count = 1;
    while (pools.length > 0) {
      const last = pools[pools.length - 1];
      if (last.sum / last.count <= sum / count) break;
      pools.pop();
      sum += last.sum;
      count += last.count;
    }
    pools.push({ sum, count });
  }
  const out = [];
  for (const pool of pools) {
    const mean = (sign * pool.sum) / pool.count;
    for (let k = 0; k < pool.count; k++) out.push(mean);
  }
  return out;
}

/**
 * The block count whose smoothed rate is closest to `target` (16.4).
 * @param {number[]} blocks ascending, one per entry of `rates`
 * @param {number[]} rates the isotonic-smoothed rates
 * @param {number} target
 * @returns {{blocks:number, rate:number, diff:number}|null} null when
 *                                   there is no measurement at all
 */
export function pickCenter(blocks, rates, target) {
  let best = null;
  for (let i = 0; i < blocks.length; i++) {
    const diff = Math.abs(rates[i] - target);
    if (best === null || diff < best.diff) {
      best = { blocks: blocks[i], rate: rates[i], diff };
    }
  }
  return best;
}

/**
 * The 16.2 per-difficulty ranges of one level, from its three centers.
 * - each range is centered on its center;
 * - its half-width reaches halfway to the neighboring center, at least
 *   ±2 and at most ±5;
 * - ranges never overlap, and they follow the table order: easy < normal
 *   < hard in block counts for the escape course, hard < normal < easy
 *   for the trapper course (that is the ascending-block order of
 *   `hardnessDirection`).
 * @param {{easy:number, normal:number, hard:number}} centers
 * @param {'escape'|'trapper'} course
 * @returns {{easy:[number,number], normal:[number,number], hard:[number,number]}}
 */
export function buildRanges(centers, course) {
  const dir = hardnessDirection(course);
  const order = dir > 0 ? ['easy', 'normal', 'hard'] : ['hard', 'normal', 'easy'];
  const pos = order.map((d) => ({ d, c: Math.round(Number(centers[d]) || 0) }));

  /** @type {Record<string, number>} */
  const half = {};
  for (let i = 0; i < pos.length; i++) {
    const gaps = [];
    if (i > 0) gaps.push(Math.max(0, pos[i].c - pos[i - 1].c));
    if (i < pos.length - 1) gaps.push(Math.max(0, pos[i + 1].c - pos[i].c));
    const gap = gaps.length > 0 ? Math.min(...gaps) : 0;
    half[pos[i].d] = Math.min(5, Math.max(2, Math.round(gap / 2)));
  }
  // no overlap: adjacent ranges may only meet at most (and stay centered
  // whenever the gap allows it)
  for (let i = 0; i < pos.length - 1; i++) {
    const left = pos[i];
    const right = pos[i + 1];
    const avail = Math.max(0, right.c - left.c);
    if (half[left.d] + half[right.d] > avail) {
      const shrinkLeft = Math.min(half[left.d], Math.floor(avail / 2));
      half[left.d] = shrinkLeft;
      half[right.d] = Math.min(half[right.d], avail - shrinkLeft);
    }
  }
  /** @type {Record<string, [number, number]>} */
  const out = {};
  for (const p of pos) {
    const h = half[p.d];
    out[p.d] = [
      Math.max(BLOCKS_MIN, p.c - h),
      Math.min(BLOCKS_MAX, p.c + h),
    ];
  }
  return out;
}

/**
 * Extract the balanced `{…}` object that follows `key` in `line` (single
 * line, nested braces allowed — 18.1's per-rules objects need them).
 * @param {string} line
 * @param {string} key
 * @returns {string|null}
 */
function extractObjectAfter(line, key) {
  const i = line.indexOf(key);
  if (i < 0) return null;
  const start = line.indexOf('{', i);
  if (start < 0) return null;
  let depth = 0;
  for (let k = start; k < line.length; k++) {
    if (line[k] === '{') depth++;
    else if (line[k] === '}') {
      depth--;
      if (depth === 0) return line.slice(start, k + 1);
    }
  }
  return null;
}

/** `{ easy: N, normal: N, hard: N }` → the three centers (or null). */
function parseCenters(text) {
  const m = text && text.match(/easy: (\d+), normal: (\d+), hard: (\d+)/);
  return m ? { easy: Number(m[1]), normal: Number(m[2]), hard: Number(m[3]) } : null;
}

/** `{ easy: [a, b], normal: [a, b], hard: [a, b] }` → ranges (or null). */
function parseRanges(text) {
  const m =
    text &&
    text.match(
      /easy: \[(\d+), (\d+)\], normal: \[(\d+), (\d+)\], hard: \[(\d+), (\d+)\]/,
    );
  return m
    ? {
        easy: [Number(m[1]), Number(m[2])],
        normal: [Number(m[3]), Number(m[4])],
        hard: [Number(m[5]), Number(m[6])],
      }
    : null;
}

/**
 * The `blocks:` centers of one rules kind on a level line (18.1). The
 * per-rules nested form wins; the shared `{easy,…}`/`B(n)` forms count for
 * both kinds.
 * @param {string} line
 * @param {'basic'|'gimmick'} rules
 * @returns {{easy:number, normal:number, hard:number}|null}
 */
export function parseLevelBlocks(line, rules) {
  const helper = line.match(/blocks: B{0,2}\((\d+)\)/);
  if (helper) {
    const n = Number(helper[1]);
    return { easy: n, normal: n, hard: n };
  }
  const text = extractObjectAfter(line, 'blocks:');
  if (!text) return null;
  const nested = text.match(/basic: \{[^}]*\}|gimmick: \{[^}]*\}/g);
  if (nested) {
    for (const part of nested) {
      if (part.startsWith(`${rules}:`)) return parseCenters(part);
    }
    return null;
  }
  return parseCenters(text);
}

/**
 * The `range:` data of one rules kind on a level line (18.1): the nested
 * per-rules object wins, the shared `{easy:[…],…}` form counts for both.
 * @param {string} line
 * @param {'basic'|'gimmick'} rules
 * @returns {object|null}
 */
export function parseLevelRange(line, rules) {
  const text = extractObjectAfter(line, 'range:');
  if (!text) return null;
  if (/basic: \{/.test(text) || /gimmick: \{/.test(text)) {
    const part = text.match(new RegExp(`${rules}: (\\{[^}]*\\})`));
    return part ? parseRanges(part[1]) : null;
  }
  return parseRanges(text);
}

/**
 * Rewrite the `blocks:` objects of `levelsSource` (the text of
 * `levels.js`) and their `range:` objects for **one rules kind** (18.1),
 * keeping the other kind's entries exactly as they are, and keep/refresh
 * one `// calibrated <date>` comment per course table. The `B(n)`/`BB(n)`
 * helper forms, the shared `{easy,normal,hard}` form and the expanded
 * per-rules form are all recognised.
 * @param {string} source
 * @param {Record<string, Record<string, number[]>>} by course → difficulty → blocks
 * @param {string} date `YYYY-MM-DD`
 * @param {Record<string, Array<Record<string, [number, number]>>>} [ranges]
 *                                  course → level index → per-difficulty ranges
 * @param {'basic'|'gimmick'} [rules='gimmick'] the kind being calibrated
 * @returns {string} the new file text
 */
export function rewriteLevels(source, by, date, ranges, rules = 'gimmick') {
  const other = rules === 'basic' ? 'gimmick' : 'basic';
  const lines = source.split('\n');
  const out = [];
  for (const line of lines) {
    const m = line.match(/\{ id: (\d+), course: '(escape|trapper)'/);
    if (m) {
      const level = Number(m[1]);
      const course = m[2];
      const fresh = {
        easy: by[course].easy[level - 1],
        normal: by[course].normal[level - 1],
        hard: by[course].hard[level - 1],
      };
      // 18.1: the other rules kind keeps whatever the line already carries
      const keep = parseLevelBlocks(line, other) || fresh;
      const centers = { [rules]: fresh, [other]: keep };
      const fmt = (c) => `easy: ${c.easy}, normal: ${c.normal}, hard: ${c.hard}`;
      const blocksText =
        `blocks: { basic: { ${fmt(centers.basic)} }, gimmick: { ${fmt(centers.gimmick)} } }`;
      let next = line.replace(
        /blocks: (?:BB\(\d+\)|B\(\d+\)|\{(?:[^{}]|\{[^{}]*\})*\})/,
        blocksText,
      );
      // drop every stale range object (one nesting level), then write the
      // fresh per-kind one next to blocks
      next = next.replace(/, range: \{(?:[^{}]|\{[^{}]*\})*\}/, '');
      const r = ranges && ranges[course] && ranges[course][level - 1];
      if (r) {
        const built = buildRangeText(line, r, rules, other);
        if (next.includes(blocksText)) {
          next = next.replace(blocksText, `${blocksText}, ${built}`);
        }
      }
      out.push(next);
      continue;
    }
    if (/^\/\/ calibrated /.test(line)) continue; // re-added below
    if (/^export const (ESCAPE|TRAPPER)_LEVELS = \[/.test(line)) {
      out.push(`// calibrated ${date}`);
    }
    out.push(line);
  }
  return out.join('\n');
}

/**
 * The `range: { basic: {…}, gimmick: {…} }` text of one level line: the
 * calibrated kind carries the fresh ranges, the other kind keeps the
 * ranges already on the line (omitted when it has none, so `levelRange`
 * keeps falling back to center ± 2).
 * @param {string} line the ORIGINAL line (its stale range is still readable)
 * @param {{easy:[number,number], normal:[number,number], hard:[number,number]}} fresh
 * @param {'basic'|'gimmick'} rules the calibrated kind
 * @param {'basic'|'gimmick'} other the untouched kind
 * @returns {string|null}
 */
function buildRangeText(line, fresh, rules, other) {
  const fmt = (r) =>
    `easy: [${r.easy[0]}, ${r.easy[1]}], normal: [${r.normal[0]}, ${r.normal[1]}], hard: [${r.hard[0]}, ${r.hard[1]}]`;
  const kept = parseLevelRange(line, other);
  const parts = [];
  if (rules === 'basic') parts.push(`basic: { ${fmt(fresh)} }`);
  else parts.push(`gimmick: { ${fmt(fresh)} }`);
  if (kept) {
    if (other === 'basic') parts.unshift(`basic: { ${fmt(kept)} }`);
    else parts.push(`gimmick: { ${fmt(kept)} }`);
  }
  return `range: { ${parts.join(', ')} }`;
}
