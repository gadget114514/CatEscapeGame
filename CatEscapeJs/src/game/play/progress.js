/**
 * Progress: level wins, unlocks, streaks and the item inventory.
 * Pure functions — the storage goes through an injected `storage` object
 * with `getItem`/`setItem` (localStorage-compatible), wrapped in try/catch.
 * No Babylon.js, no DOM.
 */
import { LEVEL_COUNT, getLevel, blocksFor } from './levels.js';
import { streakRange } from './blocks.js';

/**
 * @typedef {'basic'|'gimmick'} RulesKind
 * @typedef {'streak'|'level'} PlayStyle
 * @typedef {'trapper'|'escape'} Role
 * @typedef {'easy'|'normal'|'hard'} Diff
 * @typedef {{played:number, won:number}} LevelStat
 * @typedef {Record<string, LevelStat>} LevelStatCell 16.3: keyed by block count
 * @typedef {{ version:1,
 *             level: Record<RulesKind, Record<Role, number[]>>,
 *             stats: Record<RulesKind, Record<Role, LevelStatCell[]>>,
 *             streak: Record<string, {current:number, best:number}>,
 *             inventory: {hammer:number, double:number},
 *             seenIntro: string[] }} Progress
 * @typedef {{ rules:RulesKind, play:PlayStyle, role:Role, difficulty?:Diff,
 *             course?:Role, level?:number, blocks?:number,
 *             items?: {trapper:{double:number}, cat:{hammer:number}}|
 *                     {hammer:number, double:number} }} RecordCtx
 * @typedef {{ getItem(key:string):string|null,
 *             setItem(key:string, value:string):void }} Storage
 */

export const PROGRESS_KEY = 'catescape.progress.v1';
export const WIN_TARGET = 3;
export const ITEM_CAP = 9;
export const STAT_DIFFS = ['easy', 'normal', 'hard'];

function zeros(n) {
  return new Array(n).fill(0);
}

/** 20 × `{easy,normal,hard}` counters (14.6 per-difficulty level stats). */
function zeroStats() {
  const out = [];
  for (let i = 0; i < LEVEL_COUNT; i++) {
    const row = {};
    for (const d of STAT_DIFFS) row[d] = {};
    out.push(row);
  }
  return out;
}

/**
 * The block-count bucket a finished game belongs to (16.3): the count the
 * player chose, else the level's center for that difficulty.
 * @param {RecordCtx} ctx
 * @param {Role} course
 * @param {number} level
 * @param {Diff} difficulty
 * @returns {string} the object key (`"17"`)
 */
function statBlockKey(ctx, course, level, difficulty) {
  const raw = Number(ctx.blocks);
  if (Number.isFinite(raw)) return String(Math.max(0, Math.floor(raw)));
  return String(blocksFor(getLevel(course, level), difficulty, ctx.rules));
}

/**
 * Sum a per-block-count stats cell (16.3): the chart dots aggregate over
 * every count, so `{ "15": {played, won}, "16": {…} }` reads as one pair.
 * Legacy cells (`{played, won}` written before 16.3) are read as-is.
 * @param {LevelStatCell|LevelStat|undefined|null} cell
 * @returns {{played:number, won:number}}
 */
export function sumStatCell(cell) {
  if (!cell || typeof cell !== 'object') return { played: 0, won: 0 };
  let played = 0;
  let won = 0;
  let counted = false;
  for (const [key, v] of Object.entries(cell)) {
    if (key === 'played' || key === 'won') continue;
    if (!v || typeof v !== 'object') continue;
    played += Number(v.played) || 0;
    won += Number(v.won) || 0;
    counted = true;
  }
  if (!counted && Number.isFinite(Number(cell.played))) {
    return { played: Number(cell.played) || 0, won: Number(cell.won) || 0 };
  }
  return { played, won };
}

/**
 * Normalize one saved cell into the 16.3 `{blocks: {played, won}}` shape;
 * a legacy `{played, won}` cell is migrated onto the level's center count.
 * @param {unknown} cell
 * @param {Role} course
 * @param {number} levelIdx 0-based
 * @param {Diff} difficulty
 * @param {RulesKind} [rules='gimmick'] 18.1: the center comes from the
 *        rules kind's own table entry
 * @returns {LevelStatCell}
 */
