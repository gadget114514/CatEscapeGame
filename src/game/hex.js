/**
 * Odd-r offset hex grid helpers (pointy-top, odd rows shifted half a cell right).
 * Pure math only — no Babylon.js, no DOM.
 */

/**
 * @param {number} r row
 * @param {number} c column
 * @param {number} W board width
 * @returns {number} cell index
 */
export function toIndex(r, c, W) {
  return r * W + c;
}

/**
 * @param {number} i cell index
 * @param {number} W board width
 * @returns {{r:number, c:number}}
 */
export function toRC(i, W) {
  return { r: Math.floor(i / W), c: i % W };
}

/**
 * @param {number} r row
 * @param {number} c column
 * @param {number} W board width
 * @param {number} H board height
 * @returns {boolean}
 */
export function inBounds(r, c, W, H) {
  return r >= 0 && r < H && c >= 0 && c < W;
}

// neighbor deltas in spec order: (r,c-1) (r,c+1) then the two rows above, then the two rows below
const EVEN_ROW = [
  [0, -1],
  [0, 1],
  [-1, -1],
  [-1, 0],
  [1, -1],
  [1, 0],
];
const ODD_ROW = [
  [0, -1],
  [0, 1],
  [-1, 0],
  [-1, 1],
  [1, 0],
  [1, 1],
];

/**
 * Precomputed neighbor table; out-of-board cells are excluded.
 * @param {number} W board width
 * @param {number} H board height
 * @returns {Int16Array[]} length W*H
 */
export function buildNeighborTable(W, H) {
  const table = new Array(W * H);
  for (let r = 0; r < H; r++) {
    const deltas = r & 1 ? ODD_ROW : EVEN_ROW;
    for (let c = 0; c < W; c++) {
      const list = [];
      for (const [dr, dc] of deltas) {
        const nr = r + dr;
        const nc = c + dc;
        if (inBounds(nr, nc, W, H)) list.push(toIndex(nr, nc, W));
      }
      table[toIndex(r, c, W)] = Int16Array.from(list);
    }
  }
  return table;
}

/**
 * @param {number} i cell index
 * @param {number} W board width
 * @param {number} H board height
 * @returns {boolean} true when the cell lies on the board edge
 */
export function isBorder(i, W, H) {
  const { r, c } = toRC(i, W);
  return r === 0 || r === H - 1 || c === 0 || c === W - 1;
}

/**
 * World-space center of a cell (pure math, no Babylon dependency).
 * x = (size*√3 + gap) * (c + 0.5*(r&1)) - offsetX
 * z = -(size*1.5 + gap*0.866) * r + offsetZ
 * offsetX/offsetZ center the board on the origin:
 *   offsetX = (size*√3 + gap) * (W - 0.5) / 2
 *   offsetZ = (size*1.5 + gap*0.866) * (H - 1) / 2
 * @param {number} r row
 * @param {number} c column
 * @param {number} size hex radius
 * @param {number} gap gap between cells
 * @param {number} [offsetX=0]
 * @param {number} [offsetZ=0]
 * @returns {{x:number, z:number}}
 */
export function cellCenter(r, c, size, gap, offsetX = 0, offsetZ = 0) {
  const x = (size * Math.sqrt(3) + gap) * (c + 0.5 * (r & 1)) - offsetX;
  const z = -(size * 1.5 + gap * 0.866) * r + offsetZ;
  return { x, z };
}
