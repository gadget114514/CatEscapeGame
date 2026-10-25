import { describe, it, expect } from 'vitest';
import {
  newGame,
  legalBlocks,
  legalCatMoves,
  applyBlock,
  applyCatMove,
  armItem,
  disarmItem,
  canUseItem,
  evaluateStatus,
  CELL_NORMAL,
  CELL_ITEM,
  CELL_STONE,
} from '../src/game/gimmick/gimmickRules.js';
import { distanceMap, catDistanceMap } from '../src/game/board.js';
import { isBorder, toIndex } from '../src/game/hex.js';
import { hexDistance } from '../src/game/gimmick/hexDir.js';
import { KIND_SPRING, KIND_BRITTLE } from '../src/game/gimmick/registry.js';

const W = 11;

function makeGame(opts = {}) {
  return newGame({
    role: 'trapper',
    ai: 'normal',
    blocks: 7,
    gimmick: { gimmicks: { item: 4, stone: 2 }, aiItems: 0 },
    seed: 1234,
    ...opts,
  });
}

/** Empty board with the cat at the center and control of the turn. */
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

function countByCell(state) {
  let item = 0;
  let stone = 0;
  for (const v of state.cells) {
    if (v === CELL_ITEM) item++;
    else if (v === CELL_STONE) stone++;
  }
  return { item, stone };
}

describe('gimmickRules: setup', () => {
  it('carries the per-cell gimmick data in state.g (cells aliases kind)', () => {
    const state = makeGame();
    expect(state.g).toBeDefined();
    expect(state.g.kind).toBeInstanceOf(Uint8Array);
    expect(state.g.partner).toBeInstanceOf(Int16Array);
    expect(state.g.dir).toBeInstanceOf(Int8Array);
    expect(state.g.ttl).toBeInstanceOf(Int16Array);
    expect(state.cells).toBe(state.g.kind);
  });

  it('places the requested blocks, item cells and stones', () => {
    const state = makeGame();
    const blocks = state.board.blocked.reduce((a, b) => a + b, 0);
    expect(blocks).toBe(7);
    const { item, stone } = countByCell(state);
    expect(item).toBe(4);
    expect(stone).toBe(2);
  });

  it('never places gimmick cells on the cat, a block or an edge cell', () => {
    const state = makeGame();
    const b = state.board;
    for (let i = 0; i < b.W * b.H; i++) {
      if (state.cells[i] !== CELL_NORMAL) {
        expect(i).not.toBe(b.cat);
        expect(b.blocked[i]).toBe(0);
        expect(isBorder(i, b.W, b.H)).toBe(false);
      }
    }
  });

  it('places item cells at cat distance 2-4 when possible', () => {
    const state = makeGame({ gimmick: { gimmicks: { item: 4 }, aiItems: 0 } });
    const g = catDistanceMap(state.board);
    const itemCells = [];
    for (let i = 0; i < state.cells.length; i++) {
      if (state.cells[i] === CELL_ITEM) itemCells.push(i);
    }
    expect(itemCells.length).toBe(4);
    for (const i of itemCells) expect(g[i]).toBeGreaterThanOrEqual(2);
    for (const i of itemCells) expect(g[i]).toBeLessThanOrEqual(4);
  });

  it('falls back to any free inner cell when the 2-4 band runs out', () => {
    // 60 item cells cannot fit in the distance 2-4 band (54 cells on an
    // empty board), so the tail must come from any free inner cell.
    const state = bareGame({ gimmick: { gimmicks: { item: 60 }, aiItems: 0 } });
    const g = catDistanceMap(state.board);
    const itemCells = [];
    for (let i = 0; i < state.cells.length; i++) {
      if (state.cells[i] === CELL_ITEM) itemCells.push(i);
    }
    expect(itemCells.length).toBe(60);
    for (const i of itemCells) {
      expect(state.board.blocked[i]).toBe(0);
      expect(isBorder(i, 11, 11)).toBe(false);
      expect(i).not.toBe(state.board.cat);
    }
    expect(itemCells.some((i) => g[i] < 2 || g[i] > 4)).toBe(true);
  });

  it('guarantees the cat a route to the edge', () => {
    for (const seed of [1, 2, 3, 42, 999]) {
      const state = makeGame({ seed });
      expect(distanceMap(state.board).dist[state.board.cat]).not.toBe(-1);
    }
  });

  it('is seeded: the same seed gives the same board and cells', () => {
    const a = makeGame({ seed: 777 });
    const b = makeGame({ seed: 777 });
    expect(Array.from(a.board.blocked)).toEqual(Array.from(b.board.blocked));
    expect(Array.from(a.cells)).toEqual(Array.from(b.cells));
    expect(a.items).toEqual(b.items);
    const c = makeGame({ seed: 778 });
    expect(Array.from(a.board.blocked)).not.toEqual(Array.from(c.board.blocked));
  });

  it('first move belongs to the player role', () => {
    expect(makeGame({ role: 'trapper' }).turn).toBe('trapper');
    expect(makeGame({ role: 'escape' }).turn).toBe('cat');
  });

  it('seeds items per side: player from playerItems, AI from aiItems', () => {
    const trapper = newGame({
      role: 'trapper',
      ai: 'normal',
      blocks: 7,
      gimmick: { gimmicks: { item: 2 }, aiItems: 3 },
      playerItems: { hammer: 5, double: 2 },
      seed: 1,
    });
    expect(trapper.items).toEqual({ trapper: { double: 2 }, cat: { hammer: 3 } });

    const escape = newGame({
      role: 'escape',
      ai: 'normal',
      blocks: 7,
      gimmick: { gimmicks: { item: 2 }, aiItems: 1 },
      playerItems: { hammer: 4, double: 9 },
      seed: 1,
    });
    expect(escape.items).toEqual({ trapper: { double: 1 }, cat: { hammer: 4 } });
  });

  it('caps items at 9 and rejects a missing block count', () => {
    const s = newGame({
      role: 'escape',
      ai: 'easy',
      blocks: 5,
      playerItems: { hammer: 99, double: 0 },
      seed: 3,
    });
    expect(s.items.cat.hammer).toBe(9);
    expect(() => newGame({ role: 'trapper', ai: 'easy', seed: 1 })).toThrow();
  });
});

