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

## M6: Layers + Undo — 2026-04-21

### What worked

- **Amend DESIGN.md in Unit 0 before writing any code.** DESIGN §4's single-bbox `Stroke`, §7's `putImageData`-composite, and §8's undo sketch were all load-bearing specs that M6 had to change. Committing the amendments first (with the D1/D2/D3/D4/D5/D9/D10 rationale inline) meant every downstream unit read the new contract, not the old one. Precedent: M4's Unit 0 escalated M3's P1s; M6 extends the precedent to spec-level corrections. Pattern: when a milestone's first act is "the previous spec is wrong," the doc amendment is Unit 0, not a commit-message afterthought.
- **Dispatcher-level diff capture wrapper.** M5 centralized every pixel write into `lib/editor/tools/dispatch.ts`'s `strokeStart/Continue/End`. M6's `StrokeRecorder` attached at this one chokepoint captured pre-image clone + bbox accumulation + mirror-bbox accumulation for **every existing tool (pencil, eraser, bucket) and every future tool, with zero per-tool changes**. Picker (non-mutating) skips the recorder implicitly. The recorder is module-scoped `currentStroke: StrokeRecorderState | null` — safe because `paintingRef` already enforces one active stroke at a time across 2D and 3D surfaces. Pattern: when an orthogonal concern (undo capture, telemetry, autosave hooks) attaches at a single dispatcher chokepoint, the resulting code has O(1) per-tool cost instead of O(tools).
- **`EditorActions` adapter kept `undo.ts` pure.** The undo stack mutates store slots AND pixel regions on replay. The naïve shape imports zustand + React + the diff helpers. Instead: `undo.ts` accepts an `EditorActions` interface (`getLayers`, `insertLayerAt`, `removeLayer`, `writeLayerRegion`, etc.); the adapter is built in `EditorLayout` and injected. Result: `undo.ts` is framework-free and unit-testable with a stub adapter. 16 Unit 3 tests ran against an in-memory fake before any UI wiring existed. Pattern: for stateful modules that need to read/write "the app's world," define a narrow adapter interface instead of importing the store/components directly.
- **`Stroke.patches: Array<{bbox, before, after}>` instead of single bbox.** Mirror strokes span ~30 atlas rows; a single bounding bbox would store ~8 KB of unchanged pixels per stroke. Over 100 mirror strokes that's 800 KB vs. ~32 bytes of real diff per mirrored stamp. The shape change propagated cleanly — dispatcher emits N patches, undo applies each, byte counter sums each. Aseprite/Krita/Photoshop Paint Symmetry all use this shape. D2 rationale is canonical for any future "atomic multi-region command" (e.g., paste-clipboard-across-regions, fill-selection-mask).
- **Dual memory caps (5 MB bytes + 100 entries).** Count-cap alone would fail at worst-case mirror-bucket strokes (~1.6 MB for 100 full-layer mirror fills). Byte-cap alone would allow pathological tiny-stroke accumulation. Both together enforce the ceiling in the dimension that matters first. `bytesUsed()` exposed for debug. Evict-oldest on overflow; cursor adjusts atomically.
- **Opacity slider: before-captured-on-pointerdown, pushed-on-pointerup.** Dragging a slider 200 times in a single drag gesture should be one undo entry. Solution: LayerPanel's slider tracks the drag-start value in a ref on `pointerdown`, lets the store mutate freely during drag (for live preview), and pushes `{before: ref.current, after: final}` on `pointerup`. Store-level setter is undo-free; the undo push lives in the UI component where the pointerdown/up semantics are known. Same pattern will apply to any future drag-commit control (hue slider, brush-size slider).
- **Narrow-selector contract held through N-row LayerPanel.** M3's narrow-selector invariant warned that a 4-layer editor with broad subscriptions would re-render every row on every stroke. M6's LayerPanel subscribes to `layers` + `activeLayerId` at the panel level (for row-list structure) and each row reads its own layer's fields via `layers.find(l => l.id === rowId)`. Pixel strokes mutate `layer.pixels` in place (off-store — preserves M3 zero-alloc invariant); the store `layers` array is reference-stable across strokes because identity-guarded setters only replace the array when layer metadata changes. Result: painting doesn't re-render the LayerPanel; only layer metadata changes do.
- **React 19 act-compat workaround for jsdom component tests.** `@testing-library/react` + React 19 + vitest still has act-warning churn around controlled inputs. Sidestepped by reusing M3's `createRoot` + `Profiler` pattern AND reading/writing native HTMLInputElement values (`input.value = 'x'; input.dispatchEvent(new Event('input', {bubbles: true}))`) instead of RTL's `fireEvent.change`. 14 LayerPanel tests ran green with no `act()` warnings. Pattern: jsdom input-driven tests are easier against raw DOM than against RTL when React 19 is in the mix.
- **Session-scoped UndoStack, not persisted.** The undoStack instance lives in `EditorLayout` via `useRef(new UndoStack())`; page reload gets a fresh empty stack. Matches Photoshop / Figma / Procreate web. Avoids schema-versioning undo records in IDB + the "stale undo references a layer id that no longer exists" class of bugs. Cost: a user who reloads loses history. Acceptable per DESIGN §12.5 M6 and industry precedent.

### What didn't

- **First draft of `composite()` forgot the scratch-canvas reset.** Unit 2's initial rewrite reused a module-scoped `OffscreenCanvas(64, 64)` across layers — correct — but didn't `clearRect` between layers, so layer N saw layer N-1's pixels still on the scratch. Tests caught it immediately: the "invisible layer skipped" scenario produced wrong output because the scratch still held the prior layer. Fix: `scratchCtx.clearRect(0, 0, 64, 64)` at the top of the per-layer loop. Added as an explicit "context reset" test case that asserts scratch is cleared between composites.
- **Initial stroke-recorder emitted bboxes in wrong coordinate space.** The M5 dispatcher's `stampLine` tracked the post-clamp atlas coords; the recorder's first pass accumulated the raw input coords before mirror/island-gate. Result: mirror-stroke tests showed bbox drift by up to 32 pixels on Y. Fix: recorder accepts `touchedBbox` values FROM the stamp functions (out-param contract from M3), not from input coords. `stampPencil`/`stampEraser`/`applyFillMask` compute and return their actually-written bbox; recorder unions them.
- **LayerPanel's first reorder attempt used array indices from the forward (bottom-to-top) array while rendering the reverse (top-to-bottom) view.** Off-by-N bug: clicking "up" on visual row 0 called `reorderLayers(0, 1)` which moved the bottom layer up, not the top layer down. Fix: the render layer maps `[...layers].reverse()` and all UI-side index math converts to forward indices via `forwardIdx = layers.length - 1 - visualIdx` at the callsite. Added a test asserting "click up on visual top row is a no-op."
- **`flushLayer(layer)` → `flushLayers(layers)` migration broke a small perf assumption.** M3's fast path flushed just the active layer during strokes at pointer cadence for sub-frame latency. Unit 2's composite rewrite changed this to a full composite per stamp, because opacity<1 or blendMode≠normal on the ACTIVE layer requires the full stack to render correctly. Feared latency regression; measured it — 4 drawImages at 64×64 is ~0.15ms on a 2023 MBP. Zero observable cost. Removed the fast path entirely; one code path is simpler and correct.
- **Unit 4's first mirror-bucket-bbox test failed because the bucket's mirror computation happened AFTER `strokeStart` had sealed the primary bbox snapshot.** The dispatcher called `stampPencil(primary)` → `stampPencil(mirror)` separately but only captured the primary's bbox as part of the recorder's touchedBbox. Fix: the recorder accepts BOTH `touchedBbox` and `mirrorTouchedBbox` in a single accumulate call, with the mirror parameter optional. Stamps that produce a mirror call accumulate both atomically.

### Invariants discovered

