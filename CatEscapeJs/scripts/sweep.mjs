#!/usr/bin/env node
/**
 * Full sweep (spec 16.4): measure **every** pattern instead of binary
 * searching one. For each (rules, course, level, profile, block count) it
 * plays `games` seeded games of the level against the level's own AI on
 * `os.cpus().length - 1` worker threads and appends one JSON line per
 * probe to the output file (default `scripts/out/sweep.json`, not bundled).
 *
 * Two passes:
 * - **coarse** (default): every even block count, 100 games each
 * - **fine** (`--pass fine`): every integer inside the ranges the last
 *   calibration wrote into `levels.js`, 200 games each
 *
 * The run is **resumable**: probes already present in the output file
 * (same rules/course/level/profile/blocks/games/seed) are skipped, results
 * are appended line by line, and an ETA prints every 30 s.
 *
 *   npm run sweep
 *   node scripts/sweep.mjs --games 2 --levels 1-2 --out scripts/out/smoke.json
 *   node scripts/sweep.mjs --pass fine
 *   node scripts/sweep.mjs --rules gimmick --pass coarse --out scripts/out/sweep-gimmick.json
 *   node scripts/sweep.mjs --report [--out scripts/out/smoke.json]
 *
 * Pure Node — no DOM, no Babylon.js. Importing this module has no side
 * effects; `main()` only runs when the file is executed directly.
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runJobs, defaultWorkers } from './pool.mjs';
import { PROFILES, RULE_KINDS } from './sim.mjs';
import { getLevel } from '../src/game/play/levels.js';
import { levelRange, BLOCKS_MIN, BLOCKS_MAX } from '../src/game/play/blocks.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** Where a full sweep lands by default (gitignored, not bundled). */
export const DEFAULT_OUT = path.join(HERE, 'out', 'sweep.json');
/** 16.4: games per probe per pass. */
export const COARSE_GAMES = 100;
export const FINE_GAMES = 200;
export const COURSES = ['escape', 'trapper'];
export const ALL_LEVELS = Array.from({ length: 20 }, (_, i) => i + 1);

/**
 * The coarse pass: every even block count in the 0–60 search range (16.1).
 * @param {number} [max=BLOCKS_MAX]
 * @returns {number[]}
 */
export function coarseCounts(max = BLOCKS_MAX) {
  const out = [];
  for (let b = BLOCKS_MIN; b <= max; b += 2) out.push(b);
  return out;
}

/**
 * Parse a level spec (`1-2`, `1,3,5-7`) into a sorted level list.
 * @param {string|null|undefined} spec
 * @param {number} [max=20]
 * @returns {number[]|null} null when nothing valid was given
 */
export function parseLevels(spec, max = 20) {
  if (!spec) return null;
  const out = new Set();
  for (const part of String(spec).split(',')) {
    const s = part.trim();
    const m = s.match(/^(\d+)\s*-\s*(\d+)$/);
    if (m) {
      for (let n = Math.max(1, Number(m[1])); n <= Math.min(max, Number(m[2])); n++) out.add(n);
    } else if (/^\d+$/.test(s)) {
      const n = Number(s);
      if (n >= 1 && n <= max) out.add(n);
    }
  }
  const list = [...out].sort((a, b) => a - b);
  return list.length > 0 ? list : null;
}

/**
 * The resume key of one probe (16.4): restarts skip exactly the probes
 * that already carry this key in the output file.
 * @param {{rules:string, course:string, level:number, profile:string,
 *          blocks:number, games?:number, seedBase?:number}} p
 * @returns {string}
 */
export function probeKey(p) {
  return [p.rules, p.course, p.level, p.profile, p.blocks, p.games ?? 0, p.seedBase ?? 0].join('|');
}

/**
 * Read a JSON-lines sweep file; a missing file is an empty list and a
 * malformed line is skipped (a crashed run never poisons the resume).
 * @param {string} file
 * @returns {Array<object>}
 */
export function readSweep(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return [];
  }
  const out = [];
  for (const line of text.split('\n')) {
    const s = line.trim();
    if (!s) continue;
    try {
      const rec = JSON.parse(s);
      if (rec && typeof rec === 'object' && Number.isFinite(Number(rec.blocks))) out.push(rec);
    } catch {
      /* half-written line from a killed run — ignore it */
    }
  }
  return out;
}

/**
 * The strongest record per (rules, course, level, profile, blocks): the
 * one with the most games (the fine pass supersedes the coarse one),
 * ties go to the later line.
 * @param {Array<object>} records
 * @returns {Map<string, object>}
 */
