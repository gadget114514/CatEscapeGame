import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GameController } from '../src/game/controller.js';
import { basicRuleset, gimmickRuleset } from '../src/game/rulesets.js';
import { resolveGame } from '../src/game/play/setup.js';
import { shortestPathToEdge, distanceMap } from '../src/game/board.js';
import { legalBlocks, legalCatMoves } from '../src/game/rules.js';
import { toIndex } from '../src/game/hex.js';
import { hexDistance } from '../src/game/gimmick/hexDir.js';
import { getLevel, blocksFor } from '../src/game/play/levels.js';

function makeView() {
  return {
    calls: [],
    gate: false,
    pending: [],
    rebuild(state) {
      this.calls.push(['rebuild', state.seed]);
    },
    setHighlights(indices) {
      this.calls.push(['setHighlights', indices.slice()]);
    },
    setHint(path) {
      this.calls.push(['setHint', path]);
    },
    flashInvalid(i) {
      this.calls.push(['flashInvalid', i]);
    },
    animateBlock(i) {
      this.calls.push(['animateBlock', i]);
      return this._anim();
    },
    animateCatMove(from, to) {
      this.calls.push(['animateCatMove', from, to]);
      return this._anim();
    },
    animateResult(status) {
      this.calls.push(['animateResult', status]);
      return this._anim();
    },
    _anim() {
      if (!this.gate) return Promise.resolve();
      let resolve;
      const p = new Promise((r) => {
        resolve = r;
      });
      this.pending.push(resolve);
      return p;
    },
    last(name) {
      for (let i = this.calls.length - 1; i >= 0; i--) {
        if (this.calls[i][0] === name) return this.calls[i];
      }
      return null;
    },
    count(name) {
      return this.calls.filter((c) => c[0] === name).length;
    },
  };
}

function makeHud() {
  return {
    calls: [],
    setStatus(t) {
      this.calls.push(['setStatus', t]);
    },
    setTurn(s, p) {
      this.calls.push(['setTurn', s, p]);
    },
    showResult(s, m) {
      this.calls.push(['showResult', s, m]);
    },
    setSeed(s) {
      this.calls.push(['setSeed', s]);
    },
    notify(key) {
      this.calls.push(['notify', key]);
    },
    setInventory(items, playerSide, armed) {
      this.calls.push([
        'setInventory',
        JSON.parse(JSON.stringify(items)),
        playerSide,
        armed,
      ]);
    },
    last(name) {
      for (let i = this.calls.length - 1; i >= 0; i--) {
        if (this.calls[i][0] === name) return this.calls[i];
      }
      return null;
    },
    count(name) {
      return this.calls.filter((c) => c[0] === name).length;
    },
    keys(name) {
      return this.calls.filter((c) => c[0] === name).map((c) => c[1]);
    },
  };
}

function setup({ aiDelayMs = 100, onGameOver } = {}) {
  const view = makeView();
  const hud = makeHud();
  const controller = new GameController({ view, hud, aiDelayMs, onGameOver });
  return { view, hud, controller };
}

function pump(ms) {
  return vi.advanceTimersByTimeAsync(ms);
}

/** Drive a whole game: the player always takes the first legal move. */
async function runGame(controller, mode) {
  const rs = controller.ruleset;
  let guard = 0;
  while (controller.phase !== 'over' && guard++ < 600) {
    if (controller.phase === 'player') {
      const st = controller.state;
      const move = mode === 'trapper' ? rs.legalBlocks(st)[0] : rs.legalCatMoves(st)[0];
      await controller.onCellClicked(move);
    } else {
      await pump(1000);
    }
  }
  return guard;
}

const GIMMICK = { gimmicks: {}, aiItems: 0 };

