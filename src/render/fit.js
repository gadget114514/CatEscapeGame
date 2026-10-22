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
 * - `radius = max(hz/sin(vFov/2), hx/sin(hFov/2)) * 1.05` (tilt ignored; the
 *   factor covers it)
 * - `lowerRadiusLimit = radius*0.7`, `upperRadiusLimit = radius*1.6`
 * - `targetZ` shifts the camera target so the board is centered in the area
 *   below the HUD (world +z is screen-up for the default camera, so the
 *   target moves +z and the board renders below screen center).
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
  const radius = Math.max(hz / Math.sin(v / 2), hx / Math.sin(hFov / 2)) * margin;
  const visibleHalfDepth = radius * Math.sin(v / 2); // ≈ hz * margin when vertical fits
  const hudFraction = canvasHeightPx > 0 ? hudHeightPx / canvasHeightPx : 0;
  return {
    radius,
    lowerRadiusLimit: radius * 0.7,
    upperRadiusLimit: radius * 1.6,
    targetZ: visibleHalfDepth * hudFraction,
  };
}
