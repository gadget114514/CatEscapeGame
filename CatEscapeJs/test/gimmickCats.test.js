import { describe, it, expect } from 'vitest';
import {
  newGame,
  legalBlocks,
  legalCatMoves,
  applyBlock,
  applyCatMove,
  armItem,
  armPower,
  selectCat,
  syncSelection,
  evaluateStatus,
  CELL_NORMAL,
} from '../src/game/gimmick/gimmickRules.js';
import {
  chooseAICat,
  chooseCatMove,
  chooseBlock,
  shouldUseItem,
  hintCat,
} from '../src/game/gimmick/gimmickAI.js';
import {
  gMoves,
  gCatDistanceMap,
  gDistanceMap,
  gReachableArea,
  gShortestPathToEdge,
} from '../src/game/gimmick/graph.js';
import { isBlockable, KIND_FISH, KIND_SPRING } from '../src/game/gimmick/registry.js';
import { getLevel, blocksFor } from '../src/game/play/levels.js';
import { isBorder, toIndex } from '../src/game/hex.js';
import { mulberry32 } from '../src/game/rng.js';

const W = 11;
// Rev. 8/19.3: the multi-cat starts moved toward the center
const C2 = [toIndex(5, 4, W), toIndex(5, 6, W)];
const C3 = [toIndex(4, 5, W), toIndex(5, 4, W), toIndex(6, 6, W)];

/** Empty multi-cat game with control of the turn. */
function catsGame(opts = {}) {
  return newGame({
    role: 'trapper',
    ai: 'normal',
    blocks: 0,
    gimmick: { gimmicks: {}, aiItems: 0, cats: 2, catsGoal: 'anyEscape' },
    seed: 1234,
    ...opts,
  });
}

/** Place the cats at exact cells (fixtures). */
function setCats(state, cells, goal = state.catsGoal, selected = 0) {
  state.cats = cells.slice();
  state.catTotal = cells.length;
  state.catsGoal = goal;
  state.selectedCat = selected;
  state.board.cat = cells[selected];
  return state;
}

describe('gimmickRules: multi-cat setup (13.7)', () => {
  it('2 cats start at (5,4)/(5,6), 3 cats at (4,5)/(5,4)/(6,6) (19.3)', () => {
    const two = catsGame({ role: 'escape' });
    expect(two.cats).toEqual(C2);
    expect(two.catsGoal).toBe('anyEscape');
    const three = catsGame({ role: 'escape', gimmick: { gimmicks: {}, aiItems: 0, cats: 3, catsGoal: 'anyCatch' } });
    expect(three.cats).toEqual(C3);
    expect(three.catsGoal).toBe('anyCatch');
    for (const s of [two, three]) {
      expect(s.escaped).toBe(0);
      expect(s.catTotal).toBe(s.cats.length);
      expect(s.selectedCat).toBe(0);
      expect(s.board.cat).toBe(s.cats[0]);
    }
  });

  it('catsGoal defaults to anyEscape for multi-cat games and is null for 1 cat', () => {
    const def = catsGame({ gimmick: { gimmicks: {}, aiItems: 0, cats: 2 } });
    expect(def.catsGoal).toBe('anyEscape');
    const one = catsGame({ gimmick: { gimmicks: {}, aiItems: 0, cats: 1 } });
    expect(one.cats).toEqual([one.board.cat]);
    expect(one.catsGoal).toBeNull();
  });

  it('guarantees every cat a gimmick-aware route to the edge', () => {
    for (const seed of [1, 2, 3, 42, 999]) {
      const state = catsGame({
        seed,
        blocks: 15,
        gimmick: { gimmicks: { stone: 2, tunnel: 1, ice: 3 }, aiItems: 0, cats: 3, catsGoal: 'anyEscape' },
      });
      for (let j = 0; j < state.cats.length; j++) {
        expect(gDistanceMap(state, j).dist[state.cats[j]]).not.toBe(-1);
      }
    }
  });

  it('gimmick cells never sit on a cat or next to a cat start', () => {
    const state = catsGame({
      blocks: 8,
      gimmick: { gimmicks: { stone: 2, tunnel: 1, ice: 3, item: 2 }, aiItems: 0, cats: 3 },
    });
    for (let i = 0; i < state.g.kind.length; i++) {
      if (state.g.kind[i] !== CELL_NORMAL) {
        expect(state.cats).not.toContain(i);
        expect(isBorder(i, W, W)).toBe(false);
        expect(state.board.blocked[i]).toBe(0);
        for (const c of state.cats) {
          expect(Array.from(state.board.nbr[c])).not.toContain(i);
        }
      }
    }
  });

  it('the same seed still reproduces the same board and cells', () => {
    const a = catsGame({ seed: 77, blocks: 10, gimmick: { gimmicks: { ice: 2 }, aiItems: 0, cats: 3 } });
    const b = catsGame({ seed: 77, blocks: 10, gimmick: { gimmicks: { ice: 2 }, aiItems: 0, cats: 3 } });
    expect(Array.from(a.board.blocked)).toEqual(Array.from(b.board.blocked));
    expect(Array.from(a.g.kind)).toEqual(Array.from(b.g.kind));
  });
});

