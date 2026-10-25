/**
 * Tiny worker-thread pool: fan a job list out over
 * `os.cpus().length - 1` `simWorker.mjs` threads, round-robin so heavy
 * and light settings mix. Used by `balance` and `calibrate` (spec 13.8).
 *
 * Results come back **in job order** (15.2): every job carries its full
 * setting key (`jobKey`), the worker echoes it back, and the pool
 * reassembles the result list by the per-job index and asserts that the
 * echoed keys match. Before this fix the pool flattened the per-worker
 * chunks (job 0, N, 2N… first), so an aggregator that matched results to
 * settings by position got a permutation — the calibration "0 % or 100 %
 * next to each other" bug.
 */
import os from 'node:os';
import { Worker } from 'node:worker_threads';

/** Default worker count: every logical CPU except one (spec 13.8). */
export function defaultWorkers() {
  return Math.max(1, (os.cpus().length || 2) - 1);
}

/**
 * The full setting key of one job (15.2): every field the simulation
 * reads, in a fixed order. Jobs and results carry it so a result can be
 * matched back to the job it belongs to, whatever order it arrives in.
 * @param {{rules?:string, course?:string, level?:number, difficulty?:string,
 *          profile?:string, blocks?:number, games?:number, seedBase?:number}} job
 * @returns {string}
 */
export function jobKey(job) {
  return [
    job.rules ?? null,
    job.course ?? null,
    job.level ?? null,
    job.difficulty ?? null,
    job.profile ?? null,
    job.blocks ?? null,
    job.games ?? null,
    job.seedBase ?? 0,
  ].join('|');
}

/**
 * Run every job through the pool.
 * @param {Array<object>} jobs each must be `sim.mjs`-compatible
 * @param {{workers?:number}} [opts]
 * @returns {Promise<Array<object>>} one result object per job, in job
 *                                  order; each result echoes its job's
 *                                  `key` and `index` (asserted here)
 */
export function runJobs(jobs, opts = {}) {
  const workers = Math.max(1, Math.min(opts.workers ?? defaultWorkers(), jobs.length || 1));
  /** @type {Array<Array<object>>} */
  const chunks = Array.from({ length: workers }, () => []);
  jobs.forEach((job, index) => chunks[index % workers].push({ ...job, key: jobKey(job), index }));
  return Promise.all(
    chunks.map((chunk) => {
      if (chunk.length === 0) return Promise.resolve([]);
      return new Promise((resolve, reject) => {
        const w = new Worker(new URL('./simWorker.mjs', import.meta.url));
        w.on('message', (msg) => {
          resolve(msg.results);
          w.terminate();
        });
        w.on('error', reject);
        w.postMessage({ type: 'run', jobs: chunk });
      });
    }),
  ).then((parts) => {
    const flat = parts.flat();
    const results = new Array(jobs.length);
    for (const r of flat) {
      const i = r && r.index;
      if (!Number.isInteger(i) || i < 0 || i >= jobs.length) {
        throw new Error(`pool: result without a valid job index: ${JSON.stringify(r && r.key)}`);
      }
      const want = jobKey(jobs[i]);
      if (r.key !== want) throw new Error(`pool: result ${i} key ${r.key} ≠ job key ${want}`);
      results[i] = r;
    }
    if (flat.length !== jobs.length || results.some((r) => !r)) {
      throw new Error(`pool: expected ${jobs.length} results, got ${flat.length}`);
    }
    return results;
  });
}
