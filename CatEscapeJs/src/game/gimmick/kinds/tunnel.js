/**
 * Tunnel cells (spec 13.3): entering either end lands the cat on the
 * partner end in the same move; the cat rests on the exit. `count` is the
 * number of pairs. Not blockable. Unlocks at L6 (14.2).
 * Pure logic — no Babylon.js, no DOM.
 */
import { hexDistance } from '../hexDir.js';
import { catInWay } from '../registry.js';
import { freeCells, shuffle } from './placeCommon.js';

export const KIND = 3;

/** Tunnel ends must sit at hex distance ≥ 4 from each other. */
const MIN_PAIR_DIST = 4;

export default {
  id: 'tunnel',
  kind: KIND,
  unlock: 6,
  blockable: () => false,

  /**
   * Place `count` tunnel pairs on free inner cells.
   * @param {{board:import('../../board.js').Board, g:{kind:Uint8Array, partner:Int16Array}}} state
   * @param {number} count number of pairs
   * @param {() => number} rng
   * @returns {boolean} false when the pairs cannot be placed
   */
  place(state, count, rng) {
    if (count <= 0) return true;
    const W = state.board.W;
    let placed = 0;
    let attempts = 0;
    while (placed < count && attempts < 500) {
      attempts++;
      const free = freeCells(state);
      if (free.length < 2) return false;
      const shuffled = shuffle(free, rng);
      const a = shuffled[0];
      const partners = [];
      for (let k = 1; k < shuffled.length; k++) {
        if (hexDistance(a, shuffled[k], W) >= MIN_PAIR_DIST) partners.push(shuffled[k]);
      }
      if (partners.length === 0) continue;
      const b = partners[Math.floor(rng() * partners.length)];
      state.g.kind[a] = KIND;
      state.g.kind[b] = KIND;
      state.g.partner[a] = b;
      state.g.partner[b] = a;
      placed++;
    }
    return placed === count;
  },

  /**
   * Entering either end lands on the partner. When another cat sits on the
   * exit the tunnel cannot be used through it: the cat stays on the entry
   * end, exactly as it would stop before a block (spec 13.7).
   * @param {{g:{partner:Int16Array}}} state
   * @param {number} _from
   * @param {number} to
   * @param {number} _dir
   * @returns {number}
   */
  resolve(state, _from, to, _dir) {
    const p = state.g.partner[to];
    if (p >= 0 && !catInWay(state, p)) return p;
    return to;
  },
};
