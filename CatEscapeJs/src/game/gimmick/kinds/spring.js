/**
 * Spring cells (spec 13.3, nerf by Rev. 8/19.2): entering in `dir` jumps
 * the cat to `step(step(spring, dir), dir)` — two cells further on. Both
 * cells along `dir` must be free: the middle cell `step(spring, dir)` has
 * to be on-board, empty and not blocked, and the landing cell enterable.
 * When either fails, the cat stays on the spring. Springs are never on
 * edge cells and are not blockable. Unlocks at L14 (14.2).
 * Pure logic — no Babylon.js, no DOM.
 */
import { step } from '../hexDir.js';
import { canEnter, catInWay } from '../registry.js';
import { freeCells, shuffle } from './placeCommon.js';

export const KIND = 7;

export default {
  id: 'spring',
  kind: KIND,
  unlock: 14,
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

  /**
   * Jump two cells along the entry direction when **both** cells along
   * `dir` are free (19.2): the middle cell must be on-board, empty and not
   * blocked, and the landing cell enterable. A landing on another cat
   * refuses the jump exactly like a blocked landing: the cat stays on the
   * spring (spec 13.7).
   * @param {{board:import('../../board.js').Board, g:object}} state
   * @param {number} _from
   * @param {number} to the spring cell
   * @param {number} dir
   * @returns {number}
   */
  resolve(state, _from, to, dir) {
    const b = state.board;
    const mid = step(to, dir, b.W, b.H);
    if (mid < 0 || b.blocked[mid] || catInWay(state, mid)) return to;
    const land = step(mid, dir, b.W, b.H);
    if (land < 0 || b.blocked[land] || catInWay(state, land) || !canEnter(state, to, land, dir)) {
      return to;
    }
    return land;
  },
};
