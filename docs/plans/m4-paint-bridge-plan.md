---
title: M4 — 2D↔3D Paint Bridge
type: feat
status: active
date: 2026-04-20
milestone: M4
depth: Deep
---

# M4 — 2D↔3D Paint Bridge

> **Final save target:** `docs/plans/m4-paint-bridge-plan.md` (matches `m1-scaffold.md` / `m2-player-model-plan.md` / `m3-paint-canvas-plan.md` convention).
> **Origin inputs:** user's `/ce:plan` invocation on 2026-04-20 with cross-AI consultation results baked in (UX locked from Gemini cursor/affordance choices, technical patterns from Perplexity R3F research).
> **Plan type:** **Deep** (highest technical risk per DESIGN.md §12.5; couples three previously-independent surfaces: raycast → texture pipeline → Zustand hover state).

## Context

M1 shipped the scaffold. M2 shipped the 3D player model (12 meshes: 6 base + 6 overlay, 72 pinned UV rects across 2 variants, prop-passed caller-owned geometries disposed via `useEffect`). M3 shipped the 2D paint surface, pencil tool, `TextureManager`, `Zustand` store, `IndexedDB` persistence, and island-map scaffolding — all with narrow-selector discipline per amendment 3's regression test. M4 is the first milestone where the 3D viewport becomes *interactive* rather than decorative: pointer events on the player model raycast to a UV coordinate, convert to an atlas pixel, paint via the same `Layer.pixels` + `TextureManager.composite()` + `markDirty()` path the 2D side already uses. The 2D and 3D surfaces converge on one `hoveredPixel` global so either side can show where the user is about to paint on the other.

M4 does **not** add new tools (M5), layers/undo (M6), mirror (M5), templates (M7), export (M8), or color-blind mode (M8). M4 is purely: (a) pencil on 3D, (b) bidirectional hover, (c) base/overlay "implicit precedence with micro-affordance."

## Overview

Ship the bidirectional paint bridge. User clicks or drags on the 3D player model; the raycast hit's UV gets converted to a 64×64 atlas coordinate and passed through the same pencil pipeline `ViewportUV` uses (`stampPencil` → `TextureManager.composite` → `markDirty`). Hover state is hoisted from `ViewportUV` local state to a new `hoveredPixel` store slot so the 3D cursor decal and the 2D hover tint both read from one source. Base/overlay precedence is handled via a pre-computed `OVERLAY_TO_BASE_ATLAS` LUT and a transparency-threshold check: clicking on an overlay pixel with `alpha < threshold` paints the base pixel at the corresponding UV; clicking an opaque overlay pixel paints the overlay. A small "BASE" / "OVERLAY" label floats near the 3D cursor so users understand which layer their next paint will hit. Drag interpolation on the 3D surface is **per-frame only** for M4 — Bresenham atlas-space interpolation is deferred to M5/M6 because it would bleed across UV seams (head-front → head-right face jump in atlas space is not 3D-adjacent).

## Pinned versions (delta from M3)

| Package | Previous (M3) | M4 | Notes |
|---|---|---|---|
| All M1/M2/M3 pins | same | **unchanged** | `next 15.5.15`, `react 19.2.5`, `three 0.184.0`, `@react-three/fiber 9.6.0`, `@react-three/drei 10.7.7`, `zustand 5.0.12`, `idb-keyval 6.2.2`, `tailwindcss 4.2.2`, `vitest 3.2.4`, `jsdom 27.0.0`, `eslint 9.39.4`. |

**Peer-dependency check:** M4 adds **no new dependencies**. The R3F `<mesh onPointerDown>` handler, `event.uv`, `raycaster.firstHitOnly`, and `material.side` are all already available in the pinned three.js 0.184.0 / R3F 9.6.0 surface. `drei`'s `<Billboard>` component (already installed but unused until now) handles the 3D cursor camera-facing math; no new install required.

**Removals under evaluation (tracked separately):** `@testing-library/react` + `@testing-library/dom` were flagged in M3 review as unused and safe to remove. M4 does **not** resolve this — it's orthogonal. Track as a standalone M5 chore.

## Files to create / modify

**`lib/three/` — extends existing**