describe('gimmickRules: cats block each other (13.7)', () => {
  it("a cat's cell is never enterable, blockable or a move of another cat", () => {
    const state = catsGame({ role: 'escape' });
    setCats(state, [toIndex(5, 5, W), toIndex(5, 6, W)]);
    state.turn = 'cat';
    const moves = legalCatMoves(state); // selected: cat 0 at the center
    expect(moves).not.toContain(toIndex(5, 6, W)); // the other cat's cell
    expect(isBlockable(state, toIndex(5, 5, W))).toBe(false);
    expect(isBlockable(state, toIndex(5, 6, W))).toBe(false);
    expect(legalBlocks(state)).not.toContain(toIndex(5, 5, W));
    expect(legalBlocks(state)).not.toContain(toIndex(5, 6, W));
    expect(legalBlocks(state).length).toBeGreaterThan(0); // the rest still is
  });

  it('a tunnel exit occupied by another cat keeps the cat on the entry end', () => {
    const state = catsGame({ role: 'escape' });
    const a = toIndex(5, 2, W);
    const b = toIndex(5, 8, W);
    state.g.kind[a] = 3; // tunnel
    state.g.kind[b] = 3;
    state.g.partner[a] = b;
    state.g.partner[b] = a;
    setCats(state, [toIndex(5, 3, W), b]);
    state.turn = 'cat';
    applyCatMove(state, a);
    expect(state.cats[0]).toBe(a); // stopped at the entry: the exit is taken
    expect(state.lastPath).toEqual([a]);
    expect(state.turn).toBe('trapper');
  });

  it('an ice slide stops before another cat as it would before a block', () => {
    const state = catsGame({ role: 'escape' });
    for (const c of [3, 4, 5, 6]) state.g.kind[toIndex(5, c, W)] = 4; // ice
    setCats(state, [toIndex(5, 2, W), toIndex(5, 6, W)]);
    state.turn = 'cat';
    applyCatMove(state, toIndex(5, 3, W));
    expect(state.cats[0]).toBe(toIndex(5, 5, W)); // last ice cell before the cat
  });

  it('a spring landing on another cat keeps the cat on the spring', () => {
    const state = catsGame({ role: 'escape' });
    const spring = toIndex(5, 4, W);
    state.g.kind[spring] = KIND_SPRING;
    setCats(state, [toIndex(5, 3, W), toIndex(5, 6, W)]);
    state.turn = 'cat';
    applyCatMove(state, spring);
    expect(state.cats[0]).toBe(spring); // (5,6) is occupied: no jump
  });

  it("a spring can't jump over a blocked middle cell (19.2)", () => {
    const state = catsGame({ role: 'escape' });
    const spring = toIndex(5, 4, W);
    const mid = toIndex(5, 5, W);
    state.g.kind[spring] = KIND_SPRING;
    setCats(state, [toIndex(5, 3, W), toIndex(5, 8, W)]);
    state.board.blocked[mid] = 1;
    state.turn = 'cat';
    applyCatMove(state, spring);
    expect(state.cats[0]).toBe(spring); // the middle cell is blocked: no jump
  });
});

