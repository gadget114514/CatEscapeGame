/**
 * Block-count difficulty helpers (spec 16.2/16.3): the single "harder"
 * direction, the calibrated ranges and the right-is-harder slider
 * mapping. Pure Node — no DOM.
 */
import { describe, it, expect } from 'vitest';
import {
  hardnessDirection,
  levelRange,
  streakRange,
  sliderBlocks,
  sliderPosition,
  clampBlocks,
  blockSettingKey,
  BLOCKS_MIN,
  BLOCKS_MAX,
  DEFAULT_HALF,
} from '../src/game/play/blocks.js';
import { getLevel, blocksFor } from '../src/game/play/levels.js';
import { INITIAL_BLOCKS } from '../src/game/rules.js';

describe('hardnessDirection (16.2)', () => {
  it('+1 for escape (more blocks = harder), -1 for trapper', () => {
    expect(hardnessDirection('escape')).toBe(1);
    expect(hardnessDirection('trapper')).toBe(-1);
    // unknown courses read as the escape convention, never as a coin flip
    expect(hardnessDirection('')).toBe(1);
  });
});

describe('levelRange / streakRange (16.2 / 16.3)', () => {
  it('falls back to the center ±2 while the level is uncalibrated', () => {
    // a pre-calibration level: a flat block table and no range entries
    const lv = { blocks: { easy: 5, normal: 5, hard: 5 } };
    expect(levelRange(lv, 'normal')).toEqual({ center: 5, min: 5 - DEFAULT_HALF, max: 5 + DEFAULT_HALF });
    expect(levelRange(lv, 'hard', 'escape')).toEqual({ center: 5, min: 3, max: 7 });
  });

  it('uses the calibrated range when the level carries one', () => {
    const lv = {
      blocks: { basic: { easy: 5, normal: 5, hard: 5 }, gimmick: { easy: 5, normal: 5, hard: 5 } },
      range: { normal: [4, 9], easy: [0, 3] },
    };
    expect(levelRange(lv, 'normal', 'escape')).toEqual({ center: 5, min: 4, max: 9 });
    // a range that misses the center gets stretched to contain it
    expect(levelRange(lv, 'easy', 'escape')).toEqual({ center: 5, min: 0, max: 5 });
    // a difficulty without a range keeps the ±2 fallback
    expect(levelRange(lv, 'hard', 'escape')).toEqual({ center: 5, min: 3, max: 7 });
  });

  it('streak play centers on INITIAL_BLOCKS with the ±2 half-width', () => {
    expect(streakRange('trapper', 'normal')).toEqual({
      center: INITIAL_BLOCKS.trapper.normal,
      min: INITIAL_BLOCKS.trapper.normal - 2,
      max: INITIAL_BLOCKS.trapper.normal + 2,
    });
    expect(streakRange('escape', 'hard').center).toBe(INITIAL_BLOCKS.escape.hard);
  });
});

describe('per-rules block tables (18.1)', () => {
  it('blocksFor reads the level entry of the requested rules kind', () => {
    for (const course of ['escape', 'trapper']) {
      for (let level = 1; level <= 20; level++) {
        const lv = getLevel(course, level);
        // 18.1: calibration writes each kind's own centers, so the two
        // kinds may differ — blocksFor must read exactly the asked-for one
        for (const d of ['easy', 'normal', 'hard']) {
          expect(blocksFor(lv, d, 'basic'), `${course} L${level} ${d}`).toBe(lv.blocks.basic[d]);
          expect(blocksFor(lv, d, 'gimmick'), `${course} L${level} ${d}`).toBe(lv.blocks.gimmick[d]);
        }
      }
    }
  });

  it('blocksFor falls back to the pre-18.1 shared shape', () => {
    expect(blocksFor({ blocks: { easy: 1, normal: 2, hard: 3 } }, 'hard', 'basic')).toBe(3);
    expect(blocksFor({ blocks: 7 }, 'normal', 'gimmick')).toBe(7);
    expect(blocksFor({ blocks: { gimmick: { easy: 1, normal: 2, hard: 3 } } }, 'hard', 'basic')).toBe(3);
  });

  it('levelRange reads the calibrated range of the requested rules kind', () => {
    const lv = {
      ...getLevel('escape', 1),
      blocks: {
        basic: { easy: 5, normal: 5, hard: 5 },
        gimmick: { easy: 10, normal: 12, hard: 14 },
      },
      range: {
        basic: { easy: [4, 6], normal: [4, 6], hard: [4, 6] },
        gimmick: { easy: [9, 11], normal: [11, 13], hard: [13, 15] },
      },
    };
    expect(levelRange(lv, 'normal', 'escape', 'basic')).toEqual({ center: 5, min: 4, max: 6 });
    expect(levelRange(lv, 'normal', 'escape', 'gimmick')).toEqual({ center: 12, min: 11, max: 13 });
    // a kind without its own range borrows the other kind's (stretched to
    // contain its own center), then falls back to center ± 2
    const half = { ...lv, range: { gimmick: lv.range.gimmick } };
    expect(levelRange(half, 'normal', 'escape', 'basic')).toEqual({ center: 5, min: 5, max: 13 });
    const none = { ...lv, range: undefined };
    expect(levelRange(none, 'normal', 'escape', 'basic')).toEqual({ center: 5, min: 3, max: 7 });
  });

  it('the default rules kind is gimmick', () => {
    const lv = getLevel('trapper', 5);
    expect(blocksFor(lv, 'hard')).toBe(blocksFor(lv, 'hard', 'gimmick'));
    expect(levelRange(lv, 'hard', 'trapper').center).toBe(levelRange(lv, 'hard', 'trapper', 'gimmick').center);
  });
});

