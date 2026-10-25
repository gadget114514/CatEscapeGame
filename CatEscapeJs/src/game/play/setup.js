/**
 * Game setup: turn the four axis selections into a ruleset and the options
 * for `ruleset.newGame` (spec 12.1, extended by 13.4/14.2). Pure logic —
 * no Babylon.js, no DOM.
 */
import { basicRuleset, gimmickRuleset } from '../rulesets.js';
import { getLevel, GIMMICK_KEYS, LEVEL_COUNT, levelFeatures, blocksFor } from './levels.js';
import { highestUnlocked } from './progress.js';
import { UNLOCKS } from '../gimmick/registry.js';

/** Representative level per difficulty for gimmick + streak (spec 13.4). */
export const STREAK_LEVEL = { easy: 3, normal: 10, hard: 17 };

/**
 * @typedef {import('./levels.js').Level} Level
 * @typedef {{ rules:'basic'|'gimmick', play:'streak'|'level',
 *             role:'trapper'|'escape', difficulty?:'easy'|'normal'|'hard',
 *             course?:'trapper'|'escape', level?:number,
 *             progress?:import('./progress.js').Progress, blocks?:number,
 *             playerItems?:{hammer:number, double:number}|number }} GameChoice
 * @typedef {{ ruleset: typeof basicRuleset | typeof gimmickRuleset,
 *             newGameOpts: { role:'trapper'|'escape', ai:'easy'|'normal'|'hard',
 *                            blocks?:number,
 *                            gimmick?:{ gimmicks:object, aiItems:number,
 *                                       features?:{power:boolean, dash:boolean,
 *                                                   jump:boolean, storm:boolean} },
 *                            playerItems?:{hammer:number, double:number} } }} ResolvedGame
 */

/**
 * Keep only the gimmicks already unlocked at level `highest` (13.4).
 * @param {Level['gimmicks']} gimmicks
 * @param {number} highest
 * @returns {Level['gimmicks']}
 */
function filterGimmicks(gimmicks, highest) {
  /** @type {Record<string, number>} */
  const out = {};
  for (const k of GIMMICK_KEYS) {
    out[k] = (UNLOCKS[k] ?? 0) <= highest ? gimmicks[k] || 0 : 0;
  }
  return out;
}

/**
 * Carry-over items may only be used at or after their unlock level
 * (14.2): hammers from L16, doubles from L4.
 * @param {GameChoice['playerItems']} playerItems
 * @param {number} highest
 * @returns {{hammer:number, double:number}|undefined}
 */
function gateItems(playerItems, highest) {
  if (playerItems == null) return undefined;
  const src =
    typeof playerItems === 'number'
      ? { hammer: playerItems, double: playerItems }
      : playerItems;
  return {
    hammer: highest >= UNLOCKS.hammer ? Number(src.hammer) || 0 : 0,
    double: highest >= UNLOCKS.double ? Number(src.double) || 0 : 0,
  };
}

/**
 * Resolve the four-axis game choice.
 * - `streak`: `ai = difficulty`; with gimmick rules the gimmick parameters
 *   come from a representative level of the same course (easy → L3,
 *   normal → L10, hard → L17), keeping only gimmicks with `unlock <=` the
 *   course's highest unlocked level (13.4). The 14.5 comeback features
 *   follow the same gate (the lower of the representative and the highest
 *   unlocked level). Streak play is always one cat (13.7): L17 counts as
 *   1 cat here. `blocks` stays unset, so `INITIAL_BLOCKS` applies — basic
 *   + streak is exactly the game in sections 1–11.
 * - `level`: `ai` and the gimmick parameters come from the level table
 *   (14.3), including `cats`/`catsGoal` for L17–20; `blocks` is the level's
 *   initial block count **for the chosen difficulty** (14.6 — difficulty
 *   changes only the block count); with basic rules only `ai` and `blocks`
 *   are used. The 14.5 features come from the course + level.
 * - `playerItems` (gimmick rules): the carry-over inventory, gated by the
 *   unlock levels (hammers ≥ L16, doubles ≥ L4) and returned in
 *   `newGameOpts.playerItems`.
 * @param {GameChoice} choice
 * @returns {ResolvedGame}
 */
export function resolveGame({
  rules = 'basic',
  play = 'streak',
  role = 'trapper',
  difficulty = 'normal',
  course,
  level = 1,
  progress = null,
  playerItems,
  blocks,
} = {}) {
  const ruleset = rules === 'gimmick' ? gimmickRuleset : basicRuleset;
  // 16.3: the slider's explicit count overrides the table/INITIAL_BLOCKS
  const override =
    typeof blocks === 'number' && Number.isFinite(blocks)
      ? Math.max(0, Math.floor(blocks))
      : null;

  if (play === 'level') {
    const lv = getLevel(course || role, level);
    /** @type {ResolvedGame['newGameOpts']} */
    const newGameOpts = {
      role,
      ai: lv.ai,
      // 18.1: each rules kind reads its own table entry
      blocks: override !== null ? override : blocksFor(lv, difficulty, rules),
    };
    if (rules === 'gimmick') {
      newGameOpts.gimmick = {
        gimmicks: filterGimmicks(lv.gimmicks, lv.id),
        aiItems: lv.aiItems,
        cats: lv.cats || 1,
        catsGoal: lv.catsGoal ?? null,
        features: levelFeatures(lv.course, lv.id),
      };
      const gated = gateItems(playerItems, lv.id);
      if (gated) newGameOpts.playerItems = gated;
    }
    return { ruleset, newGameOpts };
  }

  const highest = progress ? highestUnlocked(progress, 'gimmick', role) : LEVEL_COUNT;
  const rep = STREAK_LEVEL[difficulty] ?? STREAK_LEVEL.normal;
  /** @type {ResolvedGame['newGameOpts']} */
  const newGameOpts = { role, ai: difficulty };
  // 16.3: streak play uses the same mechanism, the center is INITIAL_BLOCKS
  if (override !== null) newGameOpts.blocks = override;
  if (rules === 'gimmick') {
    newGameOpts.gimmick = {
      gimmicks: filterGimmicks(getLevel(role, rep).gimmicks, highest),
      aiItems: getLevel(role, rep).aiItems,
      cats: 1, // streak play is always one cat (L17 counts as 1, spec 13.7)
      catsGoal: null,
      // 14.5 features gated like the gimmicks themselves (13.4)
      features: levelFeatures(role, Math.min(rep, highest)),
    };
    const gated = gateItems(playerItems, highest);
    if (gated) newGameOpts.playerItems = gated;
  }
  return { ruleset, newGameOpts };
}
