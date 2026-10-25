import { describe, it, expect } from 'vitest';
import {
  simulate,
  playGame,
  simPlayerItems,
  seedFor,
  PROFILES,
} from '../scripts/sim.mjs';
import { assembleStats, buildJobs, today } from '../scripts/stats.mjs';
import {
  targetRate,
  searchBlocks,
  batchedSearch,
  orderCenters,
  rewriteLevels,
} from '../scripts/calibrateLib.mjs';
import { runJobs, jobKey } from '../scripts/pool.mjs';
import { recordResult, defaultProgress, loadProgress, saveProgress, sumStatCell } from '../src/game/play/progress.js';
import { getLevel, blocksFor } from '../src/game/play/levels.js';
import { gimmickRuleset, basicRuleset } from '../src/game/rulesets.js';

/** Round-trip a progress through a localStorage-shaped map (16.3). */
function roundTrip(p) {
  const m = new Map();
  const storage = {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => {
      m.set(k, String(v));
    },
  };
  saveProgress(storage, p);
  return loadProgress(storage);
}

const TINY = {
  rules: 'gimmick',
  course: 'escape',
  level: 1,
  difficulty: 'normal',
  blocks: 5,
  games: 4,
  seedBase: 0,
};

describe('scripts/sim.mjs (13.8 / 14.6 profiles)', () => {
  it('the normal profile plays seeded, reproducible games (balance test)', () => {
    const a = simulate({ ...TINY, profile: 'normal' });
    const b = simulate({ ...TINY, profile: 'normal' });
    expect(a).toEqual(b); // same seeds → same result
    expect(a.games).toBe(4);
    expect(a.rate).toBeGreaterThanOrEqual(0);
    expect(a.rate).toBeLessThanOrEqual(1);
    expect(a.wins).toBeGreaterThanOrEqual(0);
    expect(a.avgMoves).toBeGreaterThan(0);
  });

  it('weak/normal/strong drive the player side with Easy/Normal/Hard AI', () => {
    expect(PROFILES).toEqual(['weak', 'normal', 'strong']);
    const win = playGame({ ...TINY, profile: 'normal', seed: 42 });
    expect(['catWin', 'trapperWin', 'playing']).toContain(win.status);
    expect(win.playerWon).toBe(win.status === 'catWin');
  });

  it('the player starts with 1 role item once unlocked (hammer L2 / double L4)', () => {
    expect(simPlayerItems('gimmick', 'escape', 1)).toEqual({ hammer: 0, double: 0 });
    expect(simPlayerItems('gimmick', 'escape', 2)).toEqual({ hammer: 1, double: 0 });
    expect(simPlayerItems('gimmick', 'trapper', 3)).toEqual({ hammer: 0, double: 0 });
    expect(simPlayerItems('gimmick', 'trapper', 4)).toEqual({ hammer: 0, double: 1 });
    expect(simPlayerItems('basic', 'escape', 16)).toBeUndefined();
  });

  it('replays the same games at every block count (seeds ignore blocks)', () => {
    const key = { seedBase: 3, rules: 'gimmick', course: 'escape', level: 5, difficulty: 'hard', profile: 'strong' };
    expect(seedFor({ ...key, blocks: 4 }, 7)).toBe(seedFor({ ...key, blocks: 40 }, 7));
    expect(seedFor(key, 7)).not.toBe(seedFor(key, 8));
  });

  it('reports the block count actually placed (16.1)', () => {
    // newGame lowers the request after 100 failed tries, so the placed
    // count can be smaller than the requested one — never larger
    const st = gimmickRuleset.newGame({
      role: 'escape',
      ai: 'normal',
      blocks: 60,
      gimmick: { gimmicks: {}, aiItems: 0, cats: 1 },
      seed: 5,
    });
    const onBoard = st.board.blocked.reduce((n, v) => n + (v ? 1 : 0), 0);
    expect(st.placedBlocks).toBe(onBoard);
    expect(st.placedBlocks).toBeLessThanOrEqual(60);
    expect(st.placedBlocks).toBeGreaterThanOrEqual(0);

    const basic = basicRuleset.newGame({ role: 'escape', ai: 'normal', blocks: 4, seed: 3 });
    expect(basic.placedBlocks).toBe(
      basic.board.blocked.reduce((n, v) => n + (v ? 1 : 0), 0),
    );

    const game = playGame({ ...TINY, profile: 'normal', seed: 42, blocks: 60 });
    expect(game.placed).toBeLessThanOrEqual(60);
    const sim = simulate({ ...TINY, profile: 'normal', blocks: 12, games: 2 });
    expect(sim.placed).toBeLessThanOrEqual(12);
    expect(sim.placed).toBeGreaterThanOrEqual(0);
  }, 30000);
});

