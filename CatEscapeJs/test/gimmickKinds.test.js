import { describe, it, expect } from 'vitest';
import {
  newGame,
  legalBlocks,
  legalCatMoves,
  applyBlock,
  applyCatMove,
  armItem,
  canUseItem,
} from '../src/game/gimmick/gimmickRules.js';
import {
  KIND_ITEM,
  KIND_STONE,
  KIND_TUNNEL,
  KIND_ICE,
  KIND_ARROW,
  KIND_BRITTLE,
  KIND_SPRING,
  isBlockable,
} from '../src/game/gimmick/registry.js';
import { gShortestPathToEdge, gDistanceMap } from '../src/game/gimmick/graph.js';
import {
  chooseBlock,
  chooseCatMove,
  shouldUseItem,
} from '../src/game/gimmick/gimmickAI.js';
import { getLevel, blocksFor } from '../src/game/play/levels.js';
import { isBorder, toIndex } from '../src/game/hex.js';
import { hexDistance, DIR_E } from '../src/game/gimmick/hexDir.js';
import { mulberry32 } from '../src/game/rng.js';

const W = 11;

/** Empty board (cat at the center) with control of the turn. */
function bareGame(opts = {}) {
  return newGame({
    role: 'trapper',
    ai: 'normal',
    blocks: 0,
    gimmick: { gimmicks: {}, aiItems: 0 },
    seed: 1234,
    ...opts,
  });
}

/** Mark a cell as a gimmick kind (and give it extra data when needed). */
function setKind(state, i, kind, extra = {}) {
  state.g.kind[i] = kind;
  if (extra.dir !== undefined) state.g.dir[i] = extra.dir;
  if (extra.partner !== undefined) {
    state.g.partner[i] = extra.partner;
    state.g.kind[extra.partner] = kind;
    state.g.partner[extra.partner] = i;
  }
}

function countKind(state, kind) {
  let n = 0;
  for (const v of state.g.kind) if (v === kind) n++;
  return n;
}

describe('tunnel (13.3)', () => {
  it('entering either end lands the cat on the partner', () => {
    const state = bareGame({ role: 'escape' });
    const a = toIndex(5, 4, W); // west of the cat
    const b = toIndex(5, 9, W);
    setKind(state, a, KIND_TUNNEL, { partner: b });
    state.turn = 'cat';
    applyCatMove(state, a);
    expect(state.board.cat).toBe(b); // the cat rests on the exit
    expect(state.history.at(-1).kind).toBe('move');
    expect(state.lastPath).toEqual([a, b]);

    // and back the other way, entering the exit
    state.board.cat = toIndex(5, 8, W);
    state.turn = 'cat';
    applyCatMove(state, b);
    expect(state.board.cat).toBe(a);
  });

  it('placement makes pairs at hex distance >= 4 on free inner cells', () => {
    const state = newGame({
      role: 'escape',
      ai: 'normal',
      blocks: 5,
      gimmick: { gimmicks: { tunnel: 2 }, aiItems: 0 },
      seed: 7,
    });
    expect(countKind(state, KIND_TUNNEL)).toBe(4);
    const ends = [];
    for (let i = 0; i < state.g.kind.length; i++) {
      if (state.g.kind[i] === KIND_TUNNEL) ends.push(i);
    }
    for (const a of ends) {
      const p = state.g.partner[a];
      expect(p).toBeGreaterThanOrEqual(0);
      expect(hexDistance(a, p, W)).toBeGreaterThanOrEqual(4);
      expect(isBorder(a, W, W)).toBe(false);
      expect(a).not.toBe(state.board.cat);
    }
  });
});

