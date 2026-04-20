'use client';

/**
 * M4 Unit 5: 3D paint cursor + BASE/OVERLAY micro-affordance.
 *
 * Billboarded square decal (white with 2px black border) that snaps to the
 * texel center of the `hoveredPixel` store slot. A small "BASE" / "OVERLAY"
 * label floats next to the decal to make the overlay/base precedence visible
 * without requiring a layer panel (M6).
 *
 * RENDER BOUNDARY
 *   Returns null when:
 *     - hoveredPixel is null (no hover)
 *     - activeTool !== 'pencil' (M4 only paints with pencil; M5 will expand)
 *     - atlasToWorld can't resolve the pixel to a face (shouldn't happen for
 *       a valid hover produced by PlayerModel; defensive guard)
 *
 * GPU RESOURCE DISPOSAL
 *   The white-with-black-border CanvasTexture is built once at mount via
 *   useMemo and disposed in the useEffect cleanup, per the M2 COMPOUND
 *   caller-owned disposal invariant (see
 *   docs/solutions/performance-issues/r3f-geometry-prop-disposal-2026-04-18.md).
 *
 * Z-FIGHTING PREVENTION
 *   Decal is offset along the face normal by a small epsilon; decal material
 *   uses depthTest={false} + renderOrder={2} so it always draws on top of
 *   the overlay mesh (renderOrder=1) and base mesh (renderOrder=0). Per plan
 *   D6 and the R3F cursor-decal gotcha noted in the pre-flag.
 */

import { Billboard, Html } from '@react-three/drei';
import { useEffect, useMemo } from 'react';
import { CanvasTexture, NearestFilter } from 'three';

import { CURSOR_DECAL_SIZE } from '@/lib/three/constants';
import { atlasToWorld } from '@/lib/three/atlas-to-world';
import { useEditorStore } from '@/lib/editor/store';

/**
 * Build the white-with-black-border cursor texture. 16×16 px — large enough
 * for the border not to alias, small enough to stay trivial. NearestFilter
 * keeps the edges crisp at any zoom.
 */
function buildCursorTexture(): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 16;
  canvas.height = 16;
  const ctx = canvas.getContext('2d');
  if (ctx === null) {
    throw new Error('CursorDecal: 2D context unavailable');
  }
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, 16, 16);
  ctx.fillStyle = '#000000';
  // 2-pixel black border on all four sides.
  ctx.fillRect(0, 0, 16, 2);
  ctx.fillRect(0, 14, 16, 2);
  ctx.fillRect(0, 0, 2, 16);
  ctx.fillRect(14, 0, 2, 16);
  const tex = new CanvasTexture(canvas);
  tex.magFilter = NearestFilter;
  tex.minFilter = NearestFilter;
  tex.generateMipmaps = false;
  return tex;
}

export function CursorDecal(): React.ReactElement | null {
  const hoveredPixel = useEditorStore((s) => s.hoveredPixel);
  const variant = useEditorStore((s) => s.variant);
  const activeTool = useEditorStore((s) => s.activeTool);

  // GPU-side texture — built once per component lifecycle, disposed on
  // unmount. useMemo is safe here because CursorDecal lives inside
  // <Canvas> which is a 'use client' boundary (no SSR prerender touches
  // document.createElement).
  const cursorTexture = useMemo(() => buildCursorTexture(), []);
  useEffect(() => {
    return () => {
      cursorTexture.dispose();
    };
  }, [cursorTexture]);

  if (hoveredPixel === null || activeTool !== 'pencil') return null;

  const hit = atlasToWorld(variant, hoveredPixel.x, hoveredPixel.y);
  if (hit === null) return null;

  // Offset along the face normal to prevent z-fighting with the overlay
  // mesh at the same world position.
  const eps = 0.002;
  const position: [number, number, number] = [
    hit.position[0] + hit.normal[0] * eps,
    hit.position[1] + hit.normal[1] * eps,
    hit.position[2] + hit.normal[2] * eps,
  ];

  return (
    <Billboard position={position}>
      <mesh renderOrder={2}>
        <planeGeometry args={[CURSOR_DECAL_SIZE, CURSOR_DECAL_SIZE]} />
        <meshBasicMaterial
          map={cursorTexture}
          transparent={true}
          depthTest={false}
        />
      </mesh>
      {/* BASE/OVERLAY label — float just above-right of the decal. */}
      <Html
        center
        occlude={false}
        zIndexRange={[100, 0]}
        position={[CURSOR_DECAL_SIZE * 1.1, CURSOR_DECAL_SIZE * 1.1, 0]}
        style={{
          fontSize: '9px',
          fontFamily: 'ui-monospace, monospace',
          fontWeight: 600,
          letterSpacing: '0.05em',
          color: '#ffffff',
          background: 'rgba(0, 0, 0, 0.75)',
          padding: '1px 4px',
          borderRadius: '2px',
          pointerEvents: 'none',
          userSelect: 'none',
          whiteSpace: 'nowrap',
        }}
      >
        {hoveredPixel.target.toUpperCase()}
      </Html>
    </Billboard>
  );
}
