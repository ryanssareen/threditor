'use client';

import { useEffect, useRef } from 'react';

import { useEditorStore } from '@/lib/editor/store';
import { SKIN_ATLAS_SIZE } from '@/lib/three/constants';

const ATLAS = SKIN_ATLAS_SIZE; // 64

type Props = {
  zoom: number;
  pan: { x: number; y: number };
};

export function PencilHoverOverlay({ zoom, pan }: Props) {
  const activeTool = useEditorStore((s) => s.activeTool);
  const hoveredPixel = useEditorStore((s) => s.hoveredPixel);

  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, ATLAS, ATLAS);
    if (activeTool !== 'pencil' || hoveredPixel === null) return;
    const { x, y } = hoveredPixel;
    // Fill: 18% additive white tint
    ctx.fillStyle = 'rgba(255, 255, 255, 0.18)';
    ctx.fillRect(x, y, 1, 1);
    // Border: 1px bright white stroke
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.lineWidth = 1 / ATLAS;
    ctx.strokeRect(x, y, 1, 1);
  }, [activeTool, hoveredPixel]);

  if (activeTool !== 'pencil' || hoveredPixel === null) return null;

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
