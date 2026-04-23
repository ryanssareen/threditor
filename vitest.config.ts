import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@': projectRoot,
      // M9: `import 'server-only'` is a Next.js build-time guard that
      // throws in non-server-component contexts. Tests aren't server
      // components; alias to the package's own empty shim (which
      // isn't reachable via the package.json exports field, so point
      // at the file directly) so admin SDK tests can import admin.ts.
      'server-only': new URL(
        './node_modules/server-only/empty.js',
        import.meta.url,
      ).pathname,
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
