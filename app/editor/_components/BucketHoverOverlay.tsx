'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';

import { floodFill } from '@/lib/editor/flood-fill';
import { getIslandMap } from '@/lib/editor/island-map';
import { useEditorStore } from '@/lib/editor/store';
import type { Layer } from '@/lib/editor/types';
import { SKIN_ATLAS_SIZE } from '@/lib/three/constants';

const ATLAS = SKIN_ATLAS_SIZE; // 64
const TOTAL = ATLAS * ATLAS;   // 4096

type Props = {
  layer: Layer;
  zoom: number;
  pan: { x: number; y: number };
  hoverPixel: { x: number; y: number } | null;
};

export function BucketHoverOverlay({ layer, zoom, pan, hoverPixel }: Props) {
  const activeTool = useEditorStore((s) => s.activeTool);
  const variant = useEditorStore((s) => s.variant);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [mask, setMask] = useState<Uint8Array | null>(null);

  // rAF debounce: track the pending frame handle and the last pixel we computed
  // a fill for so we skip identical positions.
  const rafRef = useRef<number | null>(null);
  const lastPixelRef = useRef<{ x: number; y: number } | null>(null);

  const computeMask = useCallback(
    (px: { x: number; y: number }) => {
      const islandMap = getIslandMap(variant);
      const next = floodFill(layer.pixels, islandMap, px.x, px.y);
      setMask(next);
    },
    [layer.pixels, variant],
  );

  useEffect(() => {
    if (activeTool !== 'bucket' || hoverPixel === null) {
      setMask(null);
      lastPixelRef.current = null;
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      return;
    }

    const { x, y } = hoverPixel;
    const last = lastPixelRef.current;

    // Skip if we already computed for this exact pixel.
    if (last !== null && last.x === x && last.y === y) return;

    // Cancel any pending frame before scheduling a new one.
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
    }

    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      lastPixelRef.current = { x, y };
      computeMask({ x, y });
    });

    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [activeTool, hoverPixel, computeMask]);

  // Paint the mask onto the canvas whenever it changes.
  useEffect(() => {
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, ATLAS, ATLAS);
    if (!mask) return;
    const imageData = ctx.createImageData(ATLAS, ATLAS);
    for (let i = 0; i < TOTAL; i++) {
      if (mask[i] === 1) {
        const off = i * 4;
        imageData.data[off]     = 255; // R
        imageData.data[off + 1] = 255; // G
        imageData.data[off + 2] = 255; // B
        imageData.data[off + 3] = 51;  // 20% of 255
      }
    }
    ctx.putImageData(imageData, 0, 0);
  }, [mask]);

  if (activeTool !== 'bucket' || hoverPixel === null) return null;

  const size = ATLAS * zoom;

  return (
    <canvas
      ref={canvasRef}
      width={ATLAS}
      height={ATLAS}
      style={{
        position: 'absolute',
        left: pan.x,
        top: pan.y,
        width: size,
        height: size,
        imageRendering: 'pixelated',
        pointerEvents: 'none',
      }}
    />
  );
}
