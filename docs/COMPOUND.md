# Compound Engineering Knowledge Journal

## M1: Scaffold — 2026-04-18

### What worked

- Manual scaffold (no `create-next-app`) gave exact version control and avoided Geist boilerplate cleanup.
- Hybrid orchestration (Opus direct + Sonnet parallel subagents): Opus on Tailwind config and Next.js setup, Sonnet on LICENSE, README, doc stubs. Parallel dispatch reduced wall-clock by ~40% versus pure-Opus.
- Skipping subagent dispatch for `app/page.tsx` and `EditorCanvas.tsx` because both files were <50 lines and literal copy-paste from the plan. Direct write was faster than spawn overhead.
- Tailwind v4 CSS-first `@theme` block in `app/globals.css` with no `tailwind.config.ts`. v4 inverts v3's model; CSS-first is the canonical v4 pattern.
- `/ce:review` parallel subagent dispatch (correctness, kieran-typescript, project-standards, maintainability) caught real findings the work phase missed (license field, CVE bump policy) while flagging zero false positives that fresh rebuild did not resolve.
- Splitting safe_auto fixes and the CVE bump into separate commits (`689a915` then `ffaace7`) preserved a clean audit trail. Future milestones should follow the pattern: scaffold commit, review-fixes commit, security-bump commit when applicable.

### What didn't

- Plan included an obsolete smoke check (`cat .next/server/app/page.html`) inherited from Pages Router conventions. App Router uses RSC payloads, not HTML files. Future plans must verify static rendering via `next build` output markers (`○ Static`, `λ Dynamic`, `ƒ Function`) rather than file-system inspection.
- ESLint flat-config + `eslint-config-next` tension was deferred through M1's work phase. Legacy `.eslintrc.json` was committed but `npm run lint` was not executed. Review caught the gap and verified lint passes; if it had not, M2 would have hit a cold failure.
- Next.js 15.5.9 had 5 published CVEs at install time. Held per exact-pin constraint during work, escalated by review as `gated_auto`, applied as 15.5.15 patch bump before merge. The exact-pin constraint needed clarification: "no drift past 15.5.x" not "freeze 15.5.9".
- Reviewer's `_not-found` build artifact ENOENT was a stale cache artifact, not a real defect. Fresh rebuild resolved. Future review dispatches should run a clean rebuild before accepting build-artifact warnings.
- Reviewer's "unused-deps bloat" concern was dismissed: tree-shaking confirmed `zustand`, `idb-keyval`, and `drei` do not enter the built bundle despite being installed. Installed-but-not-imported dependencies have zero bundle cost.

### Invariants discovered

- Tailwind v4 CSS-first `@theme` is the canonical token source; no `tailwind.config.ts` file exists in this project.
- **Font loading is deferred to M8.** M1's `@theme` block declares `--font-sans` and `--font-mono` as static font stacks (`"Geist, Inter, ui-sans-serif, system-ui, sans-serif"` and `'"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace'`). `next/font` is **not** imported in `app/layout.tsx` yet. When M8 adds `next/font`, the integration point is to declare each font's `variable: "--font-sans"` (or similar) option and let that CSS var override the static stack in `@theme`. Until M8 lands, text renders via system-ui fallback.
- Subagent dispatch overhead exceeds value when the spec is literal copy-paste of <50 lines. Direct execution preferred. Dispatch is correct when (a) the file requires translation from a different format, (b) multiple files can be generated in parallel, or (c) the work involves boilerplate generation from a template.
- Build-output markers (`○ Static`, `λ Dynamic`, `ƒ Function`) are the canonical signals for App Router rendering verification. Do not inspect the file system for HTML artifacts; they do not exist in App Router SSG.
- Fresh rebuild is required before accepting build-artifact warnings from review subagents. Stale `.next/` caches produce ENOENT and missing-file false positives that vanish on clean rebuild.
- LGPL-licensed transitive dependencies are acceptable in this MIT project when they are dynamically-linked native binaries (e.g., `@img/sharp-libvips-darwin-arm64` pulled by Next.js image optimizer). LGPL §6 permits this; static linking would require source disclosure, dynamic linking does not.
- CC-BY-4.0 licensed transitive data (e.g., `caniuse-lite`) is acceptable; CC-BY applies to data, not code, and our usage satisfies attribution by virtue of the package being declared in our dependency tree.
- `license-checker` reports our own private package as `UNLICENSED` when `private: true` is set even with `license: "MIT"` declared. Tool quirk, not a real finding. Future review subagents should filter our own package from license scans.

### Gotchas for future milestones

- Pin syntax in plans must distinguish between **exact-pin** (security-bound, freeze patch level) and **minimum-pin** (security-flexible, allow patch bumps within minor version). Default to minimum-pin for security; require explicit justification for exact-pin. M2 plan must reflect this distinction.
- `next lint` is deprecated in Next 15.5. Before Next 16, M2 must run: `npx @next/codemod@canary next-lint-to-eslint-cli .`. This migrates from `.eslintrc.json` + `next lint` to `eslint.config.mjs` + `eslint` CLI directly. Pin the resulting `@eslint/eslintrc` and `eslint` versions once verified working.
- Two low-severity transitive eslint vulnerabilities remain after M1 (`@eslint/plugin-kit <0.3.4` ReDoS via `eslint@9.18.0`). Fix requires `eslint@9.39.4`, which is outside M1's pinned range. M2's flat-config migration will bump eslint at the same time, resolving these as a byproduct. Do not attempt to fix separately.
- The double-text prefix in utility classes (`text-text-primary`, `bg-text-primary`) is faithful to the design doc but ugly in JSX. Defer rename decision to M3 when actual JSX usage reveals whether to rename the namespace from `text` to `fg`.
- R3F v9 is SSR-safe; no need for `next/dynamic({ ssr: false })` around `<Canvas>`. The `'use client'` boundary on the wrapping component is sufficient. Adding `next/dynamic` is cargo-cult.
- The repo origin is set to `git@github.com:ryanssareen/threditor.git`. Branch `m1-scaffold` is pushed and tracking. `main` on remote was auto-created empty by GitHub at repo provisioning (commit `196ac7d`) and will be force-overwritten by the local merge. Future milestones should not push to `main` without verifying the remote head matches local.

