/**
 * Shared placement helpers for the gimmick kind modules (spec 13.1).
 * Cells go on free inner cells: not any cat, not blocks, not edges, never
 * adjacent to a cat's start, and not already claimed by another kind.
 */
import { isBorder } from '../../hex.js';

/**
 * Cells a kind may claim: inner, unblocked, not a cat, not adjacent to a
 * cat's start, still kind NORMAL.
 * @param {{board:import('../../board.js').Board, g:{kind:Uint8Array}, cats?:number[]}} state
 * @param {(i:number) => boolean} [extra] additional filter
 * @returns {number[]}
 */
export function freeCells(state, extra) {
  const b = state.board;
  const n = b.W * b.H;
  const cats = state.cats && state.cats.length > 0 ? state.cats : [b.cat];
  const nearCats = new Set();
  for (const c of cats) for (const nb of b.nbr[c]) nearCats.add(nb);
  const out = [];
  for (let i = 0; i < n; i++) {
    if (cats.includes(i)) continue;
    if (b.blocked[i]) continue;
    if (isBorder(i, b.W, b.H)) continue;
    if (nearCats.has(i)) continue;
    if (state.g.kind[i] !== 0) continue;
    if (extra && !extra(i)) continue;
    out.push(i);
  }
  return out;
}

/**
 * Fisher–Yates shuffle driven by the seeded rng.
 * @param {number[]} arr
 * @param {() => number} rng
 */
export function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
}
