---
title: Vitest 3 + jsdom 27 + React 19 component testing — five gotchas that bite at once
category: test-failures
date: 2026-04-20
tags: [vitest, jsdom, react-19, testing, canvas, jsx, act, profiler]
component: testing_framework
module: tests/
severity: medium
milestone: M3
discovered_via: /ce:work M3 (amendment 3 regression test)
---

# Vitest 3 + jsdom 27 + React 19 component testing — five gotchas that bite at once

## Problem

Setting up the first React component test in a Vitest 3 + jsdom 27 + React 19 project surfaced five orthogonal testing-infra gotchas in the same afternoon — each with a misleading error message. The failures compound: fixing one exposes the next. All five must be resolved before a single render-count assertion can run.

## Symptoms

- `ReferenceError: React is not defined` at the top of a `.test.ts` file that imports `createElement` from React, even though the import is present.
- `ReferenceError: ImageData is not defined` from inside `TextureManager.composite()` when the production code never sees this error.
- `expect(texture.needsUpdate).toBe(true)` failing with `Received: undefined` on every run, even after the code under test clearly executes `this.texture.needsUpdate = true`.
- `Warning: The current testing environment is not configured to support act(...)` in stderr every test — tests pass but the noise masks real warnings.
- Component re-renders when it "shouldn't" according to a narrow-selector contract, with no way to assert "did not render" short of manual Chrome DevTools Profiler inspection.

## What didn't work

**Installing `@testing-library/react` for the render-counting test.** RTL's `render()` wraps the component tree in an extra container and a `Provider`, making it awkward to spy on the exact commit count of a single subtree. It also adds `happy-dom` / emotion / other transitive concerns. We installed it, found it inadequate for render counting, and left it unused in `devDependencies` — ultimately flagged by review as removable.

**Adding a jsdom `canvas` package** (`npm install canvas`). npm errored with native-build failures on macOS + Node 22 due to cairo / pixman deps. Even if it had built, it would add ~30 MB to `node_modules` for a single test file.

**Trying `vi.mock('three', ...)` to bypass the `texture.needsUpdate` read.** Mocking three.js's Texture class ripples into every test that touches it. Too invasive.

**Adding `/* @jsxImportSource react */` directives** to fix the "React is not defined" error. Works at file scope but is obscure and foot-gun-prone for future contributors.

## Solution

Five targeted fixes, applied in order. Each is 1-3 lines:

### 1. `esbuild: { jsx: 'automatic' }` in `vitest.config.ts`

React 17+ automatic JSX runtime lets `.tsx` files omit `import React from 'react'`. Next.js 15 ships this by default. Vitest's esbuild transform does NOT — it uses the classic runtime unless told otherwise. Component tests that import from `.tsx` source files inherit the source's JSX-runtime expectations.

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // ...
  esbuild: {
    jsx: 'automatic',  // matches Next.js 15 + React 19 runtime
  },
  test: {
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    environment: 'node',  // jsdom opt-in per-file
    // ...
  },
});
```

### 2. Stub `ImageData` via `vi.stubGlobal` in the test file

jsdom 27 implements `HTMLCanvasElement` and a minimal `CanvasRenderingContext2D` but does NOT implement the `ImageData` constructor. Any production code path that does `new ImageData(data, width, height)` blows up under jsdom unless you stub it.

```ts
// tests/texture-manager.test.ts
beforeEach(() => {
  vi.stubGlobal('ImageData', class {
    data: Uint8ClampedArray;
    width: number;
    height: number;
    constructor(data: Uint8ClampedArray, width: number, height: number) {
      this.data = data;
      this.width = width;
      this.height = height;
    }
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});
```

**Keep the stub scoped to the test file that needs it.** A global setup file hides the stub from future readers debugging "why does this test work when it shouldn't under jsdom."

### 3. Use `texture.version` not `texture.needsUpdate` for assertions

Three.js makes `Texture.needsUpdate` a **setter-only** property. Writing `texture.needsUpdate = true` increments an internal `version` counter and flips a dirty flag; reading `texture.needsUpdate` returns `undefined`. Tests that read it will always fail with a misleading message.

```ts
// WRONG — reads undefined
expect(tm.getTexture().needsUpdate).toBe(true);

// RIGHT — the public observable side-effect is version++
const before = tm.getTexture().version;
tm.markDirty();
await flushRaf();
expect(tm.getTexture().version).toBeGreaterThan(before);
```

### 4. `globalThis.IS_REACT_ACT_ENVIRONMENT = true` to silence the act warning

React 18+ requires this flag to be truthy for `act()` wrappers around `createRoot().render()` to behave silently. Vitest's default environment does not set it. Tests pass without it, but stderr floods with the warning.

```ts
// tests/color-picker-selectors.test.ts
import { beforeAll } from 'vitest';

beforeAll(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean })
    .IS_REACT_ACT_ENVIRONMENT = true;
});
```

Set it in `beforeAll` of each React-touching test file, not a global setup file — makes intent obvious at the point of use.

### 5. Use React.Profiler for render-counting, not `@testing-library/react`

For narrow-selector regression tests (Zustand / Redux / signals), React.Profiler's `onRender` callback fires once per commit per tracked subtree. This is exactly the observable we need: "did this component re-render?" No RTL needed.

```ts
import { createElement, Profiler, type ProfilerOnRenderCallback } from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

let hueRenderCount = 0;
const onRender: ProfilerOnRenderCallback = (id) => {
  if (id === 'HueRing') hueRenderCount += 1;
};

