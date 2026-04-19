'use client';

import { Canvas } from '@react-three/fiber';
import { useEffect, useState } from 'react';
import { type Texture } from 'three';

import { TextureManager } from '@/lib/editor/texture';
import { useEditorStore } from '@/lib/editor/store';
import type { Layer, SkinVariant } from '@/lib/editor/types';
import {
  CAMERA_FOV,
  CAMERA_LOOK_TARGET,
  CAMERA_POSITION,
} from '@/lib/three/constants';
import { PlayerModel } from '@/lib/three/PlayerModel';
import { createPlaceholderSkinPixels } from '@/lib/three/placeholder-skin';

/**
 * Build the initial M3 document as a single "base" layer whose pixels are
 * the placeholder skin for the given variant. M6 will grow this into a
 * multi-layer document with an `activeLayerId` and a Zustand-held layer
 * stack; for M3 the single-layer case lives inside EditorCanvas.
 */
function buildInitialLayer(variant: SkinVariant): Layer {
  return {
    id: 'base',
    name: 'Base',
    visible: true,
    opacity: 1,
    blendMode: 'normal',
    pixels: createPlaceholderSkinPixels(variant),
  };
}

/**
 * Own a TextureManager + a single M3 Layer for the given variant. Rebuilds
 * both on variant change and disposes the old TextureManager per the M2
 * caller-owned GPU resource contract (docs/solutions/performance-issues/
 * r3f-geometry-prop-disposal-2026-04-18.md).
 *
 * Returns the three.js Texture that PlayerModel consumes. M4 extends this
 * by exposing the TextureManager instance itself to ViewportUV so pencil
 * stamps can write through TextureManager.getContext() + markDirty().
 */
function useTextureManager(variant: SkinVariant): Texture | null {
  const [texture, setTexture] = useState<Texture | null>(null);

  useEffect(() => {
    const tm = new TextureManager();
    const layer = buildInitialLayer(variant);
    tm.composite([layer]);
    setTexture(tm.getTexture());
    return () => {
      tm.dispose();
    };
  }, [variant]);

  return texture;
}

export function EditorCanvas() {
  // Narrow selector — EditorCanvas only re-renders when `variant` changes.
  // See lib/editor/store.ts design notes (2).
  const variant = useEditorStore((state) => state.variant);
  const texture = useTextureManager(variant);

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
        Variant toggle moved out of EditorCanvas in M3 Step 3 and is
        re-surfaced by the Sidebar in Step 10. During the step-3..step-10
        window, flip via `useEditorStore.setState({ variant: 'slim' })`
        in devtools if you need to visually test both arm widths.
      */}
    </div>
  );
}
