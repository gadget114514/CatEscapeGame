import { describe, it, expect } from 'vitest';
import {
  chooseCatMove,
  chooseBlock,
  shouldUseItem,
  gimmickCandidates,
} from '../src/game/gimmick/gimmickAI.js';
import { gimmickEval } from '../src/game/gimmick/gimmickSearch.js';
import {
  newGame,
  legalBlocks,
  legalCatMoves,
  applyBlock,
  applyCatMove,
  armItem,
} from '../src/game/gimmick/gimmickRules.js';
import { INITIAL_BLOCKS } from '../src/game/rules.js';
import { trapperCandidates } from '../src/game/candidates.js';
import {
  distanceMap,
  catDistanceMap,
  isEmpty,
} from '../src/game/board.js';
import { gDistanceMap } from '../src/game/gimmick/graph.js';
import { toIndex } from '../src/game/hex.js';
import { mulberry32 } from '../src/game/rng.js';

const CENTER = toIndex(5, 5, 11);

/** Empty gimmick board (no blocks, no gimmick cells) with a given role/AI. */
function bareState(role = 'escape', ai = 'normal') {
  return newGame({
    role,
    ai,
    blocks: 0,
    gimmick: { gimmicks: {}, aiItems: 0 },
    seed: 1,
  });
}

/**
 * Cat walled into a corridor of exact escape distance `d`: everything is
 * blocked except the cat and the chain of cells leading up the column to the
 * edge cell (0,2).
 */
function corridorState(d, ai = 'normal') {
  const state = bareState('escape', ai);
  state.board.blocked.fill(1);
  // edge cell at the top of the column
  const edgeRow = 0;
  const col = 2;
  for (let r = 0; r <= d; r++) {
    const i = toIndex(r, col, 11);
    state.board.blocked[i] = 0;
    if (r === d) state.board.cat = i;
  }
  state.turn = 'trapper';
  return state;
}

/** Cat in a pocket: the ring at hex distance 2 is blocked, ring 1 is open. */
function pocketState(ai = 'normal') {
  const state = bareState('escape', ai);
  const b = state.board;
  const g = catDistanceMap(b); // empty-board distances from the cat
  for (let i = 0; i < g.length; i++) if (g[i] === 2) b.blocked[i] = 1;
  state.turn = 'cat';
  state.items.cat.hammer = 1;
  return state;
}

/**
 * Corridor cat at (4,2) with an exit distance of 4. The side pocket (4,1)
 * is open but walled off by the blocked edge cell (4,0) at hex distance 2
 * from the cat. When `open` is true, breaking (4,0) gives the pocket a
 * 1-move escape (dist 1 vs the best normal move's 3  Ea gain of 2).
 */
function breakFixture(open, ai = 'normal') {
  const state = bareState('escape', ai);
  const b = state.board;
  b.blocked.fill(1);
  for (let r = 0; r <= 4; r++) b.blocked[toIndex(r, 2, 11)] = 0; // corridor
  b.cat = toIndex(4, 2, 11);
  if (open) b.blocked[toIndex(4, 1, 11)] = 0; // step into the side pocket
  // the corridor exit: (4,0) is an edge cell at hex distance 2, still blocked
  b.blocked[toIndex(4, 0, 11)] = 1;
  state.turn = 'cat';
  state.items.cat.hammer = 1;
  return state;
}

