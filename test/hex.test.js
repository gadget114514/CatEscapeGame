import { describe, it, expect } from 'vitest';
import {
  toIndex,
  toRC,
  inBounds,
  buildNeighborTable,
  isBorder,
  cellCenter,
} from '../src/game/hex.js';
import { mulberry32, pick, shuffle } from '../src/game/rng.js';

const W = 11;
const H = 11;

describe('hex coordinates', () => {
  it('toIndex / toRC round-trip', () => {
    expect(toIndex(5, 5, W)).toBe(60);
    expect(toRC(60, W)).toEqual({ r: 5, c: 5 });
    for (let i = 0; i < W * H; i++) {
      const { r, c } = toRC(i, W);
      expect(toIndex(r, c, W)).toBe(i);
    }
  });

  it('inBounds', () => {
    expect(inBounds(0, 0, W, H)).toBe(true);
    expect(inBounds(10, 10, W, H)).toBe(true);
    expect(inBounds(-1, 0, W, H)).toBe(false);
    expect(inBounds(0, 11, W, H)).toBe(false);
    expect(inBounds(11, 0, W, H)).toBe(false);
    expect(inBounds(5, -1, W, H)).toBe(false);
  });
});

describe('buildNeighborTable', () => {
  const nbr = buildNeighborTable(W, H);

  it('has one entry per cell', () => {
    expect(nbr.length).toBe(W * H);
    for (const list of nbr) {
      expect(list).toBeInstanceOf(Int16Array);
    }
  });

  it('neighbors of (0,0): corners lose out-of-board cells', () => {
    expect(Array.from(nbr[toIndex(0, 0, W)])).toEqual([1, 11]);
  });

  it('neighbors of (5,5): odd row', () => {
    expect(Array.from(nbr[toIndex(5, 5, W)])).toEqual([59, 61, 49, 50, 71, 72]);
  });

  it('neighbors of (6,5): even row', () => {
    expect(Array.from(nbr[toIndex(6, 5, W)])).toEqual([70, 72, 59, 60, 81, 82]);
  });

  it('neighbors of (10,10): opposite corner', () => {
    expect(Array.from(nbr[toIndex(10, 10, W)])).toEqual([119, 108, 109]);
  });

  it('an interior cell has 6 neighbors and the relation is symmetric', () => {
    const i = toIndex(5, 5, W);
    expect(nbr[i].length).toBe(6);
    for (const j of nbr[i]) {
      expect(Array.from(nbr[j])).toContain(i);
    }
  });

  it('every neighbor is in bounds and never the cell itself', () => {
    for (let i = 0; i < W * H; i++) {
      const { r, c } = toRC(i, W);
      for (const j of nbr[i]) {
        expect(j).not.toBe(i);
        const p = toRC(j, W);
        expect(inBounds(p.r, p.c, W, H)).toBe(true);
        expect(Math.abs(p.r - r) + Math.abs(p.c - c)).toBeLessThanOrEqual(2);
      }
    }
  });
});

describe('isBorder', () => {
  it('detects edge cells', () => {
    expect(isBorder(toIndex(0, 0, W), W, H)).toBe(true);
    expect(isBorder(toIndex(0, 5, W), W, H)).toBe(true);
    expect(isBorder(toIndex(10, 3, W), W, H)).toBe(true);
    expect(isBorder(toIndex(4, 0, W), W, H)).toBe(true);
    expect(isBorder(toIndex(7, 10, W), W, H)).toBe(true);
    expect(isBorder(toIndex(5, 5, W), W, H)).toBe(false);
    expect(isBorder(toIndex(1, 1, W), W, H)).toBe(false);
    expect(isBorder(toIndex(9, 9, W), W, H)).toBe(false);
  });
});

describe('cellCenter', () => {
  const size = 1;
  const gap = 0.1;
  const sx = size * Math.sqrt(3) + gap;
  const sz = size * 1.5 + gap * 0.866;

  it('matches the spec formula without offsets', () => {
    expect(cellCenter(0, 0, size, gap)).toEqual({ x: 0, z: 0 });
    const p = cellCenter(1, 2, size, gap);
    expect(p.x).toBeCloseTo(sx * (2 + 0.5), 10);
    expect(p.z).toBeCloseTo(-sz, 10);
  });

  it('offsets center the board on the origin', () => {
    const offsetX = sx * (W - 0.5) / 2;
    const offsetZ = (sz * (H - 1)) / 2;
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (let r = 0; r < H; r++) {
      for (let c = 0; c < W; c++) {
        const p = cellCenter(r, c, size, gap, offsetX, offsetZ);
        minX = Math.min(minX, p.x);
        maxX = Math.max(maxX, p.x);
        minZ = Math.min(minZ, p.z);
        maxZ = Math.max(maxZ, p.z);
      }
    }
    expect(minX + maxX).toBeCloseTo(0, 10);
    expect(minZ + maxZ).toBeCloseTo(0, 10);
  });
});

describe('rng', () => {
  it('same seed gives the same sequence', () => {
    const a = mulberry32(12345);
    const b = mulberry32(12345);
    const seqA = Array.from({ length: 20 }, () => a());
    const seqB = Array.from({ length: 20 }, () => b());
    expect(seqA).toEqual(seqB);
  });

  it('different seeds give different sequences', () => {
    const a = mulberry32(1);
    const b = mulberry32(2);
    const seqA = Array.from({ length: 10 }, () => a());
    const seqB = Array.from({ length: 10 }, () => b());
    expect(seqA).not.toEqual(seqB);
  });

  it('values stay in [0, 1)', () => {
    const rng = mulberry32(999);
    for (let i = 0; i < 1000; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('pick is reproducible for a seed', () => {
    const arr = ['a', 'b', 'c', 'd'];
    const picks1 = [];
    const r1 = mulberry32(7);
    for (let i = 0; i < 5; i++) picks1.push(pick(r1, arr));
    const picks2 = [];
    const r2 = mulberry32(7);
    for (let i = 0; i < 5; i++) picks2.push(pick(r2, arr));
    expect(picks1).toEqual(picks2);
    expect(pick(mulberry32(1), [])).toBeUndefined();
  });

  it('shuffle keeps the elements and is reproducible', () => {
    const src = [1, 2, 3, 4, 5, 6, 7, 8];
    const a = shuffle(mulberry32(42), src.slice());
    const b = shuffle(mulberry32(42), src.slice());
    expect(a).toEqual(b);
    expect(a.slice().sort((x, y) => x - y)).toEqual(src);
  });
});
