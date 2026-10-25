import { describe, it, expect } from 'vitest';
import {
  defaultProgress,
  loadProgress,
  saveProgress,
  resetProgress,
  isUnlocked,
  recordResult,
  hasSeenIntro,
  recordIntroSeen,
  PROGRESS_KEY,
  WIN_TARGET,
  ITEM_CAP,
} from '../src/game/play/progress.js';

function memStorage(init = {}) {
  const m = new Map(Object.entries(init));
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => {
      m.set(k, String(v));
    },
    removeItem: (k) => {
      m.delete(k);
    },
    _raw: m,
  };
}

describe('progress: load / save', () => {
  it('returns the defaults when nothing is stored', () => {
    const p = loadProgress(memStorage());
    expect(p).toEqual(defaultProgress());
    expect(p.level.basic.trapper).toEqual(new Array(20).fill(0));
    expect(p.inventory).toEqual({ hammer: 0, double: 0 });
    expect(p.streak).toEqual({});
  });

  it('round trips a modified progress', () => {
    const storage = memStorage();
    const p = defaultProgress();
    p.level.gimmick.escape[6] = 3;
    p.level.basic.trapper[0] = 2;
    p.streak['gimmick.escape.hard'] = { current: 4, best: 7 };
    p.inventory = { hammer: 5, double: 2 };
    saveProgress(storage, p);
    expect(loadProgress(storage)).toEqual(p);
  });

  it('resetProgress writes the defaults', () => {
    const storage = memStorage();
    saveProgress(storage, { version: 1, inventory: { hammer: 9, double: 9 } });
    const p = resetProgress(storage);
    expect(p).toEqual(defaultProgress());
    expect(loadProgress(storage)).toEqual(defaultProgress());
  });

  it('a stored value with the wrong shape becomes the defaults', () => {
    expect(loadProgress(memStorage({ [PROGRESS_KEY]: 'not json {' }))).toEqual(defaultProgress());
    expect(loadProgress(memStorage({ [PROGRESS_KEY]: '{"version":2}' }))).toEqual(defaultProgress());
    expect(loadProgress(memStorage({ [PROGRESS_KEY]: '"a string"' }))).toEqual(defaultProgress());
    expect(
      loadProgress(
        memStorage({ [PROGRESS_KEY]: '{"version":1,"level":"nope","streak":[1],"inventory":7}' }),
      ),
    ).toEqual(defaultProgress());
  });

  it('salvages the good fields and clamps the bad ones', () => {
    const raw = JSON.stringify({
      version: 1,
      level: { basic: { trapper: [1, 2, 'x', -5, 4] } },
      streak: { 'weird.key': { current: 1 }, 'basic.trapper.easy': { current: -3, best: '9' } },
      inventory: { hammer: 99, double: '2' },
    });
    const p = loadProgress(memStorage({ [PROGRESS_KEY]: raw }));
    expect(p.level.basic.trapper.slice(0, 5)).toEqual([1, 2, 0, 0, WIN_TARGET]);
    expect(p.level.basic.trapper.length).toBe(20);
    expect(p.level.gimmick.trapper).toEqual(new Array(20).fill(0));
    expect(p.streak).toEqual({ 'basic.trapper.easy': { current: 0, best: 9 } });
    expect(p.inventory).toEqual({ hammer: ITEM_CAP, double: 2 });
  });

  it('never throws on a hostile storage', () => {
    const boom = {
      getItem() {
        throw new Error('nope');
      },
      setItem() {
        throw new Error('nope');
      },
    };
    expect(loadProgress(boom)).toEqual(defaultProgress());
    expect(() => saveProgress(boom, defaultProgress())).not.toThrow();
    expect(resetProgress(boom)).toEqual(defaultProgress());
  });
});

describe('isUnlocked', () => {
  it('level 1 is always open, level 2 needs 3 wins', () => {
    const p = defaultProgress();
    expect(isUnlocked(p, 'basic', 'trapper', 1)).toBe(true);
    expect(isUnlocked(p, 'basic', 'trapper', 2)).toBe(false);
    p.level.basic.trapper[0] = 2;
    expect(isUnlocked(p, 'basic', 'trapper', 2)).toBe(false);
    p.level.basic.trapper[0] = WIN_TARGET;
    expect(isUnlocked(p, 'basic', 'trapper', 2)).toBe(true);
    expect(isUnlocked(p, 'basic', 'trapper', 3)).toBe(false);
  });

  it('progress is separate per rules and course', () => {
    const p = defaultProgress();
    p.level.basic.trapper[0] = 3;
    expect(isUnlocked(p, 'basic', 'trapper', 2)).toBe(true);
    expect(isUnlocked(p, 'basic', 'escape', 2)).toBe(false);
    expect(isUnlocked(p, 'gimmick', 'trapper', 2)).toBe(false);
  });
});

