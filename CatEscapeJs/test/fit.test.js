import { describe, it, expect } from 'vitest';
import { boardExtent, computeCameraFit, computeOrthoBounds } from '../src/render/fit.js';
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
    expect(full.targetZ).toBeGreaterThan(half.targetZ);
    // the shift uses the inflated radius (the same way as the ortho fit)
    expect(half.targetZ).toBeCloseTo(half.radius * Math.sin(V_FOV / 2) * (100 / 800), 10);
  });

  it('HUD inflates the radius so the board bottom still fits (14.4-3)', () => {
    // 800×600 with a two-line HUD: the visible window is 1-hudFrac of the
    // canvas, so the radius inflates by 1/(1-hudFrac) and the shifted
    // board (targetZ + hz below the target) stays inside the view
    for (const [hudPx, canvasPx] of [
      [100, 800],
      [160, 600],
      [220, 600],
    ]) {
      const fit = computeCameraFit({
        aspect: 800 / 600,
        vFov: V_FOV,
        hx: 11.4125,
        hz: 9.5196,
        hudHeightPx: hudPx,
        canvasHeightPx: canvasPx,
      });
      const visibleHalfDepth = fit.radius * Math.sin(V_FOV / 2);
      expect(fit.targetZ + 9.5196).toBeLessThanOrEqual(visibleHalfDepth + 1e-9);
      expect(fit.radius).toBeGreaterThan(fit.targetZ);
    }
    // without a HUD the old plain radius applies
    const plain = computeCameraFit({ aspect: 800 / 600, vFov: V_FOV, hx: 11.4125, hz: 9.5196 });
    const withHud = computeCameraFit({
      aspect: 800 / 600,
      vFov: V_FOV,
      hx: 11.4125,
      hz: 9.5196,
      hudHeightPx: 160,
      canvasHeightPx: 600,
    });
    expect(withHud.radius).toBeCloseTo(plain.radius / (1 - 160 / 600), 8);
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

describe('computeOrthoBounds', () => {
  const e = boardExtent(11, 11, 1, 0.1);
  const ASPECTS = [0.2, 375 / 812, 4 / 3, 1, 16 / 9, 10];

  it('keeps the canvas aspect: (right-left)/(top-bottom) === aspect', () => {
    for (const aspect of ASPECTS) {
      const b = computeOrthoBounds({ aspect, hx: e.hx, hz: e.hz, margin: 1 });
      expect((b.right - b.left) / (b.top - b.bottom)).toBeCloseTo(aspect, 10);
      expect(b.right).toBeCloseTo(-b.left, 10); // horizontally centered
    }
  });

  it('covers the whole board plus margin in every direction', () => {
    for (const aspect of ASPECTS) {
      const b = computeOrthoBounds({ aspect, hx: e.hx, hz: e.hz, margin: 1.05 });
      expect(b.left).toBeLessThanOrEqual(-e.hx);
      expect(b.right).toBeGreaterThanOrEqual(e.hx);
      expect(b.bottom).toBeLessThanOrEqual(-e.hz);
      expect(b.top).toBeGreaterThanOrEqual(e.hz);
    }
  });

  it('hudFrac shifts the window up by halfV*hudFrac (board renders below)', () => {
    for (const hudFrac of [0.1, 0.25, 0.5]) {
      const b = computeOrthoBounds({ aspect: 16 / 9, hx: e.hx, hz: e.hz, hudFrac });
      const halfV = (b.top - b.bottom) / 2;
      const center = (b.top + b.bottom) / 2;
      expect(center).toBeGreaterThan(0); // window moves up …
      expect(center).toBeCloseTo(halfV * hudFrac, 10);
      // … but the board still fits (the half-extent inflates by 1/(1-f))
      expect(b.bottom).toBeLessThanOrEqual(-e.hz);
      expect(b.top).toBeGreaterThanOrEqual(e.hz);
    }
  });

  it('hudFrac = 0 is symmetric around the origin', () => {
    const b = computeOrthoBounds({ aspect: 1, hx: e.hx, hz: e.hz, hudFrac: 0 });
    expect(b.top).toBeCloseTo(-b.bottom, 10);
    expect((b.top + b.bottom) / 2).toBe(0);
  });

  it('a narrower viewport needs a wider window (phone vs wide)', () => {
    const wide = computeOrthoBounds({ aspect: 2, hx: e.hx, hz: e.hz, margin: 1 });
    const phone = computeOrthoBounds({ aspect: 375 / 812, hx: e.hx, hz: e.hz, margin: 1 });
    // portrait is width-limited: halfW is exactly hx (times margin)
    expect((phone.right - phone.left) / 2).toBeCloseTo(e.hx, 10);
    expect((wide.right - wide.left) / 2).toBeGreaterThan(e.hx);
    // landscape is depth-limited: halfV is exactly hz
    expect((wide.top - wide.bottom) / 2).toBeCloseTo(e.hz, 10);
  });

  it('stays finite and positive for extreme inputs', () => {
    for (const aspect of [0.05, 0.2, 1, 10, 100]) {
      for (const hudFrac of [0, 0.3, 0.9]) {
        const b = computeOrthoBounds({ aspect, hx: e.hx, hz: e.hz, hudFrac });
        for (const v of [b.left, b.right, b.top, b.bottom]) {
          expect(Number.isFinite(v)).toBe(true);
        }
        expect(b.right - b.left).toBeGreaterThan(0);
        expect(b.top - b.bottom).toBeGreaterThan(0);
      }
    }
    // hudFrac clamps instead of inverting the window
    const b = computeOrthoBounds({ aspect: 1, hx: e.hx, hz: e.hz, hudFrac: 5 });
    expect(b.top).toBeGreaterThan(b.bottom);
    expect(Number.isFinite(b.top)).toBe(true);
  });

  it('uses the margin factor', () => {
    const plain = computeOrthoBounds({ aspect: 1.5, hx: 10, hz: 8, margin: 1 });
    const padded = computeOrthoBounds({ aspect: 1.5, hx: 10, hz: 8, margin: 1.2 });
    expect(padded.right - padded.left).toBeCloseTo((plain.right - plain.left) * 1.2, 10);
    expect(padded.top - padded.bottom).toBeCloseTo((plain.top - plain.bottom) * 1.2, 10);
  });
});
