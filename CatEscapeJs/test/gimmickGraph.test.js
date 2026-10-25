import { describe, it, expect } from 'vitest';
import {
  step,
  opposite,
  hexDistance,
  dirOrder,
  DIR_E,
  DIR_NE,
  DIR_NW,
  DIR_W,
  DIR_SW,
  DIR_SE,
} from '../src/game/gimmick/hexDir.js';
import {
  createG,
  isBlockable,
  canEnter,
  landing,
  KINDS,
  UNLOCKS,
} from '../src/game/gimmick/registry.js';
import {
  gMoves,
  gDistanceMap,
  gCatDistanceMap,
  gReachableArea,
  gShortestPathToEdge,
  moveCells,
} from '../src/game/gimmick/graph.js';
import {
  createBoard,
  distanceMap,
  catDistanceMap,
  reachableArea,
  shortestPathToEdge,
} from '../src/game/board.js';
import { toIndex } from '../src/game/hex.js';
import { mulberry32 } from '../src/game/rng.js';

const W = 11;
const H = 11;

/** Plain gimmick state: empty `g`, the given board. */
function plainState(board) {
  return { board, g: createG(board.W * board.H) };
}

describe('hexDir', () => {
  it('step: E/W are the horizontal neighbors on every row', () => {
    for (const r of [0, 1, 5, 10]) {
      expect(step(toIndex(r, 5, W), DIR_E, W, H)).toBe(toIndex(r, 6, W));
      expect(step(toIndex(r, 5, W), DIR_W, W, H)).toBe(toIndex(r, 4, W));
    }
  });

  it('step: NE/NW/SE/SW match the odd-r neighbor rows', () => {
    // even row 4: NE (3,5), NW (3,4), SE (5,5), SW (5,4)
    const even = toIndex(4, 5, W);
    expect(step(even, DIR_NE, W, H)).toBe(toIndex(3, 5, W));
    expect(step(even, DIR_NW, W, H)).toBe(toIndex(3, 4, W));
    expect(step(even, DIR_SE, W, H)).toBe(toIndex(5, 5, W));
    expect(step(even, DIR_SW, W, H)).toBe(toIndex(5, 4, W));
    // odd row 5: NE (4,6), NW (4,5), SE (6,6), SW (6,5)
    const odd = toIndex(5, 5, W);
    expect(step(odd, DIR_NE, W, H)).toBe(toIndex(4, 6, W));
    expect(step(odd, DIR_NW, W, H)).toBe(toIndex(4, 5, W));
    expect(step(odd, DIR_SE, W, H)).toBe(toIndex(6, 6, W));
    expect(step(odd, DIR_SW, W, H)).toBe(toIndex(6, 5, W));
  });

  it('step: -1 off the board and for unknown dirs', () => {
    expect(step(toIndex(0, 0, W), DIR_NW, W, H)).toBe(-1);
    expect(step(toIndex(0, 0, W), DIR_W, W, H)).toBe(-1);
    expect(step(toIndex(0, 0, W), DIR_NE, W, H)).toBe(-1);
    expect(step(toIndex(10, 10, W), DIR_SE, W, H)).toBe(-1);
    expect(step(toIndex(10, 10, W), DIR_SW, W, H)).toBe(-1);
    expect(step(toIndex(10, 10, W), DIR_E, W, H)).toBe(-1);
    expect(step(60, 99, W, H)).toBe(-1);
  });

  it('step: every neighbor is reachable by exactly one dir and opposite undoes it', () => {
    const nbr = createBoard(W, H).nbr;
    for (let i = 0; i < W * H; i++) {
      const seen = new Map();
      for (let dir = 0; dir < 6; dir++) {
        const u = step(i, dir, W, H);
        if (u < 0) continue;
        expect(seen.has(u)).toBe(false);
        seen.set(u, dir);
        expect(step(u, opposite(dir), W, H)).toBe(i);
      }
      // matches the shared neighbor table
      expect([...seen.keys()].sort((a, b) => a - b)).toEqual(
        Array.from(nbr[i]).sort((a, b) => a - b),
      );
    }
  });

  it('dirOrder matches board.nbr order', () => {
    const nbr = createBoard(W, H).nbr;
    for (let i = 0; i < W * H; i++) {
      const dirs = dirOrder(i, W);
      const fromDirs = dirs.map((d) => step(i, d, W, H)).filter((u) => u >= 0);
      expect(fromDirs).toEqual(Array.from(nbr[i]));
    }
  });

  it('hexDistance: 0 on itself, 1 on neighbors, symmetric, known value', () => {
    const b = createBoard(W, H);
    for (let i = 0; i < W * H; i++) {
      expect(hexDistance(i, i, W)).toBe(0);
      for (const j of b.nbr[i]) {
        expect(hexDistance(i, j, W)).toBe(1);
        expect(hexDistance(j, i, W)).toBe(1);
      }
    }
    expect(hexDistance(toIndex(0, 0, W), toIndex(10, 10, W), W)).toBe(15);
    expect(hexDistance(toIndex(5, 0, W), toIndex(5, 10, W), W)).toBe(10);
  });
});