describe('ice (13.3)', () => {
  /** Cat at (5,2) facing a horizontal ice patch. */
  function iceGame(iceCells, blocked = []) {
    const state = bareGame({ role: 'escape' });
    state.board.cat = toIndex(5, 2, W);
    for (const c of iceCells) setKind(state, toIndex(5, c, W), KIND_ICE);
    for (const c of blocked) state.board.blocked[toIndex(5, c, W)] = 1;
    state.turn = 'cat';
    return state;
  }

  it('the slide stops on the first non-ice cell', () => {
    const state = iceGame([3, 4, 5]);
    applyCatMove(state, toIndex(5, 3, W));
    expect(state.board.cat).toBe(toIndex(5, 6, W));
    expect(state.lastPath).toEqual([
      toIndex(5, 3, W),
      toIndex(5, 4, W),
      toIndex(5, 5, W),
      toIndex(5, 6, W),
    ]);
  });

  it('the slide stops on the last ice cell before a block', () => {
    const state = iceGame([3, 4, 5], [6]);
    applyCatMove(state, toIndex(5, 3, W));
    expect(state.board.cat).toBe(toIndex(5, 5, W));
    expect(state.lastPath).toEqual([toIndex(5, 3, W), toIndex(5, 4, W), toIndex(5, 5, W)]);
  });

  it('reaching an edge cell during the slide ends it there (cat wins)', () => {
    const state = iceGame([8, 9]); // (5,10) is the edge beyond the patch
    state.board.cat = toIndex(5, 7, W); // one step before the patch
    applyCatMove(state, toIndex(5, 8, W));
    expect(state.board.cat).toBe(toIndex(5, 10, W));
    expect(state.status).toBe('catWin');
  });

  it('ice cells are placed as one connected patch', () => {
    const state = newGame({
      role: 'escape',
      ai: 'normal',
      blocks: 4,
      gimmick: { gimmicks: { ice: 6 }, aiItems: 0 },
      seed: 9,
    });
    expect(countKind(state, KIND_ICE)).toBe(6);
    // flood the ice cells through ice-to-ice adjacency
    const cells = [];
    for (let i = 0; i < state.g.kind.length; i++) {
      if (state.g.kind[i] === KIND_ICE) cells.push(i);
    }
    const seen = new Set([cells[0]]);
    const stack = [cells[0]];
    while (stack.length > 0) {
      const v = stack.pop();
      for (const u of state.board.nbr[v]) {
        if (state.g.kind[u] === KIND_ICE && !seen.has(u)) {
          seen.add(u);
          stack.push(u);
        }
      }
    }
    expect(seen.size).toBe(cells.length);
  });
});

describe('arrow (13.3)', () => {
  it('entering against the arrow is illegal; entering along it is legal', () => {
    const state = bareGame({ role: 'escape' });
    const cell = toIndex(5, 5, W);
    setKind(state, cell, KIND_ARROW, { dir: DIR_E });
    state.turn = 'cat';

    // from the west neighbor the move heads E  Eallowed
    state.board.cat = toIndex(5, 4, W);
    expect(legalCatMoves(state)).toContain(cell);
    applyCatMove(state, cell);
    expect(state.board.cat).toBe(cell);

    // from the east neighbor the move heads W  Erefused
    state.board.cat = toIndex(5, 6, W);
    state.turn = 'cat';
    expect(legalCatMoves(state)).not.toContain(cell);
    expect(() => applyCatMove(state, cell)).toThrow();

    // leaving an arrow cell is free
    const leave = legalCatMoves(state);
    expect(leave.length).toBeGreaterThan(0);
    applyCatMove(state, leave[0]);
    expect(state.board.cat).not.toBe(cell);
  });

  it('arrows are placed on inner cells with an on-board entry side', () => {
    const state = newGame({
      role: 'escape',
      ai: 'normal',
      blocks: 4,
      gimmick: { gimmicks: { arrow: 4 }, aiItems: 0 },
      seed: 11,
    });
    expect(countKind(state, KIND_ARROW)).toBe(4);
    for (let i = 0; i < state.g.kind.length; i++) {
      if (state.g.kind[i] !== KIND_ARROW) continue;
      expect(isBorder(i, W, W)).toBe(false);
      const dir = state.g.dir[i];
      expect(dir).toBeGreaterThanOrEqual(0);
      expect(dir).toBeLessThanOrEqual(5);
    }
  });
});

