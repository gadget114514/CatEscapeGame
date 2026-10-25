import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { STRINGS, detectStrings, detectLang, fmt } from '../src/ui/strings.js';
import { loadSettings, saveSettings, createHud } from '../src/ui/hud.js';
import { getLevel } from '../src/game/play/levels.js';
import { levelRange } from '../src/game/play/blocks.js';

/* ------------------------------------------------------------------ strings */

describe('strings', () => {
  it('ja and en define exactly the same keys', () => {
    const ja = Object.keys(STRINGS.ja).sort();
    const en = Object.keys(STRINGS.en).sort();
    expect(ja).toEqual(en);
    // sanity: a meaningful table
    expect(ja.length).toBeGreaterThan(45);
  });

  it('carries every Rev. 4 label from the spec (ja)', () => {
    const required = {
      rules: 'ルール',
      rulesBasic: '基本',
      rulesGimmick: 'ギミック',
      playStyle: 'プレイスタイル',
      playStreak: '連勝',
      playLevel: 'レベル攻略',
      camera: 'カメラ',
      cameraOrtho: '真上',
      route: 'ルートを表示',
      levelsSelect: 'レベル選択',
      newGameLevel: 'やりなおし',
      nextLevel: '次のレベル',
      levelsBtn: 'レベル選択',
      tabEscape: 'にげる',
      tabTrap: 'つかまえる',
      headingBasic: '基本ルール',
      headingGimmick: 'ギミックルール',
      close: 'とじる',
      itemHammer: 'ハンマー',
      itemDouble: 'ダブル',
      streakLine: '連勝 {current}（最高 {best}）',
      winCount: '勝ち {n}/3',
      toastAiDouble: 'AIがダブルを使った！',
      toastAiHammer: 'AIがハンマーを使った！',
      toastPickup: 'ハンマーを手に入れた！',
      useHammer: 'ハンマーを使う ({n})',
      useDouble: 'ダブルを使う ({n})',
      inventory: 'ハンマー ×{hammer}　ダブル ×{double}',
    };
    for (const [key, value] of Object.entries(required)) {
      expect(STRINGS.ja[key], key).toBe(value);
    }
  });

  it('fmt fills placeholders and leaves unknown ones alone', () => {
    expect(fmt('勝ち {n}/3', { n: 2 })).toBe('勝ち 2/3');
    expect(fmt('連勝 {current}（最高 {best}）', { current: 3, best: 5 })).toBe(
      '連勝 3（最高 5）',
    );
    expect(fmt('no {missing} vars', { other: 1 })).toBe('no {missing} vars');
    expect(fmt('plain')).toBe('plain');
  });

  it('detectStrings picks the table of a supported language', () => {
    expect(detectStrings('en')).toBe(STRINGS.en);
    expect(detectStrings('en-US')).toBe(STRINGS.en);
    expect(detectStrings('ja')).toBe(STRINGS.ja);
    expect(detectStrings('de')).toBe(STRINGS.de); // 13.9: six languages
    expect(detectStrings('pt-BR')).toBe(STRINGS.ja); // unsupported → ja
    expect(detectStrings()).toBe(STRINGS.ja);
  });
});

/* ---------------------------------------------------------------- settings */

function stubStorage(initial = {}) {
  const m = new Map(Object.entries(initial));
  globalThis.localStorage = {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => {
      m.set(k, String(v));
    },
    removeItem: (k) => {
      m.delete(k);
    },
  };
  return m;
}

