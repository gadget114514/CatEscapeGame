/**
 * Shared game simulation for `scripts/balance.mjs` and
 * `scripts/calibrate.mjs` (spec 13.8/14.6). Pure Node — no DOM, no
 * Babylon.js. Importable from tests (no side effects on import).
 *
 * A simulated game is a full level game under the level's rules:
 * - the opponent always plays the level's `ai`
 * - the player side is played by the **profile**: `weak` → Easy AI,
 *   `normal` → Normal AI (the typical human proxy, 14.5/14.6),
 *   `strong` → Hard AI
 * - the board uses the level's `blocks` for the given difficulty (14.6)
 * - gimmick games: every gimmick of the level table is active, multiple
 *   cats included, the 14.5 comeback features follow the course unlocks,
 *   and the player starts with 1 of the role's item once it is unlocked
 *   (hammer from L2, double from L4) as the stand-in carry-over inventory
 */
import { basicRuleset, gimmickRuleset } from '../src/game/rulesets.js';
import { getLevel, levelFeatures } from '../src/game/play/levels.js';
import { mulberry32 } from '../src/game/rng.js';

/** Profile name → the AI difficulty the player side plays with (13.8). */
export const PROFILE_AI = { weak: 'easy', normal: 'normal', strong: 'hard' };
export const PROFILES = ['weak', 'normal', 'strong'];
export const RULE_KINDS = ['gimmick', 'basic'];

/** Games per setting unless `--games` says otherwise (spec default 200). */
export const DEFAULT_GAMES = 200;
const MAX_STEPS = 500;

/**
 * The stand-in carry-over inventory for the simulated player (13.8): 1 of
 * the role's item once unlocked — hammer from L2, double from L4.
 * @param {'gimmick'|'basic'} rules
 * @param {'escape'|'trapper'} course
 * @param {number} level
 * @returns {{hammer:number, double:number}|undefined}
 */
export function simPlayerItems(rules, course, level) {
  if (rules !== 'gimmick') return undefined;
  return course === 'escape'
    ? { hammer: level >= 2 ? 1 : 0, double: 0 }
    : { hammer: 0, double: level >= 4 ? 1 : 0 };
}

/**
 * Deterministic seed for game `g` of a setting. The block count is
 * deliberately **not** part of the key: every block-count probe of the
 * same setting replays the same games, so `calibrate` probes compare like
 * with like.
 * @param {{seedBase?:number, rules:string, course:string, level:number,
 *          difficulty:string, profile:string}} s
 * @param {number} g
 * @returns {number}
 */
export function seedFor(s, g) {
  const str = `${s.seedBase ?? 0}:${s.rules}:${s.course}:${s.level}:${s.difficulty}:${s.profile}:${g}`;
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Play one game to the end.
 * @param {{rules:'gimmick'|'basic', course:'escape'|'trapper', level:number,
 *          difficulty:'easy'|'normal'|'hard', blocks:number,
 *          profile:'weak'|'normal'|'strong', seed:number}} opts
 * @returns {{playerWon:boolean, moves:number, draw:boolean, status:string}}
 */
export function playGame({ rules, course, level, difficulty, blocks, profile, seed }) {
  const lv = getLevel(course, level);
  const ruleset = rules === 'gimmick' ? gimmickRuleset : basicRuleset;
  const state = ruleset.newGame({
    role: course,
    ai: lv.ai,
    blocks,
    gimmick:
      rules === 'gimmick'
        ? {
            gimmicks: lv.gimmicks,
            aiItems: lv.aiItems,
            cats: lv.cats,
            catsGoal: lv.catsGoal,
            features: levelFeatures(course, level),
          }
        : undefined,
    playerItems: simPlayerItems(rules, course, level),
    seed,
  });
  const playerSide = course === 'escape' ? 'cat' : 'trapper';
  const oppAI = lv.ai;
  const rng = mulberry32((seed ^ 0x9e3779b9) >>> 0);
  let steps = 0;
  while (state.status === 'playing' && steps++ < MAX_STEPS) {
    // each side plays its own strength: the profile for the player, the
    // level's `ai` for the opponent
    state.difficulty = state.turn === playerSide ? PROFILE_AI[profile] : oppAI;
    if (state.turn === 'trapper') {
      if (ruleset.shouldUseItem(state, rng)) ruleset.armItem(state);
      const m = ruleset.chooseBlock(state, rng);
      if (m < 0) break;
      ruleset.applyBlock(state, m);
    } else {
      if (ruleset.chooseAICat) ruleset.selectCat(state, ruleset.chooseAICat(state, rng));
      const power = ruleset.shouldUsePower ? ruleset.shouldUsePower(state, rng) : null;
      if (power && ruleset.canUsePower && ruleset.canUsePower(state, power)) {
        ruleset.armPower(state, power); // 14.5 dash / corner jump
      } else if (ruleset.shouldUseItem(state, rng)) {
        ruleset.armItem(state);
      }
      const m = ruleset.chooseCatMove(state, rng);
      if (m < 0) break;
      ruleset.applyCatMove(state, m);
    }
  }
  const playerWon =
    course === 'escape' ? state.status === 'catWin' : state.status === 'trapperWin';
  return {
    playerWon,
    moves: state.moveCount,
    draw: state.status === 'playing',
    status: state.status,
    // 16.1: the count the setup actually placed (it lowers the request
    // after 100 failed tries) — the sweep/report/stats use this number
    placed: Number.isFinite(state.placedBlocks) ? state.placedBlocks : blocks,
  };
}

/**
 * Simulate `games` seeded games of one setting (13.8/14.6).
 * @param {{rules:'gimmick'|'basic', course:'escape'|'trapper', level:number,
 *          difficulty:'easy'|'normal'|'hard', blocks:number,
 *          profile:'weak'|'normal'|'strong', games?:number,
 *          seedBase?:number}} opts
 * @returns {{games:number, wins:number, draws:number, rate:number,
 *            avgMoves:number, placed:number}}
 */
export function simulate(opts) {
  const games = Math.max(1, Math.floor(opts.games ?? DEFAULT_GAMES));
  let wins = 0;
  let draws = 0;
  let moves = 0;
  let placed = 0;
  for (let g = 0; g < games; g++) {
    const r = playGame({ ...opts, seed: seedFor(opts, g) });
    if (r.playerWon) wins++;
    if (r.draw) draws++;
    moves += r.moves;
    placed += r.placed;
  }
  return {
    games,
    wins,
    draws,
    rate: wins / games,
    avgMoves: moves / games,
    placed: placed / games,
  };
}
