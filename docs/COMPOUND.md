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
