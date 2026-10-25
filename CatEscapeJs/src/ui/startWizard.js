/**
 * Start wizard (proced): "はじめから / つづき" + new-game setup
 * Replaces the cluttered top-bar-first experience with a guided start.
 * Pure DOM — no Babylon.
 */
import { strings as liveStrings } from './strings.js';
import { loadProgress } from '../game/play/progress.js';

const storage = {
  getItem(key) {
    try { return window.localStorage.getItem(key); } catch { return null; }
  },
  setItem(key, value) {
    try { window.localStorage.setItem(key, value); } catch { /* best-effort */ }
  },
};

function hasProgress() {
  try {
    const p = loadProgress(storage);
    // if any wins or inventory has items or streak > 0 consider "続き" possible
    if (p && p.inventory && (p.inventory.hammer > 0 || p.inventory.double > 0)) return true;
    if (p && p.streak) {
      for (const k of Object.keys(p.streak)) {
        if (p.streak[k] && (p.streak[k].current > 0 || p.streak[k].best > 0)) return true;
      }
    }
    if (p && p.level) {
      for (const rules of ['basic', 'gimmick']) {
        for (const course of ['trapper', 'escape']) {
          const arr = p.level[rules] && p.level[rules][course];
          if (Array.isArray(arr)) {
            for (const v of arr) if ((v || 0) > 0) return true;
          }
        }
      }
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * @param {{strings?: Record<string, any>,
 *          onNewGame?: (cfg:any) => void,
 *          onContinue?: () => void}} [opts]
 */
export function createStartWizard(opts = {}) {
  const pinnedStrings = opts.strings || null;
  const strings = () => pinnedStrings || liveStrings;
  const onNewGame = opts.onNewGame || (() => {});
  const onContinue = opts.onContinue || (() => {});

  let overlay = null;
  let step = 'root'; // root | new
  let cfg = {
    rules: 'gimmick',
    play: 'streak',
    role: 'escape',
    difficulty: 'normal',
    course: 'escape',
    level: 1,
  };

  function build() {
    overlay = document.createElement('div');
    overlay.id = 'start-wizard-overlay';

    const panel = document.createElement('div');
    panel.id = 'start-wizard-panel';

    const title = document.createElement('h2');
    title.id = 'start-wizard-title';

    const body = document.createElement('div');
    body.id = 'start-wizard-body';

    const actions = document.createElement('div');
    actions.id = 'start-wizard-actions';

    panel.appendChild(title);
    panel.appendChild(body);
    panel.appendChild(actions);
    overlay.appendChild(panel);
    document.body.appendChild(overlay);
  }

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function renderRoot() {
    if (!overlay) build();
    const t = strings();
    const title = overlay.querySelector('#start-wizard-title');
    const body = overlay.querySelector('#start-wizard-body');
    const actions = overlay.querySelector('#start-wizard-actions');
    title.textContent = t.wizTitle || 'ゲームをはじめる';
    body.textContent = '';
    actions.textContent = '';

    const desc = el('p', 'start-wizard-desc', t.wizDesc || '「はじめから」または「つづき」から選んでください。');
    body.appendChild(desc);

    const btnRow = el('div', 'start-wizard-row');
    const cont = el('button', 'start-wizard-btn primary', t.wizContinue || 'つづき');
    cont.disabled = !hasProgress();
    cont.addEventListener('click', () => {
      overlay.hidden = true;
      onContinue();
    });

    const neu = el('button', 'start-wizard-btn', t.wizNewGame || 'はじめから');
    neu.addEventListener('click', () => {
      step = 'new';
      renderNew();
    });

    btnRow.appendChild(cont);
    btnRow.appendChild(neu);
    body.appendChild(btnRow);

    overlay.hidden = false;
  }

  function renderNew() {
    if (!overlay) build();
    const t = strings();
    const title = overlay.querySelector('#start-wizard-title');
    const body = overlay.querySelector('#start-wizard-body');
    const actions = overlay.querySelector('#start-wizard-actions');
    title.textContent = t.wizNewTitle || 'はじめから（設定）';
    body.textContent = '';
    actions.textContent = '';

    // rules
    const rulesRow = el('div', 'start-wizard-field');
    rulesRow.appendChild(el('label', null, t.rules || 'ルール'));
    const rulesSel = document.createElement('select');
    const o1 = document.createElement('option'); o1.value = 'basic'; o1.textContent = t.rulesBasic || '基本';
    const o2 = document.createElement('option'); o2.value = 'gimmick'; o2.textContent = t.rulesGimmick || 'ギミック';
    rulesSel.appendChild(o1); rulesSel.appendChild(o2);
    rulesSel.value = cfg.rules;
    rulesSel.addEventListener('change', () => { cfg.rules = rulesSel.value; });
    rulesRow.appendChild(rulesSel);
    body.appendChild(rulesRow);

    // play style
    const playRow = el('div', 'start-wizard-field');
    playRow.appendChild(el('label', null, t.playStyle || 'プレイスタイル'));
    const playSel = document.createElement('select');
    const p1 = document.createElement('option'); p1.value = 'streak'; p1.textContent = t.playStreak || '連勝';
    const p2 = document.createElement('option'); p2.value = 'level'; p2.textContent = t.playLevel || 'レベル攻略';
    playSel.appendChild(p1); playSel.appendChild(p2);
    playSel.value = cfg.play;
    playSel.addEventListener('change', () => { cfg.play = playSel.value; updateLevelVis(); });
    playRow.appendChild(playSel);
    body.appendChild(playRow);

    // role/course
    const roleRow = el('div', 'start-wizard-field');
    roleRow.appendChild(el('label', null, t.mode || 'モード'));
    const roleSel = document.createElement('select');
    const r1 = document.createElement('option'); r1.value = 'escape'; r1.textContent = t.escape || 'ねことしてにげる';
    const r2 = document.createElement('option'); r2.value = 'trapper'; r2.textContent = t.trapper || 'ねこをつかまえる';
    roleSel.appendChild(r1); roleSel.appendChild(r2);
    roleSel.value = cfg.role;
    roleSel.addEventListener('change', () => { cfg.role = roleSel.value; cfg.course = roleSel.value; });
    roleRow.appendChild(roleSel);
    body.appendChild(roleRow);

    // difficulty
    const diffRow = el('div', 'start-wizard-field');
    diffRow.appendChild(el('label', null, t.difficulty || '難易度'));
    const diffSel = document.createElement('select');
    const d1 = document.createElement('option'); d1.value = 'easy'; d1.textContent = t.easy || 'やさしい';
    const d2 = document.createElement('option'); d2.value = 'normal'; d2.textContent = t.normal || 'ふつう';
    const d3 = document.createElement('option'); d3.value = 'hard'; d3.textContent = t.hard || 'むずかしい';
    diffSel.appendChild(d1); diffSel.appendChild(d2); diffSel.appendChild(d3);
    diffSel.value = cfg.difficulty;
    diffSel.addEventListener('change', () => { cfg.difficulty = diffSel.value; });
    diffRow.appendChild(diffSel);
    body.appendChild(diffRow);

    // level
    const levelRow = el('div', 'start-wizard-field');
    levelRow.id = 'start-wizard-level-row';
    levelRow.appendChild(el('label', null, t.levelLabel || 'レベル'));
    const levelSel = document.createElement('select');
    for (let i = 1; i <= 20; i++) {
      const opt = document.createElement('option');
      opt.value = String(i);
      opt.textContent = `L${i}`;
      levelSel.appendChild(opt);
    }
    levelSel.value = String(cfg.level);
    levelSel.addEventListener('change', () => { cfg.level = Number(levelSel.value) || 1; });
    levelRow.appendChild(levelSel);
    body.appendChild(levelRow);

    function updateLevelVis() {
      levelRow.style.display = cfg.play === 'level' ? 'flex' : 'none';
    }
    updateLevelVis();

    // actions
    const back = el('button', 'start-wizard-btn', t.back || '戻る');
    back.addEventListener('click', () => { step = 'root'; renderRoot(); });
    const start = el('button', 'start-wizard-btn primary', t.start || 'はじめる');
    start.addEventListener('click', () => {
      overlay.hidden = true;
      onNewGame({ ...cfg });
    });
    actions.appendChild(back);
    actions.appendChild(start);
  }

  return {
    open() {
      step = 'root';
      renderRoot();
    },
    close() {
      if (overlay) overlay.hidden = true;
    },
  };
}
