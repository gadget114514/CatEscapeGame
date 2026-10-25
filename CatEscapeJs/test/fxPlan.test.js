/**
 * Rev. 6 fx tests (spec 17.5): the pure `fxPlan` for every view call and
 * every quality level, the easing helpers, the tween list and the
 * reduced-motion rules (no shake, no camera punch, quality capped at
 * medium).
 */
import { describe, it, expect } from 'vitest';
import {
  fxPlan,
  FX_VIEW_CALLS,
  FX_QUALITIES,
  FX_BUDGETS,
  defaultFxQuality,
  clampFxQuality,
  hasPostFx,
  hasGlowFx,
  hasTileShader,
  scaleCount,
} from '../src/render/fx/fxPlan.js';
import {
  clamp01,
  lerp,
  linear,
  easeInQuad,
  easeOutQuad,
  easeInOutQuad,
  easeOutCubic,
  easeInOutCubic,
  easeOutBack,
  easeOutElastic,
  easeOutBounce,
  createTweenList,
} from '../src/render/fx/tween.js';
import { isShakeAllowed, shakeOffsetAt } from '../src/render/fx/shake.js';

const CALL_ARGS = {
  animateBlock: { cell: 12, nearCat: true },
  animateCatMove: { from: 30, to: 31, kind: 'hop' },
  animateCatPath: { cells: [30, 31], from: 29, kind: 'hop' },
  animatePickup: { cell: 7 },
  animateBreak: { cell: 8 },
  animateCrumble: { cell: 9 },
  animateStorm: { cells: [10, 11, 12], center: 0 },
  animateResult: { status: 'catWin', cell: 5 },
  setHighlights: { origin: 40 },
  setHover: { cell: 22 },
  flashInvalid: { cell: 23 },
};

const hasFx = (plan, name) => plan.some((d) => d.fx === name);

