/**
 * Directional hex helpers for the gimmick rules (spec 13.1).
 * Odd-r offset coordinates like hex.js, but with explicit compass
 * directions: dir 0–5 = E, NE, NW, W, SW, SE. Pure math, no dependencies.
 */

export const DIR_E = 0;
export const DIR_NE = 1;
export const DIR_NW = 2;
export const DIR_W = 3;
export const DIR_SW = 4;
export const DIR_SE = 5;

/** Opposite direction: (dir + 3) % 6. */
export function opposite(dir) {
  return (dir + 3) % 6;
}

/**
 * Neighbor of `i` in direction `dir`, or -1 off the board.
 * @param {number} i cell index
 * @param {number} dir 0–5 = E, NE, NW, W, SW, SE
 * @param {number} W board width
 * @param {number} H board height
 * @returns {number}
 */
export function step(i, dir, W, H) {
  const r = (i / W) | 0;
  const c = i % W;
  const odd = r & 1;
  let nr = r;
  let nc = c;
  switch (dir) {
    case DIR_E:
      nc = c + 1;
      break;
    case DIR_NE:
      nr = r - 1;
      nc = odd ? c + 1 : c;
      break;
    case DIR_NW:
      nr = r - 1;
      nc = odd ? c : c - 1;
      break;
    case DIR_W:
      nc = c - 1;
      break;
    case DIR_SW:
      nr = r + 1;
      nc = odd ? c : c - 1;
      break;
    case DIR_SE:
      nr = r + 1;
      nc = odd ? c + 1 : c;
      break;
    default:
      return -1;
  }
  if (nr < 0 || nr >= H || nc < 0 || nc >= W) return -1;
  return nr * W + nc;
}

/**
 * Direction scan order that matches `board.nbr` (hex.js) exactly, so the
 * greedy shortest-path walk reproduces `board.js#shortestPathToEdge` on
 * plain boards: W, E, then the two rows above (NW, NE), then the two rows
 * below (SW, SE) — for both row parities.
 * @param {number} [_i] cell index (kept for signature stability)
 * @param {number} [_W] board width
 * @returns {number[]}
 */
export function dirOrder(_i, _W) {
  return [DIR_W, DIR_E, DIR_NW, DIR_NE, DIR_SW, DIR_SE];
}

/**
 * Hex distance between two cells (odd-r → cube coordinates).
 * @param {number} a cell index
 * @param {number} b cell index
 * @param {number} W board width
 * @returns {number}
 */
export function hexDistance(a, b, W) {
  const ra = (a / W) | 0;
  const ca = a % W;
  const rb = (b / W) | 0;
  const cb = b % W;
  const qa = ca - ((ra - (ra & 1)) >> 1);
  const qb = cb - ((rb - (rb & 1)) >> 1);
  const dq = qa - qb;
  const dr = ra - rb;
  const ds = -dq - dr;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(ds)) / 2;
}