describe('gimmickRules: anyEscape (13.7)', () => {
  /** Cat 0 next to the top edge, cat 1 at the center. */
  function nearEdge(state) {
    setCats(state, [toIndex(1, 3, W), toIndex(5, 5, W)], 'anyEscape');
    state.turn = 'cat';
    return state;
  }

  it('any cat reaching an edge wins at once', () => {
    const state = nearEdge(catsGame({ role: 'escape' }));
    const edge = gMoves(state, state.cats[0]).find((m) => isBorder(m.land, W, W));
    expect(edge).toBeDefined();
    applyCatMove(state, edge.to);
    expect(state.status).toBe('catWin');
    expect(state.cats[0]).toBe(edge.land);
    expect(state.cats.length).toBe(2); // nothing is removed under anyEscape
  });

  it('the trapper wins only when no cat has a legal move', () => {
    const state = catsGame();
    setCats(state, [toIndex(5, 3, W), toIndex(5, 7, W)], 'anyEscape');
    // cage cat 0 only; cat 1 still roams
    for (const j of state.board.nbr[state.cats[0]]) state.board.blocked[j] = 1;
    state.turn = 'cat';
    expect(evaluateStatus(state)).toBe('playing');
    // now cage cat 1 too
    for (const j of state.board.nbr[state.cats[1]]) state.board.blocked[j] = 1;
    expect(evaluateStatus(state)).toBe('trapperWin');
  });

  it('a stuck cat is skipped: the other cat still moves and play continues', () => {
    const state = catsGame({ role: 'escape' });
    setCats(state, [toIndex(5, 3, W), toIndex(5, 7, W)], 'anyEscape');
    for (const j of state.board.nbr[state.cats[0]]) state.board.blocked[j] = 1;
    state.turn = 'cat';
    syncSelection(state);
    expect(state.selectedCat).toBe(1); // auto-select the only movable cat
    expect(state.board.cat).toBe(state.cats[1]);
    const moves = legalCatMoves(state);
    expect(moves.length).toBeGreaterThan(0);
    applyCatMove(state, moves[0]);
    expect(state.turn).toBe('trapper');
    expect(state.status).toBe('playing');
  });

  it('the hammer never rescues a stuck cat (14.1 override)', () => {
    const state = catsGame();
    setCats(state, [toIndex(5, 3, W), toIndex(5, 7, W)], 'anyEscape');
    for (const c of state.cats) {
      for (const j of state.board.nbr[c]) state.board.blocked[j] = 1;
    }
    state.items.cat.hammer = 3;
    state.turn = 'cat';
    expect(evaluateStatus(state)).toBe('trapperWin');
  });
});

describe('gimmickRules: anyCatch (13.7)', () => {
  it('any stuck cat makes the trapper win', () => {
    const state = catsGame();
    setCats(state, [toIndex(5, 3, W), toIndex(5, 7, W)], 'anyCatch');
    for (const j of state.board.nbr[state.cats[0]]) state.board.blocked[j] = 1;
    state.turn = 'cat';
    expect(evaluateStatus(state)).toBe('trapperWin');
  });

  it('an escaped cat is removed and the game goes on', () => {
    const state = catsGame({ role: 'escape' });
    setCats(state, [toIndex(1, 3, W), toIndex(5, 5, W)], 'anyCatch');
    state.turn = 'cat';
    const edge = gMoves(state, state.cats[0]).find((m) => isBorder(m.land, W, W));
    applyCatMove(state, edge.to);
    expect(state.escaped).toBe(1);
    expect(state.cats.length).toBe(1);
    expect(state.cats[0]).toBe(toIndex(5, 5, W)); // the others play on
    expect(state.board.cat).toBe(toIndex(5, 5, W));
    expect(state.status).toBe('playing');
    expect(state.turn).toBe('trapper');
  });

  it('every cat escaping makes the cat side win', () => {
    const state = catsGame({ role: 'escape' });
    setCats(state, [toIndex(1, 3, W), toIndex(1, 7, W)], 'anyCatch');
    state.turn = 'cat';
    const e0 = gMoves(state, state.cats[0]).find((m) => isBorder(m.land, W, W));
    applyCatMove(state, e0.to);
    expect(state.status).toBe('playing');
    state.turn = 'cat';
    const e1 = gMoves(state, state.cats[0]).find((m) => isBorder(m.land, W, W));
    applyCatMove(state, e1.to);
    expect(state.escaped).toBe(2);
    expect(state.cats.length).toBe(0);
    expect(state.status).toBe('catWin');
  });
});