describe('settings persistence', () => {
  afterEach(() => {
    delete globalThis.localStorage;
  });

  /** The machine's default language (navigator first, else ja, 13.9). */
  const defaultLang = detectLang(typeof navigator !== 'undefined' ? navigator.language : 'ja');
  /** Rev. 6: the device-appropriate default of the 演出 select (17.1). */
  const defaultFx =
    typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0 ? 'medium' : 'high';

  it('falls back to the defaults without stored data', () => {
    stubStorage();
    expect(loadSettings()).toEqual({
      rules: 'basic',
      play: 'streak',
      role: 'trapper',
      difficulty: 'normal',
      course: 'trapper',
      level: 1,
      lang: defaultLang,
      fx: defaultFx,
    });
  });

  it('round trips every field and nothing else', () => {
    stubStorage();
    const settings = {
      rules: 'gimmick',
      play: 'level',
      role: 'escape',
      difficulty: 'hard',
      course: 'escape',
      level: 7,
      lang: 'en',
      fx: 'low',
    };
    saveSettings(settings);
    expect(loadSettings()).toEqual(settings);
    const raw = globalThis.localStorage.getItem('catescape.settings');
    expect(Object.keys(JSON.parse(raw)).sort()).toEqual([
      'course',
      'difficulty',
      'fx',
      'lang',
      'level',
      'play',
      'role',
      'rules',
    ]);
  });

  it('drops the legacy hint setting and migrates mode → role', () => {
    stubStorage({
      'catescape.settings': JSON.stringify({
        mode: 'escape',
        difficulty: 'hard',
        hint: true,
      }),
    });
    const s = loadSettings();
    expect(s.role).toBe('escape');
    expect(s.course).toBe('escape'); // follows the migrated role
    expect(s.difficulty).toBe('hard');
    expect(s.rules).toBe('basic');
    expect(s.play).toBe('streak');
    expect(s.lang).toBe(defaultLang);
    expect('hint' in s).toBe(false); // the checkbox and its setting are gone
    // …and the next save writes the new shape without hint/mode
    saveSettings(s);
    const saved = JSON.parse(globalThis.localStorage.getItem('catescape.settings'));
    expect('hint' in saved).toBe(false);
    expect('mode' in saved).toBe(false);
  });

  it('bad values become the defaults', () => {
    stubStorage({
      'catescape.settings': JSON.stringify({
        rules: 'weird',
        play: 42,
        role: 'nobody',
        difficulty: 'x',
        course: 'nope',
        level: 99,
        lang: 'xx',
      }),
    });
    expect(loadSettings()).toEqual({
      rules: 'basic',
      play: 'streak',
      role: 'trapper',
      difficulty: 'normal',
      course: 'trapper',
      level: 1,
      lang: defaultLang,
      fx: defaultFx,
    });
    stubStorage({ 'catescape.settings': 'not json {' });
    expect(loadSettings().rules).toBe('basic');
  });
});

/* --------------------------------------------------------------- HUD (Rev4) */

const IDS = [
  'rules-label',
  'rules-select',
  'play-label',
  'play-select',
  'mode-label',
  'mode-select',
  'diff-label',
  'difficulty-select',
  'difficulty-control',
  'blocks-control',
  'blocks-label',
  'blocks-slider',
  'blocks-value',
  'camera-label',
  'camera-select',
  'lang-control',
  'lang-label',
  'lang-select',
  'level-select-btn',
  'level-label',
  'new-game-btn',
  'route-btn',
  'menu-btn',
  'debug-toggle',
  'debug-bar',
  'status-line',
  'item-bar',
  'item-btn',
  'ai-items',
  'power-bar',
  'power-gauge',
  'dash-btn',
  'jump-btn',
  'stop-dash-btn',
  'toast-area',
  'result-modal',
  'result-text',
  'result-moves',
  'result-streak',
  'result-progress',
  'result-rewards',
  'play-again-btn',
  'result-levels-btn',
  'next-level-btn',
  'result-menu-btn',
];

function makeEl(tag = 'div') {
  const el = {
    tagName: String(tag).toUpperCase(),
    textContent: '',
    value: '',
    checked: false,
    hidden: false,
    disabled: false,
    className: '',
    title: '',
    children: [],
    parentNode: null,
    attributes: {},
    classes: new Set(),
    get classList() {
      const self = this;
      return {
        add(c) {
          self.classes.add(c);
        },
        remove(c) {
          self.classes.delete(c);
        },
        contains(c) {
          return self.classes.has(c);
        },
        toggle(c, force) {
          const on = force === undefined ? !self.classes.has(c) : !!force;
          if (on) self.classes.add(c);
          else self.classes.delete(c);
          return on;
        },
      };
    },
    setAttribute(k, v) {
      this.attributes[k] = String(v);
    },
    getAttribute(k) {
      return k in this.attributes ? this.attributes[k] : null;
    },
    appendChild(child) {
      this.children.push(child);
      child.parentNode = this;
      return child;
    },
    removeChild(child) {
      const i = this.children.indexOf(child);
      if (i >= 0) this.children.splice(i, 1);
      child.parentNode = null;
      return child;
    },
    addEventListener: vi.fn(),
    querySelector() {
      return { textContent: '' };
    },
    getBoundingClientRect() {
      return { height: 0, width: 0 };
    },
  };
  return el;
}

