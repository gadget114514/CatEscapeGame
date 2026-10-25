import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHud } from '../src/ui/hud.js';
import { STRINGS } from '../src/ui/strings.js';

// The element-ID list tracks index.html: Rev. 4 removed the hint checkbox
// (and its label) and added the four-axis bar, item bar, power gauge,
// language select and result extras.
// The three test cases themselves are unchanged.
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
  return {
    textContent: '',
    value: '',
    checked: false,
    hidden: false,
    disabled: false,
    title: '',
    children: [],
    parentNode: null,
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
}

function stubDocument() {
  const byId = {};
  for (const id of IDS) byId[id] = makeEl();
  globalThis.document = {
    title: '',
    createElement() {
      return makeEl();
    },
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

describe('hud status line: the trapper block budget (18.2)', () => {
  afterEach(() => {
    delete globalThis.document;
  });

  it('shows "You can place {n} more" while the trapper turn has budget left', () => {
    const { hud, byId, controller } = setup({
      mode: 'trapper',
      difficulty: 'normal',
      moveCount: 3,
      turn: 'trapper',
      blocksLeft: 2,
    });
    hud.setTurn('trapper', true);
    expect(byId['status-line'].textContent).toContain('You can place 2 more');

    // one block later the budget is spent: the line disappears
    controller.state = { ...controller.state, blocksLeft: 1 };
    hud.setTurn('trapper', true);
    expect(byId['status-line'].textContent).not.toContain('You can place');

    // the cat side never shows it
    controller.state = { ...controller.state, turn: 'cat', blocksLeft: 2 };
    hud.setTurn('cat', true);
    expect(byId['status-line'].textContent).not.toContain('You can place');
  });

  it('the ja table carries the exact spec wording', () => {
    expect(STRINGS.ja.blocksLeftLine).toBe('あと {n} 個置ける');
  });
});
