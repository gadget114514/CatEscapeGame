/**
 * Item ("?") cells (spec 13.3): landing on one gives the cat 1 hammer and
 * the cell becomes normal (12.3). Not blockable. Unlocks at L16 (14.2).
 * Pure logic — no Babylon.js, no DOM.
 */
import { catDistanceMap } from '../../board.js';
import { freeCells, shuffle } from './placeCommon.js';

export const KIND = 1;

/** Item count cap (12.4), re-used by the rules. */
export const ITEM_CAP = 9;

export default {
  id: 'item',
  kind: KIND,
  unlock: 16,
  blockable: () => false,

  /**
   * Prefer inner cells at cat distance 2–4; fall back to any free cell.
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
   * The cat lands on the item cell: +1 hammer, the cell turns normal.
   * @param {{items:{cat:{hammer:number}}, g:{kind:Uint8Array}}} state
   * @param {number} i
   * @param {Array<{type:string, cell:number}>} events
   */
  onLand(state, i, events) {
    if (state.g.kind[i] !== KIND) return;
    state.g.kind[i] = 0;
    const n = Math.floor(Number(state.items.cat.hammer) || 0) + 1;
    state.items.cat.hammer = n > ITEM_CAP ? ITEM_CAP : n;
    events.push({ type: 'pickup', cell: i });
  },
};
