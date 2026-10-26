import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Tests that simulate outages trigger the server's own operational logs ("lut-lunch-mcp: …").
    // Those are expected; anything else written to the console still shows.
    onConsoleLog: (log) => !log.startsWith('lut-lunch-mcp:'),
    projects: [
      {
        extends: true,
        test: { name: 'unit', include: ['test/**/*.test.ts'], exclude: ['test/perf/**'] },
      },
      {
        // CPU budget tests time real work, so they run alone after everything else: parallel
        // test files would compete for the CPU and inflate the timings.
        extends: true,
        test: { name: 'perf', include: ['test/perf/**/*.test.ts'], sequence: { groupOrder: 1 } },
      },
    ],
  },
});
