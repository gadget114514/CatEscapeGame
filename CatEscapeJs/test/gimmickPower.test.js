import { describe, it, expect } from 'vitest';
import {
  newGame,
  legalCatMoves,
  applyBlock,
  applyCatMove,
  armItem,
  armPower,
  canUsePower,
  stopDash,
  evaluateStatus,
  jumpTargets,
  jumpRescue,
  POWER_CAP,
  DASH_COST,
  JUMP_COST,
} from '../src/game/gimmick/gimmickRules.js';
import {
  shouldUsePower,
  shouldUseItem,
  chooseCatMove,
} from '../src/game/gimmick/gimmickAI.js';
import { gDistanceMap } from '../src/game/gimmick/graph.js';
import { KIND_TUNNEL, KIND_ICE, KIND_FISH, CELL_ITEM } from '../src/game/gimmick/registry.js';
import { levelFeatures, FEATURE_UNLOCKS } from '../src/game/play/levels.js';
import { isBorder, toIndex } from '../src/game/hex.js';
import { DIR_E, DIR_W } from '../src/game/gimmick/hexDir.js';
import { mulberry32 } from '../src/game/rng.js';

const W = 11;

const FEATURES_ON = { power: true, dash: true, jump: true, storm: false };

/** Empty board, cat-side comeback features on, control of the turn. */
function powerGame(opts = {}) {
  return newGame({
    role: 'escape',
    ai: 'normal',
    blocks: 0,
    gimmick: { gimmicks: {}, aiItems: 0, features: FEATURES_ON },
    seed: 1234,
    ...opts,
  });
}

function setKind(state, i, kind, extra = {}) {
  state.g.kind[i] = kind;
  if (extra.dir !== undefined) state.g.dir[i] = extra.dir;
  if (extra.partner !== undefined) {
    state.g.partner[i] = extra.partner;
    state.g.kind[extra.partner] = kind;
    state.g.partner[extra.partner] = i;
  }
}

/** Every neighbor of `i` blocked. */
function wallIn(state, i) {
  for (const j of state.board.nbr[i]) state.board.blocked[j] = 1;
}

describe('14.5 unlock table', () => {
  it('switches the escape-course features on at L3 / L7 / L11', () => {
    expect(levelFeatures('escape', 2)).toEqual({ power: false, dash: false, jump: false, storm: false });
    expect(levelFeatures('escape', 3)).toEqual({ power: true, dash: true, jump: false, storm: false });
    expect(levelFeatures('escape', 6)).toEqual({ power: true, dash: true, jump: false, storm: false });
    expect(levelFeatures('escape', 7)).toEqual({ power: true, dash: true, jump: true, storm: false });
    expect(levelFeatures('escape', 11)).toEqual({ power: true, dash: true, jump: true, storm: true });
    expect(levelFeatures('escape', 20).storm).toBe(true); // stays on
  });

  it('switches the trapper-course (AI) features on at L13 / L15, never a storm', () => {
    expect(levelFeatures('trapper', 12)).toEqual({ power: false, dash: false, jump: false, storm: false });
    expect(levelFeatures('trapper', 13)).toEqual({ power: true, dash: true, jump: false, storm: false });
    expect(levelFeatures('trapper', 15)).toEqual({ power: true, dash: true, jump: true, storm: false });
    expect(FEATURE_UNLOCKS.trapper.storm).toBe(Infinity);
  });
});

