'use client';

/**
 * M2: humanoid Minecraft player model, 16 meshes (8 base + 8 overlay).
 * M4: extended with 3D pointer paint, overlay/base precedence, and hover state
 * production.
 *
 * INVARIANTS:
 *   - Zero allocations inside the useFrame callback (M2). All math is scalar;
 *     no `new Vector3`, no `.lookAt(vector)`, no template strings, no
 *     destructuring. `camera.lookAt(x, y, z)` uses three.js module-level temp
 *     buffers internally — verified allocation-free.
 *   - Zero allocations in pointer hot paths beyond the one per-event store
 *     dispatch (M3). `setHoveredPixel({x,y,target})` allocates one literal
 *     object per dispatch; acceptable per M3 precedent (pointerToAtlas returns
 *     `{ax, ay}`). We deduplicate with hover-last refs so the dispatch only
 *     fires when the resolved pixel changes.
 *   - Caller-owned GPU disposal (M2): geometries passed as `<mesh geometry={...}>`
 *     props are disposed on variant change / unmount.
 *
 * M4 paint flow per unit in the plan:
 *   1. R3F dispatches `onPointerDown`/`Move`/`Up` with `e.uv` populated.
 *   2. Atlas coord = `floor(uv.x * 64), floor((1 - uv.y) * 64)`.
 *   3. Y-flip because atlas is top-down but UV is bottom-up (per DESIGN §7).
 *   4. Overlay precedence (R6): if the hit mesh is an overlay part and the
 *      atlas pixel's alpha is below OVERLAY_ALPHA_THRESHOLD, redirect to the
 *      base atlas pixel via `overlayToBase()`. Otherwise paint the overlay.
 *   5. `stampPencil` + `textureManager.flushLayer(layer)` per move; authoritative
 *      multi-layer `composite` on pointer-up (mirrors ViewportUV's M3 pattern).
 *   6. Drag: per-frame only in M4 (no Bresenham in atlas space). Atlas-space
 *      interpolation across UV seams would bleed across 3D-adjacent faces that
 *      aren't atlas-adjacent. Deferred to M5/M6 per plan D4.
 */

import { type ThreeEvent, useFrame } from '@react-three/fiber';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { BoxGeometry, type Mesh, type Texture } from 'three';

import {
  BREATHING_AMPLITUDE,
  BREATHING_ANGULAR,
  HEAD_BASE_Y,
  SKIN_ATLAS_SIZE,
} from './constants';
import {
  type PlayerPart,
  type SkinVariant,
  getUVs,
  mapBoxUVs,
  partDims,
  partPosition,
} from './geometry';
import { resolveOverlayHit } from './overlay-map';
import { clampAtlas } from './atlas-math';
import { hexDigit } from '@/lib/color/hex-digit';
import { stampPencil } from '@/lib/editor/tools/pencil';
import { useEditorStore } from '@/lib/editor/store';
import type { Layer } from '@/lib/editor/types';
import type { TextureManager } from '@/lib/editor/texture';

type Props = {
  texture: Texture;
  variant: SkinVariant;
  // M4 paint pipeline props. Threaded from EditorLayout → EditorCanvas →
  // PlayerModel. Optional so M2-era tests that only pass texture+variant
  // remain compatible; paint is inert when any of the three is absent.
  textureManager?: TextureManager;
  layer?: Layer;
  markDirty?: () => void;
  // M4 Unit 0 gate mirror (same contract as ViewportUV). When true, pointer
  // events early-return so hydration cannot overwrite in-flight strokes.
  hydrationPending?: boolean;
};

// PART_ORDER is typed `Record<PlayerPart, number>`, forcing the object literal
// to cover every PlayerPart. Adding a new member to the union (e.g., 'cape' in
// a future milestone) produces a compile error until the key is added here.
// PARTS is derived from PART_ORDER keys, guaranteeing exhaustiveness.
const PART_ORDER: Record<PlayerPart, number> = {
  head: 0,
  body: 1,
  rightArm: 2,
  leftArm: 3,
  rightLeg: 4,
  leftLeg: 5,
  headOverlay: 6,
  bodyOverlay: 7,
  rightArmOverlay: 8,
  leftArmOverlay: 9,
  rightLegOverlay: 10,
  leftLegOverlay: 11,
};

