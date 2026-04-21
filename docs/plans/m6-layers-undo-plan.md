---
title: M6 — Layers + Undo
type: feat
status: active
date: 2026-04-21
milestone: M6
depth: Standard
---

# M6 — Layers + Undo

> **Plan file:** `docs/plans/m6-layers-undo-plan.md` (matches `m5-tool-palette-plan.md` convention).
> **Origin:** `/ce:plan` invocation on 2026-04-21, immediately after M5 merge. No upstream requirements doc — scope is pinned by `docs/DESIGN.md` §4, §7, §8, §12.5 M6.
> **Plan type:** **Standard** (multi-layer state refactor, new undo-stack subsystem, new LayerPanel UI, keyboard shortcuts). Largest milestone so far but every unit is bounded.

## Context

M1 shipped the scaffold. M2 shipped the 3D player model. M3 shipped the 2D paint surface + a single-layer `TextureManager` + IndexedDB auto-save. M4 shipped the 2D↔3D paint bridge with overlay/base precedence. M5 shipped the 5-tool palette (pencil/eraser/picker/bucket/mirror-modifier) with a central `lib/editor/tools/dispatch.ts` that all paint surfaces call into.

**Current single-layer topology** (what M6 replaces):

- `useTextureManagerBundle(variant)` returns `{ textureManager, layer }` — one Layer with a hard-coded id `'base'`.
- `EditorLayout` threads `{ textureManager, layer, markDirty, hydrationPending }` to `ViewportUV` + `PlayerModel`.
- `lib/editor/tools/dispatch.ts`'s `StrokeContext` carries `layer` as a field; every tool writes directly into `layer.pixels` with no diff capture.
- `lib/editor/persistence.ts` serializes `layers: [layer]` with `activeLayerId: layer.id` to IDB.
- `TextureManager.composite([layer])` iterates but only supports `opacity=1, blendMode='normal'` per the inline comment (`M6 extends this`).

**M6 turns this into** a full multi-layer document (`layers: Layer[]` + `activeLayerId`), an undo/redo stack with dirty-rect diffs, and a LayerPanel UI in the Sidebar. The tool dispatcher gains a **diff-capture wrapper** so pencil/eraser/bucket commits emit `Stroke` records without each tool re-implementing before/after snapshot logic. Mirror modifier strokes remain atomic undo steps.

## Overview

Ship layers and undo. Users can add, delete, reorder, rename layers, tweak per-layer opacity + blend mode + visibility, and undo any pixel-mutating action (including mirror strokes as a single step) via Cmd/Ctrl+Z. Redo via Cmd/Ctrl+Shift+Z. Layer lifecycle (add/delete/reorder) is also undoable. Active layer is the implicit target for every stroke.

The core complexity is the undo stack: dirty-rect diff capture at stroke-end, memory-bounded history, and the fact that mirror strokes land in potentially-disjoint atlas rects (rightArm.front at y≈20, leftArm.front at y≈52) — the Stroke record stores an **array of patches**, not a single bbox, so the spanning-rect waste is avoided (see D2).

A critical prerequisite: **DESIGN §7's `composite()` algorithm is broken.** `putImageData()` ignores `globalAlpha` and `globalCompositeOperation` per WHATWG HTML Living Standard §4.12.5.1.14 — the current single-layer code got away with this because opacity was always 1 and blendMode was always 'normal'. M6 Unit 1 replaces it with a scratch-canvas + `drawImage` pipeline that correctly honors both.

## Pinned versions (delta from M5)

| Package | Previous (M5) | M6 | Notes |
|---|---|---|---|
| All M1–M5 pins | same | **unchanged** | No new dependencies. Drag-to-reorder is hand-rolled (~100 LOC — see D8); slider/dropdown/inline rename are plain HTML. |

**Peer-dependency check:** M6 adds **zero new dependencies**. Drag-reorder via Pointer Events + manual hit-testing. Blend-mode picker is native `<select>`. Opacity slider is `<input type="range">`. The research round explicitly rejected `@dnd-kit` (~10 KB) and `react-movable` (~5 KB) as not worth the bundle cost for a 4-to-8-row list.

## Files to create / modify

**`lib/editor/` — extends existing**

- `lib/editor/types.ts` — **modify**. Change `Stroke.before/after: Uint8ClampedArray + bbox: {x,y,w,h}` into `Stroke.patches: Array<{bbox, before, after}>` per D2. Keep `SkinVariant`, `Layer`, `SkinDocument`, `IslandMap`, `Point`, `RGBA` unchanged.
- `lib/editor/store.ts` — **modify**. Replace implicit single-layer state with:
  - `layers: Layer[]` + `activeLayerId: string`.
  - Actions: `addLayer()`, `deleteLayer(id)`, `reorderLayers(fromIdx, toIdx)`, `renameLayer(id, name)`, `setLayerOpacity(id, opacity)`, `setLayerBlendMode(id, mode)`, `setLayerVisible(id, visible)`, `setActiveLayerId(id)`.
  - **Non-undoable** slots: `uvZoom`, `uvPan`, `hoveredPixel`, `activeTool`, `brushSize`, `activeColor`, `savingState`, `mirrorEnabled`. These do NOT push to the undo stack; per-D5 only pixel + layer-structure mutations do.
- `lib/editor/undo.ts` — **new**. `UndoStack` class with `push(command)`, `undo(state)`, `redo(state)`, `canUndo()`, `canRedo()`, `clear()`, `bytesUsed()`. Command union: `{ kind: 'stroke', ... }` + `{ kind: 'layer-add', ... }` + `{ kind: 'layer-delete', ... }` + `{ kind: 'layer-reorder', ... }`. Dual limits (D4): `MAX_HISTORY_BYTES = 5 * 1024 * 1024`, `MAX_HISTORY_COUNT = 100`.
- `lib/editor/diff.ts` — **new**. Pure helpers: `sliceRegion(pixels, bbox): Uint8ClampedArray` and `applyRegion(pixels, bbox, region): void`. Used by the dispatcher's stroke wrapper and by `undo.ts`.
- `lib/editor/tools/dispatch.ts` — **modify**. Gain `StrokeRecorder` type + wrap `strokeStart`/`strokeContinue`/`strokeEnd` with bbox-accumulation and pre-image snapshotting so every completed stroke emits a `Stroke` command into the undo stack. StrokeContext grows a `layers: Layer[]` field (active layer resolved from `activeLayerId`) for future multi-layer tool reads (pickers that see composite output are deferred — M5 picker already only reads the active layer).
- `lib/editor/texture.ts` — **modify**. Replace `composite()`'s `putImageData`-per-layer with a scratch `OffscreenCanvas` + `drawImage` pipeline (D1). Support `opacity` (via `globalAlpha`) and `blendMode` (via `globalCompositeOperation`). `mapBlendMode` helper: `{normal: 'source-over', multiply: 'multiply', overlay: 'overlay', screen: 'screen'}`.
- `lib/editor/use-texture-manager.ts` — **modify**. Return shape changes from `{textureManager, layer}` to `{textureManager, layers, activeLayerId, activeLayer}`. Initial state: one Layer (`'base'`) seeded from `createPlaceholderSkinPixels(variant)`, same as M3. Subscribe to store `layers` slot; recomposite on layer change.
- `lib/editor/persistence.ts` — **modify**. `buildDocument()` reads the full `layers` array from the store (not just a single layer). `loadDocument()` restores multi-layer documents. Backward-compat with M3's `layers: [single]` IDB records (D6).

**`app/editor/_components/` — extends existing**

- `app/editor/_components/EditorLayout.tsx` — **modify**. Thread `layers` + `activeLayerId` + `activeLayer` to children; replace single-`layer` prop. Wire undo keyboard shortcut (Cmd/Ctrl+Z / Shift+Z) at this level since it's the top editor component and needs access to layers + undoStack.
- `app/editor/_components/EditorCanvas.tsx` — **modify**. Props: `activeLayer` → route-through to `PlayerModel`.
- `app/editor/_components/ViewportUV.tsx` — **modify**. Swap `layer` prop for `activeLayer`; pass `activeLayer` into the StrokeContext. Bucket hover overlay + pencil hover overlay both operate on the composite view (read through TextureManager), NOT the active layer (D7).
- `app/editor/_components/Sidebar.tsx` — **modify**. Render the new `<LayerPanel />` below `<ColorPicker />`.

**`app/editor/_components/` — new**

- `app/editor/_components/LayerPanel.tsx` — **new**. The UI component. Sub-components inline or colocated:
  - Header row: layer count + `+` button to add a new layer.
  - Per-layer row: grip (drag handle), visibility toggle (eye), name (double-click to rename), blend-mode `<select>`, opacity `<input type="range">` (only shown on active row per D8), delete button.
  - Drag-reorder via pointer events (D8).
  - Active-layer affordance: 3px left-edge accent bar + tinted background (per research round).
- `app/editor/_components/LayerRow.tsx` — **optional new**. Extract if LayerPanel.tsx grows past ~200 LOC; inline otherwise.

**`tests/` — extends existing**

