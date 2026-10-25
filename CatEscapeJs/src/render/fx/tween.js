/**
 * Pure easing helpers + a tiny tween list (Rev. 6, spec 17.2). No
 * Babylon and no DOM: the fx manager drives the list from
 * `scene.onBeforeRenderObservable`, while the easing functions are
 * unit-tested on Node.
 */

/**
 * @param {number} t
 * @returns {number} t clamped to 0..1
 */
export function clamp01(t) {
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

/**
 * @param {number} a
 * @param {number} b
 * @param {number} t
 * @returns {number}
 */
export function lerp(a, b, t) {
  return a + (b - a) * t;
}

/** @param {number} t @returns {number} */
export function linear(t) {
  return t;
}

/** @param {number} t @returns {number} */
export function easeInQuad(t) {
  return t * t;
}

/** @param {number} t @returns {number} */
export function easeOutQuad(t) {
  return t * (2 - t);
}

/** @param {number} t @returns {number} */
export function easeInOutQuad(t) {
  return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
}

/** @param {number} t @returns {number} */
export function easeOutCubic(t) {
  const u = t - 1;
  return u * u * u + 1;
}

/** @param {number} t @returns {number} */
export function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/**
 * Overshoots slightly before settling (toasts, pickups).
 * @param {number} t
 * @returns {number}
 */
export function easeOutBack(t) {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  const u = t - 1;
  return 1 + c3 * u * u * u + c1 * u * u;
}

/**
 * Damped elastic settle (cat landing squash).
 * @param {number} t
 * @returns {number}
 */
export function easeOutElastic(t) {
  if (t === 0 || t === 1) return t;
  const c4 = (2 * Math.PI) / 3;
  return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
}

/**
 * Bouncing ball settle (block drop landing).
 * @param {number} t
 * @returns {number}
 */
export function easeOutBounce(t) {
  const n1 = 7.5625;
  const d1 = 2.75;
  if (t < 1 / d1) return n1 * t * t;
  if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
  if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
  return n1 * (t -= 2.625 / d1) * t + 0.984375;
}

/**
 * @typedef {{
 *   dur: number,
 *   ease?: (t:number)=>number,
 *   onUpdate: (t:number)=>void,
 *   onDone?: ()=>void,
 *   delay?: number
 * }} TweenSpec
 */

/**
 * A minimal time-driven tween list. `update(dtMs)` advances every entry;
 * finished entries run `onDone` and are removed. Pure — no scene.
 * @returns {{add(spec:TweenSpec):void, update(dtMs:number):number,
 *            clear():void, size:number}}
 */
export function createTweenList() {
  /** @type {Array<TweenSpec & {t:number, elapsed:number}>} */
  let items = [];

  return {
    get size() {
      return items.length;
    },

    /**
     * @param {TweenSpec} spec
     */
    add(spec) {
      items.push({ ...spec, t: 0, elapsed: -(spec.delay || 0) });
    },

    /**
     * @param {number} dtMs
     * @returns {number} live tween count after the update
     */
    update(dtMs) {
      if (items.length === 0) return 0;
      /** @type {Array<TweenSpec & {t:number, elapsed:number}>} */
      const next = [];
      for (const item of items) {
        item.elapsed += dtMs;
        if (item.elapsed < 0) {
          next.push(item);
          continue;
        }
        const t = clamp01(item.elapsed / Math.max(1, item.dur));
        const e = item.ease ? item.ease(t) : t;
        item.onUpdate(e);
        if (t >= 1) {
          if (item.onDone) item.onDone();
        } else {
          next.push(item);
        }
      }
      items = next;
      return items.length;
    },

    clear() {
      items = [];
    },
  };
}
