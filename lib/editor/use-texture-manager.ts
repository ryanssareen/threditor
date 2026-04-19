/**
 * M3: shared TextureManager + Layer lifecycle hook.
 *
 * Both the 3D viewport (EditorCanvas → PlayerModel) and the 2D paint
 * surface (ViewportUV) need to read the same TextureManager instance so
 * pencil strokes land once and appear on both surfaces. This hook owns
 * the TM + Layer refs at the EditorLayout level; children receive them
 * as props.
 *
 * On variant change:
 *   - The outgoing TM is disposed (caller-owned GPU resource contract
 *     per docs/solutions/performance-issues/
 *     r3f-geometry-prop-disposal-2026-04-18.md).
 *   - A fresh TM is constructed and seeded with a single "base" Layer
 *     whose pixels come from createPlaceholderSkinPixels(variant).
 *   - The effect returns a cleanup that disposes the current TM on
 *     unmount or variant change.
 *
 * Returns null while the effect is still mounting (SSR-safe). Callers
 * render nothing / show a loading state while `tm === null`.
 */

import { useEffect, useState } from 'react';

import type { Layer, SkinVariant } from './types';
import { TextureManager } from './texture';
import { createPlaceholderSkinPixels } from '@/lib/three/placeholder-skin';

export type TextureManagerBundle = {
  textureManager: TextureManager;
  layer: Layer;
};

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

export function useTextureManagerBundle(
  variant: SkinVariant,
): TextureManagerBundle | null {
  const [bundle, setBundle] = useState<TextureManagerBundle | null>(null);

  useEffect(() => {
    const tm = new TextureManager();
    const layer = buildInitialLayer(variant);
    tm.composite([layer]);
    setBundle({ textureManager: tm, layer });
    return () => {
      tm.dispose();
    };
  }, [variant]);

  return bundle;
}
