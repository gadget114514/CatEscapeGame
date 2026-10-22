/**
 * Localized UI strings (Japanese and English).
 * Japanese by default; English when navigator.language starts with "en".
 */

/** @type {{ja: Record<string,string>, en: Record<string,string>}} */
export const STRINGS = {
  ja: {
    title: 'Cat Escape',
    mode: 'モード',
    modeTrapper: 'ねこをつかまえる',
    modeEscape: 'ねことしてにげる',
    difficulty: '難易度',
    easy: 'やさしい',
    normal: 'ふつう',
    hard: 'むずかしい',
    newGame: 'あたらしいゲーム',
    hint: 'ルートを表示',
    yourTurn: 'あなたの番',
    thinking: 'かんがえちゅう…',
    move: '手数',
    seed: 'シード',
    catWinTrapper: 'ねこはにげた！',
    catWinEscape: 'にげきれた！',
    trapperWinTrapper: 'ねこをつかまえた！',
    trapperWinEscape: 'つかまってしまった…',
    playAgain: 'もういちど',
  },
  en: {
    title: 'Cat Escape',
    mode: 'Mode',
    modeTrapper: 'Trap the Cat',
    modeEscape: 'Cat Escape',
    difficulty: 'Difficulty',
    easy: 'Easy',
    normal: 'Normal',
    hard: 'Hard',
    newGame: 'New Game',
    hint: 'Show path hint',
    yourTurn: 'Your turn',
    thinking: 'Thinking...',
    move: 'Moves',
    seed: 'Seed',
    catWinTrapper: 'The cat escaped!',
    catWinEscape: 'You escaped!',
    trapperWinTrapper: 'You trapped the cat!',
    trapperWinEscape: 'You were caught!',
    playAgain: 'Play again',
  },
};

/**
 * Pick the string table for a BCP-47 language tag (default: ja).
 * @param {string} [language]
 * @returns {Record<string,string>}
 */
export function detectStrings(language) {
  const lang = (language || 'ja').toLowerCase();
  return lang.startsWith('en') ? STRINGS.en : STRINGS.ja;
}

/** Strings for the current navigator language (ja unless "en…"). */
export const strings = detectStrings(
  typeof navigator !== 'undefined' && navigator.language ? navigator.language : 'ja',
);