describe('gimmickRules: selection (13.7)', () => {
  it('selectCat switches the selected cat and mirrors board.cat', () => {
    const state = catsGame({ role: 'escape' });
    expect(selectCat(state, 1)).toBe(true);
    expect(state.selectedCat).toBe(1);
    expect(state.board.cat).toBe(state.cats[1]);
    expect(legalCatMoves(state)).toEqual(
      gMoves(state, state.cats[1], 1).map((m) => m.to),
    );
    expect(() => selectCat(state, 2)).toThrow();
  });

  it('one cat moves per turn: only the selected cat moves, then the trapper', () => {
    const state = catsGame({ role: 'escape' });
    setCats(state, C2, 'anyEscape', 0);
    state.turn = 'cat';
    const before = state.cats.slice();
    const to = legalCatMoves(state)[0];
    applyCatMove(state, to);
    expect(state.cats[0]).toBe(to);
    expect(state.cats[1]).toBe(before[1]); // the other cat did not move
    expect(state.moveCount).toBe(1);
    expect(state.turn).toBe('trapper');
  });

  it('syncSelection keeps the current cat when it can still move', () => {
    const state = catsGame({ role: 'escape' });
    setCats(state, C2, 'anyEscape', 1);
    syncSelection(state);
    expect(state.selectedCat).toBe(1);
    expect(state.board.cat).toBe(state.cats[1]);
  });
});

