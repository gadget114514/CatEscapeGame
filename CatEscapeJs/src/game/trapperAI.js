/**
 * Trapper AI. A pure function of (state, rng); never modifies `state`.
 * Pure logic — no Babylon.js, no DOM.
 */
import {
  cloneBoard,
  distanceMap,
  catDistanceMap,
  emptyNeighbors,
  reachableArea,
  isEmpty,
} from './board.js';
import { alphaBeta } from './search.js';
import { trapperCandidates } from './candidates.js';

// candidate generation lives in candidates.js (search.js needs it too);
// re-exported here so callers can import it from the AI module.
export { trapperCandidates };

const NORMAL_K = 12;
const HARD_K = 10;

/**
 * Normal scoring: simulate each block and score it as (newDist, -newPaths),
 * higher is better; newDist = -1 counts as +∞. Ties broken at random.
 * @param {import('./board.js').Board} board
 * @param {number[]} candidates
 * @param {() => number} rng
 * @returns {number}
 */
function normalChoice(board, candidates, rng) {
  let bestKey = null;
  let best = [];
  for (const m of candidates) {
    const nb = cloneBoard(board);
    nb.blocked[m] = 1;
    const dm = distanceMap(nb);
    const nd = dm.dist[nb.cat];
    const np = dm.paths[nb.cat];
    const p = nd === -1 ? Infinity : nd;
    const s = -np;
    if (bestKey === null || p > bestKey[0] || (p === bestKey[0] && s > bestKey[1])) {
      bestKey = [p, s];
      best = [m];
    } else if (p === bestKey[0] && s === bestKey[1]) {
      best.push(m);
    }
  }
  return best[Math.floor(rng() * best.length)];
}

/**
 * Enclosed cat: among the cat's empty neighbors pick the one that minimizes
 * the cat's reachableArea after blocking (shared by every level).
 * @param {import('./rules.js').GameState} state
 * @param {() => number} rng
 * @returns {number}
 */
function enclosedChoice(state, rng) {
  const nbrs = emptyNeighbors(state.board, state.board.cat);
  if (nbrs.length === 0) return -1;
  let bestArea = Infinity;
  let best = [];
  for (const m of nbrs) {
    const nb = cloneBoard(state.board);
    nb.blocked[m] = 1;
    const area = reachableArea(nb);
    if (area < bestArea) {
      bestArea = area;
      best = [m];
    } else if (area === bestArea) {
      best.push(m);
    }
  }
  return best[Math.floor(rng() * best.length)];
}

/**
 * Choose the trapper's next block.
 * - cat already enclosed → minimize the cat's reachableArea (every level)
 * - easy: 50% a random empty cell within distance 3 of the cat, otherwise Normal
 * - normal: score candidates as (newDist, -newPaths), ties random
 * - hard: alpha-beta, 4 plies, candidates K=10
 * @param {import('./rules.js').GameState} state
 * @param {() => number} rng
 * @returns {number} cell index, or -1 when there is nothing to block
 */
export function chooseBlock(state, rng) {
  const board = state.board;
  const d = distanceMap(board);
  const D = d.dist[board.cat];

  if (D === -1) return enclosedChoice(state, rng);

  const K = state.difficulty === 'hard' ? HARD_K : NORMAL_K;
  const candidates = trapperCandidates(board, K);
  if (candidates.length === 0) return -1;

  switch (state.difficulty) {
    case 'easy': {
      if (rng() < 0.5) {
        const g = catDistanceMap(board);
        const near = [];
        for (let i = 0; i < board.W * board.H; i++) {
          if (isEmpty(board, i) && g[i] !== -1 && g[i] <= 3) near.push(i);
        }
        if (near.length > 0) return near[Math.floor(rng() * near.length)];
      }
      return normalChoice(board, candidates, rng);
    }
    case 'normal': {
      return normalChoice(board, candidates, rng);
    }
    case 'hard': {
      const { move } = alphaBeta(board, 4, -Infinity, Infinity, 'trapper', HARD_K);
      if (move !== null && candidates.includes(move)) return move;
      return candidates[0];
    }
    default:
      return candidates[0];
  }
}
