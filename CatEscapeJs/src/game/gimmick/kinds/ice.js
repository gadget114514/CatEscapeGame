/**
 * Ice cells (spec 13.3): entering ice slides the cat on in the same `dir`.
 * It stops on the first non-ice cell, or on the last ice cell when the next
 * step is off-board, blocked or not enterable. An edge cell reached at any
 * point ends the slide there (cat wins). Ice is one connected patch and a
 * normal block target. Unlocks at L8 (14.2).
 * Pure logic — no Babylon.js, no DOM.
 */
import { step } from '../hexDir.js';
import { canEnter, catInWay } from '../registry.js';
import { freeCells, shuffle } from './placeCommon.js';

export const KIND = 4;

/**
 * The slide starting at the first ice cell `to`. It stops before another
 * cat exactly as it stops before a block (spec 13.7).
 * @param {{board:import('../../board.js').Board, g:{kind:Uint8Array}}} state
 * @param {number} to first ice cell (the entry)
 * @param {number} dir 0–5
 * @returns {{cells:number[], land:number}} every cell walked (incl. `to`)
 *                                         and the resting cell
 */
function slide(state, to, dir) {
  const b = state.board;
  const cells = [to];
  let cur = to;
  for (;;) {
    const n = step(cur, dir, b.W, b.H);
    if (n < 0 || b.blocked[n] || catInWay(state, n) || !canEnter(state, cur, n, dir)) {
      return { cells, land: cur };
    }
    cells.push(n);
    if (b.border[n] || state.g.kind[n] !== KIND) {
      return { cells, land: n };
    }
    cur = n;
  }
}

export default {
  id: 'ice',
  kind: KIND,
  unlock: 8,
  blockable: () => true, // a block on ice is a normal block

  /**
   * Grow one connected patch of `count` cells from a random seed.
   * @param {{board:import('../../board.js').Board, g:{kind:Uint8Array}}} state
   * @param {number} count
   * @param {() => number} rng
   * @returns {boolean} false when the patch cannot reach `count` cells
   */
  place(state, count, rng) {
    if (count <= 0) return true;
    const b = state.board;
    for (let tries = 0; tries < 50; tries++) {
      const free = new Set(freeCells(state));
      const seeds = shuffle([...free], rng);
      if (seeds.length < count) return false;
      const patch = [seeds[0]];
      free.delete(seeds[0]);
      const frontier = new Set();
      for (const nb of b.nbr[seeds[0]]) if (free.has(nb)) frontier.add(nb);
      while (patch.length < count && frontier.size > 0) {
        const f = [...frontier];
        const pick = f[Math.floor(rng() * f.length)];
        frontier.delete(pick);
        if (!free.has(pick)) continue;
        free.delete(pick);
        patch.push(pick);
        for (const nb of b.nbr[pick]) if (free.has(nb)) frontier.add(nb);
      }
      if (patch.length === count) {
        for (const i of patch) state.g.kind[i] = KIND;
        return true;
      }
    }
    return false;
  },

  /**
   * Entering the patch slides the cat to the stop cell.
   * @param {any} state
   * @param {number} _from
   * @param {number} to
   * @param {number} dir
   * @returns {number}
   */
  resolve(state, _from, to, dir) {
    return slide(state, to, dir).land;
  },

  /**
   * The intermediate cells of the slide (everything after the entry and
   * before the landing — the landing is added by the graph helper).
   * @param {any} state
   * @param {number} _from
   * @param {number} to
   * @param {number} dir
   * @returns {number[]}
   */
  traversed(state, _from, to, dir) {
    const { cells, land } = slide(state, to, dir);
    return cells.slice(1, cells.length - (land === to ? 0 : 1));
  },
};
