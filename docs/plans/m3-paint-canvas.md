# M3: 2D Paint Surface + Color Picker + Pencil Tool — Plan Inputs

This file accumulates cross-AI consultation inputs for M3 prior to the `/ce:plan` invocation. The plan phase will reorganize and pin these inputs; the raw responses live here as the audit trail.

## Status

- M1 closed at tag `m1-complete` on `main` (commit `792bc15`)
- M2 closed at tag `m2-complete` on `main` (commit `70ce7c2` via PR #2)
- M3 color utilities already merged to `main` (commit `9b5c3eb` via PR #3, `lib/color/conversions.ts` + tests)
- Round 5 dispatches: Gemini (cursors + sidebar), ChatGPT (color picker UX), Perplexity (IndexedDB), Codex (color math, merged)
- Claude-produced artifacts: flood-fill algorithm, hex to HSL state model, hybrid palette strategy
- M3 `/ce:plan` is unblocked once this file merges

---

## Section A — Color picker UX (ChatGPT round 5)

### A.1 HSL representation — LOCKED

**Choice: Hue ring (outer) + Saturation/Lightness square (inner).**

Rationale: hue ring supports fast exploration across color families; SL square gives precise tonal control for shading ramps; hex field covers the "I know the exact color" case. Sliders rejected as "too numeric, feel like settings, not painting."

### A.2 Recents FIFO trigger rules — LOCKED

A color counts as "used" only when it affects the canvas.

Insert into FIFO on:
- First pixel painted in a stroke
- Bucket fill executed

Do NOT insert on:
- Changing color in picker UI
- Dragging in SL square
- Typing hex
- Hovering colors
- Eyedropper sampling (critical — sampling is not committing)

FIFO behavior:
- Max 8 colors
- New color inserts at position 1 (front)
- Existing color moves to front (no duplicate)
- Same color used twice in a row: no-op (prevents visual jitter)
- Stroke painting 100 pixels triggers exactly one insert

### A.3 Active swatch indicator — LOCKED

Inset 2px border (neutral light, ~60% opacity) + subtle 1.05x scale (100ms ease-out). Rejected alternatives: checkmark (too loud), glow (conflicts with canvas focus), outer border (layout shift).

### A.4 Hex input behavior — LOCKED

Rule: live preview on valid input only.

- "f" -> no change
- "ff" -> no change
- "fff" -> update (#ffffff shorthand)
- "ff00ff" -> update

Commit:
- Enter -> commit + blur
- Blur -> commit if valid, else revert
- Invalid: subtle red underline, no popups

Tab order: HSL (secondary UI) -> Hex -> Recents

### A.5 Keyboard shortcuts — LOCKED

SL square focused:
- Arrow keys: plus/minus 1 unit per press
- Shift + arrow: plus/minus 5 units

Hue ring focused:
- Left/right: plus/minus 1 degree
- Shift: plus/minus 5 degrees

Recents grid:
- Number keys 1-8: instant select, no animation delay

Eyedropper:
- Press I -> sample -> picker updates instantly -> focus stays on canvas

### A.6 Touch behavior — LOCKED

- SL square: single-finger drag, no long-press
- Hue ring: tap or drag, thicker hit area (UX, not visual)
- Minimum tap target: 36-40px
- Swatches: square, not tiny chips
- No hover dependency anywhere

### A.7 Color preview (current color indicator) — LOCKED

Two-swatch stack: current (top) + previous (offset bottom-right).

- Primary swatch: ~48-56px
- Click previous -> swap colors (120ms transition)
- Rationale: pixel art workflows often toggle between base + shade; this makes it instant without picker interaction

### A.8 Final behavior hierarchy

1. Canvas (always dominant)
2. Current color (quick reference)
3. Picker (when needed)
4. Recents (supporting memory)

Strong opinion: "If the picker feels like a feature, you have already lost. It should feel like a quiet, precise instrument."

### A.9 Sanity flow (for M3 acceptance test)

Run this exact sequence and assert zero jumps, delays, or "approximate" feels:

1. Pick color via SL square -> paint
2. Pick via eyedropper -> paint
3. Switch to previous swatch -> paint
4. Type hex -> paint

If any step feels delayed, jumpy, or approximate: fix before M3 merge. Color precision is foundational.

### A.10 Next-milestone offer deferred to M6

ChatGPT offered "how color interacts with layers (blend modes, opacity preview)" as the next topic. Deferred to M6 — layers do not exist until that milestone.

---

## Section B — Brush cursor visual design (Gemini round 5)

### B.1 Visibility strategy — Inverted Dual Stroke

NOT `mix-blend-mode` (unpredictable on low-spec GPUs).

USE: 2px white stroke underneath 1px black stroke. Creates halo effect guaranteeing 3.0:1 contrast on any hex code.

### B.2 Per-tool cursor SVGs — LOCKED

Pencil (precision frame):
```svg
<svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 16H20M16 12V20" stroke="white" stroke-width="3"/><path d="M12 16H20M16 12V20" stroke="black" stroke-width="1"/></svg>
```
- Hot-spot: (16, 16)
- Scaling: central crosshair stays 1px; clamped square frame expands to bound affected NxN pixels

Eraser (negative bound):
```svg
<svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="10" y="10" width="12" height="12" stroke="white" stroke-width="3"/><rect x="10" y="10" width="12" height="12" stroke="black" stroke-width="1" stroke-dasharray="2 2"/></svg>
```
- Hot-spot: (16, 16)
- Scaling: dashed rectangle scales linearly with brush size

Picker (sample loupe):
```svg
<svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="16" cy="16" r="8" stroke="white" stroke-width="3"/><circle cx="16" cy="16" r="8" stroke="black" stroke-width="1"/><path d="M16 8V12M16 20V24M8 16H12M20 16H24" stroke="white" stroke-width="2"/></svg>
```
- Hot-spot: (16, 16)
- Fixed size (does not scale with brush)

Bucket (flood target):
```svg
<svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M10 22L22 10M12 10L10 12" stroke="white" stroke-width="3"/><path d="M10 22L22 10M12 10L10 12" stroke="black" stroke-width="1"/></svg>
```
- Hot-spot: (10, 22) — tip
- Fixed size

### B.3 Bucket-fill hover preview — LOCKED

White overlay at 20% opacity on the 2D canvas and 3D model across the hovered island.

- Rejected: pulsing outline (too busy for pixel art)
- Requires flood-fill scan on hover — see Section E for the algorithm

### B.4 Picker real-time feedback — LOCKED

Sample ring: 4px inner circle inside the picker cursor, fills with the pixel color under the hot-spot in real time. In luminance mode, shows grayscale value; named-color tooltip still appears.

### B.5 Mirror-mode visualization — LOCKED

- Plane line: 1px dashed line (dual-stroke) down center of edited 2D UV island
- Ghost cursor: 50% desaturated/transparent ghost on mirrored side
- 3D view: faint vertical "energy plane" (Three.js PlaneGeometry with transparent additive material) bisecting the character

Mirror plane default orientation: X-axis (left/right). Z-axis toggle deferred to M5.

### B.6 2D vs 3D cursor implementation — LOCKED

- 2D Canvas: standard CSS `cursor: url('data:image/svg+xml;...') x y, auto;` — snappy, OS-refresh-rate
- 3D Viewport: hide OS cursor; render 3D mesh cursor (decal) floating 0.01 units above model surface
  - Billboarded unlit square that wraps around limb corners
  - Makes "which pixels will be hit" unambiguous

---

## Section C — Sidebar visual design (Gemini round 5)

### C.1 Desktop layout (>=640px)

Panel width: 280px right-docked. After 16px padding, 248px usable.

SV Square (Saturation/Value):
- Dimensions: `w-full` (248px) x `aspect-[5/4]` (~198px high)
- Styling: `rounded-md overflow-hidden ring-1 ring-ui-border ring-inset`

Hue slider:
- Horizontal, directly below SV square
- Dimensions: `w-full h-5 mt-3`
- Styling: `rounded-sm ring-1 ring-ui-border ring-inset`

Selector thumb:
- 16px (`w-4 h-4`) circular div
- `border-2 border-white` + `box-shadow: 0 0 0 1px rgba(0,0,0,0.8), inset 0 0 0 1px rgba(0,0,0,0.8)`
- `shadow-md` for float

Hex / HSL readout:
- `font-mono` (JetBrains Mono) below sliders
- `bg-ui-base text-text-primary` (assuming panel is `bg-ui-surface`)

### C.2 Mobile layout (<640px, `sm:` breakpoint)

Fundamental paradigm shift: floating panels -> viewport + bottom sheet.

- Canvas: top 60-65% of screen
- Bottom sheet: `fixed bottom-0 left-0 w-full bg-ui-surface border-t border-ui-border rounded-t-xl shadow-panel`
- Safe area: `pb-[env(safe-area-inset-bottom)]` required (iOS/Android gesture bars)

Touch-optimized proportions:
- SV square: `aspect-[2/1]` (wide rectangle) to save vertical space
- Thumbs: minimum 44x44px hit area (visual 20px, invisible pad extends to 44px)
- Swatches: horizontal scroll `flex overflow-x-auto snap-x`; each `w-10 h-10 rounded-full flex-shrink-0 snap-start`

### C.3 Accessibility hook — LOCKED

On hex input focus, show the matching named-color (from named-color dictionary introduced later) below/beside input in `text-text-secondary text-xs`.

---

## Section D — IndexedDB persistence findings (Perplexity round 5)

### D.1 Uint8ClampedArray serialization — CONFIRMED

Native via structured clone. No manual conversion needed.

- W3C HTML spec paragraph 7.1 Structured Clone supports TypedArrays (incl. Uint8ClampedArray) since 2011
- idb-keyval 6.2.2 `set(key, value)` passes directly to IDB's `put()`
- Source: `tx.objectStore(storeName).put(value, key)` — no pre-serialization

### D.2 Safari 18+ private quota — STILL ZERO

Writes fail silently on `put()`. Apple Safari 18 notes confirm no IndexedDB in Private Browsing. ITP evicts after 7 days inactivity even when non-private.

M3 mitigation: detect zero quota, show "saving disabled" indicator, continue as ephemeral session.

### D.3 Firefox Private mode — WORKS NORMALLY

Since Firefox 115 (2023): full IndexedDB reads/writes. Cleared on session end. No special handling needed.

### D.4 Storage Persistence API — CALL ON FIRST EDIT

`navigator.storage.persist()` returns `Promise<boolean>`. Support: Chrome 55+, Firefox 57+, Safari 15.2+.

UX: no dialog — silent if auto-granted. User gesture recommended (first edit event is appropriate).

### D.5 Write throughput — SAFE AT M3 CADENCE

Browsers cap ~MB/s but batch fine. Debounced 500ms auto-save at 5 strokes/sec for 30s = ~2.4 MB, ~5 MB/s peak. Well under Chrome's 80% disk quota. Debounce prevents burst quota errors.

### D.6 Chrome clear-on-close — OVERRIDES PERSISTENCE

User setting "Cookies and site data on close" deletes IndexedDB like localStorage. Storage Persistence API does NOT protect against user-initiated clear.

### D.7 Low storage warning API — DOES NOT EXIST

No major browser exposes a proactive "approaching quota" event. Only `IDBQuotaExceededError` on write fail. M3 must handle quota-exceeded as the primary signal.

---

## Section E — Flood fill algorithm (Claude, responding to Gemini delegation)

4-connected scanline flood fill, island-gated per DESIGN.md paragraph 9.1. Used by M3 bucket-fill hover preview and M5 actual bucket tool.

### E.1 Contract

```ts
// lib/editor/flood-fill.ts
import type { IslandMap } from './types';

export function floodFill(
  pixels: Uint8ClampedArray,
  islandMap: IslandMap,
  seedX: number,
  seedY: number,
): Uint8Array;  // length 64*64 = 4096, 1 = filled, 0 = excluded

export function applyFillMask(
  target: Uint8ClampedArray,
  mask: Uint8Array,
  r: number, g: number, b: number, a?: number,
): void;
```

### E.2 Algorithm properties

- Scanline (Smith 1979): per row, find leftmost + rightmost matching pixels, fill span, push rows above/below
- 3-5x faster than naive 4-stack recursive fill on dense regions
- No recursion: explicit `number[]` stack stores flat `[x, y]` pairs
- Island gating: pixel only fills if its island ID matches seed's island ID (prevents UV seam bleed)
- Color match: exact RGBA equality, tolerance 0 (pixel art requirement)
- Complexity: O(N) where N = pixels filled
- Performance: worst case (~512-pixel full island) runs in less than 1ms; hover preview at 60fps has ~15ms margin

### E.3 Reference implementation

See companion comment block in `lib/editor/flood-fill.ts` when M3 /ce:work creates the file. Algorithm sketch lives in Claude's response log for round 5.

### E.4 Deliberate non-features

- No tolerance parameter. Pixel art demands exact match. Adding tolerance later is easier than removing it.
- No "similar color" fuzzy mode. Same reason.

---

## Section F — Hex to HSL canonical state model (Claude, responding to ChatGPT delegation)

Prevents rounding drift and gray-axis hue jitter in the picker. Consumed by M3 color picker implementation.

### F.1 Problem

When the user types a valid hex then drags in SL square, the SL cursor position must not snap or drift. Three drift sources:

1. Rounding bias: `Math.round` in `hslToRgb` vs `Math.floor` in `rgbToHex` creates round-trip skew
2. Lossy storage: integer pixel coords vs float HSL values lose precision across conversions
3. Gray axis singularity: when S=0, H is undefined — `rgbToHsl(128,128,128)` -> H=0; `rgbToHsl(128,128,129)` -> H~=240. Nudging 1 pixel across S=0 produces hue jumps.

### F.2 Solution: HSL is canonical

```ts
// lib/color/picker-state.ts

export type PickerState = {
  h: number;       // [0, 360), canonical
  s: number;       // [0, 1], canonical
  l: number;       // [0, 1], canonical
  hex: string;     // derived from (h, s, l); never written directly
};

export function pickerStateFromHex(hex: string): PickerState | null {
  const rgb = hexToRgb(hex);
  if (rgb === null) return null;
  const [h, s, l] = rgbToHsl(rgb[0], rgb[1], rgb[2]);
  return { h, s, l, hex: hex.toLowerCase() };
}

export function pickerStateFromHSL(h: number, s: number, l: number): PickerState {
  const [r, g, b] = hslToRgb(h, s, l);
  return { h, s, l, hex: rgbToHex(r, g, b) };
}

export function handleHexInput(state: PickerState, hex: string): PickerState {
  const next = pickerStateFromHex(hex);
  return next ?? state;  // invalid = no-op
}

export function handleSLDrag(state: PickerState, s: number, l: number): PickerState {
  // Gray axis hysteresis: preserve prior hue when crossing s<0.01
  const next = pickerStateFromHSL(state.h, s, l);
  if (s < 0.01) return { ...next, h: state.h };
  return next;
}

export function handleHueDrag(state: PickerState, h: number): PickerState {
  return pickerStateFromHSL(h, state.s, state.l);
}
```

### F.3 Load-bearing rules

1. HSL is canonical. Every cursor position, slider, preview derives from H/S/L. Hex is derived only at the moment of HSL change.
2. Hex input writes HSL only, never hex directly. Typing "#3366CC" stores (216deg, 0.6, 0.5) and regenerates hex as "#3366cc" (lowercase).
3. No round-trip through RGB for display. SL cursor position computed as `(s * squareWidth, (1 - l) * squareHeight)` — never via hex -> RGB -> position.
4. Gray axis hysteresis. When `s < 0.01`, hue slider ignores HSL updates; prior hue preserved. Prevents "typed #808080 then nudged 1px, hue jumped to 240deg" behavior.

### F.4 Sanity flow prediction

Against ChatGPT's Section A.9 flow:

1. Pick via SL -> `handleSLDrag` -> HSL canonical, hex derived OK
2. Paint -> no state change OK
3. Eyedropper sample -> `pickerStateFromHex` from sampled pixel OK
4. Paint -> no state change OK
5. Switch to previous swatch -> `pickerStateFromHex` from swatch hex; HSL derived fresh OK
6. Paint -> no state change OK
7. Type hex -> `handleHexInput` -> HSL derived, cursor reflects new position OK

Zero jumps, zero snaps, zero drift.

---

## Section G — Hybrid palette strategy (Claude, responding to Gemini question)

### G.1 Decision

Static default + dynamic extract + FIFO aging.

- On first load (no template): ship 8-color Minecraft-iconic default palette
- On template selection (M7): median-cut extract top 8 colors from PNG, replace recents
- On painting: FIFO per Section A.2 pushes user-chosen colors to front; static/extracted colors age out

### G.2 Static default candidates

- Dirt brown
- Grass green
- Stone gray
- Water blue
- Lava orange
- Gold yellow
- Redstone red
- Obsidian black

### G.3 Why hybrid wins

- Static default: instant value on first open, no empty swatch grid
- Template extract: user picks "shaded-hoodie" template -> sees hoodie colors, not Minecraft defaults
- FIFO aging: user intent wins over time, neither frozen

### G.4 Implementation cost

- Median-cut on 64x64 RGBA: sub-millisecond, runs once per template selection
- Planned in DESIGN.md paragraph 3 as `lib/color/palette.ts`
- M3 introduces the static default; M7 adds extraction

---

## Section H — Open decisions for `/ce:plan` to resolve

The agent inputs do not cover these; `/ce:plan` must propose solutions.

### H.1 2D UV canvas layout

Where does the 2D paint canvas live in the viewport?

Options:
- Split-pane with 3D viewport (e.g., 50/50 or 60/40 horizontal split)
- Picture-in-picture overlay (small 2D view floats over 3D)
- Tab-switched (toggle between 2D and 3D as full-viewport)
- Mobile-specific: accordion / bottom sheet

### H.2 Zoom and pan on 2D canvas

64x64 atlas at 1:1 is unreadable. Needs zoom.

Standard patterns to consider:
- Mouse wheel: cursor-centered zoom (universal for drawing apps)
- Pinch-to-zoom on touch
- Space + drag for pan
- Keyboard +/- zoom
- Zoom levels: define min, max, default
- Pixel grid visibility thresholds (at what zoom do pixel boundaries become visible?)

### H.3 Initial brush size

Pencil tool brush size 1/2/3/4 px. What is the default when M3 loads? (Recommend 1 — matches pixel art precision default, tool cursor is smallest/clearest.)

### H.4 Zustand store shape

First global state introduction. Proposed slices:
- `activeToolId: 'pencil' | 'eraser' | 'picker' | 'bucket' | 'mirror'`
- `activeColor: PickerState`
- `brushSize: 1 | 2 | 3 | 4`
- `recentSwatches: string[]` (hex array, max 8, FIFO)
- `variant: SkinVariant` — hoist from EditorCanvas local state
- `uvCanvasZoom`, `uvCanvasPan` (from H.2 resolution)

`/ce:plan` must confirm slices and document rationale for each.

### H.5 Vitest setup

M3 requires dynamic test execution for TextureManager and flood-fill. Not yet installed.

- `vitest` devDependency
- `vitest.config.ts` with TypeScript path aliases
- `"test"` script in package.json
- Integration with existing `npm run lint` + `npx tsc --noEmit` acceptance chain

---

## Section I — Plan-phase checklist for `/ce:plan` consumption

The M3 `/ce:plan` invocation must explicitly address each:

- [ ] A.1 HSL representation: hue ring + SL square + hex input, per spec
- [ ] A.2 Recents FIFO: trigger only on canvas-affecting actions, 8-color max, move-to-front semantics
- [ ] A.3 Active swatch indicator: inset border + 1.05x scale
- [ ] A.4 Hex input: live preview on valid input only
- [ ] A.5 Keyboard shortcuts: arrow nudges, Shift x 5 multiplier, 1-8 for recents, I for eyedropper
- [ ] A.6 Touch: 36-40px minimum targets, no hover dependencies
- [ ] A.7 Color preview: two-swatch stack with click-to-swap
- [ ] A.9 Sanity flow: 4-color x 4-step test as acceptance criterion
- [ ] B.1 Cursor visibility: 2px white + 1px black dual stroke
- [ ] B.2 Per-tool SVG cursors: adopt verbatim, hot-spots specified
- [ ] B.3 Bucket hover preview: 20% white overlay on island, flood-fill on hover
- [ ] B.4 Picker sample ring: 4px inner circle with live color fill
- [ ] B.5 Mirror visualization: dashed plane line + ghost cursor + 3D energy plane (X-axis default)
- [ ] B.6 2D uses CSS cursor, 3D uses mesh decal
- [ ] C.1 Desktop: 280px right panel, 248px usable, SV square + hue slider proportions
- [ ] C.2 Mobile <640px: bottom sheet paradigm, safe-area inset
- [ ] C.3 Named-color hook on hex input focus
- [ ] D.1 idb-keyval stores Uint8ClampedArray natively, no conversion
- [ ] D.2 Safari Private: zero quota, detect and show "saving disabled"
- [ ] D.4 Call `navigator.storage.persist()` on first edit
- [ ] D.5 Debounce 500ms for auto-save
- [ ] D.7 Handle `IDBQuotaExceededError` as primary quota signal
- [ ] E Integrate flood-fill into bucket hover preview (M3) and bucket tool (M5)
- [ ] F Hex to HSL canonical state model in `lib/color/picker-state.ts`
- [ ] G Static Minecraft default palette on first load; template extraction deferred to M7
- [ ] H.1-H.5 resolve open decisions in plan output

---

## Section J — Cross-references

- `docs/DESIGN.md` paragraph 7: TextureManager contract (canvas config, rAF coalescing, composite method)
- `docs/DESIGN.md` paragraph 9: tool behaviors (pencil, eraser, picker, bucket, mirror)
- `docs/DESIGN.md` paragraph 12.5 M3: original milestone spec
- `docs/COMPOUND.md` M1: Tailwind v4 @theme runtime chain; bundle baseline
- `docs/COMPOUND.md` M2: zero-allocation useFrame invariant; useEffect-based resource hooks; variant/mode buttons need ARIA + data-*; exhaustive arrays via `Record<Union, T>` pattern
- `docs/solutions/performance-issues/r3f-geometry-prop-disposal-2026-04-18.md`: apply useEffect-dispose pattern to all GPU resources M3 creates (CanvasTexture, WebGLRenderTarget)
- `lib/color/conversions.ts` (merged via PR #3): color math primitives ready for picker-state.ts
- `tests/color-conversions.test.ts`: pattern for M3-introduced Vitest test files

---

*End of M3 plan inputs file.*