function normalizeStatCell(cell, course, levelIdx, difficulty, rules = 'gimmick') {
  const out = {};
  if (!cell || typeof cell !== 'object') return out;
  const src = /** @type {any} */ (cell);
  if (Number.isFinite(Number(src.played))) {
    // pre-16.3 save: no count was recorded — park it on the center
    const center = blocksFor(getLevel(course, levelIdx + 1), difficulty, rules);
    out[String(center)] = {
      played: clampInt(src.played, 0, 1e9),
      won: clampInt(src.won, 0, 1e9),
    };
    return out;
  }
  for (const [key, v] of Object.entries(src)) {
    if (!v || typeof v !== 'object') continue;
    const played = Number(/** @type {any} */ (v).played);
    if (!Number.isFinite(played)) continue;
    out[String(Math.max(0, Math.floor(Number(key) || 0)))] = {
      played: clampInt(played, 0, 1e9),
      won: clampInt(/** @type {any} */ (v).won, 0, 1e9),
    };
  }
  return out;
}

/** The default (fresh) progress object. */
export function defaultProgress() {
  return {
    version: 1,
    level: {
      basic: { trapper: zeros(LEVEL_COUNT), escape: zeros(LEVEL_COUNT) },
      gimmick: { trapper: zeros(LEVEL_COUNT), escape: zeros(LEVEL_COUNT) },
    },
    stats: {
      basic: { trapper: zeroStats(), escape: zeroStats() },
      gimmick: { trapper: zeroStats(), escape: zeroStats() },
    },
    streak: {},
    inventory: { hammer: 0, double: 0 },
    seenIntro: [],
  };
}