describe('slider mapping (16.3): right is always harder', () => {
  const range = { center: 7, min: 3, max: 11 };

  it('escape maps the right end to MORE blocks', () => {
    expect(sliderBlocks('escape', range, 0)).toBe(3);
    expect(sliderBlocks('escape', range, 0.5)).toBe(7);
    expect(sliderBlocks('escape', range, 1)).toBe(11);
    const seen = [];
    for (let t = 0; t <= 1.0001; t += 0.1) seen.push(sliderBlocks('escape', range, t));
    for (let i = 1; i < seen.length; i++) expect(seen[i]).toBeGreaterThanOrEqual(seen[i - 1]);
  });

  it('trapper maps the right end to FEWER blocks', () => {
    expect(sliderBlocks('trapper', range, 0)).toBe(11);
    expect(sliderBlocks('trapper', range, 0.5)).toBe(7);
    expect(sliderBlocks('trapper', range, 1)).toBe(3);
    const seen = [];
    for (let t = 0; t <= 1.0001; t += 0.1) seen.push(sliderBlocks('trapper', range, t));
    for (let i = 1; i < seen.length; i++) expect(seen[i]).toBeLessThanOrEqual(seen[i - 1]);
  });

  it('sliderPosition inverts sliderBlocks in both courses', () => {
    for (const course of ['escape', 'trapper']) {
      for (const blocks of range.min <= 0 ? [range.min, range.max] : [3, 4, 7, 8, 11]) {
        const t = sliderPosition(course, range, blocks);
        expect(t).toBeGreaterThanOrEqual(0);
        expect(t).toBeLessThanOrEqual(1);
        expect(sliderBlocks(course, range, t)).toBe(blocks);
      }
      // out-of-range values clamp, and a zero-width range is one point
      expect(sliderPosition(course, range, 99)).toBe(course === 'escape' ? 1 : 0);
      expect(sliderBlocks(course, { center: 5, min: 5, max: 5 }, 0.7)).toBe(5);
    }
  });

  it('clampBlocks keeps the count inside the range and the center by default', () => {
    expect(clampBlocks(range, 99)).toBe(11);
    expect(clampBlocks(range, -3)).toBe(3);
    expect(clampBlocks(range, 8)).toBe(8);
    expect(clampBlocks(range, NaN)).toBe(7);
    expect(BLOCKS_MIN).toBe(0);
    expect(BLOCKS_MAX).toBe(60); // 16.1
  });

  it('blockSettingKey separates every (rules, play, course, level, difficulty)', () => {
    const base = { rules: 'gimmick', play: 'level', course: 'escape', level: 5, difficulty: 'hard' };
    expect(blockSettingKey(base)).toBe('gimmick.level.escape.5.hard');
    expect(blockSettingKey({ ...base, difficulty: 'easy' })).not.toBe(blockSettingKey(base));
    expect(blockSettingKey({ ...base, level: 6 })).not.toBe(blockSettingKey(base));
    expect(blockSettingKey({ ...base, rules: 'basic' })).not.toBe(blockSettingKey(base));
    expect(blockSettingKey({ ...base, play: 'streak' })).not.toBe(blockSettingKey(base));
    expect(blockSettingKey({ ...base, course: 'trapper' })).not.toBe(blockSettingKey(base));
  });
});
