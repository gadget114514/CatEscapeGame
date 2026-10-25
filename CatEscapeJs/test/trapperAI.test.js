import { describe, it, expect } from 'vitest';
import { chooseBlock, trapperCandidates } from '../src/game/trapperAI.js';
import {
  newGame,
  legalBlocks,
  legalCatMoves,
  applyBlock,
  applyCatMove,
} from '../src/game/rules.js';
import {
  cloneBoard,
  distanceMap,
  catDistanceMap,
  reachableArea,
} from '../src/game/board.js';
import { toIndex } from '../src/game/hex.js';
import { mulberry32 } from '../src/game/rng.js';

const CENTER = toIndex(5, 5, 11);

/** Fresh empty-board state with the cat at the center. */
function emptyState(difficulty = 'normal') {
  const state = newGame({ mode: 'escape', difficulty, seed: 1 });
  state.board.blocked.fill(0);
  state.turn = 'trapper';
  return state;
}

/** Ring at hex distance 2 fully blocked → cat enclosed. */
function enclosedState(difficulty = 'normal') {
  const state = emptyState(difficulty);
  const b = state.board;
  const d = new Int16Array(b.W * b.H).fill(-1);
  d[b.cat] = 0;
  const q = [b.cat];
  for (let h = 0; h < q.length; h++) {
    const v = q[h];
    for (const u of b.nbr[v]) {
      if (d[u] === -1) {
        d[u] = d[v] + 1;
        q.push(u);
      }
    }
  }
  for (let i = 0; i < d.length; i++) if (d[i] === 2) b.blocked[i] = 1;
  state.turn = 'trapper';
  return state;
}

/** 1-move trap fixture: the cat has exactly one empty neighbor. */
function trapFixture(difficulty = 'normal') {
  const state = emptyState(difficulty);
  const nbrs = Array.from(state.board.nbr[CENTER]);
  for (const j of nbrs.slice(1)) state.board.blocked[j] = 1;
  return { state, exit: nbrs[0] };
}

/** Realistic mid-game board: initial hard blocks + 20 more, route preserved. */
function midGame(seed) {
  const state = newGame({ mode: 'trapper', difficulty: 'hard', seed });
  const rng = mulberry32((seed ^ 0x9e3779b9) >>> 0);
  let added = 0;
  while (added < 20) {
    const blocks = legalBlocks(state);
    const i = blocks[Math.floor(rng() * blocks.length)];
    state.board.blocked[i] = 1;
    if (distanceMap(state.board).dist[state.board.cat] === -1) {
      state.board.blocked[i] = 0;
      continue;
    }
    added++;
  }
  state.turn = 'trapper';
  return state;
}

describe('trapperCandidates', () => {
  it('includes every empty neighbor of the cat', () => {
    for (const seed of [1, 2, 3]) {
      const state = midGame(seed);
      const nbrs = legalCatMoves(state);
      const c12 = trapperCandidates(state.board, 12);
      const c10 = trapperCandidates(state.board, 10);
      expect(c12.length).toBeLessThanOrEqual(12);
      expect(c10.length).toBeLessThanOrEqual(10);
      for (const n of nbrs) {
        expect(c12).toContain(n);
        expect(c10).toContain(n);
      }
    }
  });

  it('is sorted by distance to the cat, then by descending paths', () => {
    const state = midGame(42);
    const g = catDistanceMap(state.board);
    const d = distanceMap(state.board);
    const c = trapperCandidates(state.board, 12);
    for (let i = 1; i < c.length; i++) {
      const a = c[i - 1];
      const b = c[i];
      expect(g[a]).toBeLessThanOrEqual(g[b]);
      if (g[a] === g[b]) expect(d.paths[a]).toBeGreaterThanOrEqual(d.paths[b]);
    }
  });

  it('returns only empty cells on or near a shortest route', () => {
    const state = midGame(7);
    const d = distanceMap(state.board);
    const g = catDistanceMap(state.board);
    const D = d.dist[state.board.cat];
    const nbrs = new Set(legalCatMoves(state));
    for (const v of trapperCandidates(state.board, 12)) {
      expect(state.board.blocked[v]).toBe(0);
      expect(v).not.toBe(state.board.cat);
      const onRoute = d.dist[v] !== -1 && g[v] !== -1 && g[v] + d.dist[v] === D;
      expect(onRoute || nbrs.has(v)).toBe(true);
    }
  });

  it('returns the cat neighbors when the cat is enclosed', () => {
    const state = enclosedState();
    const nbrs = legalCatMoves(state).slice().sort((a, b) => a - b);
    expect(trapperCandidates(state.board, 12).slice().sort((a, b) => a - b)).toEqual(nbrs);
  });
});