export function bestRecords(records) {
  const map = new Map();
  for (const r of records) {
    const key = [r.rules, r.course, r.level, r.profile, r.blocks].join('|');
    const prev = map.get(key);
    if (!prev || (Number(r.games) || 0) >= (Number(prev.games) || 0)) map.set(key, r);
  }
  return map;
}

/**
 * Parse a `--rules` filter (`gimmick`, `basic`, `gimmick,basic` or
 * `both`) into a rules-kind list (18.5). Anything else means "every
 * kind".
 * @param {string|null|undefined} spec
 * @param {string[]} [kinds=RULE_KINDS]
 * @returns {string[]}
 */
export function parseRules(spec, kinds = RULE_KINDS) {
  if (!spec) return kinds.slice();
  const s = String(spec).trim().toLowerCase();
  if (s === 'both' || s === 'all') return kinds.slice();
  const out = [];
  for (const part of s.split(',')) {
    const k = part.trim();
    if (kinds.includes(k) && !out.includes(k)) out.push(k);
  }
  return out.length > 0 ? out : kinds.slice();
}

/**
 * The fine-pass counts of one level (16.2/16.4): every integer inside the
 * union of the three difficulty ranges, falling back to center ± 2 while
 * the level is still uncalibrated. Ranges are read **for the rules kind**
 * (18.1).
 * @param {'escape'|'trapper'} course
 * @param {number} level
 * @param {(course:string, level:number)=>object} [levelOf]
 * @param {'basic'|'gimmick'} [rules='gimmick']
 * @returns {number[]}
 */
export function fineCounts(course, level, levelOf = getLevel, rules = 'gimmick') {
  const lv = levelOf(course, level);
  let lo = Infinity;
  let hi = -Infinity;
  for (const d of ['easy', 'normal', 'hard']) {
    const r = levelRange(lv, d, course, rules);
    lo = Math.min(lo, r.min);
    hi = Math.max(hi, r.max);
  }
  const out = [];
  for (let b = Math.max(BLOCKS_MIN, lo); b <= Math.min(BLOCKS_MAX, hi); b++) out.push(b);
  return out.length > 0 ? out : [levelRange(lv, 'normal', course, rules).center];
}

/**
 * The probes of one sweep run, minus the ones already done (16.4).
 * @param {{rulesList?:string[], courses?:string[], levels?:number[],
 *          profiles?:string[],
 *          countsOf?:(rules:string, course:string, level:number)=>number[],
 *          games?:number, seedBase?:number}} opts
 * @param {Set<string>} done probe keys already present in the output file
 * @returns {Array<object>} one job per remaining probe, in a stable order
 */
export function planProbes(opts, done) {
  const rulesList = opts.rulesList ?? RULE_KINDS;
  const courses = opts.courses ?? COURSES;
  const levels = opts.levels ?? ALL_LEVELS;
  const profiles = opts.profiles ?? PROFILES;
  const countsOf = opts.countsOf ?? (() => coarseCounts());
  const games = Math.max(1, Math.floor(opts.games ?? COARSE_GAMES));
  const seedBase = opts.seedBase ?? 0;
  const jobs = [];
  for (const rules of rulesList) {
    for (const course of courses) {
      for (const level of levels) {
        for (const profile of profiles) {
          for (const blocks of countsOf(rules, course, level)) {
            const job = {
              rules,
              course,
              level,
              difficulty: 'normal', // the sweep is difficulty-agnostic: it
              // varies the block count itself, difficulty only picks one
              profile,
              blocks,
              games,
              seedBase,
            };
            if (done && done.has(probeKey(job))) continue;
            jobs.push(job);
          }
        }
      }
    }
  }
  return jobs;
}

/** The one JSON line a worker result becomes (16.4 output shape). */
function sweepRecord(r) {
  return {
    rules: r.rules,
    course: r.course,
    level: r.level,
    profile: r.profile,
    blocks: r.blocks,
    placed: r.placed,
    games: r.games,
    wins: r.wins,
    draws: r.draws,
    avgMoves: r.avgMoves,
    seedBase: r.seedBase ?? 0,
  };
}

/**
 * The designer's compact matrix (16.4): one block per (rules, course,
 * profile), levels as rows and block counts as columns, rates in %.
 * @param {Array<object>} records
 */