describe('power gauge (14.5 / 18.3 pressure-only gain)', () => {
  it('a cat move gains 1 pip only when it starts with ≤ 3 empty neighbors', () => {
    const state = powerGame();
    state.turn = 'cat';
    expect(state.power).toBe(0);
    applyCatMove(state, legalCatMoves(state)[0]); // open center: 6 empty → no gain
    expect(state.power).toBe(0);

    // 3 empty neighbors: still under pressure (18.3 boundary)
    const pressured = powerGame();
    const cat = pressured.board.cat;
    const nbrs = Array.from(pressured.board.nbr[cat]);
    for (const j of nbrs.slice(0, 3)) pressured.board.blocked[j] = 1; // 3 left
    pressured.turn = 'cat';
    const to = legalCatMoves(pressured)[0];
    const start = pressured.board.cat;
    expect(pressured.board.nbr[start].filter((j) => !pressured.board.blocked[j]).length).toBe(3);
    applyCatMove(pressured, to);
    expect(pressured.power).toBe(1);

    // 4 empty neighbors: no longer pressure, no pip
    const open = powerGame();
    const cat2 = open.board.cat;
    for (const j of Array.from(open.board.nbr[cat2]).slice(0, 2)) open.board.blocked[j] = 1;
    open.turn = 'cat';
    applyCatMove(open, legalCatMoves(open)[0]);
    expect(open.power).toBe(0);
  });

  it('caps the gauge at 6 pips', () => {
    const state = powerGame();
    const cat = state.board.cat;
    for (const j of state.board.nbr[cat].slice(0, 4)) state.board.blocked[j] = 1;
    state.power = POWER_CAP; // already full
    state.turn = 'cat';
    applyCatMove(state, legalCatMoves(state)[0]); // +1 pressure → still capped
    expect(state.power).toBe(POWER_CAP);
  });

  it('a trapper double feeds the cat gauge +2', () => {
    const state = powerGame({ role: 'trapper' });
    state.items.trapper.double = 2;
    state.turn = 'trapper';
    armItem(state);
    expect(state.power).toBe(2);
    expect(state.blocksLeft).toBe(2);
  });

  it('stays at 0 without the feature', () => {
    const state = powerGame({ gimmick: { gimmicks: {}, aiItems: 0, features: {} } });
    state.turn = 'cat';
    applyCatMove(state, legalCatMoves(state)[0]);
    expect(state.power).toBe(0);
  });
});