describe('gimmickRules: legal moves', () => {
  it('legalBlocks excludes item and stone cells', () => {
    const state = makeGame();
    const blocks = legalBlocks(state);
    for (const i of blocks) expect(state.cells[i]).toBe(CELL_NORMAL);
    expect(blocks.includes(state.board.cat)).toBe(false);
    for (const i of state.cells.keys()) {
      if (state.cells[i] !== CELL_NORMAL) expect(blocks).not.toContain(i);
    }
    expect(blocks.length).toBeGreaterThan(0);
  });

  it('legalCatMoves are the empty neighbors; item cells are walkable', () => {
    const state = bareGame();
    const nbrs = Array.from(state.board.nbr[state.board.cat]);
    state.cells[nbrs[0]] = CELL_ITEM;
    const moves = legalCatMoves(state);
    expect([...moves].sort((a, b) => a - b)).toEqual([...nbrs].sort((a, b) => a - b));
    expect(moves).toContain(nbrs[0]);
  });

  it('while armed, legalCatMoves adds the hammer targets (distance 2-3)', () => {
    const state = bareGame({ role: 'escape' });
    const adjacent = state.board.nbr[state.board.cat][0];
    const far = toIndex(3, 5, 11); // hex distance 2 from the center
    expect(hexDistance(state.board.cat, far, 11)).toBe(2);
    state.board.blocked[adjacent] = 1;
    state.board.blocked[far] = 1;
    state.items.cat.hammer = 1;
    state.turn = 'cat';
    const before = legalCatMoves(state);
    expect(before).not.toContain(adjacent); // a move never enters a block
    expect(before).not.toContain(far);
    state.armed = true;
    const after = legalCatMoves(state);
    expect(after).toContain(far); // a distance 2-3 block is breakable
    expect(after).not.toContain(adjacent); // adjacent blocks never break (14.1)
  });
});

