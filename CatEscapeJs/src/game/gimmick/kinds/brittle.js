/**
 * Brittle cells (spec 13.3): a block placed on one gets `ttl = 3`. Each
 * time the trapper's turn ends the ttl goes down by 1; at 0 the block
 * crumbles (the cell is empty again and stays brittle). Blockable.
 * Unlocks at L14 (14.2).
 * Pure logic — no Babylon.js, no DOM.
 */
import { freeCells, shuffle } from './placeCommon.js';

export const KIND = 6;

/** Trapper turns a brittle block survives after it is placed. */
export const BRITTLE_TTL = 3;

export default {
  id: 'brittle',
  kind: KIND,
  unlock: 12,
  // blockable defaults to true

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
   * A block placed here counts down from 3 trapper turns.
   * @param {{board:import('../../board.js').Board, g:{kind:Uint8Array, ttl:Int16Array}}} state
   * @param {number} i
   */
  afterBlock(state, i) {
    if (state.g.kind[i] === KIND) state.g.ttl[i] = BRITTLE_TTL;
  },

  /**
   * The trapper's turn ended: tick every brittle block; at 0 it crumbles.
   * @param {{board:import('../../board.js').Board, g:{kind:Uint8Array, ttl:Int16Array}}} state
   * @param {Array<{type:string, cell:number}>} events
   */
  onTrapperTurnEnd(state, events) {
    const b = state.board;
    const g = state.g;
    for (let i = 0; i < g.kind.length; i++) {
      if (g.kind[i] !== KIND || !b.blocked[i] || g.ttl[i] <= 0) continue;
      g.ttl[i] -= 1;
      if (g.ttl[i] === 0) {
        b.blocked[i] = 0;
        events.push({ type: 'crumble', cell: i });
      }
    }
  },
};
