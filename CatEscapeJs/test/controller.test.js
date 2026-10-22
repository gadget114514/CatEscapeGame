import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GameController } from '../src/game/controller.js';
import { legalBlocks, legalCatMoves } from '../src/game/rules.js';

function makeView() {
  return {
    calls: [],
    gate: false,
    pending: [],
    rebuild(state) {
      this.calls.push(['rebuild', state.seed, state.mode]);
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

function setup({ aiDelayMs = 100 } = {}) {
  const view = makeView();
  const hud = makeHud();
  const controller = new GameController({ view, hud, aiDelayMs });
  return { view, hud, controller };
}

function pump(ms) {
  return vi.advanceTimersByTimeAsync(ms);
}

/** Drive a whole game: the player always takes the first legal move. */
async function runGame(controller, mode) {
  let guard = 0;
  while (controller.phase !== 'over' && guard++ < 600) {
    if (controller.phase === 'player') {
      const st = controller.state;
      const move = mode === 'trapper' ? legalBlocks(st)[0] : legalCatMoves(st)[0];
      await controller.onCellClicked(move);
    } else {
      await pump(1000);
    }
  }
  return guard;
}

describe('GameController', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('trapper mode: the player moves first', () => {
    const { controller, view, hud } = setup();
    controller.start({ mode: 'trapper', difficulty: 'easy', seed: 1234 });
    expect(controller.phase).toBe('player');
    expect(controller.state.turn).toBe('trapper');
    expect(controller.state.seed).toBe(1234);
    expect(view.last('rebuild')).toEqual(['rebuild', 1234, 'trapper']);
    expect(hud.last('setSeed')).toEqual(['setSeed', 1234]);
    expect(hud.last('setTurn')).toEqual(['setTurn', 'trapper', true]);
    expect(hud.last('setStatus')).toEqual(['setStatus', 'Your turn']);
    expect(view.last('setHighlights')).toEqual(['setHighlights', []]);
  });

  it('escape mode: the player cat moves first, then the AI answers', async () => {
    const { controller, view, hud } = setup({ aiDelayMs: 50 });
    controller.start({ mode: 'escape', difficulty: 'easy', seed: 5 });
    expect(controller.phase).toBe('player');
    expect(hud.last('setTurn')).toEqual(['setTurn', 'cat', true]);
    expect(view.last('setHighlights')).toEqual([
      'setHighlights',
      legalCatMoves(controller.state),
    ]);

    const to = legalCatMoves(controller.state)[0];
    await controller.onCellClicked(to);
    expect(controller.state.moveCount).toBe(1);
    expect(controller.state.board.cat).toBe(to);
    expect(view.last('animateCatMove')).toEqual(['animateCatMove', 60, to]);
    expect(controller.state.turn).toBe('trapper');
    expect(controller.phase).toBe('ai');
    expect(hud.last('setTurn')).toEqual(['setTurn', 'trapper', false]);

    await pump(1000);
    expect(controller.state.moveCount).toBe(2);
    expect(controller.state.turn).toBe('cat');
    expect(controller.phase).toBe('player');
    expect(hud.last('setTurn')).toEqual(['setTurn', 'cat', true]);
    expect(view.last('setHighlights')).toEqual([
      'setHighlights',
      legalCatMoves(controller.state),
    ]);
  });

  it('ignores clicks during the AI turn', async () => {
    const { controller, view } = setup({ aiDelayMs: 500 });
    controller.start({ mode: 'trapper', difficulty: 'easy', seed: 6 });
    expect(controller.phase).toBe('player');
    await controller.onCellClicked(legalBlocks(controller.state)[0]);
    expect(controller.phase).toBe('ai');

    const before = controller.state.moveCount;
    await controller.onCellClicked(legalBlocks(controller.state)[0]);
    expect(controller.state.moveCount).toBe(before);
    expect(controller.phase).toBe('ai');
    expect(view.count('flashInvalid')).toBe(0);
    expect(view.count('animateCatMove')).toBe(0);
    expect(view.count('animateBlock')).toBe(1);
  });

  it('ignores clicks while an animation is running', async () => {
    const { controller, view } = setup();
    controller.start({ mode: 'trapper', difficulty: 'easy', seed: 7 });
    view.gate = true;
    const first = controller.onCellClicked(legalBlocks(controller.state)[0]);
    expect(controller.phase).toBe('animating');
    expect(controller.state.moveCount).toBe(1);

    await controller.onCellClicked(legalBlocks(controller.state)[0]);
    expect(controller.state.moveCount).toBe(1);
    expect(view.count('flashInvalid')).toBe(0);

    view.gate = false;
    view.pending.forEach((resolve) => resolve());
    await first;
    expect(controller.phase).toBe('ai');
  });

  it('rejects illegal clicks with flashInvalid during the player turn', async () => {
    const { controller, view } = setup();
    controller.start({ mode: 'trapper', difficulty: 'normal', seed: 8 });
    await controller.onCellClicked(controller.state.board.cat);
    expect(view.last('flashInvalid')).toEqual(['flashInvalid', 60]);
    expect(controller.state.moveCount).toBe(0);
    expect(controller.phase).toBe('player');

    const blocked = controller.state.board.blocked.findIndex((v) => v === 1);
    expect(blocked).toBeGreaterThanOrEqual(0);
    await controller.onCellClicked(blocked);
    expect(controller.state.moveCount).toBe(0);
    expect(controller.phase).toBe('player');
    expect(view.count('flashInvalid')).toBe(2);
  });

  it('waits aiDelayMs before the AI moves', async () => {
    const { controller } = setup({ aiDelayMs: 350 });
    controller.start({ mode: 'trapper', difficulty: 'easy', seed: 9 });
    await controller.onCellClicked(legalBlocks(controller.state)[0]);
    expect(controller.phase).toBe('ai');
    expect(controller.state.moveCount).toBe(1);

    await pump(300);
    expect(controller.state.moveCount).toBe(1);
    expect(controller.phase).toBe('ai');

    await pump(60);
    expect(controller.state.moveCount).toBe(2);
    expect(controller.phase).toBe('player');
    expect(controller.state.turn).toBe('trapper');
  });

  it('runs a trapper mode game to the end', async () => {
    const { controller, view, hud } = setup();
    controller.start({ mode: 'trapper', difficulty: 'easy', seed: 77 });
    const guard = await runGame(controller, 'trapper');
    expect(guard).toBeLessThan(600);
    expect(controller.phase).toBe('over');
    expect(['catWin', 'trapperWin']).toContain(controller.state.status);
    expect(controller.state.moveCount).toBeGreaterThan(0);
    expect(controller.state.moveCount).toBe(controller.state.history.length);
    expect(view.last('animateResult')).toEqual([
      'animateResult',
      controller.state.status,
    ]);
    expect(hud.last('showResult')).toEqual([
      'showResult',
      controller.state.status,
      controller.state.moveCount,
    ]);
    expect(view.last('setHighlights')).toEqual(['setHighlights', []]);
  });

  it('runs an escape mode game to the end', async () => {
    const { controller, view, hud } = setup();
    controller.start({ mode: 'escape', difficulty: 'easy', seed: 88 });
    const guard = await runGame(controller, 'escape');
    expect(guard).toBeLessThan(600);
    expect(controller.phase).toBe('over');
    expect(['catWin', 'trapperWin']).toContain(controller.state.status);
    expect(controller.state.moveCount).toBeGreaterThan(0);
    expect(hud.last('showResult')).toEqual([
      'showResult',
      controller.state.status,
      controller.state.moveCount,
    ]);
    expect(view.last('animateResult')).toEqual([
      'animateResult',
      controller.state.status,
    ]);
  });

  it('start() during play discards the pending AI timer', async () => {
    const { controller, view, hud } = setup({ aiDelayMs: 500 });
    controller.start({ mode: 'trapper', difficulty: 'easy', seed: 1 });
    await controller.onCellClicked(legalBlocks(controller.state)[0]);
    expect(controller.phase).toBe('ai'); // timer pending

    controller.start({ mode: 'trapper', difficulty: 'easy', seed: 2 });
    expect(controller.phase).toBe('player');
    const setTurns = hud.count('setTurn');

    await pump(5000); // the old timer would have fired by now
    expect(controller.state.seed).toBe(2);
    expect(controller.state.moveCount).toBe(0);
    expect(controller.state.history).toEqual([]);
    expect(controller.phase).toBe('player');
    expect(hud.count('setTurn')).toBe(setTurns);
    expect(view.count('rebuild')).toBe(2);
  });

  it('start() during a pending animation discards the old chain', async () => {
    const { controller, view, hud } = setup({ aiDelayMs: 100 });
    controller.start({ mode: 'trapper', difficulty: 'easy', seed: 10 });
    expect(controller.phase).toBe('player');
    const blockedBefore = controller.state.board.blocked.reduce((a, b) => a + b, 0);

    view.gate = true;
    const p = controller.onCellClicked(legalBlocks(controller.state)[0]);
    expect(controller.phase).toBe('animating');

    controller.start({ mode: 'trapper', difficulty: 'easy', seed: 11 });
    expect(controller.phase).toBe('player');
    const setTurns = hud.count('setTurn');

    view.gate = false;
    view.pending.forEach((resolve) => resolve()); // old animation finishes late
    await p;
    await pump(1000);

    expect(controller.state.seed).toBe(11);
    expect(controller.state.moveCount).toBe(0);
    expect(controller.state.history).toEqual([]);
    expect(controller.phase).toBe('player');
    expect(hud.count('setTurn')).toBe(setTurns);
    expect(controller.state.board.blocked.reduce((a, b) => a + b, 0)).toBe(
      blockedBefore,
    );
  });

  it('uses the injected rngFactory with the game seed', () => {
    const view = makeView();
    const hud = makeHud();
    const factory = vi.fn((seed) => {
      let a = seed >>> 0;
      return () => {
        a = (a * 1664525 + 1013904223) >>> 0;
        return a / 4294967296;
      };
    });
    const controller = new GameController({ view, hud, aiDelayMs: 10, rngFactory: factory });
    controller.start({ mode: 'trapper', difficulty: 'easy', seed: 42 });
    expect(factory).toHaveBeenCalledWith(42);
  });

  it('ignores clicks after the game is over', async () => {
    const { controller, view } = setup();
    controller.start({ mode: 'trapper', difficulty: 'easy', seed: 77 });
    await runGame(controller, 'trapper');
    expect(controller.phase).toBe('over');
    const moves = controller.state.moveCount;
    await controller.onCellClicked(legalBlocks(controller.state)[0]);
    expect(controller.state.moveCount).toBe(moves);
    expect(view.count('flashInvalid')).toBe(0);
  });
});
