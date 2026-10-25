/**
 * Level select screen (spec 12.8 + 13.4/13.8/14.6): a full-screen DOM
 * overlay with a rules heading, the two course tabs, the difficulty chart
 * toggle, a 5×4 grid of level cards (number, wins `●●○`, gimmick icons,
 * a CSS lock shape, AI strength), the saved inventory (gimmick only) and
 * a close button. Pure DOM — no Babylon.
 */
import { strings as liveStrings, fmt } from './strings.js';
import { getLevel, levelFeatures, GIMMICK_KEYS } from '../game/play/levels.js';
import { isUnlocked, highestUnlocked } from '../game/play/progress.js';
import { UNLOCKS } from '../game/gimmick/registry.js';
import { gimmickIcon } from './gimmickIcons.js';
import { createDifficultyChart, statsFor } from './difficultyChart.js';

/**
 * @param {{strings?: Record<string, any>,
 *          getSettings?: () => {rules?:string, play?:string, role?:string,
 *                               course?:string, level?:number,
 *                               difficulty?:string},
 *          getProgress?: () => import('../game/play/progress.js').Progress,
 *          onSelect?: (level:number, course:'trapper'|'escape') => void}} [opts]
 */
export function createLevelSelect(opts = {}) {
  /** Live table (follows the language switch, 13.9); tests may pin one. */
  const pinnedStrings = opts.strings || null;
  const strings = () => pinnedStrings || liveStrings;
  const getSettings = opts.getSettings || (() => ({}));
  const getProgress = opts.getProgress || (() => null);
  const onSelect = opts.onSelect || (() => {});

  /** @type {'trapper'|'escape'} currently browsed course tab */
  let course = 'escape';
  /** @type {HTMLElement|null} */
  let overlay = null;
  /** @type {HTMLElement|null} */
  let heading = null;
  /** @type {HTMLElement|null} */
  let grid = null;
  /** @type {HTMLElement|null} */
  let inventory = null;
  /** @type {ReturnType<typeof createDifficultyChart>|null} */
  let chart = null;
  /** @type {Array<{el:HTMLElement, course:'trapper'|'escape'}>} */
  let tabs = [];

  function makeTab(courseId, label) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.setAttribute('role', 'tab');
    btn.textContent = label;
    btn.addEventListener('click', () => {
      course = /** @type {'trapper'|'escape'} */ (courseId);
      render();
      if (chart) chart.refresh();
    });
    tabs.push({ el: btn, course: /** @type {'trapper'|'escape'} */ (courseId) });
    return btn;
  }

  /** Icon ids present on a level card (13.4/13.8 + the 14.5 storm). */
  function cardIcons(lv) {
    const ids = [];
    const s = getSettings();
    if (s.rules === 'gimmick') {
      for (const key of GIMMICK_KEYS) {
        if ((lv.gimmicks && lv.gimmicks[key]) > 0) ids.push(key);
      }
      const f = levelFeatures(lv.course, lv.id);
      if (f.storm) ids.push('storm');
      if ((lv.cats || 1) >= 3) ids.push('cats3');
      else if ((lv.cats || 1) === 2) ids.push('cats2');
    }
    return ids;
  }

  function build() {
    overlay = document.createElement('div');
    overlay.id = 'level-select-overlay';
    overlay.hidden = true;

    const panel = document.createElement('div');
    panel.id = 'level-select-panel';

    heading = document.createElement('h2');
    heading.id = 'level-select-heading';

    const tabBar = document.createElement('div');
    tabBar.id = 'level-select-tabs';
    tabBar.setAttribute('role', 'tablist');
    tabBar.appendChild(makeTab('escape', strings().tabEscape));
    tabBar.appendChild(makeTab('trapper', strings().tabTrap));

    chart = createDifficultyChart({
      getStats: () => statsFor(getSettings().rules === 'basic' ? 'basic' : 'gimmick'),
      getSettings,
      getCourse: () => course, // the browsed tab, not just the saved setting
      getProgress,
      onSelect: (level, c) => {
        close();
        onSelect(level, c);
      },
      strings: pinnedStrings || undefined,
    });
    chart.toggleBtn.setAttribute('aria-expanded', 'false');

    grid = document.createElement('div');
    grid.id = 'level-grid';

    inventory = document.createElement('p');
    inventory.id = 'level-select-inventory';

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.id = 'level-select-close';
    closeBtn.textContent = strings().close;
    closeBtn.addEventListener('click', close);

    panel.appendChild(heading);
    panel.appendChild(tabBar);
    panel.appendChild(chart.toggleBtn);
    panel.appendChild(chart.panel);
    panel.appendChild(grid);
    panel.appendChild(inventory);
    panel.appendChild(closeBtn);
    overlay.appendChild(panel);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close(); // click on the backdrop
    });
    document.body.appendChild(overlay);
  }

  /** One 5×4 grid cell: level number, wins, icons, lock and AI strength. */
  function makeCard(level) {
    const s = getSettings();
    const t = strings();
    const p = getProgress();
    const rules = s.rules === 'gimmick' ? 'gimmick' : 'basic';
    const lv = getLevel(course, level);
    const unlocked = isUnlocked(p, rules, course, level);
    const winsArr = p && p.level && p.level[rules] && p.level[rules][course];
    const wins = Math.min(Math.max((winsArr && winsArr[level - 1]) || 0, 0), 3);

    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'level-card';
    card.disabled = !unlocked;
    const isCurrent = unlocked && s.level === level && (s.role || s.course) === course;
    if (isCurrent) card.classList.add('current');

    const num = document.createElement('span');
    num.className = 'lv-num';
    num.textContent = `L${level}`;

    const dots = document.createElement('span');
    dots.className = 'lv-wins';
    dots.textContent = `${'●'.repeat(wins)}${'○'.repeat(3 - wins)}`;

    const ai = document.createElement('span');
    ai.className = 'lv-ai';
    ai.textContent = t[lv.ai] || lv.ai;

    card.appendChild(num);
    card.appendChild(dots);

    // gimmick icons (13.4): small icons of everything present on the level
    const iconIds = cardIcons(lv);
    if (iconIds.length > 0) {
      const icons = document.createElement('span');
      icons.className = 'lv-gimmicks';
      icons.setAttribute('aria-hidden', 'true');
      for (const id of iconIds) icons.appendChild(gimmickIcon(id));
      card.appendChild(icons);
    }

    if (!unlocked) {
      const lock = document.createElement('span');
      lock.className = 'lv-lock';
      lock.setAttribute('role', 'img');
      lock.setAttribute('aria-label', t.locked);
      card.appendChild(lock);
      card.setAttribute('aria-label', `L${level} ${t.locked}`);
    }
    card.appendChild(ai);

    card.addEventListener('click', () => {
      if (!unlocked) return;
      close();
      onSelect(level, course);
    });
    return card;
  }

  function render() {
    if (!overlay || !heading || !grid || !inventory) return;
    const s = getSettings();
    const t = strings();
    heading.textContent = s.rules === 'gimmick' ? t.headingGimmick : t.headingBasic;
    for (const tb of tabs) {
      tb.el.setAttribute('aria-selected', String(tb.course === course));
      if (tb.course === 'escape') tb.el.textContent = t.tabEscape;
      else tb.el.textContent = t.tabTrap;
    }
    if (overlay.querySelector) {
      const closeBtn = overlay.querySelector('#level-select-close');
      if (closeBtn) closeBtn.textContent = t.close;
    }
    grid.textContent = '';
    for (let n = 1; n <= 20; n++) grid.appendChild(makeCard(n));
    const showInv = s.rules === 'gimmick';
    inventory.hidden = !showInv;
    if (showInv) {
      const p = getProgress();
      const inv = (p && p.inventory) || { hammer: 0, double: 0 };
      const bits = [fmt(t.inventory, { hammer: inv.hammer, double: inv.double })];
      // 13.4: hint while streak play has no gimmicks unlocked yet
      const highest = p ? highestUnlocked(p, 'gimmick', course) : 1;
      if (highestUnlockedIsNone(highest)) bits.push(t.streakUnlockHint);
      inventory.textContent = bits.join(' · ');
    }
    if (chart) {
      chart.toggleBtn.textContent = t.chartTitle;
      chart.refresh();
    }
  }

  /** True while no gimmick is unlocked in streak play (unlock starts at L2). */
  function highestUnlockedIsNone(highest) {
    return highest < (UNLOCKS.stone ?? 2);
  }

  /** Open the overlay (restores the saved course tab, renders fresh data). */
  function open() {
    if (!overlay) build();
    const s = getSettings();
    if (s.course === 'trapper' || s.course === 'escape') course = s.course;
    else if (s.role === 'trapper' || s.role === 'escape') course = s.role;
    overlay.hidden = false;
    render();
    if (chart) chart.refresh();
  }

  function close() {
    if (overlay) overlay.hidden = true;
  }

  return {
    open,
    close,
    isOpen() {
      return !!overlay && !overlay.hidden;
    },
    /** Re-render with fresh strings (language switch, 13.9). */
    refresh() {
      if (overlay && !overlay.hidden) render();
    },
  };
}