describe('registry', () => {
  it('KINDS are listed in unlock order with matching UNLOCKS', () => {
    expect(KINDS.length).toBeGreaterThan(0);
    for (let i = 1; i < KINDS.length; i++) {
      expect(KINDS[i].unlock).toBeGreaterThan(KINDS[i - 1].unlock);
    }
    for (const m of KINDS) expect(UNLOCKS[m.id]).toBe(m.unlock);
  });

  it('isBlockable: empty normal cells only', () => {
    const board = createBoard(W, H);
    board.blocked[60] = 1;
    const state = plainState(board);
    expect(isBlockable(state, 60)).toBe(false); // blocked
    expect(isBlockable(state, board.cat)).toBe(false); // the cat's cell
    expect(isBlockable(state, 0)).toBe(true); // empty edge cell
    state.g.kind[1] = 1; // item
    state.g.kind[2] = 2; // stone
    expect(isBlockable(state, 1)).toBe(false);
    expect(isBlockable(state, 2)).toBe(false);
  });

  it('canEnter/landing default to true/`to` on plain cells', () => {
    const state = plainState(createBoard(W, H));
    expect(canEnter(state, 60, 61, DIR_E)).toBe(true);
    expect(landing(state, 60, 61, DIR_E)).toBe(61);
  });
});

describe('graph: equivalence with board.js on plain boards (50 seeds)', () => {
  /** Seeded random board: random cat position and 0–24 blocks (never on the cat). */
  function randomBoard(seed) {
    const rng = mulberry32(seed);
    const board = createBoard(W, H);
    board.cat = Math.floor(rng() * (W * H));
    const count = Math.floor(rng() * 25);
    const pool = [];
    for (let i = 0; i < W * H; i++) if (i !== board.cat) pool.push(i);
    for (let k = 0; k < count; k++) {
      const j = k + Math.floor(rng() * (pool.length - k));
      const tmp = pool[k];
      pool[k] = pool[j];
      pool[j] = tmp;
      board.blocked[pool[k]] = 1;
    }
    return board;
  }

  it('dist, paths, catDistance, area and path all match', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const board = randomBoard(seed);
      const state = plainState(board);

      const dg = gDistanceMap(state);
      const db = distanceMap(board);
      expect(Array.from(dg.dist), `dist seed ${seed}`).toEqual(Array.from(db.dist));
      expect(Array.from(dg.paths), `paths seed ${seed}`).toEqual(Array.from(db.paths));

      expect(Array.from(gCatDistanceMap(state)), `catDist seed ${seed}`).toEqual(
        Array.from(catDistanceMap(board)),
      );
      expect(gReachableArea(state), `area seed ${seed}`).toBe(reachableArea(board));
      expect(gShortestPathToEdge(state), `path seed ${seed}`).toEqual(shortestPathToEdge(board));
    }
  });

  it('moveCells on a plain board is just the entry cell', () => {
    const board = randomBoard(7);
    const state = plainState(board);
    for (const { to, dir } of gMoves(state, board.cat)) {
      expect(moveCells(state, board.cat, to, dir)).toEqual([to]);
    }
  });

  it('gMoves from a blocked cell is empty; from an empty cell matches the nbrs', () => {
    const board = randomBoard(11);
    const state = plainState(board);
    for (let i = 0; i < W * H; i++) {
      const moves = gMoves(state, i).map((m) => m.to).sort((a, b) => a - b);
      if (board.blocked[i]) {
        expect(moves).toEqual([]);
      } else {
        const nbrs = Array.from(board.nbr[i]).filter((j) => !board.blocked[j]).sort((a, b) => a - b);
        expect(moves).toEqual(nbrs);
      }
    }
  });
});