describe('gimmickRules: hammer (14.1)', () => {
  const TARGET = toIndex(0, 4, 11); // edge cell at hex distance 2 from the cat

  /**
   * Empty board, cat at (2,5), one blocked edge cell at hex distance 2 —
   * the only break target.
   */
  function armedCatGame() {
    const state = bareGame({ role: 'escape' });
    state.board.cat = toIndex(2, 5, 11);
    state.board.blocked[TARGET] = 1;
    state.turn = 'cat';
    state.items.cat.hammer = 2;
    return state;
  }

  it("canUseItem requires the side's turn, count > 0, not armed and not used", () => {
    const state = armedCatGame();
    expect(canUseItem(state, 'cat')).toBe(true);
    expect(canUseItem(state, 'trapper')).toBe(false);
    armItem(state);
    expect(state.armed).toBe(true);
    expect(canUseItem(state, 'cat')).toBe(false);
    disarmItem(state);
    state.hammerUsed = true; // at most one hammer per turn
    expect(canUseItem(state, 'cat')).toBe(false);
  });

  it('armItem sets armed without spending the hammer', () => {
    const state = armedCatGame();
    armItem(state);
    expect(state.armed).toBe(true);
    expect(state.items.cat.hammer).toBe(2);
    expect(state.history.at(-1)).toEqual({ side: 'cat', index: -1, kind: 'arm' });
    expect(state.turn).toBe('cat');
    expect(state.status).toBe('playing');
  });

  it('armItem throws when already armed, without a hammer, or after a break', () => {
    const state = armedCatGame();
    armItem(state);
    expect(() => armItem(state)).toThrow();
    const none = bareGame({ role: 'escape' });
    none.turn = 'cat';
    expect(() => armItem(none)).toThrow();
    const used = armedCatGame();
    armItem(used);
    applyCatMove(used, TARGET);
    expect(() => armItem(used)).toThrow(); // hammerUsed this turn
  });

  it('break: unblocks the target, spends the hammer, keeps the turn', () => {
    const state = armedCatGame();
    armItem(state);
    expect(legalCatMoves(state)).toContain(TARGET);
    const cat = state.board.cat;
    applyCatMove(state, TARGET);
    expect(state.board.blocked[TARGET]).toBe(0);
    expect(state.board.cat).toBe(cat); // the cat does not move
    expect(state.items.cat.hammer).toBe(1);
    expect(state.armed).toBe(false);
    expect(state.hammerUsed).toBe(true);
    expect(state.lastPath).toEqual([]);
    expect(state.history.at(-1)).toEqual({ side: 'cat', index: TARGET, kind: 'break' });
    expect(state.turn).toBe('cat'); // the turn stays with the cat (14.1)
    expect(state.status).toBe('playing');
    // the cat must now make its normal move
    const move = legalCatMoves(state)[0];
    applyCatMove(state, move);
    expect(state.turn).toBe('trapper');
    expect(state.history.at(-1).kind).toBe('move');
    expect(state.moveCount).toBe(3); // arm + break + move
  });

  it('armed move onto an empty cell clears armed without spending the hammer', () => {
    const state = armedCatGame();
    const empty = state.board.nbr[state.board.cat].find(
      (j) => state.board.blocked[j] === 0,
    );
    expect(empty).toBeDefined();
    armItem(state);
    applyCatMove(state, empty);
    expect(state.items.cat.hammer).toBe(2);
    expect(state.armed).toBe(false);
    expect(state.history.at(-1).kind).toBe('move');
    expect(state.turn).toBe('trapper');
  });

  it('disarmItem clears armed and keeps the hammer', () => {
    const state = armedCatGame();
    armItem(state);
    disarmItem(state);
    expect(state.armed).toBe(false);
    expect(state.items.cat.hammer).toBe(2);
    expect(legalCatMoves(state)).not.toContain(TARGET); // no longer a break target
  });

  it('a break never wins: even an edge target only opens the way', () => {
    const state = armedCatGame();
    expect(isBorder(TARGET, 11, 11)).toBe(true);
    armItem(state);
    applyCatMove(state, TARGET);
    expect(state.status).toBe('playing'); // the break itself is not a move
  });

  it('breaks a block at hex distance 3 too', () => {
    const state = bareGame({ role: 'escape' });
    state.board.cat = toIndex(4, 5, 11);
    const t3 = toIndex(1, 5, 11);
    expect(hexDistance(state.board.cat, t3, 11)).toBe(3);
    state.board.blocked[t3] = 1;
    state.turn = 'cat';
    state.items.cat.hammer = 1;
    armItem(state);
    expect(legalCatMoves(state)).toContain(t3);
    applyCatMove(state, t3);
    expect(state.board.blocked[t3]).toBe(0);
    expect(state.board.cat).toBe(toIndex(4, 5, 11));
  });
});

