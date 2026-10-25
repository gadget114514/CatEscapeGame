import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createStartWizard } from '../src/ui/startWizard.js';
import { STRINGS } from '../src/ui/strings.js';

/* -------------------------------------------------- minimal DOM stub */

function makeEl(tag = 'div') {
  const el = {
    tagName: String(tag).toUpperCase(),
    id: '',
    className: '',
    textContent: '',
    value: '',
    hidden: false,
    disabled: false,
    type: '',
    style: {},
    children: [],
    parentNode: null,
    attributes: {},
    listeners: {},
    addEventListener(type, fn) {
      (el.listeners[type] || (el.listeners[type] = [])).push(fn);
    },
    appendChild(child) {
      el.children.push(child);
      child.parentNode = el;
      return child;
    },
    removeChild(child) {
      const i = el.children.indexOf(child);
      if (i >= 0) el.children.splice(i, 1);
      child.parentNode = null;
      return child;
    },
    click() {
      for (const fn of el.listeners.click || []) fn({ target: el });
    },
    setAttribute(k, v) {
      el.attributes[k] = String(v);
    },
    getAttribute(k) {
      return k in el.attributes ? el.attributes[k] : null;
    },
    /** Depth-first search over the subtree for `#id`. */
    querySelector(sel) {
      if (typeof sel !== 'string' || !sel.startsWith('#')) return null;
      const id = sel.slice(1);
      const stack = [...el.children];
      while (stack.length) {
        const node = stack.shift();
        if (node.id === id) return node;
        stack.unshift(...node.children);
      }
      return null;
    },
    querySelectorAll() {
      return [];
    },
  };
  return el;
}

/** Depth-first find of the first element matching pred. */
function find(root, pred) {
  const stack = [root];
  while (stack.length) {
    const node = stack.shift();
    if (pred(node)) return node;
    stack.unshift(...node.children);
  }
  return null;
}

function findById(root, id) {
  return find(root, (n) => n.id === id);
}

function stubStorage(initial = {}) {
  const m = new Map(Object.entries(initial));
  const store = {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => {
      m.set(k, String(v));
    },
    removeItem: (k) => {
      m.delete(k);
    },
  };
  globalThis.localStorage = store;
  // startWizard's progress probe reads window.localStorage
  globalThis.window = { localStorage: store };
  return m;
}

/** A progress blob with one streak win (makes つづき available). */
function progressWithPlay() {
  return JSON.stringify({
    version: 1,
    level: {
      basic: { trapper: new Array(20).fill(0), escape: new Array(20).fill(1) },
      gimmick: { trapper: new Array(20).fill(0), escape: new Array(20).fill(0) },
    },
    streak: {},
    inventory: { hammer: 0, double: 0 },
  });
}

function setup({ settings, progress, ...opts } = {}) {
  const initial = {};
  if (settings) initial['catescape.settings'] = JSON.stringify(settings);
  if (progress) initial['catescape.progress.v1'] = progress;
  stubStorage(initial);
  const onNewGame = vi.fn();
  const onContinue = vi.fn();
  const onOpenLevels = vi.fn();
  const wiz = createStartWizard({
    strings: STRINGS.ja,
    onNewGame,
    onContinue,
    onOpenLevels,
    ...opts,
  });
  return { wiz, onNewGame, onContinue, onOpenLevels, body: globalThis.document.body };
}

/* ------------------------------------------------------------- tests */

