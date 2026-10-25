import { defineConfig, configDefaults } from 'vitest/config';

// `npm run test:perf` runs `vitest run test/perf …`; only then may the
// perf folder be collected (the CLI filter alone does not lift an
// exclude entry).
const runningPerf = process.argv.some((a) => String(a).includes('test/perf'));

export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
  },
  test: {
    environment: 'node',
    passWithNoTests: true,
    // AI-timing assertions live in test/perf and only run via
    // `npm run test:perf` (single fork, no file parallelism) so that
    // `npm test` stays deterministic.
    exclude: [...configDefaults.exclude, ...(runningPerf ? [] : ['test/perf/**'])],
  },
});
