---
title: R3F pointer paint on a CanvasTexture-mapped mesh — the full plumbing
category: integration-issues
date: 2026-04-20
tags: [r3f, react-three-fiber, three.js, canvas-texture, uv, pointer-events, painting]
component: 3d-editor
module: lib/three
severity: medium
milestone: M4
discovered_via: /ce:work M4 (2D↔3D paint bridge)
---

# R3F pointer paint on a CanvasTexture-mapped mesh — the full plumbing

## Problem

Building a 3D paint surface on top of React Three Fiber is deceptively simple once you know the pattern, but several independent gotchas compound to make the naïve first-attempt wrong in subtle ways: Y-axis convention mismatch between texture atlas and UV, per-event allocation regressions that silently tank frame rate, ambiguous precedence when multiple transparent meshes share a texture (Minecraft-style overlay layers), and bleed-through paint when the raycaster keeps enumerating occluded hits. The "correct" pipeline is ~8 small decisions made consistently; miss one and paint lands on the wrong pixel, the wrong layer, or the wrong body part.

## Symptoms

- Paint appears on the 3D model but mirrors vertically ("upside-down" strokes) — or paint on 2D surface doesn't match 3D.
- Clicking through the front of a body part paints the back face as well.
- Paint on the outer-shell (overlay) layer always stays on the overlay, even when the overlay is transparent at that pixel — user intuitively expects "paint the base" but overlay precedence is unconditional.
- Frame rate drops during active painting despite small canvas size (64×64 atlas = 16 KB/frame trivial; FPS drop is GC pressure, not draw cost).
- Mid-stroke variant/texture toggle leaves a "phantom" paintingRef that stamps a Bresenham-shaped line across the fresh canvas on the next pointermove.
- Tests that read `texture.needsUpdate` return `undefined`.

## What didn't work

**Treating `event.uv.y` as a direct atlas Y coordinate.** `event.uv` is bottom-up (WebGL convention); canvas/atlas is top-down. A direct `floor(uv.y * 64)` mirrors every stroke vertically. You must Y-flip: `floor((1 - uv.y) * 64)`.

**Per-event `new Vector3()` for world-space hit tracking.** At 60-200 Hz pointer cadence this allocates 12-40k Vector3 instances per minute of active painting. GC pressure shows up as frame-rate dips without an obvious culprit.

**Conditionally suppressing Bresenham interpolation "only at seams."** Atlas-space Bresenham between two 3D pointer samples will paint through whatever pixels lie in the atlas between the two hit points. Two face rects that share a 3D edge (head-front + head-right) are frequently NOT atlas-adjacent, so a fast diagonal drag across that 3D edge paints across arbitrary body parts. No partial fix is correct — either do 3D-space ray-stepping or skip interpolation entirely.

**Reading `texture.needsUpdate` in tests.** three.js makes the property setter-only; reads return `undefined`. Assert on `texture.version` (monotonic counter) instead. See the test-infra solution doc for this class of pitfall.

**Relying on the raycaster's default multi-hit enumeration to "hit what the user sees".** With transparent overlay meshes (`material.transparent = true`), the raycaster returns hits on everything along the ray including the face behind the visible face. Without `firstHitOnly = true` + `material.side = FrontSide`, clicks bleed through and paint multiple surfaces at once.

## Solution

The eight decisions, as a single coherent pipeline. This is the canonical pattern for this project; future pointer-driven 3D tools (M5 eraser/bucket/picker/mirror, M6 layer panel hit testing) mirror it exactly.

### 1. Y-flip at the conversion boundary

```ts
// lib/three/PlayerModel.tsx — inside pointerdown handler
const rawX = Math.floor(e.uv.x * SKIN_ATLAS_SIZE);
const rawY = Math.floor((1 - e.uv.y) * SKIN_ATLAS_SIZE);  // <-- the 1 - matters
```

The flip is the canvas-top-down vs UV-bottom-up convention difference documented in DESIGN.md §7. Mirror it whenever you go UV → atlas or atlas → UV.

### 2. Clamp rare UV extrapolation at geometry edges

When overlay geometry is slightly larger than the UVs it covers (Minecraft overlay is +1 pixel on each axis per M2 COMPOUND invariant 104), `e.uv` can briefly exceed `[0, 1]` at the extreme edge:

```ts
function clampAtlas(v: number): number {
  if (v < 0) return 0;
  if (v >= SKIN_ATLAS_SIZE) return SKIN_ATLAS_SIZE - 1;
  return v;
}
```

Wrap every `floor(uv * size)` result in this guard.

### 3. `firstHitOnly` + `FrontSide` for occlusion

```ts
// app/editor/_components/EditorCanvas.tsx — inside <Canvas onCreated>
(raycaster as unknown as { firstHitOnly?: boolean }).firstHitOnly = true;
```

`material.side = THREE.FrontSide` is the three.js `MeshStandardMaterial` default — verify nothing overrides it. Together these prevent paint bleed-through on occluded body parts.

