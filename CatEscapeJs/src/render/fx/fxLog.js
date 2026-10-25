/**
 * Fail-soft logging for the fx system (task 26 fix pass): every broken
 * effect logs **once** and then stays silent, so a missing engine
 * extension or a Babylon API change can never spam the console or stop
 * the game from starting.
 */
const warned = new Set();

/**
 * Log `err` under `key` the first time only.
 * @param {string} key stable identifier (e.g. 'particles.fire.confetti')
 * @param {unknown} err
 */
export function fxWarnOnce(key, err) {
  if (warned.has(key)) return;
  warned.add(key);
  try {
    // eslint-disable-next-line no-console
    console.warn(`[fx] disabled "${key}"`, err);
  } catch {
    /* no console (locked-down renderer) — staying silent is fine */
  }
}

/** True once a failure was logged under `key` (tests). */
export function fxFailed(key) {
  return warned.has(key);
}

/** Test helper: forget the logged failures. */
export function fxResetWarnings() {
  warned.clear();
}
