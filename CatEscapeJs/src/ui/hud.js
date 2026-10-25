/**
 * The DOM HUD (Rev. 4 + 13.5/13.7/14.4-2/14.6/13.9): the top bar (rules /
 * play style / role / difficulty / camera / language), status line with
 * the streak and the multi-cat goal, the item bar, the 14.5 power gauge
 * (dash / jump / stop-dash) and toasts, the level-select button + label
 * and the result modal with its extra lines. Implements the controller's
 * HUD interface (setStatus/setTurn/showResult/setSeed/notify/
 * setInventory/setPower) — status texts are built here, so the
 * controller's English setStatus text is intentionally ignored.
 *
 * The language select (13.9) switches the strings at once without
 * restarting the game; every visible string comes from the table.
 */
import {
  strings as liveStrings,
  getStrings,
  getLang,
  setLang,
  onLangChange,
  LANGS,
  LANG_NAMES,
  STRINGS,
  fmt,
  formatEntry,
} from './strings.js';
import { getLevel } from '../game/play/levels.js';
import {
  levelRange,
  streakRange,
  sliderBlocks,
  sliderPosition,
  clampBlocks,
  blockSettingKey,
} from '../game/play/blocks.js';
import { STREAK_LEVEL } from '../game/play/setup.js';
import { statsFor, estimateRate } from './difficultyChart.js';
import { defaultFxQuality } from '../render/fx/fxPlan.js';

const STORAGE_KEY = 'catescape.settings';
/** 16.3: the slider's block counts, one slot per (rules,play,course,level,diff). */
const BLOCKS_KEY = 'catescape.blocks';

/**
 * Load the saved slider values (16.3); malformed data becomes `{}`.
 * @returns {Record<string, number>}
 */
export function loadBlockCounts() {
  try {
    const raw = localStorage.getItem(BLOCKS_KEY);
    if (!raw) return {};
    const obj = JSON.parse(raw);
    if (!obj || typeof obj !== 'object') return {};
    /** @type {Record<string, number>} */
    const out = {};
    for (const [key, value] of Object.entries(obj)) {
      const n = Math.floor(Number(value));
      if (Number.isFinite(n)) out[key] = Math.max(0, n);
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * Persist the slider values (16.3). Failures are swallowed, like the
 * settings themselves.
 * @param {Record<string, number>} counts
 */
export function saveBlockCounts(counts) {
  try {
    localStorage.setItem(BLOCKS_KEY, JSON.stringify(counts || {}));
  } catch {
    /* private mode etc. — best-effort */
  }
}

/**
 * @typedef {{ rules:'basic'|'gimmick', play:'streak'|'level',
 *             role:'trapper'|'escape', difficulty:'easy'|'normal'|'hard',
 *             course:'trapper'|'escape', level:number, lang:string,
 *             fx:'high'|'medium'|'low' }} Settings
 */

/** The device-appropriate default of the 演出 select (spec 17.1). */
function defaultFx() {
  const touch =
    typeof navigator !== 'undefined' && navigator && navigator.maxTouchPoints > 0 ? 1 : 0;
  return defaultFxQuality(touch);
}

/**
 * Load saved settings (localStorage wrapped in try/catch). Rev. 4 adds
 * rules/play/course/level, drops the old `hint` checkbox setting and
 * migrates the legacy `mode` key into `role`; 13.9 adds `lang`;
 * Rev. 6 adds `fx` (演出).
 * @returns {Settings}
 */
export function loadSettings() {
  const fallback = {
    rules: 'basic',
    play: 'streak',
    role: 'trapper',
    difficulty: 'normal',
    course: 'trapper',
    level: 1,
    lang: defaultLang(),
    fx: defaultFx(),
  };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    const s = JSON.parse(raw);
    const role =
      s.role === 'trapper' || s.role === 'escape'
        ? s.role
        : s.mode === 'escape'
          ? 'escape'
          : 'trapper';
    return {
      rules: s.rules === 'gimmick' ? 'gimmick' : 'basic',
      play: s.play === 'level' ? 'level' : 'streak',
      role,
      difficulty: ['easy', 'normal', 'hard'].includes(s.difficulty) ? s.difficulty : 'normal',
      course: s.course === 'escape' || s.course === 'trapper' ? s.course : role,
      level: Number.isInteger(s.level) && s.level >= 1 && s.level <= 20 ? s.level : 1,
      lang: typeof s.lang === 'string' && s.lang in STRINGS ? s.lang : fallback.lang,
      fx: ['high', 'medium', 'low'].includes(s.fx) ? s.fx : fallback.fx,
    };
  } catch {
    return fallback;
  }
}

/** The startup language: navigator first (spec 13.9), else ja. */
function defaultLang() {
  return getLang();
}

/**
 * Persist only the known fields (the old `hint`/`mode` keys disappear on
 * the next save). Failures are swallowed, like localStorage quota.
 * @param {Settings} settings
 */
export function saveSettings(settings) {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        rules: settings.rules,
        play: settings.play,
        role: settings.role,
        difficulty: settings.difficulty,
        course: settings.course,
        level: settings.level,
        lang: settings.lang,
        fx: settings.fx, // Rev. 6: the 演出 select (spec 17.1)
      }),
    );
  } catch {
    /* private mode etc. — settings are best-effort */
  }
}

