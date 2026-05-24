import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  resolve: {
    // Prefer TypeScript sources over any stale compiled `.js` artifacts that may
    // sit alongside them in `src/`. Without this, Vite's default extension order
    // (`.js` before `.ts`) loads the stale `.js` files, so coverage of `src/**`
    // would report 0% even though the suite exercises the code.
    extensions: ['.ts', '.mts', '.mjs', '.js', '.tsx', '.jsx', '.json'],
    alias: {
      // Test against built output (what users actually consume)
      // This ensures tests validate the published SDK behavior
      '../src/pocketping': resolve(__dirname, 'dist/index.js'),
    },
  },
  test: {
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'istanbul',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['**/*.d.ts', 'src/index.ts', 'src/test-utils.ts', 'src/**/types.ts'],
    },
  },
});