describe('gimmickAI: multi-cat (13.7)', () => {
  it('chooseAICat is pure and returns a cat index for multi-cat states', () => {
    const state = catsGame({ role: 'escape' });
    const before = state.cats.slice();
    const j = chooseAICat(state, mulberry32(1));
    expect([0, 1]).toContain(j); // both cats are equally good here
    expect(state.cats).toEqual(before);
    expect(state.selectedCat).toBe(0);
    expect(state.board.cat).toBe(state.cats[0]);
  });

  it('anyEscape: a cat that can escape this move always takes it', () => {
    const state = catsGame({ role: 'trapper', ai: 'normal' });
    setCats(state, [toIndex(1, 3, W), toIndex(5, 5, W)], 'anyEscape');
    state.turn = 'cat';
    expect(chooseAICat(state, mulberry32(1))).toBe(0);
    const m = chooseCatMove(state, mulberry32(2));
    const moves = gMoves(state, state.cats[0], 0);
    expect(moves.some((x) => x.to === m && isBorder(x.land, W, W))).toBe(true);
  });

  it('anyEscape: the closer cat is preferred over the far one', () => {
    const state = catsGame({ role: 'trapper', ai: 'normal' });
    setCats(state, [toIndex(2, 3, W), toIndex(5, 5, W)], 'anyEscape'); // dist 2 vs 5
    state.turn = 'cat';
    expect(gDistanceMap(state, 0).dist[state.cats[0]]).toBe(2);
    expect(chooseAICat(state, mulberry32(1))).toBe(0);
  });

  it('anyCatch: the most endangered cat is moved', () => {
    const state = catsGame({ role: 'trapper', ai: 'normal' });
    setCats(state, [toIndex(5, 3, W), toIndex(5, 7, W)], 'anyCatch');
    // pocket cat 0: block the ring at cat distance 2
    const g0 = gCatDistanceMap(state, 0);
    for (let i = 0; i < g0.length; i++) {
      if (g0[i] === 2) state.board.blocked[i] = 1;
    }
    state.turn = 'cat';
    expect(gReachableArea(state, 0)).toBeLessThan(gReachableArea(state, 1));
    expect(chooseAICat(state, mulberry32(1))).toBe(0);
  });

  it('anyCatch: a cat that can escape takes it even when another is endangered', () => {
    const state = catsGame({ role: 'trapper', ai: 'normal' });
    setCats(state, [toIndex(5, 3, W), toIndex(1, 7, W)], 'anyCatch');
    state.turn = 'cat';
    expect(chooseAICat(state, mulberry32(1))).toBe(1); // cat 1 is next to the edge
  });

  it('trapper anyCatch targets the easiest cat to trap', () => {
    const state = catsGame({ role: 'escape', ai: 'normal' });
    setCats(state, [toIndex(5, 3, W), toIndex(5, 7, W)], 'anyCatch');
    // cage cat 0 down to one exit
    const nbrs = Array.from(state.board.nbr[state.cats[0]]);
    for (const j of nbrs.slice(1)) state.board.blocked[j] = 1;
    state.turn = 'trapper';
    const open = nbrs[0];
    const m = chooseBlock(state, mulberry32(1));
    expect(legalBlocks(state)).toContain(m);
    expect(m).toBe(open); // the last exit of the easiest cat goes first
  });

  it('trapper anyEscape returns a legal block aimed at the urgent cat', () => {
    const state = catsGame({ role: 'escape', ai: 'normal' });
    setCats(state, [toIndex(2, 3, W), toIndex(5, 7, W)], 'anyEscape');
    state.turn = 'trapper';
    const m = chooseBlock(state, mulberry32(1));
    expect(legalBlocks(state)).toContain(m);
  });

  it('every difficulty returns legal moves on a seeded multi-cat board', () => {
    for (const ai of ['easy', 'normal', 'hard']) {
      for (const goal of ['anyEscape', 'anyCatch']) {
        const state = catsGame({
          role: 'escape',
          ai,
          blocks: 6,
          gimmick: { gimmicks: { stone: 1, tunnel: 1 }, aiItems: 1, cats: 3, catsGoal: goal },
          seed: 99,
        });
        const rng = mulberry32(7);
        expect(legalBlocks(state)).toContain(chooseBlock(state, rng));
        selectCat(state, chooseAICat(state, rng));
        const move = chooseCatMove(state, rng);
        expect(legalCatMoves(state)).toContain(move);
      }
    }
  });

  it('hintCat: anyEscape shows the smallest-dist cat, anyCatch the endangered one', () => {
    const esc = catsGame({ role: 'escape' });
    setCats(esc, [toIndex(2, 3, W), toIndex(5, 5, W)], 'anyEscape');
    expect(hintCat(esc)).toBe(0);
    expect(gShortestPathToEdge(esc, 0)[0]).toBe(esc.cats[0]);

    const catchGame = catsGame({ role: 'escape' });
    setCats(catchGame, [toIndex(5, 3, W), toIndex(5, 7, W)], 'anyCatch');
    const g0 = gCatDistanceMap(catchGame, 0);
    for (let i = 0; i < g0.length; i++) {
      if (g0[i] === 2) catchGame.board.blocked[i] = 1;
    }
    expect(hintCat(catchGame)).toBe(0);
  });

  it('shouldUseItem arms the double against the goal-relevant cat', () => {
    const state = catsGame({ role: 'escape', ai: 'hard' });
    setCats(state, [toIndex(2, 3, W), toIndex(5, 7, W)], 'anyEscape');
    state.items.trapper.double = 1;
    state.turn = 'trapper';
    expect(shouldUseItem(state, mulberry32(1))).toBe(true); // urgent cat at dist 2
  });
});