describe('brittle (13.3)', () => {
  it('a block on a brittle cell crumbles after exactly 3 trapper turns', () => {
    const state = bareGame({ role: 'trapper' });
    state.board.cat = toIndex(6, 5, W); // off the brittle cell
    const cell = toIndex(5, 5, W);
    setKind(state, cell, KIND_BRITTLE);
    state.items.cat.hammer = 0;

    applyBlock(state, cell); // placed with ttl 3; the turn ends ↁEfirst tick
    expect(state.board.blocked[cell]).toBe(1);
    expect(state.g.ttl[cell]).toBe(2);
    expect(state.crumbles).toEqual([]);

    // second trapper turn end ↁEttl 1
    state.turn = 'cat';
    applyCatMove(state, legalCatMoves(state)[0]);
    applyBlock(state, legalBlocks(state)[0]);
    expect(state.board.blocked[cell]).toBe(1);
    expect(state.g.ttl[cell]).toBe(1);
    expect(state.crumbles).toEqual([]);

    // third trapper turn end ↁEcrumbles; the cell stays brittle
    state.turn = 'cat';
    applyCatMove(state, legalCatMoves(state)[0]);
    applyBlock(state, legalBlocks(state)[0]);
    expect(state.board.blocked[cell]).toBe(0);
    expect(state.g.ttl[cell]).toBe(0);
    expect(state.g.kind[cell]).toBe(KIND_BRITTLE);
    expect(state.crumbles).toEqual([cell]);

    // a new block on the same cell restarts the timer (ttl 3, minus the
    // placement turn's own tick)
    state.turn = 'cat';
    applyCatMove(state, legalCatMoves(state)[0]);
    applyBlock(state, cell);
    expect(state.board.blocked[cell]).toBe(1);
    expect(state.g.ttl[cell]).toBe(2);
  });

  it('the second block of a double also ticks the timers once', () => {
    const state = bareGame({ role: 'trapper' });
    state.board.cat = toIndex(6, 5, W);
    const brittle = toIndex(5, 5, W);
    setKind(state, brittle, KIND_BRITTLE);
    state.items.trapper.double = 1;
    armItem(state); // the double: blocksLeft = 2
    applyBlock(state, brittle); // ttl 3, the double keeps the turn
    expect(state.g.ttl[brittle]).toBe(3);
    expect(state.turn).toBe('trapper');
    const second = legalBlocks(state).find((i) => i !== brittle);
    applyBlock(state, second); // the trapper's turn ends
    expect(state.g.ttl[brittle]).toBe(2);
    expect(state.turn).toBe('cat');
  });
});

describe('spring (13.3)', () => {
  it('entering a spring jumps the cat 2 cells in the same dir', () => {
    const state = bareGame({ role: 'escape' });
    state.board.cat = toIndex(5, 3, W);
    setKind(state, toIndex(5, 4, W), KIND_SPRING);
    state.turn = 'cat';
    applyCatMove(state, toIndex(5, 4, W));
    expect(state.board.cat).toBe(toIndex(5, 6, W)); // jumped over (5,5)
    expect(state.lastPath).toEqual([toIndex(5, 4, W), toIndex(5, 6, W)]);
  });

  it('a blocked landing keeps the cat on the spring', () => {
    const state = bareGame({ role: 'escape' });
    state.board.cat = toIndex(5, 3, W);
    setKind(state, toIndex(5, 4, W), KIND_SPRING);
    state.board.blocked[toIndex(5, 6, W)] = 1;
    state.turn = 'cat';
    applyCatMove(state, toIndex(5, 4, W));
    expect(state.board.cat).toBe(toIndex(5, 4, W));
    expect(state.lastPath).toEqual([toIndex(5, 4, W)]);
    expect(state.status).toBe('playing');
  });

  it("a blocked middle cell keeps the cat on the spring (19.2)", () => {
    const state = bareGame({ role: 'escape' });
    state.board.cat = toIndex(5, 3, W);
    setKind(state, toIndex(5, 4, W), KIND_SPRING);
    state.board.blocked[toIndex(5, 5, W)] = 1; // the jump needs both cells free
    state.turn = 'cat';
    applyCatMove(state, toIndex(5, 4, W));
    expect(state.board.cat).toBe(toIndex(5, 4, W));
    expect(state.lastPath).toEqual([toIndex(5, 4, W)]);
    expect(state.status).toBe('playing');
  });

  it('an off-board landing keeps the cat on the spring', () => {
    const state = bareGame({ role: 'escape' });
    state.board.cat = toIndex(5, 8, W);
    setKind(state, toIndex(5, 9, W), KIND_SPRING); // the jump would leave the board
    state.turn = 'cat';
    applyCatMove(state, toIndex(5, 9, W));
    expect(state.board.cat).toBe(toIndex(5, 9, W));
    expect(state.status).toBe('playing');
  });

  it('a jump onto an edge cell wins', () => {
    const state = bareGame({ role: 'escape' });
    state.board.cat = toIndex(5, 7, W);
    setKind(state, toIndex(5, 8, W), KIND_SPRING);
    state.turn = 'cat';
    applyCatMove(state, toIndex(5, 8, W));
    expect(state.board.cat).toBe(toIndex(5, 10, W));
    expect(state.status).toBe('catWin');
  });
});

