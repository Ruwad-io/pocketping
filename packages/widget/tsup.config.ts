import { defineConfig } from 'tsup';
import pkg from './package.json';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs', 'esm', 'iife'],
  globalName: 'PocketPing',
  dts: true,
  clean: true,
  define: {
    __VERSION__: JSON.stringify(pkg.version),
  },
});