describe('scripts/stats.mjs (levelStats.json)', () => {
  it('builds one job per rules/course/difficulty/level/profile', () => {
    const jobs = buildJobs({ rulesList: ['gimmick'], games: 10 });
    expect(jobs.length).toBe(2 * 3 * 20 * 3);
    const lv = getLevel('trapper', 10);
    const job = jobs.find((j) => j.course === 'trapper' && j.level === 10 && j.difficulty === 'hard' && j.profile === 'weak');
    expect(job.blocks).toBe(blocksFor(lv, 'hard'));
    expect(job.profile).toBe('weak');
  });

  it('assembles the 14.6 shape; rate/avgMoves follow the normal profile', () => {
    const results = [];
    for (const course of ['escape', 'trapper']) {
      for (const difficulty of ['easy', 'normal', 'hard']) {
        for (let level = 1; level <= 20; level++) {
          for (const profile of PROFILES) {
            results.push({
              rules: 'gimmick', course, difficulty, level, profile,
              blocks: level, wins: 0, draws: 0,
              rate: profile === 'normal' ? 0.5 : 0.25,
              avgMoves: 12.5, games: 10,
            });
          }
        }
      }
    }
    const stats = assembleStats(results, { games: 10, rules: 'gimmick', generatedAt: today() });
    expect(stats.rules).toBe('gimmick');
    expect(stats.games).toBe(10);
    expect(stats.courses.escape.easy.rate).toHaveLength(20);
    expect(stats.courses.escape.easy.rate[3]).toBe(0.5);
    expect(stats.courses.escape.easy.blocks[3]).toBe(4);
    expect(stats.courses.escape.easy.avgMoves[3]).toBe(12.5);
    expect(stats.profiles.escape.easy.weak[3]).toBe(0.25);
    expect(stats.profiles.escape.easy.strong[3]).toBe(0.25);
    expect(stats.profiles.trapper.hard.normal[19]).toBe(0.5);
    // basic rules only pick up their own results
    const basic = assembleStats(
      [{ ...results.find((r) => r.profile === 'normal'), rules: 'basic' }],
      { games: 10, rules: 'basic', generatedAt: today() },
    );
    expect(basic.courses.escape.easy.rate[0]).toBe(0.5);
    expect(basic.courses.trapper.easy.rate[17]).toBe(0);
  });

  it('the worker pool plays a job end to end', async () => {
    const results = await runJobs(
      [{ rules: 'basic', course: 'escape', level: 1, difficulty: 'normal', profile: 'normal', blocks: 5, games: 2, seedBase: 0 }],
      { workers: 1 },
    );
    expect(results).toHaveLength(1);
    expect(results[0].games).toBe(2);
    expect(results[0].rate).toBeGreaterThanOrEqual(0);
    expect(results[0].rate).toBeLessThanOrEqual(1);
  }, 30000);
});

