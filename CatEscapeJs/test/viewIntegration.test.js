/**
 * Controller ↔ view integration for the 13.5/13.7/14.5 presentation:
 * path-based cat animation (tunnel/ice/spring), crumble + storm
 * consumption and the gimmick toasts. The view and hud are stubs, like
 * in the other controller tests — no Babylon.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GameController } from '../src/game/controller.js';
import { gimmickRuleset } from '../src/game/rulesets.js';
import {
  KIND_BRITTLE,
  KIND_TUNNEL,
  KIND_ICE,
  KIND_FISH,
} from '../src/game/gimmick/registry.js';
import { toIndex } from '../src/game/hex.js';

const W = 11;

function makeView(over = {}) {
  return {
    calls: [],
    rebuild() {},
    setHighlights() {},
    setHint() {},
    flashInvalid(i) {
      this.calls.push(['flashInvalid', i]);
    },
    animateBlock(i) {
      this.calls.push(['animateBlock', i]);
      return Promise.resolve();
    },
    animateCatMove(from, to) {
      this.calls.push(['animateCatMove', from, to]);
      return Promise.resolve();
    },
    animateCatPath(cells, from) {
      this.calls.push(['animateCatPath', cells.slice(), from]);
      return Promise.resolve();
    },
    animatePickup(i) {
      this.calls.push(['animatePickup', i]);
      return Promise.resolve();
    },
    animateBreak(i) {
      this.calls.push(['animateBreak', i]);
      return Promise.resolve();
    },
    animateCrumble(i) {
      this.calls.push(['animateCrumble', i]);
      return Promise.resolve();
    },
    animateStorm(indices) {
      this.calls.push(['animateStorm', indices.slice()]);
      return Promise.resolve();
    },
    syncCats(state) {
      this.calls.push(['syncCats', state.selectedCat]);
    },
    animateResult(status) {
      this.calls.push(['animateResult', status]);
      return Promise.resolve();
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
    ...over,
  };
}

function makeHud() {
  return {
    calls: [],
    setStatus() {},
    setTurn() {},
    showResult() {},
    setSeed() {},
    setInventory() {},
    setPower() {},
    notify(key) {
      this.calls.push(['notify', key]);
    },
    keys(name) {
      return this.calls.filter((c) => c[0] === name).map((c) => c[1]);
    },
  };
}

function setup(viewOver) {
  const view = makeView(viewOver);
  const hud = makeHud();
  const controller = new GameController({ view, hud, aiDelayMs: 1000 });
  return { view, hud, controller };
}

function pump(ms) {
  return vi.advanceTimersByTimeAsync(ms);
}

describe('view.animateCatPath (13.5)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('a plain gimmick move animates the recorded path, not the old hop', async () => {
    const { controller, view } = setup();
    controller.start({
      ruleset: gimmickRuleset,
      role: 'escape',
      ai: 'normal',
      blocks: 0,
      gimmick: { gimmicks: {}, aiItems: 0 },
      seed: 41,
    });
    const st = controller.state;
    const from = st.board.cat;
    const to = controller.ruleset.legalCatMoves(st)[0];
    await controller.onCellClicked(to);
    expect(view.count('animateCatPath')).toBe(1);
    expect(view.count('animateCatMove')).toBe(0);
    const call = view.last('animateCatPath');
    expect(call[1]).toEqual([to]); // the path of a plain move is its entry
    expect(call[2]).toBe(from);
  });

  it('a hammer break does not move the cat (empty path)', async () => {
    const { controller, view } = setup();
    controller.start({
      ruleset: gimmickRuleset,
      role: 'escape',
      ai: 'normal',
      blocks: 0,
      gimmick: { gimmicks: {}, aiItems: 0 },
      playerItems: { hammer: 1, double: 0 },
      seed: 42,
    });
    const st = controller.state;
    st.board.blocked[toIndex(3, 5, W)] = 1; // a block at hex distance 2
    controller.useItem(); // arm the hammer
    const from = st.board.cat;
    await controller.onCellClicked(toIndex(3, 5, W));
    const kind = st.history[st.history.length - 1].kind;
    expect(kind).toBe('break');
    // the break turn: an empty path (the cat stays put); the follow-up
    // move happens on the player's next click
    const call = view.last('animateCatPath');
    expect(call[1]).toEqual([]);
    expect(call[2]).toBe(from);
    expect(st.board.cat).toBe(from);
  });

  it('a tunnel move records both ends in the path', async () => {
    const { controller, view, hud } = setup();
    controller.start({
      ruleset: gimmickRuleset,
      role: 'escape',
      ai: 'normal',
      blocks: 0,
      gimmick: { gimmicks: { tunnel: 1 }, aiItems: 0 },
      seed: 43,
    });
    const st = controller.state;
    // find the tunnel pair and stand next to one end
    const pairs = [];
    for (let i = 0; i < st.g.kind.length; i++) {
      if (st.g.kind[i] === KIND_TUNNEL) pairs.push(i);
    }
    expect(pairs.length).toBe(2);
    const entry = pairs[0];
    const exit = pairs[1];
    const neighbor = st.board.nbr[entry][0];
    st.board.cat = neighbor;
    st.cats = [neighbor];
    const to = controller.ruleset.legalCatMoves(st).find((m) => m === entry);
    expect(to).toBe(entry);
    await controller.onCellClicked(entry);
    expect(st.board.cat).toBe(exit); // the cat rests on the exit
    const call = view.last('animateCatPath');
    expect(call[1]).toEqual([entry, exit]);
    expect(hud.keys('notify')).toContain('tunnel');
  });
});

describe('crumbles and toasts (13.5)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('brittle crumbles are animated and toasted after the trapper turn', async () => {
    const { controller, view, hud } = setup();
    controller.start({
      ruleset: gimmickRuleset,
      role: 'trapper',
      ai: 'normal',
      blocks: 0,
      gimmick: { gimmicks: {}, aiItems: 0 },
      seed: 44,
    });
    const st = controller.state;
    const brittle = toIndex(8, 5, W);
    st.g.kind[brittle] = KIND_BRITTLE;
    st.board.blocked[brittle] = 1; // an old block, ttl about to expire
    st.g.ttl[brittle] = 1;
    await controller.onCellClicked(controller.ruleset.legalBlocks(st)[0]);
    expect(st.board.blocked[brittle]).toBe(0); // it crumbled
    expect(view.count('animateCrumble')).toBe(1);
    expect(view.last('animateCrumble')).toEqual(['animateCrumble', brittle]);
    expect(hud.keys('notify')).toContain('crumble');
  });

  it('a dried fish landing crumbles the newest far block with the fish toast (18.4)', async () => {
    const { controller, view, hud } = setup();
    controller.start({
      ruleset: gimmickRuleset,
      role: 'escape',
      ai: 'normal',
      blocks: 0,
      gimmick: { gimmicks: {}, aiItems: 0 },
      seed: 44,
    });
    const st = controller.state;
    // two far trapper blocks in the history (fixture: apply them directly)
    const far1 = toIndex(0, 0, W);
    const far2 = toIndex(0, 3, W);
    st.turn = 'trapper';
    controller.ruleset.applyBlock(st, far1);
    st.turn = 'trapper';
    controller.ruleset.applyBlock(st, far2);
    st.turn = 'cat';
    const fishCell = controller.ruleset.legalCatMoves(st)[0];
    st.g.kind[fishCell] = KIND_FISH;
    await controller.onCellClicked(fishCell);
    expect(st.board.blocked[far2]).toBe(0); // the newest safe block crumbled
    expect(st.board.blocked[far1]).toBe(1);
    expect(view.count('animateCrumble')).toBe(1);
    expect(view.last('animateCrumble')).toEqual(['animateCrumble', far2]);
    expect(hud.keys('notify')).toContain('fish'); // the 18.4 fish toast
  });

  it('an ice slide toasts the ice', async () => {
    const { controller, hud } = setup();
    controller.start({
      ruleset: gimmickRuleset,
      role: 'escape',
      ai: 'normal',
      blocks: 0,
      gimmick: { gimmicks: {}, aiItems: 0 },
      seed: 45,
    });
    const st = controller.state;
    // one ice cell in front of the cat: the slide stops at the next,
    // non-ice cell (NW from (4,5) continues to (3,4))
    const entry = toIndex(4, 5, W);
    st.g.kind[entry] = KIND_ICE;
    st.board.cat = toIndex(5, 5, W);
    st.cats = [st.board.cat];
    const to = controller.ruleset.legalCatMoves(st).find((m) => m === entry);
    expect(to).toBe(entry);
    await controller.onCellClicked(entry);
    expect(st.board.cat).toBe(toIndex(3, 4, W));
    expect(hud.keys('notify')).toContain('ice');
  });

  it('syncCats runs when the player selects a cat', async () => {
    const { controller, view } = setup();
    controller.start({
      ruleset: gimmickRuleset,
      role: 'escape',
      ai: 'normal',
      blocks: 0,
      gimmick: { gimmicks: {}, aiItems: 0, cats: 2, catsGoal: 'anyEscape' },
      seed: 46,
    });
    const st = controller.state;
    await controller.onCellClicked(st.cats[1]);
    expect(st.selectedCat).toBe(1);
    expect(view.count('syncCats')).toBeGreaterThanOrEqual(1);
    expect(view.last('syncCats')).toEqual(['syncCats', 1]);
  });
});

describe('power buttons (14.5)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('canUsePower reflects the ruleset and usePower arms the dash', () => {
    const { controller } = setup();
    controller.start({
      ruleset: gimmickRuleset,
      role: 'escape',
      ai: 'normal',
      blocks: 0,
      gimmick: {
        gimmicks: {},
        aiItems: 0,
        features: { power: true, dash: true, jump: false, storm: false },
      },
      seed: 47,
    });
    const st = controller.state;
    st.power = 6; // the full gauge the dash costs (5.2)
    expect(controller.canUsePower('dash')).toBe(true);
    expect(controller.canUsePower('jump')).toBe(false); // feature off
    expect(controller.usePower('dash')).toBe(true);
    expect(st.armed).toBe(true);
    expect(st.armKind).toBe('dash');
    expect(st.dashLeft).toBe(2); // at most 2 steps (5.2)
  });
});
