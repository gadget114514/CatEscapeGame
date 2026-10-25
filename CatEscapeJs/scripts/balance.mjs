#!/usr/bin/env node
/**
 * Balance runner (spec 13.8/14.6, replaces the task-21 greedy script).
 *
 * Plays every (rules, course, difficulty, level) with the three player
 * profiles — `weak` (Easy AI), `normal` (Normal AI, the typical-human
 * proxy) and `strong` (Hard AI) — against the level's own AI, on
 * `os.cpus().length - 1` worker threads, then prints the per-level rates.
 * With `--write` it also writes `src/game/play/levelStats.json` and
 * `src/game/play/levelStats.basic.json`.
 *
 *   npm run balance                     # 200 games per setting, both rules
 *   node scripts/balance.mjs --games 10
 *   node scripts/balance.mjs --rules gimmick --write
 *   node scripts/balance.mjs --seed 7 --workers 4
 *
 * Pure Node — no DOM, no Babylon.js.
 */
import process from 'node:process';
import { RULE_KINDS, DEFAULT_GAMES } from './sim.mjs';
import { defaultWorkers } from './pool.mjs';
import { buildJobs, assembleStats, writeStats, printReport } from './stats.mjs';
import { runJobs } from './pool.mjs';

/** Tiny flag parser: `--key value` / `--flag`. */
function parseArgs(argv) {
  const out = { games: DEFAULT_GAMES, seed: 0, write: false, rules: 'both', workers: defaultWorkers() };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--games') out.games = Math.max(1, Number(argv[++i]) | 0) || DEFAULT_GAMES;
    else if (a === '--seed') out.seed = Number(argv[++i]) >>> 0 || 0;
    else if (a === '--workers') out.workers = Math.max(1, Number(argv[++i]) | 0) || defaultWorkers();
    else if (a === '--write') out.write = true;
    else if (a === '--rules') out.rules = String(argv[++i]);
    else if (a === '--help' || a === '-h') out.help = true;
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const rulesList =
  args.rules === 'gimmick' || args.rules === 'basic' ? [args.rules] : RULE_KINDS;

if (args.help) {
  console.log(
    'usage: node scripts/balance.mjs [--games N] [--seed N] [--workers N]\n' +
    '                               [--rules gimmick|basic|both] [--write]',
  );
  process.exit(0);
}

console.log(
  `balance: ${args.games} games per setting, profiles weak/normal/strong, ` +
  `rules ${rulesList.join('+')}, ${args.workers} workers\n`,
);
const t0 = Date.now();
const jobs = buildJobs({ rulesList, games: args.games, seedBase: args.seed });
const results = await runJobs(jobs, { workers: args.workers });
printReport(results, rulesList);

if (args.write) {
  for (const rules of rulesList) {
    const stats = assembleStats(results, { games: args.games, rules });
    const file = writeStats(stats, rules);
    console.log(`\nwrote ${file}`);
  }
}
console.log(`\ndone: ${jobs.length} settings in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
