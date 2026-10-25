/**
 * Gimmick registry (spec 13.1): lists the kind modules in unlock order and
 * composes the per-cell hooks into whole-board helpers.
 * Pure logic — no Babylon.js, no DOM.
 */
import { isEmpty } from '../board.js';
import stone, { KIND as KIND_STONE } from './kinds/stone.js';
import tunnel, { KIND as KIND_TUNNEL } from './kinds/tunnel.js';
import ice, { KIND as KIND_ICE } from './kinds/ice.js';
import fish, { KIND as KIND_FISH } from './kinds/fish.js';
import arrow, { KIND as KIND_ARROW } from './kinds/arrow.js';
import brittle, { KIND as KIND_BRITTLE } from './kinds/brittle.js';
import spring, { KIND as KIND_SPRING } from './kinds/spring.js';
import item, { KIND as KIND_ITEM } from './kinds/item.js';

export const CELL_NORMAL = 0;
export {
  KIND_ITEM,
  KIND_STONE,
  KIND_TUNNEL,
  KIND_ICE,
  KIND_FISH,
  KIND_ARROW,
  KIND_BRITTLE,
  KIND_SPRING,
};
/** Back-compat aliases (item/stone numbering unchanged from the old `cells`). */
export const CELL_ITEM = KIND_ITEM;
export const CELL_STONE = KIND_STONE;
export const CELL_FISH = KIND_FISH;

/**
 * The kind modules in unlock order (14.2, dried fish inserted at its 14.5
 * unlock) — `place` runs in this sequence.
 * @type {Array<{id:string, kind:number, unlock:number,
 *               place?(state:any, count:number, rng:()=>number):boolean,
 *               blockable?(state:any, i:number):boolean,
 *               canEnter?(state:any, from:number, to:number, dir:number):boolean,
 *               resolve?(state:any, from:number, to:number, dir:number):number,
 *               traversed?(state:any, from:number, to:number, dir:number):number[],
 *               onLand?(state:any, i:number, events:any[]):void,
 *               afterBlock?(state:any, i:number):void,
 *               onTrapperTurnEnd?(state:any, events:any[]):void}>}
 */
export const KINDS = [stone, tunnel, ice, fish, arrow, brittle, spring, item];

/** Module lookup by cell kind. */
export const BY_KIND = [];
for (const m of KINDS) BY_KIND[m.kind] = m;

/**
 * First level (both courses) where each gimmick appears (14.2; dried fish
 * from 14.5 — L9 in the escape course, L15 in the trapper course).
 * `double` and `hammer` are carried items, not cells, but share the table.
 */
export const UNLOCKS = {
  stone: 2,
  double: 4,
  tunnel: 6,
  ice: 8,
  fish: 9,
  arrow: 10,
  brittle: 12,
  spring: 14,
  item: 16,
  hammer: 16,
};

/**
 * Fresh per-cell gimmick data (spec 13.1). `ttl` is copied in clones
 * because it changes; the rest is shared by reference.
 * @param {number} n cell count
 */
export function createG(n) {
  return {
    kind: new Uint8Array(n),
    partner: new Int16Array(n).fill(-1),
    dir: new Int8Array(n).fill(-1),
    ttl: new Int16Array(n),
  };
}

/**
 * Is `cell` occupied by a cat other than the one moving (spec 13.7)? Cats
 * block each other exactly like blocks: their cells are never enterable,
 * and tunnel exits / spring landings / ice slides stop before them.
 * `state.selectedCat` is the index (into `state.cats`) of the moving cat;
 * states without `state.cats` (single-cat legacy nodes) never block.
 * @param {{cats?:number[], selectedCat?:number}} state
 * @param {number} cell
 * @returns {boolean}
 */
export function catInWay(state, cell) {
  const cats = state.cats;
  if (!cats || cats.length < 2) return false;
  const sel = state.selectedCat || 0;
  for (let j = 0; j < cats.length; j++) {
    if (j !== sel && cats[j] === cell) return true;
  }
  return false;
}

/**
 * Can the trapper block cell `i`? Not blocked, not any cat's cell, and
 * every module allows it (default true; item/stone/tunnel/arrow/spring
 * say false).
 * @param {{board:import('../board.js').Board, g:{kind:Uint8Array}, cats?:number[]}} state
 * @param {number} i
 * @returns {boolean}
 */
export function isBlockable(state, i) {
  if (!isEmpty(state.board, i)) return false;
  if (state.cats && state.cats.length > 1) {
    for (const c of state.cats) if (c === i) return false;
  }
  const m = BY_KIND[state.g.kind[i]];
  return m && m.blockable ? m.blockable(state, i) !== false : true;
}

/**
 * May the cat move from `from` to the neighbor `to` in direction `dir`?
 * Every module must allow it (default true).
 * @param {any} state
 * @param {number} from
 * @param {number} to
 * @param {number} dir
 * @returns {boolean}
 */
export function canEnter(state, from, to, dir) {
  for (const m of KINDS) {
    if (m.canEnter && m.canEnter(state, from, to, dir) === false) return false;
  }
  return true;
}

/**
 * The cell the cat rests on after entering `to` from `from` in direction
 * `dir`. Exactly one `resolve` runs — the module that owns cell `to` — so
 * chains and loops are impossible; the default landing is `to` itself.
 * @param {any} state
 * @param {number} from
 * @param {number} to
 * @param {number} dir
 * @returns {number}
 */
export function landing(state, from, to, dir) {
  const m = BY_KIND[state.g.kind[to]];
  if (m && m.resolve) {
    const r = m.resolve(state, from, to, dir);
    if (typeof r === 'number' && r >= 0) return r;
  }
  return to;
}

/**
 * After the cat lands on cell `i` (pickups etc.).
 * @param {any} state
 * @param {number} i
 * @param {any[]} events
 */
export function onLand(state, i, events) {
  const m = BY_KIND[state.g.kind[i]];
  if (m && m.onLand) m.onLand(state, i, events);
}

/**
 * After the trapper blocks cell `i` (brittle timers).
 * @param {any} state
 * @param {number} i
 */
export function afterBlock(state, i) {
  const m = BY_KIND[state.g.kind[i]];
  if (m && m.afterBlock) m.afterBlock(state, i);
}

/**
 * Timers when the trapper's turn ends (brittle crumbles).
 * @param {any} state
 * @param {any[]} events
 */
export function onTrapperTurnEnd(state, events) {
  for (const m of KINDS) {
    if (m.onTrapperTurnEnd) m.onTrapperTurnEnd(state, events);
  }
}
