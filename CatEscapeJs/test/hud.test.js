import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHud } from '../src/ui/hud.js';
import { STRINGS } from '../src/ui/strings.js';

const IDS = [
  'mode-label',
  'mode-select',
  'diff-label',
  'difficulty-select',
  'new-game-btn',
  'hint-label',
  'hint-checkbox',
  'status-line',
  'result-modal',
  'result-text',
  'result-moves',
  'play-again-btn',
];

function makeEl() {
  return {
    textContent: '',
    value: '',
    checked: false,
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
      };
    },
    addEventListener: vi.fn(),
    querySelector() {
      return { textContent: '' };
    },
    getBoundingClientRect() {
      return { height: 0 };
    },
  };
}

function stubDocument() {
  const byId = {};
  for (const id of IDS) byId[id] = makeEl();
  globalThis.document = {
    title: '',
    getElementById(id) {
      return byId[id] || null;
    },
  };
  return byId;
}

/** Minimal controller stub: hud only reads `state` (mode/moveCount) and start(). */
function stubController(state) {
  return { state, start: vi.fn() };
}

function setup(state) {
  const byId = stubDocument();
  const hud = createHud({ strings: STRINGS.en });
  const controller = stubController(state);
  const view = { setHintEnabled: vi.fn() };
  hud.attach({ controller, view });
  return { hud, byId, controller, view };
}

describe('hud.showResult message selection', () => {
  beforeEach(() => {
    stubDocument();
  });
  afterEach(() => {
    delete globalThis.document;
  });

  it('uses the finished game mode, not the mode select setting', () => {
    // saved/default settings say trapper mode …
    const { hud, byId } = setup({ mode: 'escape', difficulty: 'normal', moveCount: 4 });
    // … but the game that just ended was escape mode:
    expect(hud.getSettings().mode).toBe('trapper');
    hud.showResult('catWin', 4);
    expect(byId['result-text'].textContent).toBe(STRINGS.en.catWinEscape);
  });

  it('maps all four (status, mode) outcomes', () => {
    const cases = [
      ['trapper', 'catWin', STRINGS.en.catWinTrapper],
      ['trapper', 'trapperWin', STRINGS.en.trapperWinTrapper],
      ['escape', 'catWin', STRINGS.en.catWinEscape],
      ['escape', 'trapperWin', STRINGS.en.trapperWinEscape],
    ];
    for (const [mode, status, expected] of cases) {
      const { hud, byId } = setup({ mode, difficulty: 'normal', moveCount: 1 });
      hud.showResult(status, 1);
      expect(byId['result-text'].textContent).toBe(expected);
      expect(byId['result-moves'].textContent).toBe(`${STRINGS.en.move}: 1`);
      expect(byId['result-modal'].classes.has('visible')).toBe(true);
    }
  });

  it('reads the mode from controller.state at showResult time', () => {
    // the same attached hud sees a new game with a different mode
    const { hud, byId, controller } = setup({ mode: 'trapper', difficulty: 'easy', moveCount: 2 });
    hud.showResult('catWin', 2);
    expect(byId['result-text'].textContent).toBe(STRINGS.en.catWinTrapper);

    controller.state = { mode: 'escape', difficulty: 'easy', moveCount: 9 };
    hud.showResult('trapperWin', 9);
    expect(byId['result-text'].textContent).toBe(STRINGS.en.trapperWinEscape);
  });
});