describe('gimmickRules: pickup', () => {
  it('moving onto an item cell gives +1 hammer and clears the cell', () => {
    const state = bareGame({ role: 'escape' });
    state.turn = 'cat';
    const itemNbr = state.board.nbr[state.board.cat][0];
    state.cells[itemNbr] = CELL_ITEM;
    applyCatMove(state, itemNbr);
    expect(state.items.cat.hammer).toBe(1);
    expect(state.cells[itemNbr]).toBe(CELL_NORMAL);
    expect(state.history.at(-1).kind).toBe('pickup');
    expect(state.turn).toBe('trapper');
    expect(state.status).toBe('playing'); // the center is never an edge cell
  });

  it('a picked-up cell becomes blockable once the cat leaves it', () => {
    const state = bareGame({ role: 'escape' });
    state.turn = 'cat';
    const itemNbr = state.board.nbr[state.board.cat][1];
    state.cells[itemNbr] = CELL_ITEM;
    expect(legalBlocks(state)).not.toContain(itemNbr);
    applyCatMove(state, itemNbr); // pickup: the cell turns normal again
    expect(state.cells[itemNbr]).toBe(CELL_NORMAL);
    // step away so the old item cell is no longer the cat's cell
    const back = state.board.nbr[state.board.cat].find(
      (j) => j !== itemNbr && state.board.blocked[j] === 0,
    );
    state.turn = 'cat';
    applyCatMove(state, back);
    expect(state.turn).toBe('trapper');
    expect(legalBlocks(state)).toContain(itemNbr);
  });
});

describe('gimmickRules: double', () => {
  function trapperGame() {
    const state = bareGame({ role: 'trapper', gimmick: { gimmicks: { item: 2 } } });
    state.items.trapper.double = 2;
    return state;
  }

  it('armItem spends one double and sets blocksLeft = 2', () => {
    const state = trapperGame();
    armItem(state);
    expect(state.items.trapper.double).toBe(1);
    expect(state.blocksLeft).toBe(2);
    expect(state.armed).toBe(true);
    expect(state.turn).toBe('trapper');
  });

  it('the first block of a double keeps the turn, the second passes it', () => {
    const state = trapperGame();
    armItem(state);
    const nbrs = Array.from(state.board.nbr[state.board.cat]);
    applyBlock(state, nbrs[0]);
    expect(state.turn).toBe('trapper');
    expect(state.status).toBe('playing');
    expect(state.blocksLeft).toBe(1);
    expect(state.armed).toBe(true);
    applyBlock(state, nbrs[1]);
    expect(state.turn).toBe('cat');
    expect(state.armed).toBe(false);
    expect(state.blocksLeft).toBe(1);
    expect(state.moveCount).toBe(3); // arm + 2 blocks
    expect(state.history.map((h) => h.kind)).toEqual(['arm', 'block', 'block']);
  });

  it('a double block that traps the cat wins immediately', () => {
    const state = bareGame({ role: 'trapper' });
    state.items.trapper.double = 1;
    const nbrs = Array.from(state.board.nbr[state.board.cat]);
    for (const j of nbrs.slice(0, 4)) state.board.blocked[j] = 1;
    state.turn = 'trapper';
    armItem(state);
    applyBlock(state, nbrs[4]);
    expect(state.turn).toBe('trapper');
    expect(state.status).toBe('playing');
    applyBlock(state, nbrs[5]);
    expect(state.status).toBe('trapperWin');
    expect(state.turn).toBe('cat');
  });

  it('blocksLeft resets so a later single block passes the turn', () => {
    const state = trapperGame();
    armItem(state);
    applyBlock(state, legalBlocks(state)[0]);
    disarmItem(state); // cancel the pending second block
    expect(state.blocksLeft).toBe(1);
    expect(state.armed).toBe(false);
    applyBlock(state, legalBlocks(state)[0]);
    expect(state.turn).toBe('cat');
  });

  it('without a double the block passes the turn right away', () => {
    const state = bareGame({ role: 'trapper' });
    applyBlock(state, legalBlocks(state)[0]);
    expect(state.turn).toBe('cat');
    expect(state.blocksLeft).toBe(1);
  });
});