describe('fxPlan (spec 17.5)', () => {
  it('plans every view call at every quality level', () => {
    for (const call of FX_VIEW_CALLS) {
      for (const q of FX_QUALITIES) {
        const plan = fxPlan(call, CALL_ARGS[call] || {}, q);
        expect(Array.isArray(plan), `${call}@${q}`).toBe(true);
        for (const d of plan) {
          expect(typeof d.fx, `${call}@${q}`).toBe('string');
        }
      }
    }
  });

  it('a block next to the cat shakes; a far block does not', () => {
    const near = fxPlan('animateBlock', { cell: 1, nearCat: true }, 'high');
    const far = fxPlan('animateBlock', { cell: 1, nearCat: false }, 'high');
    expect(hasFx(near, 'dustRing')).toBe(true);
    expect(hasFx(near, 'shake')).toBe(true);
    expect(hasFx(far, 'shake')).toBe(false);
    const shake = near.find((d) => d.fx === 'shake');
    expect(shake.dur).toBe(120);
    expect(shake.amp).toBeCloseTo(0.08, 10);
  });

  it('reduced motion disables the shake and the camera punch', () => {
    const block = fxPlan('animateBlock', { cell: 1, nearCat: true }, 'high', {
      reducedMotion: true,
    });
    expect(hasFx(block, 'shake')).toBe(false);
    const win = fxPlan('animateResult', { status: 'catWin', cell: 2 }, 'high', {
      reducedMotion: true,
    });
    expect(hasFx(win, 'cameraPunch')).toBe(false);
    // the confetti still celebrates
    expect(hasFx(win, 'confetti')).toBe(true);
    const trap = fxPlan('animateResult', { status: 'trapperWin', cell: 2 }, 'high', {
      reducedMotion: true,
    });
    expect(hasFx(trap, 'shake')).toBe(false);
  });

  it('confetti scales down with the quality and stays within the budget', () => {
    const high = fxPlan('animateResult', { status: 'catWin', cell: 1 }, 'high');
    const medium = fxPlan('animateResult', { status: 'catWin', cell: 1 }, 'medium');
    const low = fxPlan('animateResult', { status: 'catWin', cell: 1 }, 'low');
    const count = (plan) => plan.find((d) => d.fx === 'confetti').count;
    expect(count(high)).toBe(300);
    expect(count(medium)).toBe(120);
    expect(count(low)).toBe(60);
    expect(count(low)).toBeLessThanOrEqual(FX_BUDGETS.low);
  });

  it('post effects (shockwave, desaturate) are high-only', () => {
    const winHigh = fxPlan('animateResult', { status: 'catWin', cell: 1 }, 'high');
    const winMed = fxPlan('animateResult', { status: 'catWin', cell: 1 }, 'medium');
    expect(hasFx(winHigh, 'shockwavePost')).toBe(true);
    expect(hasFx(winMed, 'shockwavePost')).toBe(false);
    const trapHigh = fxPlan('animateResult', { status: 'trapperWin', cell: 1 }, 'high');
    const trapLow = fxPlan('animateResult', { status: 'trapperWin', cell: 1 }, 'low');
    expect(hasFx(trapHigh, 'desaturate')).toBe(true);
    expect(hasFx(trapLow, 'desaturate')).toBe(false);
    const jumpHigh = fxPlan('animateCatPath', { cells: [1, 2], kind: 'jump' }, 'high');
    const jumpMed = fxPlan('animateCatPath', { cells: [1, 2], kind: 'jump' }, 'medium');
    expect(hasFx(jumpHigh, 'shockwavePost')).toBe(true);
    expect(hasFx(jumpMed, 'shockwavePost')).toBe(false);
  });

  it('the trapper result still shakes without reduced motion', () => {
    const trap = fxPlan('animateResult', { status: 'trapperWin', cell: 1 }, 'medium');
    expect(hasFx(trap, 'sweatDrops')).toBe(true);
    expect(hasFx(trap, 'shake')).toBe(true);
  });

  it('gimmick moves plan their signature effects', () => {
    const tunnel = fxPlan(
      'animateCatPath',
      { cells: [10, 40], kind: 'tunnel' },
      'medium',
    );
    expect(hasFx(tunnel, 'tunnelVortex')).toBe(true);
    expect(hasFx(tunnel, 'burstOut')).toBe(true);

    const ice = fxPlan('animateCatPath', { cells: [11, 12, 13], kind: 'ice' }, 'high');
    expect(hasFx(ice, 'snowTrail')).toBe(true);
    expect(ice.find((d) => d.fx === 'snowTrail').cells).toEqual([11, 12, 13]);

    const spring = fxPlan('animateCatPath', { cells: [14, 16], kind: 'spring' }, 'high');
    expect(hasFx(spring, 'shockwaveRing')).toBe(true);

    const dash = fxPlan('animateCatPath', { cells: [15, 16], kind: 'dash' }, 'high');
    expect(hasFx(dash, 'afterimages')).toBe(true);

    const jump = fxPlan('animateCatPath', { cells: [17, 19], kind: 'jump' }, 'medium');
    expect(hasFx(jump, 'apexSparkle')).toBe(true);

    const fish = fxPlan('animateCatPath', { cells: [18], kind: 'hop', fish: true }, 'medium');
    expect(hasFx(fish, 'hearts')).toBe(true);
    expect(hasFx(fish, 'dustPuff')).toBe(true);
  });

  it('the other gameplay calls plan their table effects (17.3)', () => {
    expect(hasFx(fxPlan('animatePickup', { cell: 1 }, 'low'), 'starSpiral')).toBe(true);
    const brk = fxPlan('animateBreak', { cell: 1 }, 'medium');
    expect(hasFx(brk, 'shards')).toBe(true);
    expect(hasFx(brk, 'dustPuff')).toBe(true);
    const crumble = fxPlan('animateCrumble', { cell: 1 }, 'high');
    expect(hasFx(crumble, 'crumbleGlow')).toBe(true);
    expect(crumble.find((d) => d.fx === 'shards').small).toBe(true);
    const storm = fxPlan('animateStorm', { cells: [1, 2, 3] }, 'medium');
    expect(hasFx(storm, 'windStreaks')).toBe(true);
    expect(hasFx(storm, 'leaves')).toBe(true);
    expect(storm.filter((d) => d.fx === 'blockLift').length).toBe(3);
    expect(hasFx(fxPlan('setHighlights', { origin: 5 }, 'high'), 'ripple')).toBe(true);
    // hover and invalid flashes are board-view only
    expect(fxPlan('setHover', { cell: 5 }, 'high')).toEqual([]);
    expect(fxPlan('flashInvalid', { cell: 5 }, 'high')).toEqual([]);
  });

  it('scaleCount keeps every effect above zero but shrinks it', () => {
    expect(scaleCount(24, 'high')).toBe(24);
    expect(scaleCount(24, 'medium')).toBe(10);
    expect(scaleCount(24, 'low')).toBe(5);
    expect(scaleCount(0, 'low')).toBe(0);
  });
});

