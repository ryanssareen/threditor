---
title: M5 — Tool Palette (Eraser, Picker, Bucket, Mirror)
type: feat
status: active
date: 2026-04-20
milestone: M5
depth: Standard
---

# M5 — Tool Palette

> **Final save target:** `docs/plans/m5-tool-palette-plan.md` (matches `m1-scaffold.md` / `m2-player-model-plan.md` / `m3-paint-canvas-plan.md` / `m4-paint-bridge-plan.md` convention).
> **Origin:** `/ce:plan` invocation on 2026-04-20, immediately after M4 merge. No upstream requirements doc — feature scope is pinned by `docs/DESIGN.md` §9 / §9.1 / §9.2 / §12.5 M5.
> **Plan type:** **Standard** (4 new tools + one modifier + toolbar UI + keyboard shortcuts; most load-bearing infrastructure (island-map, flood-fill, tool dispatch surface) already landed in M3/M4).

## Context

M1 shipped the scaffold. M2 shipped the 3D player model. M3 shipped the 2D paint surface, color picker, pencil, and IndexedDB auto-save — plus it quietly landed three dormant subsystems (`lib/editor/island-map.ts` + `lib/editor/flood-fill.ts` + `app/editor/_components/BucketHoverOverlay.tsx`) whose only consumer is M5's bucket tool. M4 shipped the 2D↔3D paint bridge with bidirectional hover + overlay/base precedence + `OrbitControls`. M4 post-merge absorbed three P0/P1 fixes from `/ce:review` (button-filter, pointer capture, hover-stopPropagation) and one P2 (removed the misleading `raycaster.firstHitOnly = true`).

M5 turns the existing pencil-only tool surface into the full five-tool palette locked by DESIGN §9: **Pencil** (already works), **Eraser**, **Picker**, **Bucket**, **Mirror**. Per DESIGN §9.1 island-aware flood fill is already implemented in `flood-fill.ts` and gated by the `island-map.ts` LUT; M5 is mostly wiring, not new algorithms.

Two strategic calls:

1. **Mirror is a persistent modifier, not a tool.** DESIGN §9 table says "Mirror | M | Toggles X-axis symmetry on **subsequent** strokes." That's a boolean toggle that modifies how pencil/eraser/bucket behave, not a tool swap. M5 removes `'mirror'` from the `ToolId` union (currently a scaffolded placeholder) and adds a `mirrorEnabled: boolean` store slot.
2. **Introduce a paint dispatcher.** Currently PlayerModel.tsx and ViewportUV.tsx each do their own `stampPencil` call inline. With 4 tools, two surfaces, and a mirror modifier, the combinations explode. A single `strokeStart/Continue/End` + `samplePickerAt` module centralizes tool dispatch and mirror application so paint-surface code shrinks.

## Overview

Ship the five-tool palette. Eraser zeros RGBA on the active layer. Picker samples the composite pixel under cursor and sets `activeColor`. Bucket flood-fills the clicked island (no UV seam bleed) using the existing scanline implementation. Mirror is a toggle that replays every non-picker stroke to the X-mirrored atlas pixel via a pre-computed LUT. Toolbar swaps 'M5' disabled labels for real buttons + keyboard shortcuts B/E/I/G/M (M for mirror toggle), all modifier-guarded (no Cmd+B / Ctrl+E collisions). Bucket hover preview (currently dormant) turns on when activeTool === 'bucket'.

Tool dispatch gets a single entry point (`lib/editor/tools/dispatch.ts`) so PlayerModel + ViewportUV both call the same `strokeStart/strokeContinue/strokeEnd` (and `samplePickerAt` for picker). Mirror logic lives in the dispatcher — paint surfaces don't know mirror exists.

## Pinned versions (delta from M4)

| Package | Previous (M4) | M5 | Notes |
|---|---|---|---|
| All M1–M4 pins | same | **unchanged** | No dependency additions needed. All tooling already in the tree (React, three, R3F, drei, zustand, idb-keyval, vitest, jsdom). |

**Peer-dependency check:** M5 adds **no new dependencies**. Every piece of machinery M5 needs already exists. This is the only Phase-1 milestone that should be version-stable end-to-end — no new installs means no new CVE surface, no new bundle weight from transitives.

## Files to create / modify

**`lib/editor/tools/` — extends existing**

- `lib/editor/tools/eraser.ts` — **new**. `stampEraser` + `eraseLine` that mirror `pencil.ts`'s stamp/line API but write `0, 0, 0, 0` (transparent RGBA) instead of RGB. Same out-param `_unionBbox` / top-left convention / clip rules as pencil.
- `lib/editor/tools/picker.ts` — **new**. `pickColorAt(pixels, x, y): { hex: string; alpha: number } | null`. Reads atlas pixel's RGBA, returns lowercase `#rrggbb` hex + alpha. Returns null only for OOB atlas coords; fully transparent pixels return `{hex: '#000000', alpha: 0}` so callers can decide to skip-or-sample.
- `lib/editor/tools/bucket.ts` — **new**. `bucketFill(pixels, islandMap, seedX, seedY, r, g, b, a?): Bbox | null`. Wraps `flood-fill.ts`'s `floodFill` + `applyFillMask`. Single entry point for 2D + 3D callers. Returns null if the seed pixel has island ID 0 (outside all body parts — no-op).
- `lib/editor/tools/mirror.ts` — **new**. `getMirrorMap(variant): Uint16Array` + `mirrorAtlasPixel(variant, x, y): { x: number; y: number } | null`. Module-init LUT per variant mapping each body-part atlas pixel to its X-mirror partner. Sentinel `0xFFFF` for non-body-part pixels.
- `lib/editor/tools/dispatch.ts` — **new**. Tool-dispatch facade. API:
  - `strokeStart(ctx: StrokeContext, x: number, y: number): void`
  - `strokeContinue(ctx: StrokeContext, fromX, fromY, toX, toY): void`
  - `strokeEnd(ctx: StrokeContext): void`
  - `samplePickerAt(layer: Layer, x: number, y: number): { hex: string; alpha: number } | null`
  - `StrokeContext = { tool: ToolId; layer: Layer; variant: SkinVariant; textureManager: TextureManager; activeColorHex: string; brushSize: BrushSize; mirrorEnabled: boolean }`

  Internally it:
  - Routes tool → stamp function (`stampPencil` / `stampEraser` / `bucketFill`).
  - When `mirrorEnabled && tool !== 'picker'`, computes mirror atlas pixel via `mirrorAtlasPixel(variant, x, y)` and applies the stamp to the mirror as well (per-pixel; for bucket, applies a second flood fill from the mirror seed).
  - Parses `activeColorHex` to RGB once per stroke via the shared `hexDigit` helper (Unit 0).
  - Calls `textureManager.flushLayer(layer)` per stamp and the authoritative `composite + markDirty` is still the caller's responsibility on `strokeEnd`.

- `lib/editor/tools/pencil.ts` — **modify**. Keep existing API (`stampPencil`, `stampLine`); no functional change. Any shared RGB-parse or bbox-tracking helpers extracted in Unit 0 get imported from their new home.

**`lib/editor/` — extends existing**

- `lib/editor/store.ts` — **modify**. `ToolId = 'pencil' | 'eraser' | 'picker' | 'bucket'` (drop `'mirror'` — migrate any references). Add `mirrorEnabled: boolean` slot + `toggleMirror()` + `setMirrorEnabled(next)` actions. Add store reset in `afterEach` pattern wherever tests seed it. Narrow-selector regression test extends `tests/color-picker-selectors.test.ts` style.

**`app/editor/_components/` — extends existing**

- `app/editor/_components/Toolbar.tsx` — **modify**. Enable the 4 currently-disabled buttons. Change mirror from `setActiveTool('mirror')` to `toggleMirror()`. Mirror button uses `aria-pressed={mirrorEnabled}` + `data-mirror-enabled` for testability. Keep `data-testid` per slot. Extend the existing 'b' keydown listener to dispatch B/E/I/G (tool swap) and M (mirror toggle). Modifier-guard on `e.metaKey || e.ctrlKey || e.altKey`. Also add focus guard (skip when focus is in INPUT/TEXTAREA/contentEditable) — already present for pencil hotkey; extend.
- `app/editor/_components/BucketHoverOverlay.tsx` — **modify (minor)**. Already reads `hoveredPixel` from store since M4. Verify the rAF-debounced flood-fill path still works when `activeTool === 'bucket'`. No API change expected — just activation.
- `app/editor/_components/ViewportUV.tsx` — **modify**. Replace inline `stampPencil` + `stampLine` in pointer handlers with `dispatch.strokeStart/Continue/End`. Handle picker tool: on pointerdown, if `activeTool === 'picker'` OR `altHeld`, call `samplePickerAt` + `setActiveColor`. Do NOT call strokeStart for picker (picker is one-shot, no drag).
- `app/editor/_components/PlayerModel.tsx` — **modify**. Same refactor as ViewportUV. Handle picker in 3D: after `resolveHit`, if picker/altHeld, sample the resolved pixel + set color. Preserve M4's overlay/base precedence for PAINT but treat picker as "pick the pixel actually hit" (not the base redirect) since the user wants the color they SEE, which may be the overlay.

