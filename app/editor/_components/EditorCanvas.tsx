'use client';

import { Canvas } from '@react-three/fiber';
import { useEffect, useState } from 'react';
import { CanvasTexture, NearestFilter } from 'three';

import { useEditorStore } from '@/lib/editor/store';
import {
  CAMERA_FOV,
  CAMERA_LOOK_TARGET,
  CAMERA_POSITION,
} from '@/lib/three/constants';
import { PlayerModel } from '@/lib/three/PlayerModel';
import { type SkinVariant } from '@/lib/three/geometry';
import { createPlaceholderSkinDataURL } from '@/lib/three/placeholder-skin';

/**
 * Build a nearest-filtered CanvasTexture from a placeholder data URL.
 *
 * Runs in useEffect (client-only) so the module does not reference `document`
 * during SSR / static prerender.
 *
 * Cancellation: on variant change, the effect cleanup sets `cancelled = true`,
 * nulls out the Image handlers, and disposes the old texture. Any still-pending
 * `img.onload` exits early before it can touch disposed GPU state — protects
 * against rapid Classic↔Slim toggling where the new effect runs before the
 * previous Image has decoded.
 *
 * NOTE: M3 Step 4 replaces this with `TextureManager` (lib/editor/texture.ts).
 * This hook stays intact through the step-3 commit so variant hoisting can
 * land independently of the texture-manager introduction.
 */
function usePlaceholderTexture(variant: SkinVariant): CanvasTexture | null {
  const [texture, setTexture] = useState<CanvasTexture | null>(null);

  useEffect(() => {
    let cancelled = false;
    const dataURL = createPlaceholderSkinDataURL(variant);
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const tex = new CanvasTexture(canvas);
    tex.magFilter = NearestFilter;
    tex.minFilter = NearestFilter;
    tex.generateMipmaps = false;

    const img = new Image();
    img.onload = () => {
      if (cancelled) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, 64, 64);
      ctx.drawImage(img, 0, 0);
      tex.needsUpdate = true;
    };
    img.onerror = () => {
      if (cancelled) return;
      // Placeholder skin should never fail to decode (data URL built from
      // Canvas.toDataURL in-process), but surface it if it ever does.
      console.error('placeholder-skin: image failed to load for variant', variant);
    };
    img.src = dataURL;

    setTexture(tex);
    return () => {
      cancelled = true;
      img.onload = null;
      img.onerror = null;
      tex.dispose();
    };
  }, [variant]);

  return texture;
}

export function EditorCanvas() {
  // Narrow selector — EditorCanvas only re-renders when `variant` changes.
  // Do NOT broaden to `useEditorStore(state => state)` — see store.ts design
  // notes (2) for the re-render contract M3 Step 11's regression test pins.
  const variant = useEditorStore((state) => state.variant);
  const texture = usePlaceholderTexture(variant);

  return (
    <div className="relative h-dvh w-dvw">
      <Canvas
        camera={{ position: [...CAMERA_POSITION], fov: CAMERA_FOV }}
        className="h-dvh w-dvw"
        onCreated={({ camera }) => {
          camera.lookAt(
            CAMERA_LOOK_TARGET[0],
            CAMERA_LOOK_TARGET[1],
            CAMERA_LOOK_TARGET[2],
          );
        }}
      >
        <ambientLight intensity={0.4} />
        <directionalLight position={[3, 5, 2]} intensity={1.1} />
        {texture !== null && <PlayerModel texture={texture} variant={variant} />}
      </Canvas>

      {/*
        The variant toggle button moved out of EditorCanvas in M3 Step 3.
        M3 Step 10's Sidebar re-surfaces it alongside the color picker and
        toolbar. During the step-3..step-10 window, flip `variant` via
        `useEditorStore.setState({ variant: 'slim' })` in devtools if you
        need to visually test both arm widths.
      */}
    </div>
  );
}
