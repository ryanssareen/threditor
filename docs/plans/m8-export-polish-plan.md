---
title: "M8: Export + Onboarding Polish"
type: feat
status: completed
date: 2026-04-22
---

# M8: Export + Onboarding Polish — Plan

> **Milestone posture:** final Phase 1 milestone. After this merges, the MVP is shippable. Target scope is export, the 0 ms-edit guardrail, a first-paint hook that feels alive within 2 s, a Lighthouse-friendly landing page, and the luminance toggle for value-contrast checking.

## Overview

M8 closes Phase 1 along four axes:

1. **PNG export pipeline** — composite all layers to a 64×64 RGBA canvas, encode with `canvas.toBlob('image/png')`, download as `skin-<timestamp>.png`. A dialog confirms the active variant and carries the 0 ms-edit soft-friction guardrail wired to M7's `hasEditedSinceTemplate` + `lastAppliedTemplateId` flags.
2. **First-paint onboarding hook** — co-opt the M7 `TIMING` vocabulary (cursor glow, hint, pulse) and apply it to the cold editor-land path (no template selected yet) so the first second after landing feels intentional. Goal: "paint within 2 s, see result on 3D model, feel competent immediately."
3. **Landing page polish (`/`)** — evolve the existing static hero to a Lighthouse ≥95 marketing page with hero, feature strip, CTA to `/editor`, and footer. No 3D on `/`.
4. **Luminance toggle** — hotkey `L`, new `luminanceEnabled` store slot, grayscale uniform on `meshStandardMaterial.onBeforeCompile` plus CSS `filter: grayscale(100%)` on `<ViewportUV>`. Color picker, palette, and active swatch stay in full color. Floating "👁 Luminance Mode" pill slides down from top-center over 500 ms.

## Problem Frame

Phase 1's MVP is built but un-shippable: a user can paint beautifully and cannot save the result. Export is the single biggest blocker. Onboarding polish closes the "what do I do first?" gap that the M7 Ghost Picker half-addressed. Luminance mode is accessibility work DESIGN §10 has promised since day 1. The landing page's current state (one h1 + one link) reads like a placeholder; it should look like a product.

## Requirements Trace

Mapped to DESIGN §12.5 M8 "Review" criteria and the brief's constraints.

