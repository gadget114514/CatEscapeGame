/**
 * Full sweep (spec 16.4): the coarse/fine count lists, the resume logic
 * (completed probes are skipped on restart) and the levelStats assembly
 * of `calibrate`. Pure Node — no DOM, no Babylon.js.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  coarseCounts,
  parseLevels,
  parseRules,
  probeKey,
  readSweep,
  bestRecords,
  fineCounts,
  planProbes,
  printReport,
} from '../scripts/sweep.mjs';
import { assembleSweepStats } from '../scripts/stats.mjs';
import { getLevel, blocksFor } from '../src/game/play/levels.js';

const record = (over = {}) => ({
  rules: 'gimmick',
  course: 'escape',
  level: 1,
  profile: 'normal',
  blocks: 4,
  placed: 4,
  games: 100,
  wins: 50,
  draws: 0,
  avgMoves: 12,
  seedBase: 0,
  ...over,
});

describe('sweep passes (16.4)', () => {
  it('the coarse pass covers every even count of the 0–60 range', () => {
    const counts = coarseCounts();
    expect(counts.length).toBe(31);
    expect(counts[0]).toBe(0);
    expect(counts[counts.length - 1]).toBe(60);
    for (const c of counts) expect(c % 2).toBe(0);
  });

  it('parseLevels understands ranges, lists and junk', () => {
    expect(parseLevels('1-2')).toEqual([1, 2]);
    expect(parseLevels('1,3,5-7')).toEqual([1, 3, 5, 6, 7]);
    expect(parseLevels('20-99')).toEqual([20]);
    expect(parseLevels('x')).toBeNull();
    expect(parseLevels(null)).toBeNull();
  });

  it('the fine pass reads the calibrated ranges (center ±2 fallback)', () => {
    // uncalibrated: a flat B(5) table → the union of the three ±2 ranges
    const uncal = {
      blocks: {
        basic: { easy: 5, normal: 5, hard: 5 },
        gimmick: { easy: 5, normal: 5, hard: 5 },
      },
    };
    expect(fineCounts('escape', 1, () => uncal)).toEqual([3, 4, 5, 6, 7]);
    // a calibrated level sweeps every integer from the lowest to the
    // highest edge of its three ranges (flat blocks keep the centers at 5)
    const lv = {
      blocks: {
        basic: { easy: 5, normal: 5, hard: 5 },
        gimmick: { easy: 5, normal: 5, hard: 5 },
      },
      range: { easy: [1, 3], normal: [4, 6], hard: [9, 12] },
    };
    const counts = fineCounts('escape', 2, () => lv);
    expect(counts).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });

  it('the fine pass reads the per-rules ranges (18.1)', () => {
    const lv = {
      ...getLevel('escape', 3),
      blocks: {
        basic: { easy: 6, normal: 6, hard: 6 },
        gimmick: { easy: 12, normal: 12, hard: 12 },
      },
      range: {
        basic: { easy: [4, 6], normal: [5, 7], hard: [6, 8] },
        gimmick: { easy: [10, 12], normal: [11, 13], hard: [12, 14] },
      },
    };
    expect(fineCounts('escape', 3, () => lv, 'basic')).toEqual([4, 5, 6, 7, 8]);
    expect(fineCounts('escape', 3, () => lv, 'gimmick')).toEqual([
      10, 11, 12, 13, 14,
    ]);
  });

  it('parseRules filters the rules kinds (18.5)', () => {
    expect(parseRules('gimmick')).toEqual(['gimmick']);
    expect(parseRules('basic')).toEqual(['basic']);
    expect(parseRules('both')).toEqual(['gimmick', 'basic']);
    expect(parseRules('gimmick,basic')).toEqual(['gimmick', 'basic']);
    expect(parseRules('junk')).toEqual(['gimmick', 'basic']); // everything
    expect(parseRules(null)).toEqual(['gimmick', 'basic']);
  });

  it("planProbes' countsOf receives the job's rules kind", () => {
    const seen = [];
    const countsOf = (rules, course, level) => {
      seen.push([rules, course, level]);
      return [4];
    };
    planProbes(
      { rulesList: ['basic'], courses: ['escape'], levels: [1], profiles: ['normal'], countsOf, games: 1 },
      new Set(),
    );
    expect(seen).toEqual([['basic', 'escape', 1]]);
  });
});

describe('resumable sweep output (16.4)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sweep-test-'));
  const file = path.join(dir, 'sweep.json');

  it('reads JSON lines, skips broken ones and keeps the strongest record', () => {
    fs.writeFileSync(
      file,
      [
        JSON.stringify(record({ blocks: 4, games: 100, wins: 40 })),
        '{"blocks": 4, half written',
        JSON.stringify(record({ blocks: 6, games: 100, wins: 20 })),
        JSON.stringify(record({ blocks: 6, games: 200, wins: 50 })), // the fine pass
      ].join('\n'),
      'utf8',
    );
    const records = readSweep(file);
    expect(records.length).toBe(3); // the broken line is dropped
    const best = bestRecords(records);
    expect(best.size).toBe(2);
    const six = [...best.values()].find((r) => r.blocks === 6);
    expect(six.games).toBe(200); // more games win a tie of keys
    expect(readSweep(path.join(dir, 'missing.json'))).toEqual([]);
  });

  it('planProbes skips every probe already in the file', () => {
    const records = readSweep(file);
    const done = new Set(records.map(probeKey));
    const countsOf = () => [4, 6, 8];
    const opts = { rulesList: ['gimmick'], courses: ['escape'], profiles: ['normal'], levels: [1], countsOf, games: 100 };
    const all = planProbes(opts, new Set());
    expect(all.length).toBe(3);
    const remaining = planProbes(opts, done);
    // blocks 4 and 6 are in the file at 100 games; only 8 is new
    expect(remaining.map((j) => j.blocks)).toEqual([8]);
    expect(remaining[0].games).toBe(100);
  });

  it('the report prints a compact levels × counts matrix', () => {
    const records = readSweep(file);
    expect(() => printReport(records)).not.toThrow();
    expect(() => printReport([])).not.toThrow();
  });

  it('probeKey separates games, seeds and counts', () => {
    const a = record();
    expect(probeKey(a)).toBe(probeKey({ ...a }));
    expect(probeKey(a)).not.toBe(probeKey({ ...a, blocks: 5 }));
    expect(probeKey(a)).not.toBe(probeKey({ ...a, games: 10 }));
    expect(probeKey(a)).not.toBe(probeKey({ ...a, seedBase: 1 }));
    expect(probeKey(a)).not.toBe(probeKey({ ...a, profile: 'weak' }));
  });
});

describe('assembleSweepStats (16.4 levelStats)', () => {
  it('fills the curves and reads the centers of every profile', () => {
    const records = [];
    for (const course of ['escape', 'trapper']) {
      for (const profile of ['weak', 'normal', 'strong']) {
        for (const blocks of [0, 2, 4]) {
          records.push(
            record({
              course,
              profile,
              blocks,
              placed: blocks + 0.5,
              games: 10,
              wins: blocks, // rate = blocks/10
              avgMoves: 10 + blocks,
            }),
          );
        }
      }
    }
    const stats = assembleSweepStats(records, {
      rules: 'gimmick',
      games: 10,
      generatedAt: '2026-10-24',
      centers: () => 2, // every difficulty sits at 2 blocks
    });
    expect(stats.rules).toBe('gimmick');
    expect(stats.courses.escape.normal.rate[0]).toBeCloseTo(0.2, 10);
    expect(stats.courses.escape.normal.avgMoves[0]).toBe(12);
    // 16.1: the reported count is the one actually placed
    expect(stats.courses.escape.normal.blocks[0]).toBe(2.5);
    expect(stats.profiles.escape.normal.weak[0]).toBeCloseTo(0.2, 10);
    expect(stats.profiles.escape.normal.strong[0]).toBeCloseTo(0.2, 10);
    // curves: every measured count of every profile, for the slider
    const curve = stats.curves.escape.normal[0];
    expect(curve.blocks).toEqual([0, 2, 4]);
    expect(curve.rate).toEqual([0, 0.2, 0.4]);
    expect(stats.curves.trapper.weak[19]).toEqual({ blocks: [], rate: [], avgMoves: [], games: [] });
    // unknown centers carry the previous file's numbers over
    const carried = assembleSweepStats(records, {
      rules: 'gimmick',
      centers: () => 42,
      previous: stats,
    });
    expect(carried.courses.escape.normal.rate[0]).toBeCloseTo(0.2, 10);
    expect(carried.courses.trapper.hard.rate[7]).toBe(0); // nothing to carry there
  });

  it('ignores the other rules kind', () => {
    const stats = assembleSweepStats([record({ rules: 'basic' })], {
      rules: 'gimmick',
      centers: () => 4,
    });
    expect(stats.courses.escape.normal.rate[0]).toBe(0);
    expect(stats.curves.escape.normal[0].blocks).toEqual([]);
  });
});