**`app/editor/_components/` — new**

- `app/editor/_components/MirrorBadge.tsx` — **new, optional**. Small visual indicator on the 3D viewport showing the mirror plane (maybe a faint vertical line at x=0 in world space) when `mirrorEnabled`. Keeps mirror discoverability high. Budget-permitting; can inline into `EditorCanvas` if <20 lines.

**`tests/` — extends existing**

- `tests/eraser.test.ts` — **new**. Scenarios in Unit 2.
- `tests/picker.test.ts` — **new**. Scenarios in Unit 3.
- `tests/bucket.test.ts` — **new**. Integration-level; wraps `flood-fill.test.ts` by asserting bucket composes correctly. Scenarios in Unit 4.
- `tests/mirror.test.ts` — **new**. Scenarios in Unit 5.
- `tests/tool-dispatch.test.ts` — **new**. Exercises `strokeStart/Continue/End` + `samplePickerAt` with mocked layer buffers. Scenarios in Unit 6.
- `tests/tool-shortcuts.test.ts` — **new**. Keyboard handler tests: B/E/I/G/M trigger correct store mutations, modifier keys suppress, focus-in-input suppresses.
- `tests/paint-bridge.test.ts` — **modify**. After Unit 0 extracts `resolveOverlayHit` out of PlayerModel, import from the new location instead of re-declaring (resolves M4 review's "must stay in sync" smell).

**Out of scope** (explicit non-goals per user constraints + DESIGN):

- No undo/redo — M6.
- No layer panel UI / layer switching — M6. Active layer is implicit (`bundle.layer` — single base layer through M5).
- No on-model mirror-plane visualization beyond the optional `MirrorBadge`.
- No touch long-press for Picker — DESIGN §9 mentions it but it's deferred to M8 polish (needs a timer + gesture-conflict logic with OrbitControls' two-finger rotate).
- No tool-specific cursor variations on 3D (M3's 2D `BrushCursor` already handles 2D cursor-per-tool via `cursorForTool`; 3D uses M4's `CursorDecal` which stays single-icon for M5). Decal-per-tool deferred.
- No progressive disclosure UX (DESIGN §9 mentions but is open to interpretation). All 5 toolbar slots visible from day one; tools are immediately enabled rather than unlocked-after-first-use. Simpler; matches user expectations from other pixel editors.

## Requirements trace

- **R1.** Eraser on 2D or 3D sets the clicked (and dragged) atlas pixel(s) to fully transparent RGBA on the active layer. Undo not required (M6).
- **R2.** Picker on 2D or 3D reads the pixel under cursor and sets `activeColor` to that pixel's hex. Alt-hold works as a temporary picker modifier regardless of `activeTool`. If the pixel is fully transparent, `activeColor` is unchanged (or falls through to base on overlay per DESIGN M5 review P2).
- **R3.** Bucket on 2D or 3D flood-fills the connected same-color region within the clicked island. Fill does NOT cross island boundaries (UV seams) — verified by M3's island-gated `flood-fill.ts`. Fill color = `activeColor`.
- **R4.** Mirror toggle (`M` key or toolbar button) flips `mirrorEnabled`. While enabled, every subsequent pencil/eraser/bucket stroke is replicated to the X-mirror atlas pixel(s) per the mirror LUT. Picker is NOT mirrored.
- **R5.** Mirror produces matching left/right strokes: painting on right-arm.front pixel P mirrors to left-arm.front pixel P' where P' is P's face-local-X-flipped counterpart. Head/body/overlay counterparts self-mirror within their own rects.
- **R6.** Keyboard shortcuts: B=pencil, E=eraser, I=picker, G=bucket, M=mirror toggle. All shortcuts respect focus (no fire when typing in inputs) and modifier keys (Cmd+B, Ctrl+E, etc. do not fire).
- **R7.** Bucket hover preview (M3-dormant) activates when `activeTool === 'bucket'`. Shows a 20% white overlay on the hovered island's connected same-color region per M3's existing `BucketHoverOverlay.tsx`.
- **R8.** All 5 tools work on both 2D and 3D surfaces with identical behavior per tool. Tool dispatch is centralized in `lib/editor/tools/dispatch.ts`.
- **R9.** All M1–M4 tests still pass (178/178). No regression to existing pencil, color picker, persistence, or 3D paint flows.
- **R10.** `npm run lint`, `npx tsc --noEmit`, `npm run build`, `npm run test` all clean. Bundle delta ≤ +10 kB First Load JS on `/editor` vs M4's 362 kB baseline.
- **R11.** Variant toggle (Classic ↔ Slim) with mirror enabled works correctly — mirror LUT rebuilds per variant, no stale references.

## Scope boundaries

- **No undo**. Strokes commit immediately to `layer.pixels` + persist to IDB on stroke-end. M6 introduces undo via DESIGN §8's `UndoStack`.
- **No layer semantics**. Strokes always write to `bundle.layer` (single base layer). M6's layer panel adds active-layer selection.
- **No on-model overlay-alpha-aware picker fallthrough on 3D**. If user picks an overlay pixel with alpha=0, the M5 picker returns null and `activeColor` stays unchanged. A future "always pick the visible color regardless of layer" mode (overlay→base fallthrough for zero-alpha) is deferred — requires agreement on picker semantics for the transparent-overlay case.
- **No mirror for multi-part-spanning strokes**. If a single `strokeContinue` call crosses a face boundary (e.g., a fast drag from head-front to head-right), the mirror interpolation inherits the same per-sample behavior the primary stroke uses (per-frame only, no atlas-space Bresenham across seams — same decision as M4 D4).
- **No M/Shift-M differentiation**. The `M` key always toggles mirror. No "momentary" mirror mode.
- **No bucket tolerance**. `flood-fill.ts` is exact-match only (`floodFill` compares RGBA byte-exact to the seed). Fuzzy-match fill is out of scope.
- **No eraser brush size tied to the pencil brush size** — they share the `brushSize` slot (1–4). Eraser with size 3 zeroes a 3×3 region, same shape as pencil.

## Context & Research

### Relevant code and patterns (already-built M5 substrate)

- **`lib/editor/island-map.ts`** — `getIslandMap(variant) → Uint8Array(4096)` + `islandIdAt(map, x, y) → IslandId`. IDs 1–36 are base parts (6 parts × 6 faces), 37–72 are overlay parts. Module-init cached. M5 bucket uses this for seam-gated fills; M5 mirror uses it to find part+face at each atlas pixel.
- **`lib/editor/flood-fill.ts`** — `floodFill(pixels, islandMap, seedX, seedY) → Uint8Array(4096)` mask + `applyFillMask(target, mask, r, g, b, a?)`. Scanline Smith 1979, island-gated, exact-match. Sub-ms on 64×64. M5 bucket is a one-line wrapper.
- **`lib/editor/tools/pencil.ts`** — reference for new tool shape. `stampPencil(pixels, x, y, size, r, g, b)` with top-left convention `halfLeft = min(1, size-1)`, clip to `[0, 64)`, out-param `_unionBbox`. `stampLine(pixels, fx, fy, tx, ty, size, r, g, b)` is Bresenham between two atlas points applying stampPencil at each step.
- **`lib/three/overlay-map.ts`** — M4's `Uint16Array(4096)` LUT pattern. `getOverlayToBaseMap(variant)` + `overlayToBase(variant, x, y)`. Mirror-map follows the exact same pattern (derivation from UV rects, per-variant cache, sentinel `0xFFFF`).
- **`app/editor/_components/BucketHoverOverlay.tsx`** — M3-inert. Reads `hoveredPixel` + `variant`; activates only when `activeTool === 'bucket'`. rAF-debounced flood-fill preview. M5 flips the tool-selection guard from "never true" to "user-controllable." Should work as-is.
- **`app/editor/_components/Toolbar.tsx`** — 5 tool buttons; 4 are disabled with `(M5)` label. Already has `'b'` keyboard shortcut with focus guard. M5 extends to all 5 keys + adds modifier guard.
- **`lib/editor/tools/pencil.ts`** + ViewportUV.tsx `hexDigit` helper + PlayerModel.tsx `hexDigit` helper — all three are duplicate scalar hex-digit parsers. Unit 0 extracts to `lib/color/hex-digit.ts` (per M4 review S1 advisory).

