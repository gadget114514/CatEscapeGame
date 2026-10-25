import { describe, it, expect } from 'vitest';
import { resolveGame } from '../src/game/play/setup.js';
import {
  ESCAPE_LEVELS,
  TRAPPER_LEVELS,
  getLevel,
  getLevels,
  blocksFor,
  LEVEL_COUNT,
  GIMMICK_KEYS,
  levelFeatures,
} from '../src/game/play/levels.js';
import { defaultProgress, highestUnlocked, WIN_TARGET } from '../src/game/play/progress.js';
import { basicRuleset, gimmickRuleset } from '../src/game/rulesets.js';
import { newGame as basicNewGame, INITIAL_BLOCKS, legalBlocks } from '../src/game/rules.js';
import { UNLOCKS } from '../src/game/gimmick/registry.js';
import { mulberry32 } from '../src/game/rng.js';

/**
 * [L, AI, aiItems, stone, tunnel, ice, fish, arrow, brittle, spring,
 *  item, cats, catsGoal, intro] — spec 14.3 (fish per 14.5). The block
 *  centers are calibration data (14.6/18.1), so they are checked
 *  structurally in `rowsMatch`, not row by row.
 */
const ESCAPE_TABLE = [
  [1, 'easy', 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, null, null],
  [2, 'easy', 0, 2, 0, 0, 0, 0, 0, 0, 0, 1, null, 'stone'],
  [3, 'easy', 0, 2, 0, 0, 0, 0, 0, 0, 0, 1, null, null],
  [4, 'easy', 1, 2, 0, 0, 0, 0, 0, 0, 0, 1, null, 'double'],
  [5, 'easy', 1, 2, 0, 0, 0, 0, 0, 0, 0, 1, null, null],
  [6, 'easy', 1, 2, 1, 0, 0, 0, 0, 0, 0, 1, null, 'tunnel'],
  [7, 'normal', 1, 2, 1, 0, 0, 0, 0, 0, 0, 1, null, null],
  [8, 'normal', 1, 2, 1, 3, 0, 0, 0, 0, 0, 1, null, 'ice'],
  [9, 'normal', 1, 2, 1, 3, 2, 0, 0, 0, 0, 1, null, null],
  [10, 'normal', 1, 1, 1, 3, 2, 3, 0, 0, 0, 1, null, 'arrow'],
  [11, 'normal', 1, 1, 1, 3, 2, 3, 0, 0, 0, 1, null, null],
  [12, 'normal', 1, 1, 1, 4, 2, 3, 6, 0, 0, 1, null, 'brittle'],
  [13, 'normal', 1, 1, 1, 4, 2, 3, 6, 0, 0, 1, null, null],
  [14, 'hard', 2, 1, 2, 4, 2, 4, 6, 2, 0, 1, null, 'spring'],
  [15, 'hard', 2, 1, 2, 4, 3, 4, 6, 2, 0, 1, null, null],
  [16, 'hard', 2, 0, 2, 4, 3, 4, 8, 2, 2, 1, null, 'hammer'],
  [17, 'hard', 2, 0, 2, 4, 3, 4, 8, 2, 2, 2, 'anyEscape', 'cats2Escape'],
  [18, 'hard', 2, 0, 2, 4, 3, 4, 8, 3, 2, 2, 'anyCatch', 'cats2Catch'],
  [19, 'hard', 2, 0, 2, 4, 3, 4, 8, 3, 2, 3, 'anyEscape', 'cats3Escape'],
  [20, 'hard', 2, 0, 2, 4, 3, 4, 8, 3, 2, 3, 'anyCatch', 'cats3Catch'],
];

