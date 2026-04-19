# M3 — 2D Paint Surface + Color Picker + Pencil Tool

> **Final save target:** `docs/plans/m3-paint-canvas-plan.md`.
> Origin inputs: `docs/plans/m3-paint-canvas.md` (round-5 cross-AI consultations — Gemini cursors/sidebar, ChatGPT picker UX, Perplexity IndexedDB, Claude flood-fill + picker-state + hybrid palette, Codex color math already merged).
> Plan type: **Deep** (13 distinct subsystems, first Zustand integration, first real persistence layer, first test harness).

## Context

M1 shipped the scaffold; M2 shipped the 3D player model with 72 pinned UV constants. M3 is the first milestone that makes the app *do* something — paint pixels on a 64×64 atlas and see them on the live 3D model. This milestone introduces the state backbone (Zustand), the first real persistence surface (IndexedDB via `idb-keyval`), the first GPU-texture lifecycle that mutates per frame (`TextureManager`), and the first unit-test harness (Vitest). It also renders the color picker, pencil tool, tool cursors, and a responsive sidebar — each governed by a round-5 AI consultation whose decisions are already locked in `docs/plans/m3-paint-canvas.md`. The plan-phase discipline for M3 is therefore not "design it from scratch" — it's "faithfully execute the locked inputs, resolve the handful of remaining open decisions (H.1–H.5), and sequence the work so M3 /ce:work has zero unanswered questions."

## Overview

Ship the first end-to-end paint loop: user opens `/editor`, picks a color, drags pencil on the 64×64 UV canvas, sees pixels appear on the 3D player model in the same frame. Persist the active document to IndexedDB with debounced 500ms writes that survive tab close. Show the canonical Minecraft 8-color palette on first load and the 8-slot FIFO recents grid that only inserts colors that actually affected pixels. Implement the Gemini-specified tool cursors with verbatim SVGs and the dual-stroke visibility strategy. Wire the Zustand store that M4–M8 will extend. Defer the actual 3D↔2D paint bridge (M4), the bucket/eraser/picker/mirror tools (M5), layers+undo (M6), template loading (M7), export (M8), and the luminance toggle (M8) — M3 ends with pencil-only painting on the 2D surface with the full color-picker loop working.

## Pinned versions (delta from M2)

| Package | Previous (M2) | M3 | Notes |
|---|---|---|---|
| `vitest` | — | `3.2.4` (exact) | New devDependency. Latest stable as of 2026-04-18. Node >=20.9 satisfied. |
| `@vitejs/plugin-react` | — | `5.0.3` (exact) | Optional; only if Vitest needs JSX/TSX transform beyond Vite's defaults. Can be omitted if no React components get unit-tested this milestone (current plan: pure-logic-only tests). |
| `jsdom` | — | `27.0.0` (exact) | DOM environment for Vitest when tests touch `document`/`canvas`. Required for `texture.ts` test (creates an offscreen canvas). |
| All M1/M2 pins | same | **unchanged** | No drift from M2's `next 15.5.15`, `react 19.2.5`, `three 0.184.0`, `@react-three/fiber 9.6.0`, `zustand 5.0.12`, `idb-keyval 6.2.2`, `tailwindcss 4.2.2`, `eslint 9.39.4`, `@eslint/eslintrc 3.3.1`. |

**Peer-dependency check:** Vitest 3.x requires Node >=20.9 (we pin ≥20.9) and has no React peer (React plugin is optional). `jsdom` 27 is pure. No conflicts with the existing tree expected; `npm install` must produce zero peer warnings per M1 acceptance.

**Deferred M3 → no bump required:** `@types/three` stays at `0.184.0`; no new three.js features are used beyond M2's surface. `zustand` stays at `5.0.12` (the slice pattern we use needs no extra middleware).

## Files to create / modify

**`lib/editor/` — new directory, first time this exists**

- `lib/editor/types.ts` — core data types from DESIGN.md §4 (`SkinVariant`, `Layer`, `SkinDocument`, `Stroke`, `IslandId`, `IslandMap`, `Point`, `RGBA`). M4–M8 import from here; M3 defines them all upfront to lock the shape.
- `lib/editor/texture.ts` — `TextureManager` class per DESIGN.md §7. Owns the offscreen 64×64 canvas, `CanvasTexture`, rAF coalescing loop. Zero allocations in the rAF tick and in per-pixel write paths.
- `lib/editor/island-map.ts` — generates one `Uint8Array(4096)` per variant (Classic + Slim) at module init; cached in module scope. Each pixel stores an island ID derived from the UV regions in `lib/three/geometry.ts` (head-front=1, head-back=2, torso-front=3, …). Used by M3's bucket hover preview and M5's bucket fill.
- `lib/editor/flood-fill.ts` — scanline flood-fill per input E.1: `floodFill(pixels, islandMap, seedX, seedY): Uint8Array` + `applyFillMask(target, mask, r, g, b, a?)`. Island-gated, 4-connected, no recursion, exact-match. Sub-ms on a 512-pixel island.
- `lib/editor/tools/pencil.ts` — stamp function: given `(x, y, brushSize, color, pixels)`, mutate an `NxN` block around `(x, y)` clamped to `[0, 64)` on both axes. Returns the `bbox` of mutated pixels so the caller (ViewportUV) can build the `Stroke` diff record.
- `lib/editor/persistence.ts` — thin `idb-keyval` wrapper. `saveDocument(doc: SkinDocument): Promise<void>` debounced internally at 500ms. `loadDocument(): Promise<SkinDocument | null>`. Detects Safari private zero-quota on first write and surfaces a `SavingState` union (`'enabled' | 'disabled:private' | 'disabled:quota'`) via a subscription callback.
- `lib/editor/store.ts` — Zustand store (see Implementation Step 3 for slice rationale). Single `useEditorStore` hook. No providers per Zustand v5 convention.