function stubDocument() {
  const byId = {};
  for (const id of IDS) byId[id] = makeEl();
  globalThis.document = {
    title: '',
    body: makeEl('body'),
    getElementById(id) {
      return byId[id] || null;
    },
    createElement(tag) {
      return makeEl(tag);
    },
  };
  return byId;
}

function progressWith({ streakKey, winsRules, winsCourse, wins, winsLevel = 1, inventory } = {}) {
  const zero = () => new Array(20).fill(0);
  const p = {
    version: 1,
    level: {
      basic: { trapper: zero(), escape: zero() },
      gimmick: { trapper: zero(), escape: zero() },
    },
    streak: {},
    inventory: inventory || { hammer: 0, double: 0 },
  };
  if (streakKey) p.streak[streakKey] = { current: 3, best: 5 };
  if (winsRules) p.level[winsRules][winsCourse][winsLevel - 1] = wins;
  return p;
}

function setupHud({ strings = STRINGS.ja, state, settings, progress, controller: ctrl } = {}) {
  stubStorage(settings ? { 'catescape.settings': JSON.stringify(settings) } : {});
  const byId = stubDocument();
  const hud = createHud({ strings });
  const controller = ctrl || { state, start: vi.fn(), showHint: vi.fn(), useItem: vi.fn() };
  if (state) controller.state = state;
  const levelSelect = { open: vi.fn(), isOpen: () => false };
  const onStart = vi.fn();
  const onCameraMode = vi.fn();
  const onMenu = vi.fn();
  hud.attach({ controller, levelSelect, getProgress: () => progress, onStart, onCameraMode, onMenu });
  return { hud, byId, controller, levelSelect, onStart, onCameraMode, onMenu };
}

describe('hud: status line and top bar (Rev. 4)', () => {
  afterEach(() => {
    delete globalThis.document;
    delete globalThis.localStorage;
  });

  it('shows the streak line in streak play', () => {
    const { hud, byId } = setupHud({
      state: { mode: 'trapper', moveCount: 4 },
      progress: progressWith({ streakKey: 'basic.trapper.normal' }),
    });
    hud.setSeed(99);
    hud.setTurn('trapper', true);
    expect(byId['status-line'].textContent).toContain('シード 99');
    expect(byId['status-line'].textContent).toContain('連勝 3（最高 5）');
    // level play: no streak line
    const lv = setupHud({
      settings: { rules: 'basic', play: 'level', role: 'trapper', difficulty: 'normal', course: 'trapper', level: 2 },
      state: { mode: 'trapper', moveCount: 1 },
      progress: progressWith(),
    });
    lv.hud.setTurn('trapper', true);
    expect(lv.byId['status-line'].textContent).not.toContain('連勝');
  });

  it('level play: L-label with dots, difficulty select visible, retry button', () => {
    const { hud, byId } = setupHud({
      settings: {
        rules: 'gimmick',
        play: 'level',
        role: 'escape',
        difficulty: 'hard',
        course: 'escape',
        level: 7,
        lang: 'ja',
      },
      state: { mode: 'escape', moveCount: 0 },
      progress: progressWith({
        winsRules: 'gimmick',
        winsCourse: 'escape',
        wins: 2,
        winsLevel: 7,
      }),
    });
    hud.setTurn('cat', true);
    expect(byId['level-label'].hidden).toBe(false);
    expect(byId['level-label'].textContent).toBe('L7 ●●○');
    // 14.6: level play gets the same difficulty select as streak play
    expect(byId['difficulty-control'].hidden).toBe(false);
    expect(byId['level-select-btn'].hidden).toBe(false);
    expect(byId['new-game-btn'].textContent).toBe('やりなおし');
    expect(byId['route-btn'].disabled).toBe(false); // player turn
  });

  it('streak play: the difficulty control is visible, L-label hidden', () => {
    const { byId } = setupHud({ state: { mode: 'trapper', moveCount: 0 } });
    expect(byId['difficulty-control'].hidden).toBe(false);
    expect(byId['level-label'].hidden).toBe(true);
    expect(byId['level-select-btn'].hidden).toBe(true);
    expect(byId['new-game-btn'].textContent).toBe('あたらしいゲーム');
  });

  it('route button follows the turn and the result', () => {
    const { hud, byId } = setupHud({ state: { mode: 'trapper', moveCount: 0 } });
    hud.setTurn('trapper', false);
    expect(byId['route-btn'].disabled).toBe(true);
    hud.setTurn('trapper', true);
    expect(byId['route-btn'].disabled).toBe(false);
    hud.showResult('trapperWin', 6);
    expect(byId['route-btn'].disabled).toBe(true);
  });

  it('select changes start a new game; the camera does not', () => {
    const { byId, onStart, onCameraMode, levelSelect } = setupHud({});
    const change = (el) => el.addEventListener.mock.calls[0][1];
    change(byId['rules-select'])();
    expect(onStart).toHaveBeenCalledTimes(1);
    byId['play-select'].value = 'level';
    change(byId['play-select'])();
    expect(onStart).toHaveBeenCalledTimes(2);
    expect(levelSelect.open).toHaveBeenCalledTimes(1); // switches to level play
    change(byId['mode-select'])();
    expect(onStart).toHaveBeenCalledTimes(3);
    change(byId['difficulty-select'])();
    expect(onStart).toHaveBeenCalledTimes(4);
    change(byId['camera-select'])();
    expect(onStart).toHaveBeenCalledTimes(4); // camera never restarts
    expect(onCameraMode).toHaveBeenCalledWith('perspective');
  });

  it('camera select reports ortho mode', () => {
    const { byId, onCameraMode } = setupHud({});
    byId['camera-select'].value = 'ortho';
    byId['camera-select'].addEventListener.mock.calls[0][1]();
    expect(onCameraMode).toHaveBeenCalledWith('ortho');
  });
});

