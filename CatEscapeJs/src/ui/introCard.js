/**
 * Gimmick intro cards (spec 13.4): the first time a level with a `new`
 * gimmick starts, a card shows its icon, name and one-line rule. The card
 * is remembered in the progress as `seenIntro` (main.js records it).
 * Pure DOM — no Babylon.
 */
import { strings as defaultStrings } from './strings.js';
import { labeledGimmickIcon, ICON_NAME_KEY } from './gimmickIcons.js';

/** Intro id → icon id (some ids are items/goals, not cell kinds). */
const INTRO_ICON = {
  stone: 'stone',
  double: 'double',
  tunnel: 'tunnel',
  ice: 'ice',
  fish: 'fish',
  arrow: 'arrow',
  brittle: 'brittle',
  spring: 'spring',
  hammer: 'hammer',
  cats2Escape: 'cats2',
  cats2Catch: 'cats2',
  cats3Escape: 'cats3',
  cats3Catch: 'cats3',
};

/** @param {string} id @returns {string} string-table key for the name */
function nameKey(id) {
  return `introName${id.charAt(0).toUpperCase()}${id.slice(1)}`;
}

/** @param {string} id @returns {string} string-table key for the rule */
function ruleKey(id) {
  return `introRule${id.charAt(0).toUpperCase()}${id.slice(1)}`;
}

/**
 * @param {{strings?: Record<string, any>}} [opts]
 */
export function createIntroCard(opts = {}) {
  const strings = opts.strings || defaultStrings;
  /** @type {HTMLElement|null} */
  let overlay = null;
  /** @type {HTMLElement|null} */
  let iconBox = null;
  /** @type {HTMLElement|null} */
  let nameEl = null;
  /** @type {HTMLElement|null} */
  let ruleEl = null;

  function build() {
    overlay = document.createElement('div');
    overlay.id = 'intro-overlay';
    overlay.hidden = true;

    const card = document.createElement('div');
    card.id = 'intro-card';

    const heading = document.createElement('h2');
    heading.id = 'intro-heading';

    iconBox = document.createElement('div');
    iconBox.id = 'intro-icon';

    nameEl = document.createElement('p');
    nameEl.id = 'intro-name';

    ruleEl = document.createElement('p');
    ruleEl.id = 'intro-rule';

    const okBtn = document.createElement('button');
    okBtn.type = 'button';
    okBtn.id = 'intro-ok';
    okBtn.textContent = strings.close;
    okBtn.addEventListener('click', () => {
      overlay.hidden = true;
    });

    card.appendChild(heading);
    card.appendChild(iconBox);
    card.appendChild(nameEl);
    card.appendChild(ruleEl);
    card.appendChild(okBtn);
    overlay.appendChild(card);
    document.body.appendChild(overlay);
  }

  return {
    /**
     * Show the intro card for `id` (icon + name + one-line rule).
     * @param {string} id level `intro` id (e.g. 'tunnel', 'cats2Catch')
     */
    show(id) {
      if (!overlay) build();
      const t = strings;
      const iconId = INTRO_ICON[id] || 'item';
      iconBox.textContent = '';
      iconBox.appendChild(labeledGimmickIcon(iconId, t[ICON_NAME_KEY[iconId]] || ''));
      nameEl.textContent = t[nameKey(id)] || id;
      ruleEl.textContent = t[ruleKey(id)] || '';
      overlay.hidden = false;
    },

    isOpen() {
      return !!overlay && !overlay.hidden;
    },
  };
}