describe('recordResult: level play', () => {
  const ctx = { rules: 'basic', play: 'level', role: 'trapper', course: 'trapper', level: 1 };

  it('counts up to 3 wins, then stops', () => {
    let p = defaultProgress();
    let last;
    for (let t = 0; t < 5; t++) {
      last = recordResult(p, ctx, 'trapperWin');
      p = last.progress;
      expect(p.level.basic.trapper[0]).toBe(Math.min(t + 1, WIN_TARGET));
    }
    expect(last.unlockedNext).toBe(true);
  });

  it('a loss changes nothing and unlocks nothing', () => {
    const p = defaultProgress();
    const r = recordResult(p, ctx, 'catWin');
    expect(r.progress.level.basic.trapper[0]).toBe(0);
    expect(r.unlockedNext).toBe(false);
    expect(r.streak).toBeNull();
    expect(r.rewards).toEqual({ hammer: 0, double: 0 });
  });

  it('unlockedNext becomes true exactly when the next level opens', () => {
    let p = defaultProgress();
    p.level.basic.trapper[0] = 2;
    const r1 = recordResult(p, ctx, 'trapperWin');
    expect(r1.progress.level.basic.trapper[0]).toBe(3);
    expect(r1.unlockedNext).toBe(true);
    expect(isUnlocked(r1.progress, 'basic', 'trapper', 2)).toBe(true);
    // the 20th level has no successor
    const p20 = defaultProgress();
    p20.level.basic.trapper[18] = 3;
    const r20 = recordResult(p20, { ...ctx, level: 20 }, 'trapperWin');
    expect(r20.unlockedNext).toBe(false);
  });

  it('is pure: the input progress is never mutated', () => {
    const p = defaultProgress();
    const before = JSON.stringify(p);
    const r = recordResult(p, ctx, 'trapperWin');
    expect(JSON.stringify(p)).toBe(before);
    expect(r.progress).not.toBe(p);
    expect(r.progress.level).not.toBe(p.level);
    expect(r.progress.level.basic.trapper).not.toBe(p.level.basic.trapper);
  });
});

describe('recordResult: streak play', () => {
  const ctx = { rules: 'basic', play: 'streak', role: 'escape', difficulty: 'easy' };

  it('a win grows current and best, a loss resets current only', () => {
    let p = defaultProgress();
    let r = recordResult(p, ctx, 'catWin');
    expect(r.streak).toEqual({ current: 1, best: 1 });
    p = r.progress;
    r = recordResult(p, ctx, 'catWin');
    expect(r.streak).toEqual({ current: 2, best: 2 });
    p = r.progress;
    r = recordResult(p, ctx, 'trapperWin'); // escape role: catWin is the win
    expect(r.streak).toEqual({ current: 0, best: 2 });
    p = r.progress;
    r = recordResult(p, ctx, 'catWin');
    expect(r.streak).toEqual({ current: 1, best: 2 });
    expect(r.unlockedNext).toBe(false);
    expect(r.progress.level.basic.escape).toEqual(new Array(20).fill(0));
  });

  it('keeps a separate streak per rules/role/difficulty', () => {
    let p = defaultProgress();
    p = recordResult(p, ctx, 'catWin').progress;
    p = recordResult(p, ctx, 'catWin').progress;
    p = recordResult(p, { ...ctx, difficulty: 'hard' }, 'catWin').progress;
    p = recordResult(p, { ...ctx, rules: 'gimmick' }, 'catWin').progress;
    expect(p.streak['basic.escape.easy']).toEqual({ current: 2, best: 2 });
    expect(p.streak['basic.escape.hard']).toEqual({ current: 1, best: 1 });
    expect(p.streak['gimmick.escape.easy']).toEqual({ current: 1, best: 1 });
  });
});