describe('dash (14.5)', () => {
  function dashGame(catCell, power = DASH_COST) {
    const state = powerGame();
    state.board.cat = catCell;
    state.turn = 'cat';
    state.power = power;
    return state;
  }

  it('runs up to 2 steps in one turn and pays on the first step (5.2)', () => {
    const state = dashGame(toIndex(5, 3, W));
    expect(canUsePower(state, 'dash')).toBe(true);
    armPower(state, 'dash');
    expect(state.armed).toBe(true);
    expect(state.armKind).toBe('dash');
    expect(state.dashLeft).toBe(2); // at most 2 steps (was 3)
    expect(state.power).toBe(DASH_COST); // not spent at arm time

    applyCatMove(state, toIndex(5, 4, W)); // step 1 pays
    expect(state.power).toBe(DASH_COST - DASH_COST); // 18.3: open cells → no pip
    expect(state.turn).toBe('cat');
    expect(state.dashLeft).toBe(1);

    applyCatMove(state, toIndex(5, 5, W)); // the dash is over after 2 steps
    expect(state.turn).toBe('trapper');
    expect(state.armed).toBe(false);
    expect(state.armKind).toBeNull();
    expect(state.dashLeft).toBe(0);
    expect(state.history.map((h) => h.kind)).toEqual(['move', 'move']);
    expect(state.moveCount).toBe(2);
  });

  it('needs the full 6-pip gauge (5.2)', () => {
    expect(DASH_COST).toBe(6);
    const state = dashGame(toIndex(5, 3, W), 5);
    expect(canUsePower(state, 'dash')).toBe(false); // one pip short
    state.power = DASH_COST;
    expect(canUsePower(state, 'dash')).toBe(true);
  });

  it('drains the whole gauge on its first step (5.2)', () => {
    // without the `power` feature a cat move earns no pips, so the gauge
    // the dash paid from is visible as empty
    const state = powerGame({ gimmick: { gimmicks: {}, aiItems: 0, features: { dash: true } } });
    state.board.cat = toIndex(5, 3, W);
    state.turn = 'cat';
    state.power = POWER_CAP;
    armPower(state, 'dash');
    expect(state.power).toBe(POWER_CAP); // nothing spent at arm time
    applyCatMove(state, toIndex(5, 4, W));
    expect(state.power).toBe(0); // after the dash is paid the gauge is 0
    expect(state.dashLeft).toBe(1);
    expect(state.turn).toBe('cat');
  });

  it('triggers a tunnel inside the dash', () => {
    const state = dashGame(toIndex(5, 3, W));
    const a = toIndex(5, 4, W); // east of the cat: the tunnel entrance
    const b = toIndex(5, 7, W);
    setKind(state, a, KIND_TUNNEL, { partner: b });
    armPower(state, 'dash');
    applyCatMove(state, a);
    expect(state.board.cat).toBe(b); // the tunnel exit is the dash's position
    expect(state.lastPath).toEqual([a, b]);
    expect(state.turn).toBe('cat');
    applyCatMove(state, toIndex(5, 8, W)); // the second (last) step
    expect(state.turn).toBe('trapper');
    expect(state.board.cat).toBe(toIndex(5, 8, W));
    expect(state.status).toBe('playing');
  });

  it('slides on ice inside the dash', () => {
    const state = dashGame(toIndex(5, 2, W));
    for (const c of [3, 4, 5]) setKind(state, toIndex(5, c, W), KIND_ICE);
    armPower(state, 'dash');
    applyCatMove(state, toIndex(5, 3, W));
    expect(state.board.cat).toBe(toIndex(5, 6, W)); // one slide = one step
    expect(state.dashLeft).toBe(1);
    applyCatMove(state, toIndex(5, 7, W)); // the second (last) step
    expect(state.turn).toBe('trapper');
  });

  it('ends at once when a step lands on an edge (the cat wins)', () => {
    const state = dashGame(toIndex(5, 8, W));
    armPower(state, 'dash');
    applyCatMove(state, toIndex(5, 9, W));
    expect(state.turn).toBe('cat');
    applyCatMove(state, toIndex(5, 10, W));
    expect(isBorder(state.board.cat, W, W)).toBe(true);
    expect(state.status).toBe('catWin');
    expect(state.armed).toBe(false);
  });

  it('ここで止める ends the dash early; before the first step it only cancels', () => {
    const state = dashGame(toIndex(5, 3, W));
    armPower(state, 'dash');
    expect(stopDash(state)).toBe(true); // cancel: free, turn unchanged
    expect(state.armed).toBe(false);
    expect(state.turn).toBe('cat');
    expect(state.power).toBe(DASH_COST);

    armPower(state, 'dash');
    applyCatMove(state, toIndex(5, 4, W));
    expect(state.dashLeft).toBe(1);
    expect(stopDash(state)).toBe(true); // real stop: the turn passes
    expect(state.turn).toBe('trapper');
    expect(state.armed).toBe(false);
    expect(state.power).toBe(0); // 18.3: the open step earned no pip
    expect(state.status).toBe('playing');
  });

  it('canUsePower needs the feature, the full gauge and a legal move', () => {
    const state = dashGame(toIndex(5, 3, W));
    expect(canUsePower(state, 'dash')).toBe(true);
    state.power = DASH_COST - 1;
    expect(canUsePower(state, 'dash')).toBe(false);
    state.power = DASH_COST;
    state.features.dash = false;
    expect(canUsePower(state, 'dash')).toBe(false);
    state.features.dash = true;
    wallIn(state, state.board.cat); // nowhere to go
    expect(canUsePower(state, 'dash')).toBe(false);
    expect(() => armPower(state, 'dash')).toThrow();
  });
});

