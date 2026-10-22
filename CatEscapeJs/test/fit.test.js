import { describe, it, expect } from 'vitest';
import { boardExtent, computeCameraFit } from '../src/render/fit.js';
import { cellCenter } from '../src/game/hex.js';

const V_FOV = 0.8; // ArcRotateCamera default

describe('boardExtent', () => {
  it('is the cellCenter span plus one cell of margin', () => {
    const W = 11;
    const H = 11;
    const size = 1;
    const gap = 0.1;
    const cellW = size * Math.sqrt(3) + gap;
    const rowD = size * 1.5 + gap * 0.866;
    const e = boardExtent(W, H, size, gap);
    // odd-r rows shift half a cell right: x spans 0 … (W-0.5)*cellW
    expect(e.hx).toBeCloseTo(((W - 0.5) * cellW) / 2 + cellW, 10);
    // z spans -(H-1)*rowD … 0
    expect(e.hz).toBeCloseTo(((H - 1) * rowD) / 2 + rowD, 10);
  });

  it('covers every cell center (margin is on top of the span)', () => {
    const size = 1;
    const gap = 0.1;
    const e = boardExtent(11, 11, size, gap);
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (let r = 0; r < 11; r++) {
      for (let c = 0; c < 11; c++) {
        const p = cellCenter(r, c, size, gap);
        minX = Math.min(minX, p.x);
        maxX = Math.max(maxX, p.x);
        minZ = Math.min(minZ, p.z);
        maxZ = Math.max(maxZ, p.z);
      }
    }
    expect(e.hx).toBeGreaterThan((maxX - minX) / 2);
    expect(e.hz).toBeGreaterThan((maxZ - minZ) / 2);
    // board is wider than deep (odd-r shift) but deeper cells dominate z pitch
    expect(e.hx).toBeGreaterThan(0);
    expect(e.hz).toBeGreaterThan(0);
  });

  it('grows with the board', () => {
    const small = boardExtent(7, 7, 1, 0.1);
    const big = boardExtent(11, 11, 1, 0.1);
    expect(big.hx).toBeGreaterThan(small.hx);
    expect(big.hz).toBeGreaterThan(small.hz);
  });
});

describe('computeCameraFit', () => {
  it('square aspect: horizontal fov equals the vertical one', () => {
    const fit = computeCameraFit({ aspect: 1, vFov: V_FOV, hx: 10, hz: 10 });
    const expected = (10 / Math.sin(V_FOV / 2)) * 1.05;
    expect(fit.radius).toBeCloseTo(expected, 10);
  });

  it('radius = max(hz/sin(vFov/2), hx/sin(hFov/2)) * 1.05', () => {
    const aspect = 1.6;
    const hx = 12;
    const hz = 8;
    const hFov = 2 * Math.atan(Math.tan(V_FOV / 2) * aspect);
    const expected = Math.max(hz / Math.sin(V_FOV / 2), hx / Math.sin(hFov / 2)) * 1.05;
    const fit = computeCameraFit({ aspect, vFov: V_FOV, hx, hz });
    expect(fit.radius).toBeCloseTo(expected, 10);
  });

  it('a narrower viewport needs a larger radius (phone vs wide)', () => {
    const hx = 11.4125;
    const hz = 9.5196;
    const wide = computeCameraFit({ aspect: 2, vFov: V_FOV, hx, hz });
    const phone = computeCameraFit({ aspect: 375 / 812, vFov: V_FOV, hx, hz });
    expect(phone.radius).toBeGreaterThan(wide.radius);
    // landscape fits by depth, portrait by width
    expect(wide.radius).toBeCloseTo((hz / Math.sin(V_FOV / 2)) * 1.05, 6);
    const hFovPhone = 2 * Math.atan(Math.tan(V_FOV / 2) * (375 / 812));
    expect(phone.radius).toBeCloseTo((hx / Math.sin(hFovPhone / 2)) * 1.05, 6);
  });

  it('radius limits scale with the fitted radius', () => {
    const fit = computeCameraFit({ aspect: 1.5, vFov: V_FOV, hx: 11, hz: 9 });
    expect(fit.lowerRadiusLimit).toBeCloseTo(fit.radius * 0.7, 10);
    expect(fit.upperRadiusLimit).toBeCloseTo(fit.radius * 1.6, 10);
    expect(fit.lowerRadiusLimit).toBeLessThan(fit.radius);
    expect(fit.upperRadiusLimit).toBeGreaterThan(fit.radius);
  });

  it('HUD shift: zero without HUD, positive and linear with its height', () => {
    const noHud = computeCameraFit({
      aspect: 1,
      vFov: V_FOV,
      hx: 10,
      hz: 10,
      hudHeightPx: 0,
      canvasHeightPx: 800,
    });
    expect(noHud.targetZ).toBe(0);

    const half = computeCameraFit({
      aspect: 1,
      vFov: V_FOV,
      hx: 10,
      hz: 10,
      hudHeightPx: 100,
      canvasHeightPx: 800,
    });
    const full = computeCameraFit({
      aspect: 1,
      vFov: V_FOV,
      hx: 10,
      hz: 10,
      hudHeightPx: 200,
      canvasHeightPx: 800,
    });
    expect(half.targetZ).toBeGreaterThan(0);
    expect(half.targetZ).toBeCloseTo(full.targetZ / 2, 10);
    expect(half.targetZ).toBeCloseTo(half.radius * Math.sin(V_FOV / 2) * (100 / 800), 10);
  });

  it('stays finite and positive for extreme aspects', () => {
    for (const aspect of [0.2, 375 / 812, 1, 4 / 3, 16 / 9, 10]) {
      const fit = computeCameraFit({ aspect, vFov: V_FOV, hx: 11, hz: 9 });
      expect(Number.isFinite(fit.radius)).toBe(true);
      expect(fit.radius).toBeGreaterThan(0);
      expect(fit.targetZ).toBeGreaterThanOrEqual(0);
      expect(fit.lowerRadiusLimit).toBeGreaterThan(0);
    }
  });

  it('uses the margin factor on the winning term', () => {
    const plain = computeCameraFit({ aspect: 1, vFov: V_FOV, hx: 10, hz: 6, margin: 1 });
    const padded = computeCameraFit({ aspect: 1, vFov: V_FOV, hx: 10, hz: 6, margin: 1.1 });
    expect(padded.radius).toBeCloseTo(plain.radius * 1.1, 10);
  });
});
