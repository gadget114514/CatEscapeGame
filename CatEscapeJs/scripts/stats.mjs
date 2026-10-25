/**
 * `levelStats.json` assembly, printing and writing (spec 13.8 / 14.6 /
 * 16.4). Pure helpers plus a worker-pool runner; no side effects on import.
 *
 * Shape (16.4 — the sweep fills the curves):
 * ```json
 * { "generatedAt": "YYYY-MM-DD", "games": 200, "rules": "gimmick",
 *   "courses": { "escape":  { "easy":  {"rate":[20],"blocks":[20],"avgMoves":[20]},
 *                             "normal":{...}, "hard":{...} },
 *                "trapper": {...} },
 *   "profiles": { "escape":  { "easy":  {"weak":[20],"normal":[20],"strong":[20]}, ... },
 *                 "trapper": {...} },
 *   "curves": { "escape": { "weak":  [{"blocks":[…],"rate":[…],"avgMoves":[…],"games":[…]} ×20],
 *                           "normal": {...}, "strong": {...} },
 *               "trapper": {...} } }
 * ```
 * `rate` is the `normal` profile at that difficulty's center (the
 * typical-human proxy line); `profiles` keeps all three lines for the
 * balance report; `curves` keeps every measured block count so the 16.3
 * slider estimate can interpolate anywhere inside a range. The
 * basic-rules file uses the same shape with `rules: "basic"`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getLevel, blocksFor, DIFFICULTIES } from '../src/game/play/levels.js';
import { PROFILES, RULE_KINDS, DEFAULT_GAMES } from './sim.mjs';
import { runJobs, defaultWorkers } from './pool.mjs';
import { bestRecords } from './sweep.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** Where the generated files live (spec 13.8). */
export const STATS_PATHS = {
  gimmick: path.join(HERE, '..', 'src', 'game', 'play', 'levelStats.json'),
  basic: path.join(HERE, '..', 'src', 'game', 'play', 'levelStats.basic.json'),
};

const COURSES = ['escape', 'trapper'];
const LEVEL_COUNT = 20;

/** Today as `YYYY-MM-DD` (local time). */
export function today() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * One job per (rules, course, difficulty, level, profile) — the unit the
 * worker pool plays. `blocksOf` overrides where the block counts come
 * from (the calibrator feeds its freshly tuned table in, so it never
 * depends on a cached `levels.js` import); the default reads the level's
 * table entry **for the job's rules kind** (18.1).
 * @param {{rulesList?:string[], games?:number, seedBase?:number,
 *          blocksOf?:(course:string, level:number, difficulty:string,
 *                     rules:string)=>number}} [opts]
 * @returns {Array<object>}
 */
export function buildJobs(opts = {}) {
  const rulesList = opts.rulesList ?? RULE_KINDS;
  const games = Math.max(1, Math.floor(opts.games ?? DEFAULT_GAMES));
  const seedBase = opts.seedBase ?? 0;
  const blocksOf =
    opts.blocksOf ??
    ((course, level, d, rules) => blocksFor(getLevel(course, level), d, rules));
  const jobs = [];
  for (const rules of rulesList) {
    for (const course of COURSES) {
      for (const difficulty of DIFFICULTIES) {
        for (let level = 1; level <= LEVEL_COUNT; level++) {
          const lv = getLevel(course, level);
          for (const profile of PROFILES) {
            jobs.push({
              rules,
              course,
              level,
              difficulty,
              profile,
              blocks: blocksOf(course, level, difficulty, rules),
              games,
              seedBase,
            });
          }
        }
      }
    }
  }
  return jobs;
}

/**
 * Fold worker results into the `levelStats` object of one ruleset.
 * @param {Array<object>} results jobs + `{wins, draws, rate, avgMoves}`
 * @param {{games:number, rules:'gimmick'|'basic', generatedAt?:string}} meta
 * @returns {object} the JSON body
 */
