import { defineConfig } from 'vitest/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(dirname, 'src'),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'scripts/**/*.test.ts', 'tools/**/*.test.ts'],
    // NOTE: Vitest 5 removed environmentMatchGlobs; app-layer test files must
    // start with the docblock: // @vitest-environment jsdom
    coverage: {
      provider: 'v8',
      include: ['src/engine/**', 'src/app/**'],
      thresholds: {
        lines: 80,
        functions: 80,
        statements: 80,
        branches: 70,
      },
    },
  },
});