const TRAPPER_TABLE = [
  [1, 'easy', 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, null, null],
  [2, 'easy', 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, null, 'stone'],
  [3, 'easy', 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, null, null],
  [4, 'easy', 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, null, 'double'],
  [5, 'easy', 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, null, null],
  [6, 'easy', 0, 1, 1, 0, 0, 0, 0, 0, 0, 1, null, 'tunnel'],
  [7, 'normal', 0, 1, 1, 0, 0, 0, 0, 0, 0, 1, null, null],
  [8, 'normal', 0, 1, 1, 3, 0, 0, 0, 0, 0, 1, null, 'ice'],
  [9, 'normal', 0, 1, 1, 3, 0, 0, 0, 0, 0, 1, null, null],
  [10, 'normal', 0, 2, 1, 3, 0, 3, 0, 0, 0, 1, null, 'arrow'],
  [11, 'normal', 0, 2, 1, 3, 0, 3, 0, 0, 0, 1, null, null],
  [12, 'normal', 0, 2, 1, 4, 0, 3, 6, 0, 0, 1, null, 'brittle'],
  [13, 'normal', 0, 2, 1, 4, 0, 3, 6, 0, 0, 1, null, null],
  [14, 'hard', 0, 2, 2, 4, 0, 4, 6, 2, 0, 1, null, 'spring'],
  [15, 'hard', 0, 2, 2, 4, 1, 4, 6, 2, 0, 1, null, null],
  [16, 'hard', 1, 3, 2, 4, 1, 4, 8, 2, 2, 1, null, 'hammer'],
  [17, 'hard', 1, 3, 2, 4, 1, 4, 8, 2, 2, 2, 'anyEscape', 'cats2Escape'],
  [18, 'hard', 1, 3, 2, 4, 1, 4, 8, 3, 2, 2, 'anyCatch', 'cats2Catch'],
  [19, 'hard', 1, 3, 2, 4, 1, 4, 8, 3, 2, 3, 'anyEscape', 'cats3Escape'],
  [20, 'hard', 1, 3, 2, 4, 1, 4, 8, 3, 2, 3, 'anyCatch', 'cats3Catch'],
];

function rowsMatch(levels, table, course) {
  expect(levels.length).toBe(LEVEL_COUNT);
  const out = levels.map((lv) => [
    lv.id,
    lv.ai,
    lv.aiItems,
    lv.gimmicks.stone,
    lv.gimmicks.tunnel,
    lv.gimmicks.ice,
    lv.gimmicks.fish,
    lv.gimmicks.arrow,
    lv.gimmicks.brittle,
    lv.gimmicks.spring,
    lv.gimmicks.item,
    lv.cats,
    lv.catsGoal,
    lv.intro,
  ]);
  expect(out).toEqual(table);
  for (const lv of levels) {
    expect(lv.course).toBe(course);
    // 14.6/18.1: every rules kind carries three finite per-difficulty
    // block centers inside the 0–60 board range (16.1) — the values
    // themselves are calibration data
    for (const rules of ['basic', 'gimmick']) {
      for (const d of ['easy', 'normal', 'hard']) {
        const v = lv.blocks[rules][d];
        expect(Number.isFinite(v), `${course} L${lv.id} ${rules}/${d}`).toBe(true);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(60);
      }
    }
  }
}

/** A progress whose gimmick course is unlocked up to (and including) `n`. */
function progressUpTo(n) {
  const p = defaultProgress();
  for (let i = 0; i < n - 1; i++) p.level.gimmick.escape[i] = WIN_TARGET;
  for (let i = 0; i < n - 1; i++) p.level.gimmick.trapper[i] = WIN_TARGET;
  return p;
}

describe('level tables (14.3)', () => {
  it('escape course matches the spec row by row', () => {
    rowsMatch(ESCAPE_LEVELS, ESCAPE_TABLE, 'escape');
  });

  it('trapper course matches the spec row by row', () => {
    rowsMatch(TRAPPER_LEVELS, TRAPPER_TABLE, 'trapper');
  });

  it('every gimmick appears only at or after its unlock level (14.2)', () => {
    for (const levels of [ESCAPE_LEVELS, TRAPPER_LEVELS]) {
      for (const lv of levels) {
        for (const key of GIMMICK_KEYS) {
          if (lv.gimmicks[key] > 0) {
            expect(lv.id).toBeGreaterThanOrEqual(UNLOCKS[key]);
          }
        }
        if (lv.aiItems > 0) expect(lv.id).toBeGreaterThanOrEqual(4); // doubles/hammers
        if (lv.intro != null) {
          const unlockKey = lv.intro.replace(/cats[23](Escape|Catch)$/, 'cats');
          if (unlockKey === lv.intro) expect(lv.id).toBeGreaterThanOrEqual(UNLOCKS[lv.intro]);
        }
      }
    }
  });

  it('getLevel / getLevels', () => {
    expect(getLevels('trapper')).toBe(TRAPPER_LEVELS);
    expect(getLevels('escape')).toBe(ESCAPE_LEVELS);
    expect(getLevel('escape', 1)).toBe(ESCAPE_LEVELS[0]);
    expect(getLevel('trapper', 20)).toBe(TRAPPER_LEVELS[19]);
    // clamped into range
    expect(getLevel('escape', 0)).toBe(ESCAPE_LEVELS[0]);
    expect(getLevel('escape', 99)).toBe(ESCAPE_LEVELS[19]);
    expect(getLevel('escape', 2.7)).toBe(ESCAPE_LEVELS[1]);
  });
});

describe('highestUnlocked', () => {
  it('walks the consecutive win chain', () => {
    expect(highestUnlocked(defaultProgress(), 'gimmick', 'escape')).toBe(1);
    const p = progressUpTo(5);
    expect(highestUnlocked(p, 'gimmick', 'escape')).toBe(5);
    expect(highestUnlocked(p, 'gimmick', 'trapper')).toBe(5);
    // a gap stops the chain
    p.level.gimmick.escape[1] = 0;
    expect(highestUnlocked(p, 'gimmick', 'escape')).toBe(2);
  });
});

describe('resolveGame: streak', () => {
  it('basic + streak keeps the old settings (no blocks, no gimmick)', () => {
    for (const role of ['trapper', 'escape']) {
      for (const difficulty of ['easy', 'normal', 'hard']) {
        const r = resolveGame({ rules: 'basic', play: 'streak', role, difficulty });
        expect(r.ruleset).toBe(basicRuleset);
        expect(r.newGameOpts).toEqual({ role, ai: difficulty });
        expect('blocks' in r.newGameOpts).toBe(false);
        expect('gimmick' in r.newGameOpts).toBe(false);
      }
    }
  });

  it('gimmick + streak takes the gimmick parameters from L3/L10/L17', () => {
    const rep = { easy: 3, normal: 10, hard: 17 };
    for (const role of ['trapper', 'escape']) {
      for (const difficulty of ['easy', 'normal', 'hard']) {
        const r = resolveGame({ rules: 'gimmick', play: 'streak', role, difficulty });
        expect(r.ruleset).toBe(gimmickRuleset);
        expect(r.newGameOpts.role).toBe(role);
        expect(r.newGameOpts.ai).toBe(difficulty);
        expect('blocks' in r.newGameOpts).toBe(false); // INITIAL_BLOCKS applies
        const lv = getLevel(role, rep[difficulty]);
        expect(r.newGameOpts.gimmick).toEqual({
          gimmicks: lv.gimmicks,
          aiItems: lv.aiItems,
          cats: 1, // streak play is always one cat (L17 counts as 1, 13.7)
          catsGoal: null,
          features: levelFeatures(role, rep[difficulty]), // 14.5 (unlocked: progress null)
        });
      }
    }
  });

  it('gimmick streak keeps only gimmicks unlocked in the course (13.4)', () => {
    // unlocked up to L10: stone(2), tunnel(6), ice(8), arrow(10) stay;
    // brittle(12), spring(14), item(16) are dropped from the hard rep L17
    const progress = progressUpTo(10);
    const r = resolveGame({
      rules: 'gimmick',
      play: 'streak',
      role: 'escape',
      difficulty: 'hard',
      progress,
    });
    const g = r.newGameOpts.gimmick.gimmicks;
    expect(g.stone).toBe(0); // L17 has no stones
    expect(g.tunnel).toBe(2);
    expect(g.ice).toBe(4);
    expect(g.arrow).toBe(4);
    expect(g.brittle).toBe(0);
    expect(g.spring).toBe(0);
    expect(g.item).toBe(0);
    expect(r.newGameOpts.gimmick.aiItems).toBe(2);
  });

  it('gimmick streak uses INITIAL_BLOCKS for the block count', () => {
    const { ruleset, newGameOpts } = resolveGame({
      rules: 'gimmick',
      play: 'streak',
      role: 'trapper',
      difficulty: 'hard',
    });
    const state = ruleset.newGame({ ...newGameOpts, seed: 5 });
    const blocks = state.board.blocked.reduce((a, b) => a + b, 0);
    expect(blocks).toBe(INITIAL_BLOCKS.trapper.hard);
    expect(state.kind ?? ruleset.kind).toBe('gimmick');
    expect(state.g.kind).toBeInstanceOf(Uint8Array);
  });
});

