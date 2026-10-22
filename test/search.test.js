import { describe, it, expect } from 'vitest';
import { evalForCat, alphaBeta } from '../src/game/search.js';
import { createBoard, emptyNeighbors, distanceMap } from '../src/game/board.js';
import { trapperCandidates } from '../src/game/candidates.js';
import { newGame, legalBlocks } from '../src/game/rules.js';
import { toIndex, isBorder } from '../src/game/hex.js';
import { mulberry32 } from '../src/game/rng.js';

const CENTER = toIndex(5, 5, 11);

/** Board with the cat at `catIndex` and no initial blocks. */
function emptyState(catIndex = CENTER) {
  const state = newGame({ mode: 'trapper', difficulty: 'normal', seed: 1 });
  state.board.blocked.fill(0);
  state.board.cat = catIndex;
  return state.board;
}

/** Ring at hex distance 2 from the center is fully blocked → cat enclosed. */
function enclosedBoard() {
  const b = createBoard();
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
  return b;
}

/** Board where the cat has exactly one empty neighbor. */
function oneExitBoard() {
  const b = createBoard();
  const nbrs = Array.from(b.nbr[CENTER]);
  for (const j of nbrs.slice(1)) b.blocked[j] = 1;
  return b;
}

describe('evalForCat', () => {
  it('cat on edge → +10000', () => {
    expect(evalForCat(emptyState(toIndex(0, 5, 11)))).toBe(10000);
    expect(evalForCat(emptyState(toIndex(6, 0, 11)))).toBe(10000);
  });

  it('cat with no moves → -10000', () => {
    const b = createBoard();
    for (const j of b.nbr[CENTER]) b.blocked[j] = 1;
    expect(evalForCat(b)).toBe(-10000);
  });

  it('enclosed cat → -5000 + reachableArea*10', () => {
    const b = enclosedBoard();
    expect(evalForCat(b)).toBe(-5000 + 7 * 10);
    b.blocked[b.nbr[CENTER][0]] = 1;
    expect(evalForCat(b)).toBe(-5000 + 6 * 10);
  });

  it('otherwise → -100*dist + 15*min(paths,20) + 5*moves', () => {
    // cat at (1,5) on an empty board: dist=1, paths=2, 6 moves → -100+30+30
    const b = emptyState(toIndex(1, 5, 11));
    expect(evalForCat(b)).toBe(-40);
    // center of an empty board: dist=5
    const c = emptyState();
    const d = distanceMap(c);
    expect(d.dist[CENTER]).toBe(5);
    expect(evalForCat(c)).toBe(-100 * 5 + 15 * Math.min(d.paths[CENTER], 20) + 5 * 6);
  });
});

describe('alphaBeta', () => {
  it('returns a structured result', () => {
    const res = alphaBeta(emptyState(), 2, -Infinity, Infinity, 'cat', 10);
    expect(res).toHaveProperty('score');
    expect(res).toHaveProperty('move');
    expect(typeof res.score).toBe('number');
    expect(emptyNeighbors(emptyState(), CENTER)).toContain(res.move);
  });

  it('cat with an immediate escape takes it (+10000+depth)', () => {
    const b = emptyState(toIndex(1, 5, 11));
    const { score, move } = alphaBeta(b, 4, -Infinity, Infinity, 'cat', 10);
    expect(score).toBe(10003);
    expect(isBorder(move, 11, 11)).toBe(true);
  });

  it('trapped cat → -(10000 + depth)', () => {
    const b = createBoard();
    for (const j of b.nbr[CENTER]) b.blocked[j] = 1;
    expect(alphaBeta(b, 4, -Infinity, Infinity, 'cat', 10)).toEqual({
      score: -10004,
      move: null,
    });
  });

  it('trapper seals the last exit → -(10000 + depth) with that move', () => {
    const b = oneExitBoard();
    const exit = emptyNeighbors(b, CENTER)[0];
    const { score, move } = alphaBeta(b, 4, -Infinity, Infinity, 'trapper', 10);
    expect(score).toBe(-10003);
    expect(move).toBe(exit);
  });

  it('2-move escape fixture: cat finds the forced win (score 10001, row 1)', () => {
    const b = emptyState(toIndex(2, 5, 11));
    const { score, move } = alphaBeta(b, 4, -Infinity, Infinity, 'cat', 10);
    expect(score).toBe(10001);
    expect(move === toIndex(1, 4, 11) || move === toIndex(1, 5, 11)).toBe(true);
  });

  it('trapper search returns a legal candidate on a mid-game board', () => {
    const state = newGame({ mode: 'trapper', difficulty: 'hard', seed: 99 });
    const cands = trapperCandidates(state.board, 10);
    const { score, move } = alphaBeta(state.board, 2, -Infinity, Infinity, 'trapper', 10);
    expect(cands).toContain(move);
    expect(Number.isFinite(score)).toBe(true);
  });

  it('cat search returns a legal move on a mid-game board', () => {
    const state = newGame({ mode: 'escape', difficulty: 'hard', seed: 99 });
    const { score, move } = alphaBeta(state.board, 2, -Infinity, Infinity, 'cat', 10);
    expect(emptyNeighbors(state.board, state.board.cat)).toContain(move);
    expect(Number.isFinite(score)).toBe(true);
  });

  it('does not mutate the board', () => {
    const state = newGame({ mode: 'trapper', difficulty: 'hard', seed: 5 });
    const before = Array.from(state.board.blocked);
    alphaBeta(state.board, 3, -Infinity, Infinity, 'trapper', 10);
    expect(Array.from(state.board.blocked)).toEqual(before);
    expect(state.board.cat).toBe(CENTER);
  });

  it('alpha and beta bounds cut the search without changing a forced win', () => {
    const b = emptyState(toIndex(2, 5, 11));
    const open = alphaBeta(b, 4, -Infinity, Infinity, 'cat', 10);
    const bounded = alphaBeta(b, 4, -Infinity, 0, 'cat', 10);
    expect(bounded.score).toBe(open.score);
    expect(bounded.move).toBe(open.move);
  });
});