### 4. Per-mesh identity via `userData`, not per-mesh closures

Building a factory that returns fresh closures per mesh (one per part, six per face) bloats closure count and dep-array churn. Instead, put part identity on the mesh:

```tsx
<mesh
  userData={{ part }}
  onPointerDown={handlePointerDown}
  onPointerMove={handlePointerMove}
/>
```

Then in the single shared handler:

```ts
const part = e.object.userData.part as PlayerPart | undefined;
if (part === undefined) return;
const isOverlay = part.endsWith('Overlay');
```

One closure triple (down/move/up) for all meshes. O(1) memory regardless of part count.

### 5. Overlay/base precedence via a pre-computed LUT

When clicking an overlay mesh, check the atlas pixel's alpha. If transparent, redirect to the corresponding base atlas pixel; else paint the overlay directly.

```ts
// lib/three/overlay-map.ts — built once at module load
function buildOverlayMap(uvs: PlayerUVs): Uint16Array {
  const map = new Uint16Array(4096).fill(0xFFFF);  // sentinel
  for each overlay part:
    for each face:
      for each (localX, localY) in face rect:
        map[(rect.y + localY) * 64 + (rect.x + localX)] =
          (baseRect.y + localY) * 64 + (baseRect.x + localX);
  return map;
}

// In the pointer handler:
if (isOverlay && alpha < OVERLAY_ALPHA_THRESHOLD) {
  const base = overlayToBase(variant, rawX, rawY);
  // paint base coord with target='base'
} else {
  // paint overlay coord with target='overlay'
}
```

Memory cost: 8 KB (2 variants × 4096 × 2 bytes). Runtime cost: O(1) per event. Much cheaper than per-event rect-iteration lookup.

### 6. Zero-allocation hot path

The pointer handler fires at 60-200 Hz. Per-event allocations accumulate fast. Rules:

- **Never** `new Vector3()` / `new Array(3)` / `{r, g, b}` tuple. Inline scalar reads:
  ```ts
  const hex = activeColor.hex;
  const r = (hexDigit(hex, 1) << 4) | hexDigit(hex, 2);
  const g = (hexDigit(hex, 3) << 4) | hexDigit(hex, 4);
  const b = (hexDigit(hex, 5) << 4) | hexDigit(hex, 6);
  ```
  `hexDigit` takes `(string, index)` → `number`. No helper that returns a tuple.
- **Accept** the single `{x, y, target}` object per pointer event that goes into `setHoveredPixel(...)`. Zustand captures the reference; trying to pool it breaks equality checks.
- **Dedup** hover dispatches with refs (`lastHoverX/Y/TargetRef`). Only call `setHoveredPixel` when the resolved pixel actually changes:
  ```ts
  if (resolved.x !== lastHoverXRef.current ||
      resolved.y !== lastHoverYRef.current ||
      resolved.target !== lastHoverTargetRef.current) {
    lastHoverXRef.current = resolved.x;
    lastHoverYRef.current = resolved.y;
    lastHoverTargetRef.current = resolved.target;
    setHoveredPixel({ x: resolved.x, y: resolved.y, target: resolved.target });
  }
  ```

### 7. Paint via shared `TextureManager.flushLayer` fast path

During a stroke, skip the multi-layer composite. Just upload the one mutated layer:

```ts
stampPencil(layer.pixels, x, y, brushSize, r, g, b);
textureManager.flushLayer(layer);  // O(layer.pixels) putImageData
```

On pointer-up, run the authoritative composite to respect blend modes + layer opacity:

```ts
textureManager.composite([layer, /* …future M6 layers… */]);
markDirty();  // triggers IndexedDB debounced write
```

`flushLayer` mirrors `composite` for the single-layer case but avoids the multi-layer pass. At 64×64 it's ~16 KB per upload; GPUs absorb this trivially at 60 fps.

### 8. Drag interpolation: per-frame only for 3D

Atlas-space Bresenham between two 3D pointer samples is WRONG. Ship per-frame-only painting; accept minor gaps on fast drags. If gap frequency in manual QA exceeds ~30% at normal drag speed, promote to proper 3D-space ray-stepping (expensive; see M5 deferred work) — not half-measures like island-gated Bresenham.

## Why this works

