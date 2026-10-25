/**
 * Calibration math for the 16.4 sweep reader: isotonic smoothing in both
 * hardness directions, the center pick, the ±2..±5 non-overlapping ranges
 * and the levels.js rewrite (blocks + range). Pure Node — no DOM.
 */
import { describe, it, expect } from 'vitest';
import {
  isotonicBlocks,
  pickCenter,
  buildRanges,
  rewriteLevels,
  orderCenters,
  nonMonotoneRises,
  increasingFor,
  targetRate,
  LEVEL_COUNT,
} from '../scripts/calibrateLib.mjs';
import { hardnessDirection } from '../src/game/play/blocks.js';

describe('isotonicBlocks (16.4 smoothing)', () => {
  it('escape (+1): smooths to a non-increasing curve in block count', () => {
    // a noisy falling curve: the jump up at b=4 must be flattened away
    const smoothed = isotonicBlocks([0.9, 0.85, 0.95, 0.6, 0.5], hardnessDirection('escape'));
    for (let i = 1; i < smoothed.length; i++) {
      expect(smoothed[i]).toBeLessThanOrEqual(smoothed[i - 1]);
    }
    // pooled means keep the data honest: first three average to 0.9
    expect(smoothed[0]).toBeCloseTo((0.9 + 0.85 + 0.95) / 3, 10);
    expect(smoothed[3]).toBeCloseTo(0.6, 10);
    expect(smoothed[4]).toBeCloseTo(0.5, 10);
  });

  it('trapper (-1): smooths to a non-decreasing curve in block count', () => {
    const smoothed = isotonicBlocks([0.2, 0.5, 0.35, 0.7], hardnessDirection('trapper'));
    for (let i = 1; i < smoothed.length; i++) {
      expect(smoothed[i]).toBeGreaterThanOrEqual(smoothed[i - 1]);
    }
    // 0.5 → 0.35 is a dip: the two pool into 0.425
    expect(smoothed[1]).toBeCloseTo(0.425, 10);
    expect(smoothed[2]).toBeCloseTo(0.425, 10);
    expect(smoothed[0]).toBeCloseTo(0.2, 10);
    expect(smoothed[3]).toBeCloseTo(0.7, 10);
  });

  it('leaves already-monotone data untouched and handles tiny inputs', () => {
    const flat = [0.5, 0.5, 0.5];
    expect(isotonicBlocks(flat, 1)).toEqual(flat);
    expect(isotonicBlocks(flat, -1)).toEqual(flat);
    expect(isotonicBlocks([], 1)).toEqual([]);
    expect(isotonicBlocks([0.7], -1)).toEqual([0.7]);
  });

  it('pickCenter finds the count closest to the target', () => {
    const blocks = [0, 2, 4, 6];
    const rates = [0.95, 0.75, 0.55, 0.25];
    expect(pickCenter(blocks, rates, targetRate('normal', 1)).blocks).toBe(2); // 0.80 → 0.75
    expect(pickCenter(blocks, rates, targetRate('hard', 20)).blocks).toBe(6); // 0.10 → 0.25
    expect(pickCenter([], [], 0.5)).toBeNull();
  });
});