### Institutional learnings (carry forward)

- **`docs/solutions/integration-issues/r3f-pointer-paint-on-textured-mesh-2026-04-20.md`** — the 8-decision R3F paint pattern. M5's picker and bucket entries in PlayerModel reuse this pattern verbatim: Y-flip UV→atlas, clampAtlas, userData.part identity, `e.stopPropagation()` on pointerdown and pointermove, `setPointerCapture` on down / release on up, button filter `e.button === 0`.
- **`docs/solutions/performance-issues/r3f-geometry-prop-disposal-2026-04-18.md`** — if M5 adds any GPU resources (the optional `MirrorBadge` might add a line geometry), dispose via `useEffect` cleanup.
- **`docs/solutions/test-failures/vitest-jsdom-react-component-testing-setup-2026-04-20.md`** — test skeleton for any new React-component tests (Toolbar shortcut tests, if we decide to render the component rather than unit-test the hook).
- **`docs/COMPOUND.md` M2 §Invariants** — `Record<Union, T>` + `Object.keys()` for exhaustive arrays. Mirror pairings live in `MIRROR_PART_MAP: Record<PlayerPart, PlayerPart>` — compile-time exhaustive.
- **`docs/COMPOUND.md` M4 §Gotchas** — M3 P2 findings **still open** after M4 merge:
  - `handleWheel` commits `uvZoom` + `uvPan` as two separate store sets (torn-state risk).
  - Toolbar `'b'` keyboard shortcut doesn't guard `e.metaKey || e.ctrlKey || e.altKey` (Cmd+B fires tool swap while browser also opens bookmark dialog).
  - `aria-valuetext` on `role="application"` in ColorPicker SL square still has the eslint-disable.
  **M5 Unit 7 resolves #2 as a byproduct** (keyboard shortcut rewrite covers all 5 keys + adds modifier guards). #1 and #3 stay open for M6.

### External references

- **Minecraft skin layout conventions** — the 64×64 atlas is well-documented; mirror symmetry between right-arm and left-arm is a standard skin-editor feature in tools like MCSkin3D, Blockbench, and skindex.com. The face-local-X flip on arm/leg mirror is the canonical behavior.
- **Scanline flood fill (Smith 1979)** — already implemented in `flood-fill.ts`. No external research needed.
- **Browser keyboard event handling** — `e.metaKey` (Cmd on macOS), `e.ctrlKey`, `e.altKey`; `e.target.tagName in ['INPUT', 'TEXTAREA']` or `contentEditable` for focus guards. Standard patterns.

## Key technical decisions

### D1 — Mirror is a modifier, not a tool

**Decision:** Remove `'mirror'` from the `ToolId` union. Add `mirrorEnabled: boolean` + `toggleMirror()` + `setMirrorEnabled(next)` actions to the store. The `M` key and the toolbar's mirror button both dispatch `toggleMirror()`; they do NOT set `activeTool`.

**Rationale:** DESIGN §9 explicitly says mirror "toggles X-axis symmetry on subsequent strokes" — that's a modifier, not a tool. Keeping `'mirror'` as a `ToolId` would require the user to switch AWAY from mirror to return to normal pencil, which is bad UX. Matches how every other skin-editor / paint-app treats "symmetry" (Procreate, Aseprite, Blockbench). Minor store schema migration; no persisted data affected (mirrorEnabled is session-local in M5; persists in M6 if we choose).

### D2 — Single tool dispatcher for both paint surfaces

**Decision:** Create `lib/editor/tools/dispatch.ts` with `strokeStart/Continue/End` + `samplePickerAt`. Both `ViewportUV.tsx` and `PlayerModel.tsx` refactor their paint handlers to call the dispatcher rather than inline `stampPencil`.

**Rationale:** Without this, adding 4 new tools × 2 paint surfaces = 8 handler branches, plus mirror logic duplicated. With a dispatcher, it's 1 handler per surface that calls into `strokeStart(ctx, x, y)`. Mirror lives inside the dispatcher — paint surfaces never touch `mirrorEnabled` or `mirrorAtlasPixel`. Also a natural seam for future M5+ tools (smudge, gradient, etc. in Phase 2) without touching paint surfaces.

Trade-off: adds one layer of indirection. Justified because:
- Two consumers (2D + 3D) × 4 new tools = real duplication avoided.
- Mirror modifier would be painful to scatter across two surfaces.
- The dispatcher is trivially unit-testable (inject a `StrokeContext`, assert layer.pixels mutation); can't say the same for inline handlers.

### D3 — Mirror LUT pattern mirrors `overlay-map.ts`

**Decision:** `lib/editor/tools/mirror.ts` exports `getMirrorMap(variant): Uint16Array` (4096 entries, module-scoped, one per variant). Each atlas pixel maps to its X-mirror atlas pixel; `0xFFFF` sentinel for non-body-part pixels.

Construction rules:
- Per part + face in `CLASSIC_UVS` / `SLIM_UVS`:
  - Lookup mirror part via `MIRROR_PART_MAP: Record<PlayerPart, PlayerPart>`.
  - Lookup mirror face via `MIRROR_FACE_MAP: Record<FaceKey, FaceKey>` (top/bottom/front/back self-map; right↔left swap).
  - For each pixel (rect.x + fx, rect.y + fy) in the source rect:
    - Compute face-local flipped-X: `mirrorFx = rect.w - 1 - fx` (X-flip within the face).
    - Look up mirror rect via `uvs[mirrorPart][mirrorFace]`.
    - Write LUT entry: `(mirrorRect.y + fy) * 64 + (mirrorRect.x + mirrorFx)`.

Pairings: head/body/headOverlay/bodyOverlay self-pair (part maps to itself; face-X-flip only). rightArm↔leftArm, rightLeg↔leftLeg, rightArmOverlay↔leftArmOverlay, rightLegOverlay↔leftLegOverlay cross-pair.

**Rationale:** Established pattern. 8 KB total module memory (2 variants × 4096 × 2 bytes). O(1) runtime per pixel. Unit-testable per rect. Allows bucket fill to mirror correctly: apply `floodFill` twice (once at seed, once at `mirrorAtlasPixel(seed)`) for mirror-enabled bucket strokes.

### D4 — Picker is one-shot, not a stroke

**Decision:** `activeTool === 'picker'` pointerdown calls `samplePickerAt(layer, x, y)` and returns. It does NOT call `strokeStart`. `pointermove` while picker is active does NOT continuously sample (pointer must be released + re-pressed to sample again). Alt-hold modifier works the same way: on pointerdown while Alt is held, sample + return.

**Rationale:** Picker semantics in other tools (Procreate, Aseprite): a single click samples. Continuous sampling would make it too easy to accidentally change color mid-navigation. Alt-hold is the universal desktop modifier for temporary picker.

Implementation: in both paint surface handlers, branch early on `activeTool === 'picker' || altHeld` → call `samplePickerAt` + `setActiveColor` + early-return (no `strokeStart`). `samplePickerAt` returns `{hex, alpha}` or null; caller decides whether to apply based on alpha (M5: apply only if alpha > 0; future policy: maybe apply hex even for transparent pixels if user holds a modifier).

### D5 — Alt modifier via a shared keyboard hook

**Decision:** Create a small `useAltHeld()` hook (likely in `lib/editor/` or inlined into a shared location). Listens on window keydown/keyup for `e.altKey`, updates a ref. Both `ViewportUV` and `PlayerModel` consume the ref to decide whether pointerdown is a picker sample.

**Rationale:** The alt-modifier is a UI concern, not a store slot (no other component needs to read it). A hook keeps it local. Ref (not state) to avoid re-renders on every alt press. Focus-guard the keydown so Alt in text inputs doesn't flip the modifier.

### D6 — Keyboard shortcut listener extraction

**Decision:** Extract the existing `Toolbar.tsx` window-keydown listener into a dedicated hook `useToolShortcuts()` in `lib/editor/` (or keep inline in Toolbar if <30 lines). Add handlers for E / I / G / M alongside the existing B. Modifier guard (`return if metaKey || ctrlKey || altKey`) and focus guard (skip INPUT/TEXTAREA/contentEditable/role=application) on all keys.

