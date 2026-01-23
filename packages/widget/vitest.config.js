import { defineConfig } from 'vitest/config';
import preact from '@preact/preset-vite';
export default defineConfig({
    plugins: [preact()],
    define: {
        __VERSION__: JSON.stringify('0.1.0-test'),
    },
    test: {
        environment: 'jsdom',
        globals: true,
        setupFiles: ['./tests/setup.ts'],
        include: ['tests/**/*.test.{ts,tsx}'],
        coverage: {
            provider: 'v8',
            reporter: ['text', 'html', 'lcov'],
            include: ['src/**/*.{ts,tsx}'],
            exclude: ['**/*.d.ts', 'src/index.ts'],
        },
    },
});
//# sourceMappingURL=vitest.config.js.map