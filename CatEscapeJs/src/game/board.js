/**
 * Board state: a 11×11 odd-r hex grid with blocked cells and the cat's position.
 * Pure logic — no Babylon.js, no DOM.
 */
import { toIndex, buildNeighborTable, isBorder } from './hex.js';

/**
 * @typedef {{ W:number, H:number, blocked:Uint8Array, cat:number,
 *             nbr:Int16Array[], border:Uint8Array }} Board
 */

/**
 * Empty board with the cat at the center.
 * @param {number} [W=11]
 * @param {number} [H=11]
 * @returns {Board}
 */
export function createBoard(W = 11, H = 11) {
  const nbr = buildNeighborTable(W, H);
  const border = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) border[i] = isBorder(i, W, H) ? 1 : 0;
  return {
    W,
    H,
    blocked: new Uint8Array(W * H),
    cat: toIndex(H >> 1, W >> 1, W),
    nbr,
    border,
  };
}

/**
 * Copies `blocked` and the cat position; nbr/border/W/H are shared.
 * @param {Board} b
 * @returns {Board}
 */
export function cloneBoard(b) {
  return { ...b, blocked: b.blocked.slice() };
}

/**
 * A cell is empty when it is not blocked and not the cat's cell.
 * @param {Board} b
 * @param {number} i
 * @returns {boolean}
 */
export function isEmpty(b, i) {
  return !b.blocked[i] && i !== b.cat;
}

/**
 * Empty neighbors of cell `i` (excludes blocked cells and the cat's cell).
 * @param {Board} b
 * @param {number} i
 * @returns {number[]}
 */
export function emptyNeighbors(b, i) {
  const out = [];
  for (const j of b.nbr[i]) {
    if (isEmpty(b, j)) out.push(j);
  }
  return out;
}

/**
 * Multi-source BFS from every empty edge cell (the cat's cell counts as empty).
 * `dist` = shortest number of moves to any edge cell, -1 for blocked/unreachable.
 * `paths` = number of shortest routes to the edge (edge cells = 1, else the sum
 * of `paths[u]` over neighbors u with `dist[u] == dist[v]-1`); 0 when unreachable.
 * @param {Board} b
 * @returns {{dist: Int16Array, paths: Float64Array}}
 */
export function distanceMap(b) {
  const n = b.W * b.H;
  const dist = new Int16Array(n).fill(-1);
  const paths = new Float64Array(n);
  const queue = [];
  for (let i = 0; i < n; i++) {
    if (b.border[i] && !b.blocked[i]) {
      dist[i] = 0;
      paths[i] = 1;
      queue.push(i);
    }
  }
  for (let head = 0; head < queue.length; head++) {
    const v = queue[head];
    for (const u of b.nbr[v]) {
      if (b.blocked[u]) continue;
      if (dist[u] === -1) {
        dist[u] = dist[v] + 1;
        queue.push(u);
      }
    }
  }
  // BFS order guarantees every predecessor of v was dequeued before v.
  for (const v of queue) {
    if (dist[v] === 0) continue;
    let p = 0;
    for (const u of b.nbr[v]) {
      if (dist[u] === dist[v] - 1) p += paths[u];
    }
    paths[v] = p;
  }
  return { dist, paths };
}

/**
 * BFS distances from the cat through empty (non-blocked) cells.
 * @param {Board} b
 * @returns {Int16Array} -1 for blocked/unreachable cells
 */
export function catDistanceMap(b) {
  const n = b.W * b.H;
  const dist = new Int16Array(n).fill(-1);
  dist[b.cat] = 0;
  const queue = [b.cat];
  for (let head = 0; head < queue.length; head++) {
    const v = queue[head];
    for (const u of b.nbr[v]) {
      if (b.blocked[u]) continue;
      if (dist[u] === -1) {
        dist[u] = dist[v] + 1;
        queue.push(u);
      }
    }
  }
  return dist;
}

/**
 * Number of cells the cat can reach (flood fill from the cat through
 * non-blocked cells). The cat's own cell counts as 1.
 * @param {Board} b
 * @returns {number}
 */
export function reachableArea(b) {
  const n = b.W * b.H;
  const seen = new Uint8Array(n);
  const stack = [b.cat];
  seen[b.cat] = 1;
  let count = 1;
  while (stack.length > 0) {
    const v = stack.pop();
    for (const u of b.nbr[v]) {
      if (!seen[u] && !b.blocked[u]) {
        seen[u] = 1;
        count++;
        stack.push(u);
      }
    }
  }
  return count;
}

/**
 * The cat's shortest route to the edge (used by the "Show path hint" feature).
 * Walks the distance map greedily; the first shortest neighbor is taken, so
 * the result is deterministic.
 * @param {Board} b
 * @returns {number[]|null} cells from the cat to an edge cell, or null when
 *                          the cat is enclosed (dist[cat] == -1)
 */
export function shortestPathToEdge(b) {
  const { dist } = distanceMap(b);
  if (dist[b.cat] === -1) return null;
  const path = [b.cat];
  let cur = b.cat;
  while (dist[cur] > 0) {
    let next = -1;
    for (const u of b.nbr[cur]) {
      if (!b.blocked[u] && dist[u] === dist[cur] - 1) {
        next = u;
        break;
      }
    }
    if (next === -1) return null; // defensive: dist said a route exists
    path.push(next);
    cur = next;
  }
  return path;
}
