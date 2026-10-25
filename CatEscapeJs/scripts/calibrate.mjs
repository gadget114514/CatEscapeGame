#!/usr/bin/env node
/**
 * Level calibration (spec 16.4, replaces the 14.6 binary search): it
 * **reads the full sweep** (`scripts/out/sweep.json`, `npm run sweep`)
 * instead of simulating anything itself.
 *
 * For every course and level it
 * 1. smooths the `normal`-profile curve with isotonic regression in the
 *    course's hardness direction (`hardnessDirection`, 16.2),
 * 2. picks the center whose smoothed rate is closest to the 14.6 target,
 * 3. orders the three centers inside each level (a harder difficulty
 *    never gets an easier block count, 16.2 — but **no** across-level
 *    block-count constraint: the AI gets stronger at L7/L14, so a later
 *    level's best count may move the other way, 18.6) and
 * 4. builds the non-overlapping ±2..±5 ranges (16.2),
 *
 * then — unless `--dry-run` — rewrites the `blocks`/`range` objects of
 * `src/game/play/levels.js` (with a `// calibrated <date>` comment) for
 * **the `--rules` kind only** (18.1 — the other kind's entries stay
 * untouched) and regenerates both `levelStats` files from the sweep,
 * including the per-profile curves the 16.3 slider estimate interpolates.
 *
 * A level whose smoothed curve never comes within ±7 points of a target
 * is reported `UNREACHABLE` so the designer can rethink its gimmicks,
 * and a difficulty whose achieved rate rises by more than 3 points from
 * one level to the next is reported `NON-MONOTONE` (18.6).
 *
 *   npm run calibrate
 *   node scripts/calibrate.mjs --sweep scripts/out/smoke.json --dry-run
 *   node scripts/calibrate.mjs --rules gimmick --games 100
 *
 * Pure Node — no DOM, no Babylon.js.
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { DIFFICULTIES, getLevel, blocksFor } from '../src/game/play/levels.js';
import { hardnessDirection } from '../src/game/play/blocks.js';
import { RULE_KINDS } from './sim.mjs';
import { readSweep, bestRecords, DEFAULT_OUT } from './sweep.mjs';
import { assembleSweepStats, writeStats, today, STATS_PATHS } from './stats.mjs';
import {
  targetRate,
  orderCenters,
  nonMonotoneRises,
  rewriteLevels,
  isotonicBlocks,
  pickCenter,
  buildRanges,
  UNREACHABLE_TOL,
  LEVEL_COUNT,
} from './calibrateLib.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LEVELS_PATH = path.join(HERE, '..', 'src', 'game', 'play', 'levels.js');
const COURSES = ['escape', 'trapper'];

function parseArgs(argv) {
  const out = {
    sweep: DEFAULT_OUT,
    rules: 'gimmick',
    minGames: 1,
    dryRun: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--sweep') out.sweep = String(argv[++i]);
    else if (a === '--rules') out.rules = String(argv[++i]);
    else if (a === '--games') out.minGames = Math.max(1, Number(argv[++i]) | 0) || 1;
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '--help' || a === '-h') out.help = true;
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  console.log(
    'usage: node scripts/calibrate.mjs [--sweep scripts/out/sweep.json]\n' +
      '                                [--rules gimmick|basic] [--games N]\n' +
      '                                [--dry-run]',
  );
  process.exit(0);
}

const pct = (x) => `${(x * 100).toFixed(1)}%`;

/* ------------------------------------------------------------------ load */

const allRecords = readSweep(args.sweep);
const records = allRecords.filter((r) => (Number(r.games) || 0) >= args.minGames);
if (records.length === 0) {
  console.error(
    `calibrate: no usable probes in ${args.sweep}\n` +
      `  run \`npm run sweep\` first (or pass --sweep <file>)`,
  );
  process.exit(1);
}

