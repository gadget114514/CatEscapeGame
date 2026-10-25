/**
 * AI-timing assertions for the isolated perf suite.
 *
 * The naive "one call under 100 ms" checks flake under vitest's parallel
 * workers: the first call pays JIT warm-up and — far worse — the wall
 * clock of every call inflates while other test files grind through their
 * own Hard searches on the same machine. That is why **every AI-timing
 * assertion lives in `test/perf/*.perf.test.js`** (run alone, single
 * fork, via `npm run test:perf`) while `npm test` stays deterministic.
 *
 * The perf suite measures **wall-clock** time: median < 100 ms (the real
 * per-move budget) and max < 250 ms (one slow slice must not fail the
 * suite). CPU time is collected too, for diagnosis, but never asserted.
 */
import { expect } from 'vitest';

/**
 * Median of a numeric array (average of the two middle values when even).
 * @param {number[]} xs
 * @returns {number}
 */
export function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * Warm `fn` up once, then time it `samples` times (wall ms first, CPU ms
 * kept for diagnosis).
 * @param {() => void} fn one AI decision (no assertions needed)
 * @param {number} [samples=5]
 * @returns {{wall:number[], cpu:number[]}}
 */
export function timeMoves(fn, samples = 5) {
  fn(); // warm up once — the budget is for steady-state play
  const wall = [];
  const cpu = [];
  for (let i = 0; i < samples; i++) {
    const c0 = process.cpuUsage();
    const t0 = performance.now();
    fn();
    wall.push(performance.now() - t0);
    const d = process.cpuUsage(c0);
    cpu.push((d.user + d.system) / 1000);
  }
  return { wall, cpu };
}

/**
 * Assert the timing budget on **wall-clock** time: median < 100 ms,
 * max < 250 ms. Only call this from `test/perf/*.perf.test.js`.
 * @param {{wall:number[], cpu:number[]}|number[]} samples from `timeMoves`
 *        (a plain array is accepted as wall samples too)
 * @param {string} label
 */
export function expectFast(samples, label) {
  const times = Array.isArray(samples) ? samples : samples.wall;
  expect(times.length, `${label}: samples`).toBeGreaterThan(0);
  const med = median(times);
  const max = Math.max(...times);
  expect(med, `${label}: median wall ${med.toFixed(1)} ms`).toBeLessThan(100);
  expect(max, `${label}: max wall ${max.toFixed(1)} ms`).toBeLessThan(250);
}