describe('gimmickRules: one block per free cat (18.2 / 19.1)', () => {
  it('the trapper turn starts with one block per cat that can still move', () => {
    const two = catsGame({ role: 'trapper', gimmick: { gimmicks: {}, aiItems: 0, cats: 2, catsGoal: 'anyEscape' } });
    expect(two.blocksLeft).toBe(2);
    // 19.1: anyCatch only needs one cat, so the trapper places one block
    // per turn (+1 with a double) — like a single-cat game
    const three = catsGame({ role: 'trapper', gimmick: { gimmicks: {}, aiItems: 0, cats: 3, catsGoal: 'anyCatch' } });
    expect(three.blocksLeft).toBe(1);
    // one cat keeps the old single-block turn
    const one = catsGame({ role: 'trapper', gimmick: { gimmicks: {}, aiItems: 0, cats: 1 } });
    expect(one.blocksLeft).toBe(1);
  });

  it('an anyCatch double adds one block to the single-block turn (19.1)', () => {
    const state = catsGame({ role: 'trapper', gimmick: { gimmicks: {}, aiItems: 0, cats: 3, catsGoal: 'anyCatch' } });
    state.items.trapper.double = 1;
    armItem(state);
    expect(state.blocksLeft).toBe(2); // 1 per turn + the double
    applyBlock(state, legalBlocks(state)[0]);
    expect(state.turn).toBe('trapper');
    applyBlock(state, legalBlocks(state)[0]);
    expect(state.turn).toBe('cat');
  });

  it('two free cats place two blocks, then the turn passes', () => {
    const state = catsGame({ role: 'trapper', gimmick: { gimmicks: {}, aiItems: 0, cats: 2, catsGoal: 'anyEscape' } });
    const b1 = legalBlocks(state)[0];
    applyBlock(state, b1);
    expect(state.turn).toBe('trapper'); // the first block keeps the turn
    expect(state.blocksLeft).toBe(1);
    const b2 = legalBlocks(state).find((i) => i !== b1);
    applyBlock(state, b2);
    expect(state.turn).toBe('cat');
    expect(state.blocksLeft).toBe(1);
    expect(state.history.map((h) => h.kind)).toEqual(['block', 'block']);
  });

  it('a caged cat does not count', () => {
    const state = catsGame({ role: 'trapper', gimmick: { gimmicks: {}, aiItems: 0, cats: 2, catsGoal: 'anyEscape' } });
    for (const j of state.board.nbr[state.cats[0]]) state.board.blocked[j] = 1; // cage cat 0
    expect(state.blocksLeft).toBe(2); // the budget was set at turn start
    // the next trapper turn sees only one free cat
    selectCat(state, 1);
    state.turn = 'cat';
    applyCatMove(state, legalCatMoves(state)[0]);
    expect(state.turn).toBe('trapper');
    expect(state.blocksLeft).toBe(1);
  });

  it('a double adds one more block to the free-cat budget', () => {
    const state = catsGame({ role: 'trapper', gimmick: { gimmicks: {}, aiItems: 0, cats: 2, catsGoal: 'anyEscape' } });
    state.items.trapper.double = 1;
    armItem(state);
    expect(state.blocksLeft).toBe(3); // 2 free cats + the double
    for (let k = 0; k < 2; k++) {
      const b = legalBlocks(state)[k];
      applyBlock(state, b);
      expect(state.turn).toBe('trapper');
    }
    applyBlock(state, legalBlocks(state)[2]);
    expect(state.turn).toBe('cat');
    expect(state.armed).toBe(false);
  });

  it('an escaped (anyCatch) cat no longer counts', () => {
    const state = catsGame({ role: 'escape', gimmick: { gimmicks: {}, aiItems: 0, cats: 2, catsGoal: 'anyCatch' } });
    setCats(state, [toIndex(1, 3, W), toIndex(5, 5, W)], 'anyCatch');
    state.turn = 'cat';
    const edge = gMoves(state, state.cats[0]).find((m) => isBorder(m.land, W, W));
    applyCatMove(state, edge.to); // cat 0 runs off the board
    expect(state.escaped).toBe(1);
    expect(state.cats.length).toBe(1);
    expect(state.turn).toBe('trapper');
    expect(state.blocksLeft).toBe(1); // only the remaining cat counts
  });

  it('the turn passes at once when no cat can move (empty budget)', () => {
    const state = catsGame({ role: 'escape', gimmick: { gimmicks: {}, aiItems: 0, cats: 2, catsGoal: 'anyEscape' } });
    const c1 = toIndex(5, 5, W);
    const over = toIndex(5, 6, W); // the block the corner jump hops over
    const pocket = toIndex(5, 7, W); // sealed landing
    setCats(state, [c1, toIndex(2, 2, W)], 'anyEscape', 0);
    state.board.blocked.fill(1);
    for (const i of [c1, pocket, state.cats[1]]) state.board.blocked[i] = 0;
    state.features = { power: true, dash: false, jump: true, storm: false };
    state.power = 6;
    state.turn = 'cat';
    syncSelection(state);
    expect(state.selectedCat).toBe(0);
    armPower(state, 'jump'); // the only way out of the cage (14.5)
    applyCatMove(state, pocket); // hops into the sealed pocket
    expect(state.board.cat).toBe(pocket);
    // both cats are stuck → the empty trapper turn passes straight back
    // and the status check ends the game (18.2)
    expect(state.turn).toBe('cat');
    expect(state.status).toBe('trapperWin');
  });
});