export function assembleStats(results, meta) {
  /** @type {any} */
  const stats = {
    generatedAt: meta.generatedAt ?? today(),
    games: meta.games,
    rules: meta.rules,
    courses: {},
    profiles: {},
  };
  for (const course of COURSES) {
    stats.courses[course] = {};
    stats.profiles[course] = {};
    for (const d of DIFFICULTIES) {
      stats.courses[course][d] = { rate: new Array(LEVEL_COUNT).fill(0), blocks: new Array(LEVEL_COUNT).fill(0), avgMoves: new Array(LEVEL_COUNT).fill(0) };
      stats.profiles[course][d] = {
        weak: new Array(LEVEL_COUNT).fill(0),
        normal: new Array(LEVEL_COUNT).fill(0),
        strong: new Array(LEVEL_COUNT).fill(0),
      };
    }
  }
  for (const r of results) {
    if (r.rules !== meta.rules) continue;
    const i = r.level - 1;
    stats.profiles[r.course][r.difficulty][r.profile][i] = r.rate;
    if (r.profile === 'normal') {
      // the typical-human proxy line (14.6)
      stats.courses[r.course][r.difficulty].rate[i] = r.rate;
      stats.courses[r.course][r.difficulty].blocks[i] = r.blocks;
      stats.courses[r.course][r.difficulty].avgMoves[i] = r.avgMoves;
    }
  }
  return stats;
}

/**
 * Play every job and assemble both ruleset files.
 * @param {{games?:number, seedBase?:number, workers?:number,
 *          rulesList?:string[]}} [opts]
 * @returns {Promise<{results:Array<object>, stats:Record<string,object>}>}
 */
export async function buildStats(opts = {}) {
  const jobs = buildJobs(opts);
  const results = await runJobs(jobs, { workers: opts.workers ?? defaultWorkers() });
  const games = Math.max(1, Math.floor(opts.games ?? DEFAULT_GAMES));
  const stats = {};
  for (const rules of opts.rulesList ?? RULE_KINDS) {
    stats[rules] = assembleStats(results, { games, rules });
  }
  return { results, stats };
}

/**
 * Write one ruleset's stats file (pretty JSON, trailing newline).
 * @param {object} stats
 * @param {'gimmick'|'basic'} rules
 */
export function writeStats(stats, rules) {
  const file = STATS_PATHS[rules];
  fs.writeFileSync(file, `${JSON.stringify(stats, null, 2)}\n`, 'utf8');
  return file;
}

/**
 * The designer-facing table (14.6 balance report): per course and
 * difficulty, the per-level rate of the weak / normal / strong profiles
 * plus the normal profile's draw count (15.2 — a draw is never silently
 * counted as a loss).
 * @param {Array<object>} results
 * @param {string[]} [rulesList]
 */
export function printReport(results, rulesList = RULE_KINDS) {
  for (const rules of rulesList) {
    for (const course of COURSES) {
      for (const d of DIFFICULTIES) {
        const rows = results
          .filter((r) => r.rules === rules && r.course === course && r.difficulty === d)
          .sort((a, b) => a.level - b.level);
        if (rows.length === 0) continue;
        const head = `${rules} · ${course} · ${d}`;
        console.log(`\n${head}`);
        console.log('  L blocks   weak  normal  strong   avg(moves)  draws(normal)');
        const byLevel = new Map(rows.map((r) => [r.level, r]));
        for (let level = 1; level <= LEVEL_COUNT; level++) {
          const cell = byLevel.get(level);
          if (!cell) continue;
          const byProfile = new Map(rows.filter((r) => r.level === level).map((r) => [r.profile, r]));
          const pct = (p) =>
            byProfile.has(p) ? `${(byProfile.get(p).rate * 100).toFixed(1)}%` : '  —  ';
          const avg = byProfile.get('normal');
          console.log(
            `  ${String(level).padStart(2)} ${String(cell.blocks).padStart(6)} ` +
            `${pct('weak').padStart(6)} ${pct('normal').padStart(6)} ${pct('strong').padStart(6)}   ` +
            `${avg ? avg.avgMoves.toFixed(1) : '—'}` +
            `${avg ? String(avg.draws ?? 0).padStart(11) : '     —'}`,
          );
        }
      }
    }
  }
}

/**
 * Assemble one ruleset's `levelStats` body **from the sweep** (16.4): the
 * per-difficulty lines at the calibrated centers plus the full curves of
 * all three profiles over every measured block count. Centers without a
 * measurement carry the value over from `meta.previous` (or 0).
 * @param {Array<object>} records every sweep line (both rules kinds)
 * @param {{rules:'gimmick'|'basic',
 *          centers:(course:string, level:number, difficulty:string)=>number,
 *          generatedAt?:string, games?:number,
 *          previous?:object}} meta
 * @returns {object} the JSON body
 */
