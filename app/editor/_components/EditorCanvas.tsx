'use client';

import { Canvas } from '@react-three/fiber';
import { useEffect, useState } from 'react';
import { CanvasTexture, NearestFilter } from 'three';

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
 * Runs in useEffect (client-only) so the module does not reference `document`
 * during SSR / static prerender.
 */
function usePlaceholderTexture(variant: SkinVariant): CanvasTexture | null {
  const [texture, setTexture] = useState<CanvasTexture | null>(null);

  useEffect(() => {
    const dataURL = createPlaceholderSkinDataURL(variant);
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const tex = new CanvasTexture(canvas);
    tex.magFilter = NearestFilter;
    tex.minFilter = NearestFilter;
    tex.generateMipmaps = false;

    const img = new Image();
    img.src = dataURL;
    img.onload = () => {
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, 64, 64);
      ctx.drawImage(img, 0, 0);
      tex.needsUpdate = true;
    };

    setTexture(tex);
    return () => {
      tex.dispose();
    };
  }, [variant]);

  return texture;
}

export function EditorCanvas() {
  const [variant, setVariant] = useState<SkinVariant>('classic');
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

      <button
        type="button"
        onClick={() => setVariant((v) => (v === 'classic' ? 'slim' : 'classic'))}
        className="absolute right-4 top-4 rounded-md border border-ui-border bg-ui-surface px-4 py-2 font-mono text-sm text-text-primary hover:border-accent"
      >
        Variant: {variant}
      </button>
    </div>
  );
}
