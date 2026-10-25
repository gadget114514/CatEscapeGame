/**
 * Stone cells (spec 13.3): low grey no-build tiles. The trapper can never
 * block them. Unlocks at L2 (14.2).
 * Pure logic — no Babylon.js, no DOM.
 */
import { freeCells, shuffle } from './placeCommon.js';

export const KIND = 2;

export default {
  id: 'stone',
  kind: KIND,
  unlock: 2,
  blockable: () => false,

  /**
   * @param {{board:import('../../board.js').Board, g:{kind:Uint8Array}}} state
   * @param {number} count
   * @param {() => number} rng
   * @returns {boolean} false when there aren't enough free cells
   */
  place(state, count, rng) {
    if (count <= 0) return true;
    const free = shuffle(freeCells(state), rng);
    if (free.length < count) return false;
    for (let k = 0; k < count; k++) state.g.kind[free[k]] = KIND;
    return true;
  },
};