describe('ruleset injection', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('defaults to the basic ruleset (old start style unchanged)', () => {
    const { controller } = setup();
    controller.start({ mode: 'trapper', difficulty: 'easy', seed: 3 });
    expect(controller.ruleset).toBe(basicRuleset);
    expect(controller.state.cells).toBeUndefined();
    expect(controller.state.mode).toBe('trapper');
    expect(controller.phase).toBe('player');
  });

  it('start({ruleset}) runs the gimmick game with role/ai options', () => {
    const { controller, view } = setup();
    controller.start({
      ruleset: gimmickRuleset,
      role: 'escape',
      ai: 'easy',
      blocks: 0,
      gimmick: GIMMICK,
      playerItems: { hammer: 2, double: 0 },
      seed: 8,
    });
    expect(controller.ruleset).toBe(gimmickRuleset);
    expect(controller.state.cells).toBeInstanceOf(Uint8Array);
    expect(controller.state.items).toEqual({
      cat: { hammer: 2 },
      trapper: { double: 0 },
    });
    expect(controller.state.turn).toBe('cat'); // escape role: player is the cat
    expect(controller.phase).toBe('player');
    expect(view.count('rebuild')).toBe(1);
    // the ruleset sticks for the next start
    controller.start({ mode: 'trapper', difficulty: 'hard', seed: 9 });
    expect(controller.ruleset).toBe(gimmickRuleset);
    expect(controller.state.cells).toBeInstanceOf(Uint8Array);
    expect(controller.state.mode).toBe('trapper');
  });

  it('start accepts resolveGame output directly', () => {
    const { controller } = setup();
    const { ruleset, newGameOpts } = resolveGame({
      rules: 'gimmick',
      play: 'level',
      role: 'trapper',
      level: 18,
    });
    controller.start({ ruleset, ...newGameOpts, seed: 21 });
    // 14.6: the level's calibrated normal-difficulty block center
    expect(controller.state.board.blocked.reduce((a, b) => a + b, 0)).toBe(
      blocksFor(getLevel('trapper', 18), 'normal', 'gimmick'),
    );
    expect(controller.state.items.cat.hammer).toBe(1); // the AI cat's hammers
    expect(controller.state.difficulty).toBe('hard');
    expect(controller.phase).toBe('player');
  });
});