describe('fx quality helpers (spec 17.1)', () => {
  it('defaults to high on desktop and medium on touch devices', () => {
    expect(defaultFxQuality(0)).toBe('high');
    expect(defaultFxQuality(2)).toBe('medium');
  });

  it('reduced motion caps the quality at medium', () => {
    expect(clampFxQuality('high', true)).toBe('medium');
    expect(clampFxQuality('medium', true)).toBe('medium');
    expect(clampFxQuality('low', true)).toBe('low');
    expect(clampFxQuality('high', false)).toBe('high');
    expect(clampFxQuality('nonsense')).toBe('high');
  });

  it('budgets and feature gates per quality (17.1)', () => {
    expect(FX_BUDGETS).toEqual({ high: 2000, medium: 800, low: 250 });
    expect(hasPostFx('high')).toBe(true);
    expect(hasPostFx('medium')).toBe(false);
    expect(hasGlowFx('high')).toBe(true);
    expect(hasGlowFx('medium')).toBe(true);
    expect(hasGlowFx('low')).toBe(false);
    expect(hasTileShader('high')).toBe(true);
    expect(hasTileShader('medium')).toBe(true);
    expect(hasTileShader('low')).toBe(false);
  });
});

describe('easing helpers (spec 17.2/17.5)', () => {
  const easings = {
    linear,
    easeInQuad,
    easeOutQuad,
    easeInOutQuad,
    easeOutCubic,
    easeInOutCubic,
    easeOutBack,
    easeOutElastic,
    easeOutBounce,
  };

  it('every easing starts at 0 and ends at 1', () => {
    for (const [name, fn] of Object.entries(easings)) {
      expect(fn(0), name).toBeCloseTo(0, 6);
      expect(fn(1), name).toBeCloseTo(1, 6);
    }
  });

  it('easeOutBack overshoots and easeOutElastic rings', () => {
    expect(easeOutBack(0.7)).toBeGreaterThan(1);
    // elastic crosses 1 repeatedly before settling
    const samples = Array.from({ length: 20 }, (_, k) => easeOutElastic(0.3 + k * 0.03));
    expect(samples.some((v) => v > 1.01)).toBe(true);
    expect(samples.some((v) => v < 0.99)).toBe(true);
    expect(easeOutBounce(0.5)).toBeGreaterThan(0);
    expect(easeOutBounce(0.5)).toBeLessThan(1);
  });

  it('clamp01 and lerp behave', () => {
    expect(clamp01(-1)).toBe(0);
    expect(clamp01(2)).toBe(1);
    expect(clamp01(0.4)).toBe(0.4);
    expect(lerp(2, 6, 0.5)).toBe(4);
  });

  it('the tween list drives, delays and completes entries', () => {
    const list = createTweenList();
    const seen = [];
    let done = 0;
    list.add({ dur: 100, onUpdate: (t) => seen.push(t), onDone: () => (done += 1) });
    list.add({ dur: 50, delay: 100, onUpdate: () => {}, onDone: () => (done += 1) });
    expect(list.size).toBe(2);
    list.update(50);
    expect(seen).toEqual([0.5]);
    expect(done).toBe(0);
    list.update(50); // first done, second still delayed
    expect(done).toBe(1);
    expect(list.size).toBe(1);
    list.update(50);
    list.update(50);
    expect(done).toBe(2);
    expect(list.size).toBe(0);
  });
});

describe('shake helpers (spec 17.5)', () => {
  it('reduced motion forbids shaking', () => {
    expect(isShakeAllowed(false)).toBe(true);
    expect(isShakeAllowed(true)).toBe(false);
  });

  it('the jitter decays to zero at the end', () => {
    const a = shakeOffsetAt(0.1, 0, 7);
    const b = shakeOffsetAt(0.1, 0.5, 7);
    const c = shakeOffsetAt(0.1, 1, 7);
    expect(Math.hypot(a.x, a.y)).toBeGreaterThan(Math.hypot(b.x, b.y));
    expect(c).toEqual({ x: 0, y: 0 });
    expect(shakeOffsetAt(0.1, -1, 7)).toEqual({ x: 0, y: 0 });
    expect(shakeOffsetAt(0, 0.2, 7)).toEqual({ x: 0, y: 0 });
    // deterministic for the same seed
    const d = shakeOffsetAt(0.1, 0.25, 7);
    expect(d.x).toBeCloseTo(shakeOffsetAt(0.1, 0.25, 7).x, 10);
    expect(d.x === 0 && d.y === 0).toBe(false);
  });
});