describe('gimmickRules: dried fish with several cats (18.4)', () => {
  it('a block that touches any cat is never crumbled', () => {
    const state = catsGame({ role: 'trapper', gimmick: { gimmicks: {}, aiItems: 0, cats: 2, catsGoal: 'anyEscape' } });
    setCats(state, [toIndex(5, 5, W), toIndex(5, 6, W)], 'anyEscape', 0);
    const between = toIndex(5, 7, W); // next to cat 1
    const far = toIndex(0, 0, W);
    state.turn = 'trapper';
    applyBlock(state, far);
    state.turn = 'trapper';
    applyBlock(state, between);
    state.turn = 'cat';
    // cat 0 lands on a fish cell next to `between`
    const fishCell = toIndex(5, 4, W);
    state.g.kind[fishCell] = KIND_FISH;
    applyCatMove(state, fishCell);
    expect(state.history.at(-1).kind).toBe('fish');
    expect(state.board.blocked[between]).toBe(1); // cat 1 still touches it
    expect(state.board.blocked[far]).toBe(0); // the newest safe block crumbled
    expect(state.crumbles).toEqual([far]);
  });
});

describe('gimmickAI: Hard on multi-cat boards (L17-20)', () => {
  function levelGame(course, level, seed) {
    const lv = getLevel(course, level);
    return newGame({
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

  it('chooseCatMove and chooseBlock answer with legal moves', () => {
    // (the <100 ms timing budget lives in test/perf, run via npm run test:perf)
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

        const rng = mulberry32(seed);
        selectCat(state, chooseAICat(state, rng));
        const move = chooseCatMove(state, rng);
        expect(legalCatMoves(state), `${tag} cat move`).toContain(move);

        state.turn = 'trapper';
        const block = chooseBlock(state, mulberry32(seed));
        expect(legalBlocks(state), `${tag} block`).toContain(block);
      }
    }
  });

  it('a full greedy multi-cat game finishes with legal moves only', () => {
    const lv = getLevel('trapper', 20);
    const state = newGame({
      role: 'trapper',
      ai: 'normal', // normal keeps the greedy game fast
      blocks: blocksFor(lv, 'normal'),
      gimmick: {
        gimmicks: lv.gimmicks,
        aiItems: lv.aiItems,
        cats: lv.cats,
        catsGoal: lv.catsGoal,
      },
      seed: 5,
    });
    const rng = mulberry32(5);
    let steps = 0;
    while (state.status === 'playing' && steps++ < 200) {
      if (state.turn === 'trapper') {
        const m = chooseBlock(state, rng);
        expect(legalBlocks(state)).toContain(m);
        applyBlock(state, m);
      } else {
        selectCat(state, chooseAICat(state, rng));
        const m = chooseCatMove(state, rng);
        expect(legalCatMoves(state)).toContain(m);
        applyCatMove(state, m);
      }
    }
    expect(['catWin', 'trapperWin']).toContain(state.status);
    expect(steps).toBeLessThan(200);
  });
});