describe('useItem()', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function trapperWithDouble() {
    const ctx = setup();
    ctx.controller.start({
      ruleset: gimmickRuleset,
      role: 'trapper',
      ai: 'easy',
      blocks: 0,
      gimmick: GIMMICK,
      playerItems: { hammer: 0, double: 1 },
      seed: 4,
    });
    return ctx;
  }

  it('double: arms, keeps the player turn for two blocks, then passes', async () => {
    const { controller, view, hud } = trapperWithDouble();
    expect(controller.phase).toBe('player');

    expect(controller.useItem()).toBe(true);
    expect(controller.state.armed).toBe(true);
    expect(controller.state.blocksLeft).toBe(2);
    expect(controller.state.items.trapper.double).toBe(0);
    expect(hud.last('notify')).toEqual(['notify', 'doubleArmed']);
    expect(hud.last('setInventory')).toEqual([
      'setInventory',
      { trapper: { double: 0 }, cat: { hammer: 0 } },
      'trapper',
      true,
    ]);

    const first = legalBlocks(controller.state)[0];
    await controller.onCellClicked(first);
    expect(controller.state.turn).toBe('trapper'); // the double keeps the turn
    expect(controller.phase).toBe('player');
    expect(controller.state.armed).toBe(true);
    expect(controller.state.history.map((h) => h.kind)).toEqual(['arm', 'block']);
    expect(view.count('animateBlock')).toBe(1);

    const second = legalBlocks(controller.state).find((i) => i !== first);
    await controller.onCellClicked(second);
    expect(controller.state.turn).toBe('cat');
    expect(controller.state.armed).toBe(false);
    expect(controller.phase).toBe('ai');
    expect(controller.state.history.map((h) => h.kind)).toEqual([
      'arm',
      'block',
      'block',
    ]);
    expect(view.count('animateBlock')).toBe(2);
    expect(hud.last('setInventory')[3]).toBe(false);
  });

  it('toggling off does not refund the double', () => {
    const { controller } = trapperWithDouble();
    expect(controller.useItem()).toBe(true);
    expect(controller.state.armed).toBe(true);
    expect(controller.useItem()).toBe(true); // disarm
    expect(controller.state.armed).toBe(false);
    expect(controller.state.blocksLeft).toBe(1);
    expect(controller.state.items.trapper.double).toBe(0); // spent at arm time
    expect(controller.useItem()).toBe(false); // no double left
  });

  it('useItem is rejected during the AI turn and after game over', async () => {
    const { controller } = trapperWithDouble();
    await controller.onCellClicked(legalBlocks(controller.state)[0]);
    expect(controller.phase).toBe('ai');
    expect(controller.useItem()).toBe(false); // not the player phase
    await pump(1000);
    // play to the end
    await runGame(controller, 'trapper');
    expect(controller.phase).toBe('over');
    expect(controller.useItem()).toBe(false);
  });

  it('hammer (escape role): arm, break at distance 2, then move (14.1)', async () => {
    const { controller, hud, view } = setup();
    controller.start({
      ruleset: gimmickRuleset,
      role: 'escape',
      ai: 'easy',
      blocks: 0,
      gimmick: GIMMICK,
      playerItems: { hammer: 1, double: 0 },
      seed: 6,
    });
    // a block at hex distance 2 from the cat: the hammer's only legal target
    const b = controller.state.board;
    const target = toIndex(3, 5, 11);
    expect(hexDistance(b.cat, target, b.W)).toBe(2);
    b.blocked[target] = 1;
    expect(controller.ruleset.legalCatMoves(controller.state)).not.toContain(target);

    expect(controller.useItem()).toBe(true);
    expect(controller.state.armed).toBe(true);
    expect(hud.last('notify')).toEqual(['notify', 'hammerArmed']);

    const moves = controller.ruleset.legalCatMoves(controller.state);
    expect(moves).toContain(target); // armed: the break target is clickable

    await controller.onCellClicked(target);
    expect(controller.state.board.blocked[target]).toBe(0);
    expect(controller.state.items.cat.hammer).toBe(0);
    expect(controller.state.armed).toBe(false);
    expect(controller.state.turn).toBe('cat'); // the turn stays with the cat
    expect(controller.phase).toBe('player'); // ... so the player moves again
    expect(controller.state.history.map((h) => h.kind)).toEqual(['arm', 'break']);

    // the follow-up normal move passes the turn to the AI trapper
    const step = controller.ruleset.legalCatMoves(controller.state)[0];
    await controller.onCellClicked(step);
    expect(controller.state.turn).toBe('trapper');
    expect(controller.phase).toBe('ai');
    expect(controller.state.history.map((h) => h.kind)).toEqual(['arm', 'break', 'move']);
    expect(hud.last('setInventory')[3]).toBe(false);
  });

  it('basic rules: canUseItem is false and the inventory is never touched', () => {
    const { controller, hud } = setup();
    controller.start({ mode: 'escape', difficulty: 'normal', seed: 5 });
    expect(controller.useItem()).toBe(false);
    expect(hud.count('notify')).toBe(0);
    expect(hud.count('setInventory')).toBe(0);
    expect(controller.state.armed).toBeUndefined();
  });
});

