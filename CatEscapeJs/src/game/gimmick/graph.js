/**
 * Gimmick-aware graph (spec 13.2, multi-cat 13.7). Moves from a cell `v`:
 * for each `dir` with `u = step(v, dir)`, the move is legal when `u` is on
 * the board, not blocked, not another cat's cell, and `canEnter(v, u, dir)`;
 * it lands on `landing(v, u, dir)`. Pure logic — no Babylon.js, no DOM.
 * With no gimmick cells and no `state.cats` every function returns exactly
 * what `board.js` returns.
 *
 * Every function takes an optional `catIndex` (default: the selected cat,
 * `state.selectedCat`): while one cat moves, the other cats count as
 * blocked, exactly like walls. `forCat` builds the per-cat state view.
 */
import { isBorder } from '../hex.js';
import { step, dirOrder } from './hexDir.js';
import { canEnter, landing, catInWay, BY_KIND } from './registry.js';

const CELL_NORMAL = 0;

/**
 * The state view for the cat at index `catIndex` (spec 13.7): a shallow
 * wrapper whose `selectedCat`/`board.cat` point at that cat, so the kinds
 * and helpers treat the other cats as blocked. Returns the same object
 * when the view already matches (the common single-cat and in-search
 * cases), so it stays allocation-free on hot paths.
 * @template {{board:import('../board.js').Board, cats?:number[], selectedCat?:number}} T
 * @param {T} state
 * @param {number} [catIndex]
 * @returns {T}
 */
export function forCat(state, catIndex) {
  const cats = state.cats;
  if (!cats || cats.length === 0) return state;
  if (cats.length === 1) {
    // single cat: board.cat is authoritative (fixtures may move it directly)
    if (cats[0] !== state.board.cat) cats[0] = state.board.cat;
    return state;
  }
  const idx = catIndex == null ? state.selectedCat || 0 : catIndex;
  if (idx === state.selectedCat && state.board.cat === cats[idx]) return state;
  return { ...state, selectedCat: idx, board: { ...state.board, cat: cats[idx] } };
}

/** Fast path: normal cells never restrict entry (avoids the module loop). */
function enterOk(state, from, to, dir) {
  return state.g.kind[to] === CELL_NORMAL ? true : canEnter(state, from, to, dir);
}

/** Fast path: normal cells land on themselves. */
function landOf(state, from, to, dir) {
  return state.g.kind[to] === CELL_NORMAL ? to : landing(state, from, to, dir);
}

/**
 * Legal moves from cell `v` for the cat at `catIndex`.
 * @param {{board:import('../board.js').Board, g:object}} state
 * @param {number} v
 * @param {number} [catIndex]
 * @returns {Array<{dir:number, to:number, land:number}>}
 */
export function gMoves(state, v, catIndex) {
  state = forCat(state, catIndex);
  const b = state.board;
  const out = [];
  if (b.blocked[v] || catInWay(state, v)) return out;
  for (let dir = 0; dir < 6; dir++) {
    const u = step(v, dir, b.W, b.H);
    if (u < 0 || b.blocked[u] || catInWay(state, u)) continue;
    if (!enterOk(state, v, u, dir)) continue;
    out.push({ dir, to: u, land: landOf(state, v, u, dir) });
  }
  return out;
}

// scratch reverse-adjacency table, reused across gDistanceMap calls
// (the BFS is synchronous and never re-enters itself)
let _preds = null;

/**
 * Moves-to-edge over the gimmick moves for the cat at `catIndex`: a
 * reverse BFS from the empty edge cells. `dist` is -1 for unreachable
 * cells; `paths` counts shortest routes (one per distinct legal move), 0
 * when unreachable.
 * @param {{board:import('../board.js').Board, g:object}} state
 * @param {number} [catIndex]
 * @returns {{dist: Int16Array, paths: Float64Array}}
 */
