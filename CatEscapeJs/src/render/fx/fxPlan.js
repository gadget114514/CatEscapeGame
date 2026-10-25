/**
 * Pure fx planner (Rev. 6, spec 17.5): `fxPlan(viewCall, args, quality)`
 * maps the controller-facing view calls onto effect descriptors — which
 * effects fire, with which counts and durations — for a quality level.
 * No Babylon, no DOM: unit-tested on Node for every view call and every
 * quality. The fx manager plays the returned descriptors.
 */

/** Supported quality levels, richest first. */
export const FX_QUALITIES = ['high', 'medium', 'low'];

/** Live-particle budgets per quality (spec 17.1). */
export const FX_BUDGETS = { high: 2000, medium: 800, low: 250 };

/** The view calls the planner understands (spec 17.1: the view never
 * lets the controller touch fx directly). */
export const FX_VIEW_CALLS = [
  'animateBlock',
  'animateCatMove',
  'animateCatPath',
  'animatePickup',
  'animateBreak',
  'animateCrumble',
  'animateStorm',
  'animateResult',
  'setHighlights',
  'setHover',
  'flashInvalid',
];

/**
 * Default quality (spec 17.1): high on desktop, medium on touch devices.
 * @param {number} [maxTouchPoints] `navigator.maxTouchPoints`
 * @returns {'high'|'medium'|'low'}
 */
export function defaultFxQuality(maxTouchPoints = 0) {
  return maxTouchPoints > 0 ? 'medium' : 'high';
}

/**
 * `prefers-reduced-motion: reduce` caps the setting at medium (17.1).
 * @param {string} quality
 * @param {boolean} [reducedMotion]
 * @returns {'high'|'medium'|'low'}
 */
export function clampFxQuality(quality, reducedMotion = false) {
  const q = FX_QUALITIES.includes(quality) ? quality : 'high';
  if (reducedMotion && q === 'high') return 'medium';
  return /** @type {'high'|'medium'|'low'} */ (q);
}

/** Post pipeline (bloom/FXAA/vignette/shockwave): high only (17.1). */
export function hasPostFx(quality) {
  return quality === 'high';
}

/** Glow layer: high and medium (17.1). */
export function hasGlowFx(quality) {
  return quality === 'high' || quality === 'medium';
}

/** Custom tile shader: high and medium; low falls back to StandardMaterial. */
export function hasTileShader(quality) {
  return quality === 'high' || quality === 'medium';
}

/**
 * Scale a nominal (high) particle count down for the quality level.
 * @param {number} count
 * @param {string} quality
 * @returns {number}
 */
export function scaleCount(count, quality) {
  const n = Math.max(0, Math.floor(count) || 0);
  if (quality === 'high') return n;
  if (quality === 'medium') return Math.max(n > 0 ? 1 : 0, Math.round(n * 0.4));
  return Math.max(n > 0 ? 1 : 0, Math.round(n * 0.2));
}

/**
 * Plan the effects of one view call (spec 17.5).
 *
 * `args` shapes per call:
 * - `animateBlock` `{cell, nearCat}`
 * - `animateCatMove` `{from, to, kind}` / `animateCatPath`
 *   `{cells, from, kind}` with kind `hop|tunnel|ice|spring|dash|jump|
 *   break|plain` (the view classifies the move from `state`)
 * - `animatePickup`/`animateBreak`/`animateCrumble` `{cell}`
 * - `animateStorm` `{cells, center}`
 * - `animateResult` `{status:'catWin'|'trapperWin', cell}`
 * - `setHighlights` `{origin}` / `setHover` `{cell}` / `flashInvalid`
 *   `{cell}`
 *
 * @param {string} viewCall one of `FX_VIEW_CALLS`
 * @param {object} [args] call arguments (see above)
 * @param {string} [quality]
 * @param {{reducedMotion?: boolean}} [opts]
 * @returns {Array<{fx: string, [k: string]: any}>} effect descriptors
 */