export function assembleSweepStats(records, meta) {
  const zero20 = () => new Array(LEVEL_COUNT).fill(0);
  /** @type {any} */
  const stats = {
    generatedAt: meta.generatedAt ?? today(),
    games: meta.games ?? 0,
    rules: meta.rules,
    courses: {},
    profiles: {},
    curves: {},
  };

  // the best record per (course, level, profile, blocks) of this ruleset
  /** @type {Map<string, Array<object>>} */
  const bySetting = new Map();
  for (const r of bestRecords(records).values()) {
    if (r.rules !== meta.rules) continue;
    const key = `${r.course}|${r.level}|${r.profile}`;
    if (!bySetting.has(key)) bySetting.set(key, []);
    bySetting.get(key).push(r);
    stats.games = Math.max(stats.games, Number(r.games) || 0);
  }
  for (const rows of bySetting.values()) {
    rows.sort((a, b) => Number(a.blocks) - Number(b.blocks));
  }

  const prevCourses = (meta.previous && meta.previous.courses) || {};
  const prevProfiles = (meta.previous && meta.previous.profiles) || {};

  for (const course of COURSES) {
    stats.courses[course] = {};
    stats.profiles[course] = {};
    stats.curves[course] = {};
    for (const d of DIFFICULTIES) {
      stats.courses[course][d] = { rate: zero20(), blocks: zero20(), avgMoves: zero20() };
      stats.profiles[course][d] = { weak: zero20(), normal: zero20(), strong: zero20() };
    }
    for (const p of PROFILES) {
      stats.curves[course][p] = [];
      for (let i = 0; i < LEVEL_COUNT; i++) {
        stats.curves[course][p].push({ blocks: [], rate: [], avgMoves: [], games: [] });
      }
    }

    for (let level = 1; level <= LEVEL_COUNT; level++) {
      // curves: every measured count of every profile (16.4 output)
      for (const profile of PROFILES) {
        const rows = bySetting.get(`${course}|${level}|${profile}`) || [];
        const curve = stats.curves[course][profile][level - 1];
        for (const r of rows) {
          const games = Math.max(1, Number(r.games) || 1);
          curve.blocks.push(Number(r.blocks));
          curve.rate.push((Number(r.wins) || 0) / games);
          curve.avgMoves.push(Number(r.avgMoves) || 0);
          curve.games.push(games);
        }
      }
      // the per-difficulty lines at the calibrated centers
      for (const d of DIFFICULTIES) {
        const center = meta.centers(course, level, d);
        const cell = stats.courses[course][d];
        const profCell = stats.profiles[course][d];
        for (const profile of PROFILES) {
          const rows = bySetting.get(`${course}|${level}|${profile}`) || [];
          const at = rows.find((r) => Number(r.blocks) === center);
          const prevProf = prevProfiles[course] && prevProfiles[course][d] && prevProfiles[course][d][profile];
          const prevRate = prevProf ? prevProf[level - 1] : 0;
          const rate = at ? (Number(at.wins) || 0) / Math.max(1, Number(at.games) || 1) : prevRate;
          profCell[profile][level - 1] = rate;
          if (profile !== 'normal') continue;
          const prevRow = prevCourses[course] && prevCourses[course][d];
          cell.rate[level - 1] = at
            ? rate
            : prevRow && Number.isFinite(prevRow.rate[level - 1])
              ? prevRow.rate[level - 1]
              : 0;
          // 16.1: report the count that was actually placed
          cell.blocks[level - 1] = at
            ? Number.isFinite(Number(at.placed)) ? Number(at.placed) : center
            : prevRow && Number.isFinite(prevRow.blocks[level - 1])
              ? prevRow.blocks[level - 1]
              : center;
          cell.avgMoves[level - 1] = at
            ? Number(at.avgMoves) || 0
            : prevRow && Number.isFinite(prevRow.avgMoves[level - 1])
              ? prevRow.avgMoves[level - 1]
              : 0;
        }
      }
    }
  }
  return stats;
}