/** Realistic mid-game gimmick board: initial blocks + 20 more, route kept. */
function midGame(role, ai, seed) {
  const state = newGame({
    role,
    ai,
    blocks: INITIAL_BLOCKS[role][ai],
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

describe('gimmickCandidates', () => {
  it('drops item and stone cells from the basic candidates', () => {
    const state = midGame('escape', 'normal', 42);
    const basic = trapperCandidates(state.board, 12);
    expect(basic.length).toBeGreaterThan(2);
    state.cells[basic[0]] = 1;
    state.cells[basic[1]] = 2;
    const c = gimmickCandidates(state, 12);
    expect(c).not.toContain(basic[0]);
    expect(c).not.toContain(basic[1]);
    for (const v of c) expect(state.cells[v]).toBe(0);
    expect(c.length).toBeGreaterThan(0);
  });

  it('falls back to the legal block closest to the cat when nothing is left', () => {
    const state = midGame('escape', 'normal', 7);
    const basic = trapperCandidates(state.board, 12);
    for (const v of basic) state.cells[v] = 1;
    const c = gimmickCandidates(state, 12);
    expect(c.length).toBe(1);
    const v = c[0];
    expect(state.cells[v]).toBe(0);
    expect(isEmpty(state.board, v)).toBe(true);
    const g = catDistanceMap(state.board);
    let min = Infinity;
    for (let i = 0; i < state.cells.length; i++) {
      if (isEmpty(state.board, i) && state.cells[i] === 0) min = Math.min(min, g[i]);
    }
    expect(g[v]).toBe(min);
  });

  it('the rng tie-breaks the fallback and never returns a gimmick cell', () => {
    const state = midGame('escape', 'easy', 3);
    const basic = trapperCandidates(state.board, 12);
    for (const v of basic) state.cells[v] = 2;
    for (let seed = 0; seed < 10; seed++) {
      const c = gimmickCandidates(state, 12, mulberry32(seed));
      expect(c.length).toBe(1);
      expect(state.cells[c[0]]).toBe(0);
      expect(isEmpty(state.board, c[0])).toBe(true);
    }
  });
});

describe('gimmickEval', () => {
  it('adds 25 per hammer and 25 when an item cell is within 2 moves', () => {
    const state = bareState();
    const base = gimmickEval(state, 0);
    expect(gimmickEval(state, 2)).toBe(base + 50);
    // put an item cell right next to the cat: +25
    const nbr = state.board.nbr[state.board.cat][0];
    state.cells[nbr] = 1;
    expect(gimmickEval(state, 0)).toBe(base + 25);
    // far away (distance > 2): no bonus
    state.cells[nbr] = 0;
    const far = toIndex(0, 0, 11);
    state.cells[far] = 1;
    expect(gimmickEval(state, 0)).toBe(base);
  });

  it('an enclosed cat with moves is not dead; a stuck cat is (14.1)', () => {
    const state = pocketState();
    expect(state.board.blocked[state.board.nbr[state.board.cat][0]]).toBe(0);
    const score = gimmickEval(state, 1);
    expect(score).toBeGreaterThan(-10000);
    // no legal move at all ↁElost, even with hammers (adjacent walls
    // can no longer be broken)
    const trapped = bareState();
    for (const j of trapped.board.nbr[trapped.board.cat]) trapped.board.blocked[j] = 1;
    expect(gimmickEval(trapped, 0)).toBe(-10000);
    expect(gimmickEval(trapped, 1)).toBe(-10000);
  });
});

describe('shouldUseItem: trapper double thresholds (12.5)', () => {
  function trapperAtDist(d, ai, double = 1) {
    const state = corridorState(d, ai);
    state.turn = 'trapper';
    state.items.trapper.double = double;
    return state;
  }

  it('dist 1 ↁEevery level uses the double', () => {
    for (const ai of ['easy', 'normal', 'hard']) {
      expect(shouldUseItem(trapperAtDist(1, ai), mulberry32(1))).toBe(true);
    }
  });

  it('dist 2 ↁEnormal and hard, not easy', () => {
    expect(shouldUseItem(trapperAtDist(2, 'easy'), mulberry32(1))).toBe(false);
    expect(shouldUseItem(trapperAtDist(2, 'normal'), mulberry32(1))).toBe(true);
    expect(shouldUseItem(trapperAtDist(2, 'hard'), mulberry32(1))).toBe(true);
  });

  it('dist 3 ↁEonly hard', () => {
    expect(shouldUseItem(trapperAtDist(3, 'easy'), mulberry32(1))).toBe(false);
    expect(shouldUseItem(trapperAtDist(3, 'normal'), mulberry32(1))).toBe(false);
    expect(shouldUseItem(trapperAtDist(3, 'hard'), mulberry32(1))).toBe(true);
  });

  it('dist 4 or more ↁEnobody', () => {
    for (const ai of ['easy', 'normal', 'hard']) {
      expect(shouldUseItem(trapperAtDist(4, ai), mulberry32(1))).toBe(false);
      expect(shouldUseItem(trapperAtDist(5, ai), mulberry32(1))).toBe(false);
    }
  });

  it('needs a double, a playing game and an unarmed state', () => {
    expect(shouldUseItem(trapperAtDist(1, 'normal', 0), mulberry32(1))).toBe(false);
    const armed = trapperAtDist(1, 'normal');
    armItem(armed);
    expect(shouldUseItem(armed, mulberry32(1))).toBe(false);
    const over = trapperAtDist(1, 'normal');
    over.status = 'catWin';
    expect(shouldUseItem(over, mulberry32(1))).toBe(false);
  });
});

describe('shouldUseItem: cat hammer (14.1)', () => {
  it('at most one hammer per turn: a used hammer is never re-armed', () => {
    for (const ai of ['normal', 'hard']) {
      const state = breakFixture(true, ai);
      expect(shouldUseItem(state, mulberry32(1))).toBe(true);
      state.hammerUsed = true;
      expect(shouldUseItem(state, mulberry32(1))).toBe(false);
    }
  });

  it('enclosed cat with moves: every difficulty breaks out (the enclosed rule)', () => {
    expect(shouldUseItem(pocketState('easy'), mulberry32(1))).toBe(true);
    expect(shouldUseItem(pocketState('normal'), mulberry32(1))).toBe(true);
    expect(shouldUseItem(pocketState('hard'), mulberry32(1))).toBe(true);
  });

  it('arms when a break gains at least 2 dist over the best normal move', () => {
    // corridor dist 4: the best normal move keeps dist 3; breaking the edge
    // cell (4,0) opens the pocket onto dist 1 (3-2 = 1 qualifies)
    expect(shouldUseItem(breakFixture(true, 'normal'), mulberry32(1))).toBe(true);
    expect(shouldUseItem(breakFixture(true, 'hard'), mulberry32(1))).toBe(true);
    // easy only uses the enclosed condition
    expect(shouldUseItem(breakFixture(true, 'easy'), mulberry32(1))).toBe(false);
    // same corridor with the pocket sealed: the break leads nowhere ↁEnobody arms
    expect(shouldUseItem(breakFixture(false, 'normal'), mulberry32(1))).toBe(false);
    expect(shouldUseItem(breakFixture(false, 'hard'), mulberry32(1))).toBe(false);
  });

  it('needs a hammer in hand', () => {
    const state = pocketState();
    state.items.cat.hammer = 0;
    expect(shouldUseItem(state, mulberry32(1))).toBe(false);
  });

  it('an enclosed cat the break cannot save does not arm', () => {
    const state = pocketState('normal');
    const b = state.board;
    // seal everything outside the cat's pocket: even after breaking any
    // ring-2 block the cat stays enclosed, so no break reconnects it
    for (let i = 0; i < b.blocked.length; i++) {
      if (!b.blocked[i] && i !== b.cat) b.blocked[i] = 1;
    }
    for (const j of b.nbr[b.cat]) b.blocked[j] = 0;
    expect(shouldUseItem(state, mulberry32(1))).toBe(false);
  });
});

describe('chooseBlock (trapper AI)', () => {
  it('never returns an item or stone cell', () => {
    for (const seed of [5, 11]) {
      for (const ai of ['easy', 'normal', 'hard']) {
        const state = midGame('escape', ai, seed);
        const legal = legalBlocks(state);
        const m = chooseBlock(state, mulberry32(seed));
        expect(legal).toContain(m);
        expect(state.cells[m]).toBe(0);
      }
    }
  });

  it('the AI plays its double: arm, then two blocks, turn passes to the cat', () => {
    // a wide room open at the top: two blocks can never end the game here
    // (the old corridor fixture is a sealed dead end under 19.4)
    const state = bareState('escape', 'normal');
    const b = state.board;
    b.blocked.fill(1);
    for (let r = 0; r <= 2; r++) {
      for (let c = 2; c <= 5; c++) b.blocked[toIndex(r, c, 11)] = 0;
    }
    b.cat = toIndex(2, 3, 11);
    state.turn = 'trapper';
    state.items.trapper.double = 1;
    expect(shouldUseItem(state, mulberry32(1))).toBe(true);
    armItem(state);
    expect(state.blocksLeft).toBe(2);
    const b1 = chooseBlock(state, mulberry32(2));
    expect(legalBlocks(state)).toContain(b1);
    applyBlock(state, b1);
    expect(state.turn).toBe('trapper'); // double keeps the turn
    expect(state.status).toBe('playing');
    expect(shouldUseItem(state, mulberry32(3))).toBe(false); // no re-arm
    const b2 = chooseBlock(state, mulberry32(4));
    expect(legalBlocks(state)).toContain(b2);
    expect(b2).not.toBe(b1);
    applyBlock(state, b2);
    expect(state.turn).toBe('cat');
    expect(state.items.trapper.double).toBe(0);
  });

  it('returns -1 when there is nothing left to block', () => {
    const state = bareState('escape', 'hard');
    state.board.blocked.fill(1);
    state.board.blocked[state.board.cat] = 0;
    expect(chooseBlock(state, mulberry32(1))).toBe(-1);
  });

  it('never mutates the state', () => {
    const state = midGame('escape', 'hard', 12);
    const before = {
      blocked: Array.from(state.board.blocked),
      cells: Array.from(state.cells),
      cat: state.board.cat,
      turn: state.turn,
      moveCount: state.moveCount,
      history: state.history.slice(),
      items: JSON.parse(JSON.stringify(state.items)),
      armed: state.armed,
      blocksLeft: state.blocksLeft,
    };
    chooseBlock(state, mulberry32(4));
    chooseCatMove(state, mulberry32(5));
    shouldUseItem(state, mulberry32(6));
    expect(Array.from(state.board.blocked)).toEqual(before.blocked);
    expect(Array.from(state.cells)).toEqual(before.cells);
    expect(state.board.cat).toBe(before.cat);
    expect(state.turn).toBe(before.turn);
    expect(state.moveCount).toBe(before.moveCount);
    expect(state.history).toEqual(before.history);
    expect(state.items).toEqual(before.items);
    expect(state.armed).toBe(before.armed);
    expect(state.blocksLeft).toBe(before.blocksLeft);
  });

  it('Hard answers with a legal block on a realistic mid-game board', () => {
    // (the <100 ms timing budget lives in test/perf, run via npm run test:perf)
    for (const seed of [11, 22, 33]) {
      const state = midGame('escape', 'hard', seed);
      const blocks = state.board.blocked.reduce((a, b) => a + b, 0);
      expect(blocks).toBeGreaterThanOrEqual(27);
      const move = chooseBlock(state, mulberry32(seed));
      expect(legalBlocks(state)).toContain(move);
    }
  });
});

describe('chooseCatMove (cat AI)', () => {
  it('returns -1 when the cat has no move', () => {
    const state = bareState('escape', 'hard');
    state.board.blocked.fill(1);
    state.board.blocked[state.board.cat] = 0;
    expect(chooseCatMove(state, mulberry32(1))).toBe(-1);
  });

  it('takes an edge move immediately', () => {
    const state = bareState('escape', 'normal');
    state.board.cat = toIndex(1, 5, 11); // next to the top edge
    const edges = state.board.nbr[state.board.cat].filter((j) => j < 11);
    expect(edges.length).toBeGreaterThan(0);
    state.cells[edges[0]] = 1; // even an item cell on the edge wins first
    const m = chooseCatMove(state, mulberry32(1));
    expect(edges).toContain(m);
  });

  it('cat arms and breaks out through a distance-2 block (normal)', () => {
    const state = breakFixture(true, 'normal');
    expect(shouldUseItem(state, mulberry32(1))).toBe(true);
    armItem(state);
    const m = chooseCatMove(state, mulberry32(2));
    // either pocket edge ((4,0) or (3,0)) is an optimal distance-2 break
    expect([toIndex(4, 0, 11), toIndex(3, 0, 11)]).toContain(m);
    expect(state.board.blocked[m]).toBe(1);
    expect(legalCatMoves(state)).toContain(m);
    applyCatMove(state, m); // break: the turn stays with the cat (14.1)
    expect(state.items.cat.hammer).toBe(0);
    expect(state.armed).toBe(false);
    expect(state.hammerUsed).toBe(true);
    expect(state.board.blocked[m]).toBe(0);
    expect(state.turn).toBe('cat');
    expect(state.status).toBe('playing');
    // the follow-up move steps into the pocket next to the edge
    const move = chooseCatMove(state, mulberry32(3));
    applyCatMove(state, move);
    expect(state.turn).toBe('trapper');
    expect(gDistanceMap(state).dist[state.board.cat]).toBe(1);
  });

  it('armed cat picks the break with the smallest dist after breaking', () => {
    const state = breakFixture(true, 'hard');
    armItem(state);
    const rng = mulberry32(7);
    for (let t = 0; t < 5; t++) {
      // brute force: breaking (4,0) or (3,0) gives dist 1 after the move;
      // every other distance 2-3 block keeps the cat at dist 3
      const m = chooseCatMove(state, rng);
      expect([toIndex(4, 0, 11), toIndex(3, 0, 11)]).toContain(m);
    }
  });

  it('Normal prefers the move closer to an item cell at equal dist/paths', () => {
    const state = bareState('escape', 'normal');
    const b = state.board;
    b.blocked.fill(1);
    // two symmetric dead-end corridors from the cat, item on the left one
    const left = [toIndex(5, 4, 11), toIndex(5, 3, 11), toIndex(5, 2, 11), toIndex(5, 1, 11), toIndex(5, 0, 11)];
    const right = [toIndex(5, 6, 11), toIndex(5, 7, 11), toIndex(5, 8, 11), toIndex(5, 9, 11), toIndex(5, 10, 11)];
    for (const i of [...left, ...right, CENTER]) b.blocked[i] = 0;
    b.cat = CENTER;
    state.cells[left[1]] = 1; // item one step beyond the first left move
    const d = distanceMap(b);
    expect(d.dist[CENTER]).toBe(5);
    expect(d.dist[left[0]]).toBe(4);
    expect(d.dist[right[0]]).toBe(4);
    expect(d.paths[left[0]]).toBe(d.paths[right[0]]);
    expect(chooseCatMove(state, mulberry32(3))).toBe(left[0]);
  });

  it('every level returns a legal move on a mid-game board', () => {
    for (const ai of ['easy', 'normal', 'hard']) {
      const state = midGame('trapper', ai, 21);
      const moves = legalCatMoves(state);
      const rng = mulberry32(21);
      for (let t = 0; t < 5; t++) {
        expect(moves).toContain(chooseCatMove(state, rng));
      }
    }
  });

  it('Hard answers with a legal move on a realistic mid-game board', () => {
    // (the <100 ms timing budget lives in test/perf, run via npm run test:perf)
    for (const seed of [11, 22, 33]) {
      const state = midGame('trapper', 'hard', seed);
      const move = chooseCatMove(state, mulberry32(seed));
      expect(legalCatMoves(state)).toContain(move);
    }
  });
});
