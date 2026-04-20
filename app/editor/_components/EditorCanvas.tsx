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
import { OrbitControls } from '@react-three/drei';
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
        {/*
          OrbitControls: originally scoped to M8 polish but pulled forward
          because the static 3° idle orbit doesn't let users inspect the
          model from arbitrary angles. Configured to match the camera
          framing so rotation pivots around the look target.
          - enablePan: false (camera pan would fight the 2D canvas's pan)
          - enableZoom: true (wheel zoom; acceptable since no 3D paint in M3)
          - min/max polar: clamp so user can't flip the model upside down
          - damping: feels responsive at 0.05 without inertia drift
        */}
        <OrbitControls
          target={[
            CAMERA_LOOK_TARGET[0],
            CAMERA_LOOK_TARGET[1],
            CAMERA_LOOK_TARGET[2],
          ]}
          enablePan={false}
          enableZoom={true}
          minDistance={2.5}
          maxDistance={8}
          minPolarAngle={Math.PI / 6}
          maxPolarAngle={Math.PI - Math.PI / 6}
          enableDamping
          dampingFactor={0.05}
        />
      </Canvas>
    </div>
  );
}
