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
