import { describe, it, expect } from 'vitest';
import { chooseCatMove } from '../src/game/catAI.js';
import {
  newGame,
  legalBlocks,
  legalCatMoves,
  applyBlock,
  applyCatMove,
} from '../src/game/rules.js';
import { cloneBoard, distanceMap, emptyNeighbors, reachableArea } from '../src/game/board.js';
import { toIndex } from '../src/game/hex.js';
import { mulberry32 } from '../src/game/rng.js';

const CENTER = toIndex(5, 5, 11);

/** Fresh empty-board state with the cat at `catIndex` and `difficulty`. */
function emptyState(difficulty = 'normal', catIndex = CENTER) {
  const state = newGame({ mode: 'trapper', difficulty, seed: 1 });
  state.board.blocked.fill(0);
  state.board.cat = catIndex;
  state.difficulty = difficulty;
  return state;
}

/** Ring at hex distance 2 from the center is fully blocked → cat enclosed. */
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
  state.turn = 'cat';
  return state;
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
  state.turn = 'cat';
  return state;
}

/** Strongest single block for the trapper: maximizes the cat's distance. */
function greedyBlock(state) {
  const b = state.board;
  let best = -1;
  let bestScore = -Infinity;
  for (const i of legalBlocks(state)) {
    b.blocked[i] = 1;
    const d = distanceMap(b).dist[b.cat];
    b.blocked[i] = 0;
    const score = d === -1 ? 1e9 : d;
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return best;
}

describe('chooseCatMove basics', () => {
  it('takes an edge move immediately', () => {
    for (const difficulty of ['easy', 'normal', 'hard']) {
      const state = emptyState(difficulty, toIndex(1, 5, 11));
      const m = chooseCatMove(state, mulberry32(1));
      expect([toIndex(0, 5, 11), toIndex(0, 6, 11)]).toContain(m);
    }
  });

  it('returns -1 when the cat has no move', () => {
    const state = emptyState('hard');
    for (const j of state.board.nbr[CENTER]) state.board.blocked[j] = 1;
    expect(chooseCatMove(state, mulberry32(1))).toBe(-1);
  });

  it('always returns a legal move (easy, many seeds)', () => {
    const state = emptyState('easy');
    const moves = legalCatMoves(state);
    for (let seed = 0; seed < 40; seed++) {
      expect(moves).toContain(chooseCatMove(state, mulberry32(seed)));
    }
  });

  it('never mutates the state', () => {
    const state = midGame(7);
    const before = {
      blocked: Array.from(state.board.blocked),
      cat: state.board.cat,
      turn: state.turn,
      moveCount: state.moveCount,
      history: state.history.slice(),
    };
    state.difficulty = 'hard';
    chooseCatMove(state, mulberry32(3));
    expect(Array.from(state.board.blocked)).toEqual(before.blocked);
    expect(state.board.cat).toBe(before.cat);
    expect(state.turn).toBe(before.turn);
    expect(state.moveCount).toBe(before.moveCount);
    expect(state.history).toEqual(before.history);
  });
});

describe('Normal difficulty', () => {
  it('always moves onto the shortest route', () => {
    const state = emptyState('normal');
    const distBefore = distanceMap(state.board).dist[state.board.cat];
    expect(distBefore).toBe(5);
    for (let seed = 0; seed < 20; seed++) {
      const m = chooseCatMove(state, mulberry32(seed));
      expect(legalCatMoves(state)).toContain(m);
      const nb = cloneBoard(state.board);
      nb.cat = m;
      expect(distanceMap(nb).dist[m]).toBe(distBefore - 1);
    }
  });
});

describe('enclosed cat', () => {
  /** Rev. 2 score of moving the cat to `m`: area with the old cell blocked, then empty neighbors. */
  function enclosedScore(board, m) {
    const nb = cloneBoard(board);
    nb.blocked[board.cat] = 1;
    nb.cat = m;
    return [reachableArea(nb), emptyNeighbors(nb, m).length];
  }

  it('picks the Rev.2 best move (area with old cell blocked, then neighbors)', () => {
    for (const difficulty of ['easy', 'normal', 'hard']) {
      const state = enclosedState(difficulty);
      expect(distanceMap(state.board).dist[state.board.cat]).toBe(-1);
      const moves = legalCatMoves(state);
      expect(moves.length).toBe(6);
      let best = [-Infinity, -Infinity];
      for (const m of moves) {
        const s = enclosedScore(state.board, m);
        if (s[0] > best[0] || (s[0] === best[0] && s[1] > best[1])) best = s;
      }
      const rng = mulberry32(1234);
      for (let t = 0; t < 5; t++) {
        const m = chooseCatMove(state, rng);
        expect(moves).toContain(m);
        expect(enclosedScore(state.board, m)).toEqual(best);
      }
    }
  });

  it('does not step into a dead-end pocket next to the cat (Rev.2)', () => {
    // fixture: cat enclosed by the ring at hex distance 3; the west neighbor
    // (5,4) is a dead-end pocket (its outward neighbors and the ring1 cells on
    // either side of it are blocked), the rest of the interior is one big region
    const state = enclosedState('normal');
    const b = state.board;
    const d3 = new Int16Array(b.W * b.H).fill(-1);
    d3[b.cat] = 0;
    const q = [b.cat];
    for (let h = 0; h < q.length; h++) {
      const v = q[h];
      for (const u of b.nbr[v]) {
        if (d3[u] === -1) {
          d3[u] = d3[v] + 1;
          q.push(u);
        }
      }
    }
    b.blocked.fill(0);
    for (let i = 0; i < d3.length; i++) if (d3[i] === 3) b.blocked[i] = 1;
    const pocket = toIndex(5, 4, 11);
    for (const [r, c] of [
      [4, 5], // ring1 north-west of the pocket
      [6, 5], // ring1 south-west of the pocket
      [5, 3], // pocket outward (west)
      [4, 4], // pocket outward (north-west)
      [6, 4], // pocket outward (south-west)
    ]) {
      b.blocked[toIndex(r, c, 11)] = 1;
    }
    state.turn = 'cat';

    expect(distanceMap(b).dist[b.cat]).toBe(-1);
    const moves = legalCatMoves(state);
    expect(moves).toContain(pocket);
    expect(moves.length).toBe(4);

    const pocketScore = enclosedScore(b, pocket);
    let bestElsewhere = [-Infinity, -Infinity];
    for (const m of moves) {
      if (m === pocket) continue;
      const s = enclosedScore(b, m);
      if (s[0] > bestElsewhere[0] || (s[0] === bestElsewhere[0] && s[1] > bestElsewhere[1])) {
        bestElsewhere = s;
      }
    }
    expect(pocketScore[0]).toBe(1); // just the pocket cell
    expect(bestElsewhere[0]).toBeGreaterThan(pocketScore[0]);

    for (const difficulty of ['easy', 'normal', 'hard']) {
      state.difficulty = difficulty;
      const rng = mulberry32(555);
      for (let t = 0; t < 10; t++) {
        const m = chooseCatMove(state, rng);
        expect(m).not.toBe(pocket);
        expect(enclosedScore(b, m)).toEqual(bestElsewhere);
      }
    }
  });

  it('never tries to walk through the wall', () => {
    const state = enclosedState('hard');
    for (let seed = 0; seed < 10; seed++) {
      const m = chooseCatMove(state, mulberry32(seed));
      expect(state.board.blocked[m]).toBe(0);
    }
  });
});

describe('Hard difficulty', () => {
  it('reaches the 2-move escape fixture against a greedy trapper', () => {
    const state = emptyState('hard', toIndex(2, 5, 11));
    state.turn = 'cat';
    // first move must step onto row 1 (escape in 2)
    const first = chooseCatMove(state, mulberry32(7));
    expect([toIndex(1, 4, 11), toIndex(1, 5, 11)]).toContain(first);

    // play it out against the strongest single-block defence
    const game = emptyState('hard', toIndex(2, 5, 11));
    game.turn = 'cat';
    let catTurns = 0;
    let guard = 0;
    while (game.status === 'playing' && guard++ < 50) {
      if (game.turn === 'cat') {
        applyCatMove(game, chooseCatMove(game, mulberry32(catTurns + 1)));
        catTurns++;
      } else {
        applyBlock(game, greedyBlock(game));
      }
    }
    expect(game.status).toBe('catWin');
    expect(catTurns).toBeLessThanOrEqual(3);
  });

  it('answers with a legal move on a realistic mid-game board', () => {
    // (the <100 ms timing budget lives in test/perf, run via npm run test:perf)
    for (const seed of [11, 22, 33]) {
      const state = midGame(seed);
      const blocks = state.board.blocked.reduce((a, b) => a + b, 0);
      expect(blocks).toBeGreaterThanOrEqual(20);
      const rng = mulberry32(seed);
      const move = chooseCatMove(state, rng);
      expect(legalCatMoves(state)).toContain(move);
    }
  });

  it('prefers a shorter escape when both are available', () => {
    // cat two moves from the edge on an otherwise empty board
    const state = emptyState('hard', toIndex(2, 5, 11));
    const m = chooseCatMove(state, mulberry32(99));
    const nb = cloneBoard(state.board);
    nb.cat = m;
    expect(distanceMap(nb).dist[m]).toBe(1);
  });
});