/* ------------------------------------------- HUD play-flow lock (Rev. 9) */

describe('hud: play-flow lock and debug bar (Rev. 9)', () => {
  afterEach(() => {
    delete globalThis.document;
    delete globalThis.localStorage;
  });

  it('the debug bar starts hidden and the toggle opens it', () => {
    const { byId } = setupHud({ state: { mode: 'trapper', moveCount: 0 } });
    expect(byId['debug-bar'].hidden).toBe(true);
    expect(byId['debug-toggle'].getAttribute('aria-expanded')).toBe('false');
    const toggle = byId['debug-toggle'].addEventListener.mock.calls[0][1];
    toggle();
    expect(byId['debug-bar'].hidden).toBe(false);
    expect(byId['debug-toggle'].getAttribute('aria-expanded')).toBe('true');
    toggle();
    expect(byId['debug-bar'].hidden).toBe(true);
  });

  it('the menu button calls onMenu; the result menu button too', () => {
    const { hud, byId, onMenu } = setupHud({ state: { mode: 'trapper', moveCount: 0 } });
    byId['menu-btn'].addEventListener.mock.calls[0][1]();
    expect(onMenu).toHaveBeenCalledTimes(1);
    hud.showResult('trapperWin', 5);
    byId['result-menu-btn'].addEventListener.mock.calls[0][1]();
    expect(onMenu).toHaveBeenCalledTimes(2);
    expect(byId['result-modal'].classList.contains('visible')).toBe(false);
  });

  it('applySettings updates the live settings and persists them', () => {
    const { hud, byId } = setupHud({ state: { mode: 'trapper', moveCount: 0 } });
    hud.applySettings({
      rules: 'gimmick',
      play: 'level',
      role: 'escape',
      difficulty: 'hard',
      level: 7,
    });
    const s = hud.getSettings();
    expect(s.rules).toBe('gimmick');
    expect(s.play).toBe('level');
    expect(s.role).toBe('escape');
    expect(s.course).toBe('escape'); // course follows role
    expect(s.difficulty).toBe('hard');
    expect(s.level).toBe(7);
    expect(byId['rules-select'].value).toBe('gimmick');
    expect(byId['mode-select'].value).toBe('escape');
    expect(byId['difficulty-select'].value).toBe('hard');
    const saved = JSON.parse(globalThis.localStorage.getItem('catescape.settings'));
    expect(saved.rules).toBe('gimmick');
    expect(saved.level).toBe(7);
  });

  it('applySettings ignores unknown values', () => {
    const { hud } = setupHud({
      state: { mode: 'trapper', moveCount: 0 },
      settings: { rules: 'basic', play: 'streak', role: 'trapper', difficulty: 'normal', level: 3 },
    });
    hud.applySettings({ rules: 'weird', difficulty: 'impossible', level: 99, play: 'level' });
    const s = hud.getSettings();
    expect(s.rules).toBe('basic');
    expect(s.difficulty).toBe('normal');
    expect(s.level).toBe(3);
    expect(s.play).toBe('level'); // valid values still apply
  });
});

