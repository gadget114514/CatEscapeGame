/**
 * Dried fish (にぼし) cells (spec 14.5, reworked by 18.4): like item cells
 * they can never be blocked, and when a cat lands on one the trapper's
 * **most recently placed block that touches no cat** crumbles (removed
 * with the crumble animation, `state.crumbles`); when there is no such
 * block nothing happens. Unlocks at L9 in the escape course, L15 in the
 * trapper course (14.5). Pure logic — no Babylon.js, no DOM.
 */
import { catDistanceMap } from '../../board.js';
import { freeCells, shuffle } from './placeCommon.js';

export const KIND = 8;

/**
 * The cat cells of a landing (post-move positions): every `state.cats`
 * entry, with the mover swapped onto the fish cell `i`.
 * @param {{cats?:number[], selectedCat?:number}} state
 * @param {number} i the fish cell the mover lands on
 * @returns {number[]}
 */
function catCells(state, i) {
  const cats = state.cats;
  if (!cats || cats.length === 0) return [i];
  const sel = state.selectedCat || 0;
  return cats.map((c, j) => (j === sel ? i : c));
}

/**
 * The trapper's most recently placed block that is not adjacent to any
 * cat (18.4): the last block entry of `state.history` that is still
 * standing and touches no cat. Returns -1 when there is none.
 * @param {{board:import('../../board.js').Board, history?:Array<{side:string, kind:string, index:number}>}} state
 * @param {number} i the fish cell the mover lands on
 * @returns {number}
 */
function latestSafeBlock(state, i) {
  const b = state.board;
  const near = new Uint8Array(b.W * b.H);
  for (const c of catCells(state, i)) {
    if (c < 0) continue;
    near[c] = 1;
    for (const j of b.nbr[c]) near[j] = 1;
  }
  const h = state.history;
  if (!h) return -1;
  for (let k = h.length - 1; k >= 0; k--) {
    const e = h[k];
    if (e.side !== 'trapper' || e.kind !== 'block') continue;
    if (!Number.isInteger(e.index) || !b.blocked[e.index]) continue; // gone already
    if (near[e.index]) continue; // adjacent to a cat
    return e.index;
  }
  return -1;
}

export default {
  id: 'fish',
  kind: KIND,
  unlock: 9,
  blockable: () => false,

  /**
   * Prefer inner cells at cat distance 2–4 (like item cells); fall back to
   * any free cell.
   * @param {{board:import('../../board.js').Board, g:{kind:Uint8Array}}} state
   * @param {number} count
   * @param {() => number} rng
   * @returns {boolean} false when there aren't enough free cells
   */
  place(state, count, rng) {
    if (count <= 0) return true;
    const g = catDistanceMap(state.board);
    const free = shuffle(freeCells(state), rng);
    if (free.length < count) return false;
    const preferred = free.filter((i) => g[i] >= 2 && g[i] <= 4);
    const rest = free.filter((i) => !(g[i] >= 2 && g[i] <= 4));
    const picked = [];
    for (const i of preferred) {
      if (picked.length >= count) break;
      picked.push(i);
    }
    for (const i of rest) {
      if (picked.length >= count) break;
      picked.push(i);
    }
    for (const i of picked) state.g.kind[i] = KIND;
    return true;
  },

  /**
   * The cat lands on the fish cell (18.4): the cell turns normal and the
   * trapper's most recently placed block that touches no cat crumbles —
   * a `crumble` event the caller records in `state.crumbles` for the
   * view. Nothing happens when there is no such block.
   * @param {{board:import('../../board.js').Board, g:{kind:Uint8Array},
   *          cats?:number[], selectedCat?:number,
   *          history?:Array<{side:string, kind:string, index:number}>}} state
   * @param {number} i
   * @param {Array<{type:string, cell:number}>} events
   */
  onLand(state, i, events) {
    if (state.g.kind[i] !== KIND) return;
    state.g.kind[i] = 0;
    const cell = latestSafeBlock(state, i);
    if (cell >= 0) {
      state.board.blocked[cell] = 0;
      events.push({ type: 'crumble', cell });
    }
    events.push({ type: 'fish', cell: i });
  },
};