/**
 * Build the HUD and bind it to the existing DOM (see index.html).
 * @param {{strings?: Record<string, any>}} [opts]
 */
export function createHud({ strings: initialStrings } = {}) {
  /** Live table; a custom table (tests) pins the language switch off. */
  let strings = initialStrings || liveStrings;
  const pinned = !!initialStrings;

  const el = (id) => document.getElementById(id);
  const dom = {
    rulesLabel: el('rules-label'),
    rulesSelect: el('rules-select'),
    playLabel: el('play-label'),
    playSelect: el('play-select'),
    modeLabel: el('mode-label'),
    modeSelect: el('mode-select'),
    diffLabel: el('diff-label'),
    diffSelect: el('difficulty-select'),
    difficultyControl: el('difficulty-control'),
    blocksControl: el('blocks-control'),
    blocksLabel: el('blocks-label'),
    blocksSlider: el('blocks-slider'),
    blocksValue: el('blocks-value'),
    cameraLabel: el('camera-label'),
    cameraSelect: el('camera-select'),
    fxLabel: el('fx-label'),
    fxSelect: el('fx-select'),
    langControl: el('lang-control'),
    langLabel: el('lang-label'),
    langSelect: el('lang-select'),
    levelSelectBtn: el('level-select-btn'),
    levelLabel: el('level-label'),
    newGameBtn: el('new-game-btn'),
    routeBtn: el('route-btn'),
    statusLine: el('status-line'),
    itemBar: el('item-bar'),
    itemBtn: el('item-btn'),
    aiItems: el('ai-items'),
    powerBar: el('power-bar'),
    powerGauge: el('power-gauge'),
    dashBtn: el('dash-btn'),
    jumpBtn: el('jump-btn'),
    stopDashBtn: el('stop-dash-btn'),
    toastArea: el('toast-area'),
    resultModal: el('result-modal'),
    resultText: el('result-text'),
    resultMoves: el('result-moves'),
    resultStreak: el('result-streak'),
    resultProgress: el('result-progress'),
    resultRewards: el('result-rewards'),
    playAgainBtn: el('play-again-btn'),
    resultLevelsBtn: el('result-levels-btn'),
    nextLevelBtn: el('next-level-btn'),
  };

  // power gauge pips (14.5): six dots inside #power-gauge
  const pips = [];
  if (dom.powerGauge) {
    for (let k = 0; k < 6; k++) {
      const pip = document.createElement('span');
      pip.className = 'power-pip';
      dom.powerGauge.appendChild(pip);
      pips.push(pip);
    }
  }

  /** @type {import('../game/controller.js').GameController|null} */
  let controller = null;
  /** @type {{open():void, isOpen?():boolean, refresh?():void}|null} */
  let levelSelect = null;
  /** @type {(() => import('../game/play/progress.js').Progress)|null} */
  let getProgress = null;
  /** @type {(() => void)|null} */
  let onStart = null;
  /** @type {((mode:'perspective'|'ortho') => void)|null} */
  let onCameraMode = null;
  /** @type {((fx:'high'|'medium'|'low') => void)|null} Rev. 6 */
  let onFxQuality = null;
  /** @type {((on:boolean) => void)|null} Rev. 6: double-armed edge ring */
  let onDoubleArmed = null;
  /** @type {Settings} */
  let settings = loadSettings();
  /** 16.3: the slider's saved block count per (rules,play,course,level,diff). */
  let blockCounts = loadBlockCounts();
  let moveCount = 0;
  /** @type {number|null} */
  let seed = null;
  let isPlayerTurn = true;
  // in-game item bar state (gimmick rules only), fed by setInventory
  /** @type {'trapper'|'cat'|null} */
  let playerSide = null;
  let armed = false;
  /** @type {null|{play:string, streak:{current:number,best:number}|null,
   *               rewards:{hammer:number,double:number}|null,
   *               picked:{hammer:number,double:number}|null,
   *               unlockedNext:boolean, wins:number}} */
  let lastResult = null;

  function persist() {
    saveSettings(settings);
  }

  /** The player's course (kept in sync with `role`, Rev. 4). */
  function courseOf() {
    return settings.course === 'escape' || settings.course === 'trapper'
      ? settings.course
      : settings.role;
  }

  /** The 16.2/16.3 slider range of the current setting (18.1: per rules). */
  function blockRangeOf() {
    if (settings.play === 'level') {
      const course = courseOf();
      return levelRange(
        getLevel(course, settings.level),
        settings.difficulty,
        course,
        settings.rules,
      );
    }
    return streakRange(settings.role, settings.difficulty);
  }

  /** The block count the current game plays with (saved, else the center). */
  function currentBlocks() {
    const range = blockRangeOf();
    const saved = blockCounts[blockSettingKey({ ...settings, course: courseOf() })];
    return clampBlocks(range, Number.isFinite(saved) ? saved : range.center);
  }

  /** 16.3: the slider row — count + estimate + the per-course help text. */
  function renderBlocks() {
    if (!dom.blocksControl) return;
    const course = courseOf();
    const range = blockRangeOf();
    const blocks = currentBlocks();
    dom.blocksControl.hidden = false;
    if (dom.blocksLabel) dom.blocksLabel.textContent = strings.blocksAdjust;
    if (dom.blocksSlider) {
      // right is always harder in both courses (16.3)
      dom.blocksSlider.value = String(Math.round(sliderPosition(course, range, blocks) * 100));
      const help =
        course === 'escape' ? strings.blocksHelpEscape : strings.blocksHelpTrapper;
      dom.blocksSlider.title = help;
      dom.blocksSlider.setAttribute('aria-label', strings.blocksAdjust);
    }
    if (dom.blocksValue) {
      const stats = statsFor(settings.rules === 'basic' ? 'basic' : 'gimmick');
      const level = settings.play === 'level' ? settings.level : STREAK_LEVEL[settings.difficulty];
      const rate = estimateRate(stats, course, level, blocks);
      dom.blocksValue.textContent = fmt(strings.blocksLabel, {
        n: blocks,
        rate: rate == null ? '–' : Math.round(rate * 100),
      });
    }
  }

  /** Remember the slider's count for this exact setting (16.3). */
  function saveSliderValue() {
    if (!dom.blocksSlider) return;
    const course = courseOf();
    const blocks = sliderBlocks(course, blockRangeOf(), Number(dom.blocksSlider.value) / 100);
    blockCounts = { ...blockCounts, [blockSettingKey({ ...settings, course })]: blocks };
    saveBlockCounts(blockCounts);
  }

  /** Static labels + selects + buttons (call again after a language switch). */
  function applyStrings() {
    const t = strings;
    document.title = t.title;
    dom.rulesLabel.textContent = t.rules;
    dom.rulesSelect.querySelector('option[value="basic"]').textContent = t.rulesBasic;
    dom.rulesSelect.querySelector('option[value="gimmick"]').textContent = t.rulesGimmick;
    dom.playLabel.textContent = t.playStyle;
    dom.playSelect.querySelector('option[value="streak"]').textContent = t.playStreak;
    dom.playSelect.querySelector('option[value="level"]').textContent = t.playLevel;
    dom.modeLabel.textContent = t.mode;
    dom.modeSelect.querySelector('option[value="trapper"]').textContent = t.modeTrapper;
    dom.modeSelect.querySelector('option[value="escape"]').textContent = t.modeEscape;
    dom.diffLabel.textContent = t.difficulty;
    dom.diffSelect.querySelector('option[value="easy"]').textContent = t.easy;
    dom.diffSelect.querySelector('option[value="normal"]').textContent = t.normal;
    dom.diffSelect.querySelector('option[value="hard"]').textContent = t.hard;
    dom.cameraLabel.textContent = t.camera;
    dom.cameraSelect.querySelector('option[value="perspective"]').textContent = t.cameraPerspective;
    dom.cameraSelect.querySelector('option[value="ortho"]').textContent = t.cameraOrtho;
    if (dom.fxLabel) dom.fxLabel.textContent = t.fxLabel; // 演出 (17.1)
    if (dom.fxSelect) {
      const opt = (v) => dom.fxSelect.querySelector(`option[value="${v}"]`);
      if (opt('high')) opt('high').textContent = t.fxHigh;
      if (opt('medium')) opt('medium').textContent = t.fxMedium;
      if (opt('low')) opt('low').textContent = t.fxLow;
      dom.fxSelect.setAttribute('aria-label', t.fxLabel);
    }
    if (dom.langLabel) dom.langLabel.textContent = t.langLabel;
    if (dom.dashBtn) dom.dashBtn.textContent = t.dash;
    if (dom.jumpBtn) dom.jumpBtn.textContent = t.jump;
    if (dom.stopDashBtn) dom.stopDashBtn.textContent = t.stopDash;
    dom.newGameBtn.textContent = t.newGame;
    dom.routeBtn.textContent = t.route;
    dom.levelSelectBtn.textContent = t.levelsSelect;
    dom.playAgainBtn.textContent = t.playAgain;
    dom.resultLevelsBtn.textContent = t.levelsBtn;
    dom.nextLevelBtn.textContent = t.nextLevel;
    updateLevelLabel();
    updateControls();
    updateStatus();
    renderItemBar();
    renderPower();
    renderBlocks();
    if (dom.resultModal && dom.resultModal.classList.contains('visible')) {
      renderResultExtras();
    }
  }

  function startNewGame() {
    dom.resultModal.classList.remove('visible');
    if (onStart) onStart();
  }

  function winsFor(course, level) {
    if (!getProgress) return 0;
    const p = getProgress();
    const arr = p && p.level && p.level[settings.rules] && p.level[settings.rules][course];
    const n = arr && Number.isInteger(arr[level - 1]) ? arr[level - 1] : 0;
    return Math.min(Math.max(n, 0), 3);
  }

  /** The multi-cat goal line (13.7) for the status row, or ''. */
  function goalLine() {
    const state = controller ? controller.state : null;
    if (!state || !state.catsGoal || !state.cats || (state.catTotal || 1) < 2) return '';
    const lang = getLang();
    if (state.catsGoal === 'anyEscape') {
      return formatEntry(lang, strings.goalAnyEscape, {
        n: state.catTotal || state.cats.length,
      });
    }
    return formatEntry(lang, strings.goalAnyCatch, {
      escaped: state.escaped || 0,
      total: state.catTotal || state.cats.length,
    });
  }

  function updateStatus() {
    const parts = [isPlayerTurn ? strings.yourTurn : strings.thinking];
    const goal = goalLine();
    if (goal) parts.push(goal);
    // 18.2: the trapper's per-turn budget (1 per free cat, +1 per double)
    const live = controller ? controller.state : null;
    if (isPlayerTurn && live && live.turn === 'trapper' && (live.blocksLeft || 1) > 1) {
      parts.push(formatEntry(getLang(), strings.blocksLeftLine, { n: live.blocksLeft }));
    }
    parts.push(`${strings.move} ${moveCount}`);
    if (seed !== null) parts.push(`${strings.seed} ${seed}`);
    if (settings.play === 'streak' && getProgress) {
      // 16.3: `@n` marks a streak played away from the center count
      const center = streakRange(settings.role, settings.difficulty).center;
      const blocks = currentBlocks();
      const at = blocks !== center ? `@${blocks}` : '';
      const key = `${settings.rules}.${settings.role}.${settings.difficulty}${at}`;
      const p = getProgress();
      const s = (p && p.streak && p.streak[key]) || { current: 0, best: 0 };
      parts.push(fmt(strings.streakLine, { current: s.current, best: s.best }));
    }
    dom.statusLine.textContent = parts.join(' · ');
  }

  function updateLevelLabel() {
    const show = settings.play === 'level';
    dom.levelLabel.hidden = !show;
    if (!show) return;
    const wins = winsFor(settings.role, settings.level);
    dom.levelLabel.textContent = `L${settings.level} ${'●'.repeat(wins)}${'○'.repeat(3 - wins)}`;
  }

  /** Visibility of the axis controls + texts that depend on settings. */
  function updateControls() {
    // 14.6: level play gets the same difficulty select as streak play
    // (it only changes the initial block count)
    dom.difficultyControl.hidden = false;
    dom.levelSelectBtn.hidden = settings.play !== 'level';
    dom.newGameBtn.textContent =
      settings.play === 'level' ? strings.newGameLevel : strings.newGame;
    updateLevelLabel();
    // 16.3: the fine-tuning slider sits next to the difficulty select
    renderBlocks();
  }

  function renderItemBar() {
    const state = controller ? controller.state : null;
    const inGimmick = !!(state && state.items);
    dom.itemBar.hidden = !inGimmick;
    if (!inGimmick || !playerSide) return;
    const items = state.items;
    if (playerSide === 'cat') {
      const n = items.cat.hammer;
      dom.itemBtn.textContent = fmt(strings.useHammer, { n });
      dom.aiItems.textContent = fmt(strings.aiDouble, { n: items.trapper.double });
      dom.itemBtn.disabled = n === 0 || !isPlayerTurn;
    } else {
      const n = items.trapper.double;
      dom.itemBtn.textContent = fmt(strings.useDouble, { n });
      dom.aiItems.textContent = fmt(strings.aiHammer, { n: items.cat.hammer });
      dom.itemBtn.disabled = n === 0 || !isPlayerTurn;
    }
    dom.itemBtn.setAttribute('aria-pressed', String(armed));
  }

  /** The 14.5 power gauge + dash / jump / stop-dash buttons. */
  function renderPower() {
    const state = controller ? controller.state : null;
    const show = !!(state && state.features && state.items);
    if (dom.powerBar) dom.powerBar.hidden = !show;
    if (!show) return;
    const pipsOn = Math.max(0, Math.min(6, state.power || 0));
    for (let k = 0; k < pips.length; k++) {
      if (k < pipsOn) pips[k].classList.add('on');
      else pips[k].classList.remove('on');
    }
    if (dom.powerGauge) {
      dom.powerGauge.setAttribute('aria-label', fmt(strings.powerGauge, { n: pipsOn }));
      dom.powerGauge.title = fmt(strings.powerGauge, { n: pipsOn });
      // Rev. 6 (17.2): the full gauge pulses
      if (pipsOn >= 6) dom.powerGauge.classList.add('full');
      else dom.powerGauge.classList.remove('full');
    }
    const canUse = (kind) =>
      isPlayerTurn && playerSide === 'cat' && !!controller && !!controller.canUsePower
        ? controller.canUsePower(kind)
        : false;
    const stateArm = state.armed ? state.armKind || 'hammer' : null;
    if (dom.dashBtn) {
      dom.dashBtn.hidden = !(state.features && state.features.dash);
      dom.dashBtn.disabled = !canUse('dash');
      dom.dashBtn.setAttribute('aria-pressed', String(stateArm === 'dash'));
    }
    if (dom.jumpBtn) {
      dom.jumpBtn.hidden = !(state.features && state.features.jump);
      dom.jumpBtn.disabled = !canUse('jump');
      dom.jumpBtn.setAttribute('aria-pressed', String(stateArm === 'jump'));
    }
    if (dom.stopDashBtn) {
      dom.stopDashBtn.hidden = !(state.armed && state.armKind === 'dash');
      dom.stopDashBtn.disabled = !isPlayerTurn;
    }
  }

  function updateInteractive() {
    dom.routeBtn.disabled = !isPlayerTurn;
    renderItemBar();
    renderPower();
  }

  /** Extra lines/buttons of the result modal (streak, 勝ち n/3, rewards…). */
  function renderResultExtras() {
    const isLevel = settings.play === 'level';
    const streak = lastResult ? lastResult.streak : null;
    const showStreak = settings.play === 'streak' && !!streak;
    dom.resultStreak.hidden = !showStreak;
    if (showStreak) dom.resultStreak.textContent = fmt(strings.streakLine, streak);

    dom.resultProgress.hidden = !isLevel;
    if (isLevel) {
      const wins =
        lastResult && Number.isInteger(lastResult.wins)
          ? lastResult.wins
          : winsFor(settings.role, settings.level);
      dom.resultProgress.textContent = formatEntry(getLang(), strings.winCount, { n: wins });
    }

    // 14.4-2: picked-up items (from the item cells) and the win bonus
    const r = lastResult ? lastResult.rewards : null;
    const picked = (lastResult && lastResult.picked) || null;
    const bits = [];
    if (picked && picked.hammer) {
      bits.push(
        formatEntry(getLang(), strings.rewardPicked, {
          n: picked.hammer,
          item: strings.itemHammer,
        }),
      );
    }
    if (picked && picked.double) {
      bits.push(
        formatEntry(getLang(), strings.rewardPicked, {
          n: picked.double,
          item: strings.itemDouble,
        }),
      );
    }
    if (r && r.hammer) {
      bits.push(
        formatEntry(getLang(), strings.rewardBonus, { n: r.hammer, item: strings.itemHammer }),
      );
    }
    if (r && r.double) {
      bits.push(
        formatEntry(getLang(), strings.rewardBonus, { n: r.double, item: strings.itemDouble }),
      );
    }
    dom.resultRewards.hidden = bits.length === 0;
    dom.resultRewards.textContent = bits.join('  ');

    dom.playAgainBtn.hidden = false;
    dom.resultLevelsBtn.hidden = !isLevel;
    dom.nextLevelBtn.hidden = !(
      isLevel &&
      lastResult &&
      lastResult.unlockedNext &&
      settings.level < 20
    );
  }

  /** Result text: multi-cat goals use their own strings (13.7). */
  function resultText(status, mode) {
    const state = controller ? controller.state : null;
    if (state && state.catsGoal && (state.catTotal || 1) > 1) {
      const goal = state.catsGoal;
      if (goal === 'anyEscape') {
        if (status === 'catWin') {
          return mode === 'trapper' ? strings.mcEscaped : strings.catWinEscape;
        }
        return mode === 'trapper' ? strings.mcCaughtAll : strings.trapperWinEscape;
      }
      // anyCatch
      if (status === 'catWin') return strings.mcAllEscaped;
      if (mode === 'trapper') return strings.mcCaughtAll;
      return formatEntry(getLang(), strings.mcStuck, {
        n: (state.cats && state.cats.length) || 1,
      });
    }
    const suffix = mode === 'trapper' ? 'Trapper' : 'Escape';
    const key = `${status === 'catWin' ? 'catWin' : 'trapperWin'}${suffix}`;
    return strings[key] || status;
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
      updateInteractive();
    },

    /**
     * @param {'playing'|'catWin'|'trapperWin'} status
     * @param {number} mc
     */
    showResult(status, mc) {
      moveCount = mc;
      updateStatus();
      dom.routeBtn.disabled = true;
      dom.itemBtn.disabled = true;
      if (dom.dashBtn) dom.dashBtn.disabled = true;
      if (dom.jumpBtn) dom.jumpBtn.disabled = true;
      if (dom.stopDashBtn) dom.stopDashBtn.hidden = true;
      // the message must match the game that just ended — the player may
      // already have switched the rules/role select (Rev. 3 fix, kept in 4)
      const mode = controller && controller.state ? controller.state.mode : settings.role;
      dom.resultText.textContent = resultText(status, mode);
      dom.resultMoves.textContent = `${strings.move}: ${mc}`;
      lastResult = null; // extras arrive with showResultInfo (same tick)
      renderResultExtras();
      dom.resultModal.classList.add('visible');
    },

    /**
     * Progress-aware extras for the result modal; called by main.js right
     * after `onGameOver` (recordResult → saveProgress). `picked` counts
     * the items picked up from item cells during the game (14.4-2).
     * @param {{play:'streak'|'level',
     *          streak:{current:number,best:number}|null,
     *          rewards:{hammer:number,double:number}|null,
     *          picked?:{hammer:number,double:number}|null,
     *          unlockedNext:boolean, wins:number}} info
     */
    showResultInfo(info) {
      lastResult = info;
      renderResultExtras();
      updateStatus(); // the status line's streak may just have changed
    },

    /**
     * @param {number} s
     */
    setSeed(s) {
      seed = s;
      updateStatus();
      updateInteractive();
    },

    /**
     * In-game item counts (gimmick rules only — the controller skips basic
     * states entirely).
     * @param {{hammer:number, double:number}} items full `state.items`
     * @param {'trapper'|'cat'} side the player's side
     * @param {boolean} isArmed
     */
    setInventory(items, side, isArmed) {
      playerSide = side;
      armed = isArmed;
      renderItemBar();
      renderPower();
      // Rev. 6 (17.3): the pulsing edge ring while a double is armed
      if (onDoubleArmed) onDoubleArmed(side === 'trapper' && isArmed);
    },

    /**
     * The 14.5 power gauge feed (the values live on the state, which
     * `renderPower` reads; this call just refreshes the gauge).
     */
    setPower() {
      renderPower();
    },

    /**
     * Toast for `hud.notify(key)`; unknown keys (player arm/disarm) are
     * silent — the item button shows those through `aria-pressed`.
     * @param {string} key
     */
    notify(key) {
      // Rev. 6 (17.3): an AI double pulses the edge ring briefly
      if (key === 'aiDouble' && onDoubleArmed) {
        onDoubleArmed(true);
        setTimeout(() => {
          if (onDoubleArmed) onDoubleArmed(false);
        }, 2500);
      }
      const text = {
        aiDouble: strings.toastAiDouble,
        aiHammer: strings.toastAiHammer,
        pickup: strings.toastPickup,
        tunnel: strings.toastTunnel,
        ice: strings.toastIce,
        spring: strings.toastSpring,
        crumble: strings.toastCrumble,
        fish: strings.toastFish,
        storm: strings.toastStorm,
        dash: strings.toastDash,
        jump: strings.toastJump,
        aiDash: strings.toastAiDash,
        aiJump: strings.toastAiJump,
      }[key];
      if (!text || !dom.toastArea) return;
      const toast = document.createElement('div');
      toast.className = 'toast';
      toast.textContent = text;
      dom.toastArea.appendChild(toast);
      setTimeout(() => {
        if (toast.parentNode) toast.parentNode.removeChild(toast);
      }, 1500);
    },

    /**
     * Wire the controls. Called once after the controller exists.
     * @param {{controller: import('../game/controller.js').GameController,
     *          levelSelect?: {open():void, refresh?():void},
     *          getProgress?: () => import('../game/play/progress.js').Progress,
     *          onStart?: () => void,
     *          onCameraMode?: (mode:'perspective'|'ortho') => void,
     *          onFxQuality?: (fx:'high'|'medium'|'low') => void,
     *          onDoubleArmed?: (on:boolean) => void}} deps
     */
    attach({
      controller: c,
      levelSelect: ls,
      getProgress: gp,
      onStart: start,
      onCameraMode: cam,
      onFxQuality: fxq,
      onDoubleArmed: dmx,
    }) {
      controller = c;
      levelSelect = ls || null;
      getProgress = gp || null;
      onStart = start || null;
      onCameraMode = cam || null;
      onFxQuality = fxq || null;
      onDoubleArmed = dmx || null;

      dom.rulesSelect.value = settings.rules;
      dom.playSelect.value = settings.play;
      dom.modeSelect.value = settings.role;
      dom.diffSelect.value = settings.difficulty;
      dom.cameraSelect.value = 'perspective';

      // language select (13.9): options show their own names
      if (dom.langSelect) {
        dom.langSelect.textContent = '';
        for (const code of LANGS) {
          const opt = document.createElement('option');
          opt.value = code;
          opt.textContent = LANG_NAMES[code] || code;
          dom.langSelect.appendChild(opt);
        }
        dom.langSelect.value = settings.lang;
        dom.langSelect.setAttribute('aria-label', strings.langLabel);
      }
      // start on the saved language (startup uses it first, 13.9)
      if (!pinned && settings.lang) setLang(settings.lang);

      applyStrings();
      updateControls();
      updateInteractive();

      dom.rulesSelect.addEventListener('change', () => {
        settings.rules = dom.rulesSelect.value === 'gimmick' ? 'gimmick' : 'basic';
        settings.course = settings.role;
        persist();
        updateControls();
        startNewGame();
      });
      dom.playSelect.addEventListener('change', () => {
        settings.play = dom.playSelect.value === 'level' ? 'level' : 'streak';
        persist();
        updateControls();
        startNewGame();
        if (settings.play === 'level' && levelSelect) levelSelect.open();
      });
      dom.modeSelect.addEventListener('change', () => {
        settings.role = dom.modeSelect.value === 'escape' ? 'escape' : 'trapper';
        settings.course = settings.role;
        persist();
        updateControls();
        startNewGame();
      });
      dom.diffSelect.addEventListener('change', () => {
        const v = dom.diffSelect.value;
        settings.difficulty = ['easy', 'normal', 'hard'].includes(v) ? v : 'normal';
        persist();
        updateControls();
        startNewGame();
      });
      if (dom.blocksSlider) {
        // 16.3: dragging updates the label at once, releasing starts a game
        dom.blocksSlider.addEventListener('input', () => {
          saveSliderValue();
          renderBlocks();
        });
        dom.blocksSlider.addEventListener('change', () => {
          saveSliderValue();
          renderBlocks();
          startNewGame();
        });
      }
      dom.cameraSelect.addEventListener('change', () => {
        // the camera never restarts the game
        if (onCameraMode) {
          onCameraMode(dom.cameraSelect.value === 'ortho' ? 'ortho' : 'perspective');
        }
      });
      if (dom.fxSelect) {
        // 演出 (Rev. 6, 17.1): saved, never restarts the game
        dom.fxSelect.value = settings.fx;
        dom.fxSelect.addEventListener('change', () => {
          const v = dom.fxSelect.value;
          settings.fx = ['high', 'medium', 'low'].includes(v) ? v : 'medium';
          persist();
          if (onFxQuality) onFxQuality(settings.fx);
        });
      }
      if (dom.langSelect) {
        dom.langSelect.addEventListener('change', () => {
          // switching applies at once and never restarts the game (13.9)
          const code = dom.langSelect.value;
          settings.lang = code;
          persist();
          if (!pinned) setLang(code);
          else {
            strings = getStrings(code);
            applyStrings();
          }
          if (levelSelect && levelSelect.refresh) levelSelect.refresh();
        });
      }
      if (!pinned) {
        onLangChange((table) => {
          strings = table;
          applyStrings();
          if (levelSelect && levelSelect.refresh) levelSelect.refresh();
        });
      }

      dom.newGameBtn.addEventListener('click', () => startNewGame());
      dom.routeBtn.addEventListener('click', () => {
        if (controller) controller.showHint();
      });
      dom.levelSelectBtn.addEventListener('click', () => {
        if (levelSelect) levelSelect.open();
      });
      dom.itemBtn.addEventListener('click', () => {
        if (controller) controller.useItem();
      });
      if (dom.dashBtn) {
        dom.dashBtn.addEventListener('click', () => {
          if (controller) controller.usePower('dash');
        });
      }
      if (dom.jumpBtn) {
        dom.jumpBtn.addEventListener('click', () => {
          if (controller) controller.usePower('jump');
        });
      }
      if (dom.stopDashBtn) {
        dom.stopDashBtn.addEventListener('click', () => {
          if (controller) controller.stopDash();
        });
      }

      dom.playAgainBtn.addEventListener('click', () => startNewGame());
      dom.resultLevelsBtn.addEventListener('click', () => {
        if (levelSelect) levelSelect.open();
      });
      dom.nextLevelBtn.addEventListener('click', () => {
        setLevelAndStart(settings.level + 1, settings.role);
      });
    },

    /**
     * Play `<course> level <n>`: the picked course becomes the player's
     * role (level play runs one course), then a new game starts.
     * @param {number} level
     * @param {'trapper'|'escape'} course
     */
    setLevelAndStart(level, course) {
      settings.level = Math.min(Math.max(Math.floor(level) || 1, 1), 20);
      if (course === 'trapper' || course === 'escape') {
        settings.role = course;
        settings.course = course;
      }
      persist();
      updateControls();
      startNewGame();
    },

    /**
     * @returns {Settings & {mode:'trapper'|'escape', blocks:number}} settings
     * (with the legacy `mode` alias of `role`, the old settings key, and the
     * 16.3 block count the next game plays with)
     */
    getSettings() {
      return { ...settings, mode: settings.role, blocks: currentBlocks() };
    },
  };
}