describe('hud: item bar and toasts', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    delete globalThis.document;
    delete globalThis.localStorage;
  });

  const catState = () => ({
    mode: 'escape',
    moveCount: 2,
    items: { cat: { hammer: 2 }, trapper: { double: 1 } },
  });

  it('renders the player item, the AI count and aria-pressed', () => {
    const { hud, byId } = setupHud({ state: catState() });
    hud.setInventory(catState().items, 'cat', true);
    hud.setTurn('cat', true);
    expect(byId['item-bar'].hidden).toBe(false);
    expect(byId['item-btn'].textContent).toBe('ハンマーを使う (2)');
    expect(byId['item-btn'].getAttribute('aria-pressed')).toBe('true');
    expect(byId['item-btn'].disabled).toBe(false);
    expect(byId['ai-items'].textContent).toBe('AI ダブル ×1');

    hud.setInventory(catState().items, 'cat', false);
    expect(byId['item-btn'].getAttribute('aria-pressed')).toBe('false');
    hud.setTurn('cat', false); // AI turn
    expect(byId['item-btn'].disabled).toBe(true);

    hud.setInventory({ cat: { hammer: 0 }, trapper: { double: 1 } }, 'cat', false);
    expect(byId['item-btn'].disabled).toBe(true); // count 0
  });

  it('the trapper player sees the double button and the AI hammers', () => {
    const state = { mode: 'trapper', moveCount: 1, items: { trapper: { double: 3 }, cat: { hammer: 4 } } };
    const { hud, byId } = setupHud({ state });
    hud.setInventory(state.items, 'trapper', false);
    hud.setTurn('trapper', true);
    expect(byId['item-btn'].textContent).toBe('ダブルを使う (3)');
    expect(byId['ai-items'].textContent).toBe('AI ハンマー ×4');
  });

  it('hides the item bar for basic rules', () => {
    const { hud, byId } = setupHud({ state: { mode: 'trapper', moveCount: 0 } });
    hud.setSeed(1);
    expect(byId['item-bar'].hidden).toBe(true);
    hud.setTurn('trapper', true);
    expect(byId['item-bar'].hidden).toBe(true);
  });

  it('toasts fire for notify keys and auto-hide after 1.5 s', () => {
    const { hud, byId } = setupHud({});
    hud.notify('aiDouble');
    expect(byId['toast-area'].children.length).toBe(1);
    expect(byId['toast-area'].children[0].textContent).toBe('AIがダブルを使った！');
    hud.notify('pickup');
    expect(byId['toast-area'].children.length).toBe(2);
    // player arm/disarm keys are silent (the button shows aria-pressed instead)
    hud.notify('doubleArmed');
    hud.notify('hammerArmed');
    expect(byId['toast-area'].children.length).toBe(2);

    vi.advanceTimersByTime(1500);
    expect(byId['toast-area'].children.length).toBe(0);
  });
});