export function gDistanceMap(state, catIndex) {
  state = forCat(state, catIndex);
  const b = state.board;
  const n = b.W * b.H;
  const preds = _preds && _preds.length === n ? _preds : new Array(n);
  _preds = preds;
  for (let i = 0; i < n; i++) {
    if (!preds[i]) preds[i] = [];
    else preds[i].length = 0;
  }
  for (let v = 0; v < n; v++) {
    if (b.blocked[v] || catInWay(state, v)) continue;
    for (let dir = 0; dir < 6; dir++) {
      const u = step(v, dir, b.W, b.H);
      if (u < 0 || b.blocked[u] || catInWay(state, u)) continue;
      if (!enterOk(state, v, u, dir)) continue;
      preds[landOf(state, v, u, dir)].push(v);
    }
  }
  const dist = new Int16Array(n).fill(-1);
  const paths = new Float64Array(n);
  const queue = [];
  for (let i = 0; i < n; i++) {
    if (b.border[i] && !b.blocked[i] && !catInWay(state, i)) {
      dist[i] = 0;
      paths[i] = 1;
      queue.push(i);
    }
  }
  for (let head = 0; head < queue.length; head++) {
    const v = queue[head];
    for (const p of preds[v]) {
      if (dist[p] === -1) {
        dist[p] = dist[v] + 1;
        queue.push(p);
      }
    }
  }
  // BFS order guarantees every predecessor of v was dequeued before v.
  for (const v of queue) {
    if (dist[v] === 0) continue;
    let p = 0;
    for (const pred of preds[v]) {
      if (dist[pred] === dist[v] - 1) p += paths[pred];
    }
    paths[v] = p;
  }
  return { dist, paths };
}

/**
 * BFS distances from the cat at `catIndex` over the gimmick moves.
 * @param {{board:import('../board.js').Board, g:object}} state
 * @param {number} [catIndex]
 * @returns {Int16Array} -1 for unreachable cells
 */
export function gCatDistanceMap(state, catIndex) {
  state = forCat(state, catIndex);
  const b = state.board;
  const n = b.W * b.H;
  const dist = new Int16Array(n).fill(-1);
  dist[b.cat] = 0;
  const queue = [b.cat];
  for (let head = 0; head < queue.length; head++) {
    const v = queue[head];
    for (const { land } of gMoves(state, v)) {
      if (dist[land] === -1) {
        dist[land] = dist[v] + 1;
        queue.push(land);
      }
    }
  }
  return dist;
}

/**
 * Number of cells the cat at `catIndex` can rest on (flood over the
 * gimmick moves). The cat's own cell counts as 1.
 * @param {{board:import('../board.js').Board, g:object}} state
 * @param {number} [catIndex]
 * @returns {number}
 */
export function gReachableArea(state, catIndex) {
  state = forCat(state, catIndex);
  const b = state.board;
  const n = b.W * b.H;
  const seen = new Uint8Array(n);
  const stack = [b.cat];
  seen[b.cat] = 1;
  let count = 1;
  while (stack.length > 0) {
    const v = stack.pop();
    for (const { land } of gMoves(state, v)) {
      if (!seen[land]) {
        seen[land] = 1;
        count++;
        stack.push(land);
      }
    }
  }
  return count;
}

/**
 * The cat at `catIndex`'s shortest route to the edge (the "Show path hint"
 * feature under gimmick rules). The path lists every cell the cat passes
 * over in order: the entry cell, the cells of an ice slide, and the
 * landing cell.
 * @param {{board:import('../board.js').Board, g:object}} state
 * @param {number} [catIndex]
 * @returns {number[]|null} cells from the cat to an edge cell, or null when
 *                          the cat is enclosed (dist[cat] == -1)
 */
export function gShortestPathToEdge(state, catIndex) {
  state = forCat(state, catIndex);
  const { dist } = gDistanceMap(state);
  const b = state.board;
  if (dist[b.cat] === -1) return null;
  const path = [b.cat];
  let cur = b.cat;
  while (dist[cur] > 0) {
    let moved = false;
    for (const dir of dirOrder(cur, b.W)) {
      const u = step(cur, dir, b.W, b.H);
      if (u < 0 || b.blocked[u] || catInWay(state, u)) continue;
      if (!canEnter(state, cur, u, dir)) continue;
      const land = landing(state, cur, u, dir);
      if (dist[land] !== dist[cur] - 1) continue;
      path.push(...moveCells(state, cur, u, dir));
      cur = land;
      moved = true;
      break;
    }
    if (!moved) return null; // defensive: dist said a route exists
  }
  return path;
}

/**
 * Every cell the cat passes over when it moves from `from` to the entry
 * `to` in direction `dir`: the entry, any intermediate slide cells, and the
 * landing cell.
 * @param {{board:import('../board.js').Board, g:object}} state
 * @param {number} from
 * @param {number} to
 * @param {number} dir
 * @returns {number[]}
 */
export function moveCells(state, from, to, dir) {
  const land = landing(state, from, to, dir);
  if (land === to) return [to];
  const mid = [];
  const m = BY_KIND[state.g.kind[to]];
  if (m && m.traversed) mid.push(...m.traversed(state, from, to, dir));
  return [to, ...mid, land];
}

/** True when the cell lies on the board edge (re-export for gimmick code). */
export { isBorder };