// which rules kind's data calibrates the table (16.4 uses the level
// play sweep; gimmick is the default because levels carry the gimmicks)
const best = bestRecords(records);
const hasData = (rules) => [...best.values()].some((r) => r.rules === rules);
const calibRules =
  RULE_KINDS.includes(args.rules) && hasData(args.rules)
    ? args.rules
    : RULE_KINDS.find((r) => hasData(r)) || 'gimmick';

/** Every (rules, course, level, profile, blocks) → record, by setting. */
const bySetting = new Map();
for (const r of best.values()) {
  const key = `${r.rules}|${r.course}|${r.level}|${r.profile}`;
  if (!bySetting.has(key)) bySetting.set(key, []);
  bySetting.get(key).push(r);
}
for (const rows of bySetting.values()) rows.sort((a, b) => Number(a.blocks) - Number(b.blocks));

const rowsOf = (course, level, profile, rules = calibRules) =>
  bySetting.get(`${rules}|${course}|${level}|${profile}`) || [];

/* -------------------------------------------------------------- calibrate */

console.log(
  `calibrate: ${records.length} probes from ${args.sweep} ` +
    `(rules ${calibRules}, min ${args.minGames} games/probe` +
    `${args.dryRun ? ', dry run (no files written)' : ''})\n`,
);

/** course → difficulty → center blocks (14.6 targets on the smoothed curve) */
const blocksBy = { escape: {}, trapper: {} };
/** course → level → the smoothed normal curve + the picked centers */
const curves = { escape: [], trapper: [] };

for (const course of COURSES) {
  const direction = hardnessDirection(course);
  for (const d of DIFFICULTIES) blocksBy[course][d] = [];
  for (let level = 1; level <= LEVEL_COUNT; level++) {
    const lv = getLevel(course, level);
    const rows = rowsOf(course, level, 'normal');
    const blocksAsc = rows.map((r) => Number(r.blocks));
    const rawRates = rows.map((r) => (Number(r.wins) || 0) / Math.max(1, Number(r.games) || 1));
    const smoothed = isotonicBlocks(rawRates, direction);
    /** @type {Record<string, number>} */
    const centers = {};
    /** @type {Record<string, object|null>} */
    const picks = {};
    if (blocksAsc.length === 0) {
      // no sweep data for this level (a partial smoke sweep): keep the
      // table's own centers and mark it so the report stays honest
      for (const d of DIFFICULTIES) centers[d] = blocksFor(lv, d, calibRules);
      for (const d of DIFFICULTIES) picks[d] = null;
    } else {
      for (const d of DIFFICULTIES) {
        const pick = pickCenter(blocksAsc, smoothed, targetRate(d, level));
        picks[d] = pick;
        centers[d] = pick ? pick.blocks : blocksFor(lv, d, calibRules);
      }
    }
    curves[course][level - 1] = { blocksAsc, rawRates, smoothed, picks, noData: blocksAsc.length === 0 };
    for (const d of DIFFICULTIES) blocksBy[course][d].push(centers[d]);
  }
}
orderCenters(blocksBy);

/* ----------------------------------------------------------------- ranges */

/** course → level index → per-difficulty ranges (16.2) */
const ranges = { escape: [], trapper: [] };
for (const course of COURSES) {
  for (let level = 1; level <= LEVEL_COUNT; level++) {
    ranges[course][level - 1] = buildRanges(
      {
        easy: blocksBy[course].easy[level - 1],
        normal: blocksBy[course].normal[level - 1],
        hard: blocksBy[course].hard[level - 1],
      },
      course,
    );
  }
}

/* ----------------------------------------------------------------- report */