- **`putImageData` bypasses all 2D-context compositing state** per WHATWG HTML §4.12.5.1.14 — ignores `globalAlpha`, `globalCompositeOperation`, clipping, transforms, shadows, filters. The correct multi-layer composite pipeline is: `putImageData` each layer's bytes onto a scratch canvas, then `drawImage(scratch, 0, 0)` onto the main ctx with `globalAlpha = layer.opacity` and `globalCompositeOperation = BLEND_MODE_MAP[layer.blendMode]`. Pinned for M8 PNG export + any future compositing path.
- **`BLEND_MODE_MAP: Record<BlendMode, GlobalCompositeOperation>` is the exhaustive-mapping pattern extended from M2's `PART_ORDER` and M5's tool unions.** Adding a blend mode in a future milestone is a compile error until the mapping is updated. No runtime `switch`/`if` fallbacks that might silently miss a case.
- **Dispatcher chokepoint captures orthogonal concerns at O(1) cost per concern.** Undo diff-capture attached here covers all current and future tools. The same chokepoint is the right attachment point for telemetry ("stroke committed"), autosave hooks ("dirty after stroke-end"), and any future feature that needs to react to "a committed pixel mutation just happened." Not for per-event concerns — those belong in the paint surfaces.
- **Module-scoped `currentStroke` state is safe as long as `paintingRef` guarantees one active stroke across all paint surfaces.** Both 2D and 3D surfaces' `paintingRef` lifecycles never overlap (same dispatcher, mutually-exclusive by construction). If cross-surface continuous strokes ever land (M4 documented out-of-scope through M8), the recorder must move to per-surface state.
- **Session-scoped non-serializable instances (UndoStack, TextureManager) live in `useRef` at the component layer, NOT in zustand.** Zustand's middleware + devtools + persistence all assume slots are serializable. A `new UndoStack()` in a store slot would break IDB persistence and devtools introspection. Pattern: session instances in refs, references to them threaded via props or React context, never stored in the reactive state.
- **N-row panels preserve narrow-selector cost IFF the store mutation surface keeps reference stability at the array level.** `layers` array identity only changes when structural ops (add/delete/reorder) fire; scalar field edits (`setLayerOpacity`) replace the target layer's object but keep the array identity stable via immutable-update. Pixel mutations (`layer.pixels.set(...)`) don't touch the store at all — pure off-store mutation. Result: row re-render is O(layer-metadata-changed), not O(layers-total), even with dozens of rows.
- **Reverse-array rendering requires symmetric index conversion at every callsite.** `visualIdx ↔ forwardIdx = layers.length - 1 - visualIdx`. Never let the UI index leak into a store action; convert at the boundary. Document the convention where the reverse happens.

### Gotchas for future milestones

- **`flushLayer` single-layer fast path is gone.** `TextureManager.composite(layers)` is called on every pointer event during a stroke. 4 drawImages at 64×64 is cheap, but if a future milestone adds a 10-layer heavy-blend mode pass or a 256×256 atlas, re-measure. Don't reinstate a fast path without proving the measured regression.
- **`useActiveLayer()` returns `undefined` if no layers exist.** Store init seeds one layer on mount, but a defensive consumer (e.g., a raycaster running before mount-complete) can see undefined. All M6 consumers guard with `if (!activeLayer) return`. New consumers must too.
- **Opacity < 1 on the BOTTOM-most layer composites against a cleared canvas.** Correct behavior (the editor shows a checkered BG through transparency). If a future feature adds a "paper/background layer" concept, the bottom layer's opacity now has visible-to-user meaning — document carefully.
- **Undo record's `layerId` is a weak reference.** If a user deletes layer L and then undoes the delete, L is restored BUT with the same id. If M7+ adds "paste layer from clipboard" or "duplicate layer," the new layer MUST get a fresh `crypto.randomUUID()` — never reuse a deleted layer's id, because the undo stack may still hold stroke records targeting that id.
- **LayerPanel drag-reorder is pointer-event hand-rolled; jsdom testing is limited to click-the-arrow-button + direct store-action calls.** Full drag flow is manual-QA only. If Safari starts behaving oddly on future milestones that also use `setPointerCapture`, the LayerPanel drag handler is a candidate.
- **M3 P2/P3 gotchas still unresolved after M6:**
  - `handleWheel` torn state (zoom+pan in two store sets) — deferred through M3 → M4 → M5 → M6. Still not worth the scope.
  - Toolbar 'b' hotkey + Cmd+B browser shortcut collision — M4 gotcha; M6 didn't touch toolbar.
  - `aria-valuetext` on `role="application"` in SL square — M3 amendment 4 lock; M6 didn't migrate to visually-hidden `aria-live` sibling.
- **M6 didn't touch active-layer-change mid-stroke.** If the user's hotkey-to-change-active-layer (not yet in UI) fires mid-stroke, `paintingRef` continues writing to the OLD layer. Extend the `useEffect([textureManager, activeLayerId])` race-reset to reset paintingRef if a future milestone adds layer-change hotkeys.
- **Variant toggle (Classic ↔ Slim) clears the undo stack.** Unit 1's use-texture-manager resets layers on variant change; the session undoStack is NOT cleared automatically. If a user paints, switches variant, switches back, and Cmd+Z's, the stack replays onto the fresh layer — the `layerId` lookup will find the base layer but pixel bytes may not match. M7 (templates) or M8 (export) should either (a) clear the undo stack on variant change, or (b) gate undo to the current variant's session. Current M6 behavior: undefined. Add a `undoStack.clear()` call to the variant-change effect as a Unit 0 chore in M7.
- **Undo record captures `Uint8ClampedArray.slice()` for before/after.** That's a defensive copy (good — the layer.pixels buffer mutates in place). If a future optimization tries to share the same underlying buffer between the undo record and the live layer, it will silently corrupt on the next stamp. The `.slice()` is load-bearing.

### Pinned facts for next milestones

**Exact version deltas from M5:**

- No new dependencies. Drag-reorder hand-rolled; LayerPanel pure DOM (no drei); blend-mode dropdown is native `<select>`; opacity slider is native `<input type="range">`.
- All M5 pins unchanged.

**File paths established:**

- `lib/editor/types.ts` — `Bbox`, `StrokePatch`, `Stroke` (with `patches: StrokePatch[]`), `BlendMode` union `'normal' | 'multiply' | 'overlay' | 'screen'`.
- `lib/editor/diff.ts` — `sliceRegion(pixels, bbox): Uint8ClampedArray`, `applyRegion(pixels, bbox, region): void`, `unionBbox(a, b): Bbox`.
- `lib/editor/undo.ts` — `UndoStack` class + `Command` union + `EditorActions` adapter interface. `MAX_HISTORY_BYTES = 5 * 1024 * 1024`, `MAX_HISTORY_COUNT = 100`. No React/zustand imports.
- `lib/editor/store.ts` — adds `layers: Layer[]`, `activeLayerId: string`, `strokeActive: boolean` + the full layer-lifecycle actions.
- `lib/editor/texture.ts` — `BLEND_MODE_MAP: Record<BlendMode, GlobalCompositeOperation>`; module-scoped scratch OffscreenCanvas (64×64) with fallback `document.createElement('canvas')`; `composite(layers)` honors opacity + blend per layer; `flushLayers(layers)` replaces `flushLayer(layer)`.
- `lib/editor/tools/dispatch.ts` — module-scoped `currentStroke: StrokeRecorderState | null`; `StrokeContext` adds `layers`, `onStrokeCommit(stroke)`, `onStrokeActive(active)`; `strokeStart` clones preImage, `strokeContinue` unions bboxes, `strokeEnd` slices + emits `Stroke` command.
- `lib/editor/use-texture-manager.ts` — bundle shape is now `{ textureManager }`; layers live in the store; `useActiveLayer()` resolves reactively.
- `lib/editor/persistence.ts` — `getLayers` + `getActiveLayerId` replace `getLayer`; `buildDocument` serializes full array; `loadDocument` backward-compatible with M3–M5 single-layer records.
- `app/editor/_components/EditorLayout.tsx` — owns `useRef(new UndoStack())`; builds `EditorActions` adapter; installs Cmd/Ctrl+Z window listener; threads `onStrokeCommit` + `onStrokeActive` to paint surfaces; threads `onLayerUndoPush` to Sidebar.
- `app/editor/_components/LayerPanel.tsx` — N-row panel with add/delete/reorder (drag + arrow-button fallback)/rename/opacity slider/blend dropdown/visibility/active-select. Opacity drag snapshots before-value in ref on pointerdown, emits one undo entry on pointerup.
- `app/editor/_components/Sidebar.tsx` — renders `<LayerPanel onUndoPush={...} />` below `<ColorPicker />`.
- `tests/diff.test.ts`, `tests/undo.test.ts`, `tests/layer-store.test.ts`, `tests/layer-panel.test.ts`, `tests/undo-shortcuts.test.ts` — 80+ new tests.

**Conventions established:**

- Session-local non-serializable instances (UndoStack, TextureManager) live in `useRef` at the top component layer, never in zustand.
- Stateful modules that mutate app state define a narrow `EditorActions`-shaped adapter interface and accept it as a param. No direct store/React imports.
- Off-store pixel mutation (`layer.pixels.set(...)`) preserves narrow-selector re-render cost; store mutations only fire on layer METADATA changes (add/delete/reorder/opacity/blend/visibility/rename).
- Reverse-array rendering for top-to-bottom layer panels: `[...layers].reverse()` at render; `forwardIdx = length - 1 - visualIdx` at every store-action boundary.
- Drag-commit UI controls (opacity slider pattern) snapshot `before` on `pointerdown` in a ref; mutate freely during drag; push one undo entry on `pointerup` with `{before, after}`.
- `Record<Union, T>` for exhaustive blend-mode / command-kind / tool-id mappings. Add-new-member-is-a-compile-error.
- Dispatcher is THE single chokepoint for orthogonal concerns (undo capture here; future: telemetry, autosave hooks).

**Bundle baseline update:**