describe('resolveGame: level', () => {
  it('basic + level uses only ai and blocks from the table', () => {
    for (const [course, table] of [['escape', ESCAPE_TABLE], ['trapper', TRAPPER_TABLE]]) {
      for (const row of table) {
        const [id, ai] = row;
        // 14.6/18.1: the basic kind's own normal-difficulty center
        const blocks = blocksFor(getLevel(course, id), 'normal', 'basic');
        const r = resolveGame({ rules: 'basic', play: 'level', role: course, course, level: id });
        expect(r.ruleset).toBe(basicRuleset);
        expect(r.newGameOpts).toEqual({ role: course, ai, blocks });
        expect('gimmick' in r.newGameOpts).toBe(false);
      }
    }
  });

  it('gimmick + level uses ai, blocks and all gimmick parameters', () => {
    for (const row of ESCAPE_TABLE) {
      const [id, ai, aiItems, stone, tunnel, ice, fish, arrow, brittle, spring, item,
        cats, catsGoal] = row;
      const r = resolveGame({ rules: 'gimmick', play: 'level', role: 'escape', level: id });
      expect(r.ruleset).toBe(gimmickRuleset);
      expect(r.newGameOpts).toEqual({
        role: 'escape',
        ai,
        blocks: blocksFor(getLevel('escape', id), 'normal', 'gimmick'),
        gimmick: {
          gimmicks: { stone, tunnel, ice, fish, arrow, brittle, spring, item },
          aiItems,
          cats,
          catsGoal,
          features: levelFeatures('escape', id), // 14.5
        },
      });
    }
  });

  it('level play resolves the block count per difficulty (14.6) and rules (18.1)', () => {
    for (const difficulty of ['easy', 'normal', 'hard']) {
      const r = resolveGame({
        rules: 'gimmick',
        play: 'level',
        role: 'trapper',
        difficulty,
        level: 10,
      });
      expect(r.newGameOpts.blocks).toBe(blocksFor(getLevel('trapper', 10), difficulty, 'gimmick'));
      // difficulty never touches the AI or the gimmicks
      expect(r.newGameOpts.ai).toBe('normal');
    }
    const basic = resolveGame({
      rules: 'basic',
      play: 'level',
      role: 'escape',
      difficulty: 'hard',
      level: 5,
    });
    expect(basic.newGameOpts.blocks).toBe(blocksFor(getLevel('escape', 5), 'hard', 'basic'));
  });

  it('each rules kind reads its own table entry (18.1)', () => {
    // calibration gives each kind its own centers; a per-kind difference
    // flows through resolveGame
    const lv = getLevel('escape', 5);
    const saved = lv.blocks.basic;
    const gimmickSaved = lv.blocks.gimmick;
    lv.blocks.basic = { easy: 1, normal: 2, hard: 3 };
    try {
      const basic = resolveGame({ rules: 'basic', play: 'level', role: 'escape', difficulty: 'hard', level: 5 });
      const gimmick = resolveGame({ rules: 'gimmick', play: 'level', role: 'escape', difficulty: 'hard', level: 5 });
      expect(basic.newGameOpts.blocks).toBe(3);
      expect(gimmick.newGameOpts.blocks).toBe(gimmickSaved.hard);
    } finally {
      lv.blocks.basic = saved;
    }
  });

  it('course defaults to the role', () => {
    const a = resolveGame({ rules: 'gimmick', play: 'level', role: 'trapper', level: 7 });
    const b = resolveGame({
      rules: 'gimmick',
      play: 'level',
      role: 'trapper',
      course: 'trapper',
      level: 7,
    });
    expect(a.newGameOpts).toEqual(b.newGameOpts);
  });
});