describe('corner jump (14.5)', () => {
  /** Cat at (5,3) with only one empty neighbor — cornered. */
  function corneredGame(opts = {}) {
    const state = powerGame(opts);
    state.board.cat = toIndex(5, 3, W);
    for (const c of [2, 4]) state.board.blocked[toIndex(5, c, W)] = 1; // W and E
    for (const j of [toIndex(4, 3, W), toIndex(4, 4, W), toIndex(6, 3, W)]) {
      state.board.blocked[j] = 1;
    }
    state.turn = 'cat';
    state.power = JUMP_COST;
    return state;
  }

  it('jumps over exactly one adjacent block in a straight line', () => {
    const state = corneredGame();
    const land = toIndex(5, 5, W); // step(step((5,3), E), E)
    expect(state.board.blocked[toIndex(5, 4, W)]).toBe(1);
    const targets = jumpTargets(state);
    expect(targets.map((t) => t.to)).toContain(land);
    for (const t of targets) expect(state.board.blocked[t.over]).toBe(1); // exactly one block
    expect(state.board.blocked[land]).toBe(0); // and an empty landing

    expect(canUsePower(state, 'jump')).toBe(true);
    armPower(state, 'jump');
    expect(legalCatMoves(state)).toContain(land);
    applyCatMove(state, land);
    expect(state.board.cat).toBe(land);
    expect(state.armed).toBe(false);
    expect(state.history.at(-1).kind).toBe('jump');
    expect(state.turn).toBe('trapper');
    // 6 - 6 + the pressure pip of the start cell (1 empty neighbor) = 1
    expect(state.power).toBe(1);
    expect(state.status).toBe('playing');
  });

  it('triggers the landing cell gimmick (item pickup pays for the jump)', () => {
    const state = corneredGame();
    const land = toIndex(5, 5, W);
    setKind(state, land, CELL_ITEM);
    state.items.cat.hammer = 0;
    armPower(state, 'jump');
    applyCatMove(state, land);
    expect(state.items.cat.hammer).toBe(1);
    expect(state.g.kind[land]).toBe(0);
  });

  it('refuses a landing that is blocked or off the board', () => {
    const state = corneredGame();
    state.board.blocked[toIndex(5, 5, W)] = 1; // the E landing is walled too
    expect(jumpTargets(state).some((t) => t.dir === DIR_E)).toBe(false);

    // off the board: cat one cell from the west edge, the edge cell blocked
    const s2 = powerGame();
    s2.board.cat = toIndex(5, 1, W);
    for (const j of [toIndex(5, 0, W), toIndex(5, 2, W), toIndex(4, 1, W), toIndex(4, 2, W)]) {
      s2.board.blocked[j] = 1;
    }
    s2.turn = 'cat';
    s2.power = JUMP_COST;
    const t2 = jumpTargets(s2);
    expect(t2.length).toBeGreaterThan(0);
    expect(t2.some((t) => t.dir === DIR_W)).toBe(false); // -1 landing refused
    expect(t2.every((t) => t.to >= 0 && t.to < W * W)).toBe(true);
  });

  it('needs ≤ 2 empty neighbors, the feature and the full gauge', () => {
    const open = powerGame();
    open.turn = 'cat';
    open.power = JUMP_COST;
    open.board.blocked[toIndex(5, 4, W)] = 1; // one block, 5 empty neighbors
    expect(jumpTargets(open)).toEqual([]);
    expect(canUsePower(open, 'jump')).toBe(false);

    const noFeature = corneredGame({ gimmick: { gimmicks: {}, aiItems: 0, features: { power: true } } });
    expect(jumpTargets(noFeature)).toEqual([]);

    const poor = corneredGame();
    poor.power = JUMP_COST - 1;
    expect(canUsePower(poor, 'jump')).toBe(false);
    expect(() => armPower(poor, 'jump')).toThrow();
  });
});

describe('trapper-win exception (14.5)', () => {
  function stuckCat(power, features = { power: true, dash: true, jump: true }) {
    const state = powerGame({
      gimmick: { gimmicks: {}, aiItems: 0, features },
    });
    wallIn(state, state.board.cat);
    state.turn = 'cat';
    state.power = power;
    return state;
  }

  it('a full-gauge cat with a possible corner jump is not stuck', () => {
    const state = stuckCat(JUMP_COST);
    expect(gap(state)).toBe(0); // no legal move at all
    expect(jumpRescue(state)).toBe(true);
    expect(evaluateStatus(state)).toBe('playing');
    expect(state.status).toBe('playing');
    expect(canUsePower(state, 'jump')).toBe(true);
    expect(legalCatMoves(state)).toEqual([]); // nothing until the jump is armed
    armPower(state, 'jump');
    expect(legalCatMoves(state).length).toBeGreaterThan(0);
  });

  it('one pip short, or without the jump feature, the trapper wins', () => {
    expect(evaluateStatus(stuckCat(JUMP_COST - 1))).toBe('trapperWin');
    expect(evaluateStatus(stuckCat(JUMP_COST, { power: true, dash: true, jump: false }))).toBe(
      'trapperWin',
    );
    // and the plain no-move rule still wins with a hammer in hand (14.1)
    const withHammer = stuckCat(0);
    withHammer.items.cat.hammer = 2;
    expect(evaluateStatus(withHammer)).toBe('trapperWin');
  });
});

