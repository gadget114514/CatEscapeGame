/**
 * Screen shake + camera punch (Rev. 6, spec 17.2/17.5). The pure part
 * (`isShakeAllowed`, `shakeOffsetAt`) is unit-tested on Node; the shaker
 * offsets `camera.targetScreenOffset` from the render loop and never
 * runs when the user prefers reduced motion.
 */
import { Vector2 } from '@babylonjs/core/Maths/math.vector.js';

/**
 * `prefers-reduced-motion: reduce` forces **no** screen shake and no
 * camera punch (spec 17.1).
 * @param {boolean} reducedMotion
 * @returns {boolean}
 */
export function isShakeAllowed(reducedMotion) {
  return !reducedMotion;
}

/**
 * Deterministic jitter at normalized time `t` (0..1) with a linear decay
 * envelope. Returns zero vectors once `t >= 1`.
 * @param {number} amp peak offset in world units
 * @param {number} t 0..1 progress of the shake
 * @param {number} seed integer salt
 * @returns {{x:number, y:number}}
 */
export function shakeOffsetAt(amp, t, seed) {
  if (!(t >= 0) || t >= 1 || amp === 0) return { x: 0, y: 0 };
  const decay = 1 - t;
  const n = (k) => {
    const s = Math.sin((seed * 127.1 + k * 311.7) * 43758.5453);
    return (s - Math.floor(s)) * 2 - 1; // -1..1
  };
  return { x: n(1) * amp * decay, y: n(2) * amp * decay };
}

/**
 * A reusable shaker bound to one camera. `punch(dur, amp)` starts a
 * shake; a reduced-motion shaker ignores every punch. The caller drives
 * `update(dtMs)` from `scene.onBeforeRenderObservable`.
 * @param {import('@babylonjs/core/Cameras/arcRotateCamera.js').ArcRotateCamera} camera
 * @param {{reducedMotion?: boolean}} [opts]
 */
export function createShaker(camera, opts = {}) {
  let reducedMotion = !!opts.reducedMotion;
  let remaining = 0;
  let dur = 1;
  let amp = 0;
  let seed = 1;
  let base = null;

  return {
    /**
     * @param {boolean} value
     */
    setReducedMotion(value) {
      reducedMotion = !!value;
      if (reducedMotion) remaining = 0;
    },

    get reducedMotion() {
      return reducedMotion;
    },

    get active() {
      return remaining > 0;
    },

    /**
     * Start a short shake (and a camera punch-in when `punch` is set).
     * @param {number} durationMs
     * @param {number} amplitude
     * @param {number} [salt]
     */
    punch(durationMs, amplitude, salt) {
      if (!isShakeAllowed(reducedMotion)) return;
      dur = Math.max(1, durationMs);
      amp = amplitude;
      seed = Number.isFinite(salt) ? salt : 1 + ((seed * 16807) % 2147483647);
      remaining = dur;
      if (!base) base = camera.targetScreenOffset.clone();
    },

    /**
     * @param {number} dtMs
     */
    update(dtMs) {
      if (remaining <= 0) {
        if (base && camera) camera.targetScreenOffset.set(base.x, base.y);
        return;
      }
      remaining = Math.max(0, remaining - dtMs);
      const t = 1 - remaining / dur;
      const off = shakeOffsetAt(amp, t, seed);
      if (!base) base = camera.targetScreenOffset.clone();
      camera.targetScreenOffset.x = base.x + off.x;
      camera.targetScreenOffset.y = base.y + off.y;
      if (remaining <= 0) camera.targetScreenOffset.set(base.x, base.y);
    },

    dispose() {
      remaining = 0;
      if (base && camera) camera.targetScreenOffset = new Vector2(base.x, base.y);
      base = null;
    },
  };
}