describe('worker pool result mapping (15.2)', () => {
  /** Three different settings, played at three block counts each. */
  const SETTINGS = [
    { rules: 'gimmick', course: 'escape', level: 1, difficulty: 'normal', profile: 'normal' },
    { rules: 'gimmick', course: 'trapper', level: 3, difficulty: 'easy', profile: 'weak' },
    { rules: 'basic', course: 'escape', level: 5, difficulty: 'hard', profile: 'strong' },
  ];

  it('the pool (2 workers) returns exactly what simulate() gives in-process', async () => {
    const jobs = [];
    for (const s of SETTINGS) {
      for (const blocks of [0, 12, 24]) {
        jobs.push({ ...s, blocks, games: 10, seedBase: 7 });
      }
    }
    const results = await runJobs(jobs, { workers: 2 });
    expect(results).toHaveLength(jobs.length);
    for (let i = 0; i < jobs.length; i++) {
      // result i is job i's result — not some other worker's chunk
      expect(results[i].key).toBe(jobKey(jobs[i]));
      expect(results[i].course).toBe(jobs[i].course);
      expect(results[i].level).toBe(jobs[i].level);
      expect(results[i].difficulty).toBe(jobs[i].difficulty);
      expect(results[i].profile).toBe(jobs[i].profile);
      expect(results[i].blocks).toBe(jobs[i].blocks);
      const want = simulate(jobs[i]);
      expect(
        { wins: results[i].wins, draws: results[i].draws, avgMoves: results[i].avgMoves },
        `${jobKey(jobs[i])}`,
      ).toEqual({ wins: want.wins, draws: want.draws, avgMoves: want.avgMoves });
    }
  }, 120000);

  it('the batched binary search follows a monotone stub to the right blocks', async () => {
    const settings = [
      { course: 'escape', difficulty: 'easy', level: 1 },
      { course: 'escape', difficulty: 'normal', level: 5 },
      { course: 'trapper', difficulty: 'hard', level: 20 },
    ];
    // synthetic "simulate": the escape rate falls with blocks, the
    // trapper rate rises — both exactly monotone
    const probe = async (jobs) =>
      jobs.map((job) => ({
        key: jobKey(job),
        games: job.games,
        draws: 0,
        rate: job.course === 'escape' ? 1 - job.blocks / 40 : job.blocks / 40,
      }));
    const seen = [];
    await batchedSearch(settings, probe, { games: 10, onProbe: (p) => seen.push(p) });
    expect(seen.length).toBeGreaterThan(0);
    for (const p of seen) expect(Number.isInteger(p.draws)).toBe(true); // draws are reported

    expect(settings[0].best.blocks).toBe(2); // target 0.95 → 1 - b/40
    expect(settings[0].best.rate).toBeCloseTo(0.95, 10);
    expect(settings[0].best.diff).toBeLessThan(1e-9);
    expect(settings[1].best.blocks).toBe(13); // target ≈ 0.6842 → 0.675 beats 0.700
    expect(settings[1].best.rate).toBeCloseTo(0.675, 10);
    expect(settings[1].best.draws).toBe(0);
    expect(settings[2].best.blocks).toBe(4); // target 0.1 → b/40
    expect(settings[2].best.rate).toBeCloseTo(0.1, 10);
    for (const s of settings) expect(s.lo).toBeGreaterThan(s.hi); // search closed
  });

  it('matches results by setting key even when the probe returns them shuffled', async () => {
    const settings = [
      { course: 'escape', difficulty: 'easy', level: 1 },
      { course: 'trapper', difficulty: 'hard', level: 20 },
    ];
    const probe = async (jobs) =>
      jobs
        .map((job) => ({
          key: jobKey(job),
          draws: 0,
          rate: job.course === 'escape' ? 1 - job.blocks / 40 : job.blocks / 40,
        }))
        .reverse(); // the pre-15.2 chunk permutation, on purpose
    await batchedSearch(settings, probe, { games: 1 });
    expect(settings[0].best.blocks).toBe(2);
    expect(settings[1].best.blocks).toBe(4);
  });

  it('rejects a result that does not echo its job key', async () => {
    const settings = [{ course: 'escape', difficulty: 'easy', level: 1 }];
    const wrongKey = async (jobs) =>
      jobs.map((job) => ({ key: jobKey({ ...job, blocks: job.blocks + 1 }), rate: 0.95, draws: 0 }));
    await expect(batchedSearch(settings, wrongKey, { games: 1 })).rejects.toThrow(/no result/i);
    const missing = async (jobs) =>
      jobs.map((job, i) => (i === 0 ? { key: 'bogus', rate: 0.95, draws: 0 } : { key: jobKey(job), rate: 0, draws: 0 }));
    const settings2 = [{ course: 'escape', difficulty: 'easy', level: 1 }];
    await expect(batchedSearch(settings2, missing, { games: 1 })).rejects.toThrow(/no result/i);
  });
});