- `tests/types.test.ts` — **optional new**. One compile-time test asserting `Stroke.patches` shape is what we expect. Can live inside `tests/undo.test.ts` instead if preferred.
- `tests/undo.test.ts` — **new**. Stack ops, byte cap, count cap, redo invalidation, undo-during-active-stroke guard.
- `tests/diff.test.ts` — **new**. `sliceRegion` + `applyRegion` round-trip.
- `tests/layer-store.test.ts` — **new**. `addLayer` / `deleteLayer` / `reorderLayers` / `setLayerOpacity` / `setLayerBlendMode` / `setLayerVisible` / `setActiveLayerId` — narrow-selector contract + action semantics.
- `tests/texture-manager.test.ts` — **modify**. Add scenarios for `composite()` with `opacity < 1` and each of the four blend modes. Assert the produced canvas pixels match the expected formula (or at minimum differ from the single-layer-top-wins output that the old `putImageData` path produced).
- `tests/tool-dispatch.test.ts` — **modify**. After Unit 4, every stroke emits a Stroke command into a recorder; tests assert the patches array has the right bbox + before/after for pencil, eraser, bucket, and mirror cases.
- `tests/layer-panel.test.ts` — **new**. jsdom component test: mount LayerPanel, assert rendering, clicks route to store actions, drag-reorder state transitions. Component-integration not full-pointer-event simulation (pointer events in jsdom are shaky — keep it to click + programmatic state changes).
- `tests/undo-shortcuts.test.ts` — **new**. Cmd+Z / Cmd+Shift+Z / Ctrl+Z / Ctrl+Shift+Z fire correct store actions; focus-guarded the same way M5 shortcuts are.

**Out of scope** (explicit non-goals per user constraints + DESIGN):

- **No templates** — M7 (locked per user message).
- **No PNG export** — M8.
- **No cloud sync / shared documents** — Phase 2 (M9+).
- **No layer merging / flatten** — future polish. A user who wants to collapse two layers must manually paint one into the other.
- **No layer groups / folders** — out of scope; Aseprite has them but it's a large UX surface.
- **No per-layer lock toggle** — nice-to-have; deferred.
- **No undo for non-pixel state** (view zoom/pan, tool selection, color change, brush size, mirror toggle, saving state). These are session-ephemeral UI state (D5).
- **No cross-surface continuous strokes** (dragging from 2D onto 3D) — M4 gotcha, deferred through M8.
- **Undo is layer-structure-aware, but redo after a layer delete does NOT attempt to re-paint into a deleted layer.** If a user deletes layer L then redoes a stroke targeting L, the redo operation silently no-ops on that stroke (D9). The next layer-reorder-or-add undo entry absorbs the continuation normally.
- **No Procreate-style "tiered decimation"** of old undo history. Hard-cap only. If users hit 100 strokes we evict oldest (D4).
- **No Krita-style swap-to-disk when memory cap hit.** Hard-cap only. A 5 MB in-memory ceiling is comfortable for a 64×64 editor.

## Requirements trace

- **R1.** Layer list is displayed top-to-bottom in the UI (matching Photoshop/Procreate) but composites bottom-to-top (DESIGN §4). Active layer is visually unmistakable (bg tint + left-edge accent bar).
- **R2.** Users can add, delete, reorder, rename layers. Rename is inline (double-click name). Reorder is drag-to-reorder OR up/down buttons on mobile (D8). Delete does not confirm — it's undoable (D3).
- **R3.** Per-layer opacity (0–1), blend mode (normal/multiply/overlay/screen), visibility toggle. Opacity slider is inline on the active layer, collapsed to a `%` readout on inactive layers.
- **R4.** `TextureManager.composite()` correctly honors `opacity` AND `blendMode` per layer. Both 2D canvas and 3D model reflect the composite in real time.
- **R5.** Cmd/Ctrl+Z undoes the last pixel stroke OR layer lifecycle action. Cmd/Ctrl+Shift+Z redoes. Shortcuts respect focus (INPUT/TEXTAREA/contentEditable/role=application) and the modifier rules (Cmd XOR Ctrl — never both; Alt is not a modifier for undo).
- **R6.** Undo stack dirty-rect diffs: each stroke stores an array of patches (`{bbox, before, after}`). Pencil/eraser patches are tight around the stamp union; bucket patches are tight around the flood-filled island; mirror patches produce 2 disjoint patches in one Stroke record (not a single spanning bbox — D2).
- **R7.** Mirror strokes are a single atomic undo step. Pressing Cmd+Z once after a mirror-pencil-stroke restores BOTH sides.
- **R8.** Memory ceiling: 5 MB total undo stack bytes (D4). On overflow, oldest entries evict. Also hard-capped at 100 entries.
- **R9.** Redo tail is truncated on any new pixel-mutating action (strokes) OR layer-structure action. Tool/color/view-zoom changes do NOT truncate redo.
- **R10.** Undo is ignored while a stroke is active (pointer still down). Prevents mid-stroke surprises.
- **R11.** All M1–M5 tests still pass (260/260). No regression to existing paint, color picker, persistence, variant toggle, or tool shortcuts.
- **R12.** `npm run lint`, `npx tsc --noEmit`, `npm run build`, `npm run test` all clean. Bundle delta ≤ **+15 kB** First Load JS on `/editor` vs M5's 363 kB baseline — LayerPanel is substantive UI work.
- **R13.** Persistence round-trip: a document with N>1 layers, opacity<1, blendMode≠'normal' saves to IDB and restores with bit-identical pixels + layer properties. Backward-compat with M3–M5 single-layer saves (D6).

## Scope boundaries