- `/editor`: 363 → **368 kB** First Load JS (+5, well under the +15 kB plan budget). LayerPanel + undo.ts + diff.ts + store deltas account for the delta.
- `/` (landing): 3.45 kB / 106 kB (unchanged).
- Route chunk: 260 → **265 kB**.

**Test baseline:**

- 260 → **349** tests (+89). Per-unit additions approximated: Unit 1 +19 (layer-store), Unit 2 +12 diff + ~10 composite scenarios, Unit 3 +16 (undo), Unit 4 +8 (recorder), Unit 5 +4 (persistence), Unit 6 +14 (layer-panel), Unit 7 +12 (undo-shortcuts).

**Audit baseline:**

- **0 vulnerabilities** (production and full). Zero new dependencies; audit surface unchanged from M5.

### Recommended reading for M7

- This file's M6 §Invariants — the dispatcher-chokepoint pattern, `BLEND_MODE_MAP` exhaustive mapping, and off-store pixel mutation convention are immediately reused by templates (M7 will add a "apply template" action; route via the dispatcher as an atomic `Stroke`-equivalent command so undo works for free).
- This file's M6 §Gotchas — the variant-toggle-clears-undo Unit 0 chore for M7 is a prerequisite before adding template application (templates are variant-specific).
- `lib/editor/undo.ts` — M7 templates-as-commands will add a new `Command` kind. Follow the existing union + size() + apply/revert pattern.
- `lib/editor/tools/dispatch.ts` — the `StrokeRecorder` shape is the model for any future multi-step atomic operations (paste, template apply, clipboard ops).
- `docs/plans/m6-layers-undo-plan.md` D2 rationale — canonical for any future "multi-region atomic command" where a spanning bbox would waste memory.

## M7: Templates + Ghost Picker — 2026-04-21

### What worked

- **Unit 0 as a decoupling refactor, not a "first real unit."** M6's variant-toggle gotcha (undo stack silently misaligned after Classic↔Slim) was fixed in Unit 0 by splitting `use-texture-manager` into Effect A (TM lifecycle, `[variant]`) and Effect B (placeholder seed, `[bundle, layers.length, variant]`). The payoff landed two units later — Unit 4's `applyTemplateState` could flip variant + layers atomically without the TM re-seeding over the just-applied template. Pattern: when a milestone's first act is "this M-1 gotcha becomes load-bearing," formalize the fix as Unit 0 before anything that depends on the fixed invariant.
- **`cancelActiveTransition()` as a named chokepoint.** Four timer handles (hint-on, pulse-on, pulse-off, hint-off) are scheduled at +700/+1000/+1600/+3700 ms after template apply. Three different call sites need to cancel them: a new apply while a prior is mid-transition (Unit 4), an undo/redo of an apply-template command (Unit 4 + EditorActions adapter), and component teardown (Unit 7). Naming the bundle `cancelActiveTransition()` and calling it from all three sites kept the timer model legible. Pattern: any feature with 3+ scheduled timers that multiple event paths can pre-empt should name the cancellation surface rather than inlining `clearTimeout` at each site.
- **M7 TIMING exported as a single `as const` object.** `templates.ts` ships `TIMING = { CHIP_DELAY_MS: 3500, HINT_DELAY_MS: 700, HINT_DURATION_MS: 3000, PULSE_DELAY_MS: 1000, PULSE_DURATION_MS: 600, CROSSFADE_MS: 200 } as const`. Every timed UI affordance in M7 — and now the M8 first-paint hook — reads from this table. Touching one value is a single-file change; a future "slow down for screenshots" knob is a single const override. Pattern: when 3+ UI affordances share timing vocabulary, a single frozen table beats scattered literals.
- **Apply-template guardrails are layered.** The orchestrator rejects with typed reasons for: `stroke-active` (don't interrupt a drag), `hydrating` (don't fire before IDB settles), `bad-pixel-length` (defense in depth; decoder error + manifest mismatch guard), `same-template-no-force` (explicit user reapply is fine; auto-reapply is a bug). Four early returns with named reasons made the integration tests trivially deterministic.
- **Hand-rolled ARIA dialog + focus trap, no `@radix-ui` dependency.** The bottom-sheet is ~80 LOC of dialog role + focus trap + Escape handler + backdrop click. Zero bundle cost vs. `@radix-ui/react-dialog` at ~8 KB. Adopted directly into M8's ExportDialog.
- **PNG fixture generator in pure Node.** `scripts/gen-template-placeholders.mjs` encodes 64×64 RGBA PNGs via CRC32 + zlib deflate with no deps, runs in ~50ms, fits in 120 LOC. M8 can borrow the same encoder if browser-emitted PNGs fail in-game (unlikely but cheap insurance).
- **TemplateGate state machine extracted to a pure reducer.** `lib/editor/template-gate-state.ts` is 10 events + 4 states + priorState for menu-initiated sheet opens. 36 reducer tests ran against the pure function before any React wiring. The `useTemplateGate(hydrationPending)` hook is ~30 LOC wrapping the reducer + dismiss persistence. Tests matter more than the React-wrapping.
- **Placeholder fixtures ship as checkerboards in `public/templates/`.** Real art blocked but we could still validate the entire pipeline (manifest fetch, decode, apply, transition, persistence). M8's landing page should follow suit: no art blocker = no milestone delay.

### What didn't

- **"WebP thumbnails" in the initial plan.** Node stdlib has no WebP encoder. Shipped PNG thumbnails instead; manifest entries now end in `.png` for `thumbnail` URLs. The +overhead is ~5 KB total for 11 thumbnails. Flagged as an M8-or-later swap target if repo size starts mattering, but it probably never will.
- **jsdom + TextureManager integration tests required getContext + ImageData stubs.** Three tests needed `vi.stubGlobal('ImageData', ...)` and a `HTMLCanvasElement.prototype.getContext` mock that returned fillRect / putImageData / getImageData shims. Not a huge amount of code but a repeat cost every time a test file touches the TM. M8 export tests will reuse the same stubs.
- **The `@vitest-environment jsdom` directive must be at the very first line of a test file.** Below the import block silently fails — tests see Node globals and throw `document is not defined` at the first DOM touch. Pinned for M8.

### Invariants discovered

- **Timer handles that can be pre-empted from three+ sites deserve a named cancel surface.** `cancelActiveTransition()` now owns the four M7 transition timers. M8's first-paint hook will own a parallel set (cursor glow + contextual hint + pulse + Y-rotation pulse) that must cancel on first stroke. Copy the pattern.
- **`applyTemplateState` is an atomic whole-document store write that BYPASSES `setVariant`'s layer-clear.** A template-apply variant flip is semantically different from a user-initiated variant flip. Don't converge them — the former preserves the just-applied template; the latter correctly clobbers. Two separate paths in `store.ts`.
- **EditorLayout owns the undo-stack subscription AND the gate reducer hoist.** `useTemplateGate(hydrationPending)` is called once at the EditorLayout layer so both the overlay (TemplateGate) and the Sidebar TemplateMenuButton dispatch into the same state machine. Child components receive `{state, dispatch}` as props. Pattern: hoist any reducer whose events come from multiple non-sibling components to the nearest common ancestor.
- **`markEdited` is idempotent and routes through the existing dispatcher onStrokeCommit.** Flipping `hasEditedSinceTemplate: false → true` at the store level — not per-tool — means every future tool (and every past tool) benefits for free. The M6 dispatcher-chokepoint pattern extended again.
- **Hydration-pending gates ALL paint interaction AND all conditional transition triggers.** TemplateGate reads `hydrationPending` to avoid flashing the chip before IDB settles; ApplyTemplate rejects with `reason:'hydrating'` if called too early. M8's first-paint hook must gate the same way.

### Gotchas for future milestones

- **Undo's apply-template command deep-clones layer pixel buffers via `l.pixels.slice()` when capturing `before`.** Without the slice, the undo record shares the live pixel buffer and the next stamp mutates history. The M6 `.slice()` invariant from stroke commands applies just as hard here. Review before any future "whole-layer snapshot" command kind.
- **`template-gate-storage.ts` writes a single boolean to localStorage.** It's fail-soft (try/catch on both read and write) so Private Browsing doesn't break the gate. Don't grow this into a general user-prefs store without reconsidering quota; use IDB for anything larger.
- **DESIGN §10's shader snippet used the pre-r152 token `output_fragment`.** Fixed in M8 Unit 0. If any future doc snippet is copy-pasted from DESIGN, verify the three.js version at the time of writing.
- **Variant toggle clears the undo stack — still, per M6's gotcha — but applyTemplate preserves it.** The two paths converge correctly by Unit 4's design (variant flip via setVariant; template flip via applyTemplateState). A future "import JSON skin" command kind should follow applyTemplateState's shape, not setVariant's.
- **Idb persistence of `hasEditedSinceTemplate` defaults to `true` for M3–M6 records** in `loadDocument`. This is intentional — returning users with pre-M7 saves must NOT be re-prompted by the Ghost picker. If a future milestone adds a "starter template" onboarding for returning users, it must check IDB state on load, not rely on the flag alone.

