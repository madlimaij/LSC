import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
    environment: 'node',
    // Tests never call a real model provider (CLAUDE.md, D7).
    // Guard against accidental use of real credentials in the test process.
    env: {
      ANTHROPIC_API_KEY: '',
    },
    testTimeout: 20000,
  },
});
