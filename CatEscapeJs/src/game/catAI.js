/**
 * Cat AI. A pure function of (state, rng); never modifies `state`.
 * Pure logic — no Babylon.js, no DOM.
 */
import { legalCatMoves } from './rules.js';
import { cloneBoard, distanceMap, emptyNeighbors, reachableArea } from './board.js';
import { isBorder } from './hex.js';
import { alphaBeta } from './search.js';

const HARD_K = 10;

/**
 * @param {number[]} moves
 * @param {(m:number) => number} key lower is better
 * @param {() => number} rng tie-breaker
 * @returns {number}
 */
function argMin(moves, key, rng) {
  let bestVal = Infinity;
  let best = [];
  for (const m of moves) {
    const v = key(m);
    if (v < bestVal) {
      bestVal = v;
      best = [m];
    } else if (v === bestVal) {
      best.push(m);
    }
  }
  return best[Math.floor(rng() * best.length)];
}

/**
 * The move with the largest reachableArea after moving (enclosed cat:
 * survive as long as possible). Rev. 2: the area is measured with the cat's
 * OLD cell treated as blocked, so stepping into a dead-end pocket scores
 * lower than staying in the big region. Ties are broken by more
 * emptyNeighbors of the destination, then at random.
 * @param {import('./rules.js').GameState} state
 * @param {number[]} moves
 * @param {() => number} rng
 * @returns {number}
 */
function bestAreaMove(state, moves, rng) {
  const oldCat = state.board.cat;
  let bestArea = -Infinity;
  let bestNeighbors = -Infinity;
  let best = [];
  for (const m of moves) {
    const nb = cloneBoard(state.board);
    nb.blocked[oldCat] = 1;
    nb.cat = m;
    const area = reachableArea(nb);
    const nCount = emptyNeighbors(nb, m).length;
    if (area > bestArea) {
      bestArea = area;
      bestNeighbors = nCount;
      best = [m];
    } else if (area === bestArea) {
      if (nCount > bestNeighbors) {
        bestNeighbors = nCount;
        best = [m];
      } else if (nCount === bestNeighbors) {
        best.push(m);
      }
    }
  }
  return best[Math.floor(rng() * best.length)];
}

/**
 * Choose the cat's next move.
 * - an edge move is taken immediately
 * - if the cat is already enclosed (dist == -1): largest reachableArea with
 *   the old cell blocked, then more emptyNeighbors, then random (every level)
 * - easy: 30% random, otherwise smallest dist (ties random)
 * - normal: smallest dist, then largest paths, then random
 * - hard: alpha-beta, 4 plies, `evalForCat`
 * @param {import('./rules.js').GameState} state
 * @param {() => number} rng
 * @returns {number} cell index, or -1 when the cat has no move
 */
export function chooseCatMove(state, rng) {
  const board = state.board;
  const moves = legalCatMoves(state);
  if (moves.length === 0) return -1;

  for (const m of moves) {
    if (isBorder(m, board.W, board.H)) return m;
  }

  const d = distanceMap(board);
  if (d.dist[board.cat] === -1) return bestAreaMove(state, moves, rng);

  switch (state.difficulty) {
    case 'easy': {
      if (rng() < 0.3) return moves[Math.floor(rng() * moves.length)];
      return argMin(moves, (m) => d.dist[m], rng);
    }
    case 'normal': {
      let bestDist = Infinity;
      let bestPaths = -Infinity;
      let best = [];
      for (const m of moves) {
        const dist = d.dist[m];
        const paths = d.paths[m];
        if (dist < bestDist) {
          bestDist = dist;
          bestPaths = paths;
          best = [m];
        } else if (dist === bestDist) {
          if (paths > bestPaths) {
            bestPaths = paths;
            best = [m];
          } else if (paths === bestPaths) {
            best.push(m);
          }
        }
      }
      return best[Math.floor(rng() * best.length)];
    }
    case 'hard': {
      const { move } = alphaBeta(board, 4, -Infinity, Infinity, 'cat', HARD_K);
      return move === null ? moves[0] : move;
    }
    default:
      return moves[Math.floor(rng() * moves.length)];
  }
}