**`lib/color/` — extends existing directory (already has `conversions.ts`)**

- `lib/color/picker-state.ts` — canonical HSL state model per input Section F. `PickerState` type + `pickerStateFromHex`, `pickerStateFromHSL`, `handleHexInput`, `handleSLDrag`, `handleHueDrag`. Gray-axis hysteresis at `s < 0.01` is load-bearing.
- `lib/color/palette.ts` — static 8-color Minecraft default (`DEFAULT_PALETTE: readonly string[]` — dirt, grass, stone, water, lava, gold, redstone, obsidian hex values). Median-cut extraction stub deferred to M7.
- `lib/color/named-colors.ts` — minimal ~140-entry map of common named colors (e.g., CSS-named subset) for the C.3 accessibility hook. Exports `findNearestName(hex): string | null` that does a small RGB Euclidean search. Small file; keep bundle impact under 3 kB.

**`app/editor/_components/` — extends M2's single-file directory**

- `app/editor/_components/ViewportUV.tsx` — the 2D paint canvas. `'use client'`. Owns zoom/pan state *locally* (derived from store reads), pointer event handling, grid overlay, cursor rendering. Wraps an HTMLCanvasElement that displays `TextureManager`'s offscreen canvas upscaled.
- `app/editor/_components/ColorPicker.tsx` — hue ring + SL square + hex input + recents grid + two-swatch preview. Fully per inputs Section A. `'use client'`. Imports `picker-state.ts` helpers.
- `app/editor/_components/Toolbar.tsx` — thin tool selector. For M3 renders a single "Pencil" button (others greyed out with "M5" labels for clarity). Keyboard shortcut `B` switches to pencil (other shortcuts held back to M5).
- `app/editor/_components/Sidebar.tsx` — 280px desktop container for ColorPicker + Toolbar + persistence status. Mobile (<640px) variant is a bottom sheet with safe-area inset.
- `app/editor/_components/EditorLayout.tsx` — responsive layout coordinator. Desktop: `[3D viewport flex-1] [ViewportUV flex-1] [Sidebar 280px]`. Mobile: stacked `[3D 35vh] [ViewportUV 35vh] [Sheet remaining, safe-area-inset]`.
- `app/editor/_components/BrushCursor.tsx` — 2D-side CSS cursor helper. Builds the data URL for the verbatim Gemini SVG, sets the CSS `cursor: url('data:...') hotX hotY, auto` on the wrapper. 3D-side mesh-decal cursor deferred to M4 (3D hover event infrastructure lands then).
- `app/editor/_components/BucketHoverOverlay.tsx` — paints the 20% white overlay on the hovered island on the 2D canvas. Tool must be 'bucket' to activate (even though the bucket tool itself is M5, the hover preview is M3 scope per input B.3). When 'bucket' is inactive, the component renders nothing.
- `app/editor/_components/EditorCanvas.tsx` — **modify**. Remove local `variant` state (hoist to Zustand). Remove variant toggle button (moves to Sidebar). Integrate with `EditorLayout`. PlayerModel reads `variant` from store; `usePlaceholderTexture` hook moves to `lib/editor/texture.ts` as the real TextureManager wraps the texture source.
- `app/editor/page.tsx` — **modify**. Render `<EditorLayout />` instead of `<EditorCanvas />` directly. EditorLayout composes the three viewports + sidebar.

**`tests/` — extends M3-prerequisite test file**

- `tests/picker-state.test.ts` — gray-axis hysteresis, hex round-trip invariance, drag cursor stability. Exact scenarios listed in Implementation Step 6.
- `tests/flood-fill.test.ts` — island gating, exact-match, no-recursion bounds check, worst-case 512-pixel island <1ms.
- `tests/island-map.test.ts` — snapshot-ish: assert island count per variant, assert no two distinct parts share an island ID on overlap.
- `tests/texture-manager.test.ts` — (uses `jsdom`) rAF coalescing: 10 `markDirty()` calls in a row → exactly 1 `needsUpdate` flip per rAF tick. Disposal on teardown.
- `tests/pencil.test.ts` — brush size 1/2/3/4 produces N×N stamps centered on the cursor pixel. Edge clamping at 0 and 63.
- `tests/persistence.test.ts` — (uses `jsdom` with a mocked `indexedDB`) debounce 500ms coalesces multiple writes into one; Safari zero-quota detection path.

**Config / root**