const PARTS = Object.keys(PART_ORDER) as readonly PlayerPart[];


export function PlayerModel({
  texture,
  variant,
  textureManager,
  layer,
  markDirty,
  hydrationPending = false,
}: Props): React.ReactElement {
  const headRef = useRef<Mesh>(null);

  // Build 12 BoxGeometries for this variant. PARTS is exhaustive over
  // PlayerPart (enforced by PART_ORDER), so every key is populated by the
  // loop — the final cast is safe.
  const geometries = useMemo(() => {
    const uvs = getUVs(variant);
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
  // but a geometry passed as a prop (`<mesh geometry={...} />`) is caller-
  // owned — we must dispose it ourselves or the BoxGeometry's VRAM leaks on
  // every variant toggle.
  useEffect(() => {
    return () => {
      for (const part of PARTS) {
        geometries[part].dispose();
      }
    };
  }, [geometries]);

  // ── M4 paint state ────────────────────────────────────────────────────────
  //
  // Narrow store subscriptions per the M3 selector contract. ColorPicker's
  // regression test (tests/color-picker-selectors.test.ts) enforces that
  // unrelated slots don't cause re-renders here.
  const activeTool = useEditorStore((s) => s.activeTool);
  const brushSize = useEditorStore((s) => s.brushSize);
  const activeColorHex = useEditorStore((s) => s.activeColor.hex);
  const commitToRecents = useEditorStore((s) => s.commitToRecents);
  const setHoveredPixel = useEditorStore((s) => s.setHoveredPixel);

  // Hot-path refs (zero-alloc invariant). `paintingRef` tracks whether a
  // stroke is in progress; `lastPaintedX/Y` dedupe identical-pixel moves.
  // `lastHoverX/Y/Target` dedupe hover dispatches so the store only fires
  // when the resolved pixel actually changes — important because the
  // downstream CursorDecal + PencilHoverOverlay both subscribe.
  const paintingRef = useRef(false);
  const lastPaintedXRef = useRef(-1);
  const lastPaintedYRef = useRef(-1);
  const lastHoverXRef = useRef(-1);
  const lastHoverYRef = useRef(-1);
  const lastHoverTargetRef = useRef<'base' | 'overlay' | ''>('');

  // M4 Unit 0 (P1 race mirror from ViewportUV): reset stroke-local state when
  // the TM/layer bundle changes (variant toggle mid-stroke would otherwise
  // leave a stuck paintingRef with stale atlas coords from the old canvas).
  useEffect(() => {
    paintingRef.current = false;
    lastPaintedXRef.current = -1;
    lastPaintedYRef.current = -1;
    lastHoverXRef.current = -1;
    lastHoverYRef.current = -1;
    lastHoverTargetRef.current = '';
  }, [textureManager, layer]);

  // Clear hover state when the component unmounts (e.g., 3D canvas removed
  // from DOM) or when paint is inert (missing paint props).
  useEffect(() => {
    if (textureManager === undefined || layer === undefined) {
      setHoveredPixel(null);
    }
  }, [textureManager, layer, setHoveredPixel]);

  // Clear hover when tool is switched away from pencil so the lingering
  // decal + 2D tint don't confuse the user during an M5 eraser/bucket
  // interaction.
  useEffect(() => {
    if (activeTool !== 'pencil') {
      setHoveredPixel(null);
      lastHoverXRef.current = -1;
      lastHoverYRef.current = -1;
      lastHoverTargetRef.current = '';
    }
  }, [activeTool, setHoveredPixel]);

  // Resolve a raw (uv-derived) atlas coord + mesh-isOverlay flag into the
  // final paint target using overlay/base precedence. Delegates to the
  // shared lib/three/overlay-map.ts resolver; this wrapper captures the
  // per-component `layer` + `variant` so handlers stay terse.
  const resolveHit = useCallback(
    (
      rawX: number,
      rawY: number,
      isOverlay: boolean,
    ): { x: number; y: number; target: 'base' | 'overlay' } => {
      if (!isOverlay || layer === undefined) {
        return { x: rawX, y: rawY, target: 'base' };
      }
      return resolveOverlayHit(variant, layer.pixels, rawX, rawY, isOverlay);
    },
    [layer, variant],
  );

  // Stamp one pixel (N×N per brushSize) at the resolved atlas coord.
  // Inline hexDigit scalar reads per M3's zero-alloc pattern; no tuple
  // allocation for the RGB parse.
  const stampAt = useCallback(
    (x: number, y: number): void => {
      if (textureManager === undefined || layer === undefined) return;
      const hex = activeColorHex;
      const r = (hexDigit(hex, 1) << 4) | hexDigit(hex, 2);
      const g = (hexDigit(hex, 3) << 4) | hexDigit(hex, 4);
      const b = (hexDigit(hex, 5) << 4) | hexDigit(hex, 6);
      stampPencil(layer.pixels, x, y, brushSize, r, g, b);
      textureManager.flushLayer(layer);
    },
    [activeColorHex, brushSize, layer, textureManager],
  );

  // ── Pointer handlers ──────────────────────────────────────────────────────
  //
  // Each mesh gets the same three handlers; the mesh's part name is carried
  // in `userData.part` so the closure doesn't need to capture per-mesh
  // context. Stopping propagation on the hit mesh prevents R3F from firing
  // the same event on any mesh behind it (combined with
  // `raycaster.firstHitOnly = true` in EditorCanvas for overlap safety).

  const handlePointerDown = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      // P0 (review finding): only primary button paints. Right-click (2) is
      // OrbitControls' rotate gesture; middle-click (1) is dolly. Touch and
      // pen both report button=0 for primary, so this guard is pointer-type-
      // agnostic. Without it, every camera gesture strokes a trail of pixels
      // across whichever body part the cursor sweeps over during orbit.
      if (e.button !== 0) return;

      if (hydrationPending) return;
      if (activeTool !== 'pencil') return;
      if (!e.uv) return;
      if (textureManager === undefined || layer === undefined) return;

      const part = e.object.userData.part as PlayerPart | undefined;
      if (part === undefined) return;

      e.stopPropagation();

      // P0 (review finding): capture the pointer on the canvas DOM element so
      // pointerup fires even if the user drags off the mesh before release.
      // Without this, R3F's pointerup dispatch requires a mesh hit at release
      // time; releases over empty canvas would leave paintingRef stuck true,
      // auto-painting on the next hover without any button held.
      (e.target as Element).setPointerCapture(e.pointerId);

      const rawX = clampAtlas(Math.floor(e.uv.x * SKIN_ATLAS_SIZE));
      const rawY = clampAtlas(Math.floor((1 - e.uv.y) * SKIN_ATLAS_SIZE));
      const isOverlay = part.endsWith('Overlay');
      const resolved = resolveHit(rawX, rawY, isOverlay);

      paintingRef.current = true;
      lastPaintedXRef.current = resolved.x;
      lastPaintedYRef.current = resolved.y;

      stampAt(resolved.x, resolved.y);
      markDirty?.();
      // Recents insert: once per stroke (matches ViewportUV + M3 §A.2).
      commitToRecents(activeColorHex);
    },
    [
      hydrationPending,
      activeTool,
      resolveHit,
      stampAt,
      markDirty,
      commitToRecents,
      activeColorHex,
      textureManager,
      layer,
    ],
  );

  const handlePointerMove = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      if (!e.uv) return;
      const part = e.object.userData.part as PlayerPart | undefined;
      if (part === undefined) return;

      // P1 (review finding): without stopPropagation, the raycast hits BOTH
      // the overlay mesh AND the base mesh behind it (both FrontSide-faced
      // toward camera). R3F dispatches handlePointerMove on both in order;
      // the base hit overrides the overlay hit, so hoveredPixel always ends
      // with target='base' even when the user is visibly hovering an opaque
      // overlay pixel. Label + 2D tint + decal position all lied as a
      // result. Stopping propagation after the first valid hit resolves it.
      // (handlePointerDown already does this, which is why PAINT targeted
      // the overlay correctly; only HOVER was broken.)
      e.stopPropagation();

      const rawX = clampAtlas(Math.floor(e.uv.x * SKIN_ATLAS_SIZE));
      const rawY = clampAtlas(Math.floor((1 - e.uv.y) * SKIN_ATLAS_SIZE));
      const isOverlay = part.endsWith('Overlay');
      const resolved = resolveHit(rawX, rawY, isOverlay);

      // Hover dispatch — dedup against last dispatched value so the store
      // only fires when the resolved pixel changes.
      if (
        activeTool === 'pencil' &&
        (resolved.x !== lastHoverXRef.current ||
          resolved.y !== lastHoverYRef.current ||
          resolved.target !== lastHoverTargetRef.current)
      ) {
        lastHoverXRef.current = resolved.x;
        lastHoverYRef.current = resolved.y;
        lastHoverTargetRef.current = resolved.target;
        setHoveredPixel({ x: resolved.x, y: resolved.y, target: resolved.target });
      }

      if (!paintingRef.current) return;
      if (
        resolved.x === lastPaintedXRef.current &&
        resolved.y === lastPaintedYRef.current
      ) {
        return;
      }

      // Per M4 plan D4: no atlas-space Bresenham on 3D. Atlas-adjacent pixels
      // are not guaranteed 3D-adjacent (e.g., head-front and head-right rects
      // aren't next to each other on atlas despite sharing a 3D edge), so a
      // naive Bresenham would paint across arbitrary intervening pixels.
      // Per-frame sampling only; gaps on fast drags acceptable for M4.
      stampAt(resolved.x, resolved.y);
      lastPaintedXRef.current = resolved.x;
      lastPaintedYRef.current = resolved.y;
    },
    [activeTool, resolveHit, stampAt, setHoveredPixel],
  );

  const handlePointerUp = useCallback((e: ThreeEvent<PointerEvent>) => {
    if (!paintingRef.current) return;
    paintingRef.current = false;
    // Release the capture taken on pointerdown so the canvas element can
    // dispatch events normally again.
    (e.target as Element).releasePointerCapture?.(e.pointerId);
    if (textureManager !== undefined && layer !== undefined) {
      // Authoritative multi-layer composite at stroke end — mirrors
      // ViewportUV's M3 pattern (flushLayer fast path during stroke,
      // full composite at pointer-up).
      textureManager.composite([layer]);
      markDirty?.();
    }
  }, [textureManager, layer, markDirty]);

  const handlePointerOut = useCallback(() => {
    if (
      lastHoverXRef.current !== -1 ||
      lastHoverYRef.current !== -1 ||
      lastHoverTargetRef.current !== ''
    ) {
      lastHoverXRef.current = -1;
      lastHoverYRef.current = -1;
      lastHoverTargetRef.current = '';
      setHoveredPixel(null);
    }
  }, [setHoveredPixel]);

  // ── Animation loop (M2 useFrame — zero-alloc invariant preserved) ────────
  useFrame((state) => {
    const t = state.clock.elapsedTime;

    // Breathing: head Y oscillates around HEAD_BASE_Y.
    // Note: the idle 3° camera micro-orbit (M2) was removed when OrbitControls
    // landed — two agents writing to camera.position per frame caused the
    // camera to stutter and fight user drag input. Breathing preserved because
    // it only mutates a mesh, not the camera.
    const head = headRef.current;
    if (head !== null) {
      head.position.y = HEAD_BASE_Y + Math.sin(t * BREATHING_ANGULAR) * BREATHING_AMPLITUDE;
    }
  });

  return (
    <group>
      {PARTS.map((part) => {
        const isOverlay = part.endsWith('Overlay');
        const isHead = part === 'head';
        const [px, py, pz] = partPosition(variant, part);
        return (
          <mesh
            key={part}
            ref={isHead ? headRef : undefined}
            position={[px, py, pz]}
            geometry={geometries[part]}
            renderOrder={isOverlay ? 1 : 0}
            userData={{ part }}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            onPointerOut={handlePointerOut}
          >
            <meshStandardMaterial
              map={texture}
              transparent={isOverlay}
              alphaTest={isOverlay ? 0.01 : 0}
              depthWrite={!isOverlay}
            />
          </mesh>
        );
      })}
    </group>
  );
}

