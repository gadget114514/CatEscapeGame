/**
 * Initial block counts and the 16.2/16.3 difficulty slider. Pure logic —
 * no Babylon.js, no DOM.
 *
 * One rule decides everything about "harder" (16.2): every piece of code
 * that compares, orders, smooths or maps block counts goes through
 * `hardnessDirection(course)` — `+1` for the escape course (more blocks =
 * fewer routes = harder), `-1` for the trapper course (more blocks =
 * easier to enclose). Nothing hard-codes a direction.
 *
 * A level stores its per-difficulty centers `blocks` and, after
 * `npm run calibrate`, the matching non-overlapping ranges `range` in
 * block counts — both **per rules kind** since 18.1
 * (`blocks:{basic:{easy,…}, gimmick:{easy,…}}`, `range` likewise), so the
 * two games calibrate independently. Without a calibrated range the level
 * falls back to the center ± 2 (the 16.2 minimum half-width).
 *
 * @typedef {{center:number, min:number, max:number}} BlockRange
 */

import { blocksFor } from './levels.js';
import { INITIAL_BLOCKS } from '../rules.js';

/** The sweep/calibration search range in block counts (16.1). */
export const BLOCKS_MIN = 0;
export const BLOCKS_MAX = 60;

/** Fallback half-width of an uncalibrated range (16.2: at least ±2). */
export const DEFAULT_HALF = 2;

/**
 * In which direction does "more blocks" mean "harder"? (16.2)
 * - `escape` (the player is the cat): +1 — more blocks = fewer routes.
 * - `trapper` (the player is the trapper): -1 — more blocks = easier.
 * @param {string} course
 * @returns {number} `+1` or `-1`
 */
export function hardnessDirection(course) {
  return course === 'trapper' ? -1 : 1;
}

function clampInt(n, min, max) {
  const v = Math.round(Number(n));
  if (!Number.isFinite(v)) return min;
  return Math.min(Math.max(v, min), max);
}

/**
 * Keep `blocks` inside a range; a non-number yields the center.
 * @param {BlockRange} range
 * @param {number} blocks
 * @returns {number}
 */
export function clampBlocks(range, blocks) {
  if (!Number.isFinite(Number(blocks))) return range.center;
  return clampInt(blocks, range.min, range.max);
}

/**
 * The slider range of a level's difficulty (16.2): the calibrated
 * `lv.range[rules][difficulty]` when present (18.1 — ranges are stored
 * per rules kind), else the center ± 2. The pre-18.1 shared shape
 * (`lv.range[difficulty]`) is still read for every kind.
 * @param {import('./levels.js').Level} lv
 * @param {'easy'|'normal'|'hard'} [difficulty='normal']
 * @param {'escape'|'trapper'} [course] defaults to the level's own course
 * @param {'basic'|'gimmick'} [rules='gimmick'] the rules kind (18.1)
 * @returns {BlockRange}
 */
export function levelRange(lv, difficulty = 'normal', course, rules = 'gimmick') {
  const dir = hardnessDirection(course || lv.course);
  const center = blocksFor(lv, difficulty, rules);
  const table = lv.range;
  /** @type {number[]|null} */
  let raw = null;
  if (table && typeof table === 'object') {
    if (table.basic || table.gimmick) {
      // 18.1: ranges live under their rules kind
      const per = table[rules] || (rules === 'basic' ? table.gimmick : table.basic);
      if (per && Array.isArray(per[difficulty])) raw = per[difficulty];
    } else if (Array.isArray(table[difficulty])) {
      raw = table[difficulty]; // pre-18.1 shared shape
    }
  }
  let min;
  let max;
  if (raw && Number.isFinite(raw[0]) && Number.isFinite(raw[1])) {
    min = Math.min(raw[0], raw[1]);
    max = Math.max(raw[0], raw[1]);
  } else {
    min = center - DEFAULT_HALF;
    max = center + DEFAULT_HALF;
  }
  // the center always stays inside its own range
  min = Math.min(min, center);
  max = Math.max(max, center);
  return {
    center,
    min: clampInt(min, BLOCKS_MIN, BLOCKS_MAX),
    max: clampInt(max, BLOCKS_MIN, BLOCKS_MAX),
  };
}

/**
 * The slider range of streak play (16.3): the center is `INITIAL_BLOCKS`
 * of the player's role and difficulty, the half-width is the ±2 minimum.
 * @param {'trapper'|'escape'} role the player's role (the course)
 * @param {'easy'|'normal'|'hard'} [difficulty='normal']
 * @returns {BlockRange}
 */
export function streakRange(role, difficulty = 'normal') {
  const table = INITIAL_BLOCKS[role] || INITIAL_BLOCKS.trapper;
  const center = Number.isFinite(table[difficulty]) ? table[difficulty] : table.normal;
  return {
    center,
    min: clampInt(center - DEFAULT_HALF, BLOCKS_MIN, BLOCKS_MAX),
    max: clampInt(center + DEFAULT_HALF, BLOCKS_MIN, BLOCKS_MAX),
  };
}

/**
 * Slider position (0..1) → the block count it plays with (16.3).
 * **Right is always harder in both courses**: escape maps right to *more*
 * blocks, trapper maps right to *fewer* blocks.
 * @param {'escape'|'trapper'} course
 * @param {BlockRange} range
 * @param {number} position 0 = easiest, 1 = hardest
 * @returns {number} an integer block count inside `[range.min, range.max]`
 */
export function sliderBlocks(course, range, position) {
  const span = Math.max(0, range.max - range.min);
  const t = Math.min(Math.max(Number(position) || 0, 0), 1);
  const offset = Math.round(t * span);
  return hardnessDirection(course) > 0
    ? range.min + offset
    : range.max - offset;
}

/**
 * The inverse of `sliderBlocks`: a block count → its slider position
 * (0..1, right = harder in both courses).
 * @param {'escape'|'trapper'} course
 * @param {BlockRange} range
 * @param {number} blocks
 * @returns {number} 0..1
 */
export function sliderPosition(course, range, blocks) {
  const span = Math.max(0, range.max - range.min);
  if (span === 0) return 0;
  const clamped = clampBlocks(range, blocks);
  const t = hardnessDirection(course) > 0
    ? (clamped - range.min) / span
    : (range.max - clamped) / span;
  return Math.min(Math.max(t, 0), 1);
}

/**
 * The localStorage key of a saved slider value (16.3): one slot per
 * (rules, play, course, level, difficulty).
 * @param {{rules?:string, play?:string, course?:string, level?:number,
 *          difficulty?:string}} s
 * @returns {string}
 */
export function blockSettingKey(s) {
  return [
    s.rules || 'basic',
    s.play || 'streak',
    s.course || s.role || 'trapper',
    Number.isFinite(s.level) ? s.level : 1,
    s.difficulty || 'normal',
  ].join('.');
}