describe('gimmickRules: trapperWin (14.1: the plain rule)', () => {
  function enclosedCat(hammer) {
    const state = bareGame();
    for (const j of state.board.nbr[state.board.cat]) state.board.blocked[j] = 1;
    state.turn = 'cat';
    state.items.cat.hammer = hammer;
    return state;
  }

  it('no legal move → trapperWin, even with a hammer in hand', () => {
    // adjacent walls can't be broken, so a hammer never rescues the cat
    expect(evaluateStatus(enclosedCat(0))).toBe('trapperWin');
    const armed = enclosedCat(2);
    expect(evaluateStatus(armed)).toBe('trapperWin');
    expect(armed.status).toBe('trapperWin');
  });

  it('a cat with at least one legal move keeps playing', () => {
    expect(evaluateStatus(bareGame())).toBe('playing');
  });

  it('cat on an edge cell wins regardless of items', () => {
    const state = bareGame();
    state.board.cat = 0;
    state.turn = 'trapper';
    expect(evaluateStatus(state)).toBe('catWin');
  });
});

describe('gimmickRules: illegal moves', () => {
  it('throws on blocking an item or stone cell', () => {
    const state = makeGame({ gimmick: { gimmicks: { item: 4, stone: 3 } } });
    const item = state.cells.indexOf(CELL_ITEM);
    const stone = state.cells.indexOf(CELL_STONE);
    expect(item).toBeGreaterThanOrEqual(0);
    expect(stone).toBeGreaterThanOrEqual(0);
    expect(() => applyBlock(state, item)).toThrow();
    expect(() => applyBlock(state, stone)).toThrow();
    expect(() => applyBlock(state, state.board.cat)).toThrow();
    expect(() => applyBlock(state, -1)).toThrow();
    expect(() => applyBlock(state, 9999)).toThrow();
  });

  it('throws on moving out of turn or onto a non-neighbor', () => {
    const state = bareGame();
    expect(() => applyCatMove(state, 0)).toThrow(); // trapper's turn
    state.turn = 'cat';
    const far = Array.from(state.cells.keys()).find(
      (i) => i !== state.board.cat && !state.board.nbr[state.board.cat].includes(i),
    );
    expect(far).toBeDefined();
    expect(() => applyCatMove(state, far)).toThrow();
  });

  it('throws after the game is over', () => {
    const state = makeGame();
    state.status = 'catWin';
    expect(() => applyBlock(state, 1)).toThrow();
    expect(() => armItem(state)).toThrow();
  });

  it('every move pushes a typed history entry and bumps moveCount', () => {
    const state = bareGame({ role: 'escape' });
    state.items.cat.hammer = 1;
    armItem(state);
    expect(state.history.at(-1).kind).toBe('arm');
    const to = legalCatMoves(state)[0];
    applyCatMove(state, to);
    expect(state.history.at(-1).kind).toBe('move');
    expect(state.moveCount).toBe(state.history.length);
    for (const h of state.history) {
      expect(['arm', 'move', 'block', 'break', 'pickup']).toContain(h.kind);
    }
  });
});

