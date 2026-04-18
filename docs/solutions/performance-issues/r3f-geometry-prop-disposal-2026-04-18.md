---
title: R3F prop-passed geometries leak GPU memory without explicit useEffect cleanup
category: performance-issues
date: 2026-04-18
tags: [r3f, react-three-fiber, three.js, memory-leak, webgl, useEffect, useMemo]
component: 3d-editor
module: lib/three
severity: medium
milestone: M2
discovered_via: /ce:review (6-of-9 reviewer cross-confirmation)
---

# R3F prop-passed geometries leak GPU memory without explicit useEffect cleanup

## Problem

React Three Fiber auto-disposes geometries declared as JSX children (`<mesh><boxGeometry /></mesh>`) because it owns their lifecycle. But geometries passed as a **prop** (`<mesh geometry={geo} />`) are caller-owned — R3F does not dispose them on mesh unmount or prop replacement. Forgetting to dispose caller-owned geometries leaks GPU vertex buffers on every re-creation.

## Symptoms

- Growing `performance.memory.usedJSHeapSize` over session lifetime (slow leak, not spike).
- Growing WebGL resource count visible in the Three.js DevTools extension (`Renderer → memory.geometries`).
- No JavaScript exceptions. No visible rendering artifacts. Silent leak.
- Per BoxGeometry: ~840 bytes (position + normal + uv + index) × upload overhead. For a Minecraft player model with 12 body-part geometries, ~10 KB leaked per Classic↔Slim toggle. Over 100 toggles → ~1 MB GPU memory permanently held until tab close.

## What didn't work

**Relying on the implicit comment "three.js's automatic disposal on mesh unmount".** This is a common misconception. Three.js does not auto-dispose anything. What R3F does is:

1. For declarative children (`<boxGeometry args={[...]} />`): the JSX element is owned by R3F. When unmounted, R3F calls `.dispose()` on the instance.
2. For props (`geometry={myGeo}`): R3F treats the object as opaque. It does not track, own, or dispose it. The caller is responsible.

Relying on garbage collection also doesn't help — three.js geometries hold a GPU-side reference via the WebGL context that must be explicitly released. Even when the JS object becomes unreachable, the GPU buffers persist until `.dispose()` is called.

## Solution

Add a `useEffect` cleanup that explicitly disposes the geometries when they change or the component unmounts.

**Before** (leaks on every `variant` change):

```tsx
const geometries = useMemo(() => {
  const map = {} as Record<PlayerPart, BoxGeometry>;
  for (const part of PARTS) {
    const [w, h, d] = partDims(variant, part);
    const geo = new BoxGeometry(w, h, d);
    mapBoxUVs(geo, uvs[part]);
    map[part] = geo;
  }
  return map;
  // Comment: "three.js's automatic disposal on mesh unmount handles cleanup"
}, [variant]);
```

**After**:

```tsx
const geometries = useMemo(() => {
  const map = {} as Record<PlayerPart, BoxGeometry>;
  for (const part of PARTS) {
    const [w, h, d] = partDims(variant, part);
    const geo = new BoxGeometry(w, h, d);
    mapBoxUVs(geo, uvs[part]);
    map[part] = geo;
  }
  return map;
}, [variant]);

// Dispose the GPU buffers for the previous geometry set whenever `geometries`
// changes (variant toggle) or the component unmounts. R3F auto-disposes
// declarative `<boxGeometry>` JSX children because it owns their lifecycle,
// but a geometry passed as a prop (`<mesh geometry={...} />`) is caller-owned
// — we must dispose it ourselves or the BoxGeometry's VRAM leaks on every
// variant toggle.
useEffect(() => {
  return () => {
    for (const part of PARTS) {
      geometries[part].dispose();
    }
  };
}, [geometries]);
```

The effect's cleanup runs when `geometries` changes (old memoized value goes out of scope) and on unmount. Both paths free the previous GPU buffers.

## Why this works

React effects fire in a specific order on dependency change:

1. Component re-renders with new `variant` prop
2. `useMemo` returns new geometries map (old one is still referenced by the previous effect's captured closure)
3. Previous effect's cleanup runs first → disposes old geometries (captured via closure)
4. New effect's setup runs → registers cleanup for current geometries

On unmount, only the final effect's cleanup runs, disposing the current set.

This matches the three.js disposal contract: every `new BoxGeometry(...)` has exactly one matching `.dispose()` call before the JS reference is dropped.

## Prevention

### Review checklist

When reviewing R3F code for any PR that creates GPU resources:

1. Are any `new BoxGeometry`, `new BufferGeometry`, `new Texture`, `new CanvasTexture`, `new WebGLRenderTarget`, `new ShaderMaterial`, or similar constructors called inside a component?
2. If yes: are the returned instances passed as **props** to a mesh/material (e.g., `geometry={...}`, `map={...}`) rather than as JSX children?
3. If yes: is there a matching `.dispose()` in a `useEffect` cleanup keyed on the right dependencies?
4. If no: flag as memory leak.

### Grep-able pattern

```bash
# Find suspect patterns:
rg "new (BoxGeometry|BufferGeometry|CanvasTexture|Texture|ShaderMaterial|WebGLRenderTarget)" --type ts --type tsx
# For each hit, verify a useEffect cleanup exists that calls .dispose() on the resource.
```

### Lint rule (aspirational)

An `eslint-plugin-r3f-dispose` rule could catch this pattern:

```ts
// Flag: `new BoxGeometry` inside useMemo/useState without matching useEffect cleanup
```

None exists today; code review is the current line of defense.

### Test scenario (manual)

```
1. Open Chrome DevTools → Memory tab, take heap snapshot.
2. Render the component.
3. Trigger the variant/prop change that re-creates the geometries 50 times.
4. Take a second heap snapshot. Compare. Filter by "BoxGeometry" string.
5. Expect: constant count (~12 live geometries). Fail: count grows linearly with toggles.
```

### Pattern for ALL prop-passed GPU resources

This isn't specific to geometries. The same caller-owned lifecycle applies to:

| Resource | Passed as prop via | Dispose via |
|---|---|---|
| `BoxGeometry` / `BufferGeometry` | `geometry={...}` | `geo.dispose()` |
| `Texture` / `CanvasTexture` / `DataTexture` | `map={...}`, `normalMap={...}`, etc. | `tex.dispose()` |
| `ShaderMaterial` / `MeshStandardMaterial` | `material={...}` | `mat.dispose()` |
| `WebGLRenderTarget` | passed into `gl.setRenderTarget(...)` | `rt.dispose()` |
| `Line2`/`LineSegments2` geometry buffers | wrapped geometry | `.dispose()` on wrapped geo |

If the resource is declared as JSX child (`<boxGeometry />`, `<meshStandardMaterial />`), R3F owns it and auto-disposes. If passed as prop, you own it.

## Related

- M1 invariant (`docs/COMPOUND.md`): zero allocations in `useFrame` — orthogonal concern; this is about cleanup, not per-frame work.
- `lib/three/PlayerModel.tsx`: the fix in this repo, M2 commit `0df09aa`.
- Three.js docs on disposal: https://threejs.org/docs/#manual/en/introduction/How-to-dispose-of-objects
- R3F v9 migration notes: https://r3f.docs.pmnd.rs/tutorials/v9-migration-guide (lifecycle changes — even more reason to be explicit).
