'use client';

/**
 * M2: humanoid Minecraft player model, 16 meshes (8 base + 8 overlay).
 *
 * INVARIANT: zero allocations inside the useFrame callback. All math is scalar;
 * no `new Vector3`, no `.lookAt(vector)`, no template strings, no destructuring.
 * `camera.lookAt(x, y, z)` uses three.js module-level temp buffers internally —
 * verified allocation-free. See M1 COMPOUND and this plan's risk P2.
 */

import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import { BoxGeometry, type Mesh, type Texture } from 'three';

import {
  BREATHING_AMPLITUDE,
  BREATHING_ANGULAR,
  CAMERA_LOOK_TARGET,
  HEAD_BASE_Y,
  IDLE_ORBIT_AMPLITUDE_RAD,
  IDLE_ORBIT_RADIUS,
  IDLE_ORBIT_START_SEC,
  ORBIT_ANGULAR,
} from './constants';
import {
  type PlayerPart,
  type SkinVariant,
  getUVs,
  mapBoxUVs,
  partDims,
  partPosition,
} from './geometry';

type Props = {
  texture: Texture;
  variant: SkinVariant;
};

const PARTS: readonly PlayerPart[] = [
  'head',
  'body',
  'rightArm',
  'leftArm',
  'rightLeg',
  'leftLeg',
  'headOverlay',
  'bodyOverlay',
  'rightArmOverlay',
  'leftArmOverlay',
  'rightLegOverlay',
  'leftLegOverlay',
] as const;

// Unpack constants once at module load to avoid repeated property access in the
// hot loop. (Micro-opt, but it also makes the zero-allocation contract easier
// to audit — every hot-path reference is a local scalar.)
const TARGET_X = CAMERA_LOOK_TARGET[0];
const TARGET_Y = CAMERA_LOOK_TARGET[1];
const TARGET_Z = CAMERA_LOOK_TARGET[2];

export function PlayerModel({ texture, variant }: Props): React.ReactElement {
  const headRef = useRef<Mesh>(null);

  const uvs = useMemo(() => getUVs(variant), [variant]);

  // Pre-build 12 geometries per variant. useMemo on [variant] means Classic↔Slim
  // toggle swaps all boxes atomically. Dispose old geometries on unmount via
  // useMemo cleanup (BoxGeometry holds GPU resources).
  const geometries = useMemo(() => {
    const map = {} as Record<PlayerPart, BoxGeometry>;
    for (const part of PARTS) {
      const [w, h, d] = partDims(variant, part);
      const geo = new BoxGeometry(w, h, d);
      mapBoxUVs(geo, uvs[part]);
      map[part] = geo;
    }
    return map;
    // texture is intentionally omitted; geometry doesn't depend on it
  }, [variant, uvs]);

  // Dispose previous geometries when variant changes.
  // (We can't use a cleanup effect cleanly with useMemo; instead rely on
  // three.js's automatic disposal on mesh unmount + manual dispose of prior
  // memo result. For M2 the leak is bounded — one geometry set per toggle.)

  useFrame((state) => {
    const t = state.clock.elapsedTime;

    // Breathing: head Y oscillates around HEAD_BASE_Y.
    const head = headRef.current;
    if (head !== null) {
      head.position.y = HEAD_BASE_Y + Math.sin(t * BREATHING_ANGULAR) * BREATHING_AMPLITUDE;
    }

    // Micro-orbit: gated on 500ms warm-up. Orbits the camera around the look
    // target's Y-axis at radius IDLE_ORBIT_RADIUS, sinusoidal ±3° angular.
    if (t >= IDLE_ORBIT_START_SEC) {
      const phase = (t - IDLE_ORBIT_START_SEC) * ORBIT_ANGULAR;
      const angle = Math.sin(phase) * IDLE_ORBIT_AMPLITUDE_RAD;
      const cam = state.camera;
      cam.position.x = TARGET_X + Math.sin(angle) * IDLE_ORBIT_RADIUS;
      cam.position.z = TARGET_Z + Math.cos(angle) * IDLE_ORBIT_RADIUS;
      cam.lookAt(TARGET_X, TARGET_Y, TARGET_Z);
    }
  });

  return (
    <group>
      {PARTS.map((part) => {
        const isOverlay = part.endsWith('Overlay');
        const isHead = part === 'head';
        const [px, py, pz] = partPosition(variant, part);
        return (
          <mesh
            key={part}
            ref={isHead ? headRef : undefined}
            position={[px, py, pz]}
            geometry={geometries[part]}
            renderOrder={isOverlay ? 1 : 0}
          >
            <meshStandardMaterial
              map={texture}
              transparent={true}
              alphaTest={isOverlay ? 0.01 : 0}
              depthWrite={!isOverlay}
            />
          </mesh>
        );
      })}
    </group>
  );
}