describe('scripts/calibrateLib.mjs (14.6)', () => {
  it('targets are linear between L1 and L20', () => {
    expect(targetRate('easy', 1)).toBeCloseTo(0.95, 10);
    expect(targetRate('easy', 20)).toBeCloseTo(0.4, 10);
    expect(targetRate('normal', 1)).toBeCloseTo(0.8, 10);
    expect(targetRate('hard', 20)).toBeCloseTo(0.1, 10);
    expect(targetRate('normal', 11)).toBeCloseTo(0.8 + (0.25 - 0.8) * (10 / 19), 10);
    expect(targetRate('normal', 10)).toBeLessThan(targetRate('normal', 1));
    expect(targetRate('normal', 20)).toBeLessThan(targetRate('normal', 10));
  });

  it('binary-searches the closest block count (decreasing and increasing)', async () => {
    // escape: rate falls with blocks (1 - b/40)
    const escape = await searchBlocks((b) => 1 - b / 40, { difficulty: 'easy', level: 1, increasing: false });
    expect(escape.rate).toBeCloseTo(0.95, 5);
    expect(escape.blocks).toBe(2);
    expect(escape.unreachable).toBe(false);
    expect(escape.probes).toBeLessThanOrEqual(7);

    // trapper: rate rises with blocks (b/40)
    const trapper = await searchBlocks((b) => b / 40, { difficulty: 'hard', level: 20, increasing: true });
    expect(trapper.rate).toBeCloseTo(0.1, 5);
    expect(trapper.blocks).toBe(4);
    expect(trapper.unreachable).toBe(false);

    // a flat rate far from the target is reported UNREACHABLE
    const flat = await searchBlocks(() => 0, { difficulty: 'easy', level: 1, increasing: false });
    expect(flat.unreachable).toBe(true);
  });

  it('orders within a level (harder is never easier), keeps cross-level drops (18.6)', () => {
    const by = {
      escape: { easy: [3, 5, 4, 7], normal: [1, 5, 4, 6], hard: [2, 3, 9, 8] },
      trapper: { easy: [7, 6, 9, 2], normal: [7, 8, 5, 3], hard: [9, 9, 9, 9] },
    };
    orderCenters(by);
    // 18.6: no across-level constraint — L3's drop below L2 survives in
    // every escape difficulty (the AI step at L7/L14 needs exactly that)
    expect(by.escape.easy).toEqual([3, 5, 4, 7]);
    expect(by.escape.normal).toEqual([3, 5, 4, 7]);
    expect(by.escape.hard).toEqual([3, 5, 9, 8]);
    expect(by.trapper.easy).toEqual([7, 6, 9, 2]);
    // per level: easy ≤ normal ≤ hard (escape), easy ≥ normal ≥ hard (trapper)
    for (let i = 0; i < 4; i++) {
      expect(by.escape.easy[i]).toBeLessThanOrEqual(by.escape.normal[i]);
      expect(by.escape.normal[i]).toBeLessThanOrEqual(by.escape.hard[i]);
      expect(by.trapper.easy[i]).toBeGreaterThanOrEqual(by.trapper.normal[i]);
      expect(by.trapper.normal[i]).toBeGreaterThanOrEqual(by.trapper.hard[i]);
    }
  });

  it('rewrites the blocks objects in levels.js and keeps a calibrated comment', () => {
    const src = [
      '/** Escape course. */',
      'export const ESCAPE_LEVELS = [',
      "  { id: 1, course: 'escape', ai: 'easy', blocks: { easy: 5, normal: 5, hard: 5 }, aiItems: 0 },",
      "  { id: 2, course: 'escape', ai: 'easy', blocks: { easy: 5, normal: 5, hard: 5 }, aiItems: 0 },",
      '];',
      '// calibrated 2020-01-01',
      'export const TRAPPER_LEVELS = [',
      "  { id: 1, course: 'trapper', ai: 'easy', blocks: { easy: 15, normal: 15, hard: 15 }, aiItems: 0 },",
      '];',
    ].join('\n');
    const by = {
      escape: { easy: [1, 2], normal: [3, 4], hard: [5, 6] },
      trapper: { easy: [9], normal: [8], hard: [7] },
    };
    const out = rewriteLevels(src, by, '2026-10-23');
    // 18.1: the calibrated (gimmick) kind gets the fresh centers, the
    // other kind keeps the line's old values
    expect(out).toContain('blocks: { basic: { easy: 5, normal: 5, hard: 5 }, gimmick: { easy: 1, normal: 3, hard: 5 } }');
    expect(out).toContain('blocks: { basic: { easy: 5, normal: 5, hard: 5 }, gimmick: { easy: 2, normal: 4, hard: 6 } }');
    expect(out).toContain('blocks: { basic: { easy: 15, normal: 15, hard: 15 }, gimmick: { easy: 9, normal: 8, hard: 7 } }');
    expect(out).toContain('// calibrated 2026-10-23');
    expect((out.match(/\/\/ calibrated /g) || []).length).toBe(2); // one per table
    expect(out).not.toContain('2020-01-01'); // the stale comment is replaced
  });
});

