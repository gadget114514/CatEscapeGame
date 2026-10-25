/**
 * Worker-thread entry for the balance/calibrate runners: receives a chunk
 * of simulation jobs, plays them in this thread and posts the results
 * back. One chunk per worker; the parent fans the work out round-robin
 * (`os.cpus().length - 1` workers, spec 13.8).
 */
import { parentPort } from 'node:worker_threads';
import { simulate } from './sim.mjs';

parentPort.on('message', (msg) => {
  if (!msg || msg.type !== 'run') return;
  const results = [];
  for (const job of msg.jobs) {
    const { seedBase, ...rest } = job;
    results.push({ ...rest, seedBase: seedBase ?? 0, ...simulate(job) });
  }
  parentPort.postMessage({ type: 'done', results });
});