describe('chooseBlock', () => {
  it('Normal wins the 1-move trap fixture', () => {
    for (let seed = 0; seed < 20; seed++) {
      const { state, exit } = trapFixture('normal');
      expect(chooseBlock(state, mulberry32(seed))).toBe(exit);
    }
  });

  it('Hard wins the 1-move trap fixture', () => {
    for (let seed = 0; seed < 20; seed++) {
      const { state, exit } = trapFixture('hard');
      expect(chooseBlock(state, mulberry32(seed))).toBe(exit);
    }
  });

  it('Easy returns a legal block', () => {
    const state = midGame(5);
    state.difficulty = 'easy';
    const blocks = legalBlocks(state);
    for (let seed = 0; seed < 40; seed++) {
      expect(blocks).toContain(chooseBlock(state, mulberry32(seed)));
    }
  });

  it('Normal never lowers the cat escape distance', () => {
    for (const seed of [3, 8, 21]) {
      const state = midGame(seed);
      state.difficulty = 'normal';
      const before = distanceMap(state.board).dist[state.board.cat];
      const m = chooseBlock(state, mulberry32(seed));
      expect(legalBlocks(state)).toContain(m);
      const nb = cloneBoard(state.board);
      nb.blocked[m] = 1;
      const after = distanceMap(nb).dist[nb.cat];
      expect(after === -1 || after >= before).toBe(true);
    }
  });

  it('every level picks the min-area neighbor for an enclosed cat', () => {
    for (const difficulty of ['easy', 'normal', 'hard']) {
      const state = enclosedState(difficulty);
      const nbrs = legalCatMoves(state);
      let minArea = Infinity;
      for (const m of nbrs) {
        const nb = cloneBoard(state.board);
        nb.blocked[m] = 1;
        minArea = Math.min(minArea, reachableArea(nb));
      }
      const rng = mulberry32(99);
      for (let t = 0; t < 5; t++) {
        const m = chooseBlock(state, rng);
        expect(nbrs).toContain(m);
        const nb = cloneBoard(state.board);
        nb.blocked[m] = 1;
        expect(reachableArea(nb)).toBe(minArea);
      }
    }
  });

  it('never mutates the state', () => {
    const state = midGame(12);
    const before = {
      blocked: Array.from(state.board.blocked),
      cat: state.board.cat,
      turn: state.turn,
      moveCount: state.moveCount,
      history: state.history.slice(),
    };
    state.difficulty = 'hard';
    chooseBlock(state, mulberry32(4));
    expect(Array.from(state.board.blocked)).toEqual(before.blocked);
    expect(state.board.cat).toBe(before.cat);
    expect(state.turn).toBe(before.turn);
    expect(state.moveCount).toBe(before.moveCount);
    expect(state.history).toEqual(before.history);
  });

  it('answers with a legal block on a realistic mid-game board', () => {
    // (the <100 ms timing budget lives in test/perf, run via npm run test:perf)
    for (const seed of [11, 22, 33]) {
      const state = midGame(seed);
      const blocks = state.board.blocked.reduce((a, b) => a + b, 0);
      expect(blocks).toBeGreaterThanOrEqual(20);
      const rng = mulberry32(seed);
      const move = chooseBlock(state, rng);
      expect(legalBlocks(state)).toContain(move);
    }
  });

  it('blocks win the game when the cat is sealed in (integration)', () => {
    const { state, exit } = trapFixture('normal');
    applyBlock(state, exit);
    expect(state.status).toBe('trapperWin');
    expect(state.turn).toBe('cat');
    expect(() => applyCatMove(state, exit)).toThrow();
  });
});