- **R1 (P1, DESIGN §12.5 M8 #1).** Exported PNG opens correctly in any Minecraft skin viewer and loads in the game.
- **R2 (P1, DESIGN §12.5 M8 #2).** Export respects Classic vs Slim variants — the dialog defaults to the active variant, and a mismatch warning surfaces when the user overrides.
- **R3 (P1, DESIGN §5.4 2000ms+ row).** Attempting export with `hasEditedSinceTemplate===false && lastAppliedTemplateId!==null` opens a soft-friction dialog ("Edit first / Export anyway"). Any stroke clears the guardrail; "Export anyway" lets the export proceed.
- **R4 (P2, DESIGN §12.5 M8 #3).** First-paint sequence lands within ±100 ms of the DESIGN §5.4 timeline (cursor glow + model micro-motion + affordance pulse).
- **R5 (P2, DESIGN §12.5 M8 #4).** Luminance mode desaturates **both** viewports (2D UV + 3D) while leaving the color picker, palette, active swatch, **and the layer-panel color swatches** in full color.
- **R6 (P3, DESIGN §12.5 M8 #5).** Landing page Lighthouse performance ≥95 (mobile + desktop).
- **R7 (brief + DESIGN §12.5 post-M8).** Zero new dependencies unless justified. Bundle delta ≤ **+10 kB** First Load JS on `/editor` vs the M7 post-merge baseline (373 kB, confirmed in branch `m7-templates` build output).
- **R8 (DESIGN §12.5 M8 Compound).** `docs/COMPOUND.md` captures the M7 and M8 entries before PR merge (M7's entry was not written before merge — close that debt in M8's Unit 10).

## Scope Boundaries

- **No** Firebase integration — Phase 2.
- **No** multi-file export (single PNG per download action). Batch export is a post-MVP idea.
- **No** gallery of past exports. The browser download list is the user's archive.
- **No** editable exported-file metadata (author, license, etc.). Filename-timestamp is the only metadata.
- **No** TSL / NodeMaterial rewrite of PlayerModel — that would far exceed the +10 kB budget and the hours target. Stay on `onBeforeCompile`.
- **No** File System Access API hard dependency. It ships as a progressive enhancement behind `'showSaveFilePicker' in window`.
- Landing page stays **static server component** — no 3D canvas, no client-side interactivity beyond `next/link`. A pre-rendered still of a model is acceptable via `next/image`, but not required for M8.
- Luminance toggle is a **display-only** filter. No pixel data is rewritten; toggling off restores full color instantly.
- No redesign of the existing first-paint *infrastructure* — the M7 TIMING constants, `ContextualHintOverlay`, and `AffordancePulse` all stay. M8 adds a **cold-land trigger** that fires them in a sequence the editor doesn't currently play.

## Context & Research

### Relevant Code and Patterns

- `lib/editor/texture.ts` — `TextureManager.composite(layers)` is the canonical multi-layer compositor. **Reuse**: build export's output atlas by calling `composite()` onto a temporary canvas (or borrowing the TM's offscreen canvas) rather than duplicating the blend-mode-aware pipeline. The scratch-canvas/putImageData-then-drawImage chain is locked in (M6 invariant).
- `lib/editor/store.ts` — M7 added `hasEditedSinceTemplate`, `lastAppliedTemplateId`, `activeContextualHint`, `pulseTarget`. M8 adds `luminanceEnabled: boolean` + `setLuminanceEnabled` (idempotent) in the same narrow-selector style.
- `lib/editor/templates.ts` — the `TIMING` const (CHIP_DELAY_MS / HINT_DELAY_MS / PULSE_DELAY_MS / CROSSFADE_MS) is already the "onboarding timeline" vocabulary. First-paint reuses these.
- `app/editor/_components/ContextualHintOverlay.tsx` + `AffordancePulse.tsx` — read the M7 store slots and render the visuals. First-paint hook writes to the same slots from a new `FirstPaintCoordinator` (EditorLayout-owned).
- `app/editor/_components/TemplateBottomSheet.tsx` — the hand-rolled ARIA dialog with focus trap is the template for `ExportDialog`. Same focus-trap, same Escape-to-close, same backdrop click semantics. Do not introduce `@radix-ui/react-dialog` — it would balloon the bundle and M7 deliberately avoided it.
- `app/editor/_components/EditorLayout.tsx` — owns the window-level keydown listener for Cmd/Ctrl+Z and owns the `undoStack` ref. M8's `L` hotkey wires into the same listener. M8's first-paint coordinator lives here too.
- `lib/three/PlayerModel.tsx` — `useFrame` zero-alloc invariant and the existing Y-rotation pulse are the attachment seam for luminance shader injection. All materials (12 meshes × 1 material each) share the same `<meshStandardMaterial>` JSX but each gets its own instance. The `onBeforeCompile` patch must therefore come from a shared factory AND each material must set `customProgramCacheKey` tied to a module-scoped toggle, not a closure-captured boolean (see Unit 5).
- `lib/editor/tools/dispatch.ts` — dispatcher chokepoint. `markEdited()` already fires through the `onStrokeCommit` handler (M7 Unit 8) and flips `hasEditedSinceTemplate` to `true` on first stroke after a template apply. The guardrail reads the same flag.
- `lib/editor/undo.ts` — `UndoStack.subscribe()` landed in the white-skin/undo-button follow-up. **Reuse**: the ExportDialog's "Reset edits" affordance, if added, routes through the existing adapter — but that's out of scope for M8.
- `public/templates/manifest.json` — M7 loads via `cache: 'force-cache'`. Landing page can (optionally) surface the template thumbnail count as a feature callout without re-introducing fetch — prefer a hard-coded "10 templates" in copy to avoid a client fetch on `/`.
- `app/globals.css` — `@theme` tokens and the `template-affordance-pulse` keyframes are already here. Add `luminance-pill-slide-in` and (if needed) a `cursor-glow-pulse` keyframe in the same file.

### Institutional Learnings

- **M6 Invariant — `putImageData` bypasses all 2D-context compositing state.** Export must use the scratch-canvas path, not direct `putImageData` onto the output canvas. Already embodied in `TextureManager.composite`; export will reuse it.
- **M6 Invariant — Session-scoped non-serializable instances live in `useRef`, not zustand.** Export's in-flight blob and download handle stay in local state. `luminanceEnabled` is boolean and serializable — it goes in the store.
- **M6 Invariant — DOM touches in React hooks must use `useEffect`, not `useMemo`.** Export's `document.createElement('a')` goes inside an event handler, not render.
- **M6 Invariant — Dispatcher chokepoint captures orthogonal concerns at O(1) per concern.** The guardrail does NOT attach at dispatch; it attaches at the export trigger. Per DESIGN §5.4 the guardrail is "did the user edit since the last template apply?", a single boolean read, not a stream event.
- **M7 Learning — `cancelActiveTransition()` pattern.** If the user triggers export mid-transition, cancel any in-flight hint/pulse timers before opening the dialog so the dialog isn't fighting a pulse. Same for luminance toggle while paint is active (see Gotchas).
- **M2 Invariant — `useFrame` zero-alloc.** The luminance shader patch is applied once at material creation; uniform value mutation via `ref.current` in a subscription. Do NOT read the store inside `useFrame`.
- **M1/M2 Invariant — Pattern repository in `/lib/editor`; UI in `/app/editor/_components`.** New `export.ts` + `grayscale-shader.ts` go in `lib/editor`. New `ExportDialog.tsx` + `LuminanceToggle.tsx` (the pill) go in `app/editor/_components`. Landing-page work in `app/page.tsx`.

### External References

All findings from the Phase 1 research dispatch. Inline citations per claim.

- **[three.js Migration Guide](https://github.com/mrdoob/three.js/wiki/Migration-Guide) + [r184 release notes](https://github.com/mrdoob/three.js/releases/tag/r184):** `#include <output_fragment>` was renamed to `#include <opaque_fragment>` in r152/r154. **DESIGN.md §10's snippet uses the old token and would silently no-op on three 0.184.** Plan Unit 0 amends DESIGN §10 before Unit 5 writes code.
- **three.js docs `Material.customProgramCacheKey`** + context7 `webgl_materials_modified.html` example: when a shader-injection flag varies between material instances, `customProgramCacheKey` must return a string reflecting the flag, otherwise WebGLRenderer reuses the first-compiled program for every later instance. Practical impact: the 12 PlayerModel meshes share one material factory; if a future feature adds a per-mesh luminance override, we'd need the cache key. For M8's single-global-flag case, using a **shared `uniforms.uGrayscale` object** (one value object referenced by every material) sidesteps cache-key concerns — mutating `.value` alone doesn't require recompile.
- **[MDN `HTMLCanvasElement.toBlob`](https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/toBlob):** the `quality` argument is honored only for `image/jpeg` and `image/webp`. For `image/png` it is ignored. **Do not pass it.** Call signature: `canvas.toBlob(callback, 'image/png')`.
- **Mojang `NativeImage.java` behavior:** Minecraft's skin loader expects 8-bit RGBA, non-indexed, non-premultiplied. All major browsers' `toBlob('image/png')` produce this. **Gotcha**: transparent overlay atlas regions must be encoded as RGB=0, A=0, not RGB=anything-else + A=0. Some MC shaders sample RGB when A=0 and produce color fringing. The `composite()` path starts with `clearRect` to `(0,0,0,0)`, so this is covered — but the plan calls it out for verification.
- **[MDN `showSaveFilePicker`](https://developer.mozilla.org/en-US/docs/Web/API/Window/showSaveFilePicker) + [caniuse](https://caniuse.com/native-filesystem-api):** limited availability / Chromium-only in 2026. Treat as progressive enhancement inside `if ('showSaveFilePicker' in window)` with anchor-click fallback.
- **[WebKit Bugzilla #218227 (wontfix)]:** Safari download via `<a download>` must be invoked inside the user-gesture call stack. The `toBlob` **callback** form preserves the gesture through the callback because `toBlob` is a canvas method invoked from the handler. Do not `await` `toBlob` via a promise wrapper — Safari blocks the download.
- **[Next.js Prefetching guide](https://nextjs.org/docs/app/guides/prefetching) + [Link docs](https://nextjs.org/docs/app/api-reference/components/link):** the `/editor` route is client-heavy (the Canvas pulls ~150 KB gzipped into the critical path of whoever touches it). Default `next/link` prefetch on the CTA **will** tank landing-page TBT/INP. Set `prefetch={false}` on the hero CTA and let hover-prefetch cover perceived nav speed.
- **[MDN `OffscreenCanvas.convertToBlob`](https://developer.mozilla.org/en-US/docs/Web/API/OffscreenCanvas/convertToBlob):** returns a Promise. Useful in workers. On main thread `canvas.toBlob` is fine — no measurable win from OffscreenCanvas for a one-shot 64×64 encode. **Do not** migrate the export path to OffscreenCanvas — the export canvas is one-off, not a perf hot path.
- **[Next.js Fonts docs](https://nextjs.org/docs/app/getting-started/fonts):** `next/font/google` self-hosts at build time. Geist + JetBrains Mono are already declared in `app/layout.tsx` (M2 COMPOUND). No changes needed for the landing page; the fonts flow through automatically.

## Key Technical Decisions

- **D1. Export composites into a throwaway `HTMLCanvasElement`, not the TM's live canvas.** The TM canvas is the texture source for the 3D render loop — blitting through it during export risks a flash of uncomposited state. Decision: allocate a fresh `<canvas width=64 height=64>` inside `lib/editor/export.ts`, instantiate a bare compositor helper (or reuse `TextureManager.composite` by extracting its blend-mode mapping into a pure function), encode, dispose. Cost: ~4 KB of transient memory per export; insignificant.
- **D2. `canvas.toBlob(cb, 'image/png')` — no quality arg.** MDN confirms quality is ignored for PNG. Keep the signature minimal. Callback form (not promise wrapper) to preserve Safari user-gesture for the anchor-click download.
- **D3. Filename format: `skin-<ISO-timestamp-with-colons-replaced>.png`.** E.g. `skin-2026-04-22T12-30-45.png`. Colons break Windows filesystems. Include variant suffix for clarity: `skin-classic-2026-04-22T12-30-45.png`. Decision: **prepend variant**; users who export both variants back-to-back benefit from the sortability.
- **D4. Guardrail boolean: `hasEditedSinceTemplate === false && lastAppliedTemplateId !== null`.** Exact expression mirrors the brief and DESIGN §5.4. Any fresh-session user who never applied a template has `lastAppliedTemplateId === null` and bypasses the guardrail (correct — nothing to protect against). A user who applied a template and committed zero strokes sees the soft-friction dialog ("Edit first / Export anyway"). Any stroke (via the existing `markEdited()`) clears the guardrail permanently for that template.
- **D5. ExportDialog owns its own focus trap — no new dependency.** Copy the pattern from `TemplateBottomSheet.tsx`: `role="dialog"`, `aria-modal="true"`, focus-trap on mount, Escape to close, click backdrop to close. Total ~80 LOC, zero bundle cost.
- **D6. Luminance shader uses a single module-scoped uniform object shared across all 12 materials.** Per three.js docs, mutating `.value` on a shared uniform propagates to every material using it without recompile. Tradeoff: all materials are always "in luminance mode potentially" — but the boolean uniform at `false` is a trivial GPU cost (one `if` branch per fragment). Avoids `customProgramCacheKey` management. If a future feature adds a per-part luminance override, revisit.
- **D7. Luminance 2D-viewport filter is pure CSS: `filter: grayscale(100%)` on the `<ViewportUV>` container.** No pixel-data mutation; toggle off restores instantly. The `.container` wrapping also scopes the filter so the hover overlay + brush cursor desaturate WITH the canvas, which is the correct visual.
- **D8. Luminance indicator is a `role="status" aria-live="polite"` pill, top-center, 500 ms `slide-down` keyframe.** No ARIA alert (too aggressive for a mode change). Accessibility + screen readers announce "Luminance Mode on/off."
- **D9. First-paint sequence owner: `EditorLayout` via a new `useFirstPaint()` hook.** EditorLayout already owns the `hydrationPending` gate, the `markDirty` ref, and the window-keydown listener. Adding the first-paint coordinator here avoids a second bus for the same lifecycle. The hook returns a cleanup that cancels any in-flight timers on unmount.
- **D10. First-paint triggers only when `hydrationPending` transitions from `true → false` AND `lastAppliedTemplateId === null`.** A returning user with a saved template does not need the hook; they know the app. A returning user with a saved document but no template gets the hook (good — it's still the first paint of this session). A first-time user lands, sees the placeholder, and the hook plays.
- **D11. Cursor glow is a CSS-only effect driven by a `data-first-paint="true"` attribute on `<EditorLayout>`'s root.** When the attribute is present, a subtle pulsing box-shadow is applied to the tool buttons in sequence. At `+600 ms` the attribute flips off. Implementation parallels the existing `[data-pulse="true"]` rule in `globals.css`.
- **D12. Idle-model micro-motion already exists in `PlayerModel.useFrame` as the breathing animation.** The first-paint hook does NOT reinitialize this. The only motion we *add* is a short `+Y-rotation` wiggle at `+1600 ms` if `strokeActive === false` — this reuses the M7 `pulseStartMsRef` path in `PlayerModel` (controlled via a new `firstPaintKey` prop that parallels `yRotationPulseKey`).
- **D13. Landing page stays server-component-only.** No `'use client'`, no 3D, no JS beyond `next/link` internals. `prefetch={false}` on the CTA to `/editor` protects LCP.
- **D14. Landing page feature list is plain text, not icons.** Icon fonts or SVG icon libraries would regress Lighthouse. Typography carries the tone.
- **D15. Document amendment (Unit 0):** update DESIGN §10's code snippet to use `#include <opaque_fragment>` and note the three r154 rename. Add a sentence on `customProgramCacheKey` consideration. Add a sentence on the guardrail boolean for clarity.

## Open Questions

### Resolved During Planning

- **Is `showSaveFilePicker` a hard requirement?** No. Research shows Chromium-only in 2026; Firefox + Safari don't ship it. Plan treats it as progressive enhancement. If `'showSaveFilePicker' in window`, we prefer it (better UX); else anchor-click fallback.
- **Should luminance apply to the Layer Panel's color swatches?** DESIGN §10 says "color picker, palette panel, and active swatch remain in full color." Decision: layer-panel swatches are part of the user's color-semantic surface — include them in the "full color" preserved set. Implementation: apply the CSS filter only to the `<ViewportUV>` container, not the whole editor page. The Sidebar stays in color by default because it's outside the filtered container.
- **Should the export dialog show a live preview?** No for M8. The 3D viewport IS the preview. Showing a 2D thumbnail in the dialog adds LOC + layout complexity for near-zero value. If users report confusion, M9 can add it.
- **What's the guardrail wording?** Per brief: primary CTA "Edit first", secondary "Export anyway". Primary should return focus to the canvas (no-op — it just closes the dialog). Secondary proceeds with export. Add a muted explanatory line: "You applied a template but haven't made any edits yet."
- **Should the first-paint hook fire on EVERY page load or only the first?** DESIGN §5.4 is about the template-to-edit transition; §12.5 M8's first-paint is specifically the cold-editor-land. Resolution: fire only when `hydrationPending` transitions `true → false` AND `lastAppliedTemplateId === null`. Returning users with a template in IDB have seen the hook once and don't need it again; users who dismissed the Ghost Picker already signaled they know where they are.
- **Does the luminance toggle persist across reloads?** Not in M8. `luminanceEnabled` is an in-memory store slot only. Persisting it would require a schema bump on `SkinDocument` that isn't worth a P2 feature. If the community requests it, M9.
- **Where does the luminance pill render?** Top-center of the 3D viewport pane (not the whole page). Matches the `ContextualHintOverlay` positioning convention.

### Deferred to Implementation

- **Exact ExportDialog layout.** The structure is known (heading / variant selector / filename preview / guardrail line conditional / primary+secondary buttons). Pixel-level dimensions are a /ce:work concern.
- **Exact `customProgramCacheKey` treatment.** D6 punts this by using a shared uniform. If that proves too coarse at code-write time, fall back to per-material cache keys. Verify in `npm run dev` that toggling `L` changes all 12 meshes.
- **Does the first-paint hook need any telemetry?** No client analytics in M8 scope. If added later, the dispatcher chokepoint pattern is the attachment point.
- **Landing-page hero still image vs. pure typography.** Start with typography-only. If the page reads thin, M8.5 adds a single `next/image` with `priority` of a pre-rendered 3D model still, budgeted at ≤20 KB after compression.
- **PNG "mcmeta" sidecar (animated capes, etc.).** Out of scope. Skins don't need it; capes do and capes aren't Phase 1.

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

### Export pipeline (data flow)

```text
User clicks "Export" button (Toolbar)
        │
        ▼
ExportDialog opens (guardrail-aware)
        │
        ├── guardrail check:
        │     hasEditedSinceTemplate === false
        │     && lastAppliedTemplateId !== null
        │     ──► show soft-friction dialog ("Edit first" / "Export anyway")
        │
        ▼  (user confirms variant, clicks Export)
exportSkin({ layers, variant, timestamp }):
        │
        ├── create new HTMLCanvasElement (64×64)
        ├── composite(layers) via shared blend-mode pipeline
        ├── canvas.toBlob(cb, 'image/png')   // no quality arg
        │
        └── cb(blob):
              ├── if 'showSaveFilePicker' in window: native picker
              └── else: URL.createObjectURL + <a download> click + revoke
```

### Luminance toggle wiring

```text
User hits L or clicks chevron button
        │
        ▼
store.setLuminanceEnabled(next)
        │
        ├──► ViewportUV: container data-luminance → CSS filter
        │
        ├──► grayscale-shader.ts: uGrayscale.value = next
        │        (shared uniform object — all 12 material instances
        │         read the same ref, no recompile needed)
        │
        └──► LuminanceToggle pill: slide-down 500ms if !prev && next,
                                   slide-up 500ms if prev && !next
```

### First-paint hook sequence

```text
t=0     hydrationPending true → false && lastAppliedTemplateId===null
        │
        ▼
t=0     set data-first-paint="true" on EditorLayout root
        │
        ├─ CSS cursor-glow keyframe begins on tool buttons
        │
t=600   clear data-first-paint (glow fades naturally)
        │
t=700   setActiveContextualHint("Try painting")  (M7 infra, auto-clears at 3700)
        │
t=1000  setPulseTarget("brush")                  (M7 infra, auto-clears at 1600)
        │
t=1600  if !strokeActive && !anyEditMade: firstPaintPulseKey++
        │        (PlayerModel reads this like M7's yRotationPulseKey)
        │
End of sequence. If a stroke fires at any point, cancel remaining timers
(parallel to M7's cancelActiveTransition).
```

## Implementation Units

> Units are sized for single-commit PRs. Unit 0 (doc amendment) precedes any code. Units 1–3 deliver export; 4–6 deliver luminance; 7–8 deliver first-paint; 9 delivers the landing page; 10 closes the milestone.

- [ ] **Unit 0: DESIGN.md amendments + COMPOUND.md M7 entry backfill**

**Goal:** fix the three.js shader token in §10, clarify the guardrail boolean in §5.4, and write the overdue M7 compound entry.

**Requirements:** R8 (COMPOUND debt), R5 (correct shader token prevents silent no-op).

**Dependencies:** none.

**Files:**
- Modify: `docs/DESIGN.md` (§10 shader snippet, §5.4 guardrail boolean clarification)
- Modify: `docs/COMPOUND.md` (append M7 entry: what worked, what didn't, invariants, gotchas, pinned facts, recommended reading for M8)

**Approach:**
- DESIGN §10: swap `#include <output_fragment>` for `#include <opaque_fragment>`; add one sentence citing r154 rename; add a note about the shared-uniform pattern (D6) preferring `uniform bool` on a stable ref.
- DESIGN §5.4: explicit guardrail boolean (D4) to aid future readers.
- COMPOUND M7: dispatcher-driven `markEdited`, cancelActiveTransition triad, EditorLayout's hoisted `useTemplateGate`, hand-rolled ARIA dialog with focus trap (no radix dependency), pure-Node PNG encoder for fixtures.

**Patterns to follow:** M2 and M6 compound entry structure.

**Test scenarios:** *(doc-only, no tests)*

**Verification:** DESIGN §10 snippet lints as TypeScript-flavored pseudo-code and the shader token matches three 0.184 source. COMPOUND.md M7 entry present; file header unchanged.

---

- [ ] **Unit 1: Store + export helper module**

**Goal:** introduce `luminanceEnabled` slot and the pure export module (composite → blob).

**Requirements:** R1, R5.

**Dependencies:** Unit 0.

**Files:**
- Modify: `lib/editor/store.ts` (add `luminanceEnabled: boolean` + `setLuminanceEnabled` idempotent setter)
- Create: `lib/editor/export.ts` (pure module: `exportLayersToBlob(layers, variant): Promise<Blob>` and `downloadBlob(blob, filename): void`; filename builder; no store/React imports)
- Create: `tests/export.test.ts`

**Approach:**
- Reuse the blend-mode pipeline. Extract `BLEND_MODE_MAP` into an exported const in `texture.ts` (already exists — reference directly) and the scratch-canvas compositor logic. Option: call `TextureManager.composite()` against a locally-built TM instance; the TM constructor accepts canvas + ctx injections (M6 amendment 1) so we can point it at a throwaway canvas. That's simpler than extracting the pipeline.
- `exportLayersToBlob`: create 64×64 canvas, get context with explicit `{ colorSpace: 'srgb', willReadFrequently: true }` (Chrome otherwise applies a display-color-space conversion on encode that shifts RGB values — confirmed via external research), instantiate a scratch TM bound to that canvas, `composite(layers)`, call `canvas.toBlob(cb, 'image/png')` wrapped in a Promise. No `quality` arg (D2).
- `downloadBlob`: if `'showSaveFilePicker' in window`, call it with `types: [{ description: 'Minecraft Skin PNG', accept: { 'image/png': ['.png'] } }]`; else fall back to `createObjectURL` + `<a download>` click + `revokeObjectURL` on next microtask.
- Filename builder: `skin-<variant>-<ISO-timestamp-sanitized>.png` (D3).

**Patterns to follow:** M6's `texture.ts` for the composite path; M7's `templates.ts` for a "pure module, store/adapter-free" shape.

**Test scenarios:**
- Happy path: `exportLayersToBlob` with single opaque layer returns a Blob of type `image/png`, non-empty, and `atob`-decodable to a 64×64 PNG header (first 8 bytes == PNG signature).
- Happy path: 4 layers with varying opacity and one `multiply` blend produce a Blob whose pixel content (via `createImageBitmap` + readback canvas) matches `TextureManager.composite()` of the same layers pixel-for-pixel.
- Edge case: empty layers array resolves with a Blob encoding a fully-transparent 64×64 RGBA PNG (all alpha=0, all RGB=0 — Minecraft-safe).
- Edge case: all layers `visible: false` resolves with the same transparent output.
- Edge case: filename builder produces Windows-safe names (no colons, no slashes).
- Edge case: `toBlob` `null` response triggers a descriptive rejection (defensive; browsers can null on very large canvases — shouldn't happen at 64×64 but guard once).
- Happy path: `setLuminanceEnabled(true)` is idempotent (calling twice with the same value does not schedule re-render — narrow-selector test).

**Verification:** pure module imports without React/zustand; 7+ tests pass; store-slot test shows narrow-selector stability.

---

- [ ] **Unit 2: ExportDialog component**

**Goal:** ship the UI surface that triggers export.

**Requirements:** R1, R2.

**Dependencies:** Unit 1.

**Files:**
- Create: `app/editor/_components/ExportDialog.tsx`
- Modify: `app/editor/_components/Toolbar.tsx` or `Sidebar.tsx` (add Export button — the Sidebar is the better home per M7 conventions; match the UndoRedoControls placement pattern)
- Modify: `app/editor/_components/EditorLayout.tsx` (wire dialog open/close state; wire onExport → `exportLayersToBlob` → `downloadBlob`)
- Create: `tests/export-dialog.test.tsx`

**Approach:**
- Copy the ARIA/focus-trap shape from `TemplateBottomSheet.tsx`: `role="dialog" aria-modal="true"`, first focusable element auto-focuses on open, Escape closes, backdrop click closes.
- Dialog layout: heading "Export skin"; variant selector (radio group, Classic/Slim, defaulting to current variant); read-only filename preview; primary "Export" button; secondary "Cancel".
- Variant mismatch warning: if the user selects a variant different from the active one, show an inline muted note: "This will export with <selected> proportions. The current skin uses <current>." Proceed on confirmation.
- onExport: call `exportLayersToBlob(layers, selectedVariant)` → `downloadBlob(blob, filename)`. Keep the `toBlob` inside the click handler's synchronous stack (Safari user-gesture).

**Patterns to follow:** `TemplateBottomSheet.tsx` (focus trap, ARIA); M7 UndoRedoControls (button placement in Sidebar).

**Test scenarios:**
- Happy path: open dialog → variant preselected matches store variant → Export clicks → `downloadBlob` called with the expected filename.
- Edge case: user selects non-current variant → mismatch warning visible → export proceeds with selected variant.
- Edge case: Escape key closes the dialog without calling `downloadBlob`.
- Edge case: backdrop click closes.
- Edge case: first focusable element receives focus on open; focus is restored to the triggering Export button on close.
- Integration: open → export → close → re-open flow does not leak event listeners (RTL leak detector or manual assertion that `window` listeners count is stable).

**Verification:** 6+ tests pass; dialog dismisses without error; Export button visible in Sidebar on `npm run dev`.

---

- [ ] **Unit 3: 0 ms-edit guardrail inside ExportDialog**

**Goal:** wire the soft-friction path driven by M7's store flags.

**Requirements:** R3.

**Dependencies:** Unit 2.

**Files:**
- Modify: `app/editor/_components/ExportDialog.tsx` (guardrail branch)
- Create: `tests/export-guardrail.test.tsx`

**Approach:**
- Read `hasEditedSinceTemplate` + `lastAppliedTemplateId` via narrow selectors at dialog-open time (not at dialog-creation; re-read on each open so late-arriving edits clear the guardrail).
- When `hasEditedSinceTemplate === false && lastAppliedTemplateId !== null`, render a different dialog body: heading "Export without edits?", muted explanation, primary "Edit first" (closes + returns focus to the canvas), secondary "Export anyway" (proceeds).
- When the guardrail does not apply, render the Unit 2 dialog body unchanged.

**Patterns to follow:** M7's `TemplateBottomSheet.tsx` for conditional-body rendering.

**Test scenarios:**
- Happy path: fresh session, no template applied → guardrail does NOT show; normal dialog renders.
- Happy path: template applied, zero strokes → guardrail DOES show; body text matches expected copy.
- Happy path: template applied, ≥1 stroke committed → guardrail does NOT show (M7's `markEdited` already flipped the flag).
- Edge case: user opens dialog with guardrail, paints a stroke without closing (hypothetical — the dialog is modal, but cover it defensively), re-opens → guardrail is gone.
- Edge case: "Export anyway" proceeds to the same `exportLayersToBlob` path as the non-guardrail flow.
- Edge case: "Edit first" closes dialog, returns focus to the canvas, and does NOT call `exportLayersToBlob`.

**Verification:** 6+ tests pass; manual QA with the template flow: apply a template, try export, see guardrail.

---

- [ ] **Unit 4: Luminance store slot + shader module**

**Goal:** land the luminance state and the reusable shader uniform.

**Requirements:** R5.

**Dependencies:** Unit 0 (DESIGN §10 amendment — the shader token must be correct before this unit writes the replacement string).

**Files:**
- Modify: `lib/editor/store.ts` (already covered in Unit 1 for the slot — this unit adds the keybinding wiring)
- Create: `lib/editor/grayscale-shader.ts`
- Create: `tests/grayscale-shader.test.ts` *(module-level unit tests; shader-runtime verification is a dev-server QA item per DESIGN §12.5)*

**Approach:**
- Module exports: `grayscaleUniform: { value: boolean }` (singleton), `patchMaterial(material: MeshStandardMaterial): void` that attaches `onBeforeCompile`.
- Inside `onBeforeCompile`:
  - Push `shader.uniforms.uGrayscale = grayscaleUniform` (shared reference).
  - Prepend `uniform bool uGrayscale;` declaration to `shader.fragmentShader`.
  - Replace `'#include <opaque_fragment>'` with itself plus a grayscale tail that converts to luma: `float luma = dot(gl_FragColor.rgb, vec3(0.299, 0.587, 0.114)); if (uGrayscale) gl_FragColor.rgb = vec3(luma);`
- The boolean in a shared `.value` means ALL patched materials flip together without recompile (D6).
- Do NOT set `customProgramCacheKey` — we're not using `#define`; the uniform-only path avoids it.

**Patterns to follow:** three.js `webgl_materials_modified.html` example (cited in research).

**Test scenarios:**
- Happy path: `patchMaterial` assigns an `onBeforeCompile` callback and does not overwrite an existing one (guard — future-proof).
- Happy path: calling `patchMaterial` on two different material instances makes them share the same `grayscaleUniform` reference (identity check, not deep equality).
- Edge case: setting `grayscaleUniform.value = true` does not trigger a shader recompile (assert `material.needsUpdate` remains false).

**Verification:** 3+ tests pass; module has zero React/zustand imports; inline comment cites r154 rename so a future reader doesn't re-discover it.

---

- [ ] **Unit 5: PlayerModel shader injection**

**Goal:** wire `grayscale-shader.ts` into the 12 meshes of `PlayerModel`.

**Requirements:** R5.

**Dependencies:** Unit 4.

**Files:**
- Modify: `lib/three/PlayerModel.tsx`
- Modify: `tests/player-model.test.tsx` (if present) OR create a lightweight `tests/player-model-luminance.test.tsx`

**Approach:**
- Import `patchMaterial` + `grayscaleUniform` from `lib/editor/grayscale-shader.ts`.
- Because `<meshStandardMaterial>` is declarative JSX, the idiom is `onUpdate={(material) => patchMaterial(material)}` on each `<meshStandardMaterial>` element. `onUpdate` fires once per material instance after R3F creates it.
- Subscribe to the store's `luminanceEnabled` via a narrow selector at the component top level; in an effect, mutate `grayscaleUniform.value = luminanceEnabled`. Zero-alloc `useFrame` invariant preserved — no store reads inside the frame loop.
- Call `bundle.textureManager.markDirty()` after the flip so the R3F renderer picks up the uniform change on the next frame. (The frame loop already runs continuously — `markDirty` is cheap.)

**Patterns to follow:** M2 `useFrame` zero-alloc discipline; M7's Y-rotation pulse `ref` pattern.

**Test scenarios:**
- Happy path: PlayerModel mounts; each mesh's material has `onBeforeCompile` attached (assert via `material.onBeforeCompile != null` on the mock).
- Happy path: flipping `luminanceEnabled` in the store mutates `grayscaleUniform.value` exactly once and does not cause re-render of the mesh tree (parent-level effect, not inline render).
- Edge case: unmounting PlayerModel does not leave `grayscaleUniform.value = true` — the effect cleanup resets it to `false` defensively (prevents surprise luminance after a remount).

**Verification:** 3+ tests pass; `npm run dev` shows white skin renders in color; flipping store value via React DevTools desaturates.

---

- [ ] **Unit 6: CSS filter + floating pill + L hotkey**

**Goal:** complete the luminance UX — 2D desat, top-center pill, keyboard shortcut.

**Requirements:** R5.

**Dependencies:** Unit 5.

**Files:**
- Modify: `app/editor/_components/ViewportUV.tsx` (apply `filter: grayscale(100%)` conditionally on the outer container)
- Create: `app/editor/_components/LuminanceToggle.tsx` (the pill)
- Modify: `app/editor/_components/EditorLayout.tsx` (mount the pill; extend the keydown listener for `L`)
- Modify: `app/globals.css` (add `@keyframes luminance-pill-slide-in`)
- Create: `tests/luminance-toggle.test.tsx`

**Approach:**
- CSS: add to `ViewportUV`'s root element `style={{ filter: luminanceEnabled ? 'grayscale(100%)' : undefined }}` — or a data attribute + a CSS rule. Prefer the attribute pattern (consistent with `data-pulse-target`).
- Pill: server-style absolutely-positioned pill at `top: 1rem; left: 50%; transform: translateX(-50%)`. Slide-down keyframe (500 ms) on mount when `luminanceEnabled` goes true → visible; slide-up on false. `role="status"` + `aria-live="polite"` + hidden `<span>` announcing state for SR users. Subscribed via narrow selector.
- L hotkey: extend the Cmd/Z keydown listener in EditorLayout. Guard: no modifier keys (plain L), not inside input/textarea/contenteditable/role="application". Confirm no conflict with B/E/I/G/M in `Toolbar.tsx` — L is unused, per verification.
- Announce (brief) on toggle: the pill's text flips between "👁 Luminance Mode on" / "👁 Luminance Mode off" on `aria-live="polite"`.

**Patterns to follow:** M7 `ContextualHintOverlay` for positioning + subscribe; M7 `AffordancePulse` for data-attribute driven CSS; M6 keydown pattern for window listener composition.

**Test scenarios:**
- Happy path: L keypress toggles `luminanceEnabled` in the store.
- Happy path: L keypress inside an input/textarea does NOT toggle (Toolbar-style guard).
- Happy path: L modifier-combo (Cmd+L, Ctrl+L, Alt+L) does NOT toggle.
- Happy path: pill mounts with slide-in class when `luminanceEnabled` first becomes true.
- Happy path: pill unmounts after slide-out completes (or is hidden via CSS).
- Happy path: ViewportUV outer element has `filter: grayscale(100%)` (or equivalent data-attr) when store value is true.
- Edge case: toggling L during an active stroke does NOT cancel the stroke (verify `strokeActive` semantics don't change).
- Integration: Toolbar shortcuts B/E/I/G/M continue to work after the L handler is attached.

**Verification:** 8+ tests pass; manual QA confirms both viewports desaturate; color picker stays in color; pill animates in and out.

---

- [ ] **Unit 7: First-paint baseline (cursor glow + data-attr lifecycle)**

**Goal:** land the fast-path first-paint polish without reaching for new store plumbing.

**Requirements:** R4.

**Dependencies:** Unit 0 (DESIGN amendments unrelated to this unit; safe to run in parallel with Units 4–6 if agents coordinate).

**Files:**
- Modify: `app/editor/_components/EditorLayout.tsx` (new `useFirstPaint()` hook inline)
- Modify: `app/globals.css` (new `@keyframes first-paint-cursor-glow`; `[data-first-paint="true"] [data-pulse-target]` rule)
- Create: `tests/first-paint.test.tsx`

**Approach:**
- `useFirstPaint(hydrationPending, lastAppliedTemplateId)`: effect depends on both. When `hydrationPending === false && lastAppliedTemplateId === null` AND the hook has not already fired this session, set a ref flag, set `data-first-paint="true"` on a root div, schedule a `setTimeout` at 600 ms to flip the attribute off.
- At 700 ms, call `store.setActiveContextualHint("Try painting — click anywhere on the model.")` using the M7 infra (auto-clears after `HINT_DURATION_MS`).
- At 1000 ms, call `store.setPulseTarget('brush')` (auto-clears after 600 ms per M7 `AffordancePulse`).
- Cancel all pending timers on unmount and on first stroke committed (read `hasEditedSinceTemplate` via subscribe).

**Patterns to follow:** M7 `cancelActiveTransition` pattern; M6 `useRef`-based session guards.

**Test scenarios:**
- Happy path: on first mount with no saved template, `data-first-paint="true"` is set on the root element within the first render frame.
- Happy path: after 600 ms (fake timers), the attribute is cleared.
- Happy path: at 700 ms, `activeContextualHint` is set; at 1000 ms, `pulseTarget` becomes `'brush'`.
- Edge case: if the user paints before any timer fires, all pending timers cancel (use M7's pattern — a timers ref + `cancelActiveTransition`-style cleanup).
- Edge case: `lastAppliedTemplateId !== null` at mount → hook does NOT fire (returning user w/ template).
- Edge case: `hydrationPending === true` → hook defers; when it flips false, hook fires (reload-mid-hydration test from M7).
- Edge case: component unmount cancels all pending timers (no late `set` calls into a torn-down store — RTL unmount + timer run assertion).

**Verification:** 7+ tests pass; manual QA on `npm run dev` shows visible glow on the brush-size radio group within the first second after editor loads.

---

- [ ] **Unit 8: First-paint model micro-motion + idle-check**

**Goal:** connect the first-paint sequence to the PlayerModel's Y-rotation pulse path for the "alive within 2s" effect.

**Requirements:** R4.

**Dependencies:** Unit 7.

**Files:**
- Modify: `app/editor/_components/EditorLayout.tsx` (add `firstPaintPulseKey` state, thread to `EditorCanvas`)
- Modify: `app/editor/_components/EditorCanvas.tsx` (forward the new prop to `PlayerModel`)
- Modify: `lib/three/PlayerModel.tsx` (react to `firstPaintPulseKey` bump with the same Y-rotation pulse as M7's `yRotationPulseKey`)
- Create: `tests/first-paint-pulse.test.tsx` (or extend `first-paint.test.tsx`)

**Approach:**
- Add `firstPaintPulseKey: number` state to EditorLayout. At t=1600 ms in the first-paint sequence, if `useEditorStore.getState().strokeActive === false` AND no stroke has been committed since mount, bump the key.
- Plumb through `EditorCanvas → PlayerModel` exactly like M7's `yRotationPulseKey`. Both keys can share the same underlying `pulseStartMsRef` — if a future concurrent pulse case arises, split them. For M8, they compose cleanly because template apply happens only via user action after editor mount, so the two pulses do not overlap.
- If the user paints between mount and t=1600, skip the pulse entirely.

**Patterns to follow:** M7 Y-rotation pulse threading.

**Test scenarios:**
- Happy path: 1600 ms after mount (fake timers) with no stroke, `firstPaintPulseKey` increments once.
- Edge case: a stroke committed at t=900 ms causes the t=1600 pulse to be skipped.
- Edge case: multiple mount→unmount→mount cycles only trigger one pulse per mount-session (guard via session-scoped ref).

**Verification:** 3+ tests pass; manual QA confirms a subtle head rotation happens at ~1.6s on editor-land.

---

- [ ] **Unit 9: Landing page polish**

**Goal:** evolve `app/page.tsx` to a marketing-worthy Lighthouse ≥95 page.

**Requirements:** R6.

**Dependencies:** none technical; preferably lands alongside or after export is visible so the feature list can claim "export" with confidence.

**Files:**
- Modify: `app/page.tsx`
- Modify: `app/layout.tsx` (extend `metadata` with OpenGraph + description)
- Create: `tests/landing-page.test.tsx` (render + link assertions only — no Lighthouse in unit tests)

**Approach:**
- Keep the page a pure server component. No `'use client'`.
- Content structure:
  - **Hero:** h1 "A free, open-source 3D Minecraft skin editor for the web." / subhead "Paint. See your skin live on a 3D model. Export and play — no account required." / primary CTA "Open the editor" (Link `prefetch={false}`).
  - **Feature strip (text only):** four bullets — "10 locked templates", "Classic + Slim variants", "Unlimited undo", "Exports Minecraft-ready PNGs".
  - **Secondary CTA:** identical link styled as a text link for users who scrolled.
  - **Footer:** "MIT licensed · [GitHub](https://github.com/ryanssareen/threditor) · Not affiliated with Mojang or Microsoft."
- Metadata: `title`, `description`, `openGraph` with title/description (M8 defers OG image to later — generating a default OG is M9 work).
- Explicitly no images, no 3D, no icon fonts. Typography only.
- `prefetch={false}` on the hero CTA (research: default prefetch loads editor JS into landing's critical path).

**Patterns to follow:** existing `app/page.tsx` hero + CTA; Tailwind tokens from `@theme`.

**Test scenarios:**
- Happy path: page renders as a Server Component (no `'use client'` in the rendered tree).
- Happy path: primary CTA link targets `/editor` with `prefetch={false}` (assert the rendered attribute).
- Happy path: footer contains the GitHub link, MIT text, and disclaimer.
- Happy path: metadata export has `title`, `description`, and `openGraph` set.
- Edge case (manual): `npm run build` output marks `/` as `○ (Static)`. Not a unit-test assertion; documented as a verification item.

**Verification:** 4+ tests pass; manual Lighthouse run (`npm run build && npx serve .next/...` or local preview) returns ≥95 on both mobile and desktop. Record baseline in Unit 10's compound entry.

---

- [ ] **Unit 10: Integration sweep + bundle audit + COMPOUND.md M8 entry + PR**

**Goal:** close the milestone.

**Requirements:** R1, R2, R3, R4, R5, R6, R7, R8.

**Dependencies:** Units 0–9.

**Files:**
- Modify: `docs/COMPOUND.md` (append M8 section)
- Potentially: any minor fixes surfaced during the sweep

**Approach:**
- `npm run lint`, `npx tsc --noEmit`, `npm run build`, `npm run test` — all clean.
- Bundle measurement: verify `/editor` First Load JS is ≤ 373 + 10 = 383 kB. Verify `/` is ≤ 110 kB First Load JS.
- Manual acceptance items (not automated):
  - Export on a Classic skin; file opens in-game AND in NovaSkin or similar viewer.
  - Export on a Slim skin; file opens in-game AND renders with Slim proportions.
  - Template → open Export immediately → soft-friction dialog appears → "Edit first" closes → paint → re-open → dialog is gone.
  - Fresh session → editor loads → brush-size pulse happens around t=1000 ms → head rotation at t=1600 ms.
  - L hotkey → both viewports desaturate → color picker stays in color → L again → full color restored.
  - Landing page → Lighthouse mobile + desktop both ≥95 — record numbers.
- COMPOUND M8 entry: export canvas ownership decision, Minecraft PNG gotchas actually observed, the `opaque_fragment` rename gotcha, customProgramCacheKey consideration, first-paint timing coordination wins + misses, Lighthouse number, bundle delta.

**Test scenarios:** *(none — close-out unit)*

**Verification:** full suite green; bundle numbers under budget; COMPOUND.md M8 section present; PR open on `main` (or `m8-export-polish` branched and PR'd).

## System-Wide Impact

- **Interaction graph:** `EditorLayout` gains three responsibilities — mounting `ExportDialog`, mounting `LuminanceToggle` pill, and owning the `useFirstPaint` hook. The Sidebar gains an Export button. Toolbar stays unchanged (no new tool — L is a mode, not a tool).
- **Error propagation:** Export's `toBlob` can return `null` on pathological canvas states; the export helper rejects its Promise with a descriptive message. ExportDialog catches and displays an inline error in the dialog body (without closing it) so the user can retry. File System Access API can reject (user cancelled picker) — treat as a no-op, not an error.
- **State lifecycle risks:** First-paint timers overlapping with template-apply timers (via M7's Ghost Picker). Protect via M7's `cancelActiveTransition` pattern extended to include first-paint handles. If a user lands on `/editor`, sees the first-paint hint at t=700, then opens the Ghost Picker and applies a template at t=1400, the template-apply's cancel-active-transition must also clear the pending t=1600 pulse. Unit 8 implements this.
- **API surface parity:** zero external API. All M8 surfaces are internal.
- **Integration coverage:** export round-trip test compares `exportLayersToBlob(layers)` pixel output to `TextureManager.composite(layers)` pixel output (must be identical). First-paint tests must run with fake timers to exercise the 600/700/1000/1600 millisecond sequence deterministically.
- **Unchanged invariants:** M6 narrow-selector, M2 `useFrame` zero-alloc, M7 dispatcher-chokepoint. No new dependencies.

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| `#include <opaque_fragment>` token is wrong in a future three.js release. | Inline comment cites r154 rename and links to the migration guide. A comment-locked test in `tests/grayscale-shader.test.ts` at least asserts the replace() call changes the shader string length — if three renames the token again, the test fails loudly. |
| Minecraft skin loader changes in 1.21.x reject our PNG encoding. | Manual acceptance test in Unit 10 includes in-game verification. Failure = rebuild the PNG via a hand-rolled encoder (M7 already has one in `scripts/gen-template-placeholders.mjs`) as a fallback path. Budget allows 1-2 hours for this contingency. |
| Bundle delta blows the +10 kB budget. | ExportDialog is ≤ 4 KB LOC; grayscale-shader module is ≤ 1 KB; LuminanceToggle is ≤ 2 KB; landing page changes are negative-kB (simpler than current). Realistic estimate: +4 to +7 kB. If blown, first candidate to cut: the `showSaveFilePicker` progressive enhancement (swap for anchor-only). |
| First-paint timing doesn't feel "alive" even after spec compliance. | DESIGN §12.5 acceptance allows subjective tuning within ±100 ms; iterate in Unit 7/8 during the work phase. Record the "felt alive?" verdict in COMPOUND so M9 knows whether to deepen. |
| Safari blocks the anchor-download outside the user-gesture stack. | Unit 1 confirms the `toBlob` callback pattern preserves gesture. Unit 2 tests open + click + download round trip in JSDom; manual Safari test in Unit 10. |
| Luminance toggle's shared-uniform approach fails on some GPUs (uniform propagation anomaly). | Research conclusion is this is canonical three.js idiom; if it fails, fall back to `customProgramCacheKey` per-material. Documented as deferred. |
| Landing-page Lighthouse misses 95 on mobile. | Research predicts 95-98 mobile is achievable with the stated architecture. If missed, profile: typical culprits are unused CSS from Tailwind (already tree-shaken by v4), font metrics (Geist's `size-adjust` is already correct), and CLS from link hover states. |
| M7 COMPOUND entry never written before M8 starts. | Addressed in Unit 0 — backfill the M7 entry as part of M8's doc-amendment kickoff. |

## Documentation / Operational Notes

- No ops changes (no Firebase yet — Phase 2). Vercel deploy on merge to main as per existing workflow.
- `README.md` may want a "Features" section refresh to mirror the landing-page strip, but this is optional and deferred.
- No data migration — no persisted schema changes. `luminanceEnabled` is in-memory only.
- No monitoring to wire.

## Sources & References

- Origin: DESIGN.md §5.4 (first-paint timeline + guardrail trigger), §10 (luminance toggle), §12.5 M8 (plan / work / review / compound criteria).
- M7 plan: `docs/plans/m7-templates-plan.md` — TIMING constants, cancelActiveTransition pattern, hand-rolled dialog convention.
- M6 COMPOUND: `docs/COMPOUND.md` §M6 — `putImageData` bypass learning, narrow-selector convention, dispatcher-chokepoint.
- Code:
  - `lib/editor/texture.ts::composite` (compositor reuse)
  - `lib/editor/store.ts::markEdited` + `hasEditedSinceTemplate` slot (guardrail read)
  - `lib/editor/templates.ts::TIMING` (first-paint timing vocabulary)
  - `app/editor/_components/TemplateBottomSheet.tsx` (focus-trap dialog template)
  - `lib/three/PlayerModel.tsx` (`useFrame` + Y-rotation pulse pattern)
- External (cited per decision above):
  - three.js Migration Guide — `output_fragment` → `opaque_fragment`
  - three.js docs `Material.customProgramCacheKey`
  - MDN `HTMLCanvasElement.toBlob`
  - MDN `Window.showSaveFilePicker`
  - caniuse `native-filesystem-api`
  - Next.js Prefetching guide, `next/link`, `next/font/google`, `generateStaticParams`
  - Web.dev Core Web Vitals 2026

## Estimated Complexity

**T-shirt: M.**

- Export: straightforward, well-patterned. ~4 hours including tests.
- Luminance: straightforward given the research corrections. ~2 hours.
- First-paint: subjective polish — 2 to 4 hours depending on iteration depth.
- Landing page: ~1 hour.
- Integration + COMPOUND + PR: ~1 hour.

Total: 8–12 hours of single-operator work, well within DESIGN §12.5 M8's 4–6 hour budget only if units run in parallel (which the work phase can dispatch). Solo-sequential will push closer to 10 hours.