export function printReport(records) {
  const best = bestRecords(records);
  /** @type {Map<string, Array<object>>} */
  const groups = new Map();
  for (const r of best.values()) {
    const key = `${r.rules} · ${r.course} · ${r.profile}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  if (groups.size === 0) {
    console.log('sweep --report: no probes yet');
    return;
  }
  for (const [head, rows] of [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const levels = [...new Set(rows.map((r) => r.level))].sort((a, b) => a - b);
    const counts = [...new Set(rows.map((r) => Number(r.blocks)))].sort((a, b) => a - b);
    const cell = new Map(rows.map((r) => [`${r.level}|${r.blocks}`, r]));
    console.log(`\n${head}`);
    console.log(`  L   ${counts.map((b) => String(b).padStart(4)).join('')}`);
    for (const level of levels) {
      const line = counts
        .map((b) => {
          const r = cell.get(`${level}|${b}`);
          if (!r) return '   ·';
          const games = Math.max(1, Number(r.games) || 1);
          return `${String(Math.round(((Number(r.wins) || 0) / games) * 100)).padStart(3)}%`;
        })
        .join('');
      console.log(`  ${String(level).padStart(2)}  ${line}`);
    }
  }
}

function parseArgs(argv) {
  const out = {
    out: DEFAULT_OUT,
    pass: 'coarse',
    games: null,
    levels: null,
    rules: null,
    workers: defaultWorkers(),
    seed: 0,
    report: false,
    maxBlocks: BLOCKS_MAX,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out') out.out = String(argv[++i]);
    else if (a === '--pass') out.pass = String(argv[++i]) === 'fine' ? 'fine' : 'coarse';
    else if (a === '--games') out.games = Math.max(1, Number(argv[++i]) | 0);
    else if (a === '--levels') out.levels = String(argv[++i]);
    else if (a === '--rules') out.rules = String(argv[++i]); // 18.5: gimmick|basic|both
    else if (a === '--workers') out.workers = Math.max(1, Number(argv[++i]) | 0) || defaultWorkers();
    else if (a === '--seed') out.seed = Number(argv[++i]) >>> 0 || 0;
    else if (a === '--max-blocks') out.maxBlocks = Math.min(BLOCKS_MAX, Math.max(0, Number(argv[++i]) | 0));
    else if (a === '--report') out.report = true;
    else if (a === '--help' || a === '-h') out.help = true;
  }
  return out;
}

function fmtSec(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '?';
  const s = Math.round(seconds);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(
      'usage: node scripts/sweep.mjs [--pass coarse|fine] [--games N] [--levels 1-5]\n' +
        '                            [--rules gimmick|basic|both] [--out scripts/out/sweep.json]\n' +
        '                            [--workers N] [--seed N] [--max-blocks N] [--report]',
    );
    return;
  }

  const existing = readSweep(args.out);
  if (args.report) {
    printReport(existing);
    return;
  }

  const done = new Set(existing.map(probeKey));
  const levels = parseLevels(args.levels) || ALL_LEVELS;
  // 18.5: `--rules gimmick` sweeps only that rules kind
  const rulesList = parseRules(args.rules);
  const games =
    args.games ?? (args.pass === 'fine' ? FINE_GAMES : COARSE_GAMES);
  const countsOf =
    args.pass === 'fine'
      ? (rules, course, level) => fineCounts(course, level, getLevel, rules)
      : () => coarseCounts(args.maxBlocks);
  const jobs = planProbes(
    { rulesList, levels, games, seedBase: args.seed, countsOf },
    done,
  );

  console.log(
    `sweep ${args.pass}: ${jobs.length} probes to play ` +
      `(${rulesList.join('+')}; ${done.size} already in ${path.relative(process.cwd(), args.out) || args.out}), ` +
      `${games} games each, ${args.workers} workers`,
  );
  if (jobs.length === 0) {
    console.log('nothing to do');
    return;
  }

  fs.mkdirSync(path.dirname(args.out), { recursive: true });
  const fd = fs.openSync(args.out, 'a');
  const t0 = Date.now();
  let lastEta = t0;
  const batchSize = Math.max(1, args.workers * 4);
  try {
    for (let i = 0; i < jobs.length; i += batchSize) {
      const batch = jobs.slice(i, i + batchSize);
      const results = await runJobs(batch, { workers: args.workers });
      let lines = '';
      for (const r of results) lines += `${JSON.stringify(sweepRecord(r))}\n`;
      fs.writeSync(fd, lines);
      const finished = i + batch.length;
      const now = Date.now();
      if (now - lastEta >= 30000 || finished === jobs.length) {
        lastEta = now;
        const secs = (now - t0) / 1000;
        const rate = finished / secs;
        const eta = (jobs.length - finished) / rate;
        console.log(
          `  ${finished}/${jobs.length} probes ` +
            `(${((finished / jobs.length) * 100).toFixed(1)}%) · ` +
            `${rate.toFixed(2)} probes/s · eta ${fmtSec(eta)}`,
        );
      }
    }
  } finally {
    fs.closeSync(fd);
  }
  console.log(
    `done: ${jobs.length} probes in ${((Date.now() - t0) / 1000).toFixed(1)} s → ` +
      `${path.relative(process.cwd(), args.out) || args.out}`,
  );
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  await main();
}
