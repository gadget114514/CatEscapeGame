/**
 * Localization tests (spec 13.9): key parity, placeholder parity, the
 * Russian plural forms, language detection and switching without a game
 * restart.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  STRINGS,
  LANGS,
  detectLang,
  detectStrings,
  getStrings,
  getLang,
  setLang,
  fmt,
  plural,
  formatEntry,
} from '../src/ui/strings.js';
import { createHud } from '../src/ui/hud.js';

/** Every `{placeholder}` used by one entry (all plural forms included). */
function placeholdersOf(value) {
  const out = new Set();
  const scan = (s) => {
    for (const m of String(s).matchAll(/\{(\w+)\}/g)) out.add(m[1]);
  };
  if (value && typeof value === 'object') {
    for (const form of Object.values(value)) scan(form);
  } else {
    scan(value);
  }
  return out;
}

describe('i18n: language tables (13.9)', () => {
  it('loads every supported language with exactly the en key set', () => {
    expect(Object.keys(STRINGS).sort()).toEqual([...LANGS].sort());
    const en = Object.keys(STRINGS.en).sort();
    for (const lang of LANGS) {
      expect(Object.keys(STRINGS[lang]).sort(), lang).toEqual(en);
    }
    expect(en.length).toBeGreaterThan(100);
  });

  it('every {placeholder} in en appears in every language', () => {
    const en = STRINGS.en;
    for (const lang of LANGS) {
      for (const [key, value] of Object.entries(en)) {
        const want = placeholdersOf(value);
        const got = placeholdersOf(STRINGS[lang][key]);
        expect([...got].sort(), `${lang}.${key}`).toEqual([...want].sort());
      }
    }
  });

  it('counted strings are plural objects in ru and plain strings elsewhere', () => {
    // the ru table uses {one, few, many, other} for noun-counted strings
    expect(typeof STRINGS.ru.winCount).toBe('object');
    expect(typeof STRINGS.ru.mcStuck).toBe('object');
    expect(typeof STRINGS.ja.winCount).toBe('string');
    expect(typeof STRINGS.en.chartTooltipMoves).toBe('string');
  });

  it('plural("ru", n) picks one/few/many for 1, 2, 5, 11, 21 and 22', () => {
    const forms = STRINGS.ru.chartTooltipMoves;
    expect(formatEntry('ru', forms, { n: 1 })).toBe('в среднем 1 ход');
    expect(formatEntry('ru', forms, { n: 2 })).toBe('в среднем 2 хода');
    expect(formatEntry('ru', forms, { n: 5 })).toBe('в среднем 5 ходов');
    expect(formatEntry('ru', forms, { n: 11 })).toBe('в среднем 11 ходов');
    expect(formatEntry('ru', forms, { n: 21 })).toBe('в среднем 21 ход');
    expect(formatEntry('ru', forms, { n: 22 })).toBe('в среднем 22 хода');
    // Japanese has only `other`
    expect(plural('ja', 1, { other: 'あ' })).toBe('あ');
    // plain strings pass through
    expect(plural('ru', 3, 'x')).toBe('x');
  });

  it('formatEntry formats plural objects and plain strings', () => {
    expect(formatEntry('ru', STRINGS.ru.winCount, { n: 1 })).toBe('Победа 1/3');
    expect(formatEntry('ru', STRINGS.ru.winCount, { n: 5 })).toBe('Побед 5/3');
    expect(formatEntry('ja', STRINGS.ja.winCount, { n: 2 })).toBe('勝ち 2/3');
  });

  it('detectLang maps prefixes and falls back to ja', () => {
    expect(detectLang('es-MX')).toBe('es');
    expect(detectLang('pt-BR')).toBe('ja'); // unsupported
    expect(detectLang('ru')).toBe('ru');
    expect(detectLang('de-AT')).toBe('de');
    expect(detectLang('en-US')).toBe('en');
    expect(detectLang('fr')).toBe('fr');
    expect(detectLang()).toBe('ja');
    expect(detectLang('xx')).toBe('ja');
    expect(detectStrings('es')).toBe(STRINGS.es);
    expect(detectStrings('fr-CA')).toBe(STRINGS.fr);
    expect(getStrings('ru')).toBe(STRINGS.ru);
  });

  it('fmt still fills placeholders', () => {
    expect(fmt('Wins {n}/3', { n: 2 })).toBe('Wins 2/3');
    expect(fmt('no {missing} vars', { other: 1 })).toBe('no {missing} vars');
  });
});

/* ------------------------------------------------- switching without restart */

const HUD_IDS = [
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
];

function makeEl() {
  const el = {
    textContent: '',
    value: '',
    hidden: false,
    disabled: false,
    title: '',
    children: [],
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
      };
    },
    setAttribute(k, v) {
      this[k] = v;
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
  for (const id of HUD_IDS) byId[id] = makeEl();
  globalThis.document = {
    title: '',
    documentElement: { lang: 'ja' },
    createElement() {
      return makeEl();
    },
    getElementById(id) {
      return byId[id] || null;
    },
  };
  return byId;
}

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

describe('language switching (13.9)', () => {
  afterEach(() => {
    setLang('ja'); // restore the module state for the other tests
    delete globalThis.document;
    delete globalThis.localStorage;
  });

  it('switches the strings at once and never restarts the game', () => {
    stubStorage({ 'catescape.settings': JSON.stringify({ lang: 'ja' }) });
    const byId = stubDocument();
    const hud = createHud(); // live strings (no pin)
    const controller = { state: { mode: 'trapper', moveCount: 0 }, start: vi.fn() };
    const onStart = vi.fn();
    hud.attach({ controller, getProgress: () => null, onStart });
    expect(byId['rules-label'].textContent).toBe('ルール');
    expect(onStart).not.toHaveBeenCalled(); // switching must not restart

    setLang('en');
    expect(byId['rules-label'].textContent).toBe('Rules');
    expect(byId['new-game-btn'].textContent).toBe('New Game');
    expect(document.documentElement.lang).toBe('en');
    expect(hud.getSettings().lang).toBe('ja'); // not changed by setLang alone

    // the language select updates the settings and does not restart
    byId['lang-select'].value = 'en';
    byId['lang-select'].addEventListener.mock.calls[0][1]();
    expect(onStart).not.toHaveBeenCalled(); // still no restart
    expect(hud.getSettings().lang).toBe('en');
    expect(JSON.parse(globalThis.localStorage.getItem('catescape.settings')).lang).toBe('en');
  });

  it('the HUD select lists every language with its own name', () => {
    stubStorage({});
    const byId = stubDocument();
    const hud = createHud();
    hud.attach({
      controller: { state: null, start: vi.fn() },
      getProgress: () => null,
      onStart: vi.fn(),
    });
    const names = byId['lang-select'].children.map((o) => o.textContent);
    expect(names).toEqual(['日本語', 'English', 'Español', 'Français', 'Deutsch', 'Русский']);
    expect(byId['lang-select'].getAttribute('aria-label')).toBe(STRINGS[getLang()].langLabel);
  });
});
