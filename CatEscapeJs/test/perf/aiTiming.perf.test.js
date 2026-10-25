/**
 * Isolated AI-timing suite (spec 13.3/13.7): every AI-timing assertion
 * lives here so `npm test` stays deterministic. This folder is excluded
 * from `npm test`; run it alone with:
 *
 *   npm run test:perf
 *
 * (vitest run test/perf --no-file-parallelism --pool forks
 *  --poolOptions.forks.singleFork)
 *
 * The assertions measure **wall-clock** time: median < 100 ms (the real
 * per-move budget) and max < 250 ms (one slow slice is tolerated).
 */
import { describe, it, expect } from 'vitest';
import { newGame as basicNewGame, legalBlocks, legalCatMoves } from '../../src/game/rules.js';
import { distanceMap } from '../../src/game/board.js';
import { chooseCatMove as basicChooseCatMove } from '../../src/game/catAI.js';
import { chooseBlock as basicChooseBlock } from '../../src/game/trapperAI.js';
import {
  newGame as gimmickNewGame,
  selectCat,
} from '../../src/game/gimmick/gimmickRules.js';
import {
  chooseCatMove as gimmickChooseCatMove,
  chooseBlock as gimmickChooseBlock,
  chooseAICat,
} from '../../src/game/gimmick/gimmickAI.js';
import { getLevel, blocksFor } from '../../src/game/play/levels.js';
import { mulberry32 } from '../../src/game/rng.js';
import { timeMoves, expectFast } from '../aiTiming.js';

/** Basic mid-game board: an empty start plus 20 legal random blocks. */
function basicMidGame(seed, turn) {
  const state = basicNewGame({ mode: 'trapper', difficulty: 'hard', seed });
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
  state.turn = turn;
  return state;
}

/** Gimmick mid-game board (item + stone cells, 20 extra blocks). */
function gimmickMidGame(role, ai, seed) {
  const state = gimmickNewGame({
    role,
    ai,
    blocks: 14,
    gimmick: { gimmicks: { item: 4, stone: 2 }, aiItems: ai === 'hard' ? 2 : 1 },
    seed,
  });
  const rng = mulberry32((seed ^ 0x9e3779b9) >>> 0);
  let added = 0;
  while (added < 20) {
    const legal = legalBlocks(state);
    const i = legal[Math.floor(rng() * legal.length)];
    state.board.blocked[i] = 1;
    if (distanceMap(state.board).dist[state.board.cat] === -1) {
      state.board.blocked[i] = 0;
      continue;
    }
    added++;
  }
  return state;
}

/** A real gimmick level game (14.3 tables), used for the L16/L17-20 boards. */
function levelGame(course, level, seed) {
  const lv = getLevel(course, level);
  return gimmickNewGame({
    role: course,
    ai: 'hard',
    blocks: blocksFor(lv, 'normal'),
    gimmick: {
      gimmicks: lv.gimmicks,
      aiItems: lv.aiItems,
      cats: lv.cats,
      catsGoal: lv.catsGoal,
    },
    seed,
  });
}

describe('perf: basic AI wall-clock budget (median < 100 ms, max < 250 ms)', () => {
  it('cat AI (Hard) on mid-game boards', () => {
    for (const seed of [11, 22, 33]) {
      const state = basicMidGame(seed, 'cat');
      const move = basicChooseCatMove(state, mulberry32(seed));
      expect(legalCatMoves(state)).toContain(move);
      expectFast(
        timeMoves(() => basicChooseCatMove(state, mulberry32(seed)), 5),
        `basic cat seed ${seed}`,
      );
    }
  });

  it('trapper AI (Hard) on mid-game boards', () => {
    for (const seed of [11, 22, 33]) {
      const state = basicMidGame(seed, 'trapper');
      const move = basicChooseBlock(state, mulberry32(seed));
      expect(legalBlocks(state)).toContain(move);
      expectFast(
        timeMoves(() => basicChooseBlock(state, mulberry32(seed)), 5),
        `basic block seed ${seed}`,
      );
    }
  });
});

describe('perf: gimmick Hard wall-clock budget', () => {
  it('chooseBlock on a realistic mid-game board', () => {
    for (const seed of [11, 22, 33]) {
      const state = gimmickMidGame('escape', 'hard', seed);
      const move = gimmickChooseBlock(state, mulberry32(seed));
      expect(legalBlocks(state)).toContain(move);
      expectFast(
        timeMoves(() => gimmickChooseBlock(state, mulberry32(seed)), 5),
        `gimmick block seed ${seed}`,
      );
    }
  });

  it('chooseCatMove on a realistic mid-game board', () => {
    for (const seed of [11, 22, 33]) {
      const state = gimmickMidGame('trapper', 'hard', seed);
      const move = gimmickChooseCatMove(state, mulberry32(seed));
      expect(legalCatMoves(state)).toContain(move);
      expectFast(
        timeMoves(() => gimmickChooseCatMove(state, mulberry32(seed)), 5),
        `gimmick move seed ${seed}`,
      );
    }
  });

  it('L16 board with every gimmick (both courses)', () => {
    for (const course of ['escape', 'trapper']) {
      const lv = getLevel(course, 16);
      for (const seed of [11, 22, 33]) {
        const state = gimmickNewGame({
          role: course,
          ai: 'hard',
          blocks: blocksFor(lv, 'normal'),
          gimmick: { gimmicks: lv.gimmicks, aiItems: lv.aiItems },
          playerItems: course === 'escape' ? { hammer: 2, double: 0 } : { hammer: 0, double: 2 },
          seed,
        });
        const tag = `${course} L16 seed ${seed}`;
        const block = gimmickChooseBlock(state, mulberry32(seed));
        expect(legalBlocks(state), `${tag} block`).toContain(block);
        expectFast(
          timeMoves(() => gimmickChooseBlock(state, mulberry32(seed)), 5),
          `${tag} block`,
        );
        if (course === 'trapper') {
          state.turn = 'cat';
          const move = gimmickChooseCatMove(state, mulberry32(seed ^ 0x5f5f));
          expect(legalCatMoves(state), `${tag} move`).toContain(move);
          expectFast(
            timeMoves(() => gimmickChooseCatMove(state, mulberry32(seed ^ 0x5f5f)), 5),
            `${tag} move`,
          );
        }
      }
    }
  });
});

describe('perf: Hard under 100 ms with multiple cats (L17-20)', () => {
  it('chooseCatMove and chooseBlock on 2- and 3-cat boards', () => {
    for (const [course, level] of [
      ['escape', 17],
      ['escape', 18],
      ['escape', 19],
      ['escape', 20],
      ['trapper', 19],
      ['trapper', 20],
    ]) {
      for (const seed of [11, 22]) {
        const state = levelGame(course, level, seed);
        expect(state.cats.length).toBeGreaterThanOrEqual(2);
        const tag = `${course} L${level} seed ${seed}`;

        let move = null;
        expectFast(
          timeMoves(() => {
            const rng = mulberry32(seed);
            selectCat(state, chooseAICat(state, rng));
            move = gimmickChooseCatMove(state, rng);
          }, 5),
          `${tag} cat`,
        );
        expect(legalCatMoves(state), `${tag} cat move`).toContain(move);

        state.turn = 'trapper';
        let block = null;
        expectFast(
          timeMoves(() => {
            block = gimmickChooseBlock(state, mulberry32(seed));
          }, 5),
          `${tag} block`,
        );
        expect(legalBlocks(state), `${tag} block`).toContain(block);
      }
    }
  });
});