describe('start wizard (Rev. 9)', () => {
  beforeEach(() => {
    globalThis.document = {
      createElement: (tag) => makeEl(tag),
      body: makeEl('body'),
    };
  });
  afterEach(() => {
    delete globalThis.document;
    delete globalThis.localStorage;
    delete globalThis.window;
  });

  it('root: つづき is disabled without progress, enabled with progress', () => {
    const a = setup();
    a.wiz.open();
    // each wizard appends its overlay to the shared document.body
    const overlay = a.body.children[a.body.children.length - 1];
    const cont = find(overlay, (n) => n.textContent === STRINGS.ja.wizContinue);
    expect(cont).toBeTruthy();
    expect(cont.disabled).toBe(true);

    const b = setup({ progress: progressWithPlay() });
    b.wiz.open();
    const overlay2 = b.body.children[b.body.children.length - 1];
    const cont2 = find(overlay2, (n) => n.textContent === STRINGS.ja.wizContinue);
    expect(cont2.disabled).toBe(false);
  });

  it('root: つづき calls onContinue and closes the overlay', () => {
    const { wiz, onContinue, body } = setup({ progress: progressWithPlay() });
    wiz.open();
    const overlay = body.children[body.children.length - 1];
    const cont = find(overlay, (n) => n.textContent === STRINGS.ja.wizContinue);
    cont.click();
    expect(onContinue).toHaveBeenCalledTimes(1);
    expect(overlay.hidden).toBe(true);
  });

  it('new: fields are seeded from the saved settings', () => {
    const { wiz, body } = setup({
      settings: { rules: 'gimmick', play: 'streak', role: 'escape', difficulty: 'hard', level: 4 },
    });
    wiz.open('new');
    const overlay = body.children[0];
    const selects = [];
    const stack = [...overlay.children];
    while (stack.length) {
      const n = stack.shift();
      if (n.tagName === 'SELECT') selects.push(n);
      stack.unshift(...n.children);
    }
    // rules / play / role / difficulty — in creation order
    expect(selects.length).toBe(4);
    expect(selects[0].value).toBe('gimmick');
    expect(selects[1].value).toBe('streak');
    expect(selects[2].value).toBe('escape');
    expect(selects[3].value).toBe('hard');
  });

  it('new: the level row is hidden for streak and shown for level play', () => {
    const { wiz, body } = setup();
    wiz.open('new');
    const overlay = body.children[0];
    const row = findById(overlay, 'start-wizard-level-row');
    expect(row.style.display).toBe('none');
    // switch play style to level via the change handler
    const playSel = row.parentNode ? findSelectByValue(row.parentNode, 'streak') : null;
    expect(playSel).toBeTruthy();
    playSel.value = 'level';
    for (const fn of playSel.listeners.change || []) fn();
    expect(row.style.display).toBe('flex');
  });

  it('new: レベルを選ぶ calls onOpenLevels with the current cfg', () => {
    const { wiz, onOpenLevels, body } = setup({
      settings: { rules: 'basic', play: 'level', role: 'trapper', difficulty: 'easy', level: 6 },
    });
    wiz.open('new');
    const overlay = body.children[0];
    const row = findById(overlay, 'start-wizard-level-row');
    const btn = row.children[0]; // the levelsPick button
    expect(btn.textContent).toBe(STRINGS.ja.levelsPick);
    btn.click();
    expect(onOpenLevels).toHaveBeenCalledTimes(1);
    expect(onOpenLevels).toHaveBeenCalledWith({
      rules: 'basic',
      play: 'level',
      role: 'trapper',
      difficulty: 'easy',
      course: 'trapper',
      level: 6,
    });
    expect(overlay.hidden).toBe(true);
  });

  it('new: はじめる calls onNewGame with the edited cfg', () => {
    const { wiz, onNewGame, body } = setup({
      settings: { rules: 'basic', play: 'streak', role: 'trapper', difficulty: 'normal', level: 1 },
    });
    wiz.open('new');
    const overlay = body.children[0];
    // edit difficulty → hard
    const diffSel = findSelectByValue(overlay, 'normal');
    diffSel.value = 'hard';
    for (const fn of diffSel.listeners.change || []) fn();
    // press はじめる
    const start = find(overlay, (n) => n.textContent === STRINGS.ja.start);
    start.click();
    expect(onNewGame).toHaveBeenCalledTimes(1);
    expect(onNewGame.mock.calls[0][0]).toMatchObject({
      rules: 'basic',
      play: 'streak',
      role: 'trapper',
      difficulty: 'hard',
    });
    expect(overlay.hidden).toBe(true);
  });

  it('the root screen shows a summary of the saved settings', () => {
    const { wiz, body } = setup({
      settings: { rules: 'gimmick', play: 'level', role: 'escape', difficulty: 'hard', level: 9 },
      progress: progressWithPlay(),
    });
    wiz.open();
    const overlay = body.children[0];
    const summary = find(overlay, (n) => n.className === 'start-wizard-summary');
    expect(summary).toBeTruthy();
    expect(summary.textContent).toContain('L9');
    expect(summary.textContent).toContain(STRINGS.ja.rulesGimmick);
    expect(summary.textContent).toContain(STRINGS.ja.hard);
  });
});

/** Find the <select> in root whose current value is `value`. */
function findSelectByValue(root, value) {
  return find(root, (n) => n.tagName === 'SELECT' && n.value === value);
}