- **No undo for tool selection, brush size, color change, mirror toggle, zoom, pan.** These are UI state; they don't mutate pixels or document structure.
- **No undo for variant toggle.** Classic↔Slim swap rebuilds the TextureManager + layers; undoing a variant swap would require snapshotting the entire multi-layer document. Out of scope. User gets a warning dialog instead (deferred — current behavior preserved: variant change replaces the TM, auto-saves, doesn't touch undo).
- **No per-layer alpha lock / paint-protection.** Future polish.
- **Bucket-fill undo snapshots the fill bbox, not an RLE mask.** Flood fills have dense bboxes; RLE pays off only for sparse masks.
- **Picker does NOT push to undo.** It's non-mutating (only changes `activeColor`). Correct M5 behavior is preserved.
- **Layer panel horizontal layout is not responsive below 280px sidebar width.** Mobile (30vh bottom strip) gets a compressed vertical variant of the same panel; no drastic layout change.

## Context & Research

### Relevant code and patterns (M6 substrate)

- **`lib/editor/tools/dispatch.ts` (M5).** Centralized `strokeStart/strokeContinue/strokeEnd` + `samplePickerAt`. M6's diff-capture wrapper extends this without changing its public API for the two paint surfaces. Key: the dispatcher is the ONLY place that writes to `layer.pixels` — if we attach diff capture here, every tool (present + future) gets undo for free.
- **`lib/editor/flood-fill.ts` (M3) + `lib/editor/tools/bucket.ts` (M5).** Flood-fill returns a mask; `applyFillMask` writes RGBA. M6's bucket-stroke diff captures the bbox tight around the island touched. No algorithm change needed.
- **`lib/editor/tools/mirror.ts` (M5).** `mirrorAtlasPixel(variant, x, y) → {x,y} | null`. M6's mirror-stroke diff-capture logic reads this to compute the secondary bbox.
- **`lib/editor/texture.ts` (M3 → M6-extended).** Existing `composite(layers)` iterates but ignores opacity/blendMode. M6 swaps in scratch-canvas + drawImage. `flushLayer(layer)` stays as the hot-path single-layer writer (used during strokes for sub-frame latency); `composite` is the authoritative multi-layer pass called on stroke-end (unchanged cadence — per ViewportUV + PlayerModel pointerup handlers).
- **`lib/editor/store.ts` (M5).** Narrow-selector convention is load-bearing. Every LayerPanel row subscribes to exactly the layer fields it renders, never the whole layers array — see `tests/color-picker-selectors.test.ts` pattern. This is critical: a 4-layer editor with broad subscriptions would re-render every row on every stroke.
- **`app/editor/_components/Toolbar.tsx` (M5).** Keyboard shortcut handler with modifier + focus guards — the canonical pattern. Undo shortcut (Unit 7) follows the same shape but lives in EditorLayout since it needs access to the undo stack.
- **`lib/editor/persistence.ts` (M3).** The serialization path already speaks `layers: Layer[]`; M6 only needs `buildDocument` to return the full array instead of `[layer]` and `loadDocument` to accept N-layer docs.
- **`app/editor/_components/ColorPicker.tsx` (M3).** Closest analogue for a complex sidebar component with inline sub-controls. LayerPanel follows the same co-location + narrow-selector shape.

### Institutional learnings (carry forward)

- **`docs/COMPOUND.md` M3 §Invariants — zero-alloc in pointer hot path.** M6 diff capture happens at stroke-end ONLY, not per stamp. The dispatcher's `strokeStart/Continue` stay allocation-free; a single pre-image clone + bbox union happens per stroke, and the slice happens at `strokeEnd`. Tested in `tests/tool-dispatch.test.ts`.
- **`docs/COMPOUND.md` M3 §Gotchas — `handleWheel` torn state.** Carried forward from M3 → M4 → M5. M6 will NOT resolve this (still not worth the scope); the layers refactor doesn't touch `uvZoom`/`uvPan`.
- **`docs/COMPOUND.md` M4 §Invariants — Uint16Array LUT pattern.** Not used in M6 directly, but `mirrorAtlasPixel` from M5 is the pattern that makes the mirror-patch computation O(1).
- **`docs/COMPOUND.md` M4 §Gotchas — `useEffect([textureManager, layer])` race-reset.** M6 renames this to `useEffect([textureManager, activeLayerId, layers])` in the paint surfaces. The guard fires on layer swap too: if the user switches active layer mid-stroke, paint state resets to avoid stamping a Bresenham line from the previous layer's coords into the new layer.
- **`docs/COMPOUND.md` M5 §Invariants — "Record<Union, T>" for exhaustive maps.** M6 uses this for `BLEND_MODE_MAP: Record<BlendMode, GlobalCompositeOperation>` so adding a blend mode in a future milestone is a compile error until handled.
- **`docs/COMPOUND.md` M5 §Gotchas — drei `<Billboard> + <Html>` bundle cost.** LayerPanel is pure DOM; no drei primitives. Bundle delta stays contained.

### External references

- **WHATWG HTML Living Standard §4.12.5.1.14 Pixel manipulation** — `putImageData()` explicitly bypasses `globalAlpha`, `globalCompositeOperation`, clipping, transforms, shadows, and filters. Confirmed by research agent.
- **W3C Compositing and Blending Level 1** — canonical `globalCompositeOperation` strings: `source-over` (normal), `multiply`, `overlay`, `screen`. All stable in Chrome/Firefox/Safari since ~2016.
- **Aseprite symmetry mode** (https://www.aseprite.org/docs/symmetry/) — internally, a symmetric stroke is one logical undo step composed of multiple per-region sub-commands. Supports D2's choice of `patches: Array<...>` over single-span bbox.
- **Krita undo history** (https://docs.krita.org/en/reference_manual/dockers/undo_history.html) — byte-cap + count-cap as the memory-ceiling primitive. Supports D4.
- **Procreate managing undo history** (https://help.procreate.com/articles/dxxgnk-managing-undo-history) — 250-step default; confirms hard-cap is the industry norm. We use 100 which is plenty for a 64×64 editor.

## Key technical decisions

### D1 — Fix `composite()` via scratch-canvas + `drawImage`

**Decision:** `TextureManager.composite(layers)` blits each visible layer's `ImageData` onto a reused module-scoped `OffscreenCanvas(64, 64)` via `putImageData`, then `drawImage`s the scratch canvas onto `this.ctx` with `globalAlpha = layer.opacity` and `globalCompositeOperation = BLEND_MODE_MAP[layer.blendMode]`. For the bottom-most visible layer, use `'source-over'` (equivalent to 'normal') so transparency from an opacity<1 bottom layer composites correctly against the cleared canvas.

**Rationale:** DESIGN §7's existing spec ignores both `globalAlpha` and `globalCompositeOperation` because `putImageData` is a raw byte write, not a draw operation. Per WHATWG + MDN, `drawImage` IS affected by compositing state. A 64×64 scratch canvas adds ~16 KB of memory — negligible. For `OffscreenCanvas` fallback (older Safari without `OffscreenCanvas` constructor): use an off-DOM `document.createElement('canvas')` — same API surface via `getContext('2d')`. jsdom in tests: same fallback path works (already used for the main `TextureManager` canvas).

**Gotcha:** the `M6 extends this` comment in texture.ts is load-bearing — the existing single-layer consumer only ever passed one layer with opacity=1 and blendMode='normal', so the broken spec appeared to work. A regression test must lock in the correct behavior NOW so any future refactor catches it.

### D2 — Stroke record is `patches: Array<{bbox, before, after}>`, not a single bbox

**Decision:** Amend DESIGN.md §4. `Stroke` becomes:

```
Stroke = {
  id: string;
  layerId: string;
  patches: Array<{ bbox: {x,y,w,h}, before: Uint8ClampedArray, after: Uint8ClampedArray }>;
  tool: 'pencil' | 'eraser' | 'bucket';
  mirrored: boolean;
}
```

Non-mirrored stroke: `patches.length === 1`. Mirrored stroke: `patches.length === 2` (primary bbox + mirror bbox, each tight). Both sides restore together on a single undo.

**Rationale:** rightArm.front and leftArm.front live in atlas rows that are ~30 rows apart. A single spanning bbox would capture a 64×~32 = 8 KB padding slab of unchanged pixels per mirror stroke. Over 100 mirror strokes that's ~800 KB wasted vs. ~2×16 = 32 bytes of real diff per 1-pixel mirrored stamp. The single-spanning-bbox approach fails the 5 MB budget target for realistic mirror-heavy sessions. Aseprite, Krita, Photoshop's Paint Symmetry all use the multi-patch approach.

**Alternative rejected:** store two separate Stroke records with the same `id` and treat "same-id sequence" as a single undo step. Worse — splits atomicity logic across push/undo/redo boundary, confuses the byte counter, and has no upside over the direct "array of patches" approach.

### D3 — Layer lifecycle is undoable

**Decision:** The undo stack's command union extends beyond `Stroke`:

```
Command =
  | { kind: 'stroke', stroke: Stroke }
  | { kind: 'layer-add', layer: Layer, insertedAt: number }
  | { kind: 'layer-delete', layer: Layer, removedFrom: number }
  | { kind: 'layer-reorder', from: number, to: number }
  | { kind: 'layer-rename', id: string, before: string, after: string }
  | { kind: 'layer-opacity', id: string, before: number, after: number }
  | { kind: 'layer-blend', id: string, before: BlendMode, after: BlendMode }
  | { kind: 'layer-visibility', id: string, before: boolean, after: boolean }
```

`opacity` / `blend` / `visibility` are push-per-commit — a drag-end on the slider pushes one entry with the drag-start opacity as `before`. Visibility-toggle is instant one-click so pushes on every click.

**Rationale:** research round recommended this. Figma / Notion / Linear all treat structural actions as undoable commands. The alternative (a confirm dialog on layer delete) is friction, and undo is the 2026 user expectation. Design tradeoff: if we didn't include layer lifecycle in undo, we'd need either a separate layer-delete confirm dialog (UX friction) OR we accept that accidental deletes are unrecoverable (unacceptable). Including them in undo gives us both easy delete UX AND data safety.

**Gotcha:** opacity drag pushes one entry per drag-end, NOT per slider frame. The store's `setLayerOpacity` mutates the live value during drag (needed for preview); the `pushUndoEntry({kind:'layer-opacity', before, after})` fires on pointer-up with the captured `before`. Implemented in LayerPanel.tsx's slider pointer handler; the store action itself stays undo-free.

### D4 — Memory ceiling: dual caps (bytes + count)

**Decision:** `MAX_HISTORY_BYTES = 5 * 1024 * 1024` (5 MB), `MAX_HISTORY_COUNT = 100`. On `push`:

1. Append the command.
2. `bytesUsed += size(command)` — where `size` is sum of all `before.byteLength + after.byteLength` for stroke patches, or a fixed small constant for layer-lifecycle commands.
3. While `bytesUsed > MAX_HISTORY_BYTES || strokes.length > MAX_HISTORY_COUNT`, shift the oldest entry; subtract its size.
4. Expose `bytesUsed()` for debug (a hidden keyboard chord could show it; not a user-facing UI element in M6).

**Rationale:** `MAX_HISTORY` alone is wrong — 100 full-island bucket-mirror strokes could be 100 × 2 × 1KB = 200 KB (easy) or 100 × 8 KB whole-face strokes = 800 KB (still easy). But 100 × full-layer-span mirror strokes could approach 1.6 MB (DESIGN's own estimate). The byte cap is the safety rail. Matches Aseprite's configurable undo-limit-size preference and Krita's performance-settings budget.

**Rejected alternative:** "swap to disk when RAM cap hit" (Krita-style). Out of scope — 5 MB in-memory is comfortable and swap-to-disk is a week of work we don't need for a 64×64 editor.

### D5 — Only pixel + layer-structure mutations push to undo

**Decision:** Pushes to undo:

- Pencil / eraser / bucket stroke-end (via dispatcher wrapper).
- Layer add / delete / reorder / rename / opacity / blend / visibility changes.

Does NOT push to undo:

- Tool selection (pencil → eraser).
- Brush size.
- Active color / recents / swatch click.
- Mirror toggle (M5 modifier).
- Variant toggle (Classic ↔ Slim) — rebuilds TM, not an undo operation.
- Zoom / pan / hover.
- Saving state.
- Active layer selection (`setActiveLayerId`).

**Rationale:** these are session-ephemeral UI state. Undoing "I selected the eraser tool" would surprise users and mismatch Photoshop/Figma/Procreate expectations. Active-layer selection is borderline — we exclude it because selecting a layer is a navigation action, not a mutation. If users report this as a gotcha post-M6, revisit in a follow-up.

### D6 — Persistence backward-compat with M3–M5 single-layer saves

**Decision:** `loadDocument()` reads the IDB record; if `doc.layers.length >= 1`, use all of them. If `doc.layers.length === 1`, that's the M3–M5 single-layer shape and loads cleanly. If `doc.layers.length === 0` (corrupt or pre-M3), fall back to a fresh placeholder layer.

`activeLayerId` in the M3–M5 saves is the single layer's id (`'base'`) — it continues to be valid post-M6.

**Rationale:** M3 already persisted the full `layers: [singleLayer]` shape (verified in `persistence.ts:79-83`). The M6 load path is additive, not breaking. No migration needed. A user who saved M3 docs can open M6 and see their skin intact, with one "Base" layer.

### D7 — Hover overlays operate on composite, not active layer

**Decision:** `BucketHoverOverlay.tsx` and `PencilHoverOverlay.tsx` continue to read from wherever they read today (the store + layer pixels). For bucket, the flood-fill preview reads the active layer's pixels (accurate because the fill will happen on the active layer). For pencil, the single-pixel tint is just a position indicator, so it doesn't care.

**Rationale:** what the user sees on-screen IS the composite, but the bucket fill they're about to commit operates on the active layer's raw bytes. If a user hovers with bucket over a visually-uniform composite region that's actually two layers, the flood fill respects the active layer's boundaries, and the preview should show that (non-surprising). Deferred: a mode that flood-fills the VISIBLE composite region across layers (like Photoshop's "sample all layers" option) — future polish.

### D8 — Pointer-events drag-to-reorder (~100 LOC, no library)

**Decision:** LayerPanel implements drag-reorder with native Pointer Events:

1. `onPointerDown` on the row's grip icon (a dedicated drag handle, not the whole row — or the whole row on mobile).
2. `setPointerCapture(pointerId)`.
3. `onPointerMove` computes the current hover index via integer division on Y offset. Translates the dragged row via CSS `transform: translateY(dy)`. Non-dragged rows animate between index positions via `transition: transform 150ms`.
4. `onPointerUp` commits to `reorderLayers(from, to)` and releases capture.

Include explicit up/down arrow buttons per row as a keyboard-+-mobile fallback. Touch-action: none on the grip.

**Rationale:** research rejected `@dnd-kit/core` (~10 KB min+gzip) as over budget. `react-movable` is lighter (~5 KB) but still not worth it for 4-8 rows. Hand-rolled with pointer events is ~100 LOC and we already use `setPointerCapture` extensively (M4). Arrow buttons cover the accessibility case and give mobile users a fast path when they don't want to long-press.

**Gotcha:** jsdom pointer events are flaky (M4 known issue). Tests for drag-reorder are scoped to "click the up-arrow button" and "call store.reorderLayers directly and assert re-renders". The full pointer-drag path is manual-QA only.

### D9 — Redo through a deleted layer silently no-ops that entry

**Decision:** if the user deletes layer L, then undoes the delete (L reinstated), then re-deletes L, then attempts to redo a stroke that targeted L from before the undo cycle — the stroke-redo's `layerId` points to a layer that no longer exists in the current `layers[]`. The undo machinery skips the entry and advances the cursor.

**Rationale:** the alternative (rebuilding L from the stroke's "before" patches) would need a whole-layer snapshot, not just a dirty-rect diff, which breaks the memory budget. Silent-skip is what Photoshop does in analogous cases (undo history becomes inconsistent if you change underlying structure; PS shows a "Can't undo" message). For M6, silent-skip is cheap and correct; UX surprise is low because this only happens if the user explicitly deleted the target layer after making the stroke.

### D10 — Undo is ignored while a stroke is active

**Decision:** The undo shortcut handler checks a `strokeActive` flag in the store (or via a ref exposed by the paint surfaces). If true, the shortcut is a no-op.

**Rationale:** Aseprite and Krita both gate undo on `!currentStroke.active`. Mid-stroke undo would either (a) restore the before-image partway through, re-paint the half-stroke into the wrong place, or (b) silently commit the in-progress stroke then undo it — both confusing. Cheap to implement: paint surfaces already have `paintingRef`; expose as a store flag or via a getter. Both ViewportUV and PlayerModel's `paintingRef` can be mirrored to the store when they flip true/false.

## Open questions

### Resolved during planning

- **Q: Do we fix DESIGN §7's `composite()` in M6 or defer?** A: Fix in M6. See D1. The current implementation ships with the bug hidden because only 1 layer with opacity=1 is ever in use; M6 is the first milestone that could expose it.
- **Q: Single bbox vs array of patches for mirror strokes?** A: Array of patches. See D2.
- **Q: Is layer add/delete/reorder undoable?** A: Yes. See D3.
- **Q: How do we enforce the memory ceiling?** A: Dual caps (bytes + count), evict-oldest on overflow. See D4.
- **Q: Does picker push to undo?** A: No. It doesn't mutate pixels or structure.
- **Q: Does variant toggle (Classic ↔ Slim) push to undo?** A: No. See D5. Current behavior: variant toggle rebuilds the TM and triggers a fresh save.
- **Q: Does the undo shortcut work during a stroke?** A: No. See D10.
- **Q: Backward-compat with M3–M5 saves?** A: Fully compatible. See D6.
- **Q: Is the layer panel responsive below 280px?** A: Yes — stacks vertically in the 30vh mobile strip; same controls, compressed spacing.
- **Q: Default blend mode / opacity for new layers?** A: `'normal'` and `1.0`. Matches every other paint app.
- **Q: Default name for a new layer?** A: `'Layer N'` where N is the current `layers.length + 1`. Matches Photoshop/Procreate.

### Deferred to implementation

- **Exact size() formula for layer-lifecycle commands.** A fixed 64 bytes per command is a safe over-estimate (string lengths, IDs, etc). Test in Unit 3 asserts the byte counter stays under cap.
- **Keyboard shortcut conflict detection.** Cmd+Z and Ctrl+Z both fire on macOS (Ctrl+Z is the emacs `undo-line` shortcut in some terminals); we catch both. Cmd+Y on Windows/Linux is a common redo shortcut in addition to Cmd+Shift+Z — should we handle both? Defer: M6 ships Shift+Z only, per DESIGN §12.5 M6 spec. Add Cmd+Y later if users request.
- **LayerPanel drag-reorder animation polish.** ~100 LOC for the logic; polish (spring curves, ghost opacity, drop-zone highlight) is an implementation-time call.
- **How to visualize "active layer" when the panel scrolls and the active row is off-screen.** Probably a subtle indicator in the header ("Active: Layer 3 ▼") — decide in Unit 6 based on how the panel looks.
- **Whether to persist `activeLayerId` to IDB.** Low-value (next open resumes with the first layer active) but trivial. Defer to Unit 5.
- **Where exactly `strokeActive` lives (store slot vs. ref-bridge from paint surfaces).** Store slot is simpler but adds a field. Ref-bridge is leaner but couples the undo handler to the paint surfaces' internals. Decide in Unit 4 based on complexity.

## High-level technical design

### Undo stack data flow

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

```
Paint surface (ViewportUV or PlayerModel)
├─ pointerdown
│   └─ tool-dispatch.strokeStart(ctx, x, y)
│       └─ (M6 addition) recorder.beginStroke(activeLayer):
│           ├─ preImage = clone(activeLayer.pixels)          ← 1 × 16 KB clone per stroke
│           ├─ bboxAccum = null
│           └─ mirrorBboxAccum = null (if mirrorEnabled)
├─ pointermove (while painting)
│   └─ tool-dispatch.strokeContinue(ctx, fromX, fromY, toX, toY)
│       └─ (M6 addition) recorder.accumulate(touchedBbox, mirrorBbox?):
│           ├─ bboxAccum = union(bboxAccum, touchedBbox)
│           └─ mirrorBboxAccum = union(mirrorBboxAccum, mirrorBbox)
└─ pointerup
    └─ tool-dispatch.strokeEnd(ctx)
        └─ (M6 addition) recorder.commitStroke():
            ├─ patches = []
            ├─ patches.push({ bbox: bboxAccum, before: preImage.slice(bbox), after: layer.pixels.slice(bbox) })
            ├─ if (mirrorBboxAccum) patches.push({ bbox: mirrorBboxAccum, before: preImage.slice(mBbox), after: layer.pixels.slice(mBbox) })
            └─ undoStack.push({ kind: 'stroke', stroke: { id, layerId, patches, tool, mirrored } })
```

### Undo / redo application

```
undo():
  if cursor < 0: return false
  cmd = commands[cursor]
  switch cmd.kind:
    'stroke':
      for patch in cmd.stroke.patches:
        applyRegion(getLayerById(cmd.stroke.layerId).pixels, patch.bbox, patch.before)
      textureManager.composite(layers); markDirty()
    'layer-add':       store.deleteLayer(cmd.layer.id)
    'layer-delete':    store.insertLayerAt(cmd.layer, cmd.removedFrom)
    'layer-reorder':   store.reorderLayers(cmd.to, cmd.from)
    'layer-rename':    store.renameLayer(cmd.id, cmd.before)
    'layer-opacity':   store.setLayerOpacity(cmd.id, cmd.before)  // internal: no-undo mutation
    'layer-blend':     store.setLayerBlendMode(cmd.id, cmd.before)
    'layer-visibility':store.setLayerVisible(cmd.id, cmd.before)
  cursor--

redo():
  if cursor >= commands.length - 1: return false
  cursor++
  cmd = commands[cursor]
  // apply 'after' direction, same structure but with 'after' side of each diff
```

**INVARIANT:** `undo → redo → undo → redo` is bit-identical to the starting state. Tested in `tests/undo.test.ts` with a 10-stroke sequence.

### LayerPanel layout (sketch)

```
┌─────────────────────────────────┐
│  LAYERS                    [+]  │  ← header: count + add
├─────────────────────────────────┤
│▍[grip]👁 Layer 3  [N▾] ════ 80% │  ← active row: blend dropdown + opacity slider
│   [grip]👁 Layer 2  [N▾]    65% │  ← inactive row: blend dropdown + opacity % readout
│   [grip]👁 Layer 1  [Mu▾]  100% │
│   [grip]⌀ Base    [N▾]   100% │  ← visibility off = ⌀
└─────────────────────────────────┘
  ▍ = left-edge accent bar (D8 + research)
```

Double-click the name to rename (inline `<input>`; Enter commits, Escape cancels).

## Implementation Units

- [ ] **Unit 0: Amend DESIGN.md + carry M5 review gotchas**

**Goal:** Amend DESIGN.md §4, §7, §8 with the M6 decisions (D1, D2, D4, D5). Address any /ce:review findings on the M5 PR.

**Requirements:** R11 (regression-free), DESIGN accuracy.

**Dependencies:** None.

**Files:**
- Modify: `docs/DESIGN.md` (§4 Stroke shape → patches; §7 composite pseudo-code → scratch + drawImage; §8 undo stack → dual caps + layer commands).
- Read: any `/ce:review` comments on the M5 PR. If any P1 carried over, escalate to Unit 1 as prerequisite fix (follows M4's Unit 0 precedent).

**Approach:** Pure doc edits + review triage. Small.

**Test scenarios:** none (doc-only).

**Verification:** DESIGN.md diff reviewed against D1/D2/D4/D5 rationale. `npm run test` baseline is still 260/260.

- [ ] **Unit 1: Types + store shape (multi-layer)**

**Goal:** Extend `Layer`, `Stroke`, and the store to N-layer state. All M5 test paths stay green because the single-layer shape is still the default seed.

**Requirements:** R2, R6, R11.

**Dependencies:** Unit 0.

**Files:**
- Modify: `lib/editor/types.ts` — `Stroke.patches: Array<{bbox, before, after}>`. `Layer` unchanged.
- Modify: `lib/editor/store.ts` — add `layers: Layer[]`, `activeLayerId: string`, `strokeActive: boolean` (for D10 undo guard). Actions: `addLayer`, `deleteLayer`, `reorderLayers`, `renameLayer`, `setLayerOpacity`, `setLayerBlendMode`, `setLayerVisible`, `setActiveLayerId`, `setStrokeActive`. Store has a `reducer` helper: `internal_applyLayerCommand(cmd)` that the undo stack calls on undo/redo — bypasses the push-to-undo path (since undo/redo themselves don't push).
- Modify: `lib/editor/use-texture-manager.ts` — return `{textureManager, layers, activeLayerId, activeLayer}` instead of `{textureManager, layer}`. On store-layers-change, re-composite.
- Create: `tests/layer-store.test.ts` — add/delete/reorder/rename/opacity/blend/visibility semantics + narrow-selector identity guards.
- Modify: `tests/store.test.ts` — existing tests migrated to use `activeLayer` where they currently read `layer`.

**Approach:** Store shape is additive where possible. Seed: one Layer (`'base'`) from `createPlaceholderSkinPixels(variant)`, matching M3–M5 behavior. `activeLayerId = 'base'` initially. Subsequent layers get IDs via `crypto.randomUUID()` (browser-standard; no polyfill needed).

**Execution note:** Test-first for store actions. Narrow-selector re-render guard tests are load-bearing.

**Patterns to follow:** `tests/hover-store.test.ts` skeleton; `lib/editor/store.ts` identity-guard pattern (M3 mirror → M5 mirror toggle pattern).

**Test scenarios:**
- Happy path: `addLayer()` appends a new layer, sets it active, returns the new id.
- `deleteLayer(id)` removes; if active layer deleted, next layer becomes active; if last layer, spawn a fresh base (or refuse — decision: refuse deletion of last layer, return false).
- `reorderLayers(from, to)` reorders; `activeLayerId` follows the layer to its new position.
- `renameLayer(id, name)` updates name; rejects empty string (defensive — layer must have a name).
- `setLayerOpacity(id, v)` clamps to [0, 1]; narrow-selector subscriber re-renders only when the specific layer's opacity changes.
- `setLayerBlendMode(id, mode)` validates the mode is one of the four (TypeScript already guards this).
- `setLayerVisible(id, v)` toggles; affects composite on next pass.
- `setActiveLayerId(id)` no-op if id not found.
- `setStrokeActive(bool)` identity-guarded (false→false is no-op).
- Narrow-selector: LayerPanel subscribers don't re-render when unrelated store slots mutate (brushSize, activeColor).
- Type check: `Stroke.patches` is `Array<{bbox, before, after}>`.

**Verification:** 12–15 new tests pass. All M5 tests still pass after migration. tsc clean.

- [ ] **Unit 2: Diff helpers + texture composite fix**

**Goal:** Pure-function dirty-rect slicers + the `composite()` fix from D1. These are leaf utilities the undo stack and TextureManager depend on.

**Requirements:** R4, R6, R11, R12.

**Dependencies:** Unit 1.

**Files:**
- Create: `lib/editor/diff.ts` — `sliceRegion(pixels, bbox): Uint8ClampedArray` + `applyRegion(pixels, bbox, region): void` + `unionBbox(a, b): Bbox` + `boundsOf(x, y, w, h): Bbox`.
- Modify: `lib/editor/texture.ts` — introduce module-scoped scratch `OffscreenCanvas(64, 64)` (fallback: `document.createElement('canvas')` for jsdom / older Safari). `BLEND_MODE_MAP: Record<BlendMode, GlobalCompositeOperation>` with the four mappings. Rewrite `composite()` per D1.
- Create: `tests/diff.test.ts` — round-trip + union tests.
- Modify: `tests/texture-manager.test.ts` — add scenarios for `opacity < 1` and each of the four blend modes.

**Approach:** Pure function first; canvas-backed fix second. Both are independently testable.

**Execution note:** Test-first for `composite()` — the correct behavior is load-bearing and silently-wrong is worst case.

**Patterns to follow:** `lib/editor/tools/pencil.ts` zero-alloc shape (diff.ts stays allocation-free in the `applyRegion` hot path; `sliceRegion` allocates once — acceptable since it's called only at stroke-end).

**Test scenarios:**
- **sliceRegion:**
  - Happy path: slice a 10×10 region from a 64×64 RGBA buffer returns exactly 400 bytes with the right bytes.
  - Edge: slice at (0, 0) with w=1 h=1 returns 4 bytes.
  - Edge: slice at (63, 63) w=1 h=1 works (last pixel).
  - Edge: slice w=0 h=0 returns empty Uint8ClampedArray.
- **applyRegion:**
  - Happy path: round-trip `applyRegion(pixels, bbox, sliceRegion(pixels, bbox))` is identity.
  - Happy path: `applyRegion` onto a zeroed buffer produces the right pattern.
- **unionBbox:**
  - Happy path: union of two overlapping rects.
  - Happy path: union of two disjoint rects (the envelope).
  - Edge: union with null → returns the other.
- **composite() (texture-manager.test.ts additions):**
  - Happy path: single layer opacity=1 normal matches the old path's output exactly.
  - Happy path: two layers, top opacity=0.5 normal → composite RGBA is the expected blend.
  - Happy path: multiply two layers (50% gray multiplied with 50% gray = 25% gray).
  - Happy path: screen two layers (50% gray screened with 50% gray = 75% gray).
  - Happy path: overlay: verify the formula against the spec for at least one known input.
  - Edge: invisible layer is skipped (no contribution to composite).
  - Edge: transparent top layer (alpha=0 pixels) preserves bottom layer's pixel (no `source-atop` guard needed per research).

**Verification:** 12+ new tests pass. M5 tests still pass. tsc + lint clean.

- [ ] **Unit 3: UndoStack class + command union + memory caps**

**Goal:** The core undo engine. Pure logic, fully unit-testable without UI.

**Requirements:** R5, R6, R7, R8, R9, R10.

**Dependencies:** Unit 1, Unit 2.

**Files:**
- Create: `lib/editor/undo.ts` — `UndoStack` class. `push(cmd)`, `undo(store)`, `redo(store)`, `canUndo()`, `canRedo()`, `bytesUsed()`, `clear()`. Accepts a `store` argument (the zustand store instance or a minimal adapter interface with `getState` + internal action accessors) so undo.ts stays pure of React / JSX. Command union per D3.
- Create: `tests/undo.test.ts` — stack semantics + byte cap + count cap + redo truncation + involution + stroke-active guard.

**Approach:** Class-based (mirrors DESIGN §8's original sketch). State: `commands: Command[]`, `cursor: number`, `bytesUsed: number`. Push: splice cursor+1 onwards, append, evict-oldest while over caps.

**Execution note:** Test-first. Undo/redo involution (undo → redo → undo === undo) is the load-bearing invariant.

**Patterns to follow:** Stateful-class shape similar to `lib/editor/texture.ts` (class with private fields, public methods, no React hooks).

**Test scenarios:**
- **Stroke commands:**
  - Happy path: push a pencil stroke → undo restores pixels to `before` → redo restores to `after`.
  - Happy path: push two strokes → undo twice → redo twice → pixels match original end-state.
  - Mirror atomic: push a mirrored stroke (patches.length=2) → undo once restores both sides.
- **Layer-lifecycle commands:**
  - Happy path: push a layer-add → undo removes the layer → redo re-adds it at the same index.
  - Happy path: push a layer-delete (active layer) → undo restores the layer at its original index; active stays pointed at the restored layer.
  - Happy path: push a layer-reorder → undo reverts the order → redo reorders again.
- **Memory caps (D4):**
  - Edge: push 101 strokes → stack length is 100 (oldest evicted); `bytesUsed()` reflects the sum of remaining 100.
  - Edge: push strokes until bytesUsed exceeds 5 MB → oldest evicted to get under cap.
  - Edge: eviction doesn't corrupt cursor — after eviction, `canUndo()` still reflects the correct remaining undo depth.
- **Redo truncation (D10/R9):**
  - Happy path: after 3 undos on a 5-command stack, push a new command → redo stack is truncated (the 3 discarded commands can't be redone).
  - Edge: truncation also adjusts `bytesUsed` — the 3 discarded commands' bytes are subtracted.
- **Stroke-active guard (D10/R10):**
  - Edge: `undo()` called with `store.strokeActive === true` is a no-op, returns false.
- **Deleted-layer redo (D9):**
  - Edge: push stroke on layer L → push layer-delete L → undo (L restored) → redo (L re-deleted) → undo twice (stroke undone on L, then L re-deleted is undone) — this is the ordinary happy path.
  - Edge: push stroke on layer L → push layer-delete L → undo layer-delete (L restored with pre-delete state) → undo stroke → redo stroke. L exists, stroke re-applies. ✓
  - Edge: post-M6 spec: silent-skip of redo against a missing layer is not reachable through normal user flow (you'd need to delete AFTER the redo point). Regression test: directly call `redo()` after manually dropping the target layer from store — assert it doesn't throw, returns false, and cursor doesn't advance.
- Involution: a sequence of [push, push, push, undo, undo, redo, push, push] ends in a stack state matching direct-application of the kept commands.

**Verification:** 20+ new tests pass. Undo engine is usable from any client; the zustand wiring lives in Unit 4.

- [ ] **Unit 4: Tool dispatcher diff-capture wrapper**

**Goal:** Every stroke the dispatcher completes emits a `Stroke` command into the undo stack. No change to the tool API.

**Requirements:** R6, R7, R10, R11.

**Dependencies:** Unit 1, Unit 2, Unit 3.

**Files:**
- Modify: `lib/editor/tools/dispatch.ts`:
  - `StrokeContext` adds `undoStack: UndoStack` + `onStrokeActive(boolean): void` (bridge to store's `setStrokeActive`).
  - Internal `StrokeRecorder` keeps per-stroke state: `preImage` (pre-stroke clone), `bboxAccum`, `mirrorBboxAccum` — initialized by `strokeStart`, updated by each tool's stamp, committed in `strokeEnd`.
  - `strokeStart` also flips `onStrokeActive(true)`.
  - `strokeEnd` flips `onStrokeActive(false)` + emits the `Stroke` command.
  - Each tool (pencil, eraser, bucket) computes its touched bbox and returns it to the recorder. Pencil/eraser: bbox is the stamp's N×N rect. Bucket: bbox is the island's bounding rect. Mirror: computed once per side via `mirrorAtlasPixel`.
  - Picker and non-mutating paths don't touch the recorder.
- Modify: `app/editor/_components/ViewportUV.tsx` + `lib/three/PlayerModel.tsx`:
  - Thread the undoStack instance + onStrokeActive callback into StrokeContext.
- Modify: `tests/tool-dispatch.test.ts` — add a fake-UndoStack spy + assertions that each tool emits the expected Stroke command shape.

**Approach:** The recorder lives inside dispatch.ts as a module-scoped `currentStroke: StrokeRecorderState | null`. Since both paint surfaces (2D + 3D) share the same dispatcher and we only have one active stroke at a time (confirmed by paintingRef logic), module state is safe. If we ever support cross-surface continuous strokes (currently out of scope), this needs revisiting.

**Execution note:** Test-first for the recorder — bbox accumulation across a Bresenham pencil drag is error-prone.

**Patterns to follow:** The existing dispatcher pattern; M3's `stampLine` out-param bbox convention.

**Test scenarios:**
- **Pencil stroke (non-mirrored):**
  - Happy path: `strokeStart` at (10, 10) → `strokeContinue` to (15, 15) → `strokeEnd` emits 1 Stroke with `patches.length === 1`, `patches[0].bbox` is the tight union of 6 stamps.
  - `patches[0].before` matches the pre-stroke pixel bytes of that bbox; `patches[0].after` matches the post-stroke bytes.
- **Pencil stroke (mirrored):**
  - Happy path: mirror enabled, `strokeStart` at rightArm.front (x, y) → `strokeEnd` emits 1 Stroke with `patches.length === 2`, `mirrored: true`. Primary bbox is tight; mirror bbox is tight at leftArm.front.
- **Eraser stroke (mirrored):**
  - Happy path: same shape as pencil mirrored, but `tool: 'eraser'`, `after` pixels are all zeros within bbox.
- **Bucket stroke (non-mirrored):**
  - Happy path: click on head.front → Stroke has `patches.length === 1`, bbox matches the head.front rect, `after` is fully the active color within the bbox.
- **Bucket stroke (mirrored):**
  - Happy path: click on rightArm.front → 2 patches, one at rightArm.front rect, one at leftArm.front rect. Both islands fully colored in `after`.
- **Bucket stroke on empty seed (island 0):**
  - Edge: click on (0, 0) → dispatcher returns false, NO stroke emitted to undoStack.
- **Picker one-shot:**
  - Edge: picker pointer event doesn't touch the recorder; undoStack is empty after.
- **Stroke-active flag:**
  - Happy path: during a drag (strokeStart … strokeContinue … strokeEnd), `setStrokeActive(true)` fires once on start, `setStrokeActive(false)` fires once on end.

**Verification:** 10+ new tests pass. M5 tool tests still pass after migration. Full test suite: M5 (260) + M6 prior units (~35) + new = ~305+.

- [ ] **Unit 5: Persistence extends to N layers**

**Goal:** Multi-layer documents save and restore correctly; M3–M5 single-layer saves still load.

**Requirements:** R13.

**Dependencies:** Unit 1.

**Files:**
- Modify: `lib/editor/persistence.ts`:
  - `buildDocument` reads `useEditorStore.getState().layers` + `activeLayerId` directly.
  - `loadDocument` accepts N layers; validates each layer's pixel length; fills missing fields with defaults if a malformed record is encountered.
  - `activeLayerId` is persisted (D9 deferred decision: yes, persist it — next open resumes in the same layer).
- Modify: `tests/persistence.test.ts`:
  - N-layer round-trip: build a 3-layer document, save, load, assert layer-by-layer bit-identity.
  - Backward-compat: manually construct a single-layer IDB record (M3–M5 shape), call `loadDocument`, assert it returns a valid doc with 1 layer.
  - Corrupt input: empty `layers` array → fallback to placeholder.
- Modify: `app/editor/_components/EditorLayout.tsx` — the hydrate path reads `doc.layers` and populates the store's `layers` directly (instead of copying into a single layer's pixels). Drop the "single layer is the single layer, just overwrite its pixels" short-circuit.

**Approach:** The persistence API shape doesn't change externally. Internally, build/load handle arrays.

**Patterns to follow:** Existing `persistence.ts` error-handling path (QuotaExceeded, Private-browsing probe).

**Test scenarios:**
- Happy path: 3-layer document saves and loads with bit-identical pixels per layer.
- Happy path: per-layer opacity / blendMode / visibility round-trip.
- Happy path: `activeLayerId` round-trip.
- Edge: single-layer M3–M5 save loads cleanly as a 1-layer doc.
- Edge: empty layers array → fallback to a fresh placeholder layer (same as fresh-install behavior).
- Edge: malformed layer (pixels.length mismatch) → skipped; document still loads with the remaining valid layers.

**Verification:** 6+ new persistence tests. Full M3 persistence tests still pass.

- [ ] **Unit 6: LayerPanel UI component**

**Goal:** The sidebar renders a functional LayerPanel — add/delete/reorder (via up/down arrows + hand-rolled pointer drag)/rename/opacity/blend/visibility/active-select. Active-layer affordance per D8.

**Requirements:** R1, R2, R3.

**Dependencies:** Unit 1.

**Files:**
- Create: `app/editor/_components/LayerPanel.tsx` — the panel. Sub-components (LayerRow, OpacitySlider, BlendModeSelect, VisibilityToggle, DragHandle) inline for the first pass; extract if the file grows past ~300 LOC.
- Modify: `app/editor/_components/Sidebar.tsx` — render `<LayerPanel />` below `<ColorPicker />`.
- Create: `tests/layer-panel.test.ts` — component tests.

**Approach:**
- Top-to-bottom UI order (top UI row = top layer visually = LAST in `layers[]` array, since layers is bottom-to-top). Map `layers.slice().reverse()` for rendering.
- Each row: `[grip] [eye] [name double-click→input] [blend-mode select] [opacity %/slider] [up] [down] [x]`.
- Active row: has the 3px left-edge accent bar + tinted background. Opacity slider expanded.
- Inactive row: no accent; `%` readout in place of slider.
- Drag-reorder: pointerdown on grip captures pointer; pointermove translates; pointerup commits `reorderLayers(from, to)`.
- Arrow buttons: keyboard + touch fallback. `up` button: if index is not top, swap with index+1 (visual) = reorder in `layers[]`.
- Add button in header: `addLayer()` → new layer inserted above active → becomes active.
- Delete button (trash icon) in row: `deleteLayer(id)`. If last layer, button is disabled.
- Rename: double-click the name → inline `<input type="text">`; Enter commits, Escape cancels, blur commits.

**Execution note:** Test-first for store-action wiring (click up-arrow dispatches `reorderLayers`). Manual QA for drag-reorder pointer flow (jsdom pointer events are flaky).

**Patterns to follow:** `app/editor/_components/ColorPicker.tsx` for narrow-selector subscriptions per sub-component. `app/editor/_components/Toolbar.tsx` for the row/button skeleton.

**Technical design:** *(directional guidance — see High-Level Technical Design above for the panel sketch)*

**Test scenarios:**
- Happy path: panel renders 1 row for the initial single layer; active.
- Happy path: click `+` → a second row appears; new layer is active; previous layer is inactive.
- Happy path: click up-arrow on the top layer → `reorderLayers` is called with correct args; panel re-renders in new order.
- Happy path: double-click name → input appears; type "New" + Enter → store renames to "New".
- Happy path: change blend-mode via `<select>` → store action fires with new mode.
- Happy path: drag opacity slider → store action fires with clamped [0, 1] value on every change; `pushUndoEntry` fires once on pointerup with before/after.
- Happy path: click eye → visibility toggles; composite recomputes (verify by checking `markDirty` was called).
- Happy path: click a row → `setActiveLayerId` fires; active-affordance classes update.
- Edge: delete the only layer → delete button is disabled.
- Edge: can't rename to empty string (blur/Enter with empty value reverts).
- Edge: 5-layer panel fits in the sidebar (40px row height × 5 = 200 px + header ≈ 240 px, well under 280px sidebar width).
- Narrow-selector: a pixel stroke on active layer does NOT re-render any LayerPanel row (only the composite canvas changes).

**Verification:** 12+ component tests. Full sidebar renders correctly in dev server. Manual QA: drag-reorder works on desktop; up/down arrows work on mobile.

- [ ] **Unit 7: Keyboard shortcuts (Cmd/Ctrl+Z / Shift+Z) + EditorLayout wiring**

**Goal:** Cmd+Z undoes; Cmd+Shift+Z redoes. Focus-guarded + modifier-guarded. Undo stack lives in EditorLayout (the top editor component that has access to layers + undoStack).

**Requirements:** R5, R10.

**Dependencies:** Units 3, 4.

**Files:**
- Modify: `app/editor/_components/EditorLayout.tsx`:
  - Instantiate `new UndoStack()` on mount; dispose on unmount.
  - Thread `undoStack` into the dispatcher's StrokeContext (via a stable closure in ViewportUV + PlayerModel props OR via a React context).
  - Install a window keydown listener: `Cmd/Ctrl+Z` → `undoStack.undo(store); recomposite`. `Cmd/Ctrl+Shift+Z` → `undoStack.redo(store); recomposite`. Modifier-guarded: `meta XOR ctrl`; Alt not allowed. Focus-guarded: skip on INPUT/TEXTAREA/contentEditable/role=application.
  - Undo-ignored-during-stroke: check `useEditorStore.getState().strokeActive` before invoking.
- Modify: `lib/editor/tools/dispatch.ts`:
  - Stroke-active flip is already in Unit 4. No-op here; just verify the contract.
- Create: `tests/undo-shortcuts.test.ts` — keyboard event dispatch + store assertions.
- Modify: `app/editor/_components/LayerPanel.tsx` (Unit 6) — Layer lifecycle actions push to the same undo stack. Wire here by passing an `onUndoPush(cmd)` callback prop or via a React context.

**Approach:** Following the Toolbar.tsx shortcut pattern. Keep the undoStack instance out of the store (prevents accidental serialization to IDB). The undoStack is scoped to the editor session; a page reload starts a fresh stack (acceptable — matches Photoshop/Figma/Procreate web behavior).

**Execution note:** Test-first for the shortcut handler — modifier combinations are easy to get wrong.

**Patterns to follow:** `app/editor/_components/Toolbar.tsx` M5 shortcut handler (modifier + focus guard shape).

**Test scenarios:**
- Happy path: paint a pencil stroke → Cmd+Z → pixels restored to pre-stroke state.
- Happy path: paint 10 strokes → Cmd+Z × 10 → blank canvas.
- Happy path: undo then Cmd+Shift+Z → stroke re-applied.
- Edge: Ctrl+Z on Linux/Windows works too.
- Edge: Cmd+Y does NOT trigger redo (spec is Cmd+Shift+Z only).
- Edge: Alt+Cmd+Z is not interpreted as undo (Alt blocks per focus-guard convention).
- Edge: Cmd+Z while focus is in the hex input is a no-op.
- Edge: Cmd+Z during an active stroke (strokeActive true) is a no-op.
- Edge: 101 strokes then Cmd+Z × 100 restores to the state AFTER the first stroke (first stroke is evicted from the stack).
- Layer add + undo: click `+` in LayerPanel → Cmd+Z removes the new layer.
- Layer delete + undo: click delete → Cmd+Z restores the layer in its original position.

**Verification:** 10+ shortcut tests pass. Manual QA: Cmd+Z in the editor undoes a pencil stroke visibly in real time.

- [ ] **Unit 8: Integration sweep + bundle audit + PR**

**Goal:** End-to-end verification. Manual acceptance. Bundle size.

**Requirements:** R1–R13.

**Dependencies:** Units 0–7.

**Files:** no new; verification-only.

**Approach:** Run the full suite (`npm run lint`, `npx tsc --noEmit`, `npm run test`, `npm run build`). Manual acceptance per the list below. Measure bundle delta (+15 kB budget).

**Test scenarios:** See Acceptance Criteria below.

**Verification:**
- All M1–M5 tests pass (260 baseline).
- New M6 tests pass (estimated ~70–100: Unit 1 ~14, Unit 2 ~14, Unit 3 ~22, Unit 4 ~10, Unit 5 ~7, Unit 6 ~14, Unit 7 ~12).
- Bundle delta ≤ +15 kB First Load JS.
- All manual acceptance items pass in `npm run dev`.

## System-Wide Impact

- **Interaction graph:** `UndoStack` is a new module consumed by EditorLayout (owns the instance), the dispatcher (pushes strokes), and LayerPanel (pushes layer-lifecycle commands). Store gains a `layers` array + `activeLayerId` + `strokeActive` + the full set of layer-lifecycle actions. Dispatcher's `StrokeContext` shape changes (adds undoStack + strokeActive callback). `TextureManager.composite` signature unchanged but internal algorithm rewritten.
- **Error propagation:** `UndoStack.undo/redo` return `false` on empty / dead-layer — callers no-op. `bucketFill` on non-island seed still returns `{changed: false}`; dispatcher's stroke recorder skips the undo emit. Deleting the last layer is refused at the store level.
- **State lifecycle:** `UndoStack` is session-local (not persisted). A page reload gives a fresh empty stack. `strokeActive` is cleared on bundle teardown. IndexedDB doc grows from ~16 KB (single layer pixels + metadata) to ~16 KB × N layers — persists fine under idb-keyval's quota budget (Safari ~1 GB default).
- **API surface parity:** The dispatcher's internal StrokeContext signature is a private-ish contract; all consumers (ViewportUV, PlayerModel, tests) update together. External consumers of the dispatcher don't exist yet.
- **Integration coverage:** Dispatcher + undoStack integration tested in Unit 4. Full-stack pencil-stroke → undo → redo → identical pixels is tested in Unit 7. R3F integration remains manual-QA.
- **Unchanged invariants:**
  - Zero-allocation in pointer hot paths (M3). Diff capture is at stroke-end, not per stamp. `strokeStart` allocates one pre-image clone; no new allocations in `strokeContinue`.
  - Narrow-selector contract (M3). All new LayerPanel rows subscribe narrowly to their own layer's fields. Re-render cost scales O(layers-changed), not O(layers-total).
  - Caller-owned GPU disposal (M2, M4). No new GPU resources; scratch canvas is 2D.
  - R3F paint pattern 8 decisions (M4). Dispatcher + tools still honor Y-flip, clampAtlas, stopPropagation, pointer capture, button filter, dedup refs, flushLayer-in-stroke-composite-on-end, per-frame-only on 3D drags.
  - Persistence backward-compat (M3). Single-layer M3–M5 saves continue to load as 1-layer documents.

## Risks & Dependencies

| Risk | Level | Mitigation |
|---|---|---|
| DESIGN §7's `composite()` bug lurks in a subtle blend-mode regression that only manifests at opacity<1 — a user's M6 save with opacity=0.5 and blendMode='multiply' doesn't round-trip correctly | P1 | Unit 2 test-first for composite(). Golden-output tests for each blend mode with known inputs. |
| Mirror-stroke two-patch bbox capture gets one of the two bboxes wrong (e.g., bbox is stale because the mirror stamp happened AFTER the primary bbox was sealed) | P1 | Unit 4 test-first. Mirror-pencil + mirror-bucket test cases explicit. |
| Redo after a layer delete falls through a `null` reference in the stroke's `layerId` lookup | P2 | D9 silent-skip; Unit 3 edge test for missing-layer redo. |
| Opacity slider drag pushes hundreds of undo entries per drag instead of one per drag-end | P2 | Slider tracks `before` on pointerdown; push on pointerup with `{before, after}`. Unit 6 test covers. |
| LayerPanel drag-reorder janks in Safari (pointer events differ subtly) | P3 | Hand-rolled pointer events (no library). Manual QA on Safari. Arrow-button fallback as accessibility + Safari-jank-insurance. |
| Undo stack memory ceiling not enforced → 500 strokes accumulate to 20 MB → tab tab GC-pauses | P2 | Unit 3 test for 5MB cap. Hard count-cap of 100 as secondary safety. `bytesUsed()` exposed for debug. |
| Cmd+Z fires while user is in a hex input field or role=application color picker | P2 | Focus-guard on shortcut handler (same pattern as M5 shortcut tests). Unit 7 tests. |
| Hydration race: multi-layer document loads, but the store applies layers after the TextureManager composite runs on stale single-layer state | P2 | EditorLayout's hydrationPending gate (M4 Unit 0) extends: hydrate sets layers in the store BEFORE composite. Unit 5 test: hydrate-then-composite is bit-identical to fresh-paint-same-layers. |
| Mirror + mirror + mirror stroke across variant toggle → LUT rebuilds → mirror-patch bbox is wrong for the new variant | P3 | `useEffect([textureManager, activeLayerId])` race-reset pattern. Recorder is cleared on bundle change. |
| Bundle delta exceeds +15 kB | P3 | LayerPanel is pure DOM (no drei). Drag-reorder is hand-rolled. Likely 5–10 kB of new JSX + undo logic. Measure in Unit 8. |
| M5 dispatcher's module-scope `currentStroke` state conflicts with a future cross-surface stroke feature | P3 | Documented; out of M6 scope. If cross-surface strokes ever land, recorder moves to per-surface state. |

## Documentation / Operational Notes

- **Update `docs/COMPOUND.md` M6 entry** via `/ce:compound` post-merge. Pre-flagged captures:
  - The `putImageData` gotcha — the 7-year-old bug hidden by single-layer state.
  - The scratch-canvas + drawImage composite pattern.
  - The `patches: Array<...>` vs single-bbox decision for mirror strokes.
  - The `MAX_HISTORY_BYTES` + `MAX_HISTORY_COUNT` dual cap.
  - Layer lifecycle as undoable commands (DESIGN §8 extension).
  - Hand-rolled drag-reorder (~100 LOC) as a viable alternative to `@dnd-kit`.
  - Narrow-selector pattern extending to N-row LayerPanel.
- **Create `docs/solutions/integration-issues/canvas-composite-putimagedata-gotcha-2026-04-21.md`** — the `putImageData` vs `drawImage` / `globalCompositeOperation` gotcha deserves a permanent solution doc. Future milestones adding new composite paths (M8 PNG export) will reuse.
- **Amend `docs/DESIGN.md` §4** — `Stroke.patches` shape.
- **Amend `docs/DESIGN.md` §7** — composite pseudo-code → scratch + drawImage.
- **Amend `docs/DESIGN.md` §8** — command union + dual caps + stroke-active guard + redo truncation invariant.
- **No new CVE surface** — zero new dependencies.
- **No operational concerns** — client-only, no backend, no env vars, no migrations.

## Acceptance Criteria

### Automated (all must pass before PR open)

1. `npm run lint` — 0 errors / 0 warnings.
2. `npx tsc --noEmit` — 0 errors.
3. `npm run test` — all M5 tests pass (260) + all new M6 tests pass (~80–100). Targeted coverage per unit: Unit 1 ~14, Unit 2 ~14, Unit 3 ~22, Unit 4 ~10, Unit 5 ~7, Unit 6 ~14, Unit 7 ~12.
4. `npm run build` — succeeds, both routes generated, no new warnings.
5. Bundle delta: `/editor` First Load JS ≤ **378 kB** (M5 baseline 363 + 15 budget).
6. HTTP 200 on `/` and `/editor` via `npm run dev`.
7. Zero `any` types added in `app/` or `lib/`.
8. Zero new dependencies in `package.json`.

### Manual (verified on `npm run dev` before PR ready-for-merge)

9. **[R1]** LayerPanel renders; active layer is unmistakable (bg tint + left-edge accent bar).
10. **[R2]** Click `+` → a new layer appears, becomes active, is named "Layer 2". Click delete on it → layer disappears.
11. **[R2]** Drag a non-active layer's grip up or down → layers reorder visually AND in composite order on 2D/3D.
12. **[R2]** Double-click a layer name → input appears, type + Enter → name updates.
13. **[R3]** Drag the opacity slider on the active layer → composite opacity changes in real time on both 2D and 3D.
14. **[R3]** Change blend-mode dropdown to 'multiply' → composite visibly differs.
15. **[R3]** Click eye icon → layer disappears from composite.
16. **[R4]** A 3-layer skin with opacity < 1 and blend = 'multiply' on the top layer renders correctly on BOTH 2D canvas AND 3D model.
17. **[R5]** Paint a pencil stroke → Cmd/Ctrl+Z → stroke disappears. Cmd/Ctrl+Shift+Z → stroke reappears.
18. **[R7]** Paint a mirror stroke → Cmd+Z once → BOTH sides disappear.
19. **[R7]** Paint a bucket fill → Cmd+Z once → fill disappears.
20. **[R9]** Paint 3 strokes, undo 2, paint a 4th → redo is disabled (can't redo past the cut).
21. **[R10]** Hold pointer down in the middle of a pencil drag, press Cmd+Z → nothing happens until pointer released.
22. **[R11]** All M5 manual acceptance items still work (every tool on 2D + 3D, mirror toggle, hover preview, etc).
23. **[R13]** Reload the page mid-session → all layers restored with correct opacity/blend/visibility/pixels.
24. **[Chrome / Safari / Firefox]** LayerPanel drag-reorder works in all three browsers (manual QA).

### Manual — bundle + performance

25. `/editor` First Load JS ≤ 378 kB on `npm run build` output.
26. Paint a 50-stroke stress test → undo 50 times → redo 50 times. Frame rate stays ≥ 55 fps in Chrome DevTools. Undo stack `bytesUsed()` reads under 500 KB.
27. Paint a 100-bucket-fill stress test → `bytesUsed()` stays under 5 MB; first-stroke evicted when 101st fill lands.

## Sources & References

- **DESIGN.md §4** — Core data types (Layer, SkinDocument, Stroke). Amend per D2.
- **DESIGN.md §7** — Texture write pipeline (composite pseudo-code). Amend per D1.
- **DESIGN.md §8** — Undo stack class sketch. Amend per D3/D4/D5/D10.
- **DESIGN.md §12.5 M6** — Milestone plan + review questions.
- **`docs/COMPOUND.md` M3** — Narrow-selector convention, `useEffect([textureManager, layer])` race-reset, hydrationPending gate.
- **`docs/COMPOUND.md` M4** — `hoveredPixel` store slot, Uint16Array LUT pattern, R3F paint pattern.
- **`docs/COMPOUND.md` M5** — Tool dispatcher pattern, Record<Union, T> for exhaustive maps, modifier-guarded keyboard shortcuts.
- **`docs/solutions/integration-issues/r3f-pointer-paint-on-textured-mesh-2026-04-20.md`** — M4's canonical R3F paint pattern. M6 doesn't extend; only the diff-capture wrapper is new.
- **`lib/editor/tools/dispatch.ts` (M5)** — The single write-point for every tool. Diff capture attaches here.
- **WHATWG HTML Living Standard §4.12.5.1.14** — `putImageData` ignores globalAlpha + globalCompositeOperation.
- **W3C Compositing and Blending Level 1** — Canvas2D blend mode canonical strings (multiply, overlay, screen, source-over).
- **Aseprite symmetry docs** (https://www.aseprite.org/docs/symmetry/) — multi-patch atomic undo for symmetric strokes.
- **Krita undo history** (https://docs.krita.org/en/reference_manual/dockers/undo_history.html) — byte-cap + count-cap memory ceiling.
- **Procreate managing undo history** (https://help.procreate.com/articles/dxxgnk-managing-undo-history) — 250-step default hard-cap.
- **Related PRs:** #7 (M5 merge; just merged). No M6 PR yet.

## /ce:plan review answers

### 1. Hardest decision

Whether DESIGN §4's single-bbox Stroke shape (M6 plan would inherit it unchanged) vs. a `patches: Array<...>` amendment. The one-line spec change — from `before, after, bbox` to `patches: Array<{before, after, bbox}>` — propagates through every subsystem: the dispatcher's recorder emits N patches, the undo stack's apply-diff iterates, memory math sums N patches. The alternative (one giant spanning bbox) fails the 5 MB budget for realistic mirror-heavy sessions, but "passes the spec" if we read DESIGN literally.

Decided to amend DESIGN. The spec was written before mirror-as-modifier was decided (M5 promoted mirror to a modifier per D1 of that plan), and the single-bbox shape made more sense when mirror was a tool you actively selected and where you'd naturally mirror adjacent atlas regions. Now that M5's mirror lives in the dispatcher and the tools write arbitrary atlas pixels (including cross-limb mirrors 30 rows apart), the cost math changed. D2 documents the change and the cost reasoning.

Secondary hardest decision: whether layer lifecycle (add/delete/reorder) goes into the same undo stack as pixel strokes. Separate stacks (pixel undo vs structure undo) is simpler internally but confuses the user — "Cmd+Z didn't do what I expected because I did a layer-delete just now, and that went to a different stack." Unified stack matches user expectation and matches Figma/Linear/Notion's 2026-standard behavior. D3 documents the union-type cost.

### 2. Alternatives rejected

- **Keep DESIGN §4's single-bbox Stroke shape.** Rejected per D2. Spec was written pre-mirror-as-modifier.
- **Keep DESIGN §7's `putImageData`-per-layer composite.** Rejected per D1. Broken for opacity<1 and any blend mode.
- **Separate undo stack for layer lifecycle vs pixel strokes.** Rejected per D3. Confuses user mental model.
- **Per-pixel RLE for bucket-fill diffs.** Rejected per research. Dense-island bboxes don't compress well; overhead outweighs savings.
- **Dropbox-style "swap undo to disk when RAM cap hit".** Rejected per D4. 5 MB in-memory is fine for a 64×64 editor.
- **`@dnd-kit/core` for drag-reorder.** Rejected per D8 + research. +10 kB bundle too much for 4–8 rows.
- **Confirm dialog on layer delete.** Rejected per D3. Undo is the 2026-standard safety net; dialogs are friction.
- **Active-layer affordance via border only (no bg tint).** Rejected per research. Photoshop/Procreate/Figma all use multiple signals; a border alone gets lost at small sizes.
- **Undo for view state (zoom, pan, tool, color).** Rejected per D5. Not pixel/structure mutations; user doesn't expect them to undo.
- **Undo for variant toggle (Classic ↔ Slim).** Rejected per D5. Requires snapshotting the full multi-layer document; out of scope.
- **Redo-through-deleted-layer reconstructs the layer from stroke history.** Rejected per D9. Requires whole-layer snapshots in Stroke records, breaking the memory budget.
- **Layer groups / folders.** Rejected as out of scope. Aseprite has them but it's a large UX surface; defer to future polish.
- **Per-layer lock toggle.** Rejected as out of scope. Nice-to-have; not in DESIGN §12.5 M6.
- **"Sample all layers" picker mode.** Rejected per D7 as out of scope. M5 picker reads active layer only; future polish can add a composite-sampling toggle.
- **Cross-session undo history (persist to IDB).** Rejected as out of scope. Session-local matches Photoshop / Figma / Procreate web behavior; persisting undo would need schema versioning + migration.
- **"Hide from history" for minor ops (like bucket fill).** Rejected per DESIGN §12.5 M6 review bullet "Bucket fill → single undo step." Bucket IS a stroke.

### 3. Least confident

The mirror-patch bbox accumulation in the dispatcher's recorder. The current M5 dispatcher applies a mirror stamp inside `strokeStart`/`strokeContinue` for pencil + eraser (per-stamp) and a second bucket fill for bucket (per-seed). The recorder needs to track BOTH the primary and mirror bbox. Two ways to implement:

**(a)** Dispatcher emits two separate `touchedBbox` values per stamp (primary, mirror) to the recorder. Recorder accumulates both. Clean separation.

**(b)** Dispatcher stamps both sides, then the recorder diffs the pre-image against the post-image after the stroke to COMPUTE the changed bboxes. Simpler dispatcher, but requires a full-buffer diff-scan at stroke-end (4096 comparisons).

Option (a) is faster and fits the existing `stampLine` out-param bbox pattern. Option (b) is simpler but adds stroke-end latency (negligible at 64×64 but philosophically wrong).

Chose (a). Unit 4 test-first will verify the bbox accumulation is correct for mirror + pencil drag + bucket (where the "mirror bbox" is the full mirror island rect). If the tests reveal an edge case where (a) is subtly wrong, fall back to (b) — it's a 10-line change.

Next-least-confident: whether `pushUndoEntry` for opacity-drag-end should capture `before` on pointerdown or on the first drag move. Current plan: on pointerdown. If the user pointerdowns but doesn't drag, we push an entry where `before === after` which is a no-op. Cheaper to skip the no-op: the store-level `setLayerOpacity` detects same-value and returns early; if that's true, don't push. Implementer decides in Unit 6.
