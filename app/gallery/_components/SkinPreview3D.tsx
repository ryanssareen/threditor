'use client';

/**
 * M13.1: 3D skin preview for gallery cards and skin detail pages.
 *
 * Renders a live 3D Minecraft player model on hover/focus. Reuses
 * the PlayerModel component from the editor but in view-only mode
 * (no painting, just rotation/zoom).
 *
 * Lazy-loaded via dynamic import to keep the gallery page bundle
 * small — three.js is ~600 KB and only needed when user hovers.
 */

import { Suspense, useEffect, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';

type Props = {
  /** URL to the 64×64 skin PNG */
  skinUrl: string;
  /** 'classic' (4px arms) or 'slim' (3px arms) */
  variant: 'classic' | 'slim';
  /** Optional class name for container */
  className?: string;
};

/**
 * Arm width per Minecraft variant in scene units (1 unit = 10 skin px).
 * Exported so tests can assert the classic/slim distinction without
 * standing up a jsdom-hostile WebGL context.
 */
export const ARM_WIDTH: Record<'classic' | 'slim', number> = {
  classic: 0.3,
  slim: 0.25,
};

function PlayerModel({ skinUrl, variant }: { skinUrl: string; variant: 'classic' | 'slim' }) {
  const [texture, setTexture] = useState<THREE.Texture | null>(null);

  useEffect(() => {
    // Track the loaded texture in a local ref so the cleanup below can
    // dispose it on unmount / skinUrl change. The previous implementation
    // closed over the `texture` state value — which was null at the time
    // the effect ran, so dispose was effectively a no-op and the GPU
    // buffer leaked every time the user hovered a different card.
    let loaded: THREE.Texture | null = null;
    let cancelled = false;

    const loader = new THREE.TextureLoader();
    loader.load(
      skinUrl,
      (tex) => {
        tex.magFilter = THREE.NearestFilter;
        tex.minFilter = THREE.NearestFilter;
        tex.generateMipmaps = false;
        loaded = tex;
        if (cancelled) {
          tex.dispose();
          return;
        }
        setTexture(tex);
      },
      undefined,
      (err) => {
        console.error('SkinPreview3D: texture load failed', err);
      },
    );

    return () => {
      cancelled = true;
      if (loaded !== null) {
        loaded.dispose();
      }
    };
  }, [skinUrl]);

  if (!texture) {
    return null; // Loading state handled by Suspense fallback
  }

  // Simplified player model — just the visible parts
  // Head: 8×8×8 at y=1.5
  // Body: 8×12×4 at y=0.8
  // Arms: 4×12×4 (classic) or 3×12×4 (slim)
  // Legs: 4×12×4

  const armWidth = ARM_WIDTH[variant];

  return (
    <group>
      {/* Head */}
      <mesh position={[0, 1.5, 0]}>
        <boxGeometry args={[0.5, 0.5, 0.5]} />
        <meshStandardMaterial map={texture} transparent />
      </mesh>

      {/* Head overlay (second layer) */}
      <mesh position={[0, 1.5, 0]} scale={1.05}>
        <boxGeometry args={[0.5, 0.5, 0.5]} />
        <meshStandardMaterial map={texture} transparent />
      </mesh>

      {/* Body */}
      <mesh position={[0, 0.8, 0]}>
        <boxGeometry args={[0.5, 0.75, 0.25]} />
        <meshStandardMaterial map={texture} transparent />
      </mesh>

      {/* Right arm */}
      <mesh position={[0.3, 0.8, 0]}>
        <boxGeometry args={[armWidth, 0.75, 0.25]} />
        <meshStandardMaterial map={texture} transparent />
      </mesh>

      {/* Left arm */}
      <mesh position={[-0.3, 0.8, 0]}>
        <boxGeometry args={[armWidth, 0.75, 0.25]} />
        <meshStandardMaterial map={texture} transparent />
      </mesh>

      {/* Right leg */}
      <mesh position={[0.125, 0.2, 0]}>
        <boxGeometry args={[0.25, 0.75, 0.25]} />
        <meshStandardMaterial map={texture} transparent />
      </mesh>

      {/* Left leg */}
      <mesh position={[-0.125, 0.2, 0]}>
        <boxGeometry args={[0.25, 0.75, 0.25]} />
        <meshStandardMaterial map={texture} transparent />
      </mesh>
    </group>
  );
}

function Scene({ skinUrl, variant }: { skinUrl: string; variant: 'classic' | 'slim' }) {
  return (
    <>
      {/* Lighting */}
      <ambientLight intensity={0.6} />
      <directionalLight position={[5, 5, 5]} intensity={0.8} />
      <directionalLight position={[-3, 3, -3]} intensity={0.4} />

      {/* Player model */}
      <Suspense fallback={null}>
        <PlayerModel skinUrl={skinUrl} variant={variant} />
      </Suspense>

      {/* Camera controls */}
      <OrbitControls
        enablePan={false}
        enableZoom={true}
        minDistance={2}
        maxDistance={5}
        target={[0, 1, 0]}
      />
    </>
  );
}

export function SkinPreview3D({ skinUrl, variant, className = '' }: Props) {
  return (
    <div className={className} style={{ width: '100%', height: '100%' }}>
      <Canvas
        camera={{ position: [2, 1.5, 2.5], fov: 35 }}
        style={{ background: 'transparent' }}
      >
        <Scene skinUrl={skinUrl} variant={variant} />
      </Canvas>
    </div>
  );
}