- `lib/three/overlay-map.ts` — **new**. Builds two `Uint16Array(4096)` lookup tables (Classic, Slim) where each overlay atlas pixel maps to its corresponding base atlas pixel index. Sentinel value `0xFFFF` means "no mapping" (pixel is not in any overlay rect). Module-init cost: ~4096 iterations × 2 variants, one-time. Runtime cost: O(1) per pixel lookup.
- `lib/three/PlayerModel.tsx` — **modify**. Becomes a client component with narrow store subscriptions (`activeTool`, `brushSize`, `activeColor`, `hoveredPixel`, `setHoveredPixel`, `commitToRecents`, `variant`). Wires `onPointerDown`/`onPointerMove`/`onPointerUp` to each mesh, converts `e.uv` to atlas coords with Y-flip, applies overlay/base precedence, paints via `stampPencil` → `textureManager.composite` → `markDirty`. Holds `paintingRef` + `lastPaintedAtlasRef` the same way `ViewportUV` does. Gets `textureManager`, `layer`, `markDirty` threaded in as props. Preserves the M2 `useFrame` orbit/breathing loop (zero-alloc invariant).
- `lib/three/constants.ts` — **modify** (append-only). Add `OVERLAY_ALPHA_THRESHOLD = 10` (0-255 scale; matches M2's `alphaTest={0.01}` of ~2.55/255) and `CURSOR_DECAL_SIZE = 0.025` (world units, ~1 atlas-texel at head scale) and `CURSOR_DECAL_DISTANCE_SCALE_MAX = 1.15` (per cross-AI 10-15% scale bump at distance).

**`lib/editor/` — extends existing**

- `lib/editor/store.ts` — **modify**. Add `hoveredPixel: { x: number; y: number; target: 'base' | 'overlay' } | null` slot and `setHoveredPixel(next): void` action. Rationale: single-source-of-truth for bidirectional hover lets either surface show the cursor preview; `target` field drives the BASE/OVERLAY micro-affordance label. Narrow-selector contract from M3 extends — consumers subscribe to the field they need, not the whole slot.

**`app/editor/_components/` — extends existing**

- `app/editor/_components/CursorDecal.tsx` — **new**. Billboard quad (white, 2px black border, slight distance scale-up) rendered at the 3D world position of the hovered atlas pixel's UV. Snapped to UV texel centers (not raw hit points — see cross-AI UX decision 1). Reads `hoveredPixel` from the store. Returns `null` when `hoveredPixel === null` or `activeTool` isn't pencil-capable. Uses `renderOrder` offset to prevent z-fighting with overlay meshes (per known gotcha). Uses drei `<Billboard>` for camera-facing.
- `app/editor/_components/CursorLabel.tsx` — **new** (can be inlined into `CursorDecal.tsx` if it stays under ~20 lines). Small HTML label floating near the 3D cursor showing "BASE" or "OVERLAY" based on `hoveredPixel.target`. Uses drei `<Html>` with `occlude` + `transform` props for DOM-in-3D rendering. Only visible when hovering an ambiguous region (i.e., when the hit is an overlay mesh — base-only hits don't need the label).
- `app/editor/_components/EditorCanvas.tsx` — **modify**. Thread `textureManager`, `layer`, `markDirty` through to `PlayerModel`. Render `<CursorDecal />` inside the `<Canvas>` tree. Add `raycaster.firstHitOnly = true` via R3F's `raycaster` prop or a one-time `gl` effect (prevents bleed-through on occluded body parts).
- `app/editor/_components/EditorLayout.tsx` — **modify**. Thread `bundle.layer` and `markDirty` to `EditorCanvas` (currently only `texture` + `variant` are passed).
- `app/editor/_components/ViewportUV.tsx` — **modify**. Replace local `hoverPixel` state with store `hoveredPixel`. Emit `setHoveredPixel` on pointer-move (gated on `activeTool` like today's bucket path, but extended to pencil too). Compute `target: 'base' | 'overlay'` from `islandIdAt(islandMap, x, y)` — if the island ID corresponds to an overlay part (IDs 37-72 per PART_ID_ORDER), target is 'overlay'; otherwise 'base'.
- `app/editor/_components/BucketHoverOverlay.tsx` — **modify**. Read `hoveredPixel` from store instead of receiving via prop. Pattern-match with `CursorDecal.tsx` so both surfaces consume the same slot.
- `app/editor/_components/PencilHoverOverlay.tsx` — **new**. Mirrors `BucketHoverOverlay`'s M3-inert pattern but for pencil hover. Renders a 15-25% additive white tint + 1px border at the hovered pixel on the 2D atlas canvas when `activeTool === 'pencil' && hoveredPixel !== null`. Uses the existing TM-canvas overlay pattern (absolute-positioned canvas overlayed on the TM canvas). Single pixel highlight; no flood-fill like bucket's.

**`tests/` — extends existing**

- `tests/overlay-map.test.ts` — **new**. Unit tests for `buildOverlayMap` and `overlayToBase(variant, x, y)`. Scenarios enumerated in Unit 2's test scenarios.
- `tests/paint-bridge.test.ts` — **new**. Pure-function tests for `uvToAtlas(uv: {x, y})` (Y-flip) + overlay/base precedence resolution given an `alpha` value. Scenarios enumerated in Unit 3's test scenarios.
- `tests/hover-store.test.ts` — **new**. Zustand slice test for `hoveredPixel` + `setHoveredPixel` — happy path, null clear, target-field preservation, narrow-selector contract (mirrors M3's `color-picker-selectors.test.ts` using React.Profiler — copy the skeleton from `docs/solutions/test-failures/vitest-jsdom-react-component-testing-setup-2026-04-20.md`).
- `tests/island-map.test.ts` — **modify**. Add assertion that islands 37-72 are the overlay parts (tightens M3's ≥3000 lower bound per review finding; also supports Unit 1's `isOverlayIsland` helper).

**Out of scope** (explicit non-goals for M4, deferred per constraints):

- No new tools (`eraser`, `bucket`, `picker`, `mirror`) — M5.
- No undo/redo — M6.
- No layer panel (overlay toggle UI) — M6.
- No `OrbitControls` or camera-gesture system — M8 polish.
- No touch support beyond what R3F's pointer events give for free — M8.
- No Bresenham drag interpolation on 3D surface — deferred to M5/M6 (requires 3D-space ray-stepping to avoid atlas-seam bleed; out of M4 scope).

## Requirements trace

- **R1.** Click on a body part of the 3D player model → the active pencil color paints that texel, visible on both 3D and 2D within 16ms (one frame). [DESIGN §12.5 M4 P1 review criterion; cross-AI scope item 1.]
- **R2.** Drag on the 3D player model → continuous paint stroke at pointer-move cadence. Drag gaps acceptable in M4; interpolation deferred. [Cross-AI open decision 1.]
- **R3.** Click / paint on the 2D UV canvas → visible on 3D within 16ms (already works since M3; regression-test against M4 changes). [DESIGN §12.5 M4 P1.]
- **R4.** Hover the 3D model with pencil active → a billboarded square cursor decal appears, snapped to the UV texel center, with slight distance scale-up. [Cross-AI UX decision 1.]
- **R5.** Hover either surface with pencil active → the *other* surface shows a 15-25% additive white tint + 1px border on the corresponding pixel. One `hoveredPixel` store slot drives both. [Cross-AI UX decision 2.]
- **R6.** Clicking on a 3D mesh where the overlay atlas pixel is transparent (`alpha < OVERLAY_ALPHA_THRESHOLD`) paints the base layer at the corresponding UV. Clicking where the overlay pixel is opaque paints the overlay. [Cross-AI UX decision 3 + DESIGN §12.5 M4 "no crosstalk between base and overlay."]
- **R7.** A small "BASE" or "OVERLAY" label appears near the 3D cursor when the hit is ambiguous (overlay mesh), indicating which layer will receive the next paint. [Cross-AI UX decision 3.]
- **R8.** Raycast occludes first-face-only — no bleed-through to body parts behind the head. [Cross-AI open decision 2 + known gotcha `raycaster.firstHitOnly`.]
- **R9.** `activeTool !== 'pencil'` on the 3D surface is a no-op (pointer events don't crash, but produce no paint and no cursor). M5 will extend.
- **R10.** Variant toggle (Classic ↔ Slim) mid-session correctly rebuilds the island map, overlay map, and hover coordinates. No stale LUT references.
- **R11.** All M3 tests still pass (78/78). Zero regressions to 2D pencil, color picker, persistence, or island-map.
- **R12.** `npm run lint`, `npx tsc --noEmit`, `npm run build`, `npm run test` all clean. Bundle delta ≤ +5 kB First Load JS vs M3's 352 kB baseline.

## Scope boundaries

- **No bucket fill bridge.** Bucket currently does not paint in M3 — only hover preview. M5 extends.
- **No mirror tool.** M5.
- **No layer opacity / blend modes.** M6.
- **No undo on 3D paint.** M6; but M4 must not break the M3 recents FIFO contract (`commitToRecents` only fires on stroke start, once per stroke).
- **No 3D-space Bresenham interpolation.** Per-frame sampling only. Accept drag gaps on fast motion.
- **No cross-surface continuation of a single stroke.** If the user pointer-downs on 2D, drags onto the 3D viewport, and releases, each surface gets its own `paintingRef` lifecycle. Cross-surface painting is not a DESIGN.md requirement and would require `<Canvas eventSource>` hoisting; defer to a future plan.
- **No texture pickers, no gradient tools, no selection.** Not in any roadmap milestone.

## Context & Research

### Relevant code and patterns

- **`lib/three/PlayerModel.tsx`** — current 12-mesh layout with shared `texture` prop, `renderOrder` overlay=1 / base=0 split, `transparent={isOverlay}`, `depthWrite={!isOverlay}`, `alphaTest={isOverlay ? 0.01 : 0}`. M4 extends this: same mesh structure, add pointer handlers per mesh, no structural changes.
- **`lib/three/geometry.ts`** — `CLASSIC_UVS` + `SLIM_UVS` per-part 6-face `UVRect` records. Canonical atlas layout. `mapBoxUVs(geo, uvs)` writes per-corner UVs with `v = 1 - y/64` (atlas-top-down → UV-bottom-up). M4's atlas-coord conversion uses the exact same flip: `atlasY = floor((1 - uv.y) * 64)`.
- **`lib/editor/island-map.ts`** — `getIslandMap(variant)` returns a `Uint8Array(4096)` where each pixel stores 1-72 (12 parts × 6 faces). `islandIdAt(map, x, y)` returns 0 for OOB. IDs 1-36 are base parts; 37-72 are overlay parts (per PART_ID_ORDER: head/body/rArm/lArm/rLeg/lLeg = IDs 1-36 across 6 faces; headOverlay through leftLegOverlay = IDs 37-72).
- **`app/editor/_components/ViewportUV.tsx`** — M3's 2D paint loop with `paintingRef`, `lastPaintedXRef`/`lastPaintedYRef`, `stampPencil` on pointerdown + `stampLine` on pointermove, `textureManager.composite([layer])` + `markDirty()` on each event. M4's 3D paint loop mirrors this structure exactly, minus the `stampLine` interpolation.
- **`lib/editor/tools/pencil.ts`** — `stampPencil(pixels, x, y, size, r, g, b, a)`. Top-left convention `halfLeft = min(1, size-1)`. Clips OOB writes. M4 reuses as-is.
- **`lib/editor/use-texture-manager.ts`** — `useTextureManagerBundle(variant)` returns `{textureManager, layer} | null` + disposes on variant change. M4 adds no changes here; both `ViewportUV` and `PlayerModel` now receive the same bundle via prop-threading through `EditorCanvas` + `EditorLayout`.
- **`tests/color-picker-selectors.test.ts`** — M3's React.Profiler render-count regression test pattern. M4's `tests/hover-store.test.ts` copies this skeleton verbatim.

### Institutional learnings

- **`docs/solutions/performance-issues/r3f-geometry-prop-disposal-2026-04-18.md`** — caller-owned GPU resources need explicit `useEffect` disposal. M4's `CursorDecal` creates a `BufferGeometry` + possibly a `CanvasTexture` for the border sprite; must dispose on unmount / variant change. Same rule as M2.
- **`docs/solutions/test-failures/vitest-jsdom-react-component-testing-setup-2026-04-20.md`** — the five-gotcha cluster for React 19 + Vitest + jsdom. `hover-store.test.ts` reuses the skeleton (IS_REACT_ACT_ENVIRONMENT, Profiler onRender, `createElement` in `.test.ts`). Stubs for Canvas/ImageData remain scoped per-test.
- **`docs/COMPOUND.md` M3 §Gotchas** — (1) mid-stroke variant toggle leaves `paintingRef=true` against a new layer (P1 follow-up); (2) hydrate overwrites live strokes (P1 follow-up); (3) `handleWheel` commits zoom+pan as two separate store sets (P2); (4) 'b' hotkey doesn't guard modifiers. **M4 must resolve #1 and #2 before landing 3D paint** — otherwise the same races apply to the 3D surface with larger surface area (M4 paintingRef + 2D paintingRef can both be stuck on).
- **`docs/COMPOUND.md` M2 invariants** — `useFrame` zero-alloc (M4 must not regress PlayerModel's current orbit/breathing loop); `Record<Union, T>` for exhaustive arrays (use for `PART_TO_OVERLAY_MAPPING` LUT lookups).
- **`docs/COMPOUND.md` M3 pinned facts** — cursor-centered wheel zoom math in `ViewportUV.tsx:125-147` is canonical. M4's `CursorDecal` doesn't reuse it (3D is different math), but future 2D→3D synchronized zoom (not in M4) would.

### External references

Cross-AI research completed pre-plan; key technical patterns carried forward:

- R3F's `event.uv` is auto-populated and auto-normalized (0→1) on BoxGeometry. Tested reliable via skinview3d's prior art and Perplexity's R3F community patterns.
- `raycaster.firstHitOnly = true` prevents multi-hit enumeration; set via `gl` in Canvas onCreated or directly on the raycaster instance.
- `material.side = THREE.FrontSide` is the three.js default; verify not overridden anywhere. Prevents backface hits when camera rotates behind a part.
- `THREE.CanvasTexture` with direct canvas mutation + `texture.needsUpdate = true` is the pattern M3 already uses; M4 adds no new texture lifecycle concerns.
- `drei` `<Billboard>` for camera-facing sprites; `<Html>` with `transform` + `occlude` for DOM-in-3D labels. Both already installed via drei 10.7.7.
- Touch: `e.stopPropagation()` + `setPointerCapture` during paint, disable OrbitControls. M4 has no OrbitControls yet, so just stopPropagation is sufficient.
- Cursor decal z-fighting: use renderOrder offset (overlay=1, decal=2).

## Key technical decisions

### D1 — Paint orchestration lives in PlayerModel, not a separate controller

**Decision:** Add store subscriptions + paint logic directly inside `lib/three/PlayerModel.tsx`.

**Rationale:** An alternative was a sibling `PlayerPaintController.tsx` that wraps `PlayerModel` and owns the store. Rejected because:
- `PlayerModel` is already `'use client'` and already subscribes to its `variant` prop.
- Wrapping would require prop-drilling `textureManager`, `layer`, `markDirty` through TWO components instead of one.
- `PlayerModel` is the only thing that holds per-mesh refs; splitting orchestration away from the mesh tree creates two sources of truth for pointer state.
- The M3 pattern is `ViewportUV` owns its own paint loop. Symmetry: `PlayerModel` owns the 3D paint loop. The orchestration parity is cleaner than a wrapper-asymmetry.

Tradeoff: `PlayerModel` gets bigger (~250 lines estimated). Acceptable; still focused on one concern (3D player model including its interactions).

### D2 — Overlay/base precedence uses a pre-computed LUT

**Decision:** Build `OVERLAY_TO_BASE_ATLAS: Uint16Array(4096)` per variant at module init in `lib/three/overlay-map.ts`. Each overlay atlas pixel index maps to the matching base atlas pixel index; non-overlay pixels map to `0xFFFF`.

**Rationale:** Three alternatives considered:
- (a) Per-event rect-local coord math: given hit UV and its island ID, find the face rect, compute local coords, look up the base rect, convert back to atlas. ~10 lookups + 6 arithmetic ops per event. Rejected because event cadence is 60-200 Hz and the math is derivable once.
- (b) Per-click iteration through all overlay rects to find containing rect: O(72) per event. Rejected; worse than (a).
- (c) Pre-computed LUT: O(1) per event, ~4 KB per variant (8 KB total) for module-scope memory. **Chosen.**

The LUT is built deterministically from `CLASSIC_UVS` / `SLIM_UVS` (same data that drives `island-map.ts`). Adding the LUT is zero-risk to the atlas layout — if the UV data is wrong, tests catch it in multiple places.

### D3 — `hoveredPixel` stores `target: 'base' | 'overlay'` in one slot

**Decision:** Single `hoveredPixel: { x, y, target } | null` in the store, set by whichever surface is producing the hover event (2D or 3D).

**Rationale:** Cross-AI locked "single Zustand hoveredPixel coordinate shared by both views." Adding `target` inline avoids a second store read for label rendering; the field is cheap (`'base' | 'overlay'` literal). Alternative would be to derive `target` from `(x, y)` in each consumer by re-looking up the island map — wasteful and error-prone if the producer already knew.

The `x, y` always stores the **target atlas coord** (after overlay/base precedence resolution). So if the user hovers an overlay mesh but the pixel is transparent, `hoveredPixel = { x: <base_atlas_x>, y: <base_atlas_y>, target: 'base' }` — the 2D side shows the hover on the base atlas region, and the 3D cursor snaps to the base-region UV projected back onto the mesh. This keeps every consumer aligned.

### D4 — Drag interpolation deferred; per-frame only in M4

**Decision:** No `stampLine` interpolation between pointer-move samples on the 3D surface. Each pointer-move computes atlas coord + `stampPencil` + composite + markDirty.

**Rationale:** On 2D, `stampLine` between atlas coords is straightforward — pixels are contiguous. On 3D, two consecutive pointer-move samples can hit atlas coords that are **not adjacent in the atlas** — e.g., head-front rect at (8,8) and head-right rect at (0,8) aren't adjacent despite the 3D faces being edge-adjacent. A naive atlas-space Bresenham would paint across the head-front→head-top boundary through arbitrary pixels that happen to lie between. Options to solve: (a) 3D-space ray-stepping (complex, another milestone); (b) island-gated Bresenham that skips discontinuous pixels (partial solution, drops paint across seams); (c) defer entirely (M4 scope). Cross-AI locked "start with per-frame, add Bresenham if gaps appear in testing" — this plan chooses (c) with an explicit revisit gate in M4 acceptance testing.

### D5 — Raycast first-hit + FrontSide prevents bleed-through

**Decision:** Set `raycaster.firstHitOnly = true` once at Canvas creation. Confirm `material.side = THREE.FrontSide` (the three.js default; don't override).

**Rationale:** The overlay meshes are +1 pixel larger than base meshes on each axis (per M2 COMPOUND). If the raycaster returned all hits along the ray, a click on the overlay could also hit the base mesh behind it and potentially paint twice. `firstHitOnly` returns just the front-most intersection. Combined with `FrontSide`, camera-facing faces are the only paint target — backface hits (visible when camera orbits behind the head) don't produce paint events.

### D6 — CursorDecal snaps to UV texel centers, not hit points

**Decision:** `CursorDecal` position is computed from the atlas pixel coord → back to the center of that atlas texel → projected via the mesh's UV-to-world transform. Not the raw hit point.

**Rationale:** Per cross-AI UX decision 1. If the decal followed the raw hit point, it would shift sub-pixel within a texel as the user wiggles, making it hard to tell which pixel will actually be painted. Snapping removes ambiguity and matches M3's 2D pencil behavior (the 2D atlas coord is always a whole-pixel integer).

**Implementation sketch** (directional, not implementation): given `hoveredPixel = {x, y}`, compute texel-center UV as `(x + 0.5) / 64, 1 - (y + 0.5) / 64`. Find the mesh whose UV range contains that UV (via `PART_ID_ORDER` + face rect lookup). Transform texel-center UV to the mesh's local 3D coord via the inverse of `mapBoxUVs`. Place decal at `mesh.position + localCoord + face.normal * 0.001` (small epsilon to prevent z-fighting). Billboard via drei.

### D7 — Resolve M3 P1 follow-ups before M4 paint logic lands

**Decision:** Unit 0 of M4 fixes the two P1 races from M3 review (mid-stroke variant toggle + hydrate overwrite) before any 3D paint code lands.

**Rationale:** M3 review flagged both as P1 but merged (documented in COMPOUND.md). M4 introduces a SECOND `paintingRef` in `PlayerModel`; without fixing the variant race, the user who paints while toggling variant now has two stuck-on painting refs instead of one. Prerequisite work, not optional.

## Open questions

### Resolved during planning

- **Q:** Where do 3D pointer events attach — mesh-level or Canvas-level?
  **A:** Mesh-level (`<mesh onPointerDown>`). R3F handles raycasting per-mesh automatically. Canvas-level would need manual raycast.
- **Q:** Does the 3D viewport need its own `markDirty`-style hook for persistence?
  **A:** No — `markDirty` is already threaded from `EditorLayout` to `ViewportUV` via `useTextureManagerBundle`. M4 threads the same function through to `PlayerModel`.
- **Q:** How does the overlay-base precedence work when the atlas pixel's alpha is exactly at the threshold?
  **A:** `alpha < OVERLAY_ALPHA_THRESHOLD` → paint base; `alpha >= threshold` → paint overlay. Matches the existing `alphaTest: 0.01` in `PlayerModel`'s overlay material (0.01 × 255 ≈ 2.55, rounded to 10 for user-perceptual clarity).
- **Q:** Can the 3D cursor decal reuse `BrushCursor.tsx`'s SVGs?
  **A:** No. `BrushCursor.tsx` returns a CSS cursor URL for 2D. The 3D decal is a billboard quad with a 2D texture. Separate concerns; different rendering paths.
- **Q:** Do we need a separate `<Canvas eventSource>` so 2D and 3D pointers can cross surfaces?
  **A:** No, M4 scope. Each surface owns its own pointer lifecycle. Cross-surface strokes are not required by any DESIGN.md milestone through M8.
- **Q:** How is `commitToRecents` wired on 3D paint?
  **A:** Same as 2D — fire once on pointerdown (stroke start), not per pointermove. Preserves M3's FIFO invariant "only commit when the color affected pixels."

### Deferred to implementation

- **Q:** Exact decal size at various camera distances — needs visual tuning during `/ce:work`. Pinned bounds are `CURSOR_DECAL_SIZE = 0.025` (baseline) and `CURSOR_DECAL_DISTANCE_SCALE_MAX = 1.15` (10-15% scale bump cap). Implementer refines the function shape.
- **Q:** Exact "BASE"/"OVERLAY" label placement — above cursor? Right of cursor? Pinned: near enough to associate, not so close it occludes the decal. Visual tuning during `/ce:work`.
- **Q:** Whether the `raycaster.firstHitOnly` flag survives variant toggle — likely yes (module-scope three.js behavior), but verify during `/ce:work` that the flag is re-set if the Canvas re-creates its raycaster on variant change.
- **Q:** Exact bundle-size impact of drei `<Billboard>` + `<Html>` imports — drei is tree-shaken aggressively but these two imports add ~3-5 kB estimated. Measure in `/ce:work` final acceptance; budget ≤ +5 kB.
- **Q:** Do we need to `setPointerCapture` on the 3D mesh during active stroke? Probably yes for touch reliability, but verify against R3F's built-in pointer capture behavior before adding.

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

### Pointer-event-to-pixel pipeline (parallel for 2D and 3D)

```
┌─────────────────────────────────────────────────────────────────┐
│ 2D surface (ViewportUV)            3D surface (PlayerModel)     │
├─────────────────────────────────────────────────────────────────┤
│ onPointerDown(e)                   onPointerDown(e, mesh)       │
│   clientX/Y → pan/zoom-invert →      e.uv (R3F auto-populated)  │
│   atlasX/Y                         floor(uv.x*64),              │
│                                    floor((1-uv.y)*64)           │
│     ↓                                  ↓                        │
│ paintingRef = true                  if mesh is overlay-part:    │
│ lastPaintedAtlasRef = {x, y}          check layer.pixels        │
│                                       at atlas index; if alpha  │
│ stampPencil(layer.pixels, x, y, …)    < THRESHOLD then          │
│ textureManager.composite([layer])     overlay → base via LUT    │
│ markDirty() (persistence debounce)                              │
│ commitToRecents(hex) (once on down)   paintingRef = true        │
│                                     lastPaintedAtlasRef={x,y}   │
│                                     stampPencil(…)              │
│                                     textureManager.composite    │
│                                     markDirty()                 │
│                                     commitToRecents(hex)        │
├─────────────────────────────────────────────────────────────────┤
│ onPointerMove(e) while painting:   onPointerMove(e) while       │
│   atlasX/Y derivation               painting:                   │
│   stampLine(from lastPainted, to     atlasX/Y (same derivation) │
│     current)                        [NO stampLine — per-frame   │
│   composite, markDirty               only in M4]                │
│                                     stampPencil(…)              │
│                                     composite, markDirty        │
├─────────────────────────────────────────────────────────────────┤
│ onPointerUp/Cancel:                onPointerUp/Cancel:          │
│   paintingRef = false               paintingRef = false         │
└─────────────────────────────────────────────────────────────────┘
```

### Hover state flow (one store slot, two producers, N consumers)

```
           ┌──────────────────────────────┐
           │  Zustand: hoveredPixel       │
           │  { x, y, target } | null     │
           └──────────────┬───────────────┘
                          │
        ┌─────────────────┼─────────────────┐
        │                 │                 │
        ▼                 ▼                 ▼
  Producer A        Producer B        Consumers (read only,
  (ViewportUV       (PlayerModel     narrow selector)
  onPointerMove)    onPointerMove)
        │                 │          ┌─────────────────────┐
        │                 │          │ CursorDecal (3D)    │
        │                 │          │ CursorLabel (3D)    │
        ▼                 ▼          │ PencilHoverOverlay  │
  setHoveredPixel({       ...        │   (2D)              │
    x: <resolved>,                   │ BucketHoverOverlay  │
    y: <resolved>,                   │   (2D, M5)          │
    target:                          └─────────────────────┘
      'base' | 'overlay'
  })
```

The resolution step (who decides `target`?):
- **2D producer:** consults `islandIdAt(islandMap, x, y)`. If `id ∈ [37, 72]` → `'overlay'`; else `'base'`. The atlas coord is whatever the user's cursor is over — no overlay-base redirect on 2D (user directly addresses a pixel).
- **3D producer:** consults the hit mesh's name. If mesh.name ends with "Overlay" → check `layer.pixels` alpha at overlay atlas coord; if `< THRESHOLD`, redirect to base via LUT and set `target: 'base'`; else keep overlay coord and set `target: 'overlay'`. If mesh is base → `target: 'base'`, no redirect.

### Overlay-to-base LUT construction

```
// Directional pseudo-code — not implementation

function buildOverlayMap(uvs: PlayerUVs): Uint16Array(4096) {
  const map = new Uint16Array(4096).fill(0xFFFF)  // sentinel
  for each overlayPart in [headOverlay, bodyOverlay, ...]:
    const basePart = overlayPart.replace('Overlay', '')  // 'headOverlay' → 'head'
    for each face in [top, bottom, right, front, left, back]:
      const overlayRect = uvs[overlayPart][face]
      const baseRect    = uvs[basePart][face]
      // INVARIANT: overlayRect.w === baseRect.w && overlayRect.h === baseRect.h
      // (overlay geometry is +1px on each axis but UVs are original dimensions)
      for each (localX, localY) in rect:
        const overlayIdx = (overlayRect.y + localY) * 64 + (overlayRect.x + localX)
        const baseIdx    = (baseRect.y    + localY) * 64 + (baseRect.x    + localX)
        map[overlayIdx] = baseIdx
  return map
}
```

Builds once per variant at module load. Runtime lookup is `overlayToBase[overlayIdx]` — either a valid base index or `0xFFFF`.

## Implementation Units

- [ ] **Unit 0: Resolve M3 P1 follow-ups (mid-stroke variant race + hydrate overwrite)**

**Goal:** Fix the two P1 races from M3 review before M4 paint lands, so M4 doesn't compound them.

**Requirements:** R10, R11 (preserves all M3 tests).

**Dependencies:** None; prerequisite to every other unit.

**Files:**
- Modify: `app/editor/_components/ViewportUV.tsx` (add effect keyed on `[textureManager, layer]` that resets `paintingRef.current = false` + releases pointer capture)
- Modify: `app/editor/_components/EditorLayout.tsx` (gate paint interaction behind `hydrationPending` flag OR snapshot `layer.pixels` at effect-start and only write `saved.pixels` if still byte-equal)
- Modify: `tests/persistence.test.ts` (add regression test for hydrate-while-painting)
- Create: `tests/viewport-hydrate.test.tsx` OR extend existing — scenarios for mid-stroke variant toggle

**Approach:** Option (a) for hydrate is simpler: a `hydrated: boolean` state in EditorLayout gated with a loading overlay on ViewportUV + (for M4) PlayerModel's pointer handlers. Option (b) is more permissive but error-prone. Pick (a). For variant race: a one-line `useEffect` on `[textureManager, layer]` in ViewportUV that does `paintingRef.current = false; pointerIdRef.current = null`. Same fix lands in PlayerModel in Unit 3.

**Patterns to follow:** `docs/COMPOUND.md` M3 §Gotchas for the exact failure mode descriptions.

**Test scenarios:**
- Happy path: render EditorLayout, let hydration complete, paint — no data loss.
- Race: render EditorLayout with mocked `loadDocument` returning after 50ms; dispatch `pointerDown + pointerMove` before it resolves; assert saved pixels do NOT overwrite live strokes (either interaction was blocked or snapshot-guard caught it).
- Race: start a stroke on ViewportUV, programmatically set variant, dispatch pointerMove — assert no stamp lands on the new layer's pixels (paintingRef was reset).

**Verification:** All 78 M3 tests still pass. Two new tests for the races pass. Manual check: paint a stroke, toggle variant mid-stroke — no spurious pixels.

- [ ] **Unit 1: Extend `island-map.ts` + helpers for overlay/base classification**

**Goal:** Make "is this island ID an overlay island?" an O(1) check. Needed by both the 2D producer and the overlay LUT builder.

**Requirements:** R5, R6.

**Dependencies:** Unit 0 (so M3 tests baseline is clean).

**Files:**
- Modify: `lib/editor/island-map.ts` — add `isOverlayIsland(id: IslandId): boolean` helper. Overlay IDs are `id > OVERLAY_ISLAND_ID_BASE` where `OVERLAY_ISLAND_ID_BASE = 36` (6 base parts × 6 faces). Export `OVERLAY_ISLAND_ID_BASE` for consumers.
- Modify: `tests/island-map.test.ts` — tighten the ≥3000 lower bound to exact `toBe(3264)` / `toBe(3136)` per M3 review P2 finding; add assertions that IDs 1-36 are base parts (consistent with `PART_ID_ORDER`) and IDs 37-72 are overlay parts.

**Approach:** Pure numeric boundary check. Export the constant for Unit 2 + ViewportUV.

**Patterns to follow:** `lib/editor/island-map.ts:112` (existing `ISLAND_ID_COUNT` export pattern).

**Test scenarios:**
- Happy path: `isOverlayIsland(0)` → false, `isOverlayIsland(36)` → false (last base face), `isOverlayIsland(37)` → true (first overlay face), `isOverlayIsland(72)` → true (last overlay face).
- Edge case: `isOverlayIsland(73)` → false (out of range, consistent with islandIdAt's 0-return for OOB).
- Integration: iterate all 4096 pixels of classic map; count IDs 1-36 and 37-72 separately; assert both totals are nonzero.
- Tighter regression: assert classic exact count `toBe(3264)`, slim `toBe(3136)`.

**Verification:** `tests/island-map.test.ts` passes with tightened assertions. `isOverlayIsland` is exported and its type is `(id: IslandId) => boolean`.

- [ ] **Unit 2: Build `overlay-map.ts` — the overlay→base atlas LUT**

**Goal:** Pre-compute `Uint16Array(4096)` per variant mapping each overlay atlas pixel index to its matching base atlas pixel index.

**Requirements:** R6.

**Dependencies:** Unit 1.

**Files:**
- Create: `lib/three/overlay-map.ts` — exports `getOverlayToBaseMap(variant): Uint16Array` + `overlayToBase(variant, x, y): number | null` + constant `OVERLAY_NO_MAPPING = 0xFFFF`.
- Create: `tests/overlay-map.test.ts`.

**Approach:** See pseudo-code in "High-Level Technical Design." Build two `Uint16Array(4096)` (classic + slim) at module init, cached. Per-part loop: for each overlay part, compute the base part name (strip "Overlay"), iterate each of 6 faces, iterate each pixel in the face rect, write the mapping.

**Execution note:** Write test file first. The mapping is a pure function over static data; test-first catches arithmetic errors (off-by-one on rect iteration, wrong face key mapping) immediately.

**Patterns to follow:** `lib/editor/island-map.ts` module structure — `buildOverlayMap` private function, two module-scope cached `Uint16Array`s, thin exported resolver.

**Test scenarios:**
- Happy path: for each overlay part × face × 2-3 sampled pixels within the face, verify `overlayToBase` returns an index within the matching base face rect (same face-local offset).
- Boundary: top-left corner of headOverlay top face maps to top-left corner of head top face.
- Boundary: bottom-right corner of bodyOverlay back face maps to bottom-right corner of body back face.
- Edge case: non-overlay atlas pixels (e.g., (0,0) which is outside all rects in standard Minecraft layout) return `null` / sentinel.
- Edge case: pixels inside BASE rects (not overlay) also return `null` (base pixels aren't overlay pixels).
- Integration: count non-sentinel entries in classic map; must equal the sum of pixel counts across all 6 overlay parts × their face areas (2-3 KB depending on variant — verify matches slim total being smaller by `128 px` due to narrower slim-overlay arm fronts/backs per M2 geometry).
- Variant: `getOverlayToBaseMap('slim')` has fewer total overlay pixels than `getOverlayToBaseMap('classic')` (slim arms are narrower).

**Verification:** All tests pass. Module-init cost measurable under 5ms. Memory cost: 8 KB total (2 × 4096 × 2 bytes).

- [ ] **Unit 3: Extend store with `hoveredPixel` slot + selector regression test**

**Goal:** Add the single source of truth for bidirectional hover.

**Requirements:** R5, R7.

**Dependencies:** Unit 0 (so store baseline is clean).

**Files:**
- Modify: `lib/editor/store.ts` — add `hoveredPixel: { x: number; y: number; target: 'base' | 'overlay' } | null`, `setHoveredPixel(next): void`.
- Create: `tests/hover-store.test.ts` — narrow-selector regression test using React.Profiler per the M3 cluster solution doc.

**Approach:** One slot, one action. `setHoveredPixel(null)` clears. Consumers subscribe narrowly: `(s) => s.hoveredPixel?.target` for the label, `(s) => s.hoveredPixel?.x` + `(s) => s.hoveredPixel?.y` for pixel coord (or the full object if both are needed in the same render — acceptable because the slot is small and changes together).

**Patterns to follow:** `lib/editor/store.ts` existing slot structure; `tests/color-picker-selectors.test.ts` for the React.Profiler skeleton (copy verbatim per `docs/solutions/test-failures/vitest-jsdom-react-component-testing-setup-2026-04-20.md`).

**Test scenarios:**
- Happy path: `setHoveredPixel({x: 10, y: 20, target: 'base'})` → `hoveredPixel` reflects; subsequent `setHoveredPixel(null)` clears.
- Happy path: `setHoveredPixel({x: 10, y: 20, target: 'base'})` then `setHoveredPixel({x: 10, y: 20, target: 'overlay'})` — both fields update (target flipped, coords stable).
- Narrow-selector contract: a component subscribing only to `(s) => s.hoveredPixel?.target` does NOT re-render when `x` or `y` changes (React.Profiler onRender callback).
- Narrow-selector contract: a component subscribing to the full `hoveredPixel` object DOES re-render when any field changes, but NOT when unrelated slots (e.g., `brushSize`) change.
- Edge case: `setHoveredPixel(null)` when already null is a no-op (store identity preserved, no listener fires — may require `set((prev) => prev.hoveredPixel === null ? prev : { hoveredPixel: null })` guard).

**Verification:** `tests/hover-store.test.ts` passes. Store field typed correctly. M3's `color-picker-selectors.test.ts` still passes (no regression to existing narrow-selector contract).

- [ ] **Unit 4: `PlayerModel` pointer wiring + paint pipeline**

**Goal:** Make the 3D player model paintable. Pointer events on each mesh convert to atlas coords, resolve overlay/base, and go through the same `stampPencil` → `composite` → `markDirty` path as `ViewportUV`.

**Requirements:** R1, R2, R6, R8, R9, R11.

**Dependencies:** Units 0, 1, 2, 3.

**Files:**
- Modify: `lib/three/PlayerModel.tsx` — add props `textureManager`, `layer`, `markDirty`; subscribe narrowly to store; wire pointer handlers per mesh; implement `uvToAtlas`, overlay-base redirect, paint loop.
- Modify: `app/editor/_components/EditorCanvas.tsx` — thread new props through; set `raycaster.firstHitOnly = true` once via Canvas `onCreated`.
- Modify: `app/editor/_components/EditorLayout.tsx` — thread `bundle.layer` + `markDirty` to `<EditorCanvas>`.
- Create: `tests/paint-bridge.test.ts` — pure-function tests for atlas-coord conversion + overlay-base resolution.

**Approach:**

Each mesh gets `onPointerDown` / `onPointerMove` / `onPointerUp` handlers (closures that close over the mesh's part name so the handler knows whether it's a base or overlay hit). Handlers:
1. `uvToAtlas(uv)` → `{x: floor(uv.x*64), y: floor((1-uv.y)*64)}`.
2. If mesh is an overlay part: read `layer.pixels[atlasIdx*4 + 3]` (alpha byte at that atlas pixel). If `alpha < OVERLAY_ALPHA_THRESHOLD`, use `overlayToBase(variant, x, y)` to get the base atlas index; decompose back to `(xB, yB)`. Set `target = 'base'`. Else `target = 'overlay'` and keep `(x, y)`.
3. If mesh is a base part: `target = 'base'`, use `(x, y)` as-is.
4. On pointerDown: set `paintingRef.current = true`, `lastPaintedAtlasRef.current = {x: <resolved x>, y: <resolved y>}`, call `stampPencil(layer.pixels, resolvedX, resolvedY, brushSize, r, g, b)`, `textureManager.composite([layer])`, `markDirty()`, `commitToRecents(activeColor.hex)`.
5. On pointerMove while painting: same as pointerDown but skip `commitToRecents`. **No stampLine** per D4.
6. On pointerUp/Cancel: `paintingRef.current = false`.
7. Also on pointerMove (regardless of paintingRef): call `setHoveredPixel({x: resolvedX, y: resolvedY, target: resolvedTarget})` to drive the 2D hover overlay.
8. On pointerOut: `setHoveredPixel(null)`.

Zero-alloc discipline: the `{x, y, target}` object passed to `setHoveredPixel` IS an allocation per event. Acceptable under D4's "store writes are O(1) per event" reasoning — and matches M3's pointer-path allocation profile. Do not try to pool the object; Zustand's `set` captures the reference.

Handler registration: map over the existing `PARTS` array in `PlayerModel`; each mesh gets an inline handler closure that captures the part name. Keep the per-mesh closure to THREE closures per mesh (one each for down/move/up) to avoid closure bloat.

**Execution note:** Start by implementing for a SINGLE mesh (head base only) + manual test, then expand to all 12. The R3F `event.uv` surface is external; manual verification catches "is the uv actually populated on this mesh" early.

**Patterns to follow:** `app/editor/_components/ViewportUV.tsx` lines 175-285 for the paint-loop structure (paintingRef, lastPaintedAtlasRef, pointerdown-vs-pointermove branching, commitToRecents gating). `lib/three/PlayerModel.tsx` current `useFrame` for the zero-alloc discipline.

**Test scenarios:**

*`tests/paint-bridge.test.ts`* — pure functions:
- Happy path: `uvToAtlas({x: 0.5, y: 0.5})` → `{x: 32, y: 32}`. Sanity check the Y-flip.
- Edge: `uvToAtlas({x: 0, y: 0})` → `{x: 0, y: 63}` (uv.y=0 is atlas bottom).
- Edge: `uvToAtlas({x: 0.99999, y: 0.99999})` → `{x: 63, y: 0}`.
- Happy path: given `alpha < THRESHOLD`, overlay redirect returns base coords via LUT.
- Happy path: given `alpha >= THRESHOLD`, overlay redirect returns same overlay coords.
- Edge case: overlay redirect on a pixel whose LUT entry is sentinel (shouldn't happen for a valid overlay-mesh hit, but guard) — returns null / caller skips paint.

*Integration* — R3F dom-mock is fragile; keep component-render tests narrow:
- Mount `<EditorCanvas>` with mocked `textureManager` + `layer` + `markDirty`. Synthesize a pointer event on a mesh with a known UV. Assert `stampPencil` was called with expected atlas coords (spy via vi.fn).
  - Note: R3F under jsdom may not produce real hits. If so, mark as `it.skip` and verify via Playwright in M8 browser polish OR via the manual acceptance list. Document the skip rationale inline.
- Store integration: after pointerdown, assert `hoveredPixel` is non-null and `commitToRecents` was called once.

**Verification:** On dev-server, click the head in /editor. Pixel appears on 3D model AND on 2D canvas in the same frame. Click overlay-transparent area on head — base pixel paints (verified by inspecting layer.pixels). Click overlay-opaque area — overlay pixel paints. Drag across head — continuous paint with some gaps on fast motion (expected per D4).

- [ ] **Unit 5: `CursorDecal` + `CursorLabel` — 3D hover affordance**

**Goal:** Render a billboarded square cursor at the hovered atlas-pixel's world position, with a BASE/OVERLAY label floating nearby.

**Requirements:** R4, R7.

**Dependencies:** Unit 3 (store slot), Unit 4 (PlayerModel producing hover events).

**Files:**
- Create: `app/editor/_components/CursorDecal.tsx` — billboard quad; reads `hoveredPixel` + `variant` from store; computes world position; returns null when no hover or when `activeTool` isn't pencil-capable.
- Create: `app/editor/_components/CursorLabel.tsx` — DOM label via drei `<Html>`; shows "BASE" / "OVERLAY". May inline into CursorDecal if under ~20 lines.
- Modify: `app/editor/_components/EditorCanvas.tsx` — render `<CursorDecal />` inside the `<Canvas>`.

**Approach:**

World-position math (directional):
- Texel-center UV: `(x+0.5)/64, 1 - (y+0.5)/64`.
- Find containing mesh by iterating `PART_ID_ORDER` + `FACE_ID_ORDER` to find which face rect contains `(x, y)`. This gives the mesh part and face.
- For that mesh + face, there's a fixed mapping from face-local (u_in_face, v_in_face) to 3D local coords via `partDims` + `partPosition`. Essentially: each face has a normal direction and two tangent directions in local space. Compute `mesh.position + tangent1 * scaledU + tangent2 * scaledV + normal * epsilon` (epsilon prevents z-fighting).
- Use drei `<Billboard>` to make the decal always face the camera.
- Decal mesh: small plane geometry, white material with 2px black border — achievable via a `CanvasTexture` drawn once at module load (6×6 or 8×8 px texture with the border baked in). Alternative: use `ringGeometry` + `planeGeometry` composite. Simpler: bake the border into a CanvasTexture at init.
- Distance scale: in `useFrame`, scale the decal mesh between 1.0 and 1.15 based on camera distance. Zero-alloc discipline: scalar math only; don't `new Vector3`.

Label:
- Shows only when `hoveredPixel.target === 'overlay' || target === 'base' with ambiguous context`. Cross-AI decision was "Add tiny label near cursor: 'BASE' / 'OVERLAY' for awareness" — interpreting "near cursor" as always-visible-on-hover. Implementer may refine to "only when over an overlay mesh" if the always-on label feels noisy. Either is consistent with R7.
- drei `<Html>` with `transform`, `occlude`, `zIndexRange={[10, 0]}`, `distanceFactor={8}` gives a small floating label.

**Execution note:** Implement Decal WITHOUT the distance-scale useFrame first. Measure baseline perf. Add distance-scale only if it doesn't introduce per-frame allocations. Fall back to a fixed size if scale math triggers a Vector3 alloc.

**Patterns to follow:**
- drei `<Billboard>` + `<Html>` docs (React 19 compatible in drei 10.7.7).
- `docs/solutions/performance-issues/r3f-geometry-prop-disposal-2026-04-18.md` — dispose the decal's geometry + texture on unmount.
- `lib/three/PlayerModel.tsx` useFrame zero-alloc discipline.

**Test scenarios:**
- Happy path: `hoveredPixel = {x:32, y:32, target:'base'}` on classic variant. Decal renders at the expected world position (head front face center).
- Happy path: `hoveredPixel = null`. Decal returns null.
- Happy path: `activeTool !== 'pencil'`. Decal returns null.
- Regression: variant toggle classic→slim changes the decal position if the hovered pixel is in an arm region (slim arm rects are narrower).
- Manual visual: decal visible on all 6 faces of all 12 parts; billboards toward camera; scales up 10-15% when camera zooms out.
- R3F/jsdom caveat: full render tests may not be feasible under jsdom. Prefer Playwright or manual visual for the decal itself; keep automated tests on the pure position-computation function.

**Verification:** Decal visible on hover. Label shows "BASE" or "OVERLAY" correctly. No console warnings. No VRAM leak after 100 variant toggles (verified via manual DevTools Memory profile OR a smoke test that mounts/unmounts EditorLayout 20 times and checks geometry count).

- [ ] **Unit 6: `ViewportUV` hover hoist + `PencilHoverOverlay`**

**Goal:** Make 2D hover read/write the store slot, so hovering on 2D shows the hover preview on 3D and vice versa.

**Requirements:** R5.

**Dependencies:** Unit 3.

**Files:**
- Modify: `app/editor/_components/ViewportUV.tsx` — replace local `hoverPixel` state with `useEditorStore((s) => s.hoveredPixel)`. Emit `setHoveredPixel({...})` on pointermove (gated on `activeTool === 'pencil' || activeTool === 'bucket'`). Compute `target` from `islandIdAt(map, x, y)` + `isOverlayIsland(id)`. On pointer-out, clear to null.
- Modify: `app/editor/_components/BucketHoverOverlay.tsx` — read `hoveredPixel` from store instead of prop. Prop-drop accordingly.
- Create: `app/editor/_components/PencilHoverOverlay.tsx` — 2D-side pencil hover indicator. Renders a 15-25% additive white tint + 1px border at the hovered pixel on the 2D atlas canvas. Uses the existing absolute-positioned overlay canvas pattern BucketHoverOverlay uses.

**Approach:** Mirror the BucketHoverOverlay component structure but for single-pixel highlight. The tint is baked into a small `CanvasTexture` (or drawn via `ctx.fillRect` on an absolute-positioned overlay canvas that covers the TM canvas). Alpha blend mode: additive white at ~15% opacity clamps to white on bright pixels automatically (user won't see the tint change a fully-white pixel, which is acceptable; cross-AI UX decision 2 noted the clamp).

The overlay canvas is scaled via the same CSS `transform: scale(zoom) translate(pan)` as the TM canvas so zoom/pan stay in sync.

**Patterns to follow:**
- `app/editor/_components/BucketHoverOverlay.tsx` — structure, rAF gating, null-return guard.
- `lib/editor/island-map.ts` + Unit 1's `isOverlayIsland` helper for target classification.

**Test scenarios:**
- Happy path: pointer-move on ViewportUV while activeTool='pencil' → `hoveredPixel` set with correct coords + target.
- Happy path: pointer-move on a pixel in head-front island (base) → `target: 'base'`.
- Happy path: pointer-move on a pixel in head-overlay-front island → `target: 'overlay'` (because 2D producer does NOT redirect; user directly addresses the atlas pixel they see).
- Edge: pointer-out → `hoveredPixel` → null.
- Edge: activeTool switched away from pencil mid-hover → store hover cleared OR stays until next pointer event (pick the cleaner UX; likely clear on tool change via a useEffect on activeTool).
- Regression: `tests/color-picker-selectors.test.ts` still passes; new hover state doesn't cause ColorPicker to re-render (narrow-selector contract).
- Integration: mount ViewportUV + CursorDecal sibling; move pointer on ViewportUV; assert CursorDecal's position reflects the hover (requires mocking out R3F world-position math, acceptable as indirect test via store assertion).

**Verification:** Hover on 2D canvas → see hover preview on 3D model in the same frame. Hover over overlay-region → target='overlay' (label shows OVERLAY on 3D side).

- [ ] **Unit 7: Integration acceptance pass + bundle audit**

**Goal:** End-to-end verification + regression check against M3 tests + bundle-size audit.

**Requirements:** R1–R12.

**Dependencies:** Units 0–6.

**Files:**
- Modify (if needed): fix any regressions surfaced during integration testing.
- Modify: `docs/COMPOUND.md` — **not in this plan's scope; `/ce:compound` phase after PR merge.**

**Approach:** Run the full automated sweep: `npm run lint`, `npx tsc --noEmit`, `npm run test`, `npm run build`. Run manual acceptance tests (checklist below). Measure bundle delta.

**Test scenarios:** See "Acceptance criteria" below — this unit executes them.

**Verification:**
- All 78 M3 tests + all new M4 tests pass.
- Bundle delta ≤ +5 kB First Load JS.
- All 10 manual acceptance items pass on `npm run dev`.

## System-Wide Impact

- **Interaction graph:** `PlayerModel` now produces paint events and hover events. `ViewportUV` hoists hover to store (prop → store transition). `BucketHoverOverlay` becomes a store consumer (prop → store transition). `CursorDecal` is a new store consumer. No new cross-module dependencies beyond the store slot. `EditorLayout` props to `EditorCanvas` grow by 2 (layer, markDirty).
- **Error propagation:** If `overlayToBase` returns sentinel (unexpected), the 3D producer logs a `console.warn` (dev-only) and no-ops the paint. Atlas-coord out-of-range cannot occur post-resolution because `uvToAtlas` produces [0, 63] by construction, and overlay LUT output is always a valid base index when input is a valid overlay index.
- **State lifecycle risks:**
  - Variant toggle during active 3D stroke: **fixed in Unit 0's variant-change effect** (resets paintingRef on any `[textureManager, layer]` change). Applies to both ViewportUV and PlayerModel.
  - Hydrate overwriting live 3D strokes: **fixed in Unit 0's hydration gate** (blocks pointer interaction on all surfaces until hydration completes).
  - Rapid tool switch mid-hover: clear `hoveredPixel` on `activeTool` change via a store-level effect OR via a useEffect in ViewportUV/PlayerModel. Verify no stale hover persists across tool swap.
  - CursorDecal GPU resource lifecycle: dispose the decal's geometry + texture on unmount per the M2 COMPOUND caller-owned-disposal rule.
- **API surface parity:** `TextureManager` API unchanged. `Layer` type unchanged. Store gains one slot (additive, non-breaking). `ViewportUV` props shrink (BucketHoverOverlay drop). `EditorCanvas` props grow (layer, markDirty). `PlayerModel` props grow (textureManager, layer, markDirty).
- **Integration coverage:**
  - The 2D→3D pixel propagation loop (M3 path): still works, regression-tested by existing pencil flow on ViewportUV.
  - The 3D→2D pixel propagation loop (M4 new path): needs a manual check (automated R3F raycast under jsdom is fragile) — item in acceptance list.
  - Overlay/base precedence: tested in `tests/paint-bridge.test.ts` + `tests/overlay-map.test.ts` for the pure logic; visual verification for the full render path.
- **Unchanged invariants:**
  - Zero-allocation discipline in `useFrame` (M2) — PlayerModel's existing orbit/breathing loop must not regress. The new pointer handlers live OUTSIDE useFrame.
  - Zero-allocation discipline in pointer handlers (M3) — M4's new 3D pointer handlers inherit this. Exception: the `{x, y, target}` object passed to `setHoveredPixel` is a per-event alloc (consistent with M3's `{ax, ay}` return in `pointerToAtlas`).
  - Narrow-selector contract (M3) — all new store consumers use narrow selectors; regression-tested in `hover-store.test.ts`.
  - Caller-owned GPU resource disposal (M2) — CursorDecal resources disposed on unmount.
  - 72 pinned UV rects per variant (M2) — unchanged; overlay-map derives from them.

## Risks & Dependencies

| Risk | Level | Mitigation |
|---|---|---|
| R3F raycaster misreports hits on overlay meshes (edge case: ray grazes overlay edge where alpha ≈ threshold) | P2 | Test with multiple pixels near the overlay alpha boundary. If misreports surface, add a fallback: if overlay hit but base mesh would have been hit too, fall back to base. Defer the fallback unless symptoms appear. |
| Drag gaps on fast 3D strokes make paint feel unresponsive | P2 | Documented deferral per D4; measure gap frequency in acceptance. If >30% of drags show gaps at normal drag speed, escalate to M5 with a concrete reproduction. |
| CursorDecal z-fighting with overlay meshes when camera is very close | P2 | `renderOrder={2}` on decal + small normal-epsilon offset. If z-fighting appears at extreme camera distances, increase epsilon (tradeoff: decal floats off the surface visibly). |
| drei `<Html>` label performance (DOM render per frame) hurts 60fps target | P3 | Profile in `/ce:work`. If drop, swap for a `<sprite>` with baked "BASE"/"OVERLAY" textures. |
| jsdom raycast tests flaky | P3 | Skip `it.skip()` the full render integration tests; rely on pure-function tests + manual acceptance. Document in test comments. |
| Variant toggle during active stroke leaves stale `paintingRef` (both surfaces simultaneously) | P1 | **Unit 0 prerequisite.** One `useEffect` per surface keyed on `[textureManager, layer]`. Regression-tested. |
| Hydration overwrites live strokes mid-session (M3 review P1) | P1 | **Unit 0 prerequisite.** Hydration gate prevents pointer interaction until `loadDocument()` resolves. |
| Cross-surface hover causing feedback loops (2D hover sets store → 3D reads → 3D re-renders → potentially triggers its own pointerMove → ...) | P2 | Store writes should not cause synthetic pointer events. Visual render is a read-only consumption. Verify by inspecting the browser's event queue during a hover-only test (no cascading events). |
| Bundle size exceeds +5 kB budget | P3 | drei Billboard + Html are tree-shakeable; import path matters (`@react-three/drei/Billboard` vs root import). Measure in acceptance; swap Html for sprite if over budget. |
| `setHoveredPixel({x,y,target})` per-event allocation violates zero-alloc invariant | P2 | Accept under M3 precedent (pointer-event allocations at 60-200 Hz are tolerated when O(1) per event). Document inline. If profiler later shows impact, pool the object via a module-scope scratch + clone-on-set. |

## Documentation / Operational Notes

- Update `docs/COMPOUND.md` M4 entry after `/ce:compound` — NOT in this plan's scope, but pre-flag for capture:
  - R3F `event.uv` bottom-up vs canvas top-down Y-flip (the M4 breakthrough from DESIGN §12.5's compound capture).
  - Overlay-to-base LUT pattern (8 KB module-scope for O(1) runtime).
  - Bidirectional hover via single Zustand slot (extends M3 narrow-selector pattern).
  - `raycaster.firstHitOnly` + `FrontSide` as canonical R3F "no bleed-through" combo.
  - drei Billboard + Html tree-shake budget observations.
  - M3 P1 follow-up resolutions (variant race + hydrate race).
- No operational concerns (client-only, no new infra, no new env vars, no new CVE surface from missing deps).
- No data migration (no persistence schema change).

## Acceptance Criteria

### Automated (all must pass before PR open)

1. `npm run lint` — 0 errors / 0 warnings.
2. `npx tsc --noEmit` — 0 errors.
3. `npm run test` — all M3 tests pass (78/78) + all new M4 tests pass (estimated +25 tests: ~8 overlay-map, ~4 hover-store, ~6 paint-bridge, ~3 tighter island-map, ~4 Unit 0 race regression tests).
4. `npm run build` — succeeds, both routes generated, no new warnings.
5. Bundle delta: `/editor` First Load JS ≤ 357 kB (352 baseline + 5 kB budget).
6. HTTP 200 on `/` and `/editor` via `npm run dev`.
7. Zero `any` types added in `app/` or `lib/` (grep clean).
8. `'use client'` count unchanged except for `CursorDecal.tsx` + `CursorLabel.tsx` + `PencilHoverOverlay.tsx` (8 → ~10 is acceptable; all additions in `_components/`).
9. Zero new dependencies in `package.json`.

### Manual (verified on `npm run dev` before PR ready-for-merge)

10. **[R1]** Click on the head mesh on the 3D viewport → the active pencil color paints that pixel on both 3D and 2D within one frame (visually instantaneous, not noticeably delayed).
11. **[R2]** Drag on the 3D viewport → a continuous-ish paint stroke appears on both surfaces. Gaps on fast motion acceptable.
12. **[R3]** Paint on 2D → appears on 3D within one frame (M3 regression check).
13. **[R4]** Hover 3D with pencil active → billboarded square decal appears, snaps to texel centers, scales up slightly at distance.
14. **[R5]** Hover 2D → the corresponding 3D location shows the decal. Hover 3D → the 2D canvas shows a 15-25% additive white tint + 1px border at the matching atlas pixel.
15. **[R6]** Clear a region of the headOverlay to transparent via 2D paint (erase manually by painting with alpha-low color — temporarily testable via devtools `useEditorStore.setState({activeColor: {...transparent}})`). Click that region on 3D → the base head paints (verified by toggling headOverlay invisible in devtools).
16. **[R7]** Hover an overlay mesh where the pixel is opaque → label shows "OVERLAY". Hover where transparent → "BASE" label + decal snaps to the base texel.
17. **[R8]** Orbit the camera to view the back of the head through the front (if possible given no OrbitControls, inspect static camera angle that shows a body part behind another). Click → no bleed-through paint on occluded parts.
18. **[R9]** Switch activeTool to eraser/bucket/picker/mirror (via devtools `setActiveTool`). Click on 3D → no paint, no crash, no cursor decal.
19. **[R10]** Toggle variant Classic ↔ Slim repeatedly. No stuck `paintingRef` (no phantom strokes after toggle). No stale decal. No console errors.
20. **[R12]** Paint 50 rapid strokes across the model. Measure `/editor` First Load JS and confirm ≤ 357 kB budget.

### Manual — performance checks

21. Open Chrome DevTools Performance tab. Record 10s of continuous 3D drag painting. Verify:
    - Frame rate stays ≥ 55 fps (acceptable under 60fps V-sync).
    - No garbage collection spikes > 5ms.
    - No memory growth over the recording window (verify by repeating, confirming steady baseline).

## Sources & References

- **Origin document:** none (user invocation with cross-AI-consulted UX/technical decisions).
- **DESIGN.md §6** — R3F player model contract, pinned UVs, mesh topology.
- **DESIGN.md §7** — Texture write pipeline, `TextureManager`, canvas/UV mapping.
- **DESIGN.md §12.5 M4** — milestone review criteria + compound capture expectations.
- **`docs/COMPOUND.md` M2** — R3F geometry disposal invariant, PART_ORDER exhaustiveness, `useFrame` zero-alloc contract.
- **`docs/COMPOUND.md` M3** — narrow-selector pattern, pointer-path allocation policy, variant-race + hydrate-race P1 follow-ups.
- **`docs/solutions/performance-issues/r3f-geometry-prop-disposal-2026-04-18.md`** — canonical R3F disposal pattern; applies to `CursorDecal`.
- **`docs/solutions/test-failures/vitest-jsdom-react-component-testing-setup-2026-04-20.md`** — React 19 + Vitest + jsdom testing skeleton for `hover-store.test.ts`.
- **`docs/plans/m3-paint-canvas-plan.md`** — precedent plan structure + pencil pipeline.
- **Related PRs:** #5 (M3 merge).

## /ce:plan review answers

### 1. Hardest decision

Whether to do proper 3D-space ray-stepping Bresenham interpolation for 3D drags in M4, or defer entirely. Proper 3D interpolation requires stepping rays in world space between two pointer samples, re-raycasting at each step, and collecting the hit UVs — a significant complexity bump and ~30-50 lines of raycast plumbing. Per-frame-only works for moderate drag speed but produces visible gaps at ~200 px/s cursor speed, which is achievable with a graphics tablet. Cross-AI locked "start with per-frame, add Bresenham if gaps appear in testing." This plan follows that guidance but with an explicit revisit gate in acceptance test #11 — if gap frequency exceeds 30% at normal drag speed, M5 gets a prerequisite Bresenham unit before bucket/eraser work.

### 2. Alternatives rejected

- **Put paint orchestration in a separate `PlayerPaintController` wrapper around `PlayerModel`.** Rejected (D1): prop-drilling through two layers, two sources of pointer truth, asymmetric with ViewportUV's pattern.
- **Per-event overlay/base rect-local coord math instead of LUT.** Rejected (D2): 10 lookups + 6 arithmetic ops per event at 60-200 Hz vs. O(1) LUT lookup at cost of 8 KB module-scope memory. The LUT was the cleaner tradeoff.
- **Atlas-space Bresenham with island-gating for 3D drags.** Rejected (D4): island-gating would drop paint across UV seams, producing visible gaps where 3D-adjacent faces are not atlas-adjacent. Worse than the deferred-entirely option.
- **Hoist the `<Canvas eventSource>` to a shared parent div for cross-surface pointer continuity.** Rejected (scope boundary): cross-surface strokes aren't a DESIGN.md requirement through M8, and the ergonomics are awkward (pointing at 2D while seeing 3D highlight is already bidirectional; continuing a stroke across surfaces is niche).
- **Implement OrbitControls in M4.** Rejected (scope boundary — M8 polish). Adding OrbitControls now forces early resolution of the paint-vs-orbit gesture arbitration, which is its own design problem.
- **Re-render PlayerModel to include hover-highlight shader uniforms (uniform-based hover overlay on the 3D side).** Rejected: two surfaces converging on one `hoveredPixel` store slot is simpler than a custom shader with a uniform buffer. The cursor decal approach also extends cleanly to M5's mirror tool (two decals instead of one).
- **Write M4 as a purely-manual-tested milestone with zero new unit tests.** Rejected: overlay-map math is load-bearing and pure, test-first is cheap; hover-store selector regression is cheap; the paint-bridge atlas math is one of the simplest + most-consumed functions in the app.

### 3. Least confident

The exact behavior of `event.uv` on overlay meshes at their edges (where overlay geometry extends +1 pixel beyond base geometry per the M2 COMPOUND note). The UV rects for overlay are ORIGINAL dimensions (not +1), but the geometry is larger — meaning UV interpolation at the edge of an overlay face is outside the rect the atlas actually covers. R3F normalizes UV to [0, 1] based on the mesh's uv attribute, so hitting the extreme edge should still produce a UV inside [0, 1] — but there's a narrow band at the edge of the overlay geometry where the UV value extrapolates. If the extrapolation produces values >1.0 or <0.0, `uvToAtlas` returns atlas coords ≥ 64 or ≤ -1. Unit 4's `paint-bridge.test.ts` should cover this; if the extrapolation DOES happen, clamping `Math.min(63, Math.max(0, atlas))` is the right defense. Verify during `/ce:work` by clicking the extreme edges of overlay parts; if the paint misses or wraps, the extrapolation is the cause.

Secondary low-confidence: drei `<Html>` tree-shake. Documentation says individual component imports are tree-shaken, but drei 10.x bundling has historically surprised. The +5 kB budget assumes good tree-shake; if not, swap Html for a baked sprite before PR opens.