- **Y-flip is a contract, not a bug.** Canvas and UV have legitimately different origins (rendering history reasons). Treating the boundary explicitly — always doing the flip where the conversion happens — is simpler than trying to standardize one side.
- **LUT amortizes a one-time build cost across lifetime queries.** Eight KB of static memory trades off against 72 rect comparisons per pointer event otherwise.
- **`firstHitOnly` is a three.js-native hook.** It short-circuits the raycaster's intersection enumeration at the first hit without sacrificing ray-correctness for the near face. Lighter than maintaining our own hit-filter.
- **`userData` on the mesh is three.js's built-in extension point.** `Object3D` has had it forever; it doesn't break serialization or GLTF export paths that an arbitrary JS property on the mesh would.
- **Zero-alloc discipline is measurable.** At 120 Hz pointer cadence, each per-event allocation becomes ~7,000/minute. For any kind of visualizer / art tool, this threshold is the difference between smooth and janky.
- **Dedup refs are cheaper than store set identity guards** because they short-circuit before Zustand even runs its reducer.
- **`flushLayer` + authoritative-composite-on-up** preserves the invariant "the canvas state at end-of-stroke is what the user sees if they look at only the final frame" — same state between live-drawing and replay-from-history.

## Prevention

### Reviewer checklist

Any PR that adds a new R3F pointer-driven tool should be checked for:

- [ ] Y-flip applied at every UV→atlas and atlas→UV conversion (grep for `uv.y` and `1 -`)
- [ ] `clampAtlas` (or equivalent) on every computed atlas coord
- [ ] `raycaster.firstHitOnly = true` set once at Canvas creation
- [ ] `material.side` not accidentally flipped away from `FrontSide`
- [ ] `userData.<key>` used for per-mesh identity; closures not fanned out per mesh
- [ ] Zero `new Vector3` / `new Array` / tuple-returning helpers in handlers
- [ ] Hover dispatches dedup'd by last-sent refs
- [ ] `flushLayer` during stroke, `composite + markDirty` on pointer-up
- [ ] Pointer state reset on `[textureManager, layer]` change (variant-mid-stroke P1 prevention)
- [ ] No atlas-space Bresenham interpolation on 3D drags

### Test pattern

```ts
// tests/paint-bridge.test.ts — pure-function coverage
describe('uvToAtlas', () => {
  it('Y-flip: v=0 → atlas y=63 (bottom row)', () => {
    expect(uvToAtlasY(0)).toBe(63);
  });
  it('Y-flip: v=1 → atlas y=0 (top row)', () => {
    expect(uvToAtlasY(1)).toBe(0);
  });
  it('clamp: u>1 → atlas x=63', () => {
    expect(uvToAtlasX(1.01)).toBe(63);
  });
});

describe('overlay precedence', () => {
  it('transparent overlay hit → redirect via LUT', () => { /* … */ });
  it('alpha=threshold exactly → overlay (≥ threshold wins)', () => { /* … */ });
  it('alpha=threshold-1 → redirect to base', () => { /* … */ });
});
```

Full render integration (R3F + jsdom) is fragile; rely on pure-function tests for the math + manual acceptance for the visual loop. See `docs/solutions/test-failures/vitest-jsdom-react-component-testing-setup-2026-04-20.md` for the test-infra baseline.

### Race-prevention useEffect skeleton

Copy this into any new component that holds per-stroke refs during pointer painting:

```ts
// Race prevention: reset stroke-local state when the underlying canvas/layer
// swaps (e.g., variant toggle replaces TextureManager + Layer). Without this,
// paintingRef stays true against a blank new layer and the next pointermove
// stamps a line from stale coords.
useEffect(() => {
  paintingRef.current = false;
  lastPaintedXRef.current = -1;
  lastPaintedYRef.current = -1;
  // hover refs + clear the store slot if this component produces hover
  lastHoverXRef.current = -1;
  lastHoverYRef.current = -1;
  lastHoverTargetRef.current = '';
  setHoveredPixel(null);
}, [textureManager, layer, setHoveredPixel]);
```

## References

- [three.js BoxGeometry](https://threejs.org/docs/#api/en/geometries/BoxGeometry) — per-face vertex ordering (right/left/top/bottom/front/back; upper-left/upper-right/lower-left/lower-right from outside-looking-in)
- [R3F event object](https://r3f.docs.pmnd.rs/api/events) — `event.uv`, `event.object.userData`, pointer lifecycle
- [three.js `Raycaster.firstHitOnly`](https://threejs.org/docs/#api/en/core/Raycaster) — occlusion short-circuit
- [DESIGN.md §7](/docs/DESIGN.md) — TextureManager write pipeline + atlas/UV conventions
- [`docs/solutions/performance-issues/r3f-geometry-prop-disposal-2026-04-18.md`](../performance-issues/r3f-geometry-prop-disposal-2026-04-18.md) — disposal invariants for caller-owned GPU resources (applies to any new GPU resources M4+ creates)
- [`docs/solutions/test-failures/vitest-jsdom-react-component-testing-setup-2026-04-20.md`](../test-failures/vitest-jsdom-react-component-testing-setup-2026-04-20.md) — the `texture.needsUpdate` setter-only footgun lives here
- [`lib/three/atlas-to-world.ts`](/lib/three/atlas-to-world.ts) — the 6-entry face-axis transform table for the inverse operation (atlas coord → 3D world position)
- [`lib/three/overlay-map.ts`](/lib/three/overlay-map.ts) — the overlay→base LUT reference implementation
