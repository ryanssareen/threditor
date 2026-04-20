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

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import { SKIN_ATLAS_SIZE } from '@/lib/three/constants';
import { hexDigit } from '@/lib/color/hex-digit';
import { useEditorStore } from '@/lib/editor/store';
import { getIslandMap, islandIdAt, isOverlayIsland } from '@/lib/editor/island-map';
import { stampLine, stampPencil } from '@/lib/editor/tools/pencil';
import type { Layer } from '@/lib/editor/types';
import type { TextureManager } from '@/lib/editor/texture';
import { cursorForTool } from './BrushCursor';
import { BucketHoverOverlay } from './BucketHoverOverlay';
import { PencilHoverOverlay } from './PencilHoverOverlay';

const MIN_ZOOM = 1;
const MAX_ZOOM = 16;
const ZOOM_STEP = 1.15;
const GRID_THRESHOLD = 4;

type Props = {
  textureManager: TextureManager;
  layer: Layer;
  markDirty: () => void;
  /**
   * M4 Unit 0 gate: when true, pointer events early-return. Prevents the
   * race where a user's fresh strokes get clobbered by the hydrate path's
   * `bundle.layer.pixels.set(saved.pixels)`. EditorLayout owns this flag.
   */
  hydrationPending?: boolean;
  className?: string;
};