describe('resolveGame: carry-over item gating (14.2)', () => {
  const playerItems = { hammer: 3, double: 5 };

  it('hammers need L16, doubles need L4 in level play', () => {
    const low = resolveGame({
      rules: 'gimmick',
      play: 'level',
      role: 'escape',
      level: 15,
      playerItems,
    });
    expect(low.newGameOpts.playerItems).toEqual({ hammer: 0, double: 5 });

    const high = resolveGame({
      rules: 'gimmick',
      play: 'level',
      role: 'escape',
      level: 16,
      playerItems,
    });
    expect(high.newGameOpts.playerItems).toEqual({ hammer: 3, double: 5 });

    const trapperLow = resolveGame({
      rules: 'gimmick',
      play: 'level',
      role: 'trapper',
      level: 3,
      playerItems,
    });
    expect(trapperLow.newGameOpts.playerItems).toEqual({ hammer: 0, double: 0 });

    const trapperHigh = resolveGame({
      rules: 'gimmick',
      play: 'level',
      role: 'trapper',
      level: 4,
      playerItems,
    });
    expect(trapperHigh.newGameOpts.playerItems).toEqual({ hammer: 0, double: 5 });
  });

  it('streak play gates by the highest unlocked level', () => {
    const progress = progressUpTo(10);
    const r = resolveGame({
      rules: 'gimmick',
      play: 'streak',
      role: 'escape',
      difficulty: 'hard',
      progress,
      playerItems,
    });
    expect(r.newGameOpts.playerItems).toEqual({ hammer: 0, double: 5 });

    const unlocked = resolveGame({
      rules: 'gimmick',
      play: 'streak',
      role: 'escape',
      difficulty: 'hard',
      progress: progressUpTo(16),
      playerItems,
    });
    expect(unlocked.newGameOpts.playerItems).toEqual({ hammer: 3, double: 5 });
  });

  it('basic rules never carry player items', () => {
    const r = resolveGame({
      rules: 'basic',
      play: 'level',
      role: 'escape',
      level: 20,
      playerItems,
    });
    expect('playerItems' in r.newGameOpts).toBe(false);
  });
});

describe('resolveGame: the resolved options really start that game', () => {
  it('basic level game builds the table board', () => {
    const { ruleset, newGameOpts } = resolveGame({
      rules: 'basic',
      play: 'level',
      role: 'escape',
      level: 14, // hard AI
    });
    const state = ruleset.newGame({ ...newGameOpts, seed: 9 });
    expect(state.mode).toBe('escape');
    expect(state.difficulty).toBe('hard');
    expect(state.board.blocked.reduce((a, b) => a + b, 0)).toBe(
      blocksFor(getLevel('escape', 14), 'normal', 'basic'),
    );
    expect(state.turn).toBe('cat'); // escape: the player cat goes first
  });

  it('gimmick level game builds blocks, items and stones from the table', () => {
    const { ruleset, newGameOpts } = resolveGame({
      rules: 'gimmick',
      play: 'level',
      role: 'trapper',
      level: 18, // stone 3, item 2, aiItems 1 (14.3)
    });
    const state = ruleset.newGame({ ...newGameOpts, seed: 11 });
    expect(state.board.blocked.reduce((a, b) => a + b, 0)).toBe(
      blocksFor(getLevel('trapper', 18), 'normal', 'gimmick'),
    );
    let items = 0;
    let stones = 0;
    for (const v of state.g.kind) {
      if (v === 1) items++;
      else if (v === 2) stones++;
    }
    expect(items).toBe(2);
    expect(stones).toBe(3);
    expect(state.items.cat.hammer).toBe(1); // AI cat's hammers (trapper course)
    expect(state.items.trapper.double).toBe(0); // player starts from the inventory
    expect(state.turn).toBe('trapper'); // trapper: the player traps first
  });

  it('gimmick streak game carries the player inventory', () => {
    const { ruleset, newGameOpts } = resolveGame({
      rules: 'gimmick',
      play: 'streak',
      role: 'escape',
      difficulty: 'normal',
      playerItems: { hammer: 3, double: 6 },
    });
    const state = ruleset.newGame({ ...newGameOpts, seed: 4 });
    expect(state.items).toEqual({ cat: { hammer: 3 }, trapper: { double: 1 } }); // L10 → 1 double
    expect(state.board.blocked.reduce((a, b) => a + b, 0)).toBe(INITIAL_BLOCKS.escape.normal);
  });
});