describe('level stats per difficulty (14.6 progress)', () => {
  const ctx = {
    rules: 'gimmick',
    play: 'level',
    role: 'escape',
    course: 'escape',
    level: 5,
    difficulty: 'hard',
  };
  // the level's calibrated center (14.6/18.1) — the bucket a game without
  // an explicit block count lands in
  const CENTER = String(blocksFor(getLevel('escape', 5), 'hard', 'gimmick'));

  it('counts played/won per rules, course, level, difficulty and block count (16.3)', () => {
    let p = defaultProgress();
    // empty cells stay empty until the first game at that difficulty
    expect(p.stats.gimmick.escape[4].hard).toEqual({});
    p = recordResult(p, ctx, 'catWin').progress;
    // no explicit count → the level's center (escape L5 hard)
    expect(p.stats.gimmick.escape[4].hard).toEqual({ [CENTER]: { played: 1, won: 1 } });
    p = recordResult(p, ctx, 'trapperWin').progress; // a loss still counts played
    expect(p.stats.gimmick.escape[4].hard).toEqual({ [CENTER]: { played: 2, won: 1 } });
    // a different difficulty stays separate
    p = recordResult(p, { ...ctx, difficulty: 'easy' }, 'catWin').progress;
    expect(p.stats.gimmick.escape[4].easy).toEqual({ [String(blocksFor(getLevel('escape', 5), 'easy', 'gimmick'))]: { played: 1, won: 1 } });
  });

  it('keeps one bucket per block count (16.3)', () => {
    let p = defaultProgress();
    p = recordResult(p, { ...ctx, blocks: 5 }, 'catWin').progress;
    p = recordResult(p, { ...ctx, blocks: 5 }, 'catWin').progress;
    p = recordResult(p, { ...ctx, blocks: 9 }, 'trapperWin').progress;
    expect(p.stats.gimmick.escape[4].hard).toEqual({
      '5': { played: 2, won: 2 },
      '9': { played: 1, won: 0 },
    });
    // old saves with the pre-16.3 `{played, won}` cell still load
    const legacy = defaultProgress();
    legacy.stats.gimmick.escape[4].hard = { played: 3, won: 1 };
    const loaded = recordResult(legacy, { ...ctx, blocks: 5 }, 'catWin').progress;
    expect(sumStatCell(loaded.stats.gimmick.escape[4].hard)).toEqual({ played: 4, won: 2 });
    expect(loaded.stats.gimmick.escape[4].hard[CENTER]).toEqual({ played: 3, won: 1 });
  });

  it('has no 3-win cap, while the unlock wins keep theirs', () => {
    let p = defaultProgress();
    for (let t = 0; t < 5; t++) p = recordResult(p, ctx, 'catWin').progress;
    expect(p.level.gimmick.escape[4]).toBe(3); // still capped
    expect(p.stats.gimmick.escape[4].hard).toEqual({ [CENTER]: { played: 5, won: 5 } }); // not capped
  });

  it('streak keys carry @n away from the center and survive save/load (16.3)', () => {
    const streak = (blocks) => ({
      rules: 'basic',
      play: 'streak',
      role: 'trapper',
      difficulty: 'normal',
      blocks,
    });
    let p = recordResult(defaultProgress(), streak(13), 'trapperWin').progress; // trapper win
    expect(p.streak['basic.trapper.normal@13']).toEqual({ current: 1, best: 1 });
    p = recordResult(p, streak(13), 'catWin').progress; // the cat escaped
    expect(p.streak['basic.trapper.normal@13']).toEqual({ current: 0, best: 1 });
    // the center itself (11) keeps the old key
    p = recordResult(p, streak(11), 'trapperWin').progress;
    expect(p.streak['basic.trapper.normal']).toEqual({ current: 1, best: 1 });
    const loaded = roundTrip(p);
    expect(loaded.streak['basic.trapper.normal@13']).toEqual({ current: 0, best: 1 });
    expect(loaded.streak['basic.trapper.normal']).toEqual({ current: 1, best: 1 });
  });

  it('ignores streak games and rounds through save/load', () => {
    const p = recordResult(
      defaultProgress(),
      { rules: 'gimmick', play: 'streak', role: 'escape', difficulty: 'easy' },
      'catWin',
    ).progress;
    expect(p.stats.gimmick.escape[0].easy).toEqual({});
  });
});
