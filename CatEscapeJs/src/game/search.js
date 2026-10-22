/**
 * Shared alpha-beta search and evaluation. Higher scores are better for the cat.
 * Pure logic — no Babylon.js, no DOM.
 */
import { cloneBoard, emptyNeighbors, distanceMap, reachableArea } from './board.js';
import { isBorder } from './hex.js';
import { trapperCandidates } from './candidates.js';

/**
 * Evaluation from the cat's point of view.
 * - cat on edge → +10000
 * - cat has no moves → -10000
 * - dist[cat] == -1 (enclosed) → -5000 + reachableArea*10
 * - otherwise → -100*dist + 15*min(paths,20) + 5*emptyNeighbors(cat).length
 * @param {import('./board.js').Board} board
 * @returns {number}
 */
export function evalForCat(board) {
  if (isBorder(board.cat, board.W, board.H)) return 10000;
  const moves = emptyNeighbors(board, board.cat);
  if (moves.length === 0) return -10000;
  const d = distanceMap(board);
  const dist = d.dist[board.cat];
  if (dist === -1) return -5000 + reachableArea(board) * 10;
  return -100 * dist + 15 * Math.min(d.paths[board.cat], 20) + 5 * moves.length;
}

/**
 * Negamax-style alpha-beta. Terminal positions and depth 0 return `evalForCat`,
 * with win scores biased by the remaining depth (`±(10000 + depth)`) so faster
 * wins are preferred.
 * Cat's turn maximizes over `emptyNeighbors(cat)`; trapper's turn minimizes
 * over `trapperCandidates(board, K)`. Move ordering: cat moves ascending dist,
 * trapper moves in candidate order.
 * @param {import('./board.js').Board} board
 * @param {number} depth
 * @param {number} alpha
 * @param {number} beta
 * @param {'cat'|'trapper'} sideToMove
 * @param {number} K candidate limit for the trapper
 * @returns {{score:number, move:number|null}}
 */
export function alphaBeta(board, depth, alpha, beta, sideToMove, K) {
  if (isBorder(board.cat, board.W, board.H)) return { score: 10000 + depth, move: null };
  const catMoves = emptyNeighbors(board, board.cat);
  if (catMoves.length === 0) return { score: -10000 - depth, move: null };
  if (depth === 0) return { score: evalForCat(board), move: null };

  if (sideToMove === 'cat') {
    const { dist } = distanceMap(board);
    const ordered = catMoves.slice().sort((a, b) => dist[a] - dist[b]);
    let best = -Infinity;
    let bestMove = ordered[0];
    for (const m of ordered) {
      const nb = cloneBoard(board);
      nb.cat = m;
      const { score } = alphaBeta(nb, depth - 1, alpha, beta, 'trapper', K);
      if (score > best) {
        best = score;
        bestMove = m;
      }
      if (best > alpha) alpha = best;
      if (alpha >= beta) break;
    }
    return { score: best, move: bestMove };
  }

  const ordered = trapperCandidates(board, K);
  if (ordered.length === 0) return { score: evalForCat(board), move: null };
  let best = Infinity;
  let bestMove = ordered[0];
  for (const m of ordered) {
    const nb = cloneBoard(board);
    nb.blocked[m] = 1;
    const { score } = alphaBeta(nb, depth - 1, alpha, beta, 'cat', K);
    if (score < best) {
      best = score;
      bestMove = m;
    }
    if (best < beta) beta = best;
    if (alpha >= beta) break;
  }
  return { score: best, move: bestMove };
}