### Pinned facts for next milestones

**Exact versions installed** (M2 should not re-research):

- `next` 15.5.15 (bumped from 15.5.9 for CVE remediation)
- `react` 19.2.5
- `react-dom` 19.2.5
- `three` 0.184.0
- `@react-three/fiber` 9.6.0
- `@react-three/drei` 10.7.7
- `zustand` 5.0.12
- `idb-keyval` 6.2.2
- `tailwindcss` 4.2.2
- `@tailwindcss/postcss` 4.2.2
- `eslint-config-next` 15.5.15

**File paths established:**

- Tailwind tokens: `app/globals.css` under `@theme` block
- No `tailwind.config.ts` exists
- Routes: `app/page.tsx` (server, static), `app/editor/page.tsx` (client wrapper) + `app/editor/_components/EditorCanvas.tsx`
- Doc stubs: `docs/COMPOUND.md`, `docs/PROMPTS.md`, `docs/plans/`
- Project root: `/Users/ryan/Documents/threditor`

**Naming conventions:**

- `_components/` underscore prefix marks Next.js private folders
- `'use client'` at file top for client components
- Pure logic in `lib/` never has `'use client'`

**Bundle baseline** (for M2 regression detection, from `next build` output — gzipped):

- `/editor`: 238 kB route chunk, 340 kB First Load JS
- `/` (landing): 3.45 kB route chunk, 106 kB First Load JS
- These numbers are the M2 reference; significant deviation warrants investigation.

**Audit baseline:**

- 0 high/moderate vulnerabilities after M1 close
- 2 low-severity transitive eslint advisories remain (fixed byproduct of M2 flat-config migration)

## M2: Player Model — 2026-04-18

### What worked

- **Pre-work verification of load-bearing constants.** The plan flagged Slim UV values at 85% confidence. Before writing `lib/three/geometry.ts`, a single WebFetch against skinview3d's `setSkinUVs(box, u, v, w, h, d)` helper algebraically confirmed all 24 Slim faces. 85% → 99% confidence with one HTTP call. Pattern: when a plan marks a load-bearing artifact as confidence-risked, verify it *before* writing, not after.
- **Hybrid Opus+Sonnet dispatch.** `constants.ts` and `placeholder-skin.ts` (template-fillable, no cross-file reasoning) went to parallel Sonnet subagents; `geometry.ts` (72-row UV table + helper) and `PlayerModel.tsx` (zero-alloc `useFrame`) stayed with Opus. Both Sonnet outputs usable first try, ~40% wall-clock savings over pure-Opus.
- **`/ce:review` cross-reviewer convergence.** 9 parallel reviewers; the 2 P1 findings (GPU leak + texture race) came from 6-of-9 and 5-of-9 agreement respectively. Single-reviewer findings were mostly dismissed after inspection; convergence was the strongest signal for severity and confidence.
- **Split commits per logical change** (migration → font → lib/three → EditorCanvas → lockfile → review-fixes). Clean bisect path if anything regresses.

### What didn't

- **ESLint flat-config codemod output was wrong twice.** `npx @next/codemod@canary next-lint-to-eslint-cli .` generated (1) an import path missing `.js` that Node ESM rejected, and (2) a direct import from `eslint-config-next/core-web-vitals` that returned legacy `{ extends: [...] }` not a flat-config array. Fix required `FlatCompat` via `@eslint/eslintrc` exactly as M1 COMPOUND predicted. Also: `.next/` was walked into by default (`next lint` had implicit ignores; flat-config does not) — required explicit `ignores: ['.next/**', ...]`.
- **Plan's `usePlaceholderTexture` used `useMemo`; failed SSR prerender** with `ReferenceError: document is not defined`. `useMemo` runs during render, including during static prerender; `document.createElement` is client-only. Refactored to `useEffect` during `/ce:work`; preserves `○ (Static)` classification without needing `next/dynamic({ ssr: false })`. Plan spec-bug, not code-bug.
- **PlayerModel's first draft claimed three.js auto-disposes geometries on mesh unmount.** False for prop-passed geometries. 6-of-9 reviewers flagged. See `docs/solutions/performance-issues/r3f-geometry-prop-disposal-2026-04-18.md` for the full writeup.

### Invariants discovered

- **R3F geometry lifecycle:** declarative `<boxGeometry>` JSX children are R3F-owned (auto-disposed). `<mesh geometry={...}>` prop-passed instances are caller-owned — must dispose via `useEffect` cleanup. Same rule applies to textures, render targets, and shader materials passed as props.
- **`PART_ORDER: Record<Union, T>` for compile-time exhaustive arrays.** A typed record literal forces every union member to appear. `Object.keys(record) as readonly Union[]` derives a runtime array guaranteed to cover the union. Stronger than `as const satisfies readonly Union[]` which allows subsets.
- **Tailwind v4 `@theme` resolves at runtime, not build time.** `--font-sans: var(--font-geist), Inter, ...` in `@theme` is not baked into utilities; Tailwind compiles `@theme` to `:root` custom properties and the `.font-sans` utility becomes `font-family: var(--font-sans)` which cascades normally. `next/font` setting `--font-geist` on `<body>` feeds through automatically.
- **Slim UV packing convention:** contiguous-start at x=40 (right arm) / x=32 (left arm) with unused tail. Face-by-face verified against skinview3d. 72 UVs pinned in `lib/three/geometry.ts` — canonical for M3, M4, M5, M7, M11.
- **Minecraft overlay geometry is intentionally larger than its UV.** Overlay boxes are +1 pixel on each axis; UVs share the base texture at original dimensions. Creates the "puffier outer shell" effect. Not a bug — adversarial reviewer flagged as stretch, dismissed as ecosystem precedent.

