import { defineConfig } from 'tsup';
import pkg from './package.json';

export default defineConfig([
  // CJS + ESM builds (for npm imports)
  {
    entry: ['src/index.ts'],
    format: ['cjs', 'esm'],
    dts: true,
    clean: true,
    define: {
      __VERSION__: JSON.stringify(pkg.version),
    },
  },
  // IIFE build for CDN (minified)
  {
    entry: { 'pocketping.min': 'src/index.ts' },
    format: ['iife'],
    globalName: 'PocketPing',
    minify: true,
    define: {
      __VERSION__: JSON.stringify(pkg.version),
    },
  },
]);