### Pinned facts for next milestones

**Exact version deltas from M6:** none. Zero new dependencies across M7 (pure-Node PNG encoder, hand-rolled dialog, no `@radix-ui/react-dialog`). All M6 pins unchanged.

**File paths established:**

- `lib/editor/apply-template.ts` — `applyTemplate(actions, pushCommand, template, pixels, options)` orchestrator + `cancelActiveTransition()` + `ApplyTemplateActions` adapter type.
- `lib/editor/templates.ts` — `TIMING` const + `loadManifest()` + `decodeTemplatePng(url)` + `clearDecodeCache()` + `isValidTemplate` + `normalizeTemplate`.
- `lib/editor/template-gate-state.ts` — pure reducer (GateState ×4, GateEvent ×10).
- `lib/editor/template-gate-storage.ts` — `readDismissed()` / `writeDismissed()` localStorage wrapper.
- `lib/editor/types.ts` — `TemplateMeta`, `TemplateCategory`, `TemplateManifest`, `ApplyTemplateSnapshot`, `AffordancePulseTarget` types.
- `lib/editor/store.ts` — adds `hasEditedSinceTemplate`, `lastAppliedTemplateId`, `activeContextualHint`, `pulseTarget` slots; `markEdited`, `setActiveContextualHint`, `clearContextualHint`, `setPulseTarget`, `applyTemplateState` actions.
- `lib/editor/undo.ts` — Command union gets `'apply-template'` kind. `EditorActions` adapter gets `applyTemplateSnapshot`.
- `public/templates/manifest.json` + `public/templates/{classic,slim,thumbs}/*.png` — static assets, not bundled.
- `app/editor/_components/{TemplateGate,TemplateSuggestionChip,TemplateBottomSheet,TemplateCard,TemplateMenuButton,ContextualHintOverlay,AffordancePulse,useTemplateGate}.tsx|ts`.
- `scripts/gen-template-placeholders.mjs` — pure-Node PNG encoder, reusable.

**Conventions established:**