describe('rulesets', () => {
  it('basicRuleset without blocks reproduces rules.newGame exactly', () => {
    for (const seed of [3, 12345]) {
      for (const mode of ['trapper', 'escape']) {
        for (const difficulty of ['easy', 'hard']) {
          const a = basicRuleset.newGame({ role: mode, ai: difficulty, seed });
          const b = basicNewGame({ mode, difficulty, seed });
          expect(Array.from(a.board.blocked)).toEqual(Array.from(b.board.blocked));
          expect(a.turn).toBe(b.turn);
          expect(a.mode).toBe(b.mode);
          expect(a.difficulty).toBe(b.difficulty);
          expect(a.seed).toBe(b.seed);
          expect(a.history).toEqual(b.history);
        }
      }
    }
  });

  it('basicRuleset honors the blocks override', () => {
    const state = basicRuleset.newGame({ role: 'trapper', ai: 'easy', blocks: 4, seed: 21 });
    expect(state.board.blocked.reduce((a, b) => a + b, 0)).toBe(4);
    expect(state.mode).toBe('trapper');
    expect(state.history).toEqual([]);
    expect(legalBlocks(state).length).toBe(121 - 4 - 1);
    // invalid role/ai still throws, like rules.js
    expect(() => basicRuleset.newGame({ role: 'nope', ai: 'easy', seed: 1 })).toThrow();
    expect(() => basicRuleset.newGame({ role: 'trapper', ai: 'nope', seed: 1 })).toThrow();
  });

  it('the basic ruleset has no items at all', () => {
    expect(basicRuleset.kind).toBe('basic');
    expect(gimmickRuleset.kind).toBe('gimmick');
    expect(basicRuleset.canUseItem).toBeInstanceOf(Function);
    const state = basicRuleset.newGame({ role: 'trapper', ai: 'easy', seed: 1 });
    expect(basicRuleset.canUseItem(state, 'trapper')).toBe(false);
    expect(basicRuleset.shouldUseItem(state, mulberry32(1))).toBe(false);
    expect(() => basicRuleset.armItem(state)).not.toThrow();
    expect(() => basicRuleset.disarmItem(state)).not.toThrow();
    expect(state.armed).toBeUndefined();
  });

  it('the gimmick ruleset exposes item use on a fresh game', () => {
    const state = gimmickRuleset.newGame({
      role: 'trapper',
      ai: 'normal',
      blocks: 7,
      playerItems: { hammer: 0, double: 2 },
      seed: 2,
    });
    expect(gimmickRuleset.canUseItem(state, 'trapper')).toBe(true);
    expect(gimmickRuleset.canUseItem(state, 'cat')).toBe(false);
    gimmickRuleset.armItem(state);
    expect(state.armed).toBe(true);
    expect(state.items.trapper.double).toBe(1);
    gimmickRuleset.disarmItem(state);
    expect(state.armed).toBe(false);
  });
});