/** A cornered cat's number of empty neighbors (0 = fully stuck). */
function gap(state) {
  const b = state.board;
  return b.nbr[state.board.cat].filter((j) => !b.blocked[j]).length;
}

describe('dried fish (18.4: crumbles the newest far block)', () => {
  const far1 = toIndex(0, 0, W);
  const far2 = toIndex(0, 3, W);

  /** Empty escape board with two far trapper blocks in the history. */
  function fishGame() {
    const state = powerGame(); // cat at the center, role escape
    state.turn = 'trapper';
    applyBlock(state, far1);
    state.turn = 'trapper';
    applyBlock(state, far2);
    expect(state.board.blocked[far1]).toBe(1);
    expect(state.board.blocked[far2]).toBe(1);
    state.turn = 'cat';
    return state;
  }

  it('landing on it crumbles the most recent block that touches no cat', () => {
    const state = fishGame();
    const fishCell = legalCatMoves(state)[0];
    setKind(state, fishCell, KIND_FISH);
    applyCatMove(state, fishCell);
    expect(state.g.kind[fishCell]).toBe(0); // the cell turns normal
    expect(state.history.at(-1).kind).toBe('fish');
    expect(state.board.blocked[far2]).toBe(0); // the newest safe block crumbled
    expect(state.board.blocked[far1]).toBe(1); // the older one stays
    expect(state.crumbles).toEqual([far2]); // for the view's crumble animation
    expect(state.turn).toBe('trapper'); // the old trapper skip is gone (18.4)
  });

  it('skips blocks next to a cat and takes an older one', () => {
    const state = fishGame();
    const near = state.board.nbr[state.board.cat][0]; // adjacent to the cat
    state.turn = 'trapper';
    applyBlock(state, near); // the newest, but next to the cat
    state.turn = 'cat';
    // land next to `near` so it still touches a cat after the move (18.4
    // judges adjacency by the post-move positions)
    const fishCell = legalCatMoves(state).find(
      (c) => c !== near && Array.from(state.board.nbr[c]).includes(near),
    );
    setKind(state, fishCell, KIND_FISH);
    applyCatMove(state, fishCell);
    expect(state.board.blocked[near]).toBe(1); // adjacent to the cat: kept
    expect(state.board.blocked[far2]).toBe(0); // the newest safe block went
    expect(state.crumbles).toEqual([far2]);
  });

  it('does nothing when no block qualifies', () => {
    const state = powerGame();
    const fishCell = legalCatMoves(state)[0];
    setKind(state, fishCell, KIND_FISH);
    applyCatMove(state, fishCell);
    expect(state.g.kind[fishCell]).toBe(0); // the cell still turns normal
    expect(state.crumbles).toEqual([]);
    expect(state.turn).toBe('trapper'); // a plain turn pass, no skip
    expect(state.history.at(-1).kind).toBe('fish');
  });

  it('a fish under a dash crumbles the block on that very step', () => {
    const state = fishGame();
    state.board.cat = toIndex(5, 3, W);
    const fishCell = toIndex(5, 4, W); // east of the cat
    setKind(state, fishCell, KIND_FISH);
    state.turn = 'cat';
    state.power = DASH_COST;
    armPower(state, 'dash');
    applyCatMove(state, fishCell); // step 1: fish, dash continues
    expect(state.turn).toBe('cat');
    expect(state.board.blocked[far2]).toBe(0); // crumbled on the step
    expect(state.crumbles).toEqual([far2]);
    state.crumbles = [];
    applyCatMove(state, toIndex(5, 5, W)); // step 2: the dash ends
    expect(state.turn).toBe('trapper');
    expect(state.status).toBe('playing');
  });

  it('cannot be blocked', () => {
    const state = powerGame({ role: 'trapper' });
    const fishCell = toIndex(5, 6, W);
    setKind(state, fishCell, KIND_FISH);
    applyBlock(state, legalBlockOutside(state, fishCell));
    expect(state.board.blocked[fishCell]).toBe(0);
  });
});