- Timers that span 3+ cancellation call sites get a named `cancelActiveTransition()`-style surface.
- Atomic whole-document store writes (apply-template) bypass the per-field setters that have other semantics (setVariant's layer-clear).
- Hand-rolled ARIA dialog + focus trap is the approved pattern; no `@radix-ui` dialog dependency.
- TIMING tables live as named const objects in the feature's pure module, not inline literals across components.
- Gate/state reducers hoist to the nearest common ancestor (EditorLayout) and pass `{state, dispatch}` as props.

**Bundle baseline update:**

- `/editor`: 368 → **373 kB** First Load JS (+5, well under the +15 kB plan budget). Confirmed on `m7-templates` branch build after the white-skin/undo-button follow-up merged.
- `/` (landing): 3.45 kB / 106 kB (unchanged).

**Test baseline:**

- 349 → **493** tests (+144). Plus a follow-up +4 for UndoRedoControls; plus +2 for UndoStack.subscribe. All 493 pass on `main` post-merge.

**Audit baseline:**

- **0 vulnerabilities**. Zero new dependencies.

### Recommended reading for M8

- This file's M7 §Invariants — the `cancelActiveTransition()` pattern, `applyTemplateState`-vs-`setVariant` split, and idempotent `markEdited` are directly reused by M8's export guardrail (reads `hasEditedSinceTemplate`) and first-paint hook (cancels on first stroke).
- `lib/editor/apply-template.ts` — the orchestrator shape is the template for M8's `exportLayersToBlob` orchestrator, though M8's is simpler (one-shot, no timers).
- `app/editor/_components/TemplateBottomSheet.tsx` — copy this ARIA/focus-trap shape for `ExportDialog`.
- `lib/editor/templates.ts` TIMING table — extend it with M8's first-paint milestones if they need persistence; otherwise the hook-local constants are fine.
- `docs/plans/m8-export-polish-plan.md` D15 — the three.js `opaque_fragment` correction DESIGN §10 has now shipped.

## M8: Export + Onboarding Polish — 2026-04-22

### What worked

- **Reusing `TextureManager` as the export compositor.** `lib/editor/export.ts::exportLayersToBlob` instantiates a `TextureManager` against a throwaway canvas using the M6 amendment-1 constructor injection (`new TextureManager(canvas, ctx, scratchCanvas, scratchCtx)`). Zero duplicated pipeline; all blend-mode, opacity, and alpha-correct compositing is inherited. The pixel-parity test compares exported bytes against `composite()` bytes byte-for-byte and passes. Pattern: when a new feature needs a compositor that the app already has, inject a throwaway target canvas rather than extracting the pipeline.
- **Plan Unit 0 fixed the DESIGN §10 shader-token bug BEFORE any shader code was written.** M7's COMPOUND recommended reading DESIGN §10; if M8 had followed it literally, the grayscale injection would have silently no-op'd on three 0.184 because `#include <output_fragment>` had been renamed to `#include <opaque_fragment>` in three r152. External research in the planning phase caught the rename; Unit 0 amended DESIGN before Unit 4 wrote the module. Pattern: when a DESIGN snippet is known-stale against a dependency, the doc fix is a Unit 0, not a note-to-self during review.
- **Shared-uniform escape hatch for `customProgramCacheKey`.** `grayscaleUniform = { value: false }` is a module-scoped singleton; every patched `meshStandardMaterial` attaches `shader.uniforms.uGrayscale = grayscaleUniform` at compile, referencing the SAME object. Mutating `.value` propagates to all 12 PlayerModel meshes without a recompile and without needing per-material cache keys. The three.js docs' footgun (twelve meshes sharing one compiled program where only the first-compiled flag is honored) simply doesn't apply to uniform-only changes. Pattern: if a feature needs a toggled uniform across multiple materials, a shared uniform object is strictly simpler than per-material `customProgramCacheKey` management.
- **Reusing M7's TIMING + ContextualHintOverlay + AffordancePulse for first-paint.** The M7 infrastructure was built for template-to-edit transitions, but the same primitives (hint at +700ms, pulse at +1000ms, Y-rotation at +1600ms) work identically for the cold editor-land path. M8's first-paint hook is just a new trigger that writes to the same store slots. Zero new visual primitives. Pattern: when a new feature matches an existing animation vocabulary, widening the triggering surface beats building a parallel system.
- **Folded first-paint Y-rotation pulse into M7's `yRotationPulseKey` state.** Rather than adding `firstPaintPulseKey` as a separate piece of state, M8 Unit 8 proved that first-paint and template-apply Y-rotations never overlap (template-apply requires user interaction after first-paint has completed) and reuses the single key. One state slot, one PlayerModel prop, identical visuals.
- **Hand-rolled ARIA dialog + focus trap reused (again) from `TemplateBottomSheet` for `ExportDialog`.** Same ~80-LOC pattern: `role="dialog"`, `aria-modal="true"`, focus trap on mount, Escape to close, backdrop click to close, focus restore on close. Zero new `@radix-ui` dependency. Bundle cost +2 KB for the whole ExportDialog.
- **Progressive enhancement for `showSaveFilePicker`.** Chromium-only native picker for 2026; anchor-click fallback for Firefox/Safari. User-cancelled native picker (AbortError) is swallowed without falling back to anchor-click — prevents the double-dialog UX wart where cancelling the native picker opened a browser download anyway.
- **Explicit `{ colorSpace: 'srgb' }` on export canvas `getContext`.** Chrome's default color-space conversion on toBlob encode was flagged in research; explicit sRGB pinning keeps exported RGB values identical to what's in `layer.pixels`. Safety rail; may or may not have mattered in practice.

### What didn't

- **`blob.arrayBuffer` is missing from jsdom's Blob.** Discovered at test-write time; polyfilled in `tests/export.test.ts` via `FileReader.readAsArrayBuffer`. Not a stopper but worth pinning: any future test that reads Blob bytes via `arrayBuffer()` in jsdom must either polyfill or refactor to use the callback form.
- **`URL.createObjectURL` also missing from jsdom.** Same polyfill block at top of the test file.
- **`HTMLCanvasElement.prototype.toBlob` is a no-op in jsdom** — returns null via the callback. The test file stubs it to emit a synthetic `<PNG-signature><backing-bytes>` Blob. This isn't a real PNG; the pixel-parity test compares the backing bytes directly, not a decoded PNG. For "does the file actually open in Minecraft?" acceptance, manual in-game QA remains the only signal (documented in Unit 10 checklist).
- **React 19 + jsdom `setInputValue + dispatchEvent` doesn't trigger onChange.** Setting `input.checked = true` + dispatching a native `change` event didn't trip React's synthetic onChange on the export-dialog variant selector. Switched to clicking the `<label>` element (sr-only radio inside) — React's onChange fires from the label click. Pattern: for radio/checkbox tests in React 19 + jsdom, click the associated label, not the input.
- **Variant-selector mismatch test caught a semantic question.** The radio group reflects dialog-local state (not the store) so the user can export as a different variant without flipping the editor's variant. Intentional per the plan; the mismatch warning surfaces the override. No bug, just a design decision worth re-stating in the next COMPOUND entry.

### Invariants discovered

- **Export's output canvas is short-lived and MUST NOT be the TextureManager's live canvas.** The TM canvas feeds the R3F renderer; blitting through it mid-render would produce a flash. `createExportCanvas()` allocates a fresh 64×64 canvas scoped to the export call; `tm.dispose()` runs in the finally block.
- **`canvas.toBlob(cb, 'image/png')` — no quality arg ever.** MDN confirms the third argument is ignored for PNG. Passing it doesn't cause a bug but it signals misunderstanding; the export module comment captures this.
- **The `opaque_fragment` chunk is the three.js 0.184 canonical token.** Inline-commented in `grayscale-shader.ts` so a future reader doesn't re-rediscover the r152 rename.
- **Shared uniform objects propagate to the GPU without recompile.** `shader.uniforms.uGrayscale = grayscaleUniform` is shared ref; mutating `.value` is a GPU-cheap uniform update next frame. This is the documented three.js idiom for runtime flag toggles across material instances.
- **Dialog focus trap pattern is copy-pasteable.** `TemplateBottomSheet` + `ExportDialog` share the exact same focus-trap code. A future Unit that needs another modal should copy once more; extracting to a shared hook would save ~20 LOC but cost readability. Threshold: 3 uses = extract.
- **First-paint sequence cancels on first stroke via a store subscription.** The M7 `markEdited` chokepoint flips `hasEditedSinceTemplate: false → true`. A `useEditorStore.subscribe` in EditorLayout observes that transition and calls `cancelFirstPaint()`. Zero per-tool changes. Same pattern the M6/M7 dispatcher chokepoint invariant describes, now extended to a new consumer.

### Gotchas for future milestones

- **The export module accesses `document.createElement('canvas')` inside `exportLayersToBlob`.** SSR-safe-by-accident because the function is only called from click handlers inside client components. If a future server-side export path emerges (pre-rendered OG images for shared skins, say), this module needs a headless canvas replacement (`node-canvas`, `@napi-rs/canvas`, or moving to offscreen). M9+ concern.
- **The first-paint hook fires only when `lastAppliedTemplateId === null`.** Returning users with a saved template reload and skip the sequence — correct per DESIGN intent. But if a future milestone adds "tutorial mode" (replayable for any user), it needs a different gate.
- **`data-first-paint` attribute on the root div scopes the cursor-glow CSS.** If a future UI restructures EditorLayout's root element, the CSS selector `[data-first-paint="true"] [data-pulse-target="brush"]` breaks silently. Grep before refactoring root-level attributes.
- **`showSaveFilePicker` requires HTTPS + user gesture.** Works on localhost but fails on plain-HTTP staging envs. If a non-HTTPS preview ever exists, the picker code silently falls back to anchor-click — user sees a filename-auto-generated download instead of a picker. Acceptable; documented here for anyone debugging "why doesn't the native picker show on the staging preview."
- **The Luminance CSS filter is scoped to `<ViewportUV>`'s outer div.** If a future feature adds an overlay inside ViewportUV that SHOULD stay in color (a color-picker inside the 2D view, say), it'll desaturate with everything else. Either move the filter to a deeper container or add an `!important` override on the exception.
- **`canvas.toBlob` stubbed in tests does not validate the PNG CRC or chunk structure.** Real Minecraft-compatibility QA is in-game only. If export breaks in a future refactor, expect the unit tests to pass and in-game QA to catch it. Consider adding a node-side PNG parse step to `tests/export.test.ts` via a pure-Node decoder if this becomes a recurring miss.

### Pinned facts for next milestones

**Exact version deltas from M7:** none. Zero new dependencies across M8. Hand-rolled export + hand-rolled dialog + hand-rolled shader-patch module. All M7 pins unchanged.

**File paths established:**

- `lib/editor/export.ts` — `exportLayersToBlob`, `downloadBlob`, `buildExportFilename`, `sanitizeFilename`. Pure module, zero React/zustand imports.
- `lib/editor/grayscale-shader.ts` — `grayscaleUniform: { value: boolean }` + `patchMaterial(material)`. Pure module (only three `Material` type import).
- `app/editor/_components/ExportDialog.tsx` — ARIA dialog. Guardrail branch and normal branch.
- `app/editor/_components/LuminanceToggle.tsx` — top-center pill. Mounts in the 3D pane.
- Store additions: `luminanceEnabled: boolean` + `setLuminanceEnabled`. `TIMING.FIRST_PAINT_GLOW_MS` + `TIMING.FIRST_PAINT_PULSE_MS` added to `lib/editor/templates.ts`.
- EditorLayout additions: `exportOpen` state, `firstPaintActive` state, `firstPaintFiredRef`, `firstPaintTimersRef`, `cancelFirstPaint`, `useFirstPaint` effect, L hotkey branch in the keydown listener. `data-first-paint` attribute on root.

**Conventions established:**

- Dialog focus-trap pattern: `TemplateBottomSheet` + `ExportDialog` are the two canonical examples.
- Shared uniform objects for runtime GPU toggles (no `customProgramCacheKey` unless per-material variance is required).
- User-gesture-preserving download: `canvas.toBlob` callback form → `URL.createObjectURL` + `<a download>` click inside the callback.
- Progressive enhancement order: native picker first, anchor-click fallback. `AbortError` swallowed, not fallback-triggered.
- First-paint = cold editor-land with no template; template-to-edit = post-template-apply. Both share M7's TIMING vocabulary.

**Bundle baseline update:**

- `/editor`: 373 → **375 kB** First Load JS (+2, vs +10 kB plan budget).
- `/` (landing): **3.45 kB / 106 kB** — unchanged (typography-only expansion).
- Route chunks unchanged for `/`; `/editor` route 271 → 273 kB.

**Test baseline:**

- 493 → **549** tests (+56). Per-unit additions: Unit 1 +15 (export), Units 2+3 +13 (export dialog + guardrail), Unit 4 +9 (grayscale shader), Unit 6 +7 (luminance toggle), Units 7+8 +7 (first-paint), Unit 9 +5 (landing page).

**Audit baseline:**

- **0 vulnerabilities**. Zero new dependencies.

**Lighthouse:**

- Manual QA item in Unit 10 acceptance checklist. Landing page is ○ (Static), typography-only, no client JS beyond next/link internals, `prefetch={false}` on CTA. Realistic target ≥95 on both mobile and desktop; actual score recorded at PR time.

### Recommended reading for M9

- This file's M8 §Invariants — the shared-uniform pattern is directly reusable for any future GPU-state toggle (e.g., highlight-pickable-regions in Phase 2 multiplayer, color-edit-preview in M9 color adjustments).
- `lib/editor/export.ts` — if a server-side OG image pipeline emerges (Phase 2), this is the shape to replicate server-side with a Node canvas library. The composite code is library-agnostic.
- `app/editor/_components/ExportDialog.tsx` + `TemplateBottomSheet.tsx` — the third ARIA dialog (M9?) should extract a shared focus-trap hook; two copies is fine, three is friction.
- `docs/plans/m8-export-polish-plan.md` D15 — the DESIGN §10 shader-token correction is a standing precedent: any doc snippet copy-pasted from DESIGN must be verified against the current dependency version.

## M9: Firebase + Supabase Scaffolding — 2026-04-23

### What worked

- **Plan-code sample type-verified before Unit 1 began.** The plan had `getFirestore(db)` using `db` before its initialization; Unit 1's first implementation pass caught and fixed it. This is the **second** plan-sample bug in the journal (M1's `cat .next/server/app/page.html` was the first). Pattern escalates to an invariant: plan code samples must be read critically as pseudocode, not copy-pasted. A 30-second tsc-in-head during plan review would have caught both.
- **Research-driven Unit 0 (`server-only` barrier) added at fix-time, not ship-time.** The plan did not call out `import 'server-only'` as a requirement. The /ce:review security agent plus the learnings-researcher both surfaced the gap; adding it inside the M9 review round (rather than deferring to M10's "first real admin consumer") means M10's work starts with the compile-time boundary already in place. Pattern: when research flags a cheap compile-time guard for a soon-to-ship abstraction, add it before the first consumer, not after.
- **Singleton + env-read-at-init-time.** `readFirebaseConfig()` / `readAdminConfig()` / `getSupabase` all read `process.env.*` inside the getter function, not at module-load. This makes `vi.stubEnv` in test beforeEach hooks work without dynamic imports or module-reset hacks. Pattern: any module that reads env must read it lazily — test-friendliness is a side-effect; the primary reason is production robustness (env changes between build and runtime, or between serverless cold start and subsequent invocations, are honored).
- **Throwaway RSA keypair in admin tests via `node:crypto.generateKeyPairSync`.** The plan suggested a short base64 string as a stub PEM; `cert()` performs ASN.1 parse and rejected it. Generating a real 2048-bit PKCS8 keypair at test-file-import time takes ~50 ms and lets the full init path run. Pattern for any test that exercises an SDK with cryptographic validation: generate real inputs via stdlib crypto rather than stubbing strings.
- **Reviewing dispatched 7 parallel agents; 3 of them converged on the same P1 (`server-only` barrier).** Cross-reviewer agreement was the strongest signal for severity. Routing stayed conservative per `ce:review` Stage 5 rules: disagreements push findings toward the narrower route, not wider.
- **firestore.rules ships with the security-fix round as part of M9, not deferred to M10.** Two rules bugs (likes-delete using null `request.resource`, likes-create not enforcing the doc-id convention) would have shipped silently until M10's first real like-toggle attempt. Catching them at scaffolding time costs nothing; catching them post-M10 means a user-visible broken feature.

### What didn't

- **`server-only` broke vitest at first install.** The package throws in non-server-component contexts; admin tests under vitest (node env) hit it immediately. Fix: alias `server-only` → `node_modules/server-only/empty.js` in `vitest.config.ts`. The package.json `exports` field hides empty.js from normal package-path resolution (only `react-server` condition can reach it), so the alias had to point at the on-disk file directly. Pattern: any Next.js build-time guard package (`server-only`, `client-only`) needs a test-env alias to the sibling no-op shim.
- **`StorageFileApi` is declared but not exported from @supabase/storage-js.** Attempting `import type { StorageFileApi }` fails — the symbol is module-private. Derived the type via `ReturnType<SupabaseClient['storage']['from']>` instead. Pattern: when a library's public types are thin, derive from the call signature; stays accurate across minor-version bumps.
- **Firebase Auth validates API-key format at init.** First tests stubbed `'test-api-key'`; `getAuth()` threw `auth/invalid-api-key`. Fix: use a plausible `AIza`-prefixed 39-char string. No actual Google API call fires, so the format check is shape-only.
- **Plan's Unit 2 used `firebase-admin/app` etc. but the package wasn't in package.json.** The user's Unit 0 instruction was "install dependencies already added to package.json"; `firebase-admin` had to be installed separately. Added with a note in the commit message. Pattern: plan author should run an `npm install --dry-run` pass before declaring "deps pre-added" — the paper-only pass misses server-side packages that look similar to client-side ones.
- **10 moderate/low vulnerabilities in firebase-admin's transitive tree (gaxios, uuid).** Server-only scope — never bundled to client. Accepted for M9; revisit trigger: when firebase-admin ships a release with upstream fixes, OR when M11 first writes from a server action.

### Invariants discovered

- **`'use client'` is now permitted in `lib/` for browser-only SDK accessor modules,** extending the M2 PlayerModel exception. The directive enforces the build-time client/server boundary the same way PlayerModel's does; the broader rule is "`'use client'` in `lib/` is acceptable when the module is (a) a UI-component-shaped React file OR (b) a browser-only SDK accessor that must not be imported from server paths." Currently: `PlayerModel.tsx`, `firebase/client.ts`, `supabase/client.ts`.
- **`import 'server-only'` is the inverse boundary guard for admin-side modules.** Any module that reads a secret (Firebase Admin private key, Supabase service-role key when that lands) should start with `import 'server-only'`. Requires the vitest alias trick documented in the "What didn't" section above.
- **The M6 "non-serializable session instance lives in useRef, not zustand" invariant does NOT apply to React-reactive identity values.** The Firebase Auth `User` object is non-serializable BUT is tracked by React state via the AuthProvider's `useState` — consumers need to re-render on sign-in/out. The M6 invariant's stated reason is "zustand persist/devtools assume serializable," which doesn't apply to React context. Operational rule: **non-serializable SDK instances** (Auth singleton, TextureManager) live in module scope or useRef; **reactive identity values** (User, feature flags the UI reacts to) live in useState + React context; **serializable derived projections** of reactive values (userId, email) may live in zustand if needed — but the raw non-serializable object must not.
- **Doc-ID conventions belong in the rules layer when they encode uniqueness.** DESIGN §11.4 described `${skinId}_${uid}` as a client-side convention for the likes collection; committing it only on the client meant a malicious or buggy client could bypass it. Moving the enforcement into firestore.rules (`likeId == request.resource.data.skinId + '_' + request.auth.uid`) makes the uniqueness invariant a real server-enforced constraint — a second create at the same path hits "already exists" instead of creating a sibling doc.
- **Delete rules read `resource.data` (existing doc); create rules read `request.resource.data` (incoming).** `request.resource` is null on delete; a combined `create, delete` rule using `request.resource.data.*` always denies. Split them whenever the delete side needs to read the doc it's deleting.
- **Plan code samples must be treated as pseudocode, not copy-paste.** Two incidents (M1 Pages-Router smoke check, M9 Unit 1 `getFirestore(db)`). Plan samples that touch external SDKs should be compiled-in-head or pasted into a scratch tsconfig before plan sign-off.

### Gotchas for future milestones

- **firebase-admin transitive vulns (gaxios 6.4–6.7.1 → uuid ReDoS) — server-only; accept until firebase-admin ships an upstream-fixed release.** Tracked here, not in code. If `npm audit` becomes a CI hard gate, add an `audit-exclude` config or silence per-advisory.
- **`src/dataconnect-generated/` and `dataconnect/` are Firebase Data Connect boilerplate** (the Movies/Users example schema, NOT threditor's). Not imported anywhere in M9. They're kept only because the user committed them from an external `firebase init dataconnect` run. Do not treat them as authoritative for threditor's Firestore schema (which is in `lib/firebase/types.ts`). Candidate for removal in M10 if they stay unused.
- **DESIGN.md §3 lists `lib/firebase/{auth.ts, firestore.ts, storage.ts}` but M9 only ships `client.ts, admin.ts, types.ts`.** The deferred files land in M10 (auth.ts — session-cookie helpers) and M11 (storage.ts — server-side Supabase upload route). `firestore.ts` may never materialize — typed wrappers will probably live inline with query callsites rather than in a monolithic wrapper module.
- **firestore.rules ships with a design-level gap DESIGN §11.5 inherits:** skins/update locks `likeCount` AND requires owner-auth, which makes the DESIGN §11.4 client-side like transaction impossible (a liker is rarely the skin owner, and the only field changed IS likeCount). Resolution requires either (a) a Cloud Function that owns likeCount updates with the current strict rule kept, or (b) a narrow rule carve-out that permits any signed-in user to adjust likeCount by exactly ±1. Deferred to M10/M11 with the first real like-toggle implementation.
- **firestore.rules skins/create does not validate storageUrl ownership.** An attacker with a signed-in account can create a `/skins/{skinId}` doc whose `storageUrl` points at another user's Supabase object (e.g., copying a popular skin URL) and whose `ownerUid` is their own. The gallery would then render someone else's art under the attacker's profile — content-impersonation, not account takeover. Resolution when the first real skin-publish flow lands: either gate doc creation behind a server route + Admin SDK (preferred — aligns with the already-required service-role Supabase upload path), or add a rules check that the storageUrl contains `request.auth.uid` as a path segment.
- **Supabase RLS policies are markdown-documented, not runtime config.** Dashboard edits leave no git trace. When M11 introduces the first upload flow, commit the policies as SQL (`supabase/migrations/*.sql` + `supabase db push`) so they live alongside the code that depends on them.
- **`firebase.json` emulators run firestore on port 8080 (Firebase default).** Common collision with Tomcat, Jenkins, Java defaults, corporate proxies. M10 should either pin a less-contested port (8088 or 9098) when wiring the emulator suite into CI, or at least pin `emulators.ui.port` + `hub.port` so the Emulator Suite's auto-port selection doesn't become a silent debugging annoyance.
- **Missing-env-var failure mode:** `readFirebaseConfig()` / `readAdminConfig()` / `getSupabase` silently coerce missing vars to empty strings. Each SDK rejects these with its own error message — Firebase Auth throws `auth/invalid-api-key`, Admin SDK throws "Service account object must contain...", Supabase throws "supabaseUrl is required". A single fail-fast validator in each `get*()` that throws `'Missing env vars: X, Y'` before calling `initializeApp` would reduce bootstrap-time debugging. Deferred; flagged in the M9 review residuals.
- **AuthProvider exposes the full Firebase User object** (includes email, phoneNumber, providerData — each provider carries its own UID + email). Wide PII surface. Consider narrowing to `Pick<User, 'uid' | 'displayName' | 'photoURL'>` in M10 with a separate `useFirebaseUser()` hook for callers that legitimately need `email` / `phoneNumber` (e.g., settings page).

### Pinned facts for next milestones

**Exact version deltas from M8:**

- `firebase` `^11.2.0` (new; 14 tree-shakable modules — we import only `app` + `auth` + `firestore`).
- `firebase-admin` `^13.8.0` (new; server-only).
- `@supabase/supabase-js` `^2.45.0` (new).
- `@supabase/auth-helpers-nextjs` `^0.10.0` (new — dev dep; note: deprecated in favor of `@supabase/ssr`; M10 should migrate).
- `@firebase/app-types` `^0.9.2` (new — dev dep).
- `@dataconnect/generated` `file:src/dataconnect-generated` (new — links to the user-committed boilerplate; likely removable in M10).
- `server-only` `^0.0.1` (new — Next.js build-time guard package; aliased to empty shim in vitest).
- `react` / `react-dom` / `next` / `three` / `@react-three/fiber` / `@react-three/drei` / `zustand` / `idb-keyval` — unchanged.

**File paths established:**

- `lib/firebase/client.ts` — browser SDK singleton (`getFirebase()` returns `{app, auth, db}`). `'use client'` directive.
- `lib/firebase/admin.ts` — server-only SDK singleton (`getAdminFirebase()`). Starts with `import 'server-only'`.
- `lib/firebase/types.ts` — Firestore document shapes (`UserProfile`, `SharedSkin`, `Like`). Re-exports `SkinVariant` from `lib/editor/types`.
- `lib/supabase/client.ts` — browser Supabase singleton (`getSupabase()`, `getStorageBucket()`). `'use client'`.
- `app/_providers/AuthProvider.tsx` — `'use client'` React context for Firebase Auth. Wrapped in root `app/layout.tsx`.
- `firestore.rules` — project root. Firebase CLI deploy: `firebase deploy --only firestore:rules`.
- `firebase.json` — emulator config (firestore on 8080) + dataconnect block (inert).
- `docs/supabase-storage-policies.md` — manual-setup guide for RLS (policies live in the Supabase dashboard).
- `docs/plans/m9-scaffolding.md` — milestone plan; `status: active` at commit time, ready to flip to `completed` on PR merge.
- Test artifacts: `lib/firebase/__tests__/{client,admin,types,rules}.test.ts`, `lib/supabase/__tests__/client.test.ts`, `app/_providers/__tests__/AuthProvider.test.tsx`. vitest.config.ts updated to include `lib/**/__tests__/` + `app/**/__tests__/`.

**Conventions established:**

- SDK-access modules that enforce a client/server boundary live in `lib/` and carry `'use client'` or `import 'server-only'` as appropriate.
- Env vars are read inside the getter, not at module load, so test-env overrides + runtime config changes propagate without module-reset.
- Singleton getters follow `get<Subject>()` naming; test-only reset helpers are `__reset<Subject>ForTest`.
- Non-publicly-exported library types should be derived via `ReturnType<...>` / `Parameters<...>` / `Awaited<...>` rather than cast-imported.
- Doc-ID conventions that encode uniqueness MUST be enforced in the rules layer, not just in client code.
- Delete rules check `resource.data` (existing doc); create rules check `request.resource.data` (incoming). Don't combine `create, delete` if the delete reads the doc being deleted.

**Bundle baseline update:**

- `/editor`: 375 kB First Load JS (unchanged vs M8 — Firebase SDK modules code-split into async route chunks, not in the critical path).
- `/` (landing): 3.45 kB / 106 kB (unchanged).
- Full client + admin + supabase chunks on disk: ~800 KB gzipped (Firebase alone contributes ~350 KB across auth + firestore + app + dependencies). These lazy-load when AuthProvider's effect fires on first mount.

**Test baseline:**

- 549 → **579** tests (+30). Per-unit additions approximated: Unit 1 +3 (client), Unit 2 +4 → +6 (admin — 4 initial + idempotency + missing-env in review round), Unit 3 +4 → +5 (supabase + review-added missing-env), Unit 4 +4 (types), Unit 5 +6 (rules shape), Unit 7 +5 (AuthProvider), review-added Unit 1 missing-env +1.

**Audit baseline:**

- **10 vulnerabilities (8 moderate, 2 low)** — all in firebase-admin transitive tree (gaxios 6.4-6.7.1, google-auth-library, uuid). Server-only scope. Flagged above; revisit when firebase-admin ships a fixed release.
- Production (client-bundle) vulnerabilities: **0**.

### Recommended reading for M10

- This file's M9 §Invariants — the delete-vs-create rules distinction and the doc-ID-as-rules-enforcement pattern apply immediately to the first real `/likes` and `/skins` write paths.
- This file's M9 §Gotchas — the skins.update-vs-likeCount transaction conflict is a design-level blocker; M10 must decide between Cloud Function and rules-rewrite paths before wiring the like-toggle.
- `docs/supabase-storage-policies.md` — contains the Firebase-Auth-vs-Supabase-Auth divergence note that shapes how M11's upload flow must work (server route + service-role key, not direct browser upload).
- `app/_providers/AuthProvider.tsx` — M10's session-cookie route (`app/api/auth/session/route.ts`) must call Admin SDK's `verifySessionCookie` (already exposed via `getAdminFirebase().auth.verifySessionCookie`) and set an httpOnly cookie. The client reads auth state only via the AuthProvider; the cookie is for server-side SSR.
- `.context/compound-engineering/ce-review/m9-scaffolding-01/run-artifact.md` — residual M9-review findings that need M10/M11 follow-through.

## M10: Auth Flow — 2026-04-23

### What worked

- **Session-cookie pattern as the server-side auth surface.** Client signs in via Firebase SDK (popup / email+password); server verifies the resulting ID token and mints a 5-day httpOnly cookie via `auth.createSessionCookie`. Dual-state: client Firebase `onAuthStateChanged` drives the in-page UI; the cookie drives SSR + server-only writes (M11 upload, M12 like-toggle). `verifySessionCookie(cookie, true)` with `checkRevoked=true` ensures that signing out on another device invalidates this cookie server-side — no stale session survives a `revokeRefreshTokens`.
- **Handler-inline dynamic imports of `firebase/auth` methods.** AuthDialog's `signInWithPopup`, `signInWithEmailAndPassword`, `createUserWithEmailAndPassword`, `GoogleAuthProvider` and UserMenu's `signOut` are `await import('firebase/auth')` inside their handler bodies rather than top-level imports. This is the right discipline even when the bundler doesn't split further today — `onAuthStateChanged` in AuthProvider already pulls firebase/auth into the /editor chunk, so the static-import version had the same bundle shape. Future tree-shaking improvements or chunk-analyzer runs will benefit automatically.
- **Separate `cookieStoreMock.get` + `mockAuth` hoisted mocks in route tests.** `vi.hoisted(() => ({...}))` lets the `vi.mock` factory reach the mock state before the source module loads. Cleaner than `vi.doMock` + dynamic imports, cleaner than module-mutation after the fact.
- **`server-only` import on route handlers + `lib/firebase/auth.ts`.** Reuses the M9 compile-time guard pattern — if any client-bundle path accidentally drags in a route or the server-session helper, the Next build fails loud instead of silently shipping admin-SDK code to the browser.
- **AuthDialog + UserMenu patterns reuse M7/M8 conventions.** Hand-rolled `role="dialog"` + backdrop click + X button (same shape as `TemplateBottomSheet` and `ExportDialog`); click-outside listener installed only while dropdown is open (same shape as the mirror-toggle and existing UI). Zero new dependencies.
- **Two-step sign-out (POST /api/auth/signout → firebase `signOut`).** If the server POST rejects, the client signOut still runs so the UI updates. Server revokes refresh tokens so other devices' sessions are also invalidated.
- **Graceful degradation on AuthProvider init failure.** The `try/catch` added in M9 review still applies — a missing Firebase project env var makes the editor render as signed-out instead of hanging the loading skeleton forever.
- **`fillCredentials` helper in AuthDialog tests.** React 19 + jsdom don't trigger form `onSubmit` when the form has `required` inputs with empty values. The helper uses the native `HTMLInputElement.prototype.value` setter + `input` event to populate fields in a way React's synthetic onChange sees. Reusable pattern for any test exercising a required-field form.

### What didn't

- **Bundle budget miss.** The plan targeted +15 kB (380 kB cap). Reality: `/editor` First Load JS went from M9's 375 kB to **478 kB (+103 kB)**. The `firebase/auth` modular SDK's popup + credential-signin + signOut + ID-token paths together add ~100 kB gzipped, and Next 15's default chunking treats `firebase/auth` as a unit — dynamic-importing at the AuthDialog/UserMenu level (both via `next/dynamic` component wrapping and `await import()` inside handlers) did not split further because `onAuthStateChanged` in the AuthProvider (root layout) already pulls firebase/auth onto the shared chunk. Not a correctness issue; a budget reality-check. Landing page stays at 106 kB — unchanged — so the cost is scoped to /editor.
- **`next/dynamic` component wrapping defeats `vi.mock` on the wrapped modules.** A test that mocks `./UserMenu` won't see the mock through a `dynamic(() => import('./UserMenu'))` wrapper because vitest's module-level mocks apply to the import specifier, but `next/dynamic` intercepts via a runtime wrapper. Workaround: mock `next/dynamic` itself, OR skip the component wrapper and use handler-inline `await import()` (which we ultimately did for a different reason — bundle size). Pin: for components with heavy children, inline-dynamic-import inside handlers beats component-level `next/dynamic`.
- **Plan's `vi.mock` + `global.fetch = vi.fn()` pattern had gaps.** React 19's async `onSubmit` handler requires an explicit `await` on the promise chain after the click, not just `await waitFor`. Without an `await new Promise(r => setTimeout(r, 0))` after clicking Submit, the mock fetch hasn't been called yet. Pattern: after any user-event that triggers async state, yield control with a microtask or macrotask before asserting.

### Invariants discovered

- **Session cookies have three load-bearing flags.** `httpOnly` (JS cannot read → XSS mitigation), `secure` in production (HTTPS-only transport), `sameSite: 'lax'` (CSRF mitigation while permitting top-level nav). Missing any one degrades a security property. The tests assert `HttpOnly` and `SameSite=Lax` on the `Set-Cookie` header. M11 + M12 must never weaken these on new cookies.
- **Delete uses `resource.data`, create uses `request.resource.data`** — the M9 rules invariant extends into session-cookie handling too. `verifySessionCookie(cookie, checkRevoked=true)` consults the cookie's `authTime` claim against `revokeRefreshTokens`'s server timestamp. Omit `checkRevoked` and a signed-out session survives. This is why `getServerSession` passes `true` — loud about it, so M11 doesn't copy a laxer pattern.
- **`signOut` is a two-step.** Server revokes refresh tokens (via `/api/auth/signout` POST); client calls `firebase/auth`'s `signOut(auth)` to clear the in-memory User. Both must run. If the server POST fails (network, 500), still run the client `signOut` so UI updates — the stale server session will expire via TTL. Document at the call site; future M13 "sign out all sessions" will build on this.
- **Firebase Auth's modular SDK is bundled as a unit under Next 15's webpack.** `firebase/auth`'s many exports (onAuthStateChanged, signInWithPopup, signOut, etc.) share enough internal code that webpack's default chunking doesn't split them into separate chunks even when static analysis suggests it could. Any site that imports ANY `firebase/auth` function from a component reachable at first load pays the full ~100 kB cost. Design consequence: all auth-heavy pages share the same First Load JS baseline; there's no way to isolate per-page auth features via dynamic() today.
- **React 19 + jsdom: `input.value = 'x'` + dispatch `change` does NOT trigger React onChange.** Use the native HTMLInputElement value-property setter descriptor: `Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(inputEl, val)` then dispatch `new Event('input', { bubbles: true })`. React's synthetic onChange listens to the native `input` event and only fires when value-set goes through the real setter (not through a plain JS assignment that would shadow React's tracked value).
- **`required` inputs block form submit when empty.** A jsdom test that clicks a submit button on a form with empty `required` fields silently does nothing — the form validation rejects before the handler runs. Fill the fields first OR remove `required` from the test DOM.

### Gotchas for future milestones

- **M11 (skin upload) bundle baseline is 478 kB now, not 375 kB.** Plan M11 with this number in mind. The upload flow adds Supabase client + Firestore write paths; those are already in /editor from M9. M11's real cost is whatever the upload route itself costs. Keep server-side (`supabase/supabase-js` service-role client) off the critical path.
- **Session cookie TTL is 5 days; Firebase ID token TTL is 1 hour.** The client's in-memory Firebase token refreshes every hour via `onIdTokenChanged` automatically. The httpOnly session cookie does NOT refresh — after 5 days, the user must sign in again. Document this on the M13 settings page or in a toast if a user's 5-day session is about to expire. Not urgent — 5 days is the Firebase default and matches user expectations for web apps.
- **`signOut` on one device does NOT immediately invalidate sessions on another device** — only the local one. The `revokeRefreshTokens` call in `/api/auth/signout` ensures other devices can't REFRESH their token (so they get signed out within the hour as their ID token expires). Full cross-device logout within seconds would require push notifications; deferred to post-M14.
- **Don't `useAuth()` in a server component.** `useAuth()` throws if called outside AuthProvider, AND AuthProvider is a `'use client'` component. Server components must use `getServerSession()` from `lib/firebase/auth.ts` instead. The two APIs are deliberately different to enforce the boundary: useAuth returns a live User with methods; getServerSession returns a serializable `{uid, email, emailVerified}`.
- **AuthProvider exposes the full Firebase User object.** Documented in AuthProvider.tsx (M10 Unit 6) and M9 COMPOUND §Gotchas. Every M10–M12 consumer legitimately reads from the full set (uid, email, displayName, photoURL). Revisit in M13 when a settings page provides a concrete "this component shouldn't have email in context" use case.
- **The API routes run in the Node.js runtime (default), not Edge.** `firebase-admin` is a Node-only SDK (uses `crypto.KeyObject`, not WebCrypto). Do NOT add `export const runtime = 'edge'` to any route that imports `@/lib/firebase/admin` — it will fail to build.
- **`request.json()` is not idempotent.** The session route calls it once; signout calls it zero times (reads cookies only). If a future M11 route needs to parse the body AND fall through to a retry path, read it into a variable first.

### Pinned facts for next milestones

**Exact version deltas from M9:**

- `@testing-library/user-event` `^14.5.0` (new — dev dep).
- firebase / firebase-admin / @supabase/supabase-js unchanged.

**File paths established:**

- `app/api/auth/session/route.ts` + `app/api/auth/signout/route.ts` — Node-runtime API routes. `server-only` imported.
- `lib/firebase/auth.ts` — `getServerSession()` + `requireServerSession()`. `server-only` imported.
- `app/_components/AuthDialog.tsx` — hand-rolled ARIA dialog; Google + Email/Password.
- `app/_components/UserMenu.tsx` — avatar + dropdown + two-step sign out.
- `app/_components/EditorHeader.tsx` — fixed top bar, 56px (h-14). Mounts AuthDialog + UserMenu.
- `app/editor/page.tsx` — now renders `<EditorHeader />` above `<EditorLayout />`.
- `app/editor/_components/EditorLayout.tsx` — root `h-dvh` → `h-[calc(100dvh-3.5rem)]` to accommodate header.
- `app/_providers/AuthProvider.tsx` — PII decision comment added (Unit 6).
- Test artifacts: `app/api/auth/__tests__/session.test.ts`, `lib/firebase/__tests__/auth.test.ts`, `app/_components/__tests__/{AuthDialog,UserMenu,EditorHeader}.test.tsx`.

**Conventions established:**

- Heavy `firebase/auth` methods (popup, credential-signin, signOut) are `await import('firebase/auth')` inside handler functions, not top-level imports.
- API routes (and any module that reads `FIREBASE_ADMIN_*`) start with `import 'server-only'`.
- `vi.hoisted` + `vi.mock` with factory is the canonical pattern for mocking `next/headers` + `@/lib/firebase/admin` in route tests.
- AuthDialog / UserMenu / ExportDialog all use the same hand-rolled ARIA dialog pattern — no `@radix-ui` dependency.
- Session cookie: `httpOnly=true`, `secure` in production, `sameSite='lax'`, `path='/'`, 5-day TTL.

**Bundle baseline update:**

- `/editor`: 375 → **478 kB** First Load JS (+103 kB). Plan budget was +15 kB — missed. The delta is the full `firebase/auth` module (popup + credential + signOut + ID token paths) which Next 15's webpack can't split below that granularity today.
- `/` (landing): **106 kB** unchanged.
- `/api/auth/session` + `/api/auth/signout`: 102 kB each (baseline framework only).

**Test baseline:**

- 579 → **626** tests (+47). Per-unit additions: Unit 1 +12, Unit 2 +9, Unit 3 +12, Unit 4 +9, Unit 5 +5.

**Audit baseline:**

- Production: 0 vulnerabilities (unchanged).
- firebase-admin transitive vulns (M9-accepted): unchanged — 10 moderate/low, server-only scope.

### Recommended reading for M11

- This file's M10 §Invariants — delete-vs-create, session-cookie flags, two-step sign-out, "don't useAuth in server components" all apply directly to the skin-upload + publish flow.
- `lib/firebase/auth.ts::getServerSession` — M11's upload route reads the uid from this helper; no parsing cookies manually.
- `docs/supabase-storage-policies.md` — M11's upload MUST use the service-role key because the Supabase RLS doesn't see Firebase Auth.
- `app/api/auth/session/route.ts` — pattern for M11's `/api/skins` POST (same Node runtime, same `server-only` + `validateEnv` shape).
- M10 COMPOUND §Gotchas 1 (bundle baseline is 478 kB now) — plan M11 with that in mind.