describe('showHint()', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows the shortest route and clears it on the next move (player)', async () => {
    const { controller, view } = setup();
    controller.start({ mode: 'escape', difficulty: 'easy', seed: 10 });
    controller.showHint();
    const expected = shortestPathToEdge(controller.state.board);
    expect(expected).not.toBeNull();
    expect(view.last('setHint')).toEqual(['setHint', expected]);
    expect(view.last('setHint')[1][0]).toBe(controller.state.board.cat);

    await controller.onCellClicked(expected[1]); // walk along the hint
    expect(view.last('setHint')).toEqual(['setHint', null]);
  });

  it('clears the hint on the AI move too', async () => {
    const { controller, view } = setup({ aiDelayMs: 50 });
    controller.start({ mode: 'escape', difficulty: 'easy', seed: 11 });
    const path = shortestPathToEdge(controller.state.board);
    await controller.onCellClicked(path[1]);
    // hint re-shown while the AI is thinking
    controller.showHint();
    expect(view.last('setHint')[1]).not.toBeNull();
    await pump(1000);
    expect(view.count('setHint')).toBeGreaterThanOrEqual(3);
    expect(view.last('setHint')).toEqual(['setHint', null]);
  });

  it('does nothing once the game is over', async () => {
    const { controller, view } = setup();
    controller.start({ mode: 'trapper', difficulty: 'easy', seed: 12 });
    await runGame(controller, 'trapper');
    expect(controller.phase).toBe('over');
    const before = view.count('setHint');
    controller.showHint();
    expect(view.count('setHint')).toBe(before);
  });
});

describe('AI item use', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('the AI trapper arms and plays its double (notify + two blocks)', async () => {
    const { controller, hud, view } = setup({ aiDelayMs: 50 });
    controller.start({
      ruleset: gimmickRuleset,
      role: 'escape',
      ai: 'easy',
      blocks: 0,
      gimmick: { gimmicks: {}, aiItems: 1 },
      seed: 13,
    });
    // put the cat one move away from the edge: easy arms at dist <= 1
    const b = controller.state.board;
    b.cat = toIndex(1, 3, 11);
    expect(distanceMap(b).dist[b.cat]).toBe(1);

    // the player steps sideways (not onto the edge) so dist stays 1
    await controller.onCellClicked(toIndex(1, 4, 11));
    expect(controller.phase).toBe('ai');
    await pump(1000);
    await pump(1000);

    expect(hud.keys('notify')).toContain('aiDouble');
    expect(controller.state.items.trapper.double).toBe(0);
    expect(controller.state.history.map((h) => h.kind)).toEqual([
      'move',
      'arm',
      'block',
      'block',
    ]);
    expect(view.count('animateBlock')).toBe(2);
    expect(controller.state.turn).toBe('cat');
    expect(controller.phase).toBe('player');
    expect(controller.state.status).toBe('playing');
    const lastInv = hud.last('setInventory');
    expect(lastInv[2]).toBe('cat'); // playerSide
    expect(lastInv[3]).toBe(false);
  });

  it('the AI cat arms, breaks a distance-2 block and then moves (14.1)', async () => {
    const { controller, hud, view } = setup({ aiDelayMs: 50 });
    controller.start({
      ruleset: gimmickRuleset,
      role: 'trapper',
      ai: 'normal',
      blocks: 0,
      gimmick: { gimmicks: {}, aiItems: 1 },
      seed: 14,
    });
    // corridor fixture: the cat's exit distance is 4; the edge cell (4,0)
    // sits at hex distance 2 behind the open pocket (4,1) — breaking it
    // gains 2 dist over the best normal move, so normal arms
    const b = controller.state.board;
    b.blocked.fill(1);
    for (let r = 0; r <= 4; r++) b.blocked[toIndex(r, 2, 11)] = 0;
    b.cat = toIndex(4, 2, 11);
    b.blocked[toIndex(4, 1, 11)] = 0; // the pocket
    b.blocked[toIndex(10, 10, 11)] = 0; // a harmless cell for the player to block
    expect(controller.state.items.cat.hammer).toBe(1);

    await controller.onCellClicked(toIndex(10, 10, 11)); // player blocks far away
    expect(controller.phase).toBe('ai');
    await pump(1000); // arm + break (the turn stays with the cat)
    await pump(1000); // the follow-up move

    expect(hud.keys('notify')).toContain('aiHammer');
    expect(controller.state.items.cat.hammer).toBe(0);
    const kinds = controller.state.history.map((h) => h.kind);
    expect(kinds).toContain('break');
    expect(kinds).toContain('move');
    expect(controller.state.turn).toBe('trapper');
    expect(controller.phase).toBe('player');
    expect(controller.state.status).toBe('playing');
    expect(distanceMap(controller.state.board).dist[controller.state.board.cat]).toBe(1);
    expect(view.count('animateCatMove')).toBe(2); // break turn + move turn
  });

  it('basic rules: the AI never arms anything', async () => {
    const { controller, hud } = setup({ aiDelayMs: 50 });
    controller.start({ mode: 'escape', difficulty: 'easy', seed: 15 });
    await controller.onCellClicked(legalCatMoves(controller.state)[0]);
    await pump(1000);
    expect(hud.count('notify')).toBe(0);
    expect(hud.count('setInventory')).toBe(0);
    expect(controller.state.history.every((h) => !('kind' in h))).toBe(true);
  });
});

