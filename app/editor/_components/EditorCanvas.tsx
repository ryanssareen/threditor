'use client';

/**
 * M3: 3D viewport. Pure consumer — receives the texture + variant from
 * its parent (`EditorLayout`) and renders `PlayerModel` with them.
 *
 * Ownership note: M2 had EditorCanvas own its own `useState<SkinVariant>`
 * and `usePlaceholderTexture` hook. M3 hoists both up to EditorLayout so
 * the 2D paint surface (`ViewportUV`) and this 3D surface share the same
 * TextureManager — pencil strokes paint once, appear everywhere. See the
 * `useTextureManagerBundle` hook in `lib/editor/use-texture-manager.ts`.
 */

import { Canvas } from '@react-three/fiber';
import { type Texture } from 'three';

import {
  CAMERA_FOV,
  CAMERA_LOOK_TARGET,
  CAMERA_POSITION,
} from '@/lib/three/constants';
import { PlayerModel } from '@/lib/three/PlayerModel';
import type { SkinVariant } from '@/lib/editor/types';

type Props = {
  texture: Texture | null;
  variant: SkinVariant;
};

export function EditorCanvas({ texture, variant }: Props) {
  return (
    <div className="relative h-full w-full">
      <Canvas
        camera={{ position: [...CAMERA_POSITION], fov: CAMERA_FOV }}
        className="h-full w-full"
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
        {texture !== null ? (
          <PlayerModel texture={texture} variant={variant} />
        ) : null}
      </Canvas>
    </div>
  );
}
