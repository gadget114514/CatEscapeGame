/**
 * Seeded randomness. Every random decision in the game goes through here
 * so tests and replays are reproducible.
 */

/**
 * mulberry32 PRNG.
 * @param {number} seed unsigned 32-bit seed
 * @returns {() => number} function returning a float in [0, 1)
 */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Pick a random element of `arr` using `rng`.
 * @template T
 * @param {() => number} rng
 * @param {T[]} arr
 * @returns {T|undefined} undefined when the array is empty
 */
export function pick(rng, arr) {
  if (!arr || arr.length === 0) return undefined;
  return arr[Math.floor(rng() * arr.length)];
}

/**
 * Fisher–Yates shuffle in place.
 * @template T
 * @param {() => number} rng
 * @param {T[]} arr
 * @returns {T[]} the same array, shuffled
 */
export function shuffle(rng, arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
}