describe('recordResult: inventory', () => {
  it('basic rules never touch the inventory', () => {
    const p = defaultProgress();
    p.inventory = { hammer: 3, double: 4 };
    const r = recordResult(
      p,
      {
        rules: 'basic',
        play: 'streak',
        role: 'trapper',
        difficulty: 'normal',
        items: { trapper: { double: 9 }, cat: { hammer: 9 } },
      },
      'trapperWin',
    );
    expect(r.progress.inventory).toEqual({ hammer: 3, double: 4 });
    expect(r.rewards).toEqual({ hammer: 0, double: 0 });
  });

  it('gimmick level play: write back the player side, +1 on a counted win', () => {
    const p = defaultProgress();
    p.inventory = { hammer: 7, double: 4 };
    const ctx = {
      rules: 'gimmick',
      play: 'level',
      role: 'trapper',
      course: 'trapper',
      level: 5,
      items: { trapper: { double: 2 }, cat: { hammer: 6 } },
    };
    // a loss writes the player's doubles back and keeps the hammers alone
    const loss = recordResult(p, ctx, 'catWin');
    expect(loss.progress.inventory).toEqual({ hammer: 7, double: 2 });
    expect(loss.rewards).toEqual({ hammer: 0, double: 0 });
    expect(loss.progress.level.gimmick.trapper[4]).toBe(0);

    // a win writes back 2 and adds the role's item (+1 double)
    const win = recordResult(p, ctx, 'trapperWin');
    expect(win.progress.inventory).toEqual({ hammer: 7, double: 3 });
    expect(win.rewards).toEqual({ hammer: 0, double: 1 });
    expect(win.progress.level.gimmick.trapper[4]).toBe(1);
  });

  it('gimmick level play: no item reward once the level has 3 wins', () => {
    const p = defaultProgress();
    p.level.gimmick.trapper[4] = WIN_TARGET;
    const ctx = {
      rules: 'gimmick',
      play: 'level',
      role: 'trapper',
      course: 'trapper',
      level: 5,
      items: { trapper: { double: 2 }, cat: { hammer: 0 } },
    };
    const r = recordResult(p, ctx, 'trapperWin');
    expect(r.progress.level.gimmick.trapper[4]).toBe(WIN_TARGET); // no increment
    expect(r.rewards).toEqual({ hammer: 0, double: 0 });
    expect(r.progress.inventory.double).toBe(2); // write-back only
  });

  it('gimmick streak play: every 3rd consecutive win grants the item', () => {
    const ctx = {
      rules: 'gimmick',
      play: 'streak',
      role: 'escape',
      difficulty: 'normal',
      items: { cat: { hammer: 5 }, trapper: { double: 0 } },
    };
    let p = defaultProgress();
    p.inventory.hammer = 5;
    const rewards = [];
    for (let t = 0; t < 4; t++) {
      // the next game starts from the saved inventory, as main.js wires it
      ctx.items = { cat: { hammer: p.inventory.hammer }, trapper: { double: 0 } };
      const r = recordResult(p, ctx, 'catWin');
      p = r.progress;
      rewards.push(r.rewards.hammer);
    }
    expect(rewards).toEqual([0, 0, 1, 0]);
    expect(p.inventory.hammer).toBe(6); // 5 carried through + one reward
    expect(p.inventory.double).toBe(0); // untouched
  });

  it('caps both items at 9', () => {
    const p = defaultProgress();
    p.inventory.hammer = ITEM_CAP;
    const ctx = {
      rules: 'gimmick',
      play: 'level',
      role: 'escape',
      course: 'escape',
      level: 1,
      items: { cat: { hammer: ITEM_CAP }, trapper: { double: 0 } },
    };
    const r = recordResult(p, ctx, 'catWin');
    expect(r.progress.inventory.hammer).toBe(ITEM_CAP);
    expect(r.rewards).toEqual({ hammer: 0, double: 0 }); // capped: nothing gained
  });

  it('handles a corrupted input progress', () => {
    const r = recordResult(
      /** @type {any} */ ({ version: 99, level: 'bad' }),
      { rules: 'gimmick', play: 'streak', role: 'trapper', difficulty: 'easy' },
      'trapperWin',
    );
    expect(r.progress.version).toBe(1);
    expect(r.streak).toEqual({ current: 1, best: 1 });
  });
});

describe('seenIntro (13.4)', () => {
  it('starts empty and is part of the defaults', () => {
    expect(defaultProgress().seenIntro).toEqual([]);
    expect(loadProgress(memStorage()).seenIntro).toEqual([]);
  });

  it('recordIntroSeen is pure and dedupes', () => {
    const p = defaultProgress();
    const p1 = recordIntroSeen(p, 'stone');
    expect(p.seenIntro).toEqual([]); // input untouched
    expect(p1.seenIntro).toEqual(['stone']);
    const p2 = recordIntroSeen(p1, 'stone');
    expect(p2.seenIntro).toEqual(['stone']);
    const p3 = recordIntroSeen(p2, 'ice');
    expect(p3.seenIntro).toEqual(['stone', 'ice']);
    expect(hasSeenIntro(p3, 'ice')).toBe(true);
    expect(hasSeenIntro(p3, 'spring')).toBe(false);
  });

  it('round trips through storage and sanitizes bad values', () => {
    const storage = memStorage();
    const p = recordIntroSeen(defaultProgress(), 'tunnel');
    saveProgress(storage, p);
    expect(loadProgress(storage).seenIntro).toEqual(['tunnel']);

    const raw = JSON.stringify({
      version: 1,
      seenIntro: ['a', 5, 'a', '', 'b'],
    });
    expect(loadProgress(memStorage({ [PROGRESS_KEY]: raw })).seenIntro).toEqual(['a', 'b']);
  });

  it('recordResult keeps seenIntro', () => {
    const p = recordIntroSeen(defaultProgress(), 'stone');
    const r = recordResult(
      p,
      { rules: 'gimmick', play: 'streak', role: 'escape', difficulty: 'easy' },
      'catWin',
    );
    expect(r.progress.seenIntro).toEqual(['stone']);
  });
});