### Gotchas for future milestones

- **DOM touches in React hooks must use `useEffect`, not `useMemo`.** Any `document.*`, `new Image()`, `navigator.*`, `window.*` access at render time breaks Next.js static prerender. Gate with `useEffect` even if it complicates the consumer (null-check + conditional render).
- **Async-resource hooks need a `cancelled` flag.** For patterns like `new Image()` + `img.onload` + `tex.dispose()` cleanup: a `let cancelled = false` checked in `onload`/`onerror`, and handlers nulled in cleanup, prevents rapid prop-toggle races where the old handler fires on a disposed resource.
- **Variant/mode toggle buttons need ARIA + `data-*`.** `aria-pressed` + `data-variant` + `data-testid` are additive; agents and tests can assert state without OCR. Adding them retroactively in `/ce:review` is fine but bake them in from the start in M3+.
- **`useFrame` zero-allocation invariant is fragile on refactor.** Inline comment at top of the callback says so, but M3 will extend it with hover-highlight state. Authors must not add `new Vector3`, destructure `state`, use template strings, or introduce closure captures. Read the invariant comment before editing.
- **`/ce:plan` smoke-check vocabulary:** `○ (Static)`, `λ Dynamic`, `ƒ Function` from `next build` output are the canonical render-mode markers. `.next/server/app/*.html` does not exist in App Router. (Re-stating from M1 because the temptation to file-system-check keeps reappearing.)

### Pinned facts for next milestones

**Exact version deltas from M1:**

- `eslint` 9.18.0 → **9.39.4** (resolves both low-severity `@eslint/plugin-kit <0.3.4` ReDoS advisories)
- `@eslint/eslintrc` → **3.3.1** (new — FlatCompat bridge for `eslint-config-next`)
- Lint command: `"lint": "next lint"` → **`"eslint ."`**
- `.eslintrc.json` deleted; replaced by `eslint.config.mjs` with flat config + explicit ignores for `.next/**`, `node_modules/**`, `out/**`, `build/**`, `next-env.d.ts`
- All other M1 pins unchanged.

**File paths established:**

- `lib/three/constants.ts` — camera (position/target/FOV), breathing (1.5 Hz / 0.01), orbit (±3°, 9s, 500ms warm-up), rim-light `0x7FD6FF` (pinned, unused until M3)
- `lib/three/geometry.ts` — `CLASSIC_UVS` + `SLIM_UVS` + `PlayerPart` union + `BoxUVs` type + `partDims(variant, part)` + `partPosition(variant, part)` + `mapBoxUVs(geo, uvs)` + `getUVs(variant)`
- `lib/three/placeholder-skin.ts` — `createPlaceholderSkinDataURL(variant)` (replaced in M7)
- `lib/three/PlayerModel.tsx` — `'use client'`, 16-mesh humanoid, single coalesced `useFrame`, `useEffect` disposal on variant change

**Conventions established:**

- `'use client'` is permitted in `lib/three/PlayerModel.tsx` only (sole exception to "pure `lib/` never client"). Pattern: UI-component-shaped React files that happen to live in `lib/` for domain clustering may be client; pure-logic files never are.
- `PART_ORDER: Record<Union, T>` + `Object.keys(...) as readonly Union[]` for exhaustive arrays.
- `useEffect`-based async resource hooks with `cancelled` flag + handler-null-in-cleanup.

**Bundle baseline update:**

- `/editor`: 238 → **241 kB** route chunk, 340 → **343 kB** First Load JS (+0.9%, well within ±30% tolerance)
- `/` (landing): 3.45 kB / 106 kB (unchanged)

**Audit baseline:**

