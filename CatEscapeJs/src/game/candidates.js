/**
 * Trapper candidate generation, shared by the search and the trapper AI.
 * Lives in its own module so `search.js` does not have to import `trapperAI.js`
 * (which imports `alphaBeta` from `search.js`) — no circular import.
 */
import { distanceMap, catDistanceMap, emptyNeighbors, isEmpty } from './board.js';

/**
 * Cells worth blocking, sorted by ascending distance to the cat, then by
 * descending number of shortest escape routes; the top `K` are kept.
 * 1. `d = distanceMap`, `g = catDistanceMap`, `D = d.dist[cat]`
 * 2. empty cells with `g[v] + d.dist[v] == D`, plus the cat's empty neighbors
 * 3. sorted and truncated to K (K=12 normally, K=10 for Hard search)
 * 4. cat already enclosed (`D == -1`) → the cat's empty neighbors
 * @param {import('./board.js').Board} board
 * @param {number} [K=12]
 * @returns {number[]}
 */
export function trapperCandidates(board, K = 12) {
  const d = distanceMap(board);
  const g = catDistanceMap(board);
  const D = d.dist[board.cat];
  const catNbrs = emptyNeighbors(board, board.cat);
  if (D === -1) return catNbrs;

  const seen = new Set();
  const list = [];
  for (let v = 0; v < board.W * board.H; v++) {
    if (!isEmpty(board, v)) continue;
    const gv = g[v];
    const dv = d.dist[v];
    if (gv < 0 || dv < 0) continue;
    if (gv + dv !== D) continue;
    if (seen.has(v)) continue;
    seen.add(v);
    list.push(v);
  }
  for (const v of catNbrs) {
    if (!seen.has(v)) {
      seen.add(v);
      list.push(v);
    }
  }
  list.sort((a, b) => g[a] - g[b] || d.paths[b] - d.paths[a]);
  return typeof K === 'number' && K >= 0 ? list.slice(0, K) : list;
}