/** Any legal block that is not `skip`. */
function legalBlockOutside(state, skip) {
  for (let i = 0; i < state.board.W * state.board.H; i++) {
    if (i === skip) continue;
    if (state.board.blocked[i]) continue;
    if (state.board.nbr[state.board.cat].includes(i)) continue;
    if (state.g.kind[i] !== 0) continue;
    if (isBorder(i, state.board.W, state.board.H)) continue;
    return i;
  }
  /* istanbul ignore next */
  throw new Error('no blockable cell');
}

describe('storm (14.5)', () => {
  function pocketGame() {
    const state = powerGame({
      role: 'trapper',
      gimmick: {
        gimmicks: {},
        aiItems: 0,
        features: { power: false, dash: false, jump: false, storm: true },
      },
    });
    const cat = state.board.cat; // the center (5,5)
    // ring every cell at hex distance 2: the cat can shuffle inside but has
    // no route to the edge (dist == -1) — enclosed, yet still mobile
    for (let i = 0; i < W * W; i++) {
      if (hex2(i, cat)) state.board.blocked[i] = 1;
    }
    return state;
  }

  /** Is `i` exactly 2 steps from the center cell `cat`? */
  function hex2(i, cat) {
    const ra = (i / W) | 0;
    const ca = i % W;
    const rb = (cat / W) | 0;
    const cb = cat % W;
    const qa = ca - ((ra - (ra & 1)) >> 1);
    const qb = cb - ((rb - (rb & 1)) >> 1);
    const dq = qa - qb;
    const dr = ra - rb;
    const ds = -dq - dr;
    return (Math.abs(dq) + Math.abs(dr) + Math.abs(ds)) / 2 === 2;
  }

  it('fires once when a cat becomes enclosed and never next to a cat', () => {
    const state = pocketGame();
    const cat = state.board.cat;
    expect(gDistanceMap(state).dist[cat]).toBe(-1);
    const before = countBlocks(state);
    expect(state.storm).toBeNull();

    state.turn = 'trapper';
    const far = legalBlockOutside(state, -1);
    applyBlock(state, far); // the enclosure is already there → storm now

    expect(state.stormUsed).toBe(true);
    expect(state.storm).not.toBeNull();
    expect(state.storm.length).toBe(3);
    expect(countBlocks(state)).toBe(before + 1 - 3); // +the new block, -3 blown
    const nbrs = new Set(Array.from(state.board.nbr[cat]));
    for (const i of state.storm) {
      expect(nbrs.has(i)).toBe(false); // never next to a cat
      expect(i).not.toBe(cat);
    }
    expect(state.status).toBe('playing'); // the cat can slip out now
  });

  it('never fires twice', () => {
    const state = pocketGame();
    state.turn = 'trapper';
    applyBlock(state, legalBlockOutside(state, -1));
    expect(state.stormUsed).toBe(true);
    state.storm = null; // the view consumed it

    // enclose the cat completely and block again: the storm stays silent
    wallIn(state, state.board.cat);
    const anyCell = legalBlockOutside(state, -1);
    state.turn = 'trapper';
    applyBlock(state, anyCell);
    expect(state.storm).toBeNull();
    expect(state.status).toBe('trapperWin'); // jump feature is off here
  });

  it('is deterministic for a given seed', () => {
    const a = pocketGame();
    const b = pocketGame();
    a.turn = 'trapper';
    b.turn = 'trapper';
    const cell = legalBlockOutside(a, -1);
    applyBlock(a, cell);
    applyBlock(b, cell);
    expect(b.storm).toEqual(a.storm);
  });
});

function countBlocks(state) {
  let n = 0;
  for (const v of state.board.blocked) if (v) n++;
  return n;
}