**Rationale:** Small hook; no tests lost. Catches M3 P2 #2 (modifier guard missing on 'b'). Also keeps the `M` handler (mirror toggle) colocated with the tool-swap handlers for future maintainers.

**Role-based focus guard:** also skip when `document.activeElement` has `role="application"` (M3's SL square). That element owns its own arrow-key handler and shouldn't inherit tool shortcuts during arrow-key color nudging.

### D7 — Unit 0 absorbs M4-review simplicity extracts

**Decision:** Unit 0 extracts 3 shared helpers flagged by M4's `/ce:review` code-simplicity reviewer:
- `hexDigit(hex, index)` → `lib/color/hex-digit.ts`
- `clampAtlas`, `uvToAtlasX`, `uvToAtlasY` → `lib/three/atlas-math.ts`
- `resolveOverlayHit(variant, pixels, rawX, rawY, isOverlay)` → exported from `lib/three/overlay-map.ts`

Updates PlayerModel, ViewportUV, and `tests/paint-bridge.test.ts` to import from shared locations (resolves the "must stay in sync" comment anti-pattern).

**Rationale:** Same pattern as M4 Unit 0 absorbed M3 P1 review findings. The extracts are cheap (40 LOC net saved, no behavior change), and doing them BEFORE the dispatcher lands means the dispatcher can reuse them directly. Doing them after would re-duplicate into `dispatch.ts`.

## Open questions

### Resolved during planning

- **Q: Does mirror apply to picker?** A: No. Picker is a one-shot sample, nothing to mirror. The mirror modifier is gated to pencil/eraser/bucket in the dispatcher.
- **Q: How does bucket behave when seed pixel has island ID 0 (outside all body-part rects)?** A: No-op. `bucket.ts` returns null; caller skips. No paint happens.
- **Q: What's the picker alpha threshold?** A: No threshold. `pickColorAt` returns the exact hex + alpha. Callers decide whether to apply: M5 default is "apply only if alpha > 0" (don't steal transparent as active color). Future policy: maybe always apply hex.
- **Q: Mirror + bucket on a seed that straddles the X-axis center?** A: Two separate flood fills — one from the original seed, one from the mirror seed. They may overlap (fill identical pixels). Last-write-wins is fine since both fills write the same color.
- **Q: Does picker sample the overlay or the base pixel when hovering a 3D overlay mesh?** A: Picker samples the atlas pixel CLICKED, not the rendered composite. If user clicks an overlay mesh where the overlay is transparent, picker samples the transparent overlay pixel (alpha=0), not the base. This is the "honest" picker behavior. User can right-click to orbit or click the base via the 2D canvas if they want the base color specifically.
- **Q: Should the toolbar use progressive disclosure per DESIGN §9?** A: No — DESIGN's phrasing is ambiguous and the current 5-button layout matches M3. All tools visible + keyboard-shortcut-discoverable. Move this question to a future UX polish milestone if the 5-button layout feels cluttered.
- **Q: Does mirror toggle persist across reload?** A: No. `mirrorEnabled` is session-local (NOT persisted to IDB). M6 can add persistence when the layer schema grows.
- **Q: Long-press picker on touch?** A: Deferred to M8. Needs a timer + gesture-conflict resolution with OrbitControls' two-finger gesture. Not worth the complexity for M5 when Alt-hold + 'I' shortcut cover the desktop path.
- **Q: Mirror plane visible on 3D?** A: Optional; ship if <20 lines (inline `<line>` in `EditorCanvas`). A faint vertical line at world-space x=0, height = model bounds.

### Deferred to implementation

- **Exact mirror LUT face-flip rules.** Unit 5 is test-first. Test-driven development will resolve any ambiguity about face-key swaps and face-local X flips. Expected outcome: head.front pixel at (8+a, 8+b) mirrors to head.front pixel at (8+(8-1-a), 8+b) (self-mirror within rect). rightArm.front pixel at (40+a, 20+b) mirrors to leftArm.front pixel at (32+(4-1-a), 52+b). If `a + (4-1-a) != 4-1` anywhere, tests will catch it.
- **Keyboard shortcut scope (document vs window).** Current pencil 'b' listener attaches to `window`. Extending to E/I/G/M keeps the same target. If future UX introduces a modal dialog, listener may need a capture-phase guard. Defer.
- **Whether mirror applies per-stamp or per-stroke.** M5 per-stamp (each pencil-stamp mirrors independently). For pencil + mirror, this produces per-pixel symmetry. For bucket + mirror, this produces two fill regions. Both are correct per DESIGN — implementer doesn't need to decide; the dispatcher applies the tool then applies the tool again at the mirror pixel.

## High-level technical design

### Tool dispatch pipeline

```
Paint surface (2D or 3D)
├─ pointerdown
│   ├─ if picker or altHeld: samplePickerAt(layer, x, y) → setActiveColor(hex); return
│   └─ else: strokeStart(ctx, x, y)
│       └─ dispatch.ts: route to tool
│           ├─ 'pencil': stampPencil(layer.pixels, x, y, brushSize, r, g, b)
│           ├─ 'eraser': stampEraser(layer.pixels, x, y, brushSize)  ← writes 0,0,0,0
│           ├─ 'bucket': bucketFill(layer.pixels, islandMap, x, y, r, g, b)
│           └─ (if mirrorEnabled && tool != 'picker'):
│               └─ mx, my ← mirrorAtlasPixel(variant, x, y)
│               └─ tool-apply at (mx, my)
│       └─ textureManager.flushLayer(layer)
├─ pointermove (while painting)
│   └─ strokeContinue(ctx, fromX, fromY, toX, toY)
│       └─ pencil/eraser: stampLine/eraseLine
│       └─ bucket: no-op (bucket is stroke-start-only, not drag)
│       └─ (mirror: stampLine from mirror(from) to mirror(to))
│       └─ textureManager.flushLayer(layer)
└─ pointerup
    └─ strokeEnd(ctx)
        └─ textureManager.composite([layer])
        └─ markDirty()
        └─ commitToRecents(activeColorHex)  ← only if any pixels changed
```

### Mirror LUT construction (directional pseudo-code)

```
function buildMirrorMap(uvs) {
  const map = new Uint16Array(4096).fill(0xFFFF);
  for each part in PART_ID_ORDER:
    const mirrorPart = MIRROR_PART_MAP[part];
    for each face in FACE_ID_ORDER:
      const mirrorFace = MIRROR_FACE_MAP[face];
      const rect = uvs[part][face];
      const mirrorRect = uvs[mirrorPart][mirrorFace];
      for fy in [0, rect.h):
        for fx in [0, rect.w):
          const srcIdx = (rect.y + fy) * 64 + (rect.x + fx);
          const mirrorFx = rect.w - 1 - fx;  // face-local X flip
          const dstIdx = (mirrorRect.y + fy) * 64 + (mirrorRect.x + mirrorFx);
          map[srcIdx] = dstIdx;
  return map;
}
```

**INVARIANT**: `MIRROR_PART_MAP[MIRROR_PART_MAP[part]] === part` (involution — mirroring twice returns the original). Similarly for faces: `MIRROR_FACE_MAP[MIRROR_FACE_MAP[face]] === face`. Test-enforced.

### Store shape delta

```
Before (M4):
  type ToolId = 'pencil' | 'eraser' | 'picker' | 'bucket' | 'mirror';

After (M5):
  type ToolId = 'pencil' | 'eraser' | 'picker' | 'bucket';
  // in EditorState:
  mirrorEnabled: boolean;
  // actions:
  setMirrorEnabled: (next: boolean) => void;
  toggleMirror: () => void;
```

Migration: grep for `'mirror'` in existing code and rewrite references. No persisted data.

## Implementation Units

- [ ] **Unit 0: Absorb M4 review simplicity extracts (prerequisite)**

**Goal:** Extract 3 shared helpers into canonical homes so M5's dispatcher + new tools reuse them.

**Requirements:** R9 (regression-free), M4 review cleanup.

**Dependencies:** None; prerequisite to Units 2/3/4/5/6.