export function fxPlan(viewCall, args = {}, quality = 'high', opts = {}) {
  const q = FX_QUALITIES.includes(quality) ? quality : 'high';
  const reduced = !!opts.reducedMotion;
  const out = [];
  const cell = Number.isInteger(args.cell) ? args.cell : -1;
  const S = (n) => scaleCount(n, q);

  switch (viewCall) {
    case 'animateBlock': {
      out.push({ fx: 'dustRing', cell, count: S(24), dur: 500 });
      if (args.nearCat && !reduced) {
        out.push({ fx: 'shake', dur: 120, amp: 0.08 });
      }
      break;
    }

    case 'animateCatMove':
    case 'animateCatPath': {
      const cells = Array.isArray(args.cells) ? args.cells : [args.to];
      const last = cells.length > 0 ? cells[cells.length - 1] : args.to;
      const kind = args.kind || 'hop';
      if (kind === 'tunnel' && cells.length >= 2) {
        out.push({ fx: 'tunnelVortex', cell: cells[0], dur: 300 });
        out.push({ fx: 'burstOut', cell: last, count: S(26), delay: 150, dur: 350 });
      } else if (kind === 'ice') {
        out.push({ fx: 'snowTrail', cells, dur: 200 + 60 * cells.length });
      } else if (kind === 'spring') {
        out.push({ fx: 'shockwaveRing', cell: last, dur: 420 });
        out.push({ fx: 'dustPuff', cell: last, count: S(10), delay: 180 });
      } else if (kind === 'dash') {
        out.push({ fx: 'afterimages', cell: last, count: 2, dur: 300 });
        out.push({ fx: 'dustPuff', cell: last, count: S(6) });
      } else if (kind === 'jump') {
        out.push({ fx: 'apexSparkle', cell: last, count: S(18), dur: 360 });
        if (hasPostFx(q) && !reduced) out.push({ fx: 'shockwavePost', dur: 420 });
      } else if (kind !== 'break') {
        out.push({ fx: 'dustPuff', cell: last, count: S(8), delay: 120 });
      }
      if (kind === 'fish' || args.fish) {
        out.push({ fx: 'hearts', cell: last, count: S(12), dur: 900 });
      }
      break;
    }

    case 'animatePickup': {
      out.push({ fx: 'starSpiral', cell, count: S(20), dur: 700 });
      break;
    }

    case 'animateBreak': {
      out.push({ fx: 'shards', cell, count: S(12), dur: 700 });
      out.push({ fx: 'dustPuff', cell, count: S(8), delay: 80 });
      break;
    }

    case 'animateCrumble': {
      out.push({ fx: 'crumbleGlow', cell, dur: 450 });
      out.push({ fx: 'shards', cell, count: S(8), small: true, delay: 150, dur: 700 });
      break;
    }

    case 'animateStorm': {
      const list = Array.isArray(args.cells) ? args.cells : [];
      out.push({ fx: 'windStreaks', dur: 1000 });
      out.push({ fx: 'leaves', count: S(30), dur: 1200 });
      for (const i of list.slice(0, 8)) {
        out.push({ fx: 'blockLift', cell: i, delay: 400, dur: 500 });
      }
      break;
    }

    case 'animateResult': {
      if (args.status === 'catWin') {
        out.push({ fx: 'confetti', cell, count: S(300), dur: 2400 });
        if (!reduced) out.push({ fx: 'cameraPunch', dur: 380 });
        if (hasPostFx(q)) out.push({ fx: 'shockwavePost', dur: 500 });
      } else {
        out.push({ fx: 'sweatDrops', cell, count: S(10), dur: 900 });
        if (hasPostFx(q)) out.push({ fx: 'desaturate', dur: 600 });
        if (!reduced) out.push({ fx: 'shake', dur: 220, amp: 0.05 });
      }
      break;
    }

    case 'setHighlights': {
      if (Number.isInteger(args.origin) && args.origin >= 0) {
        out.push({ fx: 'ripple', cell: args.origin, dur: 700 });
      }
      break;
    }

    case 'setHover':
    case 'flashInvalid': {
      // the tile lift / red flash live in the board view itself
      break;
    }

    default:
      break;
  }
  return out;
}