describe('blockability (13.3 / 13.6)', () => {
  it("the trapper can't block item, stone, tunnel, arrow or spring cells", () => {
    const state = newGame({
      role: 'trapper',
      ai: 'normal',
      blocks: 3,
      gimmick: {
        gimmicks: { item: 2, stone: 2, tunnel: 1, arrow: 2, brittle: 2, spring: 2 },
        aiItems: 0,
      },
      seed: 3,
    });
    const blocks = legalBlocks(state);
    for (let i = 0; i < state.g.kind.length; i++) {
      const k = state.g.kind[i];
      if (k === KIND_ITEM || k === KIND_STONE || k === KIND_TUNNEL || k === KIND_ARROW || k === KIND_SPRING) {
        expect(blocks).not.toContain(i);
        expect(isBlockable(state, i)).toBe(false);
      } else if (k === KIND_BRITTLE || k === KIND_ICE) {
        expect(isBlockable(state, i)).toBe(true); // a normal block target
      }
    }
    expect(countKind(state, KIND_ITEM)).toBe(2);
    expect(countKind(state, KIND_STONE)).toBe(2);
    expect(countKind(state, KIND_SPRING)).toBe(2);
    // and the route survives the whole placement
    expect(gDistanceMap(state).dist[state.board.cat]).not.toBe(-1);
  });
});

describe('hint (13.2 / 13.6)', () => {
  it('the path includes tunnel cells', () => {
    const state = bareGame({ role: 'escape' });
    state.board.blocked.fill(1);
    const cat = toIndex(5, 2, W);
    const entry = toIndex(5, 3, W);
    const exit = toIndex(5, 9, W);
    const edge = toIndex(5, 10, W);
    for (const i of [cat, entry, exit, edge]) state.board.blocked[i] = 0;
    state.board.cat = cat;
    setKind(state, entry, KIND_TUNNEL, { partner: exit });
    const path = gShortestPathToEdge(state);
    expect(path).toEqual([cat, entry, exit, edge]);
  });

  it('the path includes ice and spring cells', () => {
    const state = bareGame({ role: 'escape' });
    state.board.blocked.fill(1);
    const cells = [];
    for (let c = 2; c <= 10; c++) cells.push(toIndex(5, c, W));
    for (const i of cells) state.board.blocked[i] = 0;
    state.board.cat = toIndex(5, 2, W);
    setKind(state, toIndex(5, 3, W), KIND_ICE);
    setKind(state, toIndex(5, 4, W), KIND_ICE);
    setKind(state, toIndex(5, 5, W), KIND_SPRING);
    state.turn = 'cat';
    const path = gShortestPathToEdge(state);
    // cat ↁEslide over the ice onto the spring ↁEspring jump ↁEwalk out
    expect(path).toEqual([
      toIndex(5, 2, W),
      toIndex(5, 3, W),
      toIndex(5, 4, W),
      toIndex(5, 5, W), // the slide stops on the spring
      toIndex(5, 6, W), // the spring launch cell (entered)
      toIndex(5, 7, W), // the spring jump lands here
      toIndex(5, 8, W),
      toIndex(5, 9, W),
      toIndex(5, 10, W),
    ]);
  });
});

