import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs', 'esm'],
  dts: true,
  clean: true,
  // Keep the directive so the package works inside Next.js App Router (RSC).
  // NOTE: do not enable tsup's `treeshake` here — rollup strips module-level
  // directives, which would drop the "use client" banner below.
  banner: { js: '"use client";' },
  // @pocketping/widget and react are peer deps — never bundle them.
  external: ['react', 'react-dom', '@pocketping/widget'],
});