- **0 vulnerabilities** (down from M1's 2 low-severity transitive ReDoS). The flat-config migration + eslint 9.39.4 resolved both as a byproduct exactly as M1 COMPOUND sequenced.

### Recommended reading for M3

- `docs/solutions/performance-issues/r3f-geometry-prop-disposal-2026-04-18.md` — before M3 adds more GPU resources (textures via `TextureManager`, shader material in M8), apply the same useEffect-dispose pattern.
- This file's M2 "Invariants" section — the Tailwind `@theme` runtime chain and PART_ORDER exhaustiveness pattern will be immediately reused by M3's tool palette.

## M3: Paint Canvas, Color Picker, Pencil, Persistence — 2026-04-20

### What worked

- **Amendment-driven plan execution.** Five explicit amendments applied during `/ce:work` caught real issues before they fossilized: DI for TextureManager (test-friendliness), BEST-EFFORT comment on beforeunload (honesty about tradeoffs), a regression test for narrow selectors (CI gate instead of manual Profiler step), explicit SL-square ARIA, and the `savingState='pending'` probe-race resolution. Amendments beat "fix during review" because they are authored during planning with fresh context on the full system.
- **Zustand v5 flat state + narrow selectors.** 9 slots, no middleware, no slices. Each subscriber calls `useEditorStore((s) => s.<slot>)` with a scalar or reference-stable slice. Amendment 3's regression test (`tests/color-picker-selectors.test.ts`) uses `React.Profiler` to pin the contract in CI — HueRing does NOT re-render when `activeColor` is replaced with a different color whose `h` is unchanged. First attempt failed the test: HueRing had *two* subscriptions (`activeColor.h` AND full `activeColor`). Fix: drop the broader subscription, read `useEditorStore.getState().activeColor` from inside the callback (non-reactive snapshot).
- **Hoisting ownership of `TextureManager` + `Layer`** from `EditorCanvas` to `EditorLayout`. Two consumers (`ViewportUV` 2D paint surface + `EditorCanvas` 3D viewport) now share one `CanvasTexture` + pixel buffer with zero sync drift. The textured canvas lives in `ViewportUV`'s DOM via `appendChild` (not `drawImage` copy); CSS `transform: scale(zoom) translate(pan)` + `image-rendering: pixelated` handles all zoom rendering.
- **Zero-allocation invariant extended to pointer hot paths.** M2's rule applied only to `useFrame`; M3 extended to `onPointerDown` / `onPointerMove`. Hex→RGB conversion in the paint handler was originally `hexToRgbTriple` returning `[r, g, b]` (tuple allocation per event). Refactored to three inline scalar `hexDigit()` calls. Events fire at 60-200 Hz; the tuple alloc would have been 10-20k objects/min in active paint.
- **Cursor-centered wheel zoom** in `ViewportUV.tsx` lines 125-147 — pinned as canonical reference. Math: before zoom, compute `worldX = (cx - pan.x) / zoom`; after zoom, set `pan.x = cx - worldX * nextZoom`. Symmetric for Y. Any future 3D zoom surface (M6 layer palette zoom?) should copy this pattern rather than rederive.
- **`/ce:review` early termination on rate limit was informative.** 4 of 12 reviewer subagents completed before the daily budget ran out. Even partial coverage surfaced a P1 (hydrate-overwrites-live-strokes race in `EditorLayout`), P1 (mid-stroke variant change leaves `paintingRef=true`), P2 (beforeunload double-fire), and several P2/P3 test coverage gaps. Future milestones should dispatch reviewers in batches of 4-6 rather than 10-14 to respect hourly limits.

### What didn't

- **Initial attempt to run the amendment 3 test with `@testing-library/react`.** Installed RTL 16.x, wrote a test using `render()`. Adequate but awkward for "did component commit?" assertions — RTL wraps the tree in a provider. Rewrote using `React.Profiler` + `createRoot` directly. RTL stayed in `devDependencies` unused; review flagged it as removable. Lesson: don't install a framework preemptively; install it when the first test actually needs a query. See `docs/solutions/test-failures/vitest-jsdom-react-component-testing-setup-2026-04-20.md`.
- **First vitest run failed with `ReferenceError: React is not defined`.** Vitest's esbuild transform defaults to the classic JSX runtime; Next.js 15 + React 19 use automatic. Fix: `esbuild: { jsx: 'automatic' }` in `vitest.config.ts`. Not discoverable from the error message alone.
- **`texture.needsUpdate` read-back in tests returned `undefined`.** three.js makes it setter-only. Rewrote assertions to check `texture.version` (monotonic counter). Added a prevention note in the solutions doc.
- **jsdom 27 missing `ImageData` global.** `TextureManager.composite()` calls `new ImageData(data, width, height)`; jsdom doesn't ship this. `vi.stubGlobal('ImageData', class { ... })` in the test's `beforeEach` — not in a global setup file — keeps the stub visible at the point of use.
- **Non-zero-pixel threshold for island map was overclaimed in the plan.** Plan implied ≥3800; actual counts are 3264 (classic) / 3136 (slim). Lowered to ≥3000 with an algebraic derivation comment. Reviewer correctly flagged this as P2 weak assertion — slack of 136 px on slim could miss a single-face regression. Follow-up in M4: tighten to exact `toBe(3264)` / `toBe(3136)` since both are deterministic.

### Invariants discovered

- **Zero-allocation invariant extends to pointer hot paths.** Not just `useFrame`. Any handler firing at browser-event cadence (60-200 Hz) must avoid per-event allocations: no `{ ax, ay }` return objects where scalars suffice, no template strings, no tuple destructuring, no fresh closures. Cache the `getBoundingClientRect()` object — the browser owns that allocation, not us. When the math naturally wants a tuple return, inline the callee.
- **CSS transform + `image-rendering: pixelated` > Canvas 2D `scale()` for pixel-art zoom.** The paint canvas is a fixed 64×64 offscreen buffer. Zoom/pan is pure CSS transform on a wrapper div; the browser's GPU compositor does the nearest-neighbor upscale for free. Never scale the 2D context — it introduces sub-pixel rounding and blurry edges.
- **IndexedDB `beforeunload` flush is irreducibly best-effort.** The IDB transaction schedules synchronously but completes asynchronously. Browser may terminate before commit. Up to 500ms of strokes lost on force-close. Accepting this is cheaper than building a sync-XHR-to-self hack or a service-worker flush proxy. Document the tradeoff inline at the listener (see amendment 2).
- **Safari Private probe pending-state race needs a dirty-flag buffer.** Module-init async probe can resolve to 'enabled' or 'disabled:private' milliseconds after the first paint. Pattern: `let dirtyWhilePending = false` at module scope; `markDocumentDirty` sets it during the pending window; on probe resolution, if `dirtyWhilePending && resolvedToEnabled`, fire one `scheduleWrite()`; otherwise drop silently. Amendment 5 locked the exact race resolution.
- **Zustand narrow selector double-subscription trap.** A component that calls `useEditorStore((s) => s.foo.bar)` will correctly re-render only on `bar` changes. If the same component ALSO calls `useEditorStore((s) => s.foo)` elsewhere (even to read `foo.other`), it re-renders on ANY `foo` replacement. Fix: read static slices via `useEditorStore.getState().foo` inside callbacks — a non-reactive snapshot — rather than adding a second reactive subscription.
- **Vitest JSX runtime must match the source project's runtime.** Next.js 15 uses React 17+ automatic JSX. Vitest's esbuild defaults to classic. `esbuild: { jsx: 'automatic' }` in `vitest.config.ts` is mandatory for component tests.
- **three.js `needsUpdate` is setter-only**, `version` is the readable counterpart. Never assert on `needsUpdate`.
- **jsdom 27 ships no `ImageData`, `requestAnimationFrame` stub differs from browser timing, and no Canvas 2D draw implementations.** DI the canvas/context in production code; stub globals per-test file; prefer `texture.version` read-back over GPU-side effects.
- **ARIA 1.2 disallows `aria-valuetext` on `role="application"`** per spec but real assistive tech announces it regardless. Amendment 4 chose spec-deviation for UX; the `// eslint-disable-next-line jsx-a11y/role-supports-aria-props` is load-bearing. Review flagged this as P2 with a safer alternative (visually-hidden `aria-live="polite"` sibling); M4 should migrate to that pattern.

### Gotchas for future milestones

- **Mid-stroke variant toggle leaves `paintingRef=true` against a fresh layer.** Review flagged this as P1. If the user holds pencil down and toggles Classic↔Slim (keyboard shortcut in M5 would make this reachable), `useTextureManagerBundle` disposes the old TM and builds a new one with placeholder pixels — but `ViewportUV` doesn't unmount, so `paintingRef` and `lastPaintedXRef` survive. Next pointermove draws a Bresenham line from the stale atlas coords onto the new canvas. M5 fix: `useEffect` keyed on `[textureManager, layer]` that resets painting refs + releases pointer capture.
- **`EditorLayout` hydrate race overwrites live strokes.** `bundle.layer.pixels.set(saved.pixels)` runs after `loadDocument()` resolves. If the user paints between bundle-mount and hydrate-resolution, those strokes are clobbered by the IDB restore. Review flagged P1. M4 fix options: (a) render a "loading" overlay that blocks paint interaction until hydration completes, or (b) snapshot `layer.pixels` at effect-start and only write `saved.pixels` if still byte-equal. Option (a) is simpler.
- **`handleWheel` commits zoom and pan as two separate Zustand `set()` calls.** Any subscriber reading both through separate selectors sees one tick of torn state. Low impact today (ViewportUV itself React-batches both before the next pointermove). Becomes an issue the moment a subscriber runs a side-effect on `uvZoom` alone. M5 fix: add `setUvView({zoom, pan})` action to the store for atomic updates.
- **Toolbar 'b' hotkey doesn't guard against Cmd+B / Ctrl+B.** Browser's bookmark shortcut also switches the active tool. Fix: early-return on `e.metaKey || e.ctrlKey || e.altKey` in the window keydown listener.
- **Module-level mutable `_scheduleWrite` in persistence is fragile.** Works today because StrictMode ordering is install1→cleanup1→install2. A future second caller of `initPersistence` or a concurrent mount would silently route writes to the no-op stub. Add an install-time assertion: `if (_scheduleWrite !== DEFAULT_NOOP) console.warn(...)`.
- **Test `>=3000` lower-bound on island-map non-zero pixel count has too much slack on slim (136 px).** A regression losing a single 64-96 px face (one head side, one body top) would pass. Tighten to exact equality in M4 now that the counts are stable module-init outputs.
- **No test covers the cursor-centered zoom math**, the store actions (`swapColors`, `commitToRecents` FIFO / move-to-front / dedupe), or the variant-change-mid-stroke case. Extract zoom math to a pure helper + add a `store.test.ts` in M4.
- **The `@testing-library/react` install was unused** — the final amendment 3 test uses Profiler directly. Safe to `npm uninstall @testing-library/react @testing-library/dom`; frees ~4 MB of install. Keep RTL out of `devDependencies` until a test actually needs a query-by-role.

### Pinned facts for next milestones

**Exact version deltas from M2:**

- `vitest` 3.2.4 (new — dev)
- `jsdom` 27.0.0 (new — dev, peer of vitest)
- `@testing-library/react` 16.1.0 (new — dev, **unused, safe to remove**)
- `@testing-library/dom` 10.4.0 (new — dev, **unused, safe to remove**)
- `@types/node` 22.10.5 → **22.19.17** (bumped to satisfy vitest's transitive vite peer `>=22.12.0`)
- `"test": "vitest run"` added to scripts
- All other M2 pins unchanged.

**File paths established:**

- `lib/editor/types.ts` — `SkinVariant`, `Layer`, `SkinDocument`, `Stroke`, `IslandId`, `IslandMap`, `Point`, `RGBA`
- `lib/editor/store.ts` — Zustand flat store (variant, activeTool, brushSize, activeColor, previousColor, recentSwatches, uvZoom, uvPan, savingState)
- `lib/editor/texture.ts` — `TextureManager` with DI `(canvas?, ctx?)` constructor, rAF coalescing, `.dispose()` + `getTexture()` + `composite(layers)` + `markDirty()`
- `lib/editor/island-map.ts` — derived from `PART_ID_ORDER × FACE_ID_ORDER`, 72 IDs × 2 variants; canonical for M4 raycast, M5 bucket, M7 templates, M11 validation
- `lib/editor/flood-fill.ts` — scanline Smith 1979, island-gated, exact-match
- `lib/editor/tools/pencil.ts` — `stampPencil` + `stampLine` (Bresenham), top-left convention `halfLeft = min(1, size-1)`
- `lib/editor/persistence.ts` — idb-keyval wrapper, 500ms debounce, module-scope `_scheduleWrite` hook, Safari-private probe
- `lib/editor/use-texture-manager.ts` — `useTextureManagerBundle(variant)` returns `{textureManager, layer} | null`, disposes on variant/unmount
- `lib/color/picker-state.ts` — HSL canonical; `handleHexInput`, `handleHueDrag`, `handleSLDrag`; gray-axis hysteresis at s<0.01
- `lib/color/palette.ts` — 8 Minecraft default hex colors
- `lib/color/named-colors.ts` — 141 CSS-named entries, `findNearestName` via RGB Euclidean distance
- `app/editor/_components/ViewportUV.tsx` — 2D paint surface; `pointerToAtlas`, `handleWheel` (cursor-centered zoom), `handlePointerMove` (stampLine in active stroke), gated BucketHoverOverlay integration
- `app/editor/_components/ColorPicker.tsx` — `ColorPicker` shell, `SLSquare` (amendment 4 ARIA), `HueRing`, `HexInput` (named-color hint), `RecentsGrid` (1-8 keyboard), `PreviewStack`
- `app/editor/_components/EditorLayout.tsx` — responsive shell, hoists TM + Layer, hydrate/persist effects
- `app/editor/_components/Sidebar.tsx`, `Toolbar.tsx`, `BucketHoverOverlay.tsx` (M3-inert), `BrushCursor.tsx`
- `tests/{texture-manager,island-map,flood-fill,pencil,picker-state,persistence,color-picker-selectors}.test.ts` — 78 total tests
- `docs/solutions/test-failures/vitest-jsdom-react-component-testing-setup-2026-04-20.md` — the five-gotcha cluster for future component tests

**Conventions established:**

- Store slots are flat scalars or shallow objects. Each subscriber reads via narrow selector `(s) => s.slot` or `(s) => s.slot.field`. Never subscribe to parent AND child of the same slot in the same component.
- Non-reactive store reads inside callbacks use `useEditorStore.getState().slot` — does not create a subscription.
- React component tests use `createRoot` + `React.Profiler` + `act` + `IS_REACT_ACT_ENVIRONMENT = true`. RTL is out unless a test needs its query API.
- Zero-allocation invariant applies to `useFrame` AND pointer event handlers. Inline scalar calls instead of returning tuples/objects from per-event helpers.
- CanvasTexture + Layer pixel buffer ownership lives as high as both consumers (2D + 3D) can reach it — `EditorLayout` in M3. The `useTextureManagerBundle` hook owns the lifecycle; consumers receive via props.
- Persistence is a module singleton. `initPersistence({ getLayer })` installs; returned cleanup uninstalls. `markDocumentDirty()` is a free function that dispatches through a module-mutable hook.

**Bundle baseline update:**

- `/editor`: 241 → **250 kB** route chunk, 343 → **352 kB** First Load JS (+3.7%, well within ±30% tolerance)
- `/` (landing): 3.37 → **3.45 kB** route chunk, 103 → **106 kB** First Load JS (negligible delta; attributable to shared chunk churn)
- Attribution: Zustand store + idb-keyval + picker-state + palette + named-colors + new UI components.
- `lib/color/named-colors.ts` source: 8.9 kB uncompressed; compresses to ~2-2.5 kB minified (141 entries × ~15 bytes minified). Under the 3 kB compiled budget per plan.

**Audit baseline:**

- **0 vulnerabilities** (production and full). vitest + jsdom + RTL adds surface but no advisories at pinned versions.

### Recommended reading for M4

- `docs/solutions/test-failures/vitest-jsdom-react-component-testing-setup-2026-04-20.md` — copy the component-test skeleton for M4's raycast hover tests.
- `docs/solutions/performance-issues/r3f-geometry-prop-disposal-2026-04-18.md` — M4 will add raycast-hover overlay meshes; apply the same `useEffect`-dispose pattern for any new geometries / render targets.
- This file's M3 "Gotchas for future milestones" — two P1 races (mid-stroke variant change + hydrate overwrite) are M4's first fixes. Review flagged but did not block; M4 should resolve both before adding 3D→2D raycast.

## M4: 2D↔3D Paint Bridge — 2026-04-20

### What worked

- **Cross-AI consultation before `/ce:plan`.** UX decisions (3D cursor shape, hover affordance, overlay precedence) were locked via a pre-plan consultation; the plan itself just codified them. Result: `/ce:work` had zero UX ambiguity mid-execution. Pattern worth reusing for high-UX-surface milestones.
- **Unit 0 as a prerequisite.** The two M3 P1 review findings (variant-mid-stroke + hydrate-overwrites-strokes) were explicit prerequisite fixes in M4's plan, landed before the 3D paint surface. Without this gate, M4's `PlayerModel` would have introduced a second `paintingRef` that could get stuck alongside `ViewportUV`'s — compound failure mode. **Pattern: escalate unresolved P1s from prior milestones into the next milestone's Unit 0.**
- **Overlay/base LUT over per-event rect-iteration.** 8 KB module-scope trades off against 72 rect comparisons per 60-200 Hz pointer event. O(1) runtime lookup. Pattern: pre-compute any per-event lookup that has a reasonable static state space.
- **Atlas→world helper (`lib/three/atlas-to-world.ts`).** The 6-entry face-axis transform table is now pinned as canonical — any future work that places a 3D object at a known atlas coord (M5 mirror tool, M6 layer panel hit-indicators, M7 template thumbnails) reuses it. Extracted via test-first dev because the face-axis signs are error-prone.
- **`userData.part` on meshes instead of per-mesh handler closures.** One shared `onPointerDown`/`Move`/`Up` triple across all 12 meshes; each reads `e.object.userData.part` to decide overlay vs base. Dep-array churn minimized; closure count linear in handler-types-per-mesh, not meshes.
- **Hover dedup refs (`lastHoverX/Y/TargetRef`) extended from M3's pointerToAtlas dedup pattern.** Store only fires when the resolved pixel actually changes. Applied symmetrically on ViewportUV and PlayerModel.
- **Hybrid dispatch (Opus direct + Sonnet subagents parallel).** Opus on judgment-heavy files: Unit 0 (P1 safety fixes), Unit 4 (PlayerModel pointer paint core), Unit 5 (atlas-to-world math + CursorDecal 3D). Sonnet parallel on units that touch non-overlapping files: Unit 1 (island-map helper), Unit 2 (overlay-map LUT test-first), Unit 3 (hoveredPixel store slot). Unit 6 (ViewportUV hover hoist) dispatched to Sonnet serially after Unit 3 landed. Saved ~30% wall-clock vs pure-Opus.

### What didn't

- **drei `<Html>` JSX-inside-Billboard.** drei's `<Html>` renders DOM nodes positioned via 3D transform; nesting inside `<Billboard>` caused a minor DOM-inside-canvas positional drift on first render. Tolerable (the label settles after one frame) but worth noting: drei composable primitives aren't always transitively composable.
- **R3F raycast tests under jsdom.** Skipped full render integration tests and fell back to pure-function tests per the plan's risk section. jsdom has no WebGL context; a real test would need Playwright or a WebGL2-mocking harness. M4 ships with 0 R3F render tests; the pure-function coverage (uv→atlas, overlay precedence, face-axis transforms) + manual acceptance is the shape.
- **Plan estimate of overlay-pixel delta off by ~20.** Plan estimated ~80 px delta between classic and slim overlay maps; actual measured delta is 64 px (32 per arm × 2 arms). Plan double-counted some arm-base-contribution overlap. Capture: when estimating pixel counts across variants, construct the measurement, don't derive from the plan doc estimate.
- **Texel-center snap for 3D cursor.** Plan UX decision 1 specified decal snaps to UV texel centers, not raw hit points. Implementation does snap at the texel-center via `atlasToWorld`, but the "Distance scale-up" refinement (+10-15% at distance) was deferred to M5 polish to keep Unit 5 shippable. Document the deferral so future readers know the constant is pinned but the math isn't hooked up yet.

### Invariants discovered

- **R3F `event.uv` Y-flip is a contract.** `e.uv.y` is bottom-up (WebGL convention); atlas is top-down. Every UV→atlas and atlas→UV conversion does `y = floor((1 - uv.y) * SIZE)` or inverse. Documented in `docs/solutions/integration-issues/r3f-pointer-paint-on-textured-mesh-2026-04-20.md` as Decision #1.
- **`raycaster.firstHitOnly = true` + `material.side = FrontSide`** is the canonical no-bleed-through combo. Set `firstHitOnly` once on Canvas `onCreated`. `FrontSide` is the three.js default for `MeshStandardMaterial`; don't override.
- **`userData` as the mesh-identity extension point.** `Object3D.userData` is three.js's built-in sidecar object. Doesn't break serialization (GLTF export preserves it). Cleaner than a WeakMap sidecar or a custom prop.
- **`CanvasTexture` disposal is caller-owned.** Already documented for BoxGeometry in M2; applies identically to CanvasTextures that a client component builds and passes as a `map={…}` prop. `useMemo` build + `useEffect` dispose pattern.
- **BoxGeometry face-axis transform table is static and worth pinning.** The 6-entry table in `atlas-to-world.ts` maps (face, uFrac, vFrac) → (x, y, z) offset given (w, h, d). Derives from three.js BoxGeometry vertex ordering: face order `[+X right, -X left, +Y top, -Y bottom, +Z front, -Z back]`, per-face vertex order `[upper-left, upper-right, lower-left, lower-right]` from outside-looking-in. If M4's `atlas-to-world.ts` ever looks wrong during manual QA, THIS is the table to re-verify against three.js source.
- **Pre-computed Uint16Array LUT pattern.** For any mapping between discrete coordinate spaces (overlay atlas ↔ base atlas here; UV seam neighbors in potential future tools; template atlas → skin atlas in M7) where the mapping is static and the query hot: `Uint16Array(4096)` with a sentinel (`0xFFFF`) for "no mapping" is ~8 KB per map and O(1) per lookup. Beats 6× rect iteration or computed-on-demand.
- **Zero-alloc invariant extended to 3D pointer hot paths.** M2 pinned it for `useFrame`; M3 extended to 2D pointer events; M4 extends to 3D pointer events. Rule: anywhere at 60-200 Hz, no new Vector3, no tuple-returning helpers, inline scalar hex-parse, dedup store dispatches with refs. One `{x,y,target}` object per pointer-move-dispatch is the accepted precedent (matches M3's `{ax, ay}`).

### Gotchas for future milestones

- **CursorDecal `CURSOR_DECAL_DISTANCE_SCALE_MAX` is pinned but unhooked.** The 1.15 constant in `constants.ts` is the max scale bump for distance-dependent cursor sizing. A `useFrame`-driven camera-distance read would hook it up. Implement in M5 or M8 polish; current M4 decal is fixed-size.
- **M3 P2/P3 review findings still unresolved at M4 close:**
  - `handleWheel` commits zoom+pan as two separate store sets (M3 gotcha #3). Any future subscriber reading both can see torn state. M5 should add `setUvView({zoom, pan})` atomic action.
  - Toolbar 'b' hotkey doesn't guard `e.metaKey`/`e.ctrlKey`/`e.altKey` (M3 gotcha #4). Cmd+B triggers pencil tool selection while browser also shows bookmark dialog. One-line fix.
  - `aria-valuetext` on `role="application"` in SL square (M3 amendment 4 lock) — M4 didn't migrate to the reviewer-suggested visually-hidden `aria-live` sibling pattern. Carry forward into M5 or M6.
- **3D drag uses per-frame sampling only.** Fast drags across a face boundary will show gaps (~2-5 pixel gaps at normal drag speed, more at tablet-pen speed). If user feedback flags this during M4 acceptance testing, M5 gets a prerequisite "3D-space ray-stepping" unit. Atlas-space Bresenham is NOT a valid shortcut (see solution doc).
- **Cross-surface pointer continuity is not supported.** User can't start a stroke on 2D, drag onto 3D, and release — each surface has its own `paintingRef` lifecycle. R3F `<Canvas eventSource>` hoisting could enable this but is out of scope through M8.
- **drei `<Billboard>` + `<Html>` bundle cost is non-trivial.** M4 added exactly +5 kB First Load JS (on the +5 kB plan budget). M5/M6 adding more drei primitives should measure before committing to them. Consider `<Sprite>` with a baked `CanvasTexture` as a lighter alternative for simple 3D UI elements.
- **Hydration gate is a UX flash risk for slow IDB.** `hydrationPending` starts true on every bundle lifecycle; normally flips false in <100 ms. On Safari Private's slow probe path or a cold IDB, the window could be perceivable (user clicks → no paint). Current UX is silent pointer-event no-op. If QA flags it, add a subtle overlay.
- **`useRef<-1>` convention for "no last hover/paint."** The code uses `-1` as a sentinel for "no pixel hovered/painted yet" because `null` would require a union type + narrowing. Acceptable since atlas coords are `[0, 63]` and can't collide. Document the convention if it spreads further.

### Pinned facts for next milestones

**Exact version deltas from M3:**

- No new dependencies. drei `<Billboard>` + `<Html>` are already installed via drei 10.7.7; M4 is the first consumer.
- All M3 pins unchanged.

**File paths established:**

- `lib/three/overlay-map.ts` — `Uint16Array(4096)` LUT per variant; `getOverlayToBaseMap(variant)` + `overlayToBase(variant, x, y)` + `OVERLAY_NO_MAPPING = 0xFFFF`.
- `lib/three/atlas-to-world.ts` — `atlasToWorld(variant, x, y)` + `faceNormal(face)` + `faceLocalOffset(face, u, v, w, h, d)`. The 6-entry face-axis transform table lives here.
- `lib/editor/island-map.ts` — now exports `OVERLAY_ISLAND_ID_BASE = 36` + `isOverlayIsland(id)` predicate. IDs 1-36 are base parts, 37-72 are overlay parts.
- `lib/editor/store.ts` — `hoveredPixel: { x, y, target: 'base' | 'overlay' } | null` slot + `setHoveredPixel` action with identity-guard on null→null.
- `lib/three/constants.ts` — `OVERLAY_ALPHA_THRESHOLD = 10` (0-255 scale; alpha below this redirects overlay→base), `CURSOR_DECAL_SIZE = 0.025`, `CURSOR_DECAL_DISTANCE_SCALE_MAX = 1.15` (pinned, not hooked up).
- `app/editor/_components/CursorDecal.tsx` — 3D paint cursor + BASE/OVERLAY label (drei `<Billboard>` + `<Html>`).
- `app/editor/_components/PencilHoverOverlay.tsx` — 2D-side pencil hover preview (single-pixel 18% additive white + 1px stroke).
- `docs/solutions/integration-issues/r3f-pointer-paint-on-textured-mesh-2026-04-20.md` — canonical R3F paint pattern.

**Conventions established:**

- Single `hoveredPixel` store slot drives both surfaces' hover. Producers dedup via refs; consumers subscribe with narrow selectors.
- `hydrationPending` pattern for async-bundle paint gates: EditorLayout owns the flag, threads to every paint surface as a prop. Paint events early-return when pending; pan / non-paint events continue.
- `useEffect([textureManager, layer])` race-reset pattern: wherever per-stroke state lives, reset it when the underlying bundle changes. Mirrored across ViewportUV and PlayerModel.
- R3F meshes carry per-mesh identity via `userData={{ part }}`. Shared pointer handlers read `e.object.userData.*`.
- CanvasTexture resources built via `useMemo` + disposed in `useEffect` cleanup (same rule as BoxGeometry from M2).

**Bundle baseline update:**

- `/editor`: 250 → **255 kB** route chunk (+5), 352 → **357 kB** First Load JS (+5, exactly at the M4 plan budget).
- `/` (landing): 3.45 kB / 106 kB (unchanged).

**Audit baseline:**

- **0 vulnerabilities** (production and full).

### Recommended reading for M5

- `docs/solutions/integration-issues/r3f-pointer-paint-on-textured-mesh-2026-04-20.md` — M5's eraser/bucket/picker/mirror tools will all reuse this pointer paint pattern. Follow the 8-decision checklist at the top; avoid the 5 listed "didn't work" attempts.
- `lib/three/atlas-to-world.ts` — mirror tool needs the inverse direction (world or atlas → mirrored atlas). Reuse the face-axis table.
- `docs/solutions/performance-issues/r3f-geometry-prop-disposal-2026-04-18.md` — any new GPU resources (mirror preview mesh, picker target highlight) follow the same `useMemo + useEffect cleanup` pattern.
- This file's M4 §Gotchas — the three unresolved M3 P2/P3 findings (handleWheel tearing, Cmd+B hotkey, SL square aria) are M5 candidates to resolve as chores.
- This file's M4 §Invariants — the R3F Y-flip + firstHitOnly + userData + face-axis patterns are now canonical. Don't re-derive; reuse.