describe('gimmickRules: 19.4 backstops (no legal block / stuck turns)', () => {
  it('the trapper turn is skipped when nothing blockable is left', () => {
    const state = bareGame({ role: 'escape' });
    const start = toIndex(5, 5, W);
    const step1 = toIndex(5, 6, W);
    state.g.kind[start] = CELL_STONE; // the vacated cell stays unblockable
    state.board.cat = start;
    state.board.blocked.fill(1);
    state.board.blocked[start] = 0;
    state.board.blocked[step1] = 0;
    state.turn = 'cat';
    applyCatMove(state, step1);
    // no blockable cell is left → the trapper's turn passes at once; the
    // cat is then sealed in a two-cell pocket it can never leave, which
    // the 19.4 dead-end check awards to the trapper
    expect(legalBlocks(state)).toEqual([]);
    expect(state.history.map((h) => h.kind)).toEqual(['move']);
    expect(state.status).toBe('trapperWin');
  });

  it('the last blockable cell also ends a trapper turn early (19.4)', () => {
    const state = bareGame({
      role: 'trapper',
      gimmick: { gimmicks: {}, aiItems: 0, cats: 2, catsGoal: 'anyEscape' },
    });
    state.board.blocked.fill(1);
    for (const c of state.cats) state.board.blocked[c] = 0;
    const far = toIndex(0, 0, W);
    state.board.blocked[far] = 0; // the one and only blockable cell
    state.turn = 'trapper';
    state.blocksLeft = 2; // two free cats would allow two blocks…
    applyBlock(state, far);
    // …but the board is full after the first one: the turn passes
    expect(state.blocksLeft).toBe(1);
    expect(state.turn).toBe('cat');
  });

  it('a double never arms when nothing is blockable (19.4)', () => {
    const state = bareGame({ role: 'trapper' });
    state.board.blocked.fill(1);
    state.board.blocked[state.board.cat] = 0;
    state.items.trapper.double = 1;
    expect(legalBlocks(state)).toEqual([]);
    expect(canUseItem(state, 'trapper')).toBe(false);
  });

  it('counts consecutive stuck cat turns: two in a row win for the trapper', () => {
    const state = bareGame({
      role: 'escape',
      gimmick: { gimmicks: {}, aiItems: 0, cats: 2, catsGoal: 'anyEscape' },
    });
    // cage both cats: every neighbor of every cat is blocked
    state.board.blocked.fill(1);
    for (const c of state.cats) state.board.blocked[c] = 0;
    const far = toIndex(0, 0, W);
    state.board.blocked[far] = 0; // one last blockable cell
    state.turn = 'trapper';
    state.blocksLeft = 1;
    state.catStuckTurns = 1; // the previous cat turn already began stuck
    state.status = 'playing';
    applyBlock(state, far);
    expect(state.catStuckTurns).toBe(2);
    expect(state.status).toBe('trapperWin');
  });

  it('the stuck-turn counter resets while the cat side can still move', () => {
    const state = bareGame({
      role: 'trapper',
      gimmick: { gimmicks: {}, aiItems: 0, cats: 2, catsGoal: 'anyEscape' },
    });
    const far = toIndex(0, 0, W);
    state.catStuckTurns = 1;
    state.turn = 'trapper';
    state.blocksLeft = 1;
    applyBlock(state, far);
    expect(state.turn).toBe('cat');
    expect(state.catStuckTurns).toBe(0); // both cats are free again
    expect(state.status).toBe('playing');
  });

  it('an untrappable gimmick pocket is a dead end (19.4)', () => {
    const state = bareGame({ role: 'escape' });
    const cat = toIndex(5, 5, W);
    const spring = toIndex(5, 6, W);
    const stone = toIndex(5, 7, W);
    state.board.cat = cat;
    state.board.blocked.fill(1);
    for (const i of [cat, spring, stone]) state.board.blocked[i] = 0;
    state.g.kind[spring] = KIND_SPRING;
    state.g.kind[stone] = CELL_STONE;
    state.turn = 'cat';
    // the cat can still move on its spring/stone pocket but can never
    // reach an edge and can never be sealed — a dead end (19.4)
    expect(legalCatMoves(state).length).toBeGreaterThan(0);
    expect(evaluateStatus(state)).toBe('trapperWin');
  });

  it('a pocket with a pending brittle crumble keeps playing (19.4)', () => {
    const state = bareGame({ role: 'escape' });
    const cat = toIndex(5, 5, W);
    state.board.cat = cat;
    state.board.blocked.fill(1);
    for (const i of [cat, toIndex(5, 6, W), toIndex(5, 7, W), toIndex(5, 8, W), toIndex(5, 10, W)]) {
      state.board.blocked[i] = 0;
    }
    state.board.blocked[toIndex(5, 9, W)] = 1; // the brittle seal on the route out
    state.g.kind[toIndex(5, 9, W)] = KIND_BRITTLE;
    state.turn = 'cat';
    // enclosed for now, but the brittle seal crumbles and frees the route
    expect(evaluateStatus(state)).toBe('playing');
  });
});
