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
import { useEffect, useMemo, useRef } from 'react';
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

// PART_ORDER is typed `Record<PlayerPart, number>`, forcing the object literal
// to cover every PlayerPart. Adding a new member to the union (e.g., 'cape' in
// a future milestone) produces a compile error until the key is added here.
// PARTS is derived from PART_ORDER keys, guaranteeing exhaustiveness.
const PART_ORDER: Record<PlayerPart, number> = {
  head: 0,
  body: 1,
  rightArm: 2,
  leftArm: 3,
  rightLeg: 4,
  leftLeg: 5,
  headOverlay: 6,
  bodyOverlay: 7,
  rightArmOverlay: 8,
  leftArmOverlay: 9,
  rightLegOverlay: 10,
  leftLegOverlay: 11,
};

const PARTS = Object.keys(PART_ORDER) as readonly PlayerPart[];

// Unpack constants once at module load to avoid repeated property access in the
// hot loop. (Micro-opt, but it also makes the zero-allocation contract easier
// to audit — every hot-path reference is a local scalar.)
const TARGET_X = CAMERA_LOOK_TARGET[0];
const TARGET_Y = CAMERA_LOOK_TARGET[1];
const TARGET_Z = CAMERA_LOOK_TARGET[2];

export function PlayerModel({ texture, variant }: Props): React.ReactElement {
  const headRef = useRef<Mesh>(null);

  // Build 12 BoxGeometries for this variant. PARTS is exhaustive over
  // PlayerPart (enforced by PART_ORDER), so every key is populated by the
  // loop — the final cast is safe.
  const geometries = useMemo(() => {
    const uvs = getUVs(variant);
    const map = {} as Record<PlayerPart, BoxGeometry>;
    for (const part of PARTS) {
      const [w, h, d] = partDims(variant, part);
      const geo = new BoxGeometry(w, h, d);
      mapBoxUVs(geo, uvs[part]);
      map[part] = geo;
    }
    return map;
  }, [variant]);

  // Dispose the GPU buffers for the previous geometry set whenever `geometries`
  // changes (variant toggle) or the component unmounts. R3F auto-disposes
  // declarative `<boxGeometry>` JSX children because it owns their lifecycle,
  // but a geometry passed as a prop (`<mesh geometry={...} />`) is caller-
  // owned — we must dispose it ourselves or the BoxGeometry's VRAM leaks on
  // every variant toggle.
  useEffect(() => {
    return () => {
      for (const part of PARTS) {
        geometries[part].dispose();
      }
    };
  }, [geometries]);

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
              transparent={isOverlay}
              alphaTest={isOverlay ? 0.01 : 0}
              depthWrite={!isOverlay}
            />
          </mesh>
        );
      })}
    </group>
  );
}