- `vitest.config.ts` — new. Node 20+ environment default; `jsdom` env per-test via `// @vitest-environment jsdom` directive. Path aliases matching `tsconfig.json` (`@/lib/*`). Include glob: `tests/**/*.test.ts`.
- `package.json` — add `vitest`, `jsdom` devDependencies; add `"test": "vitest run"` script; optionally `"test:watch": "vitest"`.
- `eslint.config.mjs` — **modify**. Ensure `tests/**` is in the file-glob scope (Vitest globals `describe`/`it`/`expect` are auto-imported but we use explicit imports per the existing pattern, so no globals config needed). The existing `.next/` ignore stays.
- `app/globals.css` — **modify**. Add a `.cursor-pencil`, `.cursor-eraser`, `.cursor-picker`, `.cursor-bucket` utility class family that sets `cursor:` to the corresponding data-URL SVG. Alternative: set via inline `style` in `BrushCursor.tsx`. Pick one and commit; see Implementation Step 7 decision.
- `.gitignore` — **modify**. Add `coverage/` (Vitest default coverage output path).

**Do NOT create in M3** (explicit non-goals, deferred to later milestones):

- `lib/editor/tools/eraser.ts`, `bucket.ts`, `picker.ts`, `mirror.ts` (M5)
- `lib/editor/undo.ts`, `lib/editor/layers.ts` (M6)
- `lib/editor/grayscale-shader.ts`, `LuminanceToggle.tsx` (M8)
- `lib/three/onPointerDown` handlers on PlayerModel meshes (M4 — the 3D↔2D bridge)
- `app/editor/_components/TemplateGate.tsx` (M7)
- `app/editor/_components/ExportDialog.tsx` (M8)
- `lib/color/palette-extract.ts` / median-cut implementation (M7 — just ship the static default)

## Key technical decisions (resolving H.1–H.5)

### H.1 — 2D UV canvas layout: side-by-side with 3D, 280px sidebar right

Desktop ≥640px: CSS flex row. `[3D viewport flex-1] [ViewportUV flex-1] [Sidebar 280px]`. Each of the two viewports takes half the remaining space after the sidebar. 3D on the left (matches M2 camera framing which reads left-to-right), 2D in the center as the primary work surface. Mobile <640px: vertical stack — `[3D 30vh] [ViewportUV 40vh] [Sheet remaining, respects env(safe-area-inset-bottom)]`. The bottom sheet holds the full color picker + toolbar; it's always visible (not modal) and doesn't animate open/close in M3. Rationale: split-pane is the universal pixel-art-editor pattern (Aseprite, Photopea, GIMP). PIP is for secondary content; both surfaces are primary here. Tab-switch forces mental context-switches during the paint loop, which directly contradicts the "paint and see result instantly" design goal. Accordion has the same flaw.

### H.2 — Zoom and pan on 2D canvas: cursor-centered wheel, space+drag pan, 1×–16× range

