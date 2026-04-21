---
title: M7 — Templates + Persistence
type: feat
status: active
date: 2026-04-21
milestone: M7
depth: Standard
---

# M7 — Templates + Persistence

> **Plan file:** `docs/plans/m7-templates-plan.md` (matches `m6-layers-undo-plan.md` convention).
> **Origin:** `/ce:plan` invocation on 2026-04-21, immediately after M6 merge. No separate upstream requirements doc — scope is pinned by `docs/DESIGN.md` §5, §12.5 M7 + the user's `/ce:plan` scope statement.
> **Plan type:** **Standard** (new UI surface, async asset pipeline, undo-engine integration, state-machine component). Bounded; every unit lands a visible outcome.

## Context

M1–M6 shipped the editable skin pipeline: scaffold → player model → paint canvas → 2D↔3D bridge → tool palette → layers + undo. Persistence has been live since M3 (single-layer) and was extended to N layers in M6. The editor now saves and restores N-layer documents with opacity/blend/visibility across reloads.

**Current first-open UX:** a fresh visit seeds the placeholder skin (`createPlaceholderSkinPixels(variant)` from M2 — deliberately ugly debug palette) and drops the user into the editor with no guidance. Returning visitors see their last saved document hydrated from IDB. There is no starting-style prompt, no template catalog, no "you haven't painted yet" guardrail.

**M7 turns this into** a Ghost Templates first-run picker (DESIGN §5.3 state machine) anchored by ten locked templates (DESIGN §5.1 catalog) that ship under `public/templates/`. Selecting a template atomically replaces the active document with the template's pixels, crossfades the 3D model, fires a 700ms contextual hint anchored to the viewport, and pulses the affordance UI element at 1000ms. Apply-template is an undoable command so Cmd+Z restores the prior document. A `hasEditedSinceTemplate` flag is tracked in the store (persisted to IDB) and read by the 0ms-edit guardrail — currently a state hook; the actual "Edit first / Export anyway" soft-friction dialog lands in M8 when export itself ships.

**M7 does NOT touch core paint behavior.** The tool dispatcher, texture manager, undo stack (except for one new command kind), and paint surfaces are unchanged.

## Overview

Ship the template catalog + picker. A user arriving at `/editor` for the first time sees the placeholder skin, then after ~3.5 seconds of idle (OR on first stroke) a "Try a starting style" chip appears. Tapping it opens a bottom sheet with three templates visible and horizontal scroll across the remaining seven. Selecting a template crossfades the model, switches variant if needed, and leaves the user editing the new base. Cmd+Z undoes the template apply. Dismissing the chip or the sheet persists `templates-dismissed=true` to localStorage; subsequent sessions skip the picker entirely (templates remain accessible via a menu item — the entry lives in the existing Sidebar, no new surface needed).

The core complexity is the apply-template atomicity: layers, variant, active layer id, and two new store slots (`hasEditedSinceTemplate`, `lastAppliedTemplateId`) must swap in one microtask so the use-texture-manager effect reacts once, the undo command captures a consistent snapshot, and the transition timeline fires from a single source of truth.

A prerequisite: **M6's variant-toggle path reseeds layers from placeholder on every variant change and implicitly clears the undo stack** (through layer replacement, not by design). M7's apply-template must switch variant WITHOUT wiping the just-applied template layers. Unit 0 decouples the placeholder-seed responsibility from the use-texture-manager variant effect so apply-template can populate layers + variant atomically.

## Pinned versions (delta from M6)

| Package | Previous (M6) | M7 | Notes |
|---|---|---|---|
| All M1–M6 pins | same | **unchanged** | No new dependencies. Bottom sheet is hand-rolled; chip is a button; localStorage is native; PNG decode uses the built-in `ImageBitmap` + `<canvas>` path already used by `TextureManager`. |

**Peer-dependency check:** zero new packages. No `@radix-ui`, no `framer-motion`, no `lottie` — the 200ms crossfade is a CSS `transition-opacity`, the Y-rotation is a `useFrame` lerp against a ref target, and the affordance pulse is a CSS keyframe.

## Files to create / modify

**`lib/editor/` — extends existing**