function clampInt(n, min, max) {
  n = Math.floor(Number(n));
  if (!Number.isFinite(n)) return min;
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

/**
 * Rebuild a progress object from arbitrary parsed data; anything malformed
 * falls back to the defaults (per field).
 * @param {unknown} p
 * @returns {Progress}
 */
function sanitize(p) {
  const out = defaultProgress();
  if (!p || typeof p !== 'object' || p.version !== 1) return out;
  const raw = /** @type {any} */ (p);

  if (raw.level && typeof raw.level === 'object') {
    for (const rules of /** @type {RulesKind[]} */ (['basic', 'gimmick'])) {
      const src = raw.level[rules];
      if (!src || typeof src !== 'object') continue;
      for (const course of /** @type {Role[]} */ (['trapper', 'escape'])) {
        const arr = src[course];
        if (!Array.isArray(arr)) continue;
        out.level[rules][course] = arr
          .slice(0, LEVEL_COUNT)
          .map((n) => clampInt(n, 0, WIN_TARGET));
        while (out.level[rules][course].length < LEVEL_COUNT) {
          out.level[rules][course].push(0);
        }
      }
    }
  }

  // 14.6 per-difficulty level stats, 16.3 per-block-count buckets:
  // old saves without `stats` stay empty, pre-16.3 cells migrate
  if (raw.stats && typeof raw.stats === 'object') {
    for (const rules of /** @type {RulesKind[]} */ (['basic', 'gimmick'])) {
      const src = raw.stats[rules];
      if (!src || typeof src !== 'object') continue;
      for (const course of /** @type {Role[]} */ (['trapper', 'escape'])) {
        const arr = src[course];
        if (!Array.isArray(arr)) continue;
        for (let i = 0; i < LEVEL_COUNT; i++) {
          const row = arr[i];
          if (!row || typeof row !== 'object') continue;
          for (const d of STAT_DIFFS) {
            out.stats[rules][course][i][d] = normalizeStatCell(row[d], course, i, d, rules);
          }
        }
      }
    }
  }

  if (raw.streak && typeof raw.streak === 'object') {
    for (const [key, v] of Object.entries(raw.streak)) {
      // 16.3: `@n` marks a streak played away from the center count
      if (!/^(basic|gimmick)\.(trapper|escape)\.(easy|normal|hard)(@\d+)?$/.test(key)) continue;
      if (!v || typeof v !== 'object') continue;
      out.streak[key] = {
        current: clampInt(/** @type {any} */ (v).current, 0, 1e6),
        best: clampInt(/** @type {any} */ (v).best, 0, 1e6),
      };
    }
  }

  if (raw.inventory && typeof raw.inventory === 'object') {
    out.inventory.hammer = clampInt(raw.inventory.hammer, 0, ITEM_CAP);
    out.inventory.double = clampInt(raw.inventory.double, 0, ITEM_CAP);
  }

  if (Array.isArray(raw.seenIntro)) {
    const seen = new Set();
    for (const v of raw.seenIntro) {
      if (typeof v === 'string' && v && !seen.has(v)) seen.add(v);
      if (seen.size >= 64) break;
    }
    out.seenIntro = [...seen];
  }
  return out;
}

/**
 * Read the progress; a missing or bad value yields the defaults.
 * @param {Storage} storage
 * @returns {Progress}
 */
export function loadProgress(storage) {
  try {
    const raw = storage.getItem(PROGRESS_KEY);
    if (raw == null) return defaultProgress();
    return sanitize(JSON.parse(raw));
  } catch {
    return defaultProgress();
  }
}

/**
 * Write the progress (failures are swallowed, like localStorage quota).
 * @param {Storage} storage
 * @param {Progress} p
 */
export function saveProgress(storage, p) {
  try {
    storage.setItem(PROGRESS_KEY, JSON.stringify(p));
  } catch {
    /* ignore */
  }
}

/**
 * Reset to the defaults and persist them.
 * @param {Storage} storage
 * @returns {Progress}
 */
export function resetProgress(storage) {
  const p = defaultProgress();
  saveProgress(storage, p);
  return p;
}

/**
 * Level 1 is always open; level n+1 opens when `wins[n] >= 3`.
 * Progress is tracked separately for basic and gimmick rules.
 * @param {Progress} p
 * @param {RulesKind} rules
 * @param {Role} course
 * @param {number} level 1-based
 * @returns {boolean}
 */
export function isUnlocked(p, rules, course, level) {
  if (level <= 1) return true;
  const wins = p.level && p.level[rules] && p.level[rules][course];
  if (!Array.isArray(wins)) return level <= 1;
  const prev = wins[level - 2];
  return typeof prev === 'number' && prev >= WIN_TARGET;
}

/** Deep-enough copy of a progress object (all leaves are plain data). */
function cloneProgress(p) {
  const src = p && p.version === 1 ? p : defaultProgress();
  const out = defaultProgress();
  for (const rules of /** @type {RulesKind[]} */ (['basic', 'gimmick'])) {
    for (const course of /** @type {Role[]} */ (['trapper', 'escape'])) {
      const arr = src.level && src.level[rules] && src.level[rules][course];
      if (Array.isArray(arr)) {
        out.level[rules][course] = arr.slice(0, LEVEL_COUNT).map((n) => clampInt(n, 0, WIN_TARGET));
      }
      const st = src.stats && src.stats[rules] && src.stats[rules][course];
      if (Array.isArray(st)) {
        for (let i = 0; i < LEVEL_COUNT; i++) {
          const row = st[i];
          if (!row || typeof row !== 'object') continue;
          for (const d of STAT_DIFFS) {
            out.stats[rules][course][i][d] = normalizeStatCell(row[d], course, i, d, rules);
          }
        }
      }
    }
  }
  if (src.streak && typeof src.streak === 'object') {
    for (const [key, v] of Object.entries(src.streak)) {
      if (v && typeof v === 'object') {
        out.streak[key] = {
          current: clampInt(v.current, 0, 1e6),
          best: clampInt(v.best, 0, 1e6),
        };
      }
    }
  }
  if (src.inventory && typeof src.inventory === 'object') {
    out.inventory.hammer = clampInt(src.inventory.hammer, 0, ITEM_CAP);
    out.inventory.double = clampInt(src.inventory.double, 0, ITEM_CAP);
  }
  if (Array.isArray(src.seenIntro)) {
    const seen = new Set();
    for (const v of src.seenIntro) {
      if (typeof v === 'string' && v && !seen.has(v)) seen.add(v);
      if (seen.size >= 64) break;
    }
    out.seenIntro = [...seen];
  }
  return out;
}

/**
 * Pull the plain `{hammer, double}` counts out of either the full
 * `state.items` shape or a plain object.
 * @param {RecordCtx['items']} items
 */
function readItems(items) {
  if (!items) return null;
  if (items.trapper && items.cat) {
    return {
      hammer: Number(items.cat.hammer) || 0,
      double: Number(items.trapper.double) || 0,
    };
  }
  return {
    hammer: Number(/** @type {any} */ (items).hammer) || 0,
    double: Number(/** @type {any} */ (items).double) || 0,
  };
}

/**
 * Record a finished game. Pure: `p` is never mutated.
 * - **level play**: a win with `wins < 3` increments the level's win count;
 *   the item reward applies exactly when that increment happened;
 *   `stats[rules][course][level][difficulty][blocks]` counts every finished
 *   game per **block count** (`played`/`won`, no cap, 14.6 + 16.3) — the
 *   chart aggregates the buckets, the unlocks count every count alike
 * - **streak play**: a win does `current += 1`, `best = max(best, current)`;
 *   a loss resets `current` to 0; the key carries `@n` when the game was
 *   played away from the center block count (16.3)
 * - **streak play**: a win does `current += 1`, `best = max(best, current)`;
 *   a loss resets `current` to 0
 * - **inventory** (gimmick rules only, either play style): the player's side
 *   of `state.items` is written back win or lose (capped at 9), and a win
 *   adds +1 to the role's item (escape → hammer, trapper → double), also
 *   capped at 9
 * - basic rules never read or write the inventory
 * @param {Progress} p
 * @param {RecordCtx} ctx
 * @param {'catWin'|'trapperWin'} result
 * @returns {{ progress:Progress, rewards:{hammer:number, double:number},
 *             unlockedNext:boolean,
 *             streak:{current:number, best:number}|null }}
 */
export function recordResult(p, ctx, result) {
  const rules = ctx.rules === 'gimmick' ? 'gimmick' : 'basic';
  const play = ctx.play === 'level' ? 'level' : 'streak';
  const role = ctx.role === 'escape' ? 'escape' : 'trapper';
  const difficulty =
    ctx.difficulty === 'easy' || ctx.difficulty === 'hard' ? ctx.difficulty : 'normal';
  const level = clampInt(ctx.level, 1, LEVEL_COUNT);
  const course = ctx.course === 'trapper' || ctx.course === 'escape' ? ctx.course : role;
  const playerWon = role === 'escape' ? result === 'catWin' : result === 'trapperWin';

  const progress = cloneProgress(p);
  const rewards = { hammer: 0, double: 0 };
  let streak = null;
  let unlockedNext = false;
  let countedWin = false;

  if (play === 'level') {
    const wins = progress.level[rules][course];
    const idx = level - 1;
    if (playerWon && wins[idx] < WIN_TARGET) {
      wins[idx] += 1;
      countedWin = true;
    }
    unlockedNext = level < LEVEL_COUNT && wins[idx] >= WIN_TARGET;
    // 16.3: per-difficulty **and per-block-count** play statistics
    const cell = progress.stats[rules][course][idx][difficulty];
    const key = statBlockKey(ctx, course, level, difficulty);
    const stat = cell[key] || (cell[key] = { played: 0, won: 0 });
    stat.played += 1;
    if (playerWon) stat.won += 1;
  } else {
    // 16.3: `@n` when the count is not the difficulty's center
    const center = streakRange(role, difficulty).center;
    const blocks = Number(ctx.blocks);
    const at = Number.isFinite(blocks) && Math.floor(blocks) !== center ? `@${Math.floor(blocks)}` : '';
    const key = `${rules}.${role}.${difficulty}${at}`;
    const cur = { ...(progress.streak[key] || { current: 0, best: 0 }) };
    if (playerWon) {
      cur.current += 1;
      cur.best = Math.max(cur.best, cur.current);
    } else {
      cur.current = 0;
    }
    progress.streak[key] = cur;
    streak = { current: cur.current, best: cur.best };
  }

  if (rules === 'gimmick') {
    const items = readItems(ctx.items);
    if (items) {
      // write the player's side back, win or lose
      if (role === 'escape') progress.inventory.hammer = clampInt(items.hammer, 0, ITEM_CAP);
      else progress.inventory.double = clampInt(items.double, 0, ITEM_CAP);
    }
    if (playerWon) {
      const everyThird = play === 'streak' && streak.current % 3 === 0;
      const stillGrinding = play === 'level' && countedWin;
      if (everyThird || stillGrinding) {
        const which = role === 'escape' ? 'hammer' : 'double';
        const before = progress.inventory[which];
        progress.inventory[which] = clampInt(before + 1, 0, ITEM_CAP);
        rewards[which] = progress.inventory[which] - before;
      }
    }
  }

  return { progress, rewards, unlockedNext, streak };
}

/**
 * The highest unlocked level of a course (1..LEVEL_COUNT): the largest `n`
 * with `isUnlocked(p, rules, course, n)`. Levels unlock consecutively, so
 * this walks the win chain from level 1.
 * @param {Progress} p
 * @param {RulesKind} rules
 * @param {Role} course
 * @returns {number}
 */
export function highestUnlocked(p, rules, course) {
  const wins = p && p.level && p.level[rules] && p.level[rules][course];
  if (!Array.isArray(wins)) return 1;
  let n = 1;
  while (n < LEVEL_COUNT && typeof wins[n - 1] === 'number' && wins[n - 1] >= WIN_TARGET) {
    n++;
  }
  return n;
}

/**
 * Has the gimmick intro card `id` been seen already?
 * @param {Progress} p
 * @param {string} id
 * @returns {boolean}
 */
export function hasSeenIntro(p, id) {
  return !!(p && Array.isArray(p.seenIntro) && p.seenIntro.includes(id));
}

/**
 * Record an intro card as seen. Pure: `p` is never mutated.
 * @param {Progress} p
 * @param {string} id
 * @returns {Progress}
 */
export function recordIntroSeen(p, id) {
  const progress = cloneProgress(p);
  if (typeof id === 'string' && id && !progress.seenIntro.includes(id)) {
    if (progress.seenIntro.length < 64) progress.seenIntro.push(id);
  }
  return progress;
}