describe('AI under every gimmick (13.3)', () => {
  it('the normal trapper discounts brittle candidates', () => {
    // brittle cells on the cat's shortest route are worth less: with the
    // cat at distance > 1 a brittle candidate that neither traps nor gets
    // the cat close must lose against the plain alternatives
    const state = bareGame({ role: 'trapper', ai: 'normal' });
    state.board.cat = toIndex(5, 5, W);
    // a corridor of brittle cells up the middle, plain cells elsewhere
    for (let r = 0; r <= 4; r++) setKind(state, toIndex(r, 5, W), KIND_BRITTLE);
    state.turn = 'trapper';
    for (let t = 0; t < 8; t++) {
      const m = chooseBlock(state, mulberry32(t));
      expect(legalBlocks(state)).toContain(m);
      // the corridor brittle cells are on the route but the AI avoids them
      // while the cat is far away (dist > 1)
      if (gDistanceMap(state).dist[state.board.cat] > 1) {
        const inCorridor = m < 5 * W && (m % W) === 5;
        expect(inCorridor).toBe(false);
      }
      state.board.blocked[m] = 1;
      state.turn = 'cat';
      const moves = legalCatMoves(state);
      if (moves.length === 0) break;
      applyCatMove(state, moves[0]);
      if (state.status !== 'playing') break;
      state.turn = 'trapper';
    }
  });

  it('Hard answers with legal moves on an L16 board with every gimmick', () => {
    // (the <100 ms timing budget lives in test/perf, run via npm run test:perf)
    for (const course of ['escape', 'trapper']) {
      const lv = getLevel(course, 16);
      for (const seed of [11, 22, 33]) {
        const state = newGame({
          role: course,
          ai: 'hard',
          blocks: blocksFor(lv, 'normal'),
          gimmick: { gimmicks: lv.gimmicks, aiItems: lv.aiItems },
          playerItems: course === 'escape' ? { hammer: 2, double: 0 } : { hammer: 0, double: 2 },
          seed,
        });
        expect(countKind(state, KIND_BRITTLE)).toBe(lv.gimmicks.brittle);
        expect(countKind(state, KIND_ICE)).toBe(lv.gimmicks.ice);

        const rngB = mulberry32(seed);
        const block = chooseBlock(state, rngB);
        expect(legalBlocks(state)).toContain(block);

        // the AI cat's move on the trapper course (it holds hammers there)
        if (course === 'trapper') {
          state.turn = 'cat';
          const move = chooseCatMove(state, mulberry32(seed ^ 0x5f5f));
          expect(legalCatMoves(state)).toContain(move);
        }
      }
    }
  });
});

describe('controller data (13.6)', () => {
  it('a gimmick move records the traversed path for animateCatPath', () => {
    const state = bareGame({ role: 'escape' });
    state.board.cat = toIndex(5, 2, W);
    setKind(state, toIndex(5, 3, W), KIND_ICE);
    setKind(state, toIndex(5, 4, W), KIND_ICE);
    state.turn = 'cat';
    applyCatMove(state, toIndex(5, 3, W));
    expect(state.lastPath).toEqual([toIndex(5, 3, W), toIndex(5, 4, W), toIndex(5, 5, W)]);
  });

  it('crumbles are recorded on the state for the view', () => {
    const state = bareGame({ role: 'trapper' });
    state.board.cat = toIndex(6, 5, W);
    const cell = toIndex(5, 5, W);
    setKind(state, cell, KIND_BRITTLE);
    state.turn = 'trapper';
    applyBlock(state, cell); // tick 1
    for (let t = 0; t < 2; t++) {
      state.turn = 'cat';
      const moves = legalCatMoves(state);
      applyCatMove(state, moves[0]);
      if (state.status !== 'playing') break;
      applyBlock(state, legalBlocks(state)[0]); // tick 2, then the crumble
    }
    expect(state.crumbles).toContain(cell);
  });

  it('the hammer can only be armed once a turn through the ruleset gate', () => {
    const state = bareGame({ role: 'escape' });
    state.items.cat.hammer = 2;
    state.turn = 'cat';
    const target = toIndex(3, 5, W); // distance 2 from the center
    state.board.blocked[target] = 1;
    expect(canUseItem(state, 'cat')).toBe(true);
    armItem(state);
    applyCatMove(state, target); // break
    expect(state.turn).toBe('cat');
    expect(canUseItem(state, 'cat')).toBe(false); // hammerUsed this turn
  });
});
