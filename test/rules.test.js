import { describe, it, expect } from 'vitest';
import {
  INITIAL_BLOCKS,
  newGame,
  legalBlocks,
  legalCatMoves,
  applyBlock,
  applyCatMove,
  evaluateStatus,
} from '../src/game/rules.js';
import { distanceMap, isEmpty } from '../src/game/board.js';
import { toIndex } from '../src/game/hex.js';

const CENTER = toIndex(5, 5, 11);

function freshState(opts = {}) {
  const state = newGame({ mode: 'trapper', difficulty: 'normal', seed: 1, ...opts });
  state.board.blocked.fill(0);
  state.history.length = 0;
  state.moveCount = 0;
  return state;
}

describe('INITIAL_BLOCKS', () => {
  it('matches the spec table', () => {
    expect(INITIAL_BLOCKS.trapper).toEqual({ easy: 15, normal: 11, hard: 7 });
    expect(INITIAL_BLOCKS.escape).toEqual({ easy: 5, normal: 8, hard: 11 });
  });
});

describe('newGame', () => {
  it('places the right number of initial blocks for every mode/difficulty', () => {
    for (const mode of ['trapper', 'escape']) {
      for (const difficulty of ['easy', 'normal', 'hard']) {
        const state = newGame({ mode, difficulty, seed: 7 });
        const blocked = state.board.blocked.reduce((a, b) => a + b, 0);
        expect(blocked).toBe(INITIAL_BLOCKS[mode][difficulty]);
        expect(state.mode).toBe(mode);
        expect(state.difficulty).toBe(difficulty);
        expect(state.status).toBe('playing');
        expect(state.moveCount).toBe(0);
        expect(state.history).toEqual([]);
        expect(state.seed).toBe(7);
      }
    }
  });

  it('never blocks the cat cell and always keeps a route to the edge', () => {
    for (let seed = 0; seed < 60; seed++) {
      for (const mode of ['trapper', 'escape']) {
        for (const difficulty of ['easy', 'normal', 'hard']) {
          const state = newGame({ mode, difficulty, seed });
          expect(state.board.blocked[state.board.cat]).toBe(0);
          expect(state.board.cat).toBe(CENTER);
          expect(distanceMap(state.board).dist[state.board.cat]).not.toBe(-1);
        }
      }
    }
  });

  it('is deterministic for a seed', () => {
    const a = newGame({ mode: 'trapper', difficulty: 'hard', seed: 4242 });
    const b = newGame({ mode: 'trapper', difficulty: 'hard', seed: 4242 });
    expect(Array.from(a.board.blocked)).toEqual(Array.from(b.board.blocked));
    const c = newGame({ mode: 'trapper', difficulty: 'hard', seed: 4243 });
    expect(Array.from(a.board.blocked)).not.toEqual(Array.from(c.board.blocked));
  });

  it('first move follows the mode', () => {
    expect(newGame({ mode: 'trapper', difficulty: 'easy', seed: 1 }).turn).toBe('trapper');
    expect(newGame({ mode: 'escape', difficulty: 'easy', seed: 1 }).turn).toBe('cat');
  });

  it('throws on unknown mode or difficulty', () => {
    expect(() => newGame({ mode: 'nope', difficulty: 'easy', seed: 1 })).toThrow();
    expect(() => newGame({ mode: 'trapper', difficulty: 'nope', seed: 1 })).toThrow();
  });
});

describe('legal moves', () => {
  it('legalBlocks = every empty cell', () => {
    const state = freshState();
    state.board.blocked[3] = 1;
    const blocks = legalBlocks(state);
    expect(blocks).not.toContain(3);
    expect(blocks).not.toContain(CENTER);
    expect(blocks.length).toBe(121 - 1 - 1);
    for (const i of blocks) expect(isEmpty(state.board, i)).toBe(true);
  });

  it('legalCatMoves = empty neighbors of the cat', () => {
    const state = freshState();
    const moves = legalCatMoves(state);
    expect(moves.length).toBe(6);
    state.board.blocked[moves[0]] = 1;
    expect(legalCatMoves(state).length).toBe(5);
    state.board.blocked[CENTER] = 1; // cat cell can never be "blocked away"
    expect(legalCatMoves(state).length).toBe(5);
  });
});