describe('multi-cat play (13.7)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /** Two-cat escape game (the player is the cat side). */
  function twoCatGame(controller, goal = 'anyEscape') {
    controller.start({
      ruleset: gimmickRuleset,
      role: 'escape',
      ai: 'normal',
      blocks: 0,
      gimmick: { gimmicks: {}, aiItems: 0, cats: 2, catsGoal: goal },
      seed: 31,
    });
    return controller.state;
  }

  it('clicking a cat selects it; a destination then moves that cat', async () => {
    const { controller, view } = setup();
    const st = twoCatGame(controller);
    expect(st.cats.length).toBe(2);
    expect(st.selectedCat).toBe(0);

    await controller.onCellClicked(st.cats[1]); // select the other cat
    expect(st.selectedCat).toBe(1);
    expect(st.board.cat).toBe(st.cats[1]);
    expect(controller.phase).toBe('player');
    expect(view.last('setHighlights')).toEqual([
      'setHighlights',
      controller.ruleset.legalCatMoves(st),
    ]);

    const from = st.cats[1];
    const to = controller.ruleset.legalCatMoves(st)[0];
    await controller.onCellClicked(to);
    expect(st.cats[1]).toBe(to);
    expect(st.cats[0]).not.toBe(to);
    expect(st.moveCount).toBe(1);
    expect(view.last('animateCatMove')).toEqual(['animateCatMove', from, to]);
  });

  it('select-then-move works under anyCatch and keeps the shared goal state', async () => {
    const { controller } = setup();
    const st = twoCatGame(controller, 'anyCatch');
    expect(st.catsGoal).toBe('anyCatch');
    await controller.onCellClicked(st.cats[1]);
    const to = controller.ruleset.legalCatMoves(st)[0];
    await controller.onCellClicked(to);
    expect(st.cats[1]).toBe(to);
    expect(st.escaped).toBe(0);
    expect(st.status).toBe('playing');
  });

  it('the AI cat side picks its cat via chooseAICat (an escaping cat is moved)', async () => {
    const { controller } = setup({ aiDelayMs: 50 });
    controller.start({
      ruleset: gimmickRuleset,
      role: 'trapper',
      ai: 'normal',
      blocks: 0,
      gimmick: { gimmicks: {}, aiItems: 0, cats: 2, catsGoal: 'anyEscape' },
      seed: 32,
    });
    const st = controller.state;
    // one move from the edge, the other far away
    st.cats[0] = toIndex(1, 3, 11);
    st.cats[1] = toIndex(5, 5, 11);
    st.board.cat = st.cats[0];
    st.selectedCat = 0;
    await controller.onCellClicked(toIndex(10, 10, 11)); // player blocks far away
    // 18.2: two free cats → two blocks per trapper turn
    expect(controller.phase).toBe('player');
    await controller.onCellClicked(toIndex(10, 8, 11)); // still far from both cats
    expect(controller.phase).toBe('ai');
    await pump(1000);
    expect(st.status).toBe('catWin'); // the AI cat escaped at once
    expect(st.cats[0]).toBeLessThan(11); // it moved onto the top edge
  });

  it('auto-selects the only movable cat when the trapper turn ends', async () => {
    const { controller } = setup({ aiDelayMs: 50 });
    controller.start({
      ruleset: gimmickRuleset,
      role: 'trapper',
      ai: 'normal',
      blocks: 0,
      gimmick: { gimmicks: {}, aiItems: 0, cats: 2, catsGoal: 'anyEscape' },
      seed: 33,
    });
    const st = controller.state;
    const nbrs = Array.from(st.board.nbr[st.cats[0]]);
    for (const j of nbrs) st.board.blocked[j] = 1; // cage cat 0
    st.selectedCat = 1;
    // 18.2: the budget was set at game start (two free cats); the fixture
    // cages one of them mid-turn, so the second block ends the turn
    const first = controller.ruleset.legalBlocks(st)[0];
    await controller.onCellClicked(first);
    expect(st.turn).toBe('trapper');
    expect(controller.phase).toBe('player');
    const second = controller.ruleset.legalBlocks(st).find((i) => i !== first);
    await controller.onCellClicked(second);
    expect(st.turn).toBe('cat'); // the last block passes the turn
    expect(controller.phase).toBe('ai'); // the AI cat side answers
    expect(st.selectedCat).toBe(1); // the only movable cat is auto-selected
    expect(st.board.cat).toBe(st.cats[1]);
    expect(controller.ruleset.legalCatMoves(st).length).toBeGreaterThan(0);
  });

  it('showHint follows the goal-relevant cat (gimmick-aware)', () => {
    const { controller, view } = setup();
    const st = twoCatGame(controller);
    controller.showHint();
    const path = controller.ruleset.hintPath(st);
    expect(path).not.toBeNull();
    expect(view.last('setHint')).toEqual(['setHint', path]);
    expect(path[0]).toBe(st.cats[0]);
  });
});