**Files:**
- Create: `lib/color/hex-digit.ts` (exports `hexDigit(hex, index): number`).
- Create: `lib/three/atlas-math.ts` (exports `clampAtlas`, `uvToAtlasX`, `uvToAtlasY`).
- Modify: `lib/three/overlay-map.ts` (add exported `resolveOverlayHit(variant, pixels, rawX, rawY, isOverlay)`; the existing PlayerModel `resolveHit` becomes a wrapper around it).
- Modify: `app/editor/_components/ViewportUV.tsx` (import `hexDigit` from shared).
- Modify: `lib/three/PlayerModel.tsx` (import `hexDigit`, `clampAtlas`, and use `resolveOverlayHit`).
- Modify: `tests/paint-bridge.test.ts` (delete local replicas, import from shared; delete the "must stay in sync" comment since the replicas are gone).

**Approach:** Pure extractions. Zero behavior change. Test suite shrinks if anything (test file loses ~20 lines of replicas).

**Patterns to follow:** `lib/editor/island-map.ts` module structure (private build + cached + thin resolver). `docs/solutions/integration-issues/r3f-pointer-paint-on-textured-mesh-2026-04-20.md` §"Prevention" — the 8-decision checklist now points at these shared helpers.

**Test scenarios:**
- Happy path: `hexDigit('#ffffff', 1) === 15`, `hexDigit('#abcdef', 5) === 14`.
- Edge case: `hexDigit('#000000', 1) === 0` (zero digit).
- `clampAtlas(-1) === 0`, `clampAtlas(64) === 63`, `clampAtlas(32) === 32`.
- `uvToAtlasY(0) === 63` (Y-flip verified), `uvToAtlasY(1) === 0`.
- `resolveOverlayHit` behavior exactly mirrors the pre-extraction tests (all 7 cases from `paint-bridge.test.ts`).
- Regression: `npm run test` before AND after Unit 0 shows the same test count, same passing status.

**Verification:** All 178 M4 tests still pass. `npx tsc --noEmit` + lint clean. No duplicate-free-function grep hits for `hexDigit` / `clampAtlas` / `resolveHit` in source (only in shared modules + per-test imports).

- [ ] **Unit 1: Store shape — drop 'mirror' from ToolId, add mirrorEnabled**

**Goal:** Migrate store to the M5 schema. Toolbar mirror button toggles `mirrorEnabled` instead of calling `setActiveTool('mirror')`.

**Requirements:** R4, R9.

**Dependencies:** Unit 0 (clean baseline).

**Files:**
- Modify: `lib/editor/store.ts`:
  - `type ToolId = 'pencil' | 'eraser' | 'picker' | 'bucket';`
  - Add `mirrorEnabled: boolean` (initial value `false`).
  - Add `setMirrorEnabled(next: boolean): void` and `toggleMirror(): void` actions.
  - Narrow-selector identity guard on `setMirrorEnabled` (same-value no-op).
- Modify: `app/editor/_components/Toolbar.tsx` — mirror button calls `toggleMirror()` instead of `setActiveTool('mirror')`. `aria-pressed={mirrorEnabled}` + `data-mirror-enabled` for testability.
- Modify: any existing `'mirror'` string literal in source (grep-find). Expected: only Toolbar + types/store.
- Create: `tests/mirror-store.test.ts` (narrow-selector regression test per M3 skeleton in the solution doc).

**Approach:** Additive store change; remove one union member. Narrow-selector regression test (same Profiler pattern as `tests/hover-store.test.ts`).

**Execution note:** Test-first for the narrow-selector contract.

**Patterns to follow:** M4 Unit 3 (`tests/hover-store.test.ts` + store slot pattern). `docs/solutions/test-failures/vitest-jsdom-react-component-testing-setup-2026-04-20.md` skeleton.