describe('buildRanges (16.2): order per course, no overlap, ±2..±5', () => {
  const check = (ranges, course, centers) => {
    const dir = hardnessDirection(course);
    const order = dir > 0 ? ['easy', 'normal', 'hard'] : ['hard', 'normal', 'easy'];
    for (const d of ['easy', 'normal', 'hard']) {
      const [lo, hi] = ranges[d];
      expect(lo).toBeLessThanOrEqual(hi);
      // every range brackets its center
      expect(lo).toBeLessThanOrEqual(centers[d]);
      expect(hi).toBeGreaterThanOrEqual(centers[d]);
    }
    for (let i = 0; i < order.length - 1; i++) {
      const [loNext] = ranges[order[i + 1]];
      const [, hi] = ranges[order[i]];
      // never overlap, and follow the table order in block counts
      expect(hi).toBeLessThanOrEqual(loNext);
    }
  };

  it('escape: easy < normal < hard, half-width 2..5, no overlap', () => {
    const centers = { easy: 5, normal: 10, hard: 16 };
    const ranges = buildRanges(centers, 'escape');
    check(ranges, 'escape', centers);
    // gap 5 → desired half 3, but the pair may only meet at the midpoint
    expect(ranges.easy).toEqual([3, 7]);
    expect(ranges.normal).toEqual([7, 13]);
    expect(ranges.hard).toEqual([13, 19]);
    for (const d of ['easy', 'normal', 'hard']) {
      const half = (ranges[d][1] - ranges[d][0]) / 2;
      expect(half).toBeGreaterThanOrEqual(2);
      expect(half).toBeLessThanOrEqual(5);
    }
  });

  it('trapper: hard < normal < easy in block counts', () => {
    const centers = { easy: 16, normal: 10, hard: 5 };
    const ranges = buildRanges(centers, 'trapper');
    check(ranges, 'trapper', centers);
    expect(ranges.hard[1]).toBeLessThanOrEqual(ranges.normal[0]);
    expect(ranges.normal[1]).toBeLessThanOrEqual(ranges.easy[0]);
  });

  it('wide gaps clamp the half-width at ±5', () => {
    const centers = { easy: 0, normal: 30, hard: 60 };
    const ranges = buildRanges(centers, 'escape');
    expect(ranges.easy).toEqual([0, 5]);
    expect(ranges.normal).toEqual([25, 35]);
    expect(ranges.hard).toEqual([55, 60]); // clamped to BLOCKS_MAX
  });

  it('tiny gaps shrink instead of overlapping', () => {
    const centers = { easy: 6, normal: 7, hard: 12 };
    const ranges = buildRanges(centers, 'escape');
    check(ranges, 'escape', centers);
    expect(ranges.easy[1]).toBeLessThanOrEqual(ranges.normal[0]);
    // equal centers collapse to a point, never to a double-counted range
    const tied = buildRanges({ easy: 8, normal: 8, hard: 12 }, 'escape');
    check(tied, 'escape', { easy: 8, normal: 8, hard: 12 });
  });
});