describe('hud: result modal extras', () => {
  afterEach(() => {
    delete globalThis.document;
    delete globalThis.localStorage;
  });

  it('streak play shows the streak line from showResultInfo', () => {
    const { hud, byId } = setupHud({ state: { mode: 'trapper', moveCount: 3 } });
    hud.showResult('trapperWin', 3);
    expect(byId['result-streak'].hidden).toBe(true); // not yet
    hud.showResultInfo({
      play: 'streak',
      streak: { current: 4, best: 6 },
      rewards: { hammer: 0, double: 0 },
      unlockedNext: false,
      wins: 0,
    });
    expect(byId['result-streak'].hidden).toBe(false);
    expect(byId['result-streak'].textContent).toBe('連勝 4（最高 6）');
    expect(byId['result-progress'].hidden).toBe(true);
    expect(byId['result-levels-btn'].hidden).toBe(true);
    expect(byId['next-level-btn'].hidden).toBe(true);
  });

  it('level play shows 勝ち n/3, rewards and the level buttons', () => {
    const { hud, byId } = setupHud({
      settings: {
        rules: 'gimmick',
        play: 'level',
        role: 'escape',
        difficulty: 'normal',
        course: 'escape',
        level: 6,
      },
      state: { mode: 'escape', moveCount: 8 },
    });
    hud.showResult('catWin', 8);
    expect(byId['result-text'].textContent).toBe(STRINGS.ja.catWinEscape);
    expect(byId['result-progress'].hidden).toBe(false);
    expect(byId['result-levels-btn'].hidden).toBe(false);
    expect(byId['next-level-btn'].hidden).toBe(true); // not until info arrives
    hud.showResultInfo({
      play: 'level',
      streak: null,
      rewards: { hammer: 1, double: 0 },
      picked: { hammer: 0, double: 0 },
      unlockedNext: true,
      wins: 3,
    });
    expect(byId['result-progress'].textContent).toBe('勝ち 3/3');
    expect(byId['result-rewards'].hidden).toBe(false);
    expect(byId['result-rewards'].textContent).toBe('+1 ハンマー（ほうび）');
    expect(byId['next-level-btn'].hidden).toBe(false);
    expect(byId['result-streak'].hidden).toBe(true);
  });

  it('result rewards list picked-up items and the bonus separately (14.4-2)', () => {
    const { hud, byId } = setupHud({
      settings: {
        rules: 'gimmick',
        play: 'level',
        role: 'escape',
        difficulty: 'normal',
        course: 'escape',
        level: 6,
      },
      state: { mode: 'escape', moveCount: 8 },
    });
    hud.showResult('catWin', 8);
    hud.showResultInfo({
      play: 'level',
      streak: null,
      rewards: { hammer: 1, double: 0 },
      picked: { hammer: 2, double: 0 },
      unlockedNext: true,
      wins: 3,
    });
    expect(byId['result-rewards'].textContent).toBe(
      '+2 ハンマー（ひろった）  +1 ハンマー（ほうび）',
    );
  });

  it('the level select button opens the overlay', () => {
    const { byId, levelSelect } = setupHud({});
    byId['level-select-btn'].addEventListener.mock.calls[0][1]();
    expect(levelSelect.open).toHaveBeenCalledTimes(1);
    byId['result-levels-btn'].addEventListener.mock.calls[0][1]();
    expect(levelSelect.open).toHaveBeenCalledTimes(2);
  });

  it('setLevelAndStart persists the choice and starts', () => {
    const { hud, onStart } = setupHud({});
    hud.setLevelAndStart(7, 'escape');
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(hud.getSettings()).toMatchObject({
      level: 7,
      role: 'escape',
      course: 'escape',
      mode: 'escape', // legacy alias
    });
    hud.setLevelAndStart(99, 'trapper'); // clamped
    expect(hud.getSettings().level).toBe(20);
    expect(hud.getSettings().role).toBe('trapper');
    const saved = JSON.parse(globalThis.localStorage.getItem('catescape.settings'));
    expect(saved).toMatchObject({ level: 20, role: 'trapper', course: 'trapper' });
  });
});

