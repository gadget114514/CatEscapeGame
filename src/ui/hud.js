/**
 * The DOM HUD: top bar (mode/difficulty/New Game/hint), status line and the
 * result modal. Implements the HUD interface for the controller
 * (setStatus/setTurn/showResult/setSeed) — status texts are built here from
 * setTurn/showResult + strings.js, so the controller's English setStatus
 * text is intentionally ignored.
 */
import { strings as defaultStrings } from './strings.js';

const STORAGE_KEY = 'catescape.settings';

/**
 * @typedef {{mode:'trapper'|'escape', difficulty:'easy'|'normal'|'hard', hint:boolean}} Settings
 */

/**
 * Load saved settings (localStorage wrapped in try/catch).
 * @returns {Settings}
 */
export function loadSettings() {
  const fallback = { mode: 'trapper', difficulty: 'normal', hint: false };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    const s = JSON.parse(raw);
    return {
      mode: s.mode === 'escape' ? 'escape' : 'trapper',
      difficulty: ['easy', 'normal', 'hard'].includes(s.difficulty) ? s.difficulty : 'normal',
      hint: !!s.hint,
    };
  } catch {
    return fallback;
  }
}

/**
 * @param {Settings} settings
 */
function saveSettings(settings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    /* private mode etc. — settings are best-effort */
  }
}

/**
 * Build the HUD and bind it to the existing DOM (see index.html).
 * @param {{strings?: Record<string,string>}} [opts]
 */
export function createHud({ strings = defaultStrings } = {}) {
  const el = (id) => document.getElementById(id);
  const dom = {
    modeLabel: el('mode-label'),
    modeSelect: el('mode-select'),
    diffLabel: el('diff-label'),
    diffSelect: el('difficulty-select'),
    newGameBtn: el('new-game-btn'),
    hintLabel: el('hint-label'),
    hintCheckbox: el('hint-checkbox'),
    statusLine: el('status-line'),
    resultModal: el('result-modal'),
    resultText: el('result-text'),
    resultMoves: el('result-moves'),
    playAgainBtn: el('play-again-btn'),
  };

  // localize static text
  document.title = strings.title;
  dom.modeLabel.textContent = strings.mode;
  dom.modeSelect.querySelector('option[value="trapper"]').textContent = strings.modeTrapper;
  dom.modeSelect.querySelector('option[value="escape"]').textContent = strings.modeEscape;
  dom.diffLabel.textContent = strings.difficulty;
  dom.diffSelect.querySelector('option[value="easy"]').textContent = strings.easy;
  dom.diffSelect.querySelector('option[value="normal"]').textContent = strings.normal;
  dom.diffSelect.querySelector('option[value="hard"]').textContent = strings.hard;
  dom.newGameBtn.textContent = strings.newGame;
  dom.hintLabel.textContent = strings.hint;
  dom.playAgainBtn.textContent = strings.playAgain;

  /** @type {import('../game/controller.js').GameController|null} */
  let controller = null;
  /** @type {{setHintEnabled(on:boolean):void}|null} */
  let view = null;
  /** @type {Settings} */
  let settings = loadSettings();
  let moveCount = 0;
  /** @type {number|null} */
  let seed = null;
  let isPlayerTurn = true;

  function persist() {
    saveSettings(settings);
  }

  function updateStatus() {
    const parts = [isPlayerTurn ? strings.yourTurn : strings.thinking];
    parts.push(`${strings.move} ${moveCount}`);
    if (seed !== null) parts.push(`${strings.seed} ${seed}`);
    dom.statusLine.textContent = parts.join(' · ');
  }

  function startGame() {
    if (!controller) return;
    dom.resultModal.classList.remove('visible');
    controller.start({ mode: settings.mode, difficulty: settings.difficulty });
  }

  return {
    /** Status text from the controller is ignored — texts are built here. */
    setStatus() {},

    /**
     * @param {import('../game/rules.js').Side} _side
     * @param {boolean} isPlayer
     */
    setTurn(_side, isPlayer) {
      isPlayerTurn = isPlayer;
      if (controller && controller.state) moveCount = controller.state.moveCount;
      updateStatus();
    },

    /**
     * @param {'playing'|'catWin'|'trapperWin'} status
     * @param {number} mc
     */
    showResult(status, mc) {
      moveCount = mc;
      updateStatus();
      // the message must match the game that just ended — the player may
      // already have switched the mode select (Rev. 3 fix)
      const mode = controller && controller.state ? controller.state.mode : settings.mode;
      const suffix = mode === 'trapper' ? 'Trapper' : 'Escape';
      const key = `${status === 'catWin' ? 'catWin' : 'trapperWin'}${suffix}`;
      dom.resultText.textContent = strings[key] || status;
      dom.resultMoves.textContent = `${strings.move}: ${mc}`;
      dom.resultModal.classList.add('visible');
    },

    /**
     * @param {number} s
     */
    setSeed(s) {
      seed = s;
      updateStatus();
    },

    /**
     * Wire the controls. Called once after the controller exists.
     * @param {{controller: import('../game/controller.js').GameController,
     *          view: {setHintEnabled(on:boolean):void}}} deps
     */
    attach({ controller: c, view: v }) {
      controller = c;
      view = v;

      dom.modeSelect.value = settings.mode;
      dom.diffSelect.value = settings.difficulty;
      dom.hintCheckbox.checked = settings.hint;
      view.setHintEnabled(settings.hint);

      dom.modeSelect.addEventListener('change', () => {
        settings.mode = dom.modeSelect.value === 'escape' ? 'escape' : 'trapper';
        persist();
        startGame();
      });
      dom.diffSelect.addEventListener('change', () => {
        const v2 = dom.diffSelect.value;
        settings.difficulty = ['easy', 'normal', 'hard'].includes(v2) ? v2 : 'normal';
        persist();
        startGame();
      });
      dom.newGameBtn.addEventListener('click', () => startGame());
      dom.playAgainBtn.addEventListener('click', () => startGame());
      dom.hintCheckbox.addEventListener('change', () => {
        settings.hint = dom.hintCheckbox.checked;
        persist();
        if (view) view.setHintEnabled(settings.hint);
      });
    },

    /**
     * @returns {Settings}
     */
    getSettings() {
      return { ...settings };
    },
  };
}