console.log('course  diff  L  target  achieved  draws  blocks  range   (smoothed)');
let unreachable = 0;
let missing = 0;
/** course → difficulty → the achieved rate per level (18.6, NaN = no data) */
const achievedBy = { escape: {}, trapper: {} };
for (const course of COURSES) {
  for (const d of DIFFICULTIES) {
    achievedBy[course][d] = [];
    for (let level = 1; level <= LEVEL_COUNT; level++) {
      const target = targetRate(d, level);
      const center = blocksBy[course][d][level - 1];
      const info = curves[course][level - 1];
      const range = ranges[course][level - 1][d];
      if (info.noData) {
        missing++;
        achievedBy[course][d].push(NaN);
        console.log(
          `${course.padEnd(7)} ${d.padEnd(6)} ${String(level).padStart(2)}  ` +
            `${pct(target).padStart(6)}  ${'—'.padStart(8)}  ${'—'.padStart(5)}  ` +
            `${String(center).padStart(6)}  [${range[0]},${range[1]}]  no data`,
        );
        continue;
      }
      const i = info.blocksAsc.indexOf(center);
      const achieved = i >= 0 ? info.rawRates[i] : NaN;
      achievedBy[course][d].push(achieved);
      const draws = (() => {
        const row = rowsOf(course, level, 'normal').find((r) => Number(r.blocks) === center);
        return row ? Number(row.draws) || 0 : 0;
      })();
      const bestDiff = Math.min(...info.smoothed.map((v) => Math.abs(v - target)));
      const far = bestDiff > UNREACHABLE_TOL;
      if (far) unreachable++;
      console.log(
        `${course.padEnd(7)} ${d.padEnd(6)} ${String(level).padStart(2)}  ` +
          `${pct(target).padStart(6)}  ${pct(achieved).padStart(8)}  ` +
          `${String(draws).padStart(5)}  ${String(center).padStart(6)}  ` +
          `[${range[0]},${range[1]}]${far ? '  UNREACHABLE' : ''}`,
      );
    }
  }
}
if (unreachable > 0) {
  console.log(`\n${unreachable} setting(s) could not come within ±7 points — rethink those levels.`);
}
if (missing > 0) {
  console.log(`\n${missing} setting(s) had no sweep data — their table centers are kept.`);
}

// 18.6: the block counts are free to move either way across levels; the
// achieved rate per difficulty should still be non-increasing, and a step
// up of more than 3 points is only reported, never clamped away
let nonMonotone = 0;
for (const course of COURSES) {
  for (const d of DIFFICULTIES) {
    for (const v of nonMonotoneRises(achievedBy[course][d])) {
      nonMonotone++;
      console.log(
        `${course.padEnd(7)} ${d.padEnd(6)} L${v.prevLevel}→L${v.level}  NON-MONOTONE: ` +
          `${pct(v.prev)} → ${pct(v.rate)} (+${(v.rise * 100).toFixed(1)} points)`,
      );
    }
  }
}
if (nonMonotone > 0) {
  console.log(
    `\n${nonMonotone} setting(s) report NON-MONOTONE — the achieved rate rose by more than 3 points (18.6).`,
  );
}

/* ------------------------------------------------------------------ write */

if (args.dryRun) {
  console.log(`\ndry run: ${LEVELS_PATH} and the levelStats files untouched`);
  process.exit(0);
}

const date = today();
const src = fs.readFileSync(LEVELS_PATH, 'utf8');
// 18.1: only the calibrated rules kind's entries are rewritten; the other
// kind's blocks/range stay exactly as they are on the line
fs.writeFileSync(LEVELS_PATH, rewriteLevels(src, blocksBy, date, ranges, calibRules), 'utf8');
console.log(`\nwrote ${LEVELS_PATH} (// calibrated ${date}, rules ${calibRules})`);

for (const rules of RULE_KINDS) {
  const file = STATS_PATHS[rules];
  let previous = null;
  try {
    previous = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    previous = null;
  }
  const stats = assembleSweepStats(records, {
    rules,
    generatedAt: date,
    previous,
    // the calibrated kind uses the fresh centers; the other kind reads its
    // own (untouched) table entries (18.1)
    centers:
      rules === calibRules
        ? (course, level, d) => blocksBy[course][d][level - 1]
        : (course, level, d) => blocksFor(getLevel(course, level), d, rules),
  });
  console.log(`wrote ${writeStats(stats, rules)}`);
}
