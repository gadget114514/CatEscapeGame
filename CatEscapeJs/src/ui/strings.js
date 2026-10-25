/**
 * String loader (spec 13.9): `getStrings(lang)`, `fmt(str, vars)`,
 * `plural(lang, n, forms)` and `detectLang(tag)`. The per-language tables
 * live in `src/ui/i18n/*.js` (flat objects with identical keys; `en` is
 * the key reference). The current language is module state: `setLang`
 * switches at once (no game restart) and notifies the listeners;
 * `strings` is a live proxy onto the current table, so code that imports
 * `strings` keeps working across switches. Japanese stays the fallback.
 */
import ja from './i18n/ja.js';
import en from './i18n/en.js';
import es from './i18n/es.js';
import fr from './i18n/fr.js';
import de from './i18n/de.js';
import ru from './i18n/ru.js';

/** Supported languages, in select order. */
export const LANGS = ['ja', 'en', 'es', 'fr', 'de', 'ru'];

/** Native names for the language select (each option shows its own name). */
export const LANG_NAMES = {
  ja: '日本語',
  en: 'English',
  es: 'Español',
  fr: 'Français',
  de: 'Deutsch',
  ru: 'Русский',
};

/** Every loaded table by language code. */
export const STRINGS = { ja, en, es, fr, de, ru };

/**
 * Pick the string table for a BCP-47 language tag (default: ja).
 * @param {string} [language]
 * @returns {Record<string, any>}
 */
export function detectStrings(language) {
  return STRINGS[detectLang(language)] || STRINGS.ja;
}

/**
 * The table of a language code (any unknown code falls back to ja).
 * @param {string} [lang]
 * @returns {Record<string, any>}
 */
export function getStrings(lang) {
  return STRINGS[lang] || STRINGS.ja;
}

/**
 * The supported language for a BCP-47 tag: the prefix when supported,
 * else the default **ja** (spec 13.9).
 * @param {string} [language]
 * @returns {'ja'|'en'|'es'|'fr'|'de'|'ru'}
 */
export function detectLang(language) {
  const tag = String(language || 'ja').toLowerCase();
  const prefix = tag.split('-')[0];
  return /** @type {any} */ (LANGS.includes(prefix) ? prefix : 'ja');
}

/**
 * Fill `{name}` placeholders: `fmt('Wins {n}/3', {n: 2})` → `Wins 2/3`.
 * @param {string} template
 * @param {Record<string, string|number>} [vars]
 * @returns {string}
 */
export function fmt(template, vars = {}) {
  return String(template).replace(/\{(\w+)\}/g, (m, k) =>
    Object.prototype.hasOwnProperty.call(vars, k) ? String(vars[k]) : m,
  );
}

/**
 * Pick the counted form for `lang` (spec 13.9): counted strings are
 * `{one, few?, many?, other}` objects and `Intl.PluralRules` selects the
 * category (Russian needs one/few/many; Japanese uses `other` only).
 * Plain strings pass through unchanged.
 * @param {string} lang
 * @param {number} n
 * @param {{one?:string, few?:string, many?:string, other?:string}|string} forms
 * @returns {string}
 */
export function plural(lang, n, forms) {
  if (typeof forms === 'string') return forms;
  const category = new Intl.PluralRules(lang).select(n);
  return forms[category] ?? forms.other ?? '';
}

/**
 * Format one table entry for `lang`: counted entries are plural objects
 * (`{one, few, many, other}`, spec 13.9) and pick their form via
 * `plural()`; plain strings pass through `fmt`.
 * @param {string} lang
 * @param {any} value table entry (string or plural forms)
 * @param {Record<string, string|number>} [vars]
 * @returns {string}
 */
export function formatEntry(lang, value, vars = {}) {
  if (value && typeof value === 'object') {
    const n = Number(vars.n ?? 0);
    return fmt(plural(lang, n, value), vars);
  }
  return fmt(value, vars);
}

/* ------------------------------------------------------------------ state */

let currentLang = detectLang(
  typeof navigator !== 'undefined' && navigator.language ? navigator.language : 'ja',
);
/** @type {Set<(strings:Record<string,any>, lang:string)=>void>} */
const listeners = new Set();

/** @returns {string} the active language code */
export function getLang() {
  return currentLang;
}

/**
 * Switch the language now: the tables swap, `<html lang>` follows and
 * every listener re-renders. Never restarts the game (spec 13.9).
 * @param {string} lang
 */
export function setLang(lang) {
  const next = STRINGS[lang] ? lang : 'ja';
  if (next === currentLang) return;
  currentLang = next;
  if (typeof document !== 'undefined' && document.documentElement) {
    document.documentElement.lang = next;
  }
  for (const fn of listeners) fn(STRINGS[next], next);
}

/**
 * Subscribe to language switches (used by the HUD / level select).
 * @param {(strings:Record<string,any>, lang:string)=>void} fn
 * @returns {() => void} unsubscribe
 */
export function onLangChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** The current table as a live object (follows `setLang`). */
export const strings = new Proxy(
  {},
  {
    get(_t, key) {
      const table = STRINGS[currentLang] || STRINGS.ja;
      return table[/** @type {string} */ (key)];
    },
    has(_t, key) {
      const table = STRINGS[currentLang] || STRINGS.ja;
      return key in table;
    },
    ownKeys() {
      return Object.keys(STRINGS[currentLang] || STRINGS.ja);
    },
    getOwnPropertyDescriptor() {
      return { enumerable: true, configurable: true };
    },
  },
);