**Test scenarios:**
- Happy path: `setMirrorEnabled(true)` → store reflects; `toggleMirror()` flips false→true→false.
- Narrow selector: a Profiler subscriber to `(s) => s.mirrorEnabled` does NOT re-render on unrelated slot mutations (e.g., `brushSize` change).
- Identity guard: `setMirrorEnabled(false)` when already false is a no-op (subscriber doesn't re-render).
- Type check: `ToolId` union has exactly 4 members. TypeScript-level assertion (would fail at compile if a regression re-adds 'mirror').

**Verification:** All 178 prior tests pass + 3–4 new mirror-store tests pass. tsc clean. Toolbar's mirror button visually toggles in dev server (aria-pressed flips).

- [ ] **Unit 2: Eraser tool**

**Goal:** Implement eraser via `stampEraser` + `eraseLine`. Wire into dispatch.

**Requirements:** R1, R8.

**Dependencies:** Unit 0.

**Files:**
- Create: `lib/editor/tools/eraser.ts` — `stampEraser(pixels, x, y, size)` + `eraseLine(pixels, fx, fy, tx, ty, size)`. Same shape as pencil's counterparts but writes `0, 0, 0, 0` per pixel. Same top-left convention, same clipping, same `_unionBbox` out-param.
- Create: `tests/eraser.test.ts` — mirror `tests/pencil.test.ts` structure.

**Approach:** Nearly identical to pencil.ts. Share helpers where natural (e.g., the top-left-offset computation could be a shared function, but YAGNI; copy-paste 3 lines of clip math is fine).

**Patterns to follow:** `lib/editor/tools/pencil.ts` exactly. Zero-alloc discipline (no object returns in hot loop).

**Test scenarios:**
- Happy path: `stampEraser(pixels, 10, 10, 1)` zeroes pixel (10, 10).
- Brush sizes: `stampEraser(_, 10, 10, 2)` zeroes 2×2 starting at the top-left per convention.
- Clipping: `stampEraser(_, 63, 63, 4)` zeroes only in-bounds pixels; no OOB writes.
- Edge: `stampEraser(_, -1, -1, 1)` is a no-op (OOB seed).
- Integration: `stampPencil` then `stampEraser` at same coord → pixel is zeroed (not white).
- `eraseLine`: (0,0) → (4,4) with size 1 produces 5 zeroed pixels along the diagonal.

**Verification:** 6-8 new tests pass. Eraser works in dev server (select eraser, click on painted pixel, pixel becomes transparent; confirm by painting new color on the same spot — shows as new color, not composited over previous).

- [ ] **Unit 3: Picker tool**

**Goal:** Implement `samplePickerAt(layer, x, y): { hex, alpha } | null`. Wire into paint surfaces with Alt-hold modifier + 'I' tool shortcut.

**Requirements:** R2, R8.

**Dependencies:** Unit 0.

**Files:**
- Create: `lib/editor/tools/picker.ts`:
  - `pickColorAt(pixels, x, y): { hex: string; alpha: number } | null` — OOB returns null; else returns lowercase `#rrggbb` hex + 0-255 alpha.
- Create: `lib/editor/use-alt-held.ts` — `useAltHeld(): () => boolean` — returns a getter backed by a ref (not state). Listens on window keydown/keyup with focus guards.
- Create: `tests/picker.test.ts`.

**Approach:** Pure pixel-read function. Hex formatting uses `toString(16).padStart(2, '0')`.

**Execution note:** Test-first for the picker function.

**Patterns to follow:** `lib/color/conversions.ts` for hex formatting conventions. `lib/editor/tools/pencil.ts` for argument order.

**Test scenarios:**
- Happy path: pixel at (5, 5) is (255, 0, 0, 255) → picker returns `{hex: '#ff0000', alpha: 255}`.
- Edge: fully transparent pixel (0, 0, 0, 0) → returns `{hex: '#000000', alpha: 0}`.
- OOB: `pickColorAt(pixels, -1, 0)` → null.
- OOB: `pickColorAt(pixels, 64, 63)` → null.
- Hex lowercase: pixel (171, 205, 239, 255) → `#abcdef` (not `#ABCDEF`).
- Round-trip with pencil: stampPencil a known color, pickColorAt returns it exactly.

**Verification:** 6-8 new tests pass. In dev: click eraser, select red, click a pixel → pixel goes red; click picker, click same pixel → activeColor becomes red. Alt-click on any pixel with any other tool also samples.

- [ ] **Unit 4: Bucket tool (wire dormant flood-fill)**

**Goal:** `bucketFill(pixels, islandMap, seedX, seedY, r, g, b, a?): Bbox | null`. Activate `BucketHoverOverlay` via `activeTool === 'bucket'`.

**Requirements:** R3, R7, R8.

**Dependencies:** Unit 0.

**Files:**
- Create: `lib/editor/tools/bucket.ts` — thin wrapper over `floodFill(pixels, islandMap, seedX, seedY)` + `applyFillMask(pixels, mask, r, g, b, a)`. Returns bbox from applyFillMask or null if floodFill returned a zero-mask (seed outside any island).
- Create: `tests/bucket.test.ts` — integration tests for the wrapper.

**Approach:** Verify integration points work. `flood-fill.ts` already has 8+ tests from M3 covering the algorithm; `bucket.test.ts` adds the wrapper-level tests.

**Patterns to follow:** `lib/editor/flood-fill.ts`. `app/editor/_components/BucketHoverOverlay.tsx` — this component already consumes `floodFill` correctly; M5 just needs to trust it.

**Test scenarios:**
- Happy path: seed at (40, 20) on a head-front island, pixels all zeroed → fill paints the full head-front rect.
- Island gating: seed at head-front, adjacent head-right pixel has same color as filled-head-front → head-right is NOT filled (different island).
- Exact-match: seed pixel is (255, 0, 0, 255), adjacent pixel is (255, 1, 0, 255) (slightly different) → fill stops at the color boundary.
- No-op: seed outside any body-part rect (island ID 0) → bucketFill returns null.
- Bbox: fill a known rect; returned bbox matches the fill extent.
- Integration with mirror (deferred to Unit 6 — bucket + mirror tested there).

**Verification:** 5-7 new tests + 8 existing flood-fill tests still pass. In dev: select bucket, click a body-part face → that face fills in the active color; hover preview shows 20% white overlay on the target island.

- [ ] **Unit 5: Mirror tool (LUT + integration point)**

**Goal:** `getMirrorMap(variant): Uint16Array` + `mirrorAtlasPixel(variant, x, y): { x, y } | null`. Zero-cost runtime lookup.

**Requirements:** R4, R5, R11.

**Dependencies:** Unit 0, Unit 1.

**Files:**
- Create: `lib/editor/tools/mirror.ts` — module-init builds Uint16Array per variant; exports resolver. Uses `CLASSIC_UVS` / `SLIM_UVS` + `MIRROR_PART_MAP` + `MIRROR_FACE_MAP`.
- Create: `tests/mirror.test.ts` — test-first.

**Approach:** Follow `overlay-map.ts` pattern exactly. 8 KB total module memory.

**Execution note:** Test-first. The face-key swap + face-local X flip rules are error-prone; TDD catches them immediately.

**Patterns to follow:** `lib/three/overlay-map.ts` (pattern + sentinel usage + cache structure). `lib/editor/island-map.ts` (cache-per-variant).

**Test scenarios:**
- Happy path: head.front center pixel mirrors within head.front rect (face-local X-flipped, same Y).
- Cross-part: rightArm.front pixel at face-local (1, 3) mirrors to leftArm.front pixel at face-local (rect.w-1-1, 3).
- Face swap: rightArm.right pixel mirrors to leftArm.left pixel (not leftArm.right).
- Self-face: rightLeg.front mirrors to leftLeg.front (not back or side).
- Overlay parity: rightArmOverlay.front mirrors to leftArmOverlay.front (overlay parts mirror to overlay parts, not crossing base/overlay).
- Involution: `mirrorAtlasPixel(v, ...mirrorAtlasPixel(v, x, y))` returns the original `(x, y)` for every body-part pixel. Automated loop test over all 4096 pixels.
- Non-body-part: `mirrorAtlasPixel(v, 0, 0)` → null (assuming (0, 0) is not in any rect on classic layout).
- Variant: slim has narrower arms; mirror rect widths in slim < classic. Face-local X flip still yields correct mirror.
- OOB: `mirrorAtlasPixel(v, -1, 0)` → null.
- Per-variant cache: `getMirrorMap('classic') === getMirrorMap('classic')` (same reference, not rebuilt).

**Verification:** 10-12 new tests pass. `mirror.ts` does NOT need PlayerModel/ViewportUV wiring yet — that's Unit 6.

- [ ] **Unit 6: Tool dispatcher + paint surface refactor**

**Goal:** Centralize tool dispatch in `lib/editor/tools/dispatch.ts`. Refactor ViewportUV + PlayerModel to use it. Mirror modifier applied in the dispatcher.

**Requirements:** R1, R2, R3, R4, R5, R8.

**Dependencies:** Units 0, 1, 2, 3, 4, 5.

**Files:**
- Create: `lib/editor/tools/dispatch.ts`:
  - `StrokeContext` type (tool, layer, variant, textureManager, activeColorHex, brushSize, mirrorEnabled).
  - `strokeStart(ctx, x, y): boolean` — returns true if any pixels changed (for `commitToRecents` gating).
  - `strokeContinue(ctx, fromX, fromY, toX, toY): void`.
  - `strokeEnd(ctx): void` — no-op at dispatcher level; surface calls `textureManager.composite` + `markDirty` directly.
  - `samplePickerAt(layer, x, y): { hex; alpha } | null` — re-exports from picker.ts.
- Modify: `app/editor/_components/ViewportUV.tsx` — handler refactor. Branch on `activeTool === 'picker' || altHeld` before `strokeStart`. Otherwise `strokeStart → pencil/eraser/bucket via dispatcher`.
- Modify: `lib/three/PlayerModel.tsx` — same refactor. Also the Alt-hold branch and picker handling.
- Create: `tests/tool-dispatch.test.ts`.

**Approach:**
- Dispatcher is a pure function over `StrokeContext`. Mocks: layer pixels + a fake textureManager with a spy-able `flushLayer`. Test each tool path.
- Mirror application: dispatcher calls `mirrorAtlasPixel` only when `mirrorEnabled`. For pencil/eraser, mirror applies per-stamp. For bucket, mirror applies as a second `bucketFill` from the mirror seed (so two fills happen — may overlap in head/body faces, harmless).
- Picker in dispatcher is the `samplePickerAt` re-export; surfaces call it directly and skip `strokeStart`.

**Execution note:** Incremental. Refactor ViewportUV first (simpler input space), verify pencil still works, then refactor PlayerModel. At each step, all 178+ existing tests plus the new dispatch tests must stay green.

**Patterns to follow:** `lib/editor/tools/pencil.ts` (pure function, out-param). `app/editor/_components/BucketHoverOverlay.tsx` (calls floodFill directly — the dispatcher version could be what replaces this direct call in M6).

**Test scenarios:**
- Dispatch routing: `strokeStart(ctx, 10, 10)` with tool='pencil' calls stampPencil with expected args.
- Eraser: stroke with tool='eraser' zeros the pixel (RGBA 0,0,0,0).
- Bucket: stroke with tool='bucket' on a same-color island fills the connected region; doesn't bleed across seams.
- Mirror + pencil: stroke with `mirrorEnabled: true`, tool='pencil', at rightArm.front pixel → stampPencil called at ORIGINAL atlas coord AND at mirror atlas coord.
- Mirror + bucket: stroke with `mirrorEnabled: true`, tool='bucket' → two flood fills (one from original seed, one from mirror seed).
- Mirror + picker: not applicable — picker isn't a stroke. Test that `samplePickerAt` is never called with mirror semantics.
- Mirror on non-body-part pixel: `mirrorAtlasPixel` returns null → dispatcher skips mirror application (primary stamp still happens).
- commitToRecents only fires when strokeStart actually changed pixels: test path where activeTool='bucket' on an already-filled-same-color island returns false → no commitToRecents.
- Surface integration: Playwright-style OR a manually-constructed jsdom test that mounts ViewportUV with a mock context, dispatches pointerdown, asserts textureManager.flushLayer was called and layer.pixels mutated.

**Verification:** All 178+ existing tests pass. New dispatch tests pass. Dev server: every tool works on both 2D and 3D; mirror toggle affects pencil/eraser/bucket but not picker; Alt-hold samples regardless of active tool.

- [ ] **Unit 7: Toolbar UI + keyboard shortcuts**

**Goal:** Enable all 5 tool buttons; wire keyboard shortcuts B/E/I/G/M with modifier + focus guards. Resolve M3 P2 gotcha #2 (Cmd+B modifier guard).

**Requirements:** R4, R6.

**Dependencies:** Units 1, 6.

**Files:**
- Modify: `app/editor/_components/Toolbar.tsx`:
  - Remove `(M5)` labels; enable all 5 buttons.
  - Change mirror button to `onClick={toggleMirror}` + `aria-pressed={mirrorEnabled}` + `data-mirror-enabled={mirrorEnabled}`.
  - Extract keyboard handler to a new hook `useToolShortcuts()` OR keep inline (implementer's choice).
  - Add handlers for E/I/G (tool swap) + M (mirror toggle).
  - Modifier guard: `if (e.metaKey || e.ctrlKey || e.altKey) return;`.
  - Focus guard: extend beyond INPUT/TEXTAREA to also skip `document.activeElement?.role === 'application'` (M3's SL square has arrow-key handler).
- Create: `tests/tool-shortcuts.test.ts`:
  - Keyboard event dispatch via `window.dispatchEvent(new KeyboardEvent('keydown', { key: 'e' }))`.
  - Assert `activeTool` after each.

**Approach:** Keep the existing 'b' listener structure; add cases. Modifier + focus guards are 2 extra conditions.

**Patterns to follow:** Existing `Toolbar.tsx` 'b' handler.

**Test scenarios:**
- Happy path: `keydown B` → `activeTool === 'pencil'`.
- E → 'eraser'; I → 'picker'; G → 'bucket'; M → `mirrorEnabled` toggled.
- Modifier guards: `Cmd+B` does NOT fire pencil swap; `Ctrl+E`, `Alt+I` similarly.
- Focus guards: if `document.activeElement.tagName === 'INPUT'`, all shortcuts skip. Same for TEXTAREA, `role="application"`, `contentEditable`.
- Case insensitivity: uppercase key fires same handler (e.g., `Shift+B` still fires pencil — Shift is the only modifier that's NOT a guard).
- Mirror toggle state: after M, aria-pressed flips on the mirror button.
- Double-tap M: toggles off then on cleanly (two separate dispatches, no edge-case).

**Verification:** 8-10 new tests pass. Dev server: all 5 keyboard shortcuts work; Cmd+B doesn't interfere with browser bookmark.

- [ ] **Unit 8: Integration acceptance + bundle audit**

**Goal:** End-to-end verification + regression sweep + bundle size.

**Requirements:** R1–R11.

**Dependencies:** Units 0–7.

**Files:** no new; verification-only.

**Approach:** Full sweep: `npm run lint`, `npx tsc --noEmit`, `npm run test`, `npm run build`. Manual acceptance per the list below. Measure bundle delta.

**Test scenarios:** See Acceptance Criteria below.

**Verification:**
- All M1–M4 tests pass (178 baseline).
- New M5 tests pass (estimated +50 tests: ~8 unit 0, ~4 unit 1, ~8 unit 2, ~8 unit 3, ~7 unit 4, ~11 unit 5, ~10 unit 6, ~10 unit 7).
- Bundle delta ≤ +10 kB First Load JS.
- All 14 manual acceptance items pass in `npm run dev`.

## System-Wide Impact

- **Interaction graph:** `dispatch.ts` is a new module consumed by ViewportUV, PlayerModel, and transitively by `BucketHoverOverlay` (via the bucket tool). Store gains one slot (`mirrorEnabled`) and one action pair (toggle + set). `ToolId` union shrinks by one.
- **Error propagation:** `bucket.ts` returns null for out-of-island seeds; dispatcher skips the primary stamp AND the mirror stamp. `mirrorAtlasPixel` returns null for non-body-part pixels; dispatcher skips the mirror stamp but primary still runs. Picker on OOB / transparent: caller-level decision (M5: apply only if alpha > 0).
- **State lifecycle:** `mirrorEnabled` is session-local (no IDB persistence in M5). Variant toggle doesn't touch mirror state (mirror stays enabled across classic↔slim; LUT rebuilds per variant, semantics preserved).
- **API surface parity:** `lib/editor/tools/dispatch.ts` is the new shared API for both paint surfaces. Any M6+ tool additions only touch dispatch.ts + the new tool's file.
- **Integration coverage:** Dispatcher is unit-testable with mocked StrokeContext. Full render-integration tests remain deferred (jsdom limitations for R3F).
- **Unchanged invariants:**
  - Zero-allocation in pointer hot paths (M3). Dispatcher follows the same rule: inline scalar math, out-param bboxes, no per-event object returns.
  - Caller-owned GPU disposal (M2). M5 adds no new GPU resources unless `MirrorBadge` is included.
  - Narrow-selector contract (M3). All new store consumers subscribe narrowly to `mirrorEnabled` or `activeTool` specifically.
  - R3F paint pattern 8 decisions (M4). Dispatcher + new tools honor Y-flip, clampAtlas, stopPropagation, pointer capture, button filter, dedup refs, flushLayer-in-stroke-composite-on-end, per-frame-only on 3D drags.

## Risks & Dependencies

| Risk | Level | Mitigation |
|---|---|---|
| Mirror LUT face-key swap rules get wrong signs; right-arm mirrors to a pixel that's not the visual mirror on left-arm | P1 | Test-first (Unit 5). 10 test cases including involution + per-part sweep. Visual acceptance in Unit 8. |
| Picker samples overlay transparent pixel → activeColor becomes something weird (alpha=0 with garbage RGB) | P2 | M5 policy: apply activeColor only if `alpha > 0`. Enforced at paint-surface level, not in picker.ts (picker.ts returns the raw data; callers filter). Documented in D4. |
| Bucket fill at a seam doesn't fill the "right" island (e.g., user clicks the boundary pixel between head.front and head.right) | P2 | `islandIdAt` assigns every pixel to exactly one island (no ambiguity at seams — seams are between pixels, not on them). Already verified by M3 flood-fill tests. |
| Mirror + bucket produces visible overlap on head/body where mirror pixel is in the same rect as seed | P3 | Acceptable — both fills write the same color, result is correct. Noted in D1. |
| Alt-hold modifier conflicts with browser shortcut (Alt+Shift+... opens menus) | P3 | Focus guard + specifically only handle bare Alt (no other modifier). Test coverage. |
| Keyboard shortcut fires in a modal or popover that's not a proper INPUT | P3 | Focus guard extends to `role="application"` (ColorPicker SL square). Future modals can add their own guard attribute. |
| Tool dispatcher adds abstraction that proves premature | P2 | Justified by concrete math: 2 surfaces × 4 new tools × mirror modifier = 16 behavior combinations. Without dispatcher, these scatter across 2 files; with it, 1 module. Deferral would make M5 uglier, not cleaner. |
| Dispatcher's `strokeStart` returning `boolean` for `commitToRecents` gating is over-engineered | P3 | Alternative: surface calls `commitToRecents` unconditionally (M3 did this). Extra recents inserts for no-op bucket clicks isn't harmful. Decide during implementation; if the boolean adds noise, drop it. |
| Bundle delta exceeds +10 kB | P3 | drei + three already loaded; M5 adds only pure-function tools (~2-4 kB) + store slot + minor Toolbar changes. Well under budget. Measure in Unit 8. |

## Documentation / Operational Notes

- **Update `docs/COMPOUND.md` M5 entry** via `/ce:compound` post-merge. Pre-flagged captures:
  - Mirror LUT pattern (same shape as overlay-map).
  - Tool dispatcher abstraction — the call shape for future tools.
  - Alt-hold modifier via a stable-ref hook.
  - Keyboard shortcut hook pattern — extraction target for M6+.
  - The "mirror is a modifier not a tool" decision + store migration.
- **Update `docs/solutions/integration-issues/r3f-pointer-paint-on-textured-mesh-2026-04-20.md`** with a new 9th decision: "Use a tool dispatcher for multi-tool paint surfaces." M5 is the first to need it.
- **No new CVE surface** — M5 adds no dependencies.
- **No operational concerns** — client-only, no backend, no env vars, no migrations.

## Acceptance Criteria

### Automated (all must pass before PR open)

1. `npm run lint` — 0 errors / 0 warnings.
2. `npx tsc --noEmit` — 0 errors.
3. `npm run test` — **all M4 tests pass (178) + all new M5 tests pass** (estimated ~50 new). Targeted coverage per unit: Unit 0 ~8, Unit 1 ~4, Unit 2 ~8, Unit 3 ~8, Unit 4 ~7, Unit 5 ~11, Unit 6 ~10, Unit 7 ~10.
4. `npm run build` — succeeds, both routes generated, no new warnings.
5. Bundle delta: `/editor` First Load JS ≤ 372 kB (M4 baseline 362 + 10 budget).
6. HTTP 200 on `/` and `/editor` via `npm run dev`.
7. Zero `any` types added in `app/` or `lib/`.
8. Zero new dependencies in `package.json`.

### Manual (verified on `npm run dev` before PR ready-for-merge)

9. **[R1]** Select eraser (E key). Click a painted pixel on 2D or 3D → pixel becomes transparent (invisible on model; 2D canvas shows through to background).
10. **[R2]** Select picker (I key). Click any painted pixel → `activeColor` updates to that pixel's hex (observable in the color-preview swatches). Alt-hold + click with pencil active also samples.
11. **[R3]** Select bucket (G key). Click on a body-part face → that face fills with `activeColor`. Click an adjacent face of the same part → that face fills separately (no seam bleed).
12. **[R4]** Press M → mirror indicator on toolbar flips. Paint a pencil stroke on right-arm.front → mirror pixels appear on left-arm.front simultaneously.
13. **[R5]** Paint on head.front off-center → mirror appears on head.front itself (self-mirror within the rect). Verify visually: a stroke on the left half of the face appears on the right half too.
14. **[R6]** Keyboard shortcuts B / E / I / G / M all fire correctly. Focus a text input (future work — can verify by the hex input in ColorPicker): shortcuts do NOT fire. Cmd+B / Ctrl+E / Alt+I do NOT fire.
15. **[R7]** Bucket hover preview: hovering on 2D canvas with bucket active shows a 20% white overlay on the connected same-color region within the hovered island.
16. **[R8]** Every tool works on both 2D UV canvas AND 3D player model. Behavior identical (same brush size, same mirror, same color).
17. **[R11]** Toggle variant mid-session with mirror enabled. Mirror continues to work correctly with slim arm widths.
18. **[M3 P2 #2]** Cmd+B while editor is focused → no pencil swap (resolves the open gotcha carried from M3).

### Manual — bundle + performance

19. `/editor` First Load JS ≤ 372 kB on `npm run build` output.
20. Paint a 50-stroke stress test (long drag with pencil, then eraser, then bucket fill, then mirror pencil). Frame rate stays ≥55fps in Chrome DevTools Performance.
21. Bucket fill on the largest single island (body-front = 8×12 = 96 pixels) completes visibly instantaneously (< 16ms).

## Sources & References

- **DESIGN.md §9** — Tools table (B/E/I/G/M shortcuts).
- **DESIGN.md §9.1** — Island-aware flood fill spec (already implemented in M3).
- **DESIGN.md §9.2** — Mirror tool spec.
- **DESIGN.md §12.5 M5** — Milestone review + compound expectations.
- **`docs/COMPOUND.md` M3** — Bucket hover preview left dormant; flood-fill + island-map infrastructure.
- **`docs/COMPOUND.md` M4** — Tool dispatcher prerequisites (R3F paint pattern, OrbitControls gestures, button filter).
- **`docs/solutions/integration-issues/r3f-pointer-paint-on-textured-mesh-2026-04-20.md`** — Canonical R3F paint pattern. M5 extends by adding the 9th decision (tool dispatch).
- **`lib/editor/island-map.ts`** — `getIslandMap`, `islandIdAt`, `isOverlayIsland`, `OVERLAY_ISLAND_ID_BASE`, 72-island encoding.
- **`lib/editor/flood-fill.ts`** — `floodFill`, `applyFillMask`. M3 implementation.
- **`lib/editor/tools/pencil.ts`** — Reference for new tool shape.
- **`lib/three/overlay-map.ts`** — LUT pattern that mirror-map follows exactly.
- **Related PRs:** #5 (M3 merge), #6 (M4 merge). No M5 PR yet.

## /ce:plan review answers

### 1. Hardest decision

Whether to keep `'mirror'` as a `ToolId` or promote it to a modifier boolean. The scaffolding at M3 put `'mirror'` in the union, so the natural M5 path is "just implement the mirror tool" — but DESIGN §9 explicitly describes it as a toggle on subsequent strokes, which is modifier semantics. Keeping it as a tool would mean the user has to deselect mirror to return to normal pencil, which is bad UX and mismatches every other paint app's symmetry pattern.

Promoting to a modifier is correct but requires a store schema migration, store-consumer updates, and UI behavior change on the mirror button. Low total lines of code changed, but the migration touches user-visible state, so it has blast radius. Chose modifier per DESIGN's phrasing — documented as D1 with rationale.

Secondary hardest decision: whether to introduce a tool dispatcher (`dispatch.ts`) or leave tool selection inline in each paint surface. 2 surfaces × 4 new tools × mirror = 16 behavior combinations; inline = scattered duplication. Dispatcher adds one indirection layer but eliminates real combinatorial duplication. Chose dispatcher.

### 2. Alternatives rejected

- **Keep `'mirror'` in `ToolId`.** Matches M3 scaffold; mismatches DESIGN §9 phrasing and user expectations. Rejected per D1.
- **Skip the dispatcher; put tool `switch` statements inline in ViewportUV and PlayerModel.** Each tool's paint logic duplicated across both surfaces. 2 × 4 = 8 inline branches + mirror sprinkled everywhere. Rejected per D2.
- **Deferred Alt-hold picker to M8.** DESIGN §9 explicitly names it; M5 ships it alongside 'I' tool. Long-press touch picker is the piece actually deferred (gesture-conflict + timer complexity not worth M5 scope).
- **Progressive disclosure: hide toolbar buttons until first use.** DESIGN mentions but doesn't specify. Current 5-button always-visible layout is simpler and matches pixel-editor conventions. Rejected.
- **Mirror as a per-stroke (rather than per-stamp) operation.** For a drag stroke, you'd compute the mirror of each sample and draw it; for bucket, you'd compute the mirror of the seed. Per-stamp is simpler and produces identical results for atomic tools. Rejected (already per-stamp by design).
- **Introduce a `ToolContract` class-like interface for each tool.** Object-orientation would cleanly encapsulate each tool. Rejected — pure functions are simpler, more testable, and match the existing `pencil.ts` pattern.
- **Defer Unit 0 simplicity extracts to M6.** Postponing would mean the dispatcher re-duplicates `hexDigit` / `clampAtlas`. Doing Unit 0 first aligns the plumbing. Rejected (kept as Unit 0).
- **Add tool-specific 3D cursor decals (eraser crosshair, picker eyedropper, bucket paint-can).** Scope creep for M5. The 2D `BrushCursor` already varies; 3D decal stays single icon for M5, varies in M8 polish.
- **Deferred variant-mirror-LUT-rebuild to runtime.** Currently module-init per variant. If variant is a runtime slot (it is), LUTs are cached once per variant. No rebuild needed per stroke. Same pattern as M4 overlay-map. Not an alternative I seriously considered; mentioned for completeness.

### 3. Least confident

The exact face-key swap rules in the mirror LUT — specifically whether `rightArm.right` should mirror to `leftArm.left` (face swap, no face-local X flip) or `leftArm.right` (no face swap, with face-local X flip). The semantic difference is: does the MIRROR PLANE flip the face-axis identity (the +X face of rightArm becomes the -X face of leftArm), or does it keep the face-axis identity and just flip face-local X (the +X face of rightArm stays +X for the mirror but the pixel order is reversed)?

Geometrically: a mirror reflection across the X=0 plane sends +X → -X in three.js world space. rightArm is at x > 0; leftArm is at x < 0. The +X face of rightArm is on the outside (far from body centerline) and faces +X. Mirror it: the mirrored arm is on the left (x < 0); its outside face now faces -X (facing outward from the mirrored world). That's the -X face = left face. So `rightArm.right → leftArm.left` with NO face-local X flip additional.

Hmm actually wait — consider a rightArm.front (+Z face, which always faces the camera). Mirror the character across X. The mirrored character's leftArm is where rightArm used to be mirrored-through-X; its +Z face still faces the camera. So rightArm.front → leftArm.front (front stays front, no face swap). Within THAT face, the face-local X flips: rightArm.front pixel at face-local (1, 3) becomes leftArm.front pixel at face-local (w-1-1, 3).

So: front ↔ front, back ↔ back, top ↔ top, bottom ↔ bottom (same face); right ↔ left, left ↔ right (swapped); face-local X flips in ALL cases.

That's what I wrote in D3 — but I flagged "least confident" because I want the implementer to TDD this. There are 4 combinations of (face-swap yes/no) × (face-local-X-flip yes/no) and only one is correct. Test-first drives out the right one.

Secondary low-confidence: keyboard handler focus guard on `role="application"` elements. ColorPicker's SL square has that role, and its arrow-key handler would conflict with "E" (eraser swap) if a user is focused there. I'm not 100% sure `document.activeElement` accurately reports the SL square when focus is on it (the element has `tabIndex={0}` so it can receive focus). If it doesn't, the guard has no effect and arrow-key color nudging still works. But 'e' in the SL square would fire eraser swap spuriously. TDD in Unit 7 covers it.