- `lib/editor/types.ts` — **modify**. Add `TemplateManifest`, `TemplateCategory`, `TemplateMeta`, `AffordancePulseTarget` union (`'color' | 'mirror' | 'brush' | null`). Add `SkinDocument.hasEditedSinceTemplate?: boolean` + `SkinDocument.lastAppliedTemplateId?: string | null` (both optional so M3–M6 IDB records load cleanly).
- `lib/editor/store.ts` — **modify**. Add slots: `hasEditedSinceTemplate: boolean`, `lastAppliedTemplateId: string | null`, `activeContextualHint: string | null`, `pulseTarget: AffordancePulseTarget`. Add actions: `markEdited()` (idempotent: false→true only), `clearContextualHint()`, `applyTemplateState(next)` — a low-level atomic setter used by the apply-template action. Refactor `setVariant` to clear layers BEFORE flipping variant (sequencing for Unit 0).
- `lib/editor/undo.ts` — **modify**. Add `Command = ... | { kind: 'apply-template', before: ApplyTemplateSnapshot, after: ApplyTemplateSnapshot }`. `ApplyTemplateSnapshot = { layers: Layer[], activeLayerId: string, variant: SkinVariant, hasEditedSinceTemplate: boolean, lastAppliedTemplateId: string | null }`. `size(command)` sums pre+post layer byte counts. Apply/revert routes through a new `EditorActions.applyTemplateSnapshot(snapshot)` method.
- `lib/editor/templates.ts` — **new**. `loadManifest(): Promise<TemplateManifest>` fetches `/templates/manifest.json` (cache: 'force-cache'), validates shape, returns typed. `decodeTemplatePng(url): Promise<Uint8ClampedArray>` decodes a 64×64 PNG to RGBA bytes via `createImageBitmap` + 2D canvas (matches M2's PNG decode pattern). Module-level in-memory cache keyed by URL so repeat apply-template calls on the same template don't re-decode.
- `lib/editor/apply-template.ts` — **new**. `applyTemplate(store, actions, template, pixels): void` — the orchestrator. Builds the `before` snapshot, constructs the new `Layer` from the template pixels, pushes the `apply-template` undo command, atomically updates the store (layers + activeLayerId + variant + hasEditedSinceTemplate=false + lastAppliedTemplateId), triggers the contextual-hint + pulse timeline, and returns the new active layer id. Pure orchestrator; no React.
- `lib/editor/use-texture-manager.ts` — **modify**. Decouple the placeholder seed. On variant change: dispose the old TM, build a new TM, composite with the CURRENT store layers (no reseed). A separate effect (keyed on `[bundle, layers.length === 0]`) seeds the placeholder when layers are empty. Unit 0 fixes the M6 gotcha where variant-toggle clobbered just-applied template layers and implicitly dropped the undo stack.
- `lib/editor/persistence.ts` — **modify**. `buildDocument` serializes `hasEditedSinceTemplate` + `lastAppliedTemplateId`. `loadDocument` parses both fields defensively (unknown/missing → defaults: `hasEditedSinceTemplate = true` to avoid re-prompting returning users, `lastAppliedTemplateId = null`). Update `InitPersistenceParams` with `getHasEditedSinceTemplate` + `getLastAppliedTemplateId` accessors.

**`app/editor/_components/` — extends existing**

- `app/editor/_components/EditorLayout.tsx` — **modify**. Render `<TemplateGate />` as a sibling to the existing three panes; thread an `applyTemplate` callback that wires into `lib/editor/apply-template.ts` with the resolved `EditorActions` adapter + undoStack. Extend `EditorActions` with `applyTemplateSnapshot(snapshot)` (used by undo/redo of apply-template commands). Bridge the existing `handleStrokeCommit` so the first stroke after hydration flips `hasEditedSinceTemplate` true via `markEdited()`.
- `app/editor/_components/Sidebar.tsx` — **modify**. Add a `<TemplateMenuButton onClick={openBottomSheet} />` row at the top of the sidebar so the picker is reachable after dismissal (DESIGN §5.3: "templates remain accessible via menu"). Opening the sheet through this button does NOT persist `templates-dismissed` (explicit user-initiated open, not first-run suggestion).
- `app/editor/_components/EditorCanvas.tsx` — **modify**. Opacity-crossfade the 3D model on variant+texture change: a 200ms CSS `transition-opacity` on the `<Canvas>` wrapper, triggered by a `texFadeKey` prop from EditorLayout (bumped on apply-template). Also applies a one-shot +0.1 rad Y rotation via a ref lerp in `PlayerModel` — coordinated via an optional `yRotationPulseKey` prop. Per DESIGN §5.4.

**`app/editor/_components/` — new**

- `app/editor/_components/TemplateGate.tsx` — **new**. Top-level Ghost Templates state machine (idle → suggestion_chip → bottom_sheet → dismissed). Owns the 3500ms timer, first-stroke subscription, and the chip/sheet render. Reads `templates-dismissed` from localStorage on mount. Gated off when `hasEditedSinceTemplate === true` at mount (returning visitor with prior edits).
- `app/editor/_components/TemplateSuggestionChip.tsx` — **new**. Floating chip anchored above the 3D canvas. `"Try a starting style"` label + dismiss × button. Tap-to-open; × persists dismissal. Touch-friendly (min 44×44 px hit area).
- `app/editor/_components/TemplateBottomSheet.tsx` — **new**. Modal-ish sheet anchored to the viewport bottom. Category tabs (Safe Wins / Technique / Identity / Base) + horizontal scroll strip. Renders 3 templates at typical widths; scrolls to reveal the rest. Each card is a thumbnail + label + variant badge. Close × in header persists dismissal (only when opened by the Ghost flow). Esc-to-close. Backdrop click closes without dismissing.
- `app/editor/_components/ContextualHintOverlay.tsx` — **new**. Renders the 700ms-post-apply hint anchored to the 3D model's bounding box. Reads `activeContextualHint` from the store; auto-dismisses after 3000ms OR on any pointerdown in the editor. Plain text bubble with a caret pointing at the viewport.
- `app/editor/_components/AffordancePulse.tsx` — **new**. A headless coordinator that reads `pulseTarget` from the store and applies a `data-pulse="true"` attribute to the matching DOM node (queried by `data-pulse-target` on the Toolbar / ColorPicker / mirror toggle). A 600ms CSS keyframe fades in/out a ring; the attribute clears on animation end. No new visible DOM; just coordinates existing components.

**`public/templates/` — new asset directory**

- `public/templates/manifest.json` — **new**. Catalog per DESIGN §5.2 shape.
- `public/templates/classic/*.png` — **new**. Six 64×64 classic-variant PNGs: `classic-hoodie.png`, `gamer-tee.png`, `split-color.png`, `shaded-hoodie.png`, `armor-lite.png`, `sports-jersey.png`, `blank-better.png` (adapted from Microsoft minecraft-samples). Seven total — see D7 below.
- `public/templates/slim/*.png` — **new**. Three 64×64 slim-variant PNGs: `minimal-black.png`, `cartoon-face.png`, `hoodie-headphones.png`. Plus `blank-better.png` for slim if we produce a separate variant; D7 decides.
- `public/templates/thumbs/*.webp` — **new**. 256×256 pre-rendered 3D thumbnails per template. One per template (10 total). Not 64×64 PNG thumbs — the bottom sheet shows the 3D render so the user recognizes the silhouette.

**`tests/` — extends existing**

- `tests/templates-manifest.test.ts` — **new**. Shape validation; rejects malformed categories; matches the DESIGN §5.2 schema; PNG URL + thumbnail URL existence tests (stubbed fetch).
- `tests/templates-decode.test.ts` — **new**. PNG decode round-trip using a fixture PNG; cache hit on second call.
- `tests/apply-template.test.ts` — **new**. `applyTemplate` orchestrator: undo command push, store state swap atomicity, re-application after Cmd+Z restores prior state, variant-switch-on-apply doesn't clobber the template layer.
- `tests/template-gate-state.test.ts` — **new**. Pure-function state reducer for the Ghost picker (timer elapsed / first stroke / chip click / dismiss). Timer orchestration is in the component; the reducer is testable standalone.
- `tests/template-gate.test.ts` — **new**. jsdom component test: mounts TemplateGate, advances fake timers 3500ms, asserts chip appears; clicking chip opens sheet; dismissing persists localStorage.
- `tests/undo.test.ts` — **modify**. Add `apply-template` command scenarios to the existing undo suite (round-trip, byte accounting, eviction with large command).
- `tests/persistence.test.ts` — **modify**. Round-trip `hasEditedSinceTemplate` + `lastAppliedTemplateId`; M3–M6 saves without those fields load with safe defaults.

**Out of scope** (explicit non-goals):

- **No PNG export** — M8. The 0ms-edit guardrail's "Edit first / Export anyway" DIALOG ships in M8 alongside export; M7 exposes only the `hasEditedSinceTemplate` predicate that M8's export handler will read.
- **No template editing, no user-authored templates, no template upload** — not in DESIGN §5; Phase 2.
- **No palette extraction from templates** — `lib/color/palette.ts` line 6 flags palette-extract as deferred; remains deferred.
- **No 3D thumbnail generation pipeline** — thumbnails are pre-rendered assets authored offline, not generated in-app.
- **No template favoriting or recently-used** — locked catalog of 10; no user customization.
- **No category reordering or custom categorization** — four fixed categories matching DESIGN §5.1.
- **No per-template prompt / tutorial overlay** — the 700ms contextual hint string is the extent of guidance per template.
- **No analytics on template selection** — telemetry attaches in a later phase (noted as a future hook point for the dispatcher-chokepoint pattern from M6).
- **No "sample all layers" picker mode** — M4 D7 deferred, still deferred.
- **No animation library** — crossfade is `transition-opacity`, rotation is `useFrame` lerp, pulse is a CSS keyframe.
- **No M6 P2/P3 carry-forwards** — `handleWheel` tearing, Toolbar Cmd+B collision, SL-square aria-valuetext migration. All still unresolved; M7 doesn't touch them.

## Requirements trace

- **R1.** Ten templates ship in `public/templates/` with `manifest.json` matching DESIGN §5.2 schema. Categories: Safe Wins (3), Technique (4), Identity (2), Base (1). Seven are Original (MIT); one is Microsoft minecraft-samples (MIT, adapted).
- **R2.** First-visit users see the suggestion chip at 3500ms OR on first stroke (whichever first). Returning users with `localStorage['templates-dismissed'] === 'true'` OR `hasEditedSinceTemplate === true` (restored from IDB) skip the picker entirely.
- **R3.** Clicking the chip opens the bottom sheet; sheet shows 3 templates visible + horizontal scroll. Category tabs filter. Each card shows thumbnail + label + variant badge.
- **R4.** Selecting a template atomically: (a) pushes `apply-template` undo command capturing prior state, (b) replaces layers with `[{id: 'template:<id>', name: <label>, pixels: <template bytes>, opacity:1, blendMode:'normal', visible:true}]`, (c) switches variant if template variant differs from current, (d) sets `lastAppliedTemplateId` + `hasEditedSinceTemplate=false`, (e) dismisses the sheet + persists `templates-dismissed=true` (only when opened from the Ghost flow).
- **R5.** Template-to-edit transition timeline (DESIGN §5.4) fires within ±50ms per frame: 0ms click → 200ms crossfade + Y-rotation pulse starts → 500ms editable → 700ms contextual hint appears → 1000ms affordance pulse on target UI element → 1300ms/1600ms subtle idle motion (M2 breathing continues unchanged; 1300/1600 are placeholders in M7 — documented as M8 polish).
- **R6.** Cmd+Z after apply-template restores prior layers + activeLayerId + variant + `hasEditedSinceTemplate` + `lastAppliedTemplateId` bit-exactly. Cmd+Shift+Z reapplies.
- **R7.** `hasEditedSinceTemplate` flips false→true on the FIRST stroke commit after apply-template (or after session start if no template applied). Subsequent strokes don't re-fire the state mutation (identity-guarded).
- **R8.** `hasEditedSinceTemplate` is persisted to IDB; on reload, the flag restores. Unknown-field defaults to `true` for M3–M6 saves (safe choice — existing users with prior edits don't see the first-run picker).
- **R9.** `lastAppliedTemplateId` persists and restores; drives the 700ms contextual hint + affordance pulse even after a reload mid-transition (edge case, unlikely but covered).
- **R10.** `templates-dismissed` localStorage key persists across reloads. Opening the menu-based picker does NOT set dismissed (explicit user intent to view the catalog).
- **R11.** Bottom sheet dismissal via backdrop click does NOT persist dismissed; only explicit × or sheet-close-button does. Rationale: accidental outside-clicks shouldn't permanently disable the first-run experience on shared devices.
- **R12.** Variant switch triggered by apply-template must NOT clear the undo stack NOR reseed placeholder layers. Unit 0 decouples the placeholder-seed effect from the TM lifecycle effect.
- **R13.** All M1–M6 tests pass (349/349). No regression to paint, persistence, layer panel, undo shortcuts, or tool shortcuts.
- **R14.** `npm run lint`, `npx tsc --noEmit`, `npm run build`, `npm run test` all clean. Bundle delta ≤ **+15 kB** First Load JS on `/editor` vs M6's 368 kB baseline. Templates themselves live in `public/` and are not bundled — they're fetched on-demand.
- **R15.** PNG templates are authored as 64×64 RGBA. Decoding validates the exact 64×64 dimensions; malformed PNGs show a per-card error state + are skipped from apply.

## Scope boundaries

- **No backend template sourcing.** Templates are static `public/` assets. Hot-reload a new template by editing `manifest.json` + deploying.
- **No template versioning.** `manifest.version: 1` is declared; a version bump is a future concern (invalidate thumbnail caches, etc).
- **No OG image for templates.** Template thumbnails are consumed in-app only; share/publish is Phase 2.
- **No prompt-engineering of the contextual hint.** The hint is a static string per template in the manifest.
- **No A/B experiment on chip copy or timing.** Hard-coded "Try a starting style" + 3500ms; tuning is a future milestone.
- **No accessibility audit of the bottom sheet beyond standard ARIA dialog semantics.** Use `role="dialog"` + `aria-modal="true"` + focus trap + Esc-to-close. Full audit is M8 polish.
- **No fallback for browsers missing `createImageBitmap`.** Target (Chrome/Safari/Firefox current) all support it. If needed, `<img>` onload + canvas draw is the one-line fallback (not wired in M7).

## Context & Research

### Relevant code and patterns (M7 substrate)

- **`lib/editor/use-texture-manager.ts` (M6).** Owns TM lifecycle + placeholder seed. M7 Unit 0 decouples the two responsibilities so apply-template can keep its applied layers across the variant-change TM rebuild.
- **`lib/editor/undo.ts` (M6).** The Command union + `EditorActions` adapter + byte-accounting `size(command)` function are the extension points for the new `apply-template` kind. See `docs/COMPOUND.md` M6 §Invariants — `EditorActions` adapter keeps undo.ts React-free.
- **`lib/editor/store.ts` (M6).** Narrow-selector contract is load-bearing. TemplateGate + ContextualHintOverlay + AffordancePulse each subscribe to one slot (e.g., `activeContextualHint`) and re-render only when that slot changes.
- **`lib/editor/tools/dispatch.ts` (M5 + M6).** Dispatcher chokepoint pattern. M7 attaches the `markEdited()` hook here: the FIRST `commitStroke()` call that produces a non-null Stroke flips `hasEditedSinceTemplate` via the existing `onStrokeCommit` bridge. No new chokepoint — ride the M6 invariant.
- **`lib/editor/persistence.ts` (M3 + M6).** Already speaks the full `SkinDocument` shape; M7 adds two optional fields with safe defaults. The `buildDocument` path just extends.
- **`app/editor/_components/EditorLayout.tsx` (M6).** Owns the UndoStack, builds the `EditorActions` adapter, threads `onStrokeCommit` + `onStrokeActive` + `onLayerUndoPush`. M7 extends with `onApplyTemplate` wiring + the `texFadeKey` prop for the 3D crossfade.
- **`app/editor/_components/Sidebar.tsx` (M3–M6).** The existing component template for a sidebar control (Toolbar, VariantToggle, ColorPicker, LayerPanel, SavingStatusChip). M7's `TemplateMenuButton` follows the same button + narrow-selector shape.
- **`lib/three/PlayerModel.tsx` (M2 + M4).** Owns `useFrame` zero-alloc callback + variant-swap disposal. M7 adds an optional `yRotationPulseKey` prop — a bump of this key triggers a one-shot Y-rotation lerp inside the existing `useFrame` (no new callback; zero-alloc invariant preserved).
- **`lib/three/placeholder-skin.ts` (M2).** The TODO at line 11 flags M7 as the milestone that replaces the placeholder. M7 does NOT delete the placeholder — `blank-better.png` becomes the recommended first-open seed, but the placeholder stays as a development-only fallback and the Slim/Classic variant demo source. Rename the TODO to "Superseded by `blank-better.png` template; kept as dev fallback" in Unit 0.

### Institutional learnings (carry forward)

- **`docs/COMPOUND.md` M6 §Invariants — `EditorActions` adapter.** M7's `applyTemplateSnapshot(snapshot)` method is added to the adapter shape. The `undo.ts` module gains a new Command kind but stays React-free.
- **`docs/COMPOUND.md` M6 §Invariants — dispatcher-chokepoint pattern.** `markEdited()` attaches here, not in each tool. Riding the M6 invariant means zero per-tool code changes for M7.
- **`docs/COMPOUND.md` M6 §Invariants — session-scoped non-serializable instances live in `useRef`, not zustand.** TemplateGate's 3500ms timer handle + bottom-sheet DOM ref use `useRef`. The `templates-dismissed` localStorage value is a primitive (string), so it can safely be read directly from `localStorage.getItem` — no store slot needed unless multiple components need to observe changes within one session (they don't).
- **`docs/COMPOUND.md` M6 §Invariants — off-store pixel mutation preserves narrow-selector cost.** apply-template REPLACES the layer array (new identity), so the new template layer triggers one LayerPanel re-render. Subsequent strokes on the template layer mutate `pixels` in place and don't cause panel re-renders — unchanged from M6.
- **`docs/COMPOUND.md` M6 §Gotchas — variant toggle clears undo stack.** The flagged M7 Unit 0 chore: if user paints, then variant-toggles, then undoes, the undo stack replays onto the reseeded layer and pixel bytes don't match. M7 Unit 0 adds an explicit `undoStack.clear()` on USER-INITIATED variant toggle, while apply-template's variant change does NOT clear the stack (atomic layers-and-variant swap makes this safe).
- **`docs/COMPOUND.md` M3 §Invariants — narrow-selector.** TemplateGate must subscribe narrowly or it re-renders on every stroke commit. Read `hasEditedSinceTemplate` + the gate's internal state only.
- **`docs/COMPOUND.md` M4 §Gotchas — hydration race overwriting live strokes.** M7's hydration path restores `hasEditedSinceTemplate` + `lastAppliedTemplateId` alongside layers — same hydrationPending gate (M4 Unit 0) applies; TemplateGate checks `hydrationPending` before starting its 3500ms timer.

### External references

- **DESIGN.md §5.1** — canonical template catalog (10 entries + category mapping).
- **DESIGN.md §5.2** — canonical `manifest.json` schema.
- **DESIGN.md §5.3** — canonical Ghost Templates state machine.
- **DESIGN.md §5.4** — canonical post-apply timeline (0/200/500/700/1000/2000ms).
- **DESIGN.md §12.5 M7** — milestone acceptance criteria.
- **Microsoft minecraft-samples** (https://github.com/microsoft/minecraft-samples) — `blank-better.png` source per DESIGN §5.1. License: MIT with attribution.
- **MDN `createImageBitmap`** — the canonical browser PNG decode path. Returns a `Promise<ImageBitmap>` usable as a `drawImage` source. Supported in all target browsers.
- **WHATWG HTML §4.12.5.1.14 (reaffirmed from M6)** — 2D canvas draw is the correct path for compositing template pixels onto the TM. `putImageData` bypasses alpha/blend (M6 D1) and doesn't apply here anyway; apply-template writes pixels DIRECTLY to the new Layer's `Uint8ClampedArray`, then `TextureManager.composite([newLayer])` runs through the M6 drawImage path.
- **WAI-ARIA dialog pattern** (https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/) — bottom sheet ARIA shape: `role="dialog"` + `aria-modal="true"` + `aria-labelledby` on the title. Focus-trap for keyboard users; Esc-to-close.

## Key technical decisions

### D1 — apply-template is an undoable Command, not a confirm-dialog gate

**Decision:** Apply-template pushes `{ kind: 'apply-template', before, after }` to the existing M6 UndoStack. `before` / `after` are snapshots of `{ layers, activeLayerId, variant, hasEditedSinceTemplate, lastAppliedTemplateId }`. No confirm dialog.

**Rationale:** DESIGN §5.4 explicitly says "Editable immediately — no lock, no confirmation." Matching this spec + the M6 D3 precedent (layer-delete is undoable, not confirm-dialogged) gives the user the 2026-expected "accidental clicks are recoverable" safety net. Confirm dialogs add friction on the first-run happy path and are the exact kind of UX-killer the Ghost picker is designed to avoid.

**Memory cost:** one `apply-template` command = `sum(before.layers[].pixels.byteLength) + sum(after.layers[].pixels.byteLength)`. For a 1-layer prior + 1-layer template after: 2 × 16 KB = 32 KB. For a 5-layer prior + 1-layer template: 6 × 16 KB = 96 KB. Under M6's 5 MB budget. If a user spams apply-template 100 times, byte-cap evicts the oldest first — count-cap is secondary.

**Alternative rejected:** confirm-dialog when `hasEditedSinceTemplate === true`. Adds a modal in the common first-run path (where the user hasn't edited) and contradicts DESIGN §5.4. Rejected.

### D2 — Placeholder seed decoupled from TM lifecycle effect (M6 gotcha fix)

**Decision:** `use-texture-manager` gets two effects instead of one:

- **Effect A (TM lifecycle, dep: `[variant]`):** dispose old TM → build new TM → composite current store `layers` → set bundle. Does NOT seed placeholder.
- **Effect B (placeholder seed, dep: `[bundle, layers.length === 0]`):** when `bundle !== null && layers.length === 0`, seed a fresh placeholder layer for the current variant via `setLayers([buildInitialLayer(variant)])`.

`setVariant(next)` store action (user toggle path) clears `layers: []` BEFORE flipping `variant: next`, which re-triggers Effect A (new TM) + Effect B (placeholder seed for new variant). Undo stack is explicitly cleared via a new `clearUndoStack` callback injected into `setVariant` consumers (EditorLayout) since setVariant can't reach the undoStack ref directly.

`applyTemplate` orchestrator sets `layers: [templateLayer]` + `variant: templateVariant` + ... in ONE store microtask via `applyTemplateState(snapshot)`. Effect A sees variant change, disposes old TM, builds new one, composites the already-present template layer. Effect B sees `layers.length > 0`, skips placeholder seed. Undo stack is NOT cleared.

**Rationale:** this is the M6 COMPOUND-flagged Unit 0 chore made concrete. Cleanly separates "seed" from "TM lifecycle" and matches the M6 invariant that "seed placeholder only when layers is empty." Any future feature that populates layers from outside (file import, clipboard paste, network sync) gets the same "no reseed if layers are present" behavior for free.

**Gotcha:** a bug in the setVariant sequencing — flipping variant before clearing layers would trigger Effect A with the OLD layer pixels still in the store, producing a one-frame flash of the prior skin painted on the new variant's UV layout. Unit 0 test scenarios cover the order.

### D3 — manifest.json is static, fetched once with `cache: 'force-cache'`

**Decision:** `loadManifest()` calls `fetch('/templates/manifest.json', { cache: 'force-cache' })` once per session. Parsed and validated into a typed `TemplateManifest`. Invalid manifest triggers a logged warning + empty catalog (fail-soft: Ghost picker shows an "empty catalog" state rather than crashing the editor).

**Rationale:** the manifest is a static `public/` asset. Browser caching handles freshness. The catalog is locked at 10 entries per DESIGN §5.1 — a modification requires a redeploy, which invalidates browser cache naturally. No need for service worker, ETags, or revalidation logic.

**Validation shape:** zod is not available (no dependencies); write a hand-rolled validator. Each category needs `id`, `label`, `templates: TemplateMeta[]`. Each template needs `id`, `label`, `variant ∈ {'classic','slim'}`, `file: string`, `thumbnail: string`, `license: 'MIT'`, `credit: string | null`, `tags: string[]`, `contextualHint: string`, `affordancePulse: 'color' | 'mirror' | 'brush' | null`. Unknown keys are stripped silently; missing required keys skip the template.

### D4 — PNG decode via `createImageBitmap` → `OffscreenCanvas` → `getImageData`

**Decision:** `decodeTemplatePng(url)`:

1. If cached (module-scope Map), return the cached `Uint8ClampedArray`.
2. `fetch(url)` → `response.blob()`.
3. `createImageBitmap(blob)` → 64×64 `ImageBitmap`.
4. Reuse the module-scoped scratch `OffscreenCanvas(64, 64)` from `texture.ts` (M6 D1 scratch canvas) — OR create a dedicated decode scratch if reuse creates a race (probably does: composite runs at stroke-end; decode runs at apply-template. Dedicated.)
5. `ctx.clearRect` + `ctx.drawImage(bitmap, 0, 0)` + `ctx.getImageData(0, 0, 64, 64).data` → `Uint8ClampedArray`.
6. Validate length === 16384. Mismatch throws; caller falls back to placeholder.
7. Cache by URL + return.

**Rationale:** `createImageBitmap` is the canonical browser PNG→bitmap path and matches M2's approach. The module-scope cache means a user opening the bottom sheet 3 times, selecting a template, undoing, reselecting the same template, only decodes once. For 10 templates × 16 KB = 160 KB cache ceiling; negligible.

**jsdom caveat:** jsdom 27 has limited `createImageBitmap` support (returns a rough mock). Decode tests use a fixture PNG + `vi.stubGlobal('createImageBitmap', stub)` that returns a mock bitmap. Real decode correctness is manual-QA (visible on `npm run dev` — a mis-decoded template would render obviously wrong).

### D5 — Ghost picker state lives in TemplateGate component, not the store

**Decision:** The Ghost state machine (`idle | suggestion_chip | bottom_sheet | dismissed`) is component-local via `useState`. Only the OUTCOME of the state machine that other components need — `activeContextualHint`, `pulseTarget`, `lastAppliedTemplateId`, `hasEditedSinceTemplate` — lives in the store.

**Rationale:** the state machine is confined to one component; no other component needs to observe intermediate states. Keeping it local avoids polluting the store with UI-ephemeral slots. This also matches M6's convention: "session-ephemeral UI state" like hover position lives in refs, not the store.

**Persistence boundary:** `templates-dismissed` is the only state that persists across sessions; it goes to `localStorage` (not IDB — it's a single boolean and localStorage is synchronous-read-on-mount, which fits the gate's decision-on-mount). `hasEditedSinceTemplate` + `lastAppliedTemplateId` are session-spanning semantic state and live in the store + persist to IDB alongside the document.

### D6 — First-stroke detection via existing `handleStrokeCommit` callback

**Decision:** `EditorLayout.handleStrokeCommit(stroke)` already fires on every pencil/eraser/bucket strokeEnd (M6 Unit 4). M7 extends it:

```
handleStrokeCommit(stroke):
  undoStack.push({ kind: 'stroke', stroke })
  store.markEdited()   // idempotent: false → true only
```

TemplateGate subscribes narrowly to `hasEditedSinceTemplate`. The chip's "first stroke detected" trigger reads directly from this slot — when it flips false→true, the gate advances from `idle` to `suggestion_chip` (if still in idle).

**Rationale:** rides the M6 dispatcher-chokepoint invariant. Zero new event plumbing. The `markEdited()` action is identity-guarded — subsequent strokes after the first one no-op. Narrow-selector contract: TemplateGate re-renders once (false→true) per apply-template cycle.

**Alternative rejected:** a dedicated `onFirstStroke` event + PubSub. Adds plumbing for zero benefit since the store slot already flows through zustand's reactive system.

### D7 — Template asset count: 10 entries spanning 10 unique files

**Decision:** Ship 10 templates matching DESIGN §5.1 exactly. `blank-better` is listed with variant `both` in DESIGN but the manifest schema requires a single variant per template. Implement as TWO manifest entries: `blank-better-classic` (variant: classic) and `blank-better-slim` (variant: slim), both labeled "Blank but Better" and both tagged `base`. UI presentation: the Base category shows whichever matches the current session variant first; both are selectable.

Total files: 7 classic PNGs + 3 slim PNGs + 10 WebP thumbnails + 1 manifest.json.

**Rationale:** manifest-clean (one variant per entry) + user-facing-clean (both variants look like "Blank but Better"). Alternative (a single entry with `variant: 'both'` + runtime logic to pick pixels) adds schema complexity + a runtime conditional that's only exercised for this one template. Not worth it.

**Gotcha for the art handoff:** the original DESIGN §5.1 uses the phrase "variant: both" for `blank-better`. The manifest schema inherited from §5.2 only accepts `classic | slim` per template. The plan reconciles this mismatch via two manifest entries; DESIGN §5 can be clarified in Unit 0's DESIGN amendment.

### D8 — Contextual hint + affordance pulse driven by store, not refs

**Decision:** `apply-template` orchestrator sets `activeContextualHint: string` at T+700ms (via `setTimeout`) and `pulseTarget: 'color' | 'mirror' | 'brush' | null` at T+1000ms (via another `setTimeout`). Auto-clear timers: hint clears at T+700+3000ms OR on any editor pointerdown (listener installed at mount); pulse clears at T+1000+600ms (matches CSS keyframe duration).

ContextualHintOverlay subscribes to `activeContextualHint`; renders when non-null. AffordancePulse reads `pulseTarget`; applies `data-pulse="true"` to the DOM element with the matching `data-pulse-target` attribute for 600ms.

**Rationale:** store-driven is testable (mock timers in tests, assert store state transitions) and survives component unmount/remount. Ref-driven would couple the hint/pulse lifecycle to the ContextualHintOverlay's render path, making reload-mid-transition states awkward (see R9).

**Timer cleanup:** if the user navigates away OR triggers another apply-template before the timers fire, the existing timers are canceled via a module-scope handle. Implemented in `applyTemplate` orchestrator: `const timers = { hint: 0, pulse: 0, hintClear: 0 }`; module-level `cancelActiveTransition()` clears all four timers. Called at the top of every `applyTemplate` call.

### D9 — 0ms-edit guardrail is state-only in M7; dialog ships in M8

**Decision:** M7 exposes `hasEditedSinceTemplate: boolean` as the source of truth for the guardrail. M8's export handler will read this value: if `false` AND `lastAppliedTemplateId !== null` (i.e., the user opened a template and hasn't painted), show the "Edit first / Export anyway" soft-friction dialog before running the PNG export.

M7 ships NO dialog. There's no export UI yet for it to attach to. A placeholder test in `tests/apply-template.test.ts` verifies the flag's correctness for M8 to consume.

**Rationale:** M7's scope statement mentions the guardrail; DESIGN §5.4 lists it at T+2000ms+ "if export attempted." Export doesn't exist in M7, so the dialog has nothing to attach to. Building the dialog now + stubbing a trigger would be premature abstraction.

**M8 integration note:** add a single paragraph to DESIGN §5.4 clarifying that the guardrail triggers from the export action, not from a timer. M8 will connect `ExportDialog.tsx` to `useEditorStore.getState().hasEditedSinceTemplate` and `lastAppliedTemplateId`.

### D10 — Bottom sheet dismiss semantics: × vs backdrop vs Esc

**Decision:** Three dismiss paths with distinct behaviors:

| Path | Persists `templates-dismissed`? | Fires from Ghost flow? |
|---|---|---|
| Sheet × button | Yes (when opened from Ghost flow) | Yes |
| Chip × button | Yes | Yes |
| Backdrop click (outside sheet) | No | Either |
| Esc key | No | Either |
| Menu-button-opened sheet's × | No | No (menu-initiated) |
| Template selected (auto-close) | Yes (when opened from Ghost flow) | Yes |

**Rationale:** explicit dismissal (×) persists; inadvertent dismissal (backdrop, Esc) doesn't. Matches the modern modal pattern and protects first-run for shared devices. Menu-opened sheet is an explicit re-entry by the user — dismissal there is never a permanent opt-out. The sheet knows its own open-source via a `source: 'ghost' | 'menu'` prop threaded from TemplateGate / TemplateMenuButton.

## Open questions

### Resolved during planning

- **Q: Does apply-template clear undo stack or push an undo command?** A: Push. See D1.
- **Q: How do we prevent variant switch during apply-template from reseeding placeholder?** A: Decouple seed from TM lifecycle. See D2.
- **Q: Is the manifest fetched once or polled?** A: Once per session with browser cache. See D3.
- **Q: How do we decode PNG bytes to RGBA?** A: `createImageBitmap` → dedicated scratch canvas → `getImageData`. See D4.
- **Q: Does the Ghost state live in the store or component?** A: Component-local for machine state; store for semantic outputs. See D5.
- **Q: How do we detect first stroke?** A: Ride the M6 `handleStrokeCommit` callback. See D6.
- **Q: Template count for `blank-better` across variants?** A: Two manifest entries, both labeled "Blank but Better". See D7.
- **Q: Does the 0ms guardrail ship a dialog in M7?** A: No; state only. Dialog lands in M8. See D9.
- **Q: What dismissal paths persist `templates-dismissed`?** A: Explicit × only; backdrop + Esc don't. See D10.
- **Q: Is `templates-dismissed` stored in IDB or localStorage?** A: localStorage. Primitive, synchronous-read, no cross-device sync needed.
- **Q: What happens when IDB has a prior doc AND a template apply mid-session gets interrupted by close-tab?** A: The apply-template's `applyTemplateState(snapshot)` store write triggers the existing persistence debounce. If the tab closes during the 500ms debounce, the M3 `beforeunload` best-effort flush applies (with documented caveats from M3). Worst case: reload shows the prior document + prior hint/pulse state. Acceptable.
- **Q: What if a template PNG file is missing / 404s?** A: Template card shows an error placeholder (a diagonal-hatched thumbnail + "Unavailable" label). Selecting it is a no-op. Logged as a warning; no user-facing toast.
- **Q: Does apply-template preserve the user's activeColor / recentSwatches?** A: Yes. Only layers/variant/activeLayerId/hasEdited/lastApplied swap. Tool state, brush size, active color are session state and don't belong in the apply-template snapshot.
- **Q: What does apply-template do to `mirrorEnabled`?** A: Leaves it alone. The modifier is a user preference, not document state.

### Deferred to implementation

- **Exact timer constants in a single module.** `CHIP_DELAY_MS = 3500`, `HINT_DELAY_MS = 700`, `HINT_DURATION_MS = 3000`, `PULSE_DELAY_MS = 1000`, `PULSE_DURATION_MS = 600`, `CROSSFADE_MS = 200`. Live in `lib/editor/templates.ts` so tests can import them. Unit 5 finalizes.
- **Exact chip/sheet typography + colors.** Unit 5/6 design-time decisions. Anchor to the existing `ui-surface` + `accent` tokens in `app/globals.css`.
- **Bottom sheet scroll snap.** CSS `scroll-snap-type: x mandatory` on the scroll container + `scroll-snap-align: start` on each card feels right for 3-visible-at-a-time. Tune during Unit 6.
- **Thumbnail source rendering.** Offline process; thumbs committed to `public/templates/thumbs/` alongside the PNGs. Not an in-app code path.
- **Exact `data-pulse-target` attribute placement.** Add to the relevant `<ColorPicker />` root + `<Toolbar />` root + mirror toggle button. Unit 7 decides the ring color (likely `accent`) and ring-width.
- **Where the TemplateMenuButton sits in the sidebar.** Top (above Toolbar) is the natural spot. Unit 6 calibrates.
- **Whether the 3D Y-rotation pulse is +0.1 rad fixed or variant-proportional.** Unit 7 tune. DESIGN §5.4 specifies +0.1 rad; following the spec exactly.
- **Esc-to-close focus target after dismiss.** Focus returns to the chip (if it's still present) or the canvas. Unit 5 decides.

## High-level technical design

### Apply-template state flow

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

```
User clicks template in bottom sheet
├─ TemplateBottomSheet.onSelect(template)
│   └─ EditorLayout.handleApplyTemplate(template, pixels):
│       ├─ cancelActiveTransition()    // clear any in-flight hint/pulse timers
│       ├─ before = {                   // snapshot CURRENT state
│       │     layers:          store.layers.map(deepClone),
│       │     activeLayerId:   store.activeLayerId,
│       │     variant:         store.variant,
│       │     hasEditedSinceTemplate: store.hasEditedSinceTemplate,
│       │     lastAppliedTemplateId:   store.lastAppliedTemplateId,
│       │   }
│       ├─ templateLayer = {
│       │     id:        `template:${template.id}`,
│       │     name:      template.label,
│       │     pixels:    pixels,        // already-decoded 64×64 RGBA
│       │     opacity:   1,
│       │     blendMode: 'normal',
│       │     visible:   true,
│       │   }
│       ├─ after = {
│       │     layers:          [templateLayer],
│       │     activeLayerId:   templateLayer.id,
│       │     variant:         template.variant,
│       │     hasEditedSinceTemplate: false,
│       │     lastAppliedTemplateId:   template.id,
│       │   }
│       ├─ undoStack.push({ kind: 'apply-template', before, after })
│       ├─ store.applyTemplateState(after)        // atomic one-microtask swap
│       │   └─ (use-texture-manager Effect A fires: new TM + composite template)
│       │   └─ (use-texture-manager Effect B skips: layers.length > 0)
│       ├─ bumpTexFadeKey()                        // triggers 200ms CSS crossfade
│       ├─ bumpYRotationPulseKey()                 // triggers PlayerModel Y-lerp
│       ├─ setTimeout(+700ms, () => store.setActiveContextualHint(template.contextualHint))
│       ├─ setTimeout(+1000ms, () => store.setPulseTarget(template.affordancePulse))
│       ├─ setTimeout(+3700ms, () => store.clearContextualHint())
│       └─ setTimeout(+1600ms, () => store.setPulseTarget(null))
└─ sheet auto-dismisses; if opened from Ghost flow, persist templates-dismissed
```

### Ghost picker state machine

```
                          [templates-dismissed = true]
                        OR [hasEditedSinceTemplate = true at mount]
                                │
                                ▼
                         ─────────────
                           dismissed
                         ─────────────
                            (noop)

  mount, neither opt-out flag set
                ▼
        ─────────────
             idle     ───────(user clicks ×)───────→ dismissed (persist)
        ─────────────       (clear timer)
             │
    (3500ms timer fires OR hasEditedSinceTemplate flips false→true)
             ▼
   ───────────────────
    suggestion_chip    ───(× button)───→ dismissed (persist)
   ───────────────────
             │
     (chip click)
             ▼
   ───────────────────
     bottom_sheet      ──(template select)──→ dismissed (persist)
   ───────────────────  ──(× button or close btn)──→ dismissed (persist)
                        ──(backdrop or Esc)──→ idle / suggestion_chip (no persist)
```

### Undo command round-trip

```
undo() on { kind: 'apply-template', before, after }:
  → actions.applyTemplateSnapshot(before)
    → store.applyTemplateState(before)
    → (TM re-composites via Effect A, see D2)
    → (bumpTexFadeKey triggers crossfade back to prior texture)
    → actions.recomposite()

redo() on the same command:
  → actions.applyTemplateSnapshot(after)
    → ... (same as the original apply, sans the new-command push)
```

**INVARIANT:** apply → undo → redo → undo is bit-identical to the starting state. Tested in `tests/apply-template.test.ts` with a sequence including variant switches.

## Implementation Units

- [ ] **Unit 0: M6 carry-forward chores + DESIGN amendments**

**Goal:** Resolve the M6 gotcha that variant-toggle clears the undo stack. Decouple placeholder seed from TM lifecycle. Amend DESIGN.md §5 to reconcile the `variant: 'both'` inconsistency (D7) and §5.4 to clarify the guardrail trigger point (D9).

**Requirements:** R12, R13.

**Dependencies:** None (chore-first).

**Files:**

- Modify: `lib/editor/use-texture-manager.ts` — split into two effects per D2. Rename `buildInitialLayer` to `buildPlaceholderLayer` for clarity.
- Modify: `lib/editor/store.ts` — `setVariant` action: clear `layers: []` BEFORE flipping `variant`. Add an optional `onVariantChanged` callback param for undo-stack-clear injection (wired by EditorLayout).
- Modify: `app/editor/_components/EditorLayout.tsx` — pass `undoStackRef.current?.clear()` as the `onVariantChanged` callback to the VariantToggle consumer (via a thin wrapper action since store actions can't reach the ref directly — either a zustand subscription, or a wrapper action in EditorLayout that calls `setVariant` + `clear`).
- Modify: `docs/DESIGN.md` — §5.1 footnote clarifying `blank-better` ships as two manifest entries (classic + slim); §5.4 clarifying the guardrail triggers on export action (M8), not a timer.
- Modify: `lib/three/placeholder-skin.ts` — rewrite the TODO comment (kept as dev fallback; superseded by `blank-better.png` for production first-open).

**Approach:** Pure mechanical refactor + DESIGN doc edits. Test-first for the variant-toggle undo-stack-clear behavior (new test: paint a stroke, toggle variant, undo is a no-op on the new variant's placeholder). Test-first for the "layers present → skip placeholder seed" path (new test: pre-populate layers in the store, mount the hook, assert no reseed).

**Patterns to follow:** M4 Unit 0 precedent — prerequisite fixes before new feature work. Two-effect split follows React idiomatic "one concern per effect."

**Test scenarios:**

- Happy path: fresh mount with empty layers → Effect A builds TM, Effect B seeds placeholder for variant. Assert `layers.length === 1` after one microtask.
- Happy path: user variant toggle (layers non-empty) → `setVariant` clears layers → Effect A rebuilds TM → Effect B seeds new placeholder for new variant. Undo stack cleared. Assert undoStack.canUndo() === false after toggle.
- Happy path (apply-template path, tested in Unit 4): layers pre-populated → variant flip → Effect A sees new variant + populated layers, composites template. Effect B skips seed.
- Edge: double variant-toggle (classic→slim→classic) — each toggle clears undo + reseeds; no stale state.
- Edge: variant toggle with `hydrationPending = true` should not seed placeholder over a pending IDB restore. Verify by setting `hydrationPending` then toggling; assert no placeholder seed fired until hydration resolves.
- Regression: all 349 M6 tests still pass.

**Verification:** 4–6 new tests pass. M6's 349 tests all pass. DESIGN.md §5.1 + §5.4 amendments committed.

- [ ] **Unit 1: Types + store slots + manifest contracts**

**Goal:** Extend `types.ts` with template types + persistence fields; add the four new store slots; add the `apply-template` command shape to `undo.ts` (no apply/revert logic yet — Unit 4).

**Requirements:** R1, R7, R8, R9.

**Dependencies:** Unit 0.

**Files:**

- Modify: `lib/editor/types.ts` — add `TemplateManifest`, `TemplateCategory`, `TemplateMeta`, `AffordancePulseTarget` types; extend `SkinDocument` with optional `hasEditedSinceTemplate` + `lastAppliedTemplateId`.
- Modify: `lib/editor/store.ts` — new slots: `hasEditedSinceTemplate: boolean` (default false), `lastAppliedTemplateId: string | null` (default null), `activeContextualHint: string | null` (default null), `pulseTarget: AffordancePulseTarget` (default null). New actions: `markEdited()`, `setActiveContextualHint(hint)`, `clearContextualHint()`, `setPulseTarget(target)`, `applyTemplateState(snapshot)`. Each setter identity-guarded per M3 convention.
- Modify: `lib/editor/undo.ts` — Command union extended with `{ kind: 'apply-template', before: ApplyTemplateSnapshot, after: ApplyTemplateSnapshot }` type only; `size()` case for apply-template computed from sum of layer byte lengths; `EditorActions` interface extended with `applyTemplateSnapshot(snapshot)`. Apply/revert route through this method — implemented in Unit 4.
- Create: `tests/template-store.test.ts` — store action semantics + narrow-selector guards.

**Approach:** Additive store extensions. Type-only for the `apply-template` command (actual dispatch logic in Unit 4). Test-first for each setter's identity guard.

**Execution note:** Test-first. Store slot semantics + identity-guard contracts are the foundation everything else rides on.

**Patterns to follow:** M6 `tests/layer-store.test.ts` structure.

**Test scenarios:**

- Happy path: `markEdited()` flips false→true on first call; subsequent calls are no-ops (same state object returned).
- Happy path: `setActiveContextualHint('foo')` then `clearContextualHint()` sequence; assert exactly 2 store mutations.
- Happy path: `setPulseTarget('color')` then `setPulseTarget(null)` round-trip.
- Happy path: `applyTemplateState({ layers: [...], activeLayerId, variant, hasEdited, lastApplied })` swaps all 5 slots in one microtask (assert a single subscription callback sees the final state).
- Edge: `setActiveContextualHint(same string)` is a no-op (identity-guarded).
- Edge: `applyTemplateState` with empty layers array is rejected (defensive — templates always provide at least one layer).
- Narrow-selector: TemplateGate-shaped subscription to `hasEditedSinceTemplate` doesn't re-render when unrelated slots mutate.
- Type check: `TemplateMeta['affordancePulse']` narrows to `'color' | 'mirror' | 'brush' | null`.

**Verification:** 10–12 new tests. `npx tsc --noEmit` clean.

- [ ] **Unit 2: Manifest loader + PNG decode**

**Goal:** Pure loader module that fetches the manifest, validates shape, and decodes template PNGs to `Uint8ClampedArray`. Testable without any UI.

**Requirements:** R1, R15.

**Dependencies:** Unit 1.

**Files:**

- Create: `lib/editor/templates.ts` — `loadManifest(): Promise<TemplateManifest>`, `decodeTemplatePng(url): Promise<Uint8ClampedArray>`, `isValidTemplate(raw: unknown): raw is TemplateMeta` predicate, timing constants (CHIP_DELAY_MS etc.), module-scope decode cache (`Map<string, Uint8ClampedArray>`).
- Create: `tests/templates-manifest.test.ts` — shape validation.
- Create: `tests/templates-decode.test.ts` — decode + cache.
- Create: `tests/fixtures/valid-manifest.json` — fixture.
- Create: `tests/fixtures/valid-64x64.png` — fixture 64×64 PNG. Generate offline via a one-shot script; commit the file.

**Approach:** Hand-rolled validator (no zod). `fetch` is stubbed in tests via `vi.stubGlobal`. `createImageBitmap` is stubbed in tests via `vi.stubGlobal` returning a mock bitmap with known pixel data.

**Execution note:** Test-first for validator. Shape rejection scenarios are numerous and easy to miss one.

**Patterns to follow:** Pure-module shape of `lib/editor/island-map.ts` (M3). No React; no DOM side effects at import time.

**Test scenarios:**

- Validator happy: fixture manifest parses cleanly; all 10 templates are present.
- Validator edge: missing `variant` on a template → template skipped; warning logged; parse succeeds.
- Validator edge: invalid `affordancePulse` value ('invalid-target') → falls back to `null` with a warning; template kept.
- Validator edge: category with zero templates is dropped (empty categories shouldn't reach the UI).
- Validator edge: unknown top-level keys ignored silently.
- Validator error: `manifest.version !== 1` → error thrown; caller catches + logs.
- Decode happy: fixture 64×64 PNG decodes to a 16384-byte `Uint8ClampedArray`.
- Decode cache hit: same URL called twice → `fetch` called once (spy); second call returns cached buffer instance.
- Decode error: non-64×64 PNG (stub a 32×32 bitmap) → throws with dimension mismatch error.
- Decode error: fetch 404 → throws; caller handles.
- Fetch cache: `cache: 'force-cache'` header asserted via fetch spy.

**Verification:** 12+ new tests. Zero production bundle cost beyond the 200-ish LOC in `templates.ts`.

- [ ] **Unit 3: Template assets + manifest.json**

**Goal:** Ship the 10 template PNGs + thumbnails + manifest.json under `public/templates/`.

**Requirements:** R1.

**Dependencies:** Unit 2 (validator exists before assets land so CI can verify the manifest's shape).

**Files:**

- Create: `public/templates/manifest.json` — full catalog per DESIGN §5.2 × 10 entries.
- Create: `public/templates/classic/classic-hoodie.png`, `gamer-tee.png`, `split-color.png`, `shaded-hoodie.png`, `armor-lite.png`, `sports-jersey.png`, `blank-better.png`.
- Create: `public/templates/slim/minimal-black.png`, `cartoon-face.png`, `hoodie-headphones.png`, `blank-better.png`.
- Create: `public/templates/thumbs/classic-hoodie.webp`, etc (10 files).
- Modify: `public/.gitattributes` — ensure `*.png` and `*.webp` marked as binary (standard git LFS-free setup; no LFS required at these sizes).
- Modify: `tests/templates-manifest.test.ts` — add integration test: fetch the real `public/templates/manifest.json` (via node's `fs.readFile` since vitest runs in jsdom without a real server) and validate; assert all 10 file paths resolve to existing files.

**Approach:** Asset authoring is an out-of-band task (pixel art). The plan acknowledges this; the PNGs are committed by the milestone author. For development flexibility, a fallback path in Unit 2's `loadManifest` treats a missing manifest as an empty catalog — the editor still functions, the chip just never shows.

**Execution note:** This is the one unit that depends on design output (pixel art). If art is blocked, Unit 4+ can still land using fixture templates (pink-and-green checkerboard, etc.) in a throwaway branch; the real assets slot in before merge.

**Patterns to follow:** `public/` is a Next.js static serving root. No bundler involvement. Git-commit the PNGs directly (they're tiny — 64×64 RGBA PNG averages ~500 bytes; 10 templates = ~5 KB total). WebP thumbnails at 256×256 average ~8 KB; 10 thumbs = ~80 KB. Total repo size delta: ~100 KB.

**Test scenarios:**

- Integration: all 10 manifest `file` URLs resolve to existing files on disk.
- Integration: all 10 `thumbnail` URLs resolve to existing files on disk.
- Integration: each PNG file is exactly 64×64 (read via node PNG decode helper; a 2-line script using `zlib` + PNG header parse).
- Regression: manifest validator passes on the shipped manifest.

**Verification:** 4 new integration tests. Bundle unchanged (assets are in `public/`, not bundled).

- [ ] **Unit 4: apply-template orchestrator + undo integration**

**Goal:** `applyTemplate()` orchestrator that pushes the undo command, swaps store state atomically, and triggers the post-apply timeline. `undo.ts` gains the apply/revert logic for `apply-template` commands.

**Requirements:** R4, R5 (state flips only — UI in Units 5–7), R6, R7 (first-stroke hook), R9.

**Dependencies:** Units 0, 1, 2.

**Files:**

- Create: `lib/editor/apply-template.ts` — `applyTemplate(actions, template, pixels, timing?): void` orchestrator. Exports `cancelActiveTransition()` for cleanup. Pure module — no React.
- Modify: `lib/editor/undo.ts` — implement apply/revert for `apply-template` Command kind. Size accounting: `sum(before.layers[].pixels) + sum(after.layers[].pixels) + ~64 bytes metadata`.
- Modify: `app/editor/_components/EditorLayout.tsx` — extend `EditorActions` with `applyTemplateSnapshot(snapshot)` (calls `useEditorStore.getState().applyTemplateState(snapshot)` + `markDirtyRef.current()`); pass an `onApplyTemplate(template, pixels)` callback to TemplateGate (Unit 5). Extend `handleStrokeCommit` with `useEditorStore.getState().markEdited()` per D6.
- Create: `tests/apply-template.test.ts` — orchestrator + undo round-trip.
- Modify: `tests/undo.test.ts` — add apply-template command scenarios (byte accounting, round-trip, eviction).

**Approach:** Orchestrator is pure (takes actions + template + pixels); side effects are via `EditorActions` methods. Timing (`setTimeout` calls for hint/pulse) is optional to keep tests deterministic — tests pass `timing: { useRealTimers: false }` and advance vitest fake timers manually.

**Execution note:** Test-first. Undo round-trip for apply-template is the load-bearing correctness guarantee.

**Patterns to follow:** M6's `EditorActions` adapter pattern. Pure orchestrator modules keyed on the adapter.

**Test scenarios:**

- Happy path: `applyTemplate(actions, template, pixels)` pushes one undo command; store `layers/activeLayerId/variant/hasEditedSinceTemplate/lastAppliedTemplateId` match the template's after-state.
- Happy path: Cmd+Z on that command restores prior `layers/activeLayerId/variant/hasEditedSinceTemplate/lastAppliedTemplateId` exactly.
- Happy path: Cmd+Shift+Z reapplies identically.
- Happy path: apply-template with different variant (classic layer → slim template) flips variant in `after`; undo restores classic.
- Happy path: `markEdited()` fires on first strokeCommit after apply-template; subsequent strokes don't re-fire store mutations.
- Edge: apply-template while another apply-template's timers are in flight → `cancelActiveTransition()` clears old timers; only new timers fire.
- Edge: byte accounting for apply-template is correct — a 3-layer-before + 1-layer-after is ~64 KB per command; 80 such commands triggers eviction under the 5 MB cap.
- Edge: undo of apply-template clears `activeContextualHint` + `pulseTarget` (prior state had them null; current state might have them set if timer fired before undo).
- Edge: redo past a deleted-layer has always-returning-true semantics for apply-template (the before/after snapshots are whole-document; no dangling layer-id references).
- Edge: `applyTemplate` on a document with `hydrationPending = true` rejects or defers. Decision: rejects with a warning — templates shouldn't apply over a pending hydration race.
- Integration: timers fire at 700ms + 1000ms with vitest fake timers; store slots flip; clear timers fire at +3700ms + +1600ms.

**Verification:** 12+ new tests. M6 undo suite + new apply-template scenarios all pass. Narrow-selector guard: TemplateGate's mock subscription doesn't re-render on stroke commits.

- [ ] **Unit 5: TemplateGate state machine + suggestion chip**

**Goal:** The floating chip UI + the Ghost state machine. Reads localStorage + hasEditedSinceTemplate on mount; listens for 3500ms timer + first-stroke flip.

**Requirements:** R2, R10, R11.

**Dependencies:** Units 1, 4.

**Files:**

- Create: `app/editor/_components/TemplateGate.tsx` — the state machine + chip render + sheet open. Reads `templates-dismissed` from localStorage, `hasEditedSinceTemplate` + `hydrationPending` from store. Owns the 3500ms `setTimeout`.
- Create: `app/editor/_components/TemplateSuggestionChip.tsx` — the floating chip UI. Props: `onOpen`, `onDismiss`, `anchor?` (positioning hint).
- Create: `lib/editor/template-gate-state.ts` — pure reducer for testability: `initial(dismissed, hasEdited): GateState`, `next(state, event): GateState`. Events: `MOUNTED`, `HYDRATION_SETTLED`, `TIMER_ELAPSED`, `FIRST_STROKE`, `CHIP_CLICKED`, `CHIP_DISMISSED`, `SHEET_OPENED_FROM_MENU`, `SHEET_DISMISSED_PERSISTENT`, `SHEET_DISMISSED_TRANSIENT`, `TEMPLATE_SELECTED`.
- Modify: `app/editor/_components/EditorLayout.tsx` — render `<TemplateGate onApplyTemplate={handleApplyTemplate} />` as a sibling to the existing panes (positioned via CSS absolute overlay).
- Create: `tests/template-gate-state.test.ts` — pure reducer tests.
- Create: `tests/template-gate.test.ts` — jsdom component + fake timers.

**Approach:** Pure reducer for the machine → trivial unit-testability. Component owns the timer `useRef` + event dispatch. localStorage access behind a thin wrapper (`readDismissed()`, `writeDismissed()`) so tests can stub.

**Execution note:** Test-first for the reducer. Event sequencing is easy to botch.

**Patterns to follow:** M3 `tests/color-picker-selectors.test.ts` narrow-selector guard; M4 `tests/hover-store.test.ts` event-sequencing shape.

**Test scenarios (reducer):**

- Happy path: `initial(dismissed=false, hasEdited=false)` → `idle`. `next(idle, TIMER_ELAPSED)` → `suggestion_chip`. `next(suggestion_chip, CHIP_CLICKED)` → `bottom_sheet`.
- Happy path: `next(bottom_sheet, TEMPLATE_SELECTED)` → `dismissed` (persistent flag set).
- Happy path: `next(bottom_sheet, SHEET_DISMISSED_TRANSIENT)` → goes back to `suggestion_chip`, not `dismissed`.
- Happy path: `next(bottom_sheet, SHEET_DISMISSED_PERSISTENT)` → `dismissed`.
- Edge: `initial(dismissed=true, ...)` → `dismissed` immediately.
- Edge: `initial(dismissed=false, hasEdited=true)` → `dismissed` immediately.
- Edge: `next(idle, FIRST_STROKE)` → `suggestion_chip` (chip appears on first stroke even if timer hasn't fired).
- Edge: `next(suggestion_chip, FIRST_STROKE)` → stays `suggestion_chip` (already shown).
- Edge: `next(dismissed, any_event)` → stays `dismissed` (terminal state).
- Edge: menu-opened sheet event (`SHEET_OPENED_FROM_MENU`) → `bottom_sheet` with `source: 'menu'`; subsequent `SHEET_DISMISSED_PERSISTENT` from a menu-source sheet should be silent-skip for localStorage (or route through a different event per D10).

**Test scenarios (component, jsdom):**

- Happy path: mount with `dismissed=false, hasEdited=false`; advance fake timer 3500ms; assert chip renders.
- Happy path: mount; flip `hasEditedSinceTemplate` in store before 3500ms; chip appears immediately.
- Happy path: click chip → sheet opens (assert TemplateBottomSheet rendered). Close chip → localStorage `templates-dismissed` = 'true'.
- Edge: mount with `dismissed=true` via localStorage; no chip ever appears; timer doesn't fire.
- Edge: mount with `hydrationPending=true`; timer does NOT start until hydrationPending flips false.
- Edge: unmount during 3500ms timer → timer cleared, no warnings.
- Narrow-selector: subscription to `hasEditedSinceTemplate` doesn't re-render on unrelated store mutations.

**Verification:** 15+ new tests (reducer + component). Lint clean.

- [ ] **Unit 6: TemplateBottomSheet + TemplateMenuButton**

**Goal:** The bottom sheet UI + the menu-button re-entry. Category tabs + 3-visible + horizontal scroll + template cards + dismiss semantics.

**Requirements:** R3, R10, R11.

**Dependencies:** Units 1, 2, 5.

**Files:**

- Create: `app/editor/_components/TemplateBottomSheet.tsx` — the sheet UI. Props: `open`, `source: 'ghost' | 'menu'`, `manifest`, `onSelect(template)`, `onClose()`, `onDismissPersistent()`. `role="dialog"` + `aria-modal="true"` + focus trap + Esc-to-close. Backdrop click closes (non-persistent).
- Create: `app/editor/_components/TemplateCard.tsx` — thumbnail + label + variant badge (Classic/Slim). Loading state + error state (unreachable asset).
- Create: `app/editor/_components/TemplateMenuButton.tsx` — sidebar button. Opens sheet with `source: 'menu'`.
- Modify: `app/editor/_components/Sidebar.tsx` — add `<TemplateMenuButton onOpenSheet={...} />` at top; share sheet-open state with TemplateGate via a callback threaded through EditorLayout.
- Modify: `app/editor/_components/EditorLayout.tsx` — hoist the sheet-open state so TemplateGate + TemplateMenuButton can both open it. TemplateGate is the render owner; TemplateMenuButton dispatches an `openFromMenu()` callback.
- Create: `tests/template-bottom-sheet.test.ts` — jsdom component tests.

**Approach:** Hand-rolled dialog (no `@radix-ui/react-dialog`; no new deps per pinned-versions). Focus-trap via `first-tabbable` + `last-tabbable` refs; Esc via document listener during `open=true`. Backdrop click distinguished from sheet-body click via stopPropagation on the sheet.

**Execution note:** Test-first for dismiss-path semantics (D10 table). Each row in the table is one test.

**Patterns to follow:** WAI-ARIA dialog pattern. The existing ColorPicker is the closest sidebar-component analogue for narrow-selector subscriptions.

**Test scenarios:**

- Happy path: open sheet with 10 templates → assert 3 cards visible at default width; remaining 7 scroll horizontally.
- Happy path: click a category tab → cards filter to that category.
- Happy path: click a template card → `onSelect(template)` fires with the correct template object; sheet closes.
- Happy path (source: ghost): click × → `onDismissPersistent()` fires + sheet closes.
- Happy path (source: menu): click × → `onClose()` fires + sheet closes, `onDismissPersistent()` NOT fired.
- Edge: backdrop click (either source) → `onClose()` fires, `onDismissPersistent()` NOT fired.
- Edge: Esc key (either source) → same as backdrop.
- Edge: keyboard Tab cycles through visible interactive elements only (focus trap).
- Edge: template card with a broken thumbnail URL shows an error state; card is still clickable (graceful fallback — applying triggers the per-PNG decode error path from Unit 2, which surfaces a warning and no-ops).
- Edge: mounted with `open=false` → no DOM output (sheet is unmounted, not hidden).
- Accessibility: `role="dialog"` + `aria-modal="true"` + `aria-labelledby` asserted.

**Verification:** 12+ new tests.

- [ ] **Unit 7: Template-to-edit transition (crossfade + contextual hint + affordance pulse)**

**Goal:** The 200ms crossfade + 700ms hint + 1000ms pulse per DESIGN §5.4. EditorCanvas + PlayerModel get the crossfade + Y-rotation pulse; ContextualHintOverlay + AffordancePulse render from store.

**Requirements:** R4, R5.

**Dependencies:** Units 1, 4, 5.

**Files:**

- Create: `app/editor/_components/ContextualHintOverlay.tsx` — subscribes to `activeContextualHint`; renders a bubble anchored above the 3D canvas with a caret. Auto-dismisses on pointerdown anywhere in the editor.
- Create: `app/editor/_components/AffordancePulse.tsx` — headless coordinator. Subscribes to `pulseTarget`; applies `data-pulse="true"` attribute to the matching `data-pulse-target` DOM node; clears on animation end.
- Modify: `app/editor/_components/EditorCanvas.tsx` — accept `texFadeKey?: number` prop; `<Canvas>` wrapper wraps in `<div style={{opacity, transition: 'opacity 200ms ease'}}>`; opacity flips 0→1 on texFadeKey change.
- Modify: `lib/three/PlayerModel.tsx` — accept `yRotationPulseKey?: number` prop; `useFrame` lerps the root group's Y rotation toward `(baseRotation + 0.1)` for 100ms then back to base over 200ms. Zero-alloc preserved (no new Vector3; scalar lerp).
- Modify: `app/editor/_components/ColorPicker.tsx`, `app/editor/_components/Toolbar.tsx` — add `data-pulse-target="color"`, `data-pulse-target="brush"` to the appropriate root elements. Mirror-toggle button in Toolbar gets `data-pulse-target="mirror"`.
- Modify: `app/editor/page.tsx` or `EditorLayout.tsx` — globals.css or module-level CSS: the `[data-pulse="true"]` rule (600ms keyframe ring-pulse via `@keyframes` in `app/globals.css`).
- Modify: `app/globals.css` — add `@keyframes template-affordance-pulse` + the `[data-pulse="true"]` selector.
- Create: `tests/affordance-pulse.test.ts` — component test: store mutation → DOM attribute → animation-end cleanup.
- Modify: `tests/apply-template.test.ts` — integration: applyTemplate → wait 700ms → `activeContextualHint` set → wait 3000ms → cleared.

**Approach:** The crossfade + Y-rotation pulse are React `useEffect` + `useFrame` respectively; the hint + pulse are store-driven. Timers are in the apply-template orchestrator (Unit 4) — this unit WIRES the UI to the store slots that Unit 4 populates.

**Execution note:** Manual QA on actual `npm run dev` for the visual timing — ±50ms per DESIGN §5.4 is within human perception tolerance for "feels right."

**Patterns to follow:** M4's `CursorDecal` + `PencilHoverOverlay` are the closest analogues for store-driven DOM overlays.

**Test scenarios (ContextualHintOverlay):**

- Happy path: store sets `activeContextualHint="Try a new color"` → bubble renders with that text.
- Happy path: pointerdown anywhere in the editor → `clearContextualHint()` fires → bubble unmounts.
- Edge: null hint → no render.
- Edge: hint change (A → B) → DOM updates in place.

**Test scenarios (AffordancePulse):**

- Happy path: `setPulseTarget('color')` → DOM element with `data-pulse-target="color"` receives `data-pulse="true"`; after animation end → attribute cleared.
- Edge: `setPulseTarget(null)` → no DOM mutation.
- Edge: `setPulseTarget('color')` then `setPulseTarget('mirror')` before animation ends → first target clears, second target pulses.

**Test scenarios (integration):**

- Happy path: `applyTemplate(...)` + advance timers by 700ms → `activeContextualHint` set; by 1000ms → `pulseTarget` set; by 1600ms → `pulseTarget` null; by 3700ms → hint null.
- Edge: undo during the transition window → `applyTemplateSnapshot(before)` clears both slots if the `before` state had them null.

**Test scenarios (manual QA on npm run dev):**

- The 200ms crossfade is visible; prior skin fades out as new skin fades in (not a hard pop).
- The Y-rotation pulse eases back (no abrupt return).
- The contextual hint appears anchored above the 3D canvas and is readable.
- The affordance pulse is subtle but noticeable; matches the `accent` token.

**Verification:** 8+ new tests. Manual QA items pass.

- [ ] **Unit 8: Persistence of template-aware fields + integration sweep**

**Goal:** `hasEditedSinceTemplate` + `lastAppliedTemplateId` round-trip through IDB. End-to-end verification that a reload mid-transition restores a clean state. Bundle audit.

**Requirements:** R8, R9, R13, R14.

**Dependencies:** Units 1, 4, 5, 6, 7.

**Files:**

- Modify: `lib/editor/persistence.ts` — add both accessors to `InitPersistenceParams`; `buildDocument` writes both fields; `loadDocument` parses defensively (unknown → `hasEditedSinceTemplate: true`, `lastAppliedTemplateId: null`).
- Modify: `app/editor/_components/EditorLayout.tsx` — pass the new accessors to `initPersistence`. Hydration path: read both fields + apply to store BEFORE TemplateGate mounts (so the gate sees the right values). Use `hydrationPending` as the sync point — TemplateGate reads its initial state only after `hydrationPending === false`.
- Modify: `tests/persistence.test.ts` — add round-trip tests + backward-compat load.

**Approach:** Additive. No schema version bump (both fields are optional; missing = legacy).

**Execution note:** Test-first for the backward-compat path (M3–M6 saves must load cleanly).

**Patterns to follow:** M6 Unit 5's persistence delta pattern.

**Test scenarios:**

- Happy path: save a document with `hasEditedSinceTemplate=false` + `lastAppliedTemplateId='classic-hoodie'` → load → both fields restored.
- Happy path: save with `hasEditedSinceTemplate=true` + `lastAppliedTemplateId=null` → load → restored.
- Edge: M3–M6 save (no hasEdited / no lastApplied fields) → load → `hasEditedSinceTemplate=true` (safe default: existing users with prior edits skip the picker), `lastAppliedTemplateId=null`.
- Edge: unknown value in `lastAppliedTemplateId` (typo, e.g., 'classic-hoody') → treat as null, log warning. Do NOT fail the load.
- Edge: string value in `hasEditedSinceTemplate` slot (schema drift) → coerce to boolean via strict equality; unknown → default true.
- Integration: the manual reload case — paint a stroke, apply template B, reload mid-transition → restored state matches the immediately-post-apply state (variant, layers, lastApplied). Hint + pulse are NOT re-played (they're transient UI, store slots default to null on hydration). TemplateGate sees `hasEditedSinceTemplate=false` + `lastAppliedTemplateId='template-B-id'` but also sees `localStorage.templates-dismissed=true` — so the Ghost flow stays dismissed. Correct behavior.

**Verification:** 6+ new tests. All prior persistence tests pass.

- [ ] **Unit 9: End-to-end integration sweep + bundle audit + PR**

**Goal:** Full suite. Manual acceptance per the DESIGN §5.4 timeline. Bundle size under +15 kB.

**Requirements:** R1–R15.

**Dependencies:** Units 0–8.

**Files:** no new; verification-only.

**Approach:** Run the full suite (`npm run lint`, `npx tsc --noEmit`, `npm run test`, `npm run build`). Manual acceptance on `npm run dev`. Measure bundle delta.

**Test scenarios:** See Acceptance Criteria.

**Verification:**

- All M1–M6 tests pass (349 baseline).
- New M7 tests pass (estimated ~70–90: Unit 0 ~5, Unit 1 ~11, Unit 2 ~12, Unit 3 ~4, Unit 4 ~12, Unit 5 ~16, Unit 6 ~12, Unit 7 ~9, Unit 8 ~7).
- Bundle delta ≤ +15 kB First Load JS.
- All manual acceptance items pass on `npm run dev`.
- No new `any` types added in `app/` or `lib/`.
- No new npm dependencies in `package.json`.

## System-Wide Impact

- **Interaction graph:** `applyTemplate` orchestrator is new; consumed by TemplateGate (Ghost-flow applies) + TemplateMenuButton (menu-opened applies). Store gains 4 new slots + 5 new actions. `use-texture-manager` loses its placeholder seed responsibility (moved to a dedicated effect per D2). `EditorActions` adapter gains `applyTemplateSnapshot`. Undo stack gains one new Command kind. `EditorLayout` renders one new overlay pane (TemplateGate) + wires two new callbacks (`onApplyTemplate`, `onOpenFromMenu`).
- **Error propagation:** Missing manifest → empty catalog → Ghost picker never shows (gate stays in idle forever, dismissed on first stroke). Missing PNG file → template card error state, apply is no-op. PNG decode dimension mismatch → throws in orchestrator, caller catches + logs + the store state is unchanged. `applyTemplate` during `hydrationPending=true` rejects with a warning; Ghost gate gates on hydrationPending to avoid this case.
- **State lifecycle:** Template data (manifest, decoded PNGs) cached in `templates.ts` module scope. Cleared on page unload (browser frees the JS context). Apply-template undo records live in the session UndoStack (cleared on reload per M6). Store slots `hasEditedSinceTemplate` + `lastAppliedTemplateId` persist to IDB; `activeContextualHint` + `pulseTarget` are transient (not persisted — hint/pulse on reload is an edge we don't handle).
- **API surface parity:** `EditorActions` adapter gets one new method. `StrokeContext` (dispatcher) is UNCHANGED — markEdited rides the existing `onStrokeCommit` callback. `SkinDocument` schema gets 2 optional fields; M3–M6 loads are backward-compatible.
- **Integration coverage:** Unit 4's orchestrator + undo round-trip + Unit 5's gate state + Unit 7's transition timeline are the three new cross-layer seams. Apply-template → undo → redo round-trip is the load-bearing e2e test.
- **Unchanged invariants:**
  - Zero-allocation pointer hot path (M3). `markEdited()` is called from the M6 stroke-commit path, which is NOT a pointer hot path — it fires once per stroke, at pointerup.
  - Narrow-selector contract (M3 + M6). TemplateGate + overlays + pulse subscribe to individual slots, not broad shapes.
  - Caller-owned GPU disposal (M2). No new GPU resources; template PNG decode uses a scratch canvas (not a three.js texture).
  - R3F paint pattern (M4). Unchanged.
  - Dispatcher-chokepoint pattern (M6). `markEdited()` rides it; no new chokepoint.
  - Off-store pixel mutation (M6). apply-template REPLACES the layer array (identity change); subsequent strokes mutate pixels in place as before.
  - EditorActions adapter (M6). One new method; remains React-free.
  - Session-scoped non-serializable instances (M6). UndoStack unchanged; no new session-scoped instances.

## Risks & Dependencies

| Risk | Level | Mitigation |
|---|---|---|
| Variant switch during apply-template clobbers the template layer via the M6 use-texture-manager placeholder seed | P1 | Unit 0 decouples seed from TM lifecycle. Test-first for "layers present → skip seed" path. |
| Undo of apply-template fails to restore variant correctly — the variant flip fires before layers are set on undo | P1 | Unit 4 atomic `applyTemplateState(snapshot)` store action. One microtask; tests assert single-render behavior. |
| Template PNG decode produces a `Uint8ClampedArray` with unexpected byte order (e.g., BGRA on Safari older versions) | P2 | Decode via 2D canvas `getImageData` — canonical RGBA order per spec. Manual QA on Safari verifies. |
| `createImageBitmap` unavailable in some test environments | P2 | Stub in vitest setup; decode tests use the stubbed path. Production only targets evergreen browsers. |
| Manifest fetch fails (404 on deploy / CDN hiccup) → Ghost picker never shows | P2 | Unit 2 fail-soft: empty catalog + logged warning. Ghost gate sees empty catalog → stays in idle. Chip may still show but sheet would be empty — fix: if catalog is empty, skip the chip entirely. |
| TemplateGate's 3500ms timer + first-stroke subscription races — chip appears, then first stroke immediately fires, and the gate transitions twice | P3 | Reducer handles: both TIMER_ELAPSED and FIRST_STROKE from idle → suggestion_chip; from suggestion_chip → stays. Tests cover the double-fire. |
| Bottom sheet backdrop click triggers both `onClose` and a background pointerdown that `clearContextualHint` sees. User applies template, hint appears at 700ms, user clicks backdrop to close the sheet (which is closed already — sheet auto-dismisses on select) but the click also clears the hint early | P3 | `clearContextualHint` listener is installed AFTER the sheet closes; +300ms debounce between sheet-close and listener-install prevents the race. |
| LocalStorage quota exceeded on mobile Safari Private (very rare) | P3 | Write failure is a catch/log no-op. Gate falls through to default behavior (not-dismissed) on next load. |
| Contextual hint anchored above the 3D canvas overlaps the chip if both are present simultaneously | P3 | State machine forbids this: hint fires ONLY after `dismissed`; chip is only in `suggestion_chip`. No overlap possible. Reducer invariant tested. |
| Template PNG artwork quality falls short of "ships-to-MVP" bar | P3 | Unit 3 is the asset handoff; scope-flagged separately so code work (Units 0–2, 4–8) doesn't block on art. Placeholder fixture PNGs work for dev; real art swaps in before merge. |
| Apply-template captures a snapshot that includes mutable Uint8ClampedArrays without copying → later undo re-reads mutated bytes | P1 | `before.layers` deep-clones via `layer.pixels.slice()` and new layer object per layer. Tested. (The M6 invariant: `.slice()` is load-bearing. Same rule.) |
| Bundle delta exceeds +15 kB | P3 | No new deps; new components are lean DOM + CSS. Measured in Unit 9. |
| First-stroke + template-applied transition conflicts — user paints mid-transition before the 500ms "editable" mark | P3 | DESIGN §5.4 says editable at 500ms; in practice we don't enforce a hard lock. If user strokes during the 0–500ms window, the stroke commits normally + `markEdited()` fires (correct behavior — they intended to paint). No extra guard needed. |
| Menu-opened sheet + Ghost-opened sheet race — user opens menu sheet, closes it via ×, then Ghost timer fires → chip appears but it shouldn't (sheet was just closed) | P3 | Reducer models this: menu-open doesn't advance to `suggestion_chip` afterward; Ghost state tracks its own machine. Menu open is a separate overlay that doesn't change the Ghost-state. Tested. |

## Documentation / Operational Notes

- **Update `docs/COMPOUND.md` M7 entry** via `/ce:compound` post-merge. Pre-flagged captures:
  - The `createImageBitmap` → canvas → `Uint8ClampedArray` PNG decode recipe (the pattern M2 fingernail-promised but didn't pin).
  - The manifest-validator hand-rolled pattern (no-zod-no-deps approach).
  - The use-texture-manager seed decoupling (formalizing the M6 gotcha fix).
  - The apply-template undoable-command pattern (generalizes to any "atomic document replacement" op — paste-document, import-skin).
  - The store-driven transition timeline (vs ref-driven) — survives reload mid-transition and is testable with fake timers.
  - LocalStorage-for-single-boolean vs IDB-for-document-state division.
  - The Ghost state-machine reducer extraction for testability.
- **Amend `docs/DESIGN.md` §5.1** — reconcile `blank-better` `variant: both` as two manifest entries (Unit 0).
- **Amend `docs/DESIGN.md` §5.4** — clarify the 2000ms+ guardrail triggers on export action, not a timer (Unit 0).
- **No new CVE surface** — zero new dependencies.
- **No operational concerns** — client-only, no backend, no env vars, no migrations. Template PNGs are static assets served from `/public/templates/`; no CDN cache invalidation concerns beyond standard deploy.

## Acceptance Criteria

### Automated (all must pass before PR open)

1. `npm run lint` — 0 errors / 0 warnings.
2. `npx tsc --noEmit` — 0 errors.
3. `npm run test` — all M6 tests pass (349) + all new M7 tests pass (~70–90).
4. `npm run build` — succeeds, both routes generated, no new warnings.
5. Bundle delta: `/editor` First Load JS ≤ **383 kB** (M6 baseline 368 + 15 budget).
6. HTTP 200 on `/` and `/editor` via `npm run dev`.
7. Zero `any` types added in `app/` or `lib/`.
8. Zero new dependencies in `package.json`.
9. All 10 manifest entries resolve to existing files on disk.

### Manual (verified on `npm run dev` before PR ready-for-merge)

10. **[R2]** First visit (clear localStorage + clear IDB) → placeholder skin loads → after 3500ms, chip appears.
11. **[R2]** First visit, paint a stroke before 3500ms → chip appears immediately on stroke commit.
12. **[R2]** Second visit with `templates-dismissed=true` in localStorage → chip does NOT appear; editor loads cleanly.
13. **[R2]** Second visit with `hasEditedSinceTemplate=true` in IDB → chip does NOT appear.
14. **[R3]** Click chip → bottom sheet opens. Three template cards visible; horizontal scroll reveals more.
15. **[R3]** Click a category tab → cards filter to that category.
16. **[R4]** Click "Classic Hoodie" → model crossfades to new skin in ~200ms → editable at ~500ms.
17. **[R5]** At ~700ms post-click, a "Try a new color" hint appears anchored above the 3D model.
18. **[R5]** At ~1000ms, the color picker gets a subtle ring pulse.
19. **[R5]** Y-rotation pulse is visible at ~200ms (slight nudge, eases back).
20. **[R6]** Cmd/Ctrl+Z after template apply → model crossfades back to prior state; variant + layers restored.
21. **[R6]** Cmd/Ctrl+Shift+Z → template reapplied.
22. **[R4]** Select a slim-variant template while on classic → variant switches to slim automatically; sheet closes.
23. **[R10]** Click × on the chip → localStorage `templates-dismissed=true`; reload; chip doesn't appear.
24. **[R11]** Open menu-sheet, click backdrop → sheet closes; localStorage `templates-dismissed` NOT set; reload; chip still shows (if first-visit state).
25. **[R11]** Open menu-sheet, press Esc → same as backdrop — non-persistent.
26. **[R9]** Reload mid-session after template apply → document restores with the template layer intact; lastAppliedTemplateId restored.
27. **[R13]** All M6 manual acceptance items still work (painting, layers, undo, persistence).
28. **[Chrome / Safari / Firefox]** Ghost picker + template apply work in all three browsers.
29. **[Accessibility]** Tab navigation through chip + sheet is focus-trapped; Esc closes sheet; screen reader announces sheet `role="dialog"` correctly.

### Manual — bundle + performance

30. `/editor` First Load JS ≤ 383 kB on `npm run build` output.
31. Apply a template → undo → redo stress (20 cycles) → frame rate stays ≥ 55 fps in Chrome DevTools. UndoStack `bytesUsed()` reads under 1 MB (20 × ~48 KB per apply-template = ~960 KB, under budget).
32. Template PNGs + thumbnails load within 500ms on localhost; no visible loading state on the card thumbnails at localhost speeds.

## Sources & References

- **DESIGN.md §5.1** — Template catalog (10 entries + category mapping). Amend per D7.
- **DESIGN.md §5.2** — Manifest schema.
- **DESIGN.md §5.3** — Ghost Templates state machine.
- **DESIGN.md §5.4** — Template-to-edit transition timeline. Amend per D9.
- **DESIGN.md §12.5 M7** — Milestone plan + review questions.
- **`docs/COMPOUND.md` M3** — Narrow-selector convention, hydrationPending gate, persistence amendment-5 race handling.
- **`docs/COMPOUND.md` M4** — Store-driven overlays; overlays live in EditorLayout.
- **`docs/COMPOUND.md` M5** — Dispatcher chokepoint; tool-selection shortcut modifier/focus guards.
- **`docs/COMPOUND.md` M6** — EditorActions adapter, dispatcher-chokepoint for orthogonal concerns, session-scoped instances in refs, off-store pixel mutation, reverse-array rendering convention, drag-commit before-on-pointerdown pattern, dual-cap undo memory ceiling. **M6 §Gotchas — variant toggle clears undo stack** is the explicit Unit 0 chore for M7.
- **Microsoft minecraft-samples** (https://github.com/microsoft/minecraft-samples) — `blank-better.png` source, MIT-licensed.
- **MDN createImageBitmap** — canonical PNG decode path.
- **WAI-ARIA Authoring Practices Guide — Dialog pattern** — bottom sheet ARIA shape.
- **WHATWG HTML §4.12.5.1.14** — composite-canvas state handling (reaffirmed from M6 D1).
- **Related PRs:** #M6 merge (m6-layers-undo branch). No M7 PR yet.

## /ce:plan review answers

### 1. Hardest decision

Whether apply-template should clear the undo stack (Photoshop "New from template" pattern) or push an undoable command (Figma "Replace document" pattern). The cost comparison:

- **Clear-stack:** zero-cost memory per apply; but an accidental template click destroys work with no recourse. Pairs with the "if hasEdited, show confirm dialog" pattern to protect accidental destruction — which contradicts DESIGN §5.4's explicit "Editable immediately — no lock, no confirmation."
- **Undoable command:** ~48 KB per apply-template (typical 1-layer-before + 1-layer-after). Under budget. Round-trip is load-bearing testable. Matches M6 D3 precedent where layer-delete is undoable not dialog-gated.

Decided to push an undoable command (D1). Memory cost is modest; undo behavior is the 2026-standard expectation; matches the M6 precedent. The alternative would have required a confirm dialog on apply-template when `hasEdited=true`, which is exactly the friction the Ghost picker is designed to eliminate on first-run and contradicts DESIGN §5.4.

Secondary hardest decision: how to handle the variant switch embedded inside apply-template without triggering the M6 use-texture-manager placeholder-seed reset (which would clobber the applied template). Options:

- **Gate the seed by a dedicated flag** (`skipNextPlaceholderSeed: boolean`) set by apply-template and cleared by the effect. Fragile; the flag is state-between-effects, which is exactly the kind of thing React renders split across microtasks can race on.
- **Decouple the seed from the TM lifecycle effect** — the approach chosen (D2). Two effects: one for TM lifecycle, one for seed-when-empty. apply-template sets layers first, variant second; the TM lifecycle effect sees a non-empty layers array and skips the placeholder path entirely. Clean. Generalizes to any future "populate layers from outside" feature (import, paste, network sync).

The decoupling also formalizes the M6 Unit 0 chore from `docs/COMPOUND.md` M6 §Gotchas — "variant toggle clears undo stack" — into a concrete effect split.

### 2. Alternatives rejected

- **Clear-stack on apply-template** (see §1 above). Rejected per D1.
- **Confirm dialog when `hasEdited=true`** — contradicts DESIGN §5.4. Rejected.
- **Zod for manifest validation** — adds ~10 KB bundle for one use site. Rejected per D3.
- **Service worker for manifest + template caching** — over-engineering for a 10-entry static catalog. Rejected.
- **`@radix-ui/react-dialog` for the bottom sheet** — adds ~12 KB bundle. Rejected per no-new-deps convention. Hand-rolled ARIA dialog is ~80 LOC.
- **`framer-motion` for the 200ms crossfade** — adds ~35 KB bundle. Rejected. CSS `transition-opacity` is free.
- **State machine via `xstate`** — adds ~20 KB for 4 states. Rejected. Pure reducer is ~40 LOC + more testable.
- **Persist `templates-dismissed` to IDB** — mismatch. LocalStorage is synchronous + single-boolean + fits the decision-on-mount shape. Rejected per D5.
- **Store the Ghost state machine in zustand** — pollutes the store with UI-ephemeral slots that no other component reads. Rejected per D5.
- **Templates owned by the client at build time (ESM imports of PNG URLs)** — would bundle template paths into JS. Not wrong, but `fetch('/templates/manifest.json')` is simpler and keeps templates hot-swappable without a rebuild. Rejected mild alternative.
- **Thumbnail generation in-app** — requires a headless three.js pipeline at app startup for 10 renders. Pre-rendered WebPs are simpler. Rejected.
- **Cross-session restore of the transition timeline (hint + pulse)** — reload-mid-transition is already an edge case; replaying the timeline from IDB adds complexity for negligible value. Rejected. Hint + pulse default to null on hydration.
- **Apply-template clears `recentSwatches` / `activeColor`** — color state is user preference, not document state. Rejected.
- **Apply-template shows the contextual hint unconditionally** — some users open a template AND dismiss the hint fast; forcing it for 3000ms feels aggressive. Accepted: pointerdown anywhere clears it early (D8).
- **Sheet backdrop click persists `templates-dismissed`** — rejected per D10. Accidental clicks on shared devices shouldn't permanently disable first-run.

### 3. Least confident

The timing interactions between the 700ms hint, the 1000ms pulse, the 200ms crossfade, and the undo path. Specifically: if a user clicks Cmd+Z at, say, +800ms (after hint appears, before pulse appears), what should happen?

Current plan: `applyTemplateSnapshot(before)` runs; `before` has `activeContextualHint=null` + `pulseTarget=null` (the prior apply's transient state wasn't captured). The store flips both to null. The +1000ms pulse timer is still scheduled — it fires on the UNDONE state, setting `pulseTarget` to the now-undone template's pulse target. Wrong — pulse should not fire after undo.

Fix: `cancelActiveTransition()` is called at the top of apply-template AND at the top of apply/revert for `apply-template` commands in undo.ts. The module-scope timer handles are cleared. Tests cover this.

Next-least-confident: whether the Ghost picker's "skip on hasEditedSinceTemplate=true at mount" behavior is correct for the first-ever visit when the user paints one stroke, then reloads. On reload:

- `templates-dismissed` = not set (user never dismissed)
- `hasEditedSinceTemplate` = true (persisted)
- Expected: picker should NOT appear (user has engaged with the editor; the "try a starting style" suggestion is no longer appropriate)

Current plan: gate.initial(dismissed=false, hasEdited=true) → `dismissed`. Correct.

But what if the user then hits Cmd+Z 50 times + clears the editor back to placeholder? `hasEditedSinceTemplate` stays true (undo doesn't reset it — `markEdited` is idempotent one-way). Arguably the picker should re-appear since the canvas is back to placeholder. But: tracking "effective blank canvas" requires pixel comparison to placeholder, which is fragile + expensive. Deferred as a product decision — if users complain, revisit.

Third-least-confident: the decoded PNG pixel data's color space. Minecraft skin PNGs are sRGB; so is the canvas 2D `getImageData` output. But variant-specific Slim templates need their pixels to align with the Slim UV packing (M2 D4). If a template was authored against the wrong UV packing (e.g., a "slim" template file that's actually arranged for Classic), the apply would produce wrong textures visually with no error.

Mitigation: Unit 3's asset authoring task has a callout in the plan that each Slim template's PNG must be validated against `lib/three/geometry.ts` SLIM_UVS. A manual QA item checks each template visually on apply. No automated dimension check catches mis-packed UVs since the PNG is 64×64 regardless.