describe('hud: power gauge (14.5)', () => {
  afterEach(() => {
    delete globalThis.document;
    delete globalThis.localStorage;
  });

  const powerState = () => ({
    mode: 'escape',
    moveCount: 3,
    items: { cat: { hammer: 0 }, trapper: { double: 0 } },
    features: { power: true, dash: true, jump: true, storm: false },
    power: 5,
    armed: true,
    armKind: 'dash',
    dashLeft: 2,
  });

  it('fills the pips and shows dash/jump/stop-dash', () => {
    const state = powerState();
    const controller = { state, canUsePower: (k) => k === 'dash' };
    const { hud, byId } = setupHud({ state, controller });
    hud.setInventory(state.items, 'cat', true);
    hud.setTurn('cat', true);
    expect(byId['power-bar'].hidden).toBe(false);
    expect(byId['power-gauge'].children.length).toBe(6);
    expect(byId['power-gauge'].children.filter((p) => p.classes.has('on')).length).toBe(5);
    expect(byId['power-gauge'].getAttribute('aria-label')).toContain('5');
    expect(byId['dash-btn'].hidden).toBe(false);
    expect(byId['dash-btn'].disabled).toBe(false); // canUsePower('dash')
    expect(byId['jump-btn'].hidden).toBe(false);
    expect(byId['jump-btn'].disabled).toBe(true); // canUsePower('jump') false
    expect(byId['stop-dash-btn'].hidden).toBe(false); // dash armed
    expect(byId['dash-btn'].getAttribute('aria-pressed')).toBe('true');
  });

  it('dash/jump/stop buttons call the controller', () => {
    const state = powerState();
    state.armed = false;
    state.armKind = null;
    state.dashLeft = 0;
    const controller = {
      state,
      canUsePower: () => true,
      usePower: vi.fn(),
      stopDash: vi.fn(),
    };
    const { byId, hud } = setupHud({ state, controller });
    const click = (el) => el.addEventListener.mock.calls[0][1];
    click(byId['dash-btn'])();
    expect(controller.usePower).toHaveBeenCalledWith('dash');
    click(byId['jump-btn'])();
    expect(controller.usePower).toHaveBeenCalledWith('jump');
    // arm a dash in motion → the stop button appears
    state.armed = true;
    state.armKind = 'dash';
    state.dashLeft = 2;
    hud.setTurn('cat', true);
    expect(byId['stop-dash-btn'].hidden).toBe(false);
    click(byId['stop-dash-btn'])();
    expect(controller.stopDash).toHaveBeenCalledTimes(1);
  });

  it('hides the gauge for basic rules', () => {
    const { hud, byId } = setupHud({ state: { mode: 'escape', moveCount: 0 } });
    hud.setTurn('cat', true);
    expect(byId['power-bar'].hidden).toBe(true);
  });
});

describe('hud: multi-cat goal line and results (13.7)', () => {
  afterEach(() => {
    delete globalThis.document;
    delete globalThis.localStorage;
  });

  it('status line shows the goal and the counts', () => {
    const state = {
      mode: 'escape',
      moveCount: 2,
      catsGoal: 'anyCatch',
      cats: [40, 50],
      catTotal: 3,
      escaped: 1,
    };
    const { hud, byId } = setupHud({ state });
    hud.setTurn('cat', true);
    expect(byId['status-line'].textContent).toContain('ぜんぶ逃がそう・逃げた 1/3');

    const escapeState = {
      mode: 'trapper',
      moveCount: 1,
      catsGoal: 'anyEscape',
      cats: [40, 50],
      catTotal: 2,
      escaped: 0,
    };
    const esc = setupHud({ state: escapeState });
    esc.hud.setTurn('trapper', true);
    expect(esc.byId['status-line'].textContent).toContain('どれか逃げればOK・2匹');
  });

  it('result strings follow the goal and the course', () => {
    const base = {
      mode: 'trapper',
      moveCount: 5,
      catsGoal: 'anyEscape',
      cats: [40, 50],
      catTotal: 2,
      escaped: 0,
    };
    const trapper = setupHud({ state: base });
    trapper.hud.showResult('catWin', 5);
    expect(trapper.byId['result-text'].textContent).toBe(STRINGS.ja.mcEscaped);
    trapper.hud.showResult('trapperWin', 5);
    expect(trapper.byId['result-text'].textContent).toBe(STRINGS.ja.mcCaughtAll);

    const escape = setupHud({ state: { ...base, mode: 'escape' } });
    escape.hud.showResult('catWin', 5);
    expect(escape.byId['result-text'].textContent).toBe(STRINGS.ja.catWinEscape);

    const catchEscape = setupHud({
      state: { ...base, mode: 'escape', catsGoal: 'anyCatch', cats: [40, 50], escaped: 1 },
    });
    catchEscape.hud.showResult('trapperWin', 5);
    expect(catchEscape.byId['result-text'].textContent).toBe('2匹つかまった…');
    catchEscape.hud.showResult('catWin', 5);
    expect(catchEscape.byId['result-text'].textContent).toBe(STRINGS.ja.mcAllEscaped);
  });
});