const container = document.createElement('div');
document.body.appendChild(container);
const root = createRoot(container);

act(() => {
  root.render(
    createElement(Profiler, { id: 'HueRing', onRender },
      createElement(HueRing),
    ),
  );
});
expect(hueRenderCount).toBe(1);  // mount commit

act(() => {
  useEditorStore.setState({ activeColor: sameHueDifferentColor });
});
expect(hueRenderCount).toBe(1);  // no re-render if selector is correct
```

**Note the `.test.ts` extension despite using React.** Because we use `createElement` explicitly (no JSX tags), the file compiles under vitest's TS transform without needing `@vitejs/plugin-react` or a `.test.tsx` rename.

## Why this works

- **JSX runtime parity.** Matching Next.js's automatic JSX runtime in vitest's config means component source files compile identically in both toolchains. No per-file directive, no preamble import.
- **Scoped globals.** jsdom is a minimal DOM; it implements what browsers *require* for most HTML pages but omits Canvas APIs (they're in a separate WHATWG spec layer jsdom has historically deferred). Stubbing per-test with `vi.stubGlobal` restores the global symbol without polluting other test files.
- **Three.js setter semantics.** `needsUpdate` is sugar for "increment the version number and schedule a GPU upload." Reading the setter's name back was never part of the three.js contract. The `version` counter IS public and monotonic — it's what every three.js internal actually consults.
- **React's act environment flag.** React 18's concurrent renderer uses the flag to know whether to batch updates eagerly (test mode) vs. lazily (prod mode). Setting it at `beforeAll` scope per file makes it opt-in per test context.
- **Profiler fidelity.** The `onRender` callback is React's own hook into the commit phase. It fires exactly once per committed subtree update, including mount. It cannot be tricked by memoization, suspense, or concurrent rendering — if React committed, Profiler fires. This is the strongest possible assertion surface for "this component did / did not re-render."

## Prevention

### Vitest config baseline for Next.js 15 + React 19 projects

Commit this as `vitest.config.ts` on day one — don't reverse-engineer it from errors:

```ts
import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  resolve: {
    alias: { '@': projectRoot },
  },
  esbuild: {
    jsx: 'automatic',
  },
  test: {
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    environment: 'node',  // opt into jsdom per-file via // @vitest-environment jsdom
    globals: false,       // explicit imports only
  },
});
```

### Per-file directives

```ts
// @vitest-environment jsdom
// At the top of any test that touches document.*, canvas, or React DOM
```

Opt-in makes pure-logic tests (flood-fill, picker-state, pencil) keep the Node environment's ~50ms startup speedup.

### Lint rule to catch `needsUpdate` reads

```ts
// eslint.config.mjs — custom rule or grep pre-commit
{
  rules: {
    'no-restricted-syntax': ['error', {
      selector: 'MemberExpression[property.name="needsUpdate"][object.type!="AssignmentExpression"]',
      message: 'three.js texture.needsUpdate is setter-only; read texture.version instead.',
    }],
  },
}
```

### Test stub cheat sheet

| jsdom missing | Stub at | Stub as |
|---|---|---|
| `ImageData` | per-test `beforeEach` | `vi.stubGlobal('ImageData', class { ... })` |
| `CanvasRenderingContext2D` methods | production DI | `new TextureManager(mockCanvas, mockCtx)` |
| `requestAnimationFrame` / `cancelAnimationFrame` | per-test `beforeEach` | `vi.stubGlobal('requestAnimationFrame', (cb) => setTimeout(cb, 0))` |
| `IntersectionObserver` | per-test | `vi.stubGlobal('IntersectionObserver', class { observe(){} disconnect(){} })` |

### React component test skeleton

Copy-paste this header for every new React component test:

```ts
// @vitest-environment jsdom
import { createElement, Profiler, type ProfilerOnRenderCallback } from 'react';
import { act } from 'react';
import { beforeAll, afterEach, describe, expect, it } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';

beforeAll(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean })
    .IS_REACT_ACT_ENVIRONMENT = true;
});

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function mount(tree: React.ReactNode): void {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => { root!.render(tree); });
}

function unmount(): void {
  act(() => { root?.unmount(); });
  if (container !== null) document.body.removeChild(container);
  root = null;
  container = null;
}

afterEach(() => { unmount(); });
```

Pin this file in `tests/_templates/react-component.test.ts` and reference it from CONTRIBUTING docs.

### Keep `@testing-library/react` out unless a test actually needs its queries

RTL is valuable for user-interaction-shaped tests (`getByRole`, `userEvent`). For render-counting, selector regression, and state-mutation tests, `createRoot` + `Profiler` + `act` is lighter and more precise. Install RTL only when the first test actually uses `render()` or a query.

## References

- [Vitest esbuild JSX config](https://vitest.dev/config/#esbuild) — `jsx: 'automatic'` aligns with Next.js
- [React 18 act() environment flag](https://react.dev/reference/react/act#isreactactenvironment) — `IS_REACT_ACT_ENVIRONMENT` contract
- [three.js Texture.needsUpdate](https://threejs.org/docs/#api/en/textures/Texture.needsUpdate) — setter-only; see also `.version`
- [React Profiler onRender](https://react.dev/reference/react/Profiler) — render-count observable for selector tests
- [jsdom canvas support policy](https://github.com/jsdom/jsdom#canvas-support) — optional native `canvas` package; we avoid it via DI