**Range:** `minZoom=1`, `maxZoom=16`, `defaultZoom=fitContainer` (computed so the 64×64 atlas fills the ViewportUV flex-1 region minus a 12px border — typically ~8× on a 1440×900 display). **Wheel zoom:** cursor-centered. Per tick `zoom *= 1.15` (zoom in) or `/= 1.15` (zoom out), clamped to `[1, 16]`. Cursor-centered means the pixel under the cursor stays fixed under the cursor after zoom (transforms `pan` to compensate). **Pan:** hold Space then drag (cursor changes to grab). Arrow keys reserved for accessibility (single-pixel cursor nudge on focus). **Pixel grid overlay:** visible when `zoom >= 4`. Sub-pixel zoom (`zoom < 4`) hides the grid to avoid visual noise. **Keyboard zoom:** `+`/`-` via keyboard, no modifier. **Pinch-to-zoom on touch:** two-finger pinch, cursor-centered at the pinch midpoint. **Render path:** CSS `transform: translate() scale()` on a container around the canvas element, not Canvas 2D scale (CSS transform is GPU-accelerated, preserves crisp pixel-art via `image-rendering: pixelated` on the canvas, and doesn't require re-drawing). `willReadFrequently: true` stays on the offscreen canvas in `TextureManager`.

### H.3 — Initial brush size: 1 pixel

Matches pixel-art precision default. The pencil cursor SVG scales via the "clamped square frame expands to bound affected N×N pixels" rule (input B.2) — at brush=1 the frame is just the 1×1 crosshair.

### H.4 — Zustand store shape

Single `useEditorStore` with a flat (non-sliced) state tree. Zustand v5 slice middleware is overkill for M3's surface.

- `variant: SkinVariant` — **global** because M3's ColorPicker/Sidebar will read it for UI labels and M5's tools will read it for mirror-axis lookups. **Hoisted from `EditorCanvas.tsx` local state.** Setter: `setVariant(v: SkinVariant)`.
- `activeTool: 'pencil'` — **global** because M4's 3D pointer handler will read it to decide raycast-to-paint behavior. Today only 'pencil' is valid; the type reserves `'pencil' | 'eraser' | 'picker' | 'bucket' | 'mirror'` for M5.
- `brushSize: 1 | 2 | 3 | 4` — **global** because ViewportUV (2D) and M4's 3D pointer handler both need it. Defaults to 1.
- `activeColor: PickerState` — **global** because ColorPicker writes it and every paint surface (2D ViewportUV, M4's 3D handler, M5's tools) reads it. Defaults to the first entry of `DEFAULT_PALETTE` (`#6B3A1E` — dirt brown).
- `previousColor: string` — **global.** The "previous" in the two-swatch preview (A.7). Updates on every `setActiveColor` call (old becomes previous). Defaults to second palette entry for initial non-empty swap behavior.
- `recentSwatches: string[]` — **global.** 8-color FIFO per input A.2. Starts empty; fills only when paint affects pixels.
- `uvZoom: number`, `uvPan: { x: number; y: number }` — **global** even though only ViewportUV reads them, because M4 will add "reset view on variant toggle" behavior that resets pan/zoom programmatically. Keeps the surface consistent.
- `savingState: 'enabled' | 'disabled:private' | 'disabled:quota' | 'pending'` — **global.** Subscribed by Sidebar to render the "Saving disabled" chip.

**Not in store (stays local):** hover position (per-component render state), SL square drag position (local to `ColorPicker`), bucket hover island mask (local to `BucketHoverOverlay`). Rationale: these change every animation frame; putting them in Zustand would cause every subscriber to re-render. Kept local or in refs.

**Explicit non-decision:** no persistence middleware for M3. Persistence is manual via `lib/editor/persistence.ts` which subscribes to the store and debounces. Zustand's `persist` middleware is rejected because (a) it assumes `localStorage` (we need IDB), (b) it doesn't compose cleanly with our `SavingState` surface.

### H.5 — Vitest setup

Install `vitest@3.2.4` + `jsdom@27.0.0` as devDeps. Create `vitest.config.ts` with the path alias `@/*` → `./*` to match `tsconfig.json`. Add `"test": "vitest run"` script. The existing `tests/color-conversions.test.ts` uses `Function('return import("vitest")')` to dynamically import — that pattern continues to work but new M3 tests use direct `import` from `vitest` now that it's installed. Acceptance chain becomes `npm run lint && npx tsc --noEmit && npm run test && npm run build`.

## Zoom/pan state math (load-bearing for ViewportUV)

Cursor-centered zoom needs exact transforms. Given current `zoom`, `pan = {x, y}`, and a wheel event at client coords `(cx, cy)` relative to the ViewportUV container:

1. Current world-space cursor position: `worldX = (cx - pan.x) / zoom`, `worldY = (cy - pan.y) / zoom`
2. New zoom: `newZoom = clamp(zoom * 1.15, 1, 16)` (or `/1.15` for zoom-out)
3. New pan to keep cursor on the same world-space pixel: `newPan.x = cx - worldX * newZoom`, `newPan.y = cy - worldY * newZoom`
4. Commit `setZoom(newZoom)`, `setPan(newPan)`

This is the only piece of UI math M3 gets wrong if underspecified; verbatim in the implementation step so there's no reinvention.

## Implementation steps

> Run all commands from the project root. Honor the commit-per-logical-change discipline from M1/M2. Each numbered step produces one commit unless explicitly merged with a neighbor.

1. **Branch + deps.** `git checkout main && git pull --ff-only && git checkout -b m3-paint-canvas`. Install Vitest + jsdom: `npm install --save-dev vitest@3.2.4 jsdom@27.0.0`. Then exact-pin in `package.json` (strip caret). Add `"test": "vitest run"` script. Verify `npm install` zero peer warnings. **Commit:** `M3: install vitest 3.2.4 + jsdom 27.0.0`.

2. **Vitest config + test script wiring.** Create `vitest.config.ts` with `@/*` alias resolution. Update `.gitignore` to add `coverage/`. Run `npm run test` — should discover the existing `tests/color-conversions.test.ts` and pass. **Commit:** `M3: vitest config + test script`.

3. **Core types + Zustand store skeleton.** Create `lib/editor/types.ts` with all DESIGN.md §4 types. Create `lib/editor/store.ts` with the 8-slot flat state above. Modify `EditorCanvas.tsx` to read `variant` from store; remove local `useState<SkinVariant>`. Move the variant toggle button out of EditorCanvas (it temporarily goes away; the Sidebar will re-surface it in step 9). **Commit:** `M3: core types + Zustand store skeleton; hoist variant to store`.

4. **TextureManager + island map + integration.** Create `lib/editor/texture.ts` per DESIGN.md §7 with the additional requirement: zero allocations in `markDirty()` and in the rAF tick. `composite(layers)` allocates one `ImageData` per visible layer per call — acceptable because `composite` is called once per stroke commit, not per pixel. Create `lib/editor/island-map.ts` that derives the per-variant `IslandMap` from the UVs in `lib/three/geometry.ts` at module load. Replace `usePlaceholderTexture` in `EditorCanvas.tsx` with a `TextureManager` instance whose layers array starts as `[{ pixels: placeholderPixels(variant), visible: true, opacity: 1, blendMode: 'normal', ... }]`. **Commit:** `M3: TextureManager + island maps + wire PlayerModel to TextureManager`. **Test file:** `tests/texture-manager.test.ts` + `tests/island-map.test.ts` land in this commit.

5. **Flood fill.** Create `lib/editor/flood-fill.ts` per input E.1 contract. Island-gated scanline, explicit stack, exact-match, no tolerance param. **Commit:** `M3: flood-fill with island gating`. **Test file:** `tests/flood-fill.test.ts`.

6. **Color picker state + palette.** Create `lib/color/picker-state.ts` per input F.2 — the HSL-canonical model with gray-axis hysteresis. Create `lib/color/palette.ts` with the 8-color Minecraft default. Create `lib/color/named-colors.ts` with ~140-entry name table + `findNearestName(hex)`. **Commit:** `M3: picker state (HSL canonical) + static palette + named colors`. **Test file:** `tests/picker-state.test.ts`.

7. **Brush cursor utility + CSS classes.** Create `app/editor/_components/BrushCursor.tsx` that emits the correct CSS `cursor: url(...)` data URL per active tool from the store. Inline SVG data URLs using the verbatim Gemini B.2 markup. Hot-spots: pencil (16,16), eraser (16,16), picker (16,16), bucket (10,22). **Decision on cursor declaration site:** inline `style={{ cursor: ... }}` on the canvas wrapper — not Tailwind utility classes — because the URL changes at runtime with the tool. **Commit:** `M3: brush cursor component with Gemini SVGs`.

8. **ViewportUV (2D paint surface).** Create `app/editor/_components/ViewportUV.tsx`. Pointer event handling: `pointerdown` → capture pointer, start stroke buffer, apply pencil stamp, `markDirty`. `pointermove` with buttons=1 → incremental stamps (bresenham between previous and current cursor pixel if skip > 1 px, to avoid gaps on fast mouse movement). `pointerup` → commit stroke to the current layer and to the Recents FIFO (per input A.2). Zoom/pan math per "Zoom/pan state math" section above. Wheel handler uses `{ passive: false }` so we can `preventDefault()` on wheel. Space+drag pan via keydown listener toggling a `isPanning` local state. Render path: a `<canvas>` that calls `texture.getTexture()` internally — no — actually the display canvas blits from TextureManager's offscreen canvas via `drawImage()` on resize / zoom change, not per-pixel. Use CSS `transform: translate3d() scale()` for zoom/pan; use `image-rendering: pixelated` to keep edges crisp. **Commit:** `M3: ViewportUV with pencil + zoom/pan + grid overlay`. **Test file:** `tests/pencil.test.ts`.

9. **ColorPicker component.** Create `app/editor/_components/ColorPicker.tsx`. Hue ring rendered via a conic-gradient backgrounded circle with an SVG handle; SL square rendered as an overlaid absolutely-positioned div with two stacked gradients (white-to-transparent horizontal, transparent-to-black vertical) and a handle. Hex input field is `<input type="text" pattern="#?[0-9a-f]{3}([0-9a-f]{3})?" />` with debounced `handleHexInput` on input (live preview on valid, commit on blur/Enter per input A.4). Recents grid: 8-slot CSS grid, keyboard `1`–`8` selects. Two-swatch preview: two absolutely-positioned colored divs per input A.7 with click-to-swap. Active swatch indicator: inset 2px border + 1.05x scale (input A.3). Focus flow: SL square → Hue ring → Hex → Recents (tab order; input A.4). **Commit:** `M3: ColorPicker with HSL canonical state`.

10. **Sidebar + Toolbar + EditorLayout.** Create `Sidebar.tsx` (280px desktop / bottom sheet mobile at <640px). Compose `ColorPicker`, `Toolbar` (M3 just has the Pencil button + a disabled row showing "Eraser (M5)", "Picker (M5)", "Bucket (M5)", "Mirror (M5)"), variant toggle (Classic/Slim), brush size radio 1/2/3/4, and a `SavingStatus` chip that reads `savingState` from store. Create `EditorLayout.tsx` that arranges `[3D viewport][ViewportUV][Sidebar]` on desktop and stacks vertically with safe-area-inset on mobile. Modify `app/editor/page.tsx` to render `<EditorLayout />`. **Commit:** `M3: Sidebar + Toolbar + EditorLayout (responsive)`.

11. **Persistence.** Create `lib/editor/persistence.ts`. On module init, subscribe to the store via `useEditorStore.subscribe((state, prev) => ...)`; when the document bytes change (compare layer pixels by reference), debounce 500ms then `set('skin-document', state.document)`. On first edit, call `navigator.storage.persist()` (no dialog, silent per input D.4). On `put()` throw, inspect: if the error is `QuotaExceededError`, flip `savingState` to `'disabled:quota'`. On module init, detect Safari Private Browsing by calling `get('__probe')` in a try/catch — if it throws `InvalidStateError` or the quota is zero, flip `savingState` to `'disabled:private'`. Load on app init: `EditorCanvas` mount effect calls `loadDocument()`; if non-null, hydrate the store. **Commit:** `M3: IndexedDB persistence with debounce + Safari detection`. **Test file:** `tests/persistence.test.ts`.

12. **BucketHoverOverlay.** Create `app/editor/_components/BucketHoverOverlay.tsx`. Renders the 20% white overlay on the hovered island per input B.3. Only active when `activeTool === 'bucket'` (which M3 never sets — but the infrastructure is ready for M5). Actually since M3's toolbar only surfaces 'pencil' + disabled rows, this component's ACTIVE path is only exercised by flipping `activeTool` via devtools. **Status:** component exists, integration test confirms it renders nothing when tool is 'pencil'. Activation is M5's responsibility. **Commit:** `M3: BucketHoverOverlay component (inactive until M5)`.

13. **End-to-end acceptance + accessibility sweep.** Run the full acceptance test list (see below). Capture a Chrome screenshot of the paint loop (pencil paints pixel → 3D shows pixel) for the PR body. Run `npx @axe-core/cli http://localhost:3000/editor` (optional; only if installable without adding deps) or a manual keyboard sweep: Tab order, focus rings, `aria-pressed` on Toolbar, `aria-label` on Sidebar chips. **Commit:** `M3: acceptance pass + a11y sweep`.

14. **Open PR.** `git push -u origin m3-paint-canvas`, `gh pr create --base main --head m3-paint-canvas --title "M3: paint canvas, color picker, pencil tool, persistence" --body "(populate from Acceptance section)"`. Halt for human review + `/ce:review` + `/ce:compound` + rebase-merge + `m3-complete` tag.

## PR-based work flow

```
# from main tip at m2-complete
git checkout main && git pull --ff-only
git checkout -b m3-paint-canvas
# execute steps 1-13, commits per step
git push -u origin m3-paint-canvas
gh pr create --base main --head m3-paint-canvas \
  --title "M3: paint canvas, color picker, pencil tool, persistence" \
  --body-file <populated from Acceptance section below>
# Halt. Human runs /ce:review and /ce:compound on the branch.
# Human rebase-merges after review approval: gh pr merge --rebase --delete-branch
# Human tags: git tag -a m3-complete -m "M3 milestone complete" && git push origin m3-complete
```

Per the M1+M2 convention: no force-push to main; linear history preserved; tag applied after merge.

## Acceptance test commands + visual verification

```bash
# Automated (must all pass before PR merge)
npm install                     # 0 peer warnings
npx tsc --noEmit                # 0 errors
npm run lint                    # 0 problems
npm run test                    # all vitest suites pass
npm audit                       # 0 high/moderate vulnerabilities
rm -rf .next && npm run build   # success, both routes ○ (Static)
npm run dev                     # boots without errors
curl -sI http://localhost:3000/         # 200 text/html
curl -sI http://localhost:3000/editor   # 200 text/html
```

**Visual / manual (human verifies in Chrome after dev server is up):**

1. **Pencil single-pixel at zoom=1, brush=1.** Click once on the 2D canvas. Exactly one pixel changes color on both the 2D canvas and the 3D model in the same frame.
2. **Pencil N×N at brush sizes 2/3/4.** Change brush size via Sidebar radio. Click once. Exactly an N×N block changes color (centered on the click pixel, clamped at atlas edges).
3. **Color picker sanity flow (input A.9).** Run verbatim: pick via SL square → paint; sample via eyedropper → paint; click previous swatch → paint; type hex → paint. Zero jumps, zero delays, zero "approximate" feels across the 4 steps.
4. **Wheel zoom is cursor-centered.** Zoom in/out with the mouse over a specific pixel. That pixel stays under the cursor.
5. **Space+drag pans.** Hold Space, click-drag. Canvas translates; no painting occurs.
6. **Mobile bottom sheet <640px.** Resize viewport below 640px. Layout reflows to stacked vertical with bottom sheet. Safe-area-inset respected on iOS Safari sim.
7. **IndexedDB persistence.** Paint a few pixels. Close the tab. Reopen. Document restored.
8. **Safari Private detection.** In Safari Private Browsing (or a Chrome incognito profile with site data blocked), the Sidebar shows "Saving disabled" chip.
9. **No allocations in pointer hot path.** DevTools Performance tab: record 5s of continuous pencil drag. Heap line should be flat (allocations in rAF tick and per-`pointermove` should be zero — all `stroke` buffers reused, no `new ImageData` per move).
10. **Bucket hover preview.** In DevTools: `useEditorStore.setState({ activeTool: 'bucket' })`. Hover over the 2D canvas. A 20% white overlay appears on the hovered island. (M3 acceptance: component renders correctly when tool is bucket; bucket tool itself is M5.)
11. **Named-color accessibility hook.** Focus the hex input. A named-color label appears next to/below it (e.g., typing `#808080` shows "Gray" in `text-text-secondary text-xs`).
12. **Tool cursor dual-stroke visibility.** Hover the 2D canvas with pencil tool active. Cursor is visible on light-colored painted regions and dark regions equally (verify by painting a white area and a black area; cursor visible on both).
13. **Bundle budget.** `npm run build` reports `/editor` route chunk +First-Load-JS increase ≤ 15 kB from M2's 241 / 343 baseline. Target: 256 kB route / 358 kB First-Load or below.

## Known risks (P1 / P2 / P3)

**P1 — Bucket hover preview performance if flood-fill runs on every `pointermove`.** Input E.2 promises <1ms for worst-case 512-pixel island, so theoretically fine at 60fps. But `pointermove` fires at >60Hz on high-polling mice, which over-runs the budget. **Mitigation:** debounce the hover flood-fill to `requestAnimationFrame` — run at most once per frame. Store the last-hovered pixel and skip re-computation if unchanged. Also, because this is M3-inert (bucket tool is M5), real-world exposure is low; but the infra must be right or M5 will inherit the bug.

**P1 — Island map correctness is unverified against the actual 2D atlas layout.** The island map generator walks the UV regions from `lib/three/geometry.ts`, but the two sources of truth (3D UVs + 2D pixel regions) must align perfectly. A one-pixel mismatch causes bucket fill to bleed into adjacent islands. **Mitigation:** `tests/island-map.test.ts` spot-checks at least 5 pixel coordinates (e.g., `(0, 0)` = head top-left, `(63, 15)` = head-overlay bottom-right, `(16, 16)` = body top-left corner, `(40, 16)` = right-arm top-left, `(32, 48)` = left-arm top-left on a slim variant). Human visual test 10 above exercises a real render path.

**P1 — Zustand subscription triggers wasteful re-renders.** A naïve `useEditorStore(state => state)` in ColorPicker will re-render on every store mutation (variant, brush size, zoom, pan, recents, saving state…). **Mitigation:** every component subscribes with a narrow selector: `const activeColor = useEditorStore(state => state.activeColor)`, etc. Document this pattern in the store file's top comment. Verify by DevTools React Profiler: a pencil stroke should cause 0 re-renders in ColorPicker. Alternative (if selectors prove too error-prone): use Zustand's `useShallow` hook or `shallow` equality comparator for tuple selectors.

**P2 — Tab-close race between debounced save and user close.** Debounce 500ms means a user painting and immediately closing the tab could lose the last 500ms of strokes. **Mitigation:** on `beforeunload`, flush any pending debounce immediately via `idbKeyval.set()` synchronously (well, synchronously-requested; the actual IDB transaction is async but the `put()` request is queued before unload). Document that losing the final stroke on force-close is acceptable — this is the same trade-off every auto-save app makes. Capture for COMPOUND.

**P2 — `jsdom` does not implement `CanvasRenderingContext2D`.** `tests/texture-manager.test.ts` and `tests/persistence.test.ts` touch `document.createElement('canvas')` and the `getContext('2d')` return value. `jsdom` returns `null` for 2D context out of the box. **Mitigation:** install `@napi-rs/canvas` or similar only if tests require full 2D context. **Preferred:** structure the tests so `TextureManager` can be tested with the canvas dependency injected — pass a mock `CanvasRenderingContext2D` that records call counts. This avoids a heavy native-module dependency. The `tests/persistence.test.ts` mocks `indexedDB` directly (no canvas needed).

**P2 — Color picker SL square pointer capture on touch devices.** `pointercapture` API sometimes fails on iOS Safari if the element that captures is re-rendered during the drag. **Mitigation:** use a stable ref for the SL square element; do not rebuild it mid-drag. Test on iOS Safari / Chrome Android emulation before PR.

**P3 — Named-colors table bundle size.** 140 entries × ~30 bytes each ≈ 4 kB raw, ~2 kB minified+gz. Acceptable within the +15 kB /editor budget. If the bundle delta exceeds budget, cut the named-colors table to ~50 entries (CSS primary-named-colors subset).

**P3 — Gray-axis hysteresis edge case.** If a user types `#808080`, then drags the SL square across `s=0.01`, the hue is preserved. But if they type a color like `#808081` (s ≈ 0.003, below the 0.01 threshold), they're already in the "hysteresis zone" with an ill-defined hue. Picker state stores whatever hue `rgbToHsl` computes for that input. Behavior: "first-write wins" — whatever the current hue state is at the moment of `s < 0.01` entry is what stays. Test covers this case.

**P3 — Wheel zoom on touchpad with gesture-based horizontal scroll.** Users on macOS trackpads triggering horizontal scroll gestures can accidentally pan instead of zoom. **Mitigation:** only treat wheel events as zoom when `event.deltaY !== 0` AND `event.ctrlKey` is NOT set (ctrl+wheel is pinch-zoom on trackpads). If ctrl+wheel, do zoom. If just wheel deltaY, do zoom. Pure deltaX → pan. Document.

## Open questions (for human resolution before `/ce:work`)

*None product-blocking. All are cosmetic/preference-class and have recommended defaults.*

1. **Default `activeColor` on first paint.** Default: dirt brown (`#6B3A1E`), first entry of `DEFAULT_PALETTE`. Alternative: inherit last-used color from previous session (via IDB). Recommendation: dirt brown for M3; IDB-inherited color deferred to M6 when layer state lands.
2. **Mobile breakpoint.** Sidebar switches to bottom sheet below 640px per input C.2. Alternative: 768px (`md:` breakpoint in Tailwind). Recommendation: 640px (matches Tailwind `sm:`, matches input spec).
3. **Wheel zoom sensitivity.** 1.15× per tick is a good default but some users want faster. Recommendation: 1.15× for M3; add a settings toggle in M8.
4. **Sidebar scroll behavior on desktop when viewport < 720px tall.** Color picker + toolbar + variant toggle + saving status might overflow. Recommendation: `overflow-y-auto` on the sidebar root; no fixed-height sections.

## Deferred to later milestones

**M4 — 2D↔3D bridge:**
- Raycast → UV coordinate math in `PlayerModel.tsx` pointer handlers.
- 3D mesh cursor decal floating 0.01 units above surface (input B.6 second half).
- Reverse flow: click on 3D writes to same `TextureManager`.

**M5 — Tool palette (bucket, eraser, picker, mirror):**
- Activate bucket tool and its hover preview (infra is ready in M3).
- Implement eraser/picker/mirror per DESIGN.md §9.
- Mirror plane visualization (input B.5 — dashed line, ghost cursor, 3D energy plane).
- Keyboard shortcuts `E`, `I`, `G`, `M` (only `B` for pencil lands in M3).

**M6 — Layers + undo:**
- Multi-layer rendering in `TextureManager.composite()`.
- Stroke-based undo diff stack per DESIGN.md §8.
- `applyDiff` to restore `before`/`after` states.

**M7 — Templates + real default skin:**
- Median-cut palette extraction (`lib/color/palette-extract.ts`) on template selection.
- Ghost Templates picker.
- Replace placeholder skin with real Microsoft minecraft-samples PNG.

**M8 — Export + luminance + onboarding polish:**
- Luminance toggle (`L` key) + grayscale shader (DESIGN.md §10).
- PNG export with variant confirmation.
- First-paint sequence frame-by-frame polish.

---

## /ce:plan review answers

**1. Hardest decision.**
Whether to ship the `BucketHoverOverlay` component in M3 even though the bucket tool itself is M5 scope. The input spec (B.3) locks the flood-fill hover preview as a feature of the bucket cursor; M3's acceptance criteria #10 ("Bucket hover preview: 20% white overlay on hovered island within flood-fill bounds") explicitly requires it. But M3's toolbar only surfaces the pencil tool — you can't actually *use* the bucket hover preview in the normal M3 UI. I chose to ship the component and the flood-fill infrastructure in M3 (activated via `useEditorStore.setState({ activeTool: 'bucket' })` in DevTools for acceptance test #10) rather than push the preview to M5. Rationale: (a) the flood-fill algorithm and island map are prerequisites for the M3 acceptance, so they have to land anyway; (b) building the overlay now means M5 is a pure tool-activation milestone, not a tool + preview milestone; (c) the P1 perf risk around `pointermove` debouncing is easier to catch with the component present than absent. Downside: a line of code that only exercises its full path via devtools is a small maintainability debt. Worth it.

**2. Alternatives rejected.**
- **Zustand slices via `combine` middleware.** Rejected — 8-field flat state doesn't need slicing, and middleware composition is a new concept to introduce at the same time as the store itself. If M6's layer state grows to >15 fields, revisit.
- **Tab-switched 2D/3D layout (H.1 option).** Rejected — directly contradicts the "paint and see result in same frame" design goal. The mental cost of tab-switching is exactly the friction the app is trying to eliminate.
- **`zustand/middleware/persist` for IndexedDB.** Rejected — the middleware assumes `localStorage`-style synchronous APIs and doesn't compose with our `SavingState` surface. Hand-rolled subscription in `lib/editor/persistence.ts` is 20 lines and stays clean.
- **Canvas 2D `ctx.scale()` for zoom.** Rejected in favor of CSS `transform`. GPU-accelerated, preserves `image-rendering: pixelated` sharpness, doesn't force redraw on zoom/pan. Only downside: sub-pixel CSS transforms can cause anti-alias bleed at fractional zoom levels — mitigated by snapping `zoom` to integer values.
- **Running pencil stamps through `putImageData` per pointer move.** Rejected in favor of direct `Uint8ClampedArray` writes on the active layer's pixel buffer. `putImageData` allocates a new `ImageData` per call which violates the zero-allocation-in-hot-path invariant. Direct array writes + one `composite()` call per stroke commit keeps allocations bounded.
- **A separate `ToolsRegistry` abstraction.** Rejected for M3. Only one tool is active. A registry would be premature. M5 can extract when 5 tools exist.
- **Vitest with full React Testing Library setup.** Rejected for M3. All tests are pure-logic (color math, flood fill, island map, pencil stamp, texture rAF coalescing, persistence mocking). No React component tests this milestone. `@vitejs/plugin-react` can be added when M6's layer panel needs interaction tests.
- **Defer named-colors table to M8.** Rejected — input C.3 locks it as the accessibility hook for hex input focus, which lands in M3's ColorPicker. Tiny bundle cost justifies inclusion.

**3. Least confident about.**
The zero-allocation invariant in the pointer hot path. I can describe the discipline in the plan (reuse stroke buffers, avoid `putImageData`, avoid `new Vector3`/destructuring, avoid closures that capture fresh references), but I cannot verify at plan time that every path taken by the `pointermove` → `pencilStamp` → `markDirty` chain actually holds the invariant. Especially concerning: the `image-rendering: pixelated` CSS transform on ViewportUV might interact with zoom state changes in ways that force layout reflows per-frame, which would allocate regardless of what our JS does. Acceptance criterion #9 (DevTools Performance flat-heap check) is the only way to truly verify. If it fails at /ce:work time, the mitigation probably lives in moving the canvas display out of the CSS-transform subtree — which is a more invasive refactor than I'd like to leave as a "fix at work-time" possibility. Secondary uncertainty: the island map correctness. The plan specifies spot-checks at 5 pixel coordinates in the test, but the full 4096-pixel map derivation from the UV geometry has many edge cases (overlay regions, slim-variant arm padding at unused-tail pixels, Y-flip convention between atlas and three.js). If `tests/island-map.test.ts` passes but visual test #10 fails, the debugging path would be labor-intensive — probably a full-atlas heatmap render to eyeball. I'd rather catch that at /ce:work time than re-plan the island-map generator here, but I'm flagging the risk explicitly.