describe('comeback AI (14.5)', () => {
  it('normal dashes when a dash reaches the edge (5.2: 2 steps, 6 pips)', () => {
    // 2 cells off the edge: the 2-step dash wins at once
    const edge = powerGame();
    edge.board.cat = toIndex(5, 8, W);
    edge.turn = 'cat';
    edge.power = DASH_COST;
    expect(gDistanceMap(edge).dist[edge.board.cat]).toBe(2);
    expect(shouldUsePower(edge, mulberry32(1))).toBe('dash');
    // and the dash really runs: arm it and play the first step
    armPower(edge, 'dash');
    const first = chooseCatMove(edge, mulberry32(2));
    expect(legalCatMoves(edge)).toContain(first);
    applyCatMove(edge, first);
    expect(edge.dashLeft).toBe(1);

    // 3 cells off the edge the shorter dash neither wins nor gains 2 dist
    const far = powerGame();
    far.board.cat = toIndex(5, 7, W);
    far.turn = 'cat';
    far.power = DASH_COST;
    expect(gDistanceMap(far).dist[far.board.cat]).toBe(3);
    expect(shouldUsePower(far, mulberry32(1))).toBeNull();
  });

  it('easy never dashes', () => {
    const state = powerGame();
    state.board.cat = toIndex(5, 7, W);
    state.turn = 'cat';
    state.power = DASH_COST;
    state.difficulty = 'easy';
    expect(shouldUsePower(state, mulberry32(1))).toBeNull();
  });

  it('jumps when stuck (easy too) and when enclosed (normal/hard)', () => {
    // enclosed in a dead-end pocket but still mobile: the cat at (5,4) can
    // shuffle to (4,5), which is sealed off — dist == -1 — while a corner
    // jump over any adjacent wall lands back on a connected cell
    const enclosed = powerGame();
    const b = enclosed.board;
    b.cat = toIndex(5, 4, W);
    for (const [r, c] of [
      [5, 3], [5, 5], [4, 4], [6, 4], [6, 5],
      [4, 6], [3, 5], [3, 4], [3, 6], // seal (4,5) off completely
    ]) {
      b.blocked[toIndex(r, c, W)] = 1;
    }
    enclosed.turn = 'cat';
    enclosed.power = JUMP_COST;
    expect(gDistanceMap(enclosed).dist[b.cat]).toBe(-1); // enclosed
    expect(legalCatMoves(enclosed).length).toBeGreaterThan(0); // yet mobile
    expect(jumpTargets(enclosed).length).toBeGreaterThan(0); // cornered: 1 neighbor left
    expect(shouldUsePower(enclosed, mulberry32(1))).toBe('jump');
    enclosed.difficulty = 'easy';
    expect(shouldUsePower(enclosed, mulberry32(1))).toBeNull(); // easy: stuck only

    // fully stuck: no legal move at all
    const stuck = powerGame();
    wallIn(stuck, stuck.board.cat);
    stuck.turn = 'cat';
    stuck.power = JUMP_COST;
    expect(legalCatMoves(stuck)).toEqual([]);
    stuck.difficulty = 'easy';
    expect(shouldUsePower(stuck, mulberry32(1))).toBe('jump');
    armPower(stuck, 'jump');
    const landing = chooseCatMove(stuck, mulberry32(3));
    expect(legalCatMoves(stuck)).toContain(landing);
    applyCatMove(stuck, landing);
    expect(stuck.board.cat).toBe(landing);
    expect(stuck.status).toBe('playing');
  });

  it('the trapper arms a double next to a cat with gauge ≥ 5 (normal/hard)', () => {
    const state = powerGame({
      role: 'trapper',
      gimmick: { gimmicks: {}, aiItems: 0, features: FEATURES_ON },
    });
    state.items.trapper.double = 1;
    state.turn = 'trapper';
    state.power = 5;
    // the cat sits far away (dist 5 > the normal double threshold of 2)
    expect(gDistanceMap(state).dist[state.board.cat]).toBeGreaterThan(2);
    expect(shouldUseItem(state, mulberry32(1))).toBe(true);
    state.power = 4;
    expect(shouldUseItem(state, mulberry32(1))).toBe(false);
    state.power = 5;
    state.difficulty = 'easy';
    expect(shouldUseItem(state, mulberry32(1))).toBe(false); // easy keeps the dist rule
  });
});
