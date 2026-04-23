import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@': projectRoot,
    },
  },
  // Use React 17+ automatic JSX runtime so .tsx files that don't
  // `import React` (matching Next.js's default) still compile under
  // vitest's esbuild transform.
  esbuild: {
    jsx: 'automatic',
  },
  test: {
    include: [
      'tests/**/*.test.ts',
      'tests/**/*.test.tsx',
      // M9: SDK scaffolding tests live alongside their modules per the
      // plan's co-located __tests__ convention.
      'lib/**/__tests__/**/*.test.ts',
      'lib/**/__tests__/**/*.test.tsx',
      'app/**/__tests__/**/*.test.ts',
      'app/**/__tests__/**/*.test.tsx',
    ],
    // Each test opts into jsdom via `// @vitest-environment jsdom` directive.
    // Node env is the default; keep it so pure-logic tests skip the jsdom
    // startup cost.
    environment: 'node',
    // Keep test runs deterministic across CI and local.
    globals: false,
    coverage: {
      reporter: ['text', 'html'],
      reportsDirectory: 'coverage',
      exclude: ['**/node_modules/**', '**/.next/**', '**/*.config.*'],
    },
  },
});