export function ViewportUV({ textureManager, layer, markDirty, hydrationPending = false, className }: Props) {
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
  const setHoveredPixel = useEditorStore((s) => s.setHoveredPixel);
  const variant = useEditorStore((s) => s.variant);

  // Local state that should NOT trigger re-renders of other consumers.
  const [isSpaceHeld, setIsSpaceHeld] = useState(false);

  // Hot-path refs (zero-allocation invariant).
  const frameRef = useRef<HTMLDivElement | null>(null);
  const canvasMountRef = useRef<HTMLDivElement | null>(null);
  const paintingRef = useRef(false);
  const lastPaintedXRef = useRef(-1);
  const lastPaintedYRef = useRef(-1);
  const panOriginRef = useRef<{ x: number; y: number } | null>(null);

  // Hover dedup refs — mirror PlayerModel's pattern so store only fires
  // when the resolved pixel actually changes.
  const lastHoverXRef = useRef(-1);
  const lastHoverYRef = useRef(-1);
  const lastHoverTargetRef = useRef<'base' | 'overlay' | ''>('');

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

  // Auto-fit + center the 64×64 atlas inside the viewport on initial layout.
  // Without this, the canvas sits at the top-left at intrinsic 64px size and
  // is effectively invisible on a ~600px wide column — the user can't see
  // or click it. Runs once per mount; user's subsequent zoom/pan is preserved.
  // ResizeObserver is used because flex-layout dimensions may not be final
  // on the first layout pass (clientWidth can read 0).
  const didAutoFitRef = useRef(false);
  useLayoutEffect(() => {
    const frame = frameRef.current;
    if (frame === null) return;

    const fit = (): boolean => {
      if (didAutoFitRef.current) return true;
      const w = frame.clientWidth;
      const h = frame.clientHeight;
      if (w === 0 || h === 0) return false;
      // Fit the atlas to ~90% of the smaller dimension, integer-zoom-stepped
      // so pixel edges stay crisp (image-rendering: pixelated).
      const fitZoom = Math.max(
        MIN_ZOOM,
        Math.min(MAX_ZOOM, Math.floor((Math.min(w, h) * 0.9) / SKIN_ATLAS_SIZE)),
      );
      const scaled = SKIN_ATLAS_SIZE * fitZoom;
      setUvZoom(fitZoom);
      setUvPan({ x: (w - scaled) / 2, y: (h - scaled) / 2 });
      didAutoFitRef.current = true;
      return true;
    };

    if (fit()) return;

    // Layout not settled yet — watch for the first non-zero size.
    const obs = new ResizeObserver(() => {
      if (fit()) obs.disconnect();
    });
    obs.observe(frame);
    return () => obs.disconnect();
  }, [setUvZoom, setUvPan]);

  // M4 Unit 0 (P1 from M3 review): if the bundle (textureManager or layer)
  // changes mid-stroke — typically via variant toggle mid-paint — reset
  // painting state so the next pointermove does not stamp a Bresenham line
  // across the new, blank canvas from the stale atlas coords. The state is
  // component-local; variant toggle replaces the TextureManager prop which
  // fires this cleanup.
  useEffect(() => {
    paintingRef.current = false;
    panOriginRef.current = null;
    lastPaintedXRef.current = -1;
    lastPaintedYRef.current = -1;
    lastHoverXRef.current = -1;
    lastHoverYRef.current = -1;
    lastHoverTargetRef.current = '';
    setHoveredPixel(null);
  }, [textureManager, layer, setHoveredPixel]);

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

  // Clear hover when tool is switched away from both hoverable tools so any
  // lingering 2D tint doesn't persist during an eraser/picker interaction.
  useEffect(() => {
    if (activeTool !== 'pencil' && activeTool !== 'bucket') {
      setHoveredPixel(null);
      lastHoverXRef.current = -1;
      lastHoverYRef.current = -1;
      lastHoverTargetRef.current = '';
    }
  }, [activeTool, setHoveredPixel]);

  // Clear hover on unmount so a lingering store value doesn't confuse
  // any consumer after the 2D viewport is removed from the DOM.
  useEffect(() => {
    return () => {
      setHoveredPixel(null);
    };
  }, [setHoveredPixel]);

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
      // Primary-button-only paint. Right-click opens the browser context
      // menu on this div anyway, but without this guard, the button release
      // races the context menu and a stray pixel gets committed in between.
      // Also blocks middle-click-drag from painting.
      if (e.button !== 0) return;

      // M4 Unit 0: paint events are inert while the document is still
      // hydrating from IDB. Pan (space+drag) is NOT gated — user may
      // explore the empty canvas while we wait.
      if (hydrationPending && !isSpaceHeld) return;
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
      textureManager.flushLayer(layer);
      // Per A.2: recents inserts on FIRST pixel painted in a stroke.
      commitToRecents(activeColor.hex);
    },
    [
      hydrationPending,
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
      // Hover store write: emit for both pencil and bucket, dedup'd via refs.
      if (activeTool === 'pencil' || activeTool === 'bucket') {
        const atlasHover = pointerToAtlas(e.clientX, e.clientY);
        if (atlasHover !== null) {
          const { ax, ay } = atlasHover;
          const islandMap = getIslandMap(variant);
          const id = islandIdAt(islandMap, ax, ay);
          const target: 'base' | 'overlay' = isOverlayIsland(id) ? 'overlay' : 'base';
          if (
            ax !== lastHoverXRef.current ||
            ay !== lastHoverYRef.current ||
            target !== lastHoverTargetRef.current
          ) {
            lastHoverXRef.current = ax;
            lastHoverYRef.current = ay;
            lastHoverTargetRef.current = target;
            setHoveredPixel({ x: ax, y: ay, target });
          }
        } else {
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
        }
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
      textureManager.flushLayer(layer);
    },
    [
      setUvPan,
      activeTool,
      pointerToAtlas,
      activeColor.hex,
      layer,
      brushSize,
      textureManager,
      variant,
      setHoveredPixel,
    ],
  );

  const handlePointerLeave = useCallback(() => {
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

  const handlePointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const wasPainting = paintingRef.current;
    panOriginRef.current = null;
    paintingRef.current = false;
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    if (wasPainting) {
      // Authoritative multi-layer composite at stroke end. During the stroke
      // flushLayer() keeps the canvas up to date with zero per-move allocs.
      textureManager.composite([layer]);
      markDirty();
    }
  }, [textureManager, layer, markDirty]);

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
      onPointerLeave={handlePointerLeave}
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
      />
      {/* Pencil single-pixel hover tint (2D counterpart to CursorDecal). */}
      <PencilHoverOverlay zoom={uvZoom} pan={uvPan} />
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

