import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // Tests that simulate outages trigger the server's own operational logs ("lut-lunch-mcp: …").
    // Those are expected; anything else written to the console still shows.
    onConsoleLog: (log) => !log.startsWith('lut-lunch-mcp:'),
  },
});