describe('rewriteLevels (14.6 + 16.2 ranges + 18.1 per rules kind)', () => {
  const src = [
    '/** Escape course. */',
    'export const ESCAPE_LEVELS = [',
    "  { id: 1, course: 'escape', ai: 'easy', blocks: B(5), aiItems: 0 },",
    "  { id: 2, course: 'escape', ai: 'easy', blocks: { easy: 5, normal: 5, hard: 5 }, aiItems: 0 },",
    '];',
    'export const TRAPPER_LEVELS = [',
    "  { id: 1, course: 'trapper', ai: 'easy', blocks: B(15), aiItems: 0 },",
    '];',
  ].join('\n');
  const by = {
    escape: { easy: [1, 2], normal: [3, 4], hard: [5, 6] },
    trapper: { easy: [9], normal: [8], hard: [7] },
  };
  const ranges = {
    escape: [
      { easy: [0, 2], normal: [2, 4], hard: [4, 7] },
      { easy: [1, 3], normal: [3, 5], hard: [5, 8] },
    ],
    trapper: [{ easy: [8, 11], normal: [6, 10], hard: [5, 9] }],
  };

  it('writes the calibrated kind, keeping the other kind at its old centers (18.1)', () => {
    const out = rewriteLevels(src, by, '2026-10-24', ranges); // defaults to gimmick
    expect(out).toContain(
      'blocks: { basic: { easy: 5, normal: 5, hard: 5 }, gimmick: { easy: 1, normal: 3, hard: 5 } }, ' +
        'range: { gimmick: { easy: [0, 2], normal: [2, 4], hard: [4, 7] } }',
    );
    // the shared {easy,normal,hard} form counts for both kinds
    expect(out).toContain(
      'blocks: { basic: { easy: 5, normal: 5, hard: 5 }, gimmick: { easy: 2, normal: 4, hard: 6 } }, ' +
        'range: { gimmick: { easy: [1, 3], normal: [3, 5], hard: [5, 8] } }',
    );
    expect(out).toContain(
      'blocks: { basic: { easy: 15, normal: 15, hard: 15 }, gimmick: { easy: 9, normal: 8, hard: 7 } }, ' +
        'range: { gimmick: { easy: [8, 11], normal: [6, 10], hard: [5, 9] } }',
    );
  });

  it('--rules basic writes only the basic entries and keeps gimmick', () => {
    const once = rewriteLevels(src, by, '2026-10-24', ranges); // gimmick first
    const twice = rewriteLevels(once, by, '2026-10-25', ranges, 'basic');
    const line = twice.split('\n').find((l) => l.includes("id: 1,") && l.includes("'escape'"));
    expect(line).toContain('basic: { easy: 1, normal: 3, hard: 5 }');
    expect(line).toContain('gimmick: { easy: 1, normal: 3, hard: 5 }'); // kept
    expect(line).toContain('range: { basic: { easy: [0, 2], normal: [2, 4], hard: [4, 7] }, ' +
      'gimmick: { easy: [0, 2], normal: [2, 4], hard: [4, 7] } }');
    // and a third gimmick pass still keeps the basic numbers
    const thrice = rewriteLevels(twice, by, '2026-10-26', ranges, 'gimmick');
    expect(thrice).toContain('basic: { easy: 1, normal: 3, hard: 5 }');
    expect((thrice.match(/\/\/ calibrated 2026-10-26/g) || []).length).toBe(2);
    expect(thrice).not.toContain('// calibrated 2026-10-25');
    expect(thrice).not.toContain('// calibrated 2026-10-24');
  });

  it('replaces a stale range instead of stacking a second one', () => {
    const dirty = (out) =>
      out.replace(
        /range: \{(?:[^{}]|\{[^{}]*\})*\}/,
        'range: { gimmick: { easy: [99, 99], normal: [99, 99], hard: [99, 99] } }',
      );
    const once = rewriteLevels(src, by, '2026-10-24', ranges);
    const twice = rewriteLevels(dirty(once), by, '2026-10-25', ranges);
    expect(twice).not.toContain('[99, 99]');
    expect((twice.match(/range: \{/g) || []).length).toBe(3);
    expect(twice).toContain('// calibrated 2026-10-25');
  });

  it('without ranges it only rewrites the blocks (14.6 behavior)', () => {
    const out = rewriteLevels(src, by, '2026-10-24');
    expect(out).toContain('blocks: { basic: { easy: 5, normal: 5, hard: 5 }, gimmick: { easy: 1, normal: 3, hard: 5 } }');
    expect(out).not.toContain('range:');
  });
});

describe('orderCenters / nonMonotoneRises (18.6: rate monotone, not block count)', () => {
  it('the direction helper agrees with the two course tables', () => {
    expect(increasingFor('escape')).toBe(false);
    expect(increasingFor('trapper')).toBe(true);
  });

  it('orders the centers inside one level (16.2 direction), across levels not at all', () => {
    // 18.6: the AI step at L2/L4 may need FEWER blocks — those drops stay
    const by = {
      escape: { easy: [5, 3, 4, 2], normal: [5, 6, 4, 2], hard: [5, 7, 9, 2] },
      trapper: { easy: [3, 5, 4, 6], normal: [3, 2, 4, 6], hard: [3, 1, 0, 6] },
    };
    orderCenters(by);
    // across levels: untouched (L2 kept its drop)
    expect(by.escape.easy).toEqual([5, 3, 4, 2]);
    expect(by.trapper.easy).toEqual([3, 5, 4, 6]);
    // inside each level: easy ≤ normal ≤ hard (escape), easy ≥ normal ≥ hard (trapper)
    for (let i = 0; i < 4; i++) {
      expect(by.escape.easy[i]).toBeLessThanOrEqual(by.escape.normal[i]);
      expect(by.escape.normal[i]).toBeLessThanOrEqual(by.escape.hard[i]);
      expect(by.trapper.easy[i]).toBeGreaterThanOrEqual(by.trapper.normal[i]);
      expect(by.trapper.normal[i]).toBeGreaterThanOrEqual(by.trapper.hard[i]);
    }
  });

  it('a synthetic sweep where the best block count drops at L7 keeps the drop', () => {
    // synthetic sweep of the escape course: the win rate falls with the
    // block count, but at L7 the trapper AI gets stronger — the whole
    // curve shifts DOWN 8 points, so the best block count for every
    // difficulty has to DROP there to stay on the target curve (18.6)
    const sweep = new Array(LEVEL_COUNT).fill(0).map((_, i) => {
      const level = i + 1;
      const aiBoost = level >= 7 ? 0.08 : 0;
      /** @type {Array<{blocks:number, wins:number, games:number}>} */
      const rows = [];
      for (let b = 0; b <= 60; b++) {
        const rate = Math.max(0, 1 - b / 40 - aiBoost);
        rows.push({ blocks: b, wins: Math.round(rate * 100), games: 100 });
      }
      return rows;
    });

    // run the same per-level pipeline as calibrate.mjs (16.4)
    const by = { escape: { easy: [], normal: [], hard: [] } };
    for (let level = 1; level <= LEVEL_COUNT; level++) {
      const rows = sweep[level - 1];
      const blocksAsc = rows.map((r) => r.blocks);
      const rawRates = rows.map((r) => r.wins / r.games);
      const smoothed = isotonicBlocks(rawRates, hardnessDirection('escape'));
      for (const d of ['easy', 'normal', 'hard']) {
        by.escape[d].push(pickCenter(blocksAsc, smoothed, targetRate(d, level)).blocks);
      }
    }
    const picked = JSON.parse(JSON.stringify(by.escape));
    orderCenters(by);
    // the L7 drop is real (target rate barely moves, curve shifted down)
    expect(picked.easy[6]).toBeLessThan(picked.easy[5]);
    expect(picked.normal[6]).toBeLessThan(picked.normal[5]);
    expect(picked.hard[6]).toBeLessThan(picked.hard[5]);
    // 18.6: the old monotoneize used to clamp those drops away — kept now
    expect(by.escape.easy[6]).toBe(picked.easy[6]);
    expect(by.escape.normal[6]).toBe(picked.normal[6]);
    expect(by.escape.hard[6]).toBe(picked.hard[6]);
    // and the within-level order still holds at every level
    for (let i = 0; i < LEVEL_COUNT; i++) {
      expect(by.escape.easy[i]).toBeLessThanOrEqual(by.escape.normal[i]);
      expect(by.escape.normal[i]).toBeLessThanOrEqual(by.escape.hard[i]);
    }
    // the achieved rate falls L6→L7 (the point of 18.6): no NON-MONOTONE
    const achievedL6 = sweep[5].find((r) => r.blocks === by.escape.normal[5]).wins / 100;
    const achievedL7 = sweep[6].find((r) => r.blocks === by.escape.normal[6]).wins / 100;
    expect(achievedL7).toBeLessThan(achievedL6);
    expect(nonMonotoneRises([achievedL6, achievedL7])).toEqual([]);
  });

  it('nonMonotoneRises reports a step up of more than 3 points, skips missing data', () => {
    // falling curve → nothing to report
    expect(nonMonotoneRises([0.75, 0.5, 0.25])).toEqual([]);
    // a 1.5-point rise is within the 3-point tolerance
    expect(nonMonotoneRises([0.5, 0.515625, 0.25])).toEqual([]);
    // a 3.125-point jump (more than 3) at L2 is reported with its numbers
    expect(nonMonotoneRises([0.5, 0.53125, 0.25])).toEqual([
      { level: 2, rate: 0.53125, prevLevel: 1, prev: 0.5, rise: 0.03125 },
    ]);
    // levels without data (NaN) are skipped; the rise is measured against
    // the previous level that has data
    expect(nonMonotoneRises([0.75, NaN, NaN, 0.875])).toEqual([
      { level: 4, rate: 0.875, prevLevel: 1, prev: 0.75, rise: 0.125 },
    ]);
    expect(nonMonotoneRises([])).toEqual([]);
    expect(nonMonotoneRises([NaN, NaN])).toEqual([]);
  });
});
