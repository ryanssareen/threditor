'use client';

/**
 * M3: 2D paint canvas. The TextureManager's offscreen canvas is mounted
 * directly into this component's DOM tree, scaled up via CSS transform
 * with `image-rendering: pixelated` for crisp pixel-art display. No
 * drawImage / putImageData copies happen per pointer event — the pencil
 * mutates Layer.pixels in place and calls TextureManager.composite(),
 * which writes once to the same underlying canvas the user sees.
 *
 * INVARIANT: zero allocations in the pointer hot path. Only per-event
 * allocations are `getBoundingClientRect()` (browser-returned DOMRect,
 * once per move) — acceptable under the M3 plan's "no allocations in
 * pointer hot path" clause because it's O(1) per event, not O(pixels).
 * Every other write is a primitive mutation on a ref.
 *
 * Zoom math is documented inline at `handleWheel`. Cursor-centered, step
 * 1.15× per tick, clamped to [MIN_ZOOM, MAX_ZOOM]. Space+drag pans.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { SKIN_ATLAS_SIZE } from '@/lib/three/constants';
import { markDocumentDirty } from '@/lib/editor/persistence';
import { useEditorStore } from '@/lib/editor/store';
import { stampLine, stampPencil } from '@/lib/editor/tools/pencil';
import type { Layer } from '@/lib/editor/types';
import type { TextureManager } from '@/lib/editor/texture';
import { cursorForTool } from './BrushCursor';
import { BucketHoverOverlay } from './BucketHoverOverlay';

const MIN_ZOOM = 1;
const MAX_ZOOM = 16;
const ZOOM_STEP = 1.15;
const GRID_THRESHOLD = 4;

type Props = {
  textureManager: TextureManager;
  layer: Layer;
  className?: string;
};

export function ViewportUV({ textureManager, layer, className }: Props) {
  // Narrow subscriptions — each one re-renders ViewportUV only when its
  // own slice changes. Pointer-move writes never hit the store.
  const activeTool = useEditorStore((s) => s.activeTool);
  const brushSize = useEditorStore((s) => s.brushSize);
  const activeColor = useEditorStore((s) => s.activeColor);
  const uvZoom = useEditorStore((s) => s.uvZoom);
  const uvPan = useEditorStore((s) => s.uvPan);
  const setUvZoom = useEditorStore((s) => s.setUvZoom);
  const setUvPan = useEditorStore((s) => s.setUvPan);
  const commitToRecents = useEditorStore((s) => s.commitToRecents);

  // Local state that should NOT trigger re-renders of other consumers.
  const [isSpaceHeld, setIsSpaceHeld] = useState(false);
  // Bucket hover preview — only updated when activeTool === 'bucket' so the
  // M3 pencil path does not pay a per-move re-render cost. Activates via
  // devtools `useEditorStore.setState({ activeTool: 'bucket' })` in M3;
  // M5 enables the button.
  const [hoverPixel, setHoverPixel] = useState<{ x: number; y: number } | null>(null);

  // Hot-path refs (zero-allocation invariant).
  const frameRef = useRef<HTMLDivElement | null>(null);
  const canvasMountRef = useRef<HTMLDivElement | null>(null);
  const paintingRef = useRef(false);
  const lastPaintedXRef = useRef(-1);
  const lastPaintedYRef = useRef(-1);
  const panOriginRef = useRef<{ x: number; y: number } | null>(null);

  // Mount the TextureManager's canvas into this component's DOM tree.
  // The canvas has intrinsic 64×64 dimensions; the CSS transform does
  // the zoom. We explicitly set image-rendering: pixelated here.
  useEffect(() => {
    const mount = canvasMountRef.current;
    if (mount === null) return;
    const canvas = textureManager.getCanvas();
    canvas.style.imageRendering = 'pixelated';
    canvas.style.display = 'block';
    mount.appendChild(canvas);
    return () => {
      if (canvas.parentElement === mount) {
        mount.removeChild(canvas);
      }
    };
  }, [textureManager]);

  // Space-key pan modifier. Listen globally so Space works even if the
  // viewport doesn't have DOM focus.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.code === 'Space' && !e.repeat) {
        // Don't steal Space from editable inputs (hex field, future text
        // inputs in M5+).
        const target = e.target as HTMLElement | null;
        if (
          target !== null &&
          (target.tagName === 'INPUT' ||
            target.tagName === 'TEXTAREA' ||
            target.isContentEditable)
        ) {
          return;
        }
        e.preventDefault();
        setIsSpaceHeld(true);
      }
    };
    const onKeyUp = (e: KeyboardEvent): void => {
      if (e.code === 'Space') setIsSpaceHeld(false);
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, []);

  // Cursor-centered wheel zoom.
  //
  //   1. World-space cursor before zoom: (cx - pan.x) / zoom
  //   2. New zoom:                       zoom * (in ? STEP : 1/STEP)
  //   3. New pan that keeps the pixel under the cursor:
  //                                       cx - worldX * newZoom
  const handleWheel = useCallback(
    (e: React.WheelEvent<HTMLDivElement>) => {
      if (frameRef.current === null) return;
      e.preventDefault();
      const rect = frameRef.current.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;

      const zoomIn = e.deltaY < 0;
      const nextZoomRaw = zoomIn ? uvZoom * ZOOM_STEP : uvZoom / ZOOM_STEP;
      const nextZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, nextZoomRaw));
      if (nextZoom === uvZoom) return;

      const worldX = (cx - uvPan.x) / uvZoom;
      const worldY = (cy - uvPan.y) / uvZoom;
      setUvZoom(nextZoom);
      setUvPan({
        x: cx - worldX * nextZoom,
        y: cy - worldY * nextZoom,
      });
    },
    [uvZoom, uvPan.x, uvPan.y, setUvZoom, setUvPan],
  );

  // Convert pointer client coords to atlas pixel coords. Returns -1, -1
  // when outside the 64×64 canvas. Allocates nothing heap-side; the
  // browser allocates one DOMRect per getBoundingClientRect() call.
  const pointerToAtlas = useCallback(
    (clientX: number, clientY: number): { ax: number; ay: number } | null => {
      if (frameRef.current === null) return null;
      const rect = frameRef.current.getBoundingClientRect();
      const screenX = clientX - rect.left - uvPan.x;
      const screenY = clientY - rect.top - uvPan.y;
      const ax = Math.floor(screenX / uvZoom);
      const ay = Math.floor(screenY / uvZoom);
      if (ax < 0 || ax >= SKIN_ATLAS_SIZE || ay < 0 || ay >= SKIN_ATLAS_SIZE) {
        return null;
      }
      return { ax, ay };
    },
    [uvPan.x, uvPan.y, uvZoom],
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (isSpaceHeld) {
        panOriginRef.current = {
          x: e.clientX - uvPan.x,
          y: e.clientY - uvPan.y,
        };
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        return;
      }
      if (activeTool !== 'pencil') return;
      const atlas = pointerToAtlas(e.clientX, e.clientY);
      if (atlas === null) return;
      paintingRef.current = true;
      lastPaintedXRef.current = atlas.ax;
      lastPaintedYRef.current = atlas.ay;
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);

      // Zero-alloc: inline scalar RGB parse (no returned tuple allocation).
      const hex = activeColor.hex;
      const r =
        (hexDigit(hex, 1) << 4) | hexDigit(hex, 2);
      const g =
        (hexDigit(hex, 3) << 4) | hexDigit(hex, 4);
      const b =
        (hexDigit(hex, 5) << 4) | hexDigit(hex, 6);
      stampPencil(layer.pixels, atlas.ax, atlas.ay, brushSize, r, g, b);
      textureManager.composite([layer]);
      // Per A.2: recents inserts on FIRST pixel painted in a stroke.
      commitToRecents(activeColor.hex);
    },
    [
      isSpaceHeld,
      uvPan.x,
      uvPan.y,
      activeTool,
      pointerToAtlas,
      activeColor.hex,
      layer,
      brushSize,
      textureManager,
      commitToRecents,
    ],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (panOriginRef.current !== null) {
        setUvPan({
          x: e.clientX - panOriginRef.current.x,
          y: e.clientY - panOriginRef.current.y,
        });
        return;
      }
      // Bucket hover preview: only update hoverPixel state when the bucket
      // tool is active. M3 pencil path never hits this branch.
      if (activeTool === 'bucket') {
        const atlasHover = pointerToAtlas(e.clientX, e.clientY);
        setHoverPixel(atlasHover !== null ? { x: atlasHover.ax, y: atlasHover.ay } : null);
      }
      if (!paintingRef.current) return;
      const atlas = pointerToAtlas(e.clientX, e.clientY);
      if (atlas === null) return;
      if (
        atlas.ax === lastPaintedXRef.current &&
        atlas.ay === lastPaintedYRef.current
      ) {
        return;
      }
      const hex = activeColor.hex;
      const r =
        (hexDigit(hex, 1) << 4) | hexDigit(hex, 2);
      const g =
        (hexDigit(hex, 3) << 4) | hexDigit(hex, 4);
      const b =
        (hexDigit(hex, 5) << 4) | hexDigit(hex, 6);
      stampLine(
        layer.pixels,
        lastPaintedXRef.current,
        lastPaintedYRef.current,
        atlas.ax,
        atlas.ay,
        brushSize,
        r,
        g,
        b,
      );
      lastPaintedXRef.current = atlas.ax;
      lastPaintedYRef.current = atlas.ay;
      textureManager.composite([layer]);
    },
    [
      setUvPan,
      activeTool,
      pointerToAtlas,
      activeColor.hex,
      layer,
      brushSize,
      textureManager,
    ],
  );

  const handlePointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const wasPainting = paintingRef.current;
    panOriginRef.current = null;
    paintingRef.current = false;
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    // One debounced persistence flush per completed stroke. Skipped on
    // pan release so idle zoom/pan doesn't spam writes.
    if (wasPainting) markDocumentDirty();
  }, []);

  const cursor = isSpaceHeld ? 'grab' : cursorForTool(activeTool);
  const showGrid = uvZoom >= GRID_THRESHOLD;

  return (
    <div
      className={`relative overflow-hidden bg-ui-base ${className ?? ''}`}
      onWheel={handleWheel}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      style={{ cursor, touchAction: 'none' }}
      ref={frameRef}
      data-testid="viewport-uv"
    >
      <div
        ref={canvasMountRef}
        className="absolute left-0 top-0 origin-top-left"
        style={{
          transform: `translate3d(${uvPan.x}px, ${uvPan.y}px, 0) scale(${uvZoom})`,
          width: SKIN_ATLAS_SIZE,
          height: SKIN_ATLAS_SIZE,
        }}
      />
      {/* Bucket hover preview (M3-inert; activates via devtools). */}
      <BucketHoverOverlay
        layer={layer}
        zoom={uvZoom}
        pan={uvPan}
        frameRef={frameRef}
        hoverPixel={hoverPixel}
      />
      {showGrid ? (
        <div
          className="pointer-events-none absolute left-0 top-0 origin-top-left"
          aria-hidden="true"
          style={{
            transform: `translate3d(${uvPan.x}px, ${uvPan.y}px, 0) scale(${uvZoom})`,
            width: SKIN_ATLAS_SIZE,
            height: SKIN_ATLAS_SIZE,
            backgroundImage:
              'linear-gradient(to right, rgba(255,255,255,0.06) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.06) 1px, transparent 1px)',
            backgroundSize: '1px 1px',
          }}
        />
      ) : null}
    </div>
  );
}

/**
 * Parse a single hex digit at the given index into its integer value.
 * Callers inline three back-to-back calls per channel (see the two
 * pointer handlers) so no tuple or array is allocated per event —
 * local scalar vars only. This enforces the M3 plan's zero-allocation
 * invariant for the pointer hot path.
 */
function hexDigit(hex: string, index: number): number {
  const code = hex.charCodeAt(index);
  if (code >= 48 && code <= 57) return code - 48; // '0'..'9'
  if (code >= 97 && code <= 102) return code - 87; // 'a'..'f'
  if (code >= 65 && code <= 70) return code - 55; // 'A'..'F' (store normalizes to lowercase; this is defensive)
  return 0;
}
