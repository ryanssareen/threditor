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
 *
 * M4: threads textureManager + layer + markDirty + hydrationPending to
 * PlayerModel so the 3D surface is paintable via the same pipeline the
 * 2D surface uses. Sets `raycaster.firstHitOnly = true` once on Canvas
 * creation to prevent paint bleed-through on occluded body parts.
 */

import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { MOUSE, TOUCH, type Texture } from 'three';

import {
  CAMERA_FOV,
  CAMERA_LOOK_TARGET,
  CAMERA_POSITION,
} from '@/lib/three/constants';
import { PlayerModel } from '@/lib/three/PlayerModel';
import { CursorDecal } from './CursorDecal';
import type { Layer, SkinVariant } from '@/lib/editor/types';
import type { TextureManager } from '@/lib/editor/texture';

type Props = {
  texture: Texture | null;
  variant: SkinVariant;
  textureManager?: TextureManager;
  layer?: Layer;
  markDirty?: () => void;
  hydrationPending?: boolean;
};

export function EditorCanvas({
  texture,
  variant,
  textureManager,
  layer,
  markDirty,
  hydrationPending,
}: Props) {
  return (
    <div className="relative h-full w-full">
      <Canvas
        camera={{ position: [...CAMERA_POSITION], fov: CAMERA_FOV }}
        className="h-full w-full"
        // touch-action: none prevents mobile browsers from treating a
        // single-finger drag as page-scroll — that would hijack paint
        // pointer events. OrbitControls' touches.ONE=null also depends
        // on this to reach ONE-finger events at all.
        style={{ touchAction: 'none' }}
        onCreated={({ camera }) => {
          camera.lookAt(
            CAMERA_LOOK_TARGET[0],
            CAMERA_LOOK_TARGET[1],
            CAMERA_LOOK_TARGET[2],
          );
          // NOTE: previous code set `raycaster.firstHitOnly = true` claiming
          // this prevents paint bleed-through onto occluded body parts. That
          // flag is only honored by the `three-mesh-bvh` plugin (which we
          // don't use) — in vanilla three.js it's a no-op. The actual
          // occlusion defense is `e.stopPropagation()` in PlayerModel's
          // pointerdown AND pointermove handlers: on any ray that hits
          // multiple meshes (overlay in front of base), stopPropagation
          // terminates the dispatch loop at the first (nearest) mesh.
          // material.side = FrontSide (MeshStandardMaterial default) prevents
          // backface hits when the camera rotates behind a part.
        }}
      >
        <ambientLight intensity={0.4} />
        <directionalLight position={[3, 5, 2]} intensity={1.1} />
        {texture !== null ? (
          <PlayerModel
            texture={texture}
            variant={variant}
            textureManager={textureManager}
            layer={layer}
            markDirty={markDirty}
            hydrationPending={hydrationPending}
          />
        ) : null}
        <CursorDecal />
        {/*
          OrbitControls pulled forward from M8 polish.
          Gesture binding is CRITICAL here: M4 paints on left-click, so
          OrbitControls MUST NOT take left-click. Rebind:
            - LEFT  → null (reserved for paint pointer events on the mesh)
            - MIDDLE → DOLLY (wheel-click pan is not useful; keep as dolly)
            - RIGHT → ROTATE (right-click drag orbits the camera)
          Touch:
            - ONE finger → null (paint)
            - TWO fingers → DOLLY_ROTATE (pinch to zoom + drag to rotate)
          Other tuning:
            - enablePan: false (camera pan would fight the 2D canvas pan)
            - minDistance/maxDistance: keep model framed
            - min/max polar: no upside-down flip
            - damping: 0.05 responsive, no inertia drift
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
          mouseButtons={{
            LEFT: null as unknown as MOUSE,
            MIDDLE: MOUSE.DOLLY,
            RIGHT: MOUSE.ROTATE,
          }}
          touches={{
            ONE: null as unknown as TOUCH,
            TWO: TOUCH.DOLLY_ROTATE,
          }}
        />

      </Canvas>
    </div>
  );
}