describe('hud: block-count slider (16.3)', () => {
  afterEach(() => {
    delete globalThis.document;
    delete globalThis.localStorage;
  });

  it('defaults to the center and shows the count + estimate + help', () => {
    // basic streak, trapper, normal → center = INITIAL_BLOCKS.trapper.normal
    const { byId } = setupHud({});
    expect(byId['blocks-control'].hidden).toBe(false);
    expect(byId['blocks-slider'].value).toBe('50'); // the middle of the range
    expect(byId['blocks-value'].textContent).toContain('11');
    expect(byId['blocks-value'].textContent).toContain('見積もり');
    expect(byId['blocks-slider'].title).toBe(STRINGS.ja.blocksHelpTrapper);
    expect(byId['blocks-label'].textContent).toBe(STRINGS.ja.blocksAdjust);
  });

  it('right is harder: escape → more blocks, trapper → fewer blocks', () => {
    const esc = setupHud({
      settings: {
        rules: 'basic',
        play: 'level',
        role: 'escape',
        course: 'escape',
        difficulty: 'normal',
        level: 1,
      },
    });
    const slider = esc.byId['blocks-slider'];
    const escRange = levelRange(getLevel('escape', 1), 'normal', 'escape', 'basic');
    slider.value = '0';
    slider.addEventListener.mock.calls[0][1]();
    expect(esc.hud.getSettings().blocks).toBe(escRange.min); // left = easier
    slider.value = '100';
    slider.addEventListener.mock.calls[0][1]();
    expect(esc.hud.getSettings().blocks).toBe(escRange.max);
    expect(slider.title).toBe(STRINGS.ja.blocksHelpEscape);

    const trap = setupHud({
      settings: {
        rules: 'basic',
        play: 'level',
        role: 'trapper',
        course: 'trapper',
        difficulty: 'normal',
        level: 1,
      },
    });
    const tslider = trap.byId['blocks-slider'];
    const trapRange = levelRange(getLevel('trapper', 1), 'normal', 'trapper', 'basic');
    tslider.value = '0';
    tslider.addEventListener.mock.calls[0][1]();
    expect(trap.hud.getSettings().blocks).toBe(trapRange.max); // left = easier = more
    tslider.value = '100';
    tslider.addEventListener.mock.calls[0][1]();
    expect(trap.hud.getSettings().blocks).toBe(trapRange.min);
  });

  it('dragging updates the label, releasing starts a new game, the count is saved per setting', () => {
    const { hud, byId, onStart } = setupHud({});
    const slider = byId['blocks-slider'];
    slider.value = '100'; // trapper: right = harder = fewer blocks
    slider.addEventListener.mock.calls[0][1](); // input: label only
    expect(onStart).not.toHaveBeenCalled();
    expect(byId['blocks-value'].textContent).toContain('9');
    slider.addEventListener.mock.calls[1][1](); // change: new game
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(hud.getSettings().blocks).toBe(9); // streak range 9..13 around 11
    const saved = JSON.parse(globalThis.localStorage.getItem('catescape.blocks'));
    expect(saved['basic.streak.trapper.1.normal']).toBe(9);

    // a different difficulty keeps its own slot
    byId['difficulty-select'].value = 'hard';
    byId['difficulty-select'].addEventListener.mock.calls[0][1]();
    expect(hud.getSettings().blocks).toBe(7); // INITIAL_BLOCKS.trapper.hard
    expect(JSON.parse(globalThis.localStorage.getItem('catescape.blocks'))['basic.streak.trapper.1.normal']).toBe(9);

    // …and a saved count is restored on the next attach
    stubStorage({ 'catescape.blocks': JSON.stringify({ 'basic.streak.trapper.1.normal': 9 }) });
    const again = createHud({ strings: STRINGS.ja });
    again.attach({
      controller: { state: null, start: vi.fn() },
      getProgress: () => null,
      onStart: vi.fn(),
    });
    expect(again.getSettings().blocks).toBe(9);
  });
});
