/**
 * Arrow cells (spec 13.3): the cat can enter only while moving in the
 * arrow's direction; leaving an arrow cell is free. Arrows are never on
 * edge cells, so the opposite neighbor is always on-board and the cell is
 * reachable. Not blockable. Unlocks at L12 (14.2).
 * Pure logic — no Babylon.js, no DOM.
 */
import { freeCells, shuffle } from './placeCommon.js';

export const KIND = 5;

export default {
  id: 'arrow',
  kind: KIND,
  unlock: 10,
  blockable: () => false,

  /**
   * @param {{board:import('../../board.js').Board, g:{kind:Uint8Array, dir:Int8Array}}} state
   * @param {number} count
   * @param {() => number} rng
   * @returns {boolean} false when there aren't enough free cells
   */
  place(state, count, rng) {
    if (count <= 0) return true;
    const free = shuffle(freeCells(state), rng);
    if (free.length < count) return false;
    for (let k = 0; k < count; k++) {
      const i = free[k];
      state.g.kind[i] = KIND;
      state.g.dir[i] = Math.floor(rng() * 6);
    }
    return true;
  },

  /**
   * Entering is allowed only while moving in the arrow's direction.
   * @param {{g:{kind:Uint8Array, dir:Int8Array}}} state
   * @param {number} _from
   * @param {number} to
   * @param {number} dir
   * @returns {boolean}
   */
  canEnter(state, _from, to, dir) {
    if (state.g.kind[to] !== KIND) return true;
    return state.g.dir[to] === dir;
  },
};
