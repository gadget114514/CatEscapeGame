/**
 * Pure camera auto-fit math (section 7.1 Rev. 3).
 * No Babylon imports — unit-testable on Node.
 */
import { cellCenter } from '../game/hex.js';

/**
 * Half-width `hx` and half-depth `hz` of the board footprint on the world
 * plane, measured from `cellCenter` plus one cell of margin.
 * @param {number} W board width
 * @param {number} H board height
 * @param {number} size hex radius
 * @param {number} gap gap between cells
 * @returns {{hx:number, hz:number}}
 */
export function boardExtent(W, H, size, gap) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (let r = 0; r < H; r++) {
    for (let c = 0; c < W; c++) {
      const p = cellCenter(r, c, size, gap);
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.z < minZ) minZ = p.z;
      if (p.z > maxZ) maxZ = p.z;
    }
  }
  const cellW = size * Math.sqrt(3) + gap; // one cell of horizontal margin
  const rowD = size * 1.5 + gap * 0.866; // one row of vertical margin
  return { hx: (maxX - minX) / 2 + cellW, hz: (maxZ - minZ) / 2 + rowD };
}

/**
 * Radius, radius limits and HUD shift so the whole board fits the viewport.
 *
 * - `hFov = 2*atan(tan(vFov/2)*aspect)`
 * - `radiusBase = max(hz/sin(vFov/2), hx/sin(hFov/2)) * 1.05` (tilt
 *   ignored; the factor covers it)
 * - **HUD (bug 14.4-3, the same way as the ortho fit)**: the visible
 *   window shrinks to `1-hudFrac` of the canvas, so the radius inflates
 *   by `1/(1-hudFrac)` and the target shifts by the HUD fraction of the
 *   (inflated) visible half depth — the bottom row stays visible even
 *   when the HUD wraps onto two lines (800×600).
 * - `lowerRadiusLimit = radius*0.7`, `upperRadiusLimit = radius*1.6`
 * - `targetZ` shifts the camera target so the board is centered in the
 *   area below the HUD (world +z is screen-up for the default camera, so
 *   the target moves +z and the board renders below screen center).
 *
 * @param {{aspect:number, vFov:number, hx:number, hz:number,
 *          hudHeightPx?:number, canvasHeightPx?:number, margin?:number}} opts
 * @returns {{radius:number, lowerRadiusLimit:number,
 *            upperRadiusLimit:number, targetZ:number}}
 */
export function computeCameraFit({
  aspect,
  vFov,
  hx,
  hz,
  hudHeightPx = 0,
  canvasHeightPx = 1,
  margin = 1.05,
}) {
  const v = Math.max(0.01, vFov);
  const a = Math.max(0.01, aspect);
  const hFov = 2 * Math.atan(Math.tan(v / 2) * a);
  const radiusBase = Math.max(hz / Math.sin(v / 2), hx / Math.sin(hFov / 2)) * margin;
  const hudFraction = canvasHeightPx > 0 ? Math.min(Math.max(hudHeightPx / canvasHeightPx, 0), 0.9) : 0;
  const radius = radiusBase / (1 - hudFraction); // inflate like the ortho fit
  const visibleHalfDepth = radius * Math.sin(v / 2); // ≈ hz * margin when no HUD
  return {
    radius,
    lowerRadiusLimit: radius * 0.7,
    upperRadiusLimit: radius * 1.6,
    targetZ: visibleHalfDepth * hudFraction,
  };
}

/**
 * Orthographic bounds for `setCameraMode('ortho')` (section 12.7).
 *
 * The view must cover the whole board plus one cell of margin (`hx`/`hz`
 * from `boardExtent` already include that margin, `margin` adds a safety
 * factor like the perspective fit) while keeping the canvas aspect, and the
 * visible window is shifted up by the HUD fraction so the board renders
 * centered in the area below the top bar ("shifted down by the HUD
 * fraction"): the board center ends up `hudFrac/2` of the screen height
 * below the screen center.
 *
 * The vertical half-extent `H` is inflated by `1/(1-hudFrac)` so the shift
 * never pushes the bottom of the board out of view.
 *
 * - `H = max(hz, hx/aspect) * margin / (1-hudFrac)`
 * - `halfW = H * aspect`, window center `= H * hudFrac` (up the screen)
 *
 * @param {{aspect:number, hx:number, hz:number, hudFrac?:number,
 *          margin?:number}} opts
 * @returns {{left:number, right:number, top:number, bottom:number}}
 */
export function computeOrthoBounds({ aspect, hx, hz, hudFrac = 0, margin = 1.05 }) {
  const a = Math.max(0.01, aspect);
  const f = Math.min(Math.max(hudFrac, 0), 0.9); // never invert the window
  const halfV = (Math.max(hz, hx / a) * margin) / (1 - f);
  const halfH = halfV * a;
  const shift = halfV * f; // window center moves up, board renders below
  return {
    left: -halfH,
    right: halfH,
    top: halfV + shift,
    bottom: -halfV + shift,
  };
}