describe('applyBlock', () => {
  it('blocks a cell, records history and passes the turn', () => {
    const state = freshState();
    applyBlock(state, 7);
    expect(state.board.blocked[7]).toBe(1);
    expect(state.turn).toBe('cat');
    expect(state.moveCount).toBe(1);
    expect(state.history).toEqual([{ side: 'trapper', index: 7 }]);
    expect(state.status).toBe('playing');
  });

  it('throws on illegal blocks', () => {
    const state = freshState();
    expect(() => applyBlock(state, CENTER)).toThrow();
    expect(() => applyBlock(state, -1)).toThrow();
    expect(() => applyBlock(state, 121)).toThrow();
    expect(() => applyBlock(state, 1.5)).toThrow();
    state.board.blocked[7] = 1;
    expect(() => applyBlock(state, 7)).toThrow();
    expect(state.board.blocked.filter((v) => v).length).toBe(1);
  });

  it('throws when it is not the trapper turn', () => {
    const state = freshState();
    state.turn = 'cat';
    expect(() => applyBlock(state, 7)).toThrow();
  });

  it('throws when the game is over', () => {
    const state = freshState();
    state.status = 'catWin';
    expect(() => applyBlock(state, 7)).toThrow();
  });

  it('detects trapperWin when the last exit is sealed', () => {
    const state = freshState();
    const nbrs = Array.from(state.board.nbr[CENTER]);
    for (const j of nbrs.slice(1)) state.board.blocked[j] = 1;
    expect(legalCatMoves(state)).toEqual([nbrs[0]]);
    applyBlock(state, nbrs[0]);
    expect(state.turn).toBe('cat');
    expect(state.status).toBe('trapperWin');
    expect(state.moveCount).toBe(1);
  });
});

describe('applyCatMove', () => {
  it('moves the cat, records history and passes the turn', () => {
    const state = freshState();
    state.turn = 'cat';
    const to = legalCatMoves(state)[0];
    applyCatMove(state, to);
    expect(state.board.cat).toBe(to);
    expect(state.turn).toBe('trapper');
    expect(state.moveCount).toBe(1);
    expect(state.history).toEqual([{ side: 'cat', index: to }]);
  });

  it('throws on illegal moves', () => {
    const state = freshState();
    state.turn = 'cat';
    expect(() => applyCatMove(state, CENTER)).toThrow();
    expect(() => applyCatMove(state, 0)).toThrow(); // not a neighbor
    expect(() => applyCatMove(state, -5)).toThrow();
    const nbr = state.board.nbr[CENTER][0];
    state.board.blocked[nbr] = 1;
    expect(() => applyCatMove(state, nbr)).toThrow();
    // non-adjacent even if empty after the cat shifts elsewhere
    state.board.blocked[nbr] = 0;
    expect(() => applyCatMove(state, toIndex(0, 0, 11))).toThrow();
  });

  it('throws when it is not the cat turn', () => {
    const state = freshState();
    expect(() => applyCatMove(state, state.board.nbr[CENTER][0])).toThrow();
  });

  it('detects catWin by stepping onto an edge cell', () => {
    const state = freshState();
    state.turn = 'cat';
    state.board.cat = toIndex(1, 5, 11);
    const edge = toIndex(0, 5, 11);
    expect(legalCatMoves(state)).toContain(edge);
    applyCatMove(state, edge);
    expect(state.status).toBe('catWin');
    expect(state.turn).toBe('trapper');
    expect(state.moveCount).toBe(1);
  });

  it('an edge cell already occupied by the cat counts as catWin', () => {
    const state = freshState();
    state.board.cat = toIndex(0, 5, 11);
    state.turn = 'cat';
    expect(evaluateStatus(state)).toBe('catWin');
  });

  it('further moves throw once the game is over', () => {
    const state = freshState();
    state.status = 'trapperWin';
    expect(() => applyCatMove(state, state.board.nbr[CENTER][0])).toThrow();
  });
});

describe('evaluateStatus', () => {
  it('playing while the cat has moves and is not on the edge', () => {
    const state = freshState();
    expect(evaluateStatus(state)).toBe('playing');
  });

  it('trapperWin only at the start of the cat turn', () => {
    const state = freshState();
    for (const j of state.board.nbr[CENTER]) state.board.blocked[j] = 1;
    state.turn = 'cat';
    expect(evaluateStatus(state)).toBe('trapperWin');
    state.turn = 'trapper';
    expect(evaluateStatus(state)).toBe('playing');
    state.turn = 'cat';
    expect(evaluateStatus(state)).toBe('trapperWin');
  });
});