describe('onGameOver', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('fires exactly once with the final result', async () => {
    const results = [];
    const { controller, hud } = setup({
      onGameOver: (r) => {
        results.push(r);
      },
    });
    controller.start({ mode: 'trapper', difficulty: 'easy', seed: 77 });
    expect(results.length).toBe(0);
    await runGame(controller, 'trapper');
    expect(controller.phase).toBe('over');
    expect(results.length).toBe(1);
    expect(results[0].status).toBe(controller.state.status);
    expect(results[0].moveCount).toBe(controller.state.moveCount);
    expect(results[0].state).toBe(controller.state);
    expect(hud.last('showResult')).toEqual([
      'showResult',
      controller.state.status,
      controller.state.moveCount,
    ]);

    // clicks after game over do not fire it again
    await controller.onCellClicked(legalBlocks(controller.state)[0]);
    await pump(5000);
    expect(results.length).toBe(1);
  });

  it('resets per game and works with the gimmick ruleset', async () => {
    const results = [];
    const { controller } = setup({
      onGameOver: (r) => {
        results.push(r);
      },
    });
    controller.start({ mode: 'escape', difficulty: 'easy', seed: 78 });
    await runGame(controller, 'escape');
    expect(results.length).toBe(1);

    controller.start({
      ruleset: gimmickRuleset,
      role: 'trapper',
      ai: 'normal',
      blocks: 7,
      gimmick: GIMMICK,
      seed: 79,
    });
    expect(results.length).toBe(1); // not yet
    await runGame(controller, 'trapper');
    expect(results.length).toBe(2);
    expect(results[1].status).toBe(controller.state.status);
  });

  it('is optional: the controller works without it', async () => {
    const { controller } = setup();
    controller.start({ mode: 'trapper', difficulty: 'easy', seed: 80 });
    expect(await runGame(controller, 'trapper')).toBeLessThan(600);
    expect(controller.phase).toBe('over');
  });
});
