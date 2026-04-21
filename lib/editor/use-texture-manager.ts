/**
 * M3: shared TextureManager + Layer lifecycle hook.
 * M6: extended to N layers backed by the store.
 *
 * Both the 3D viewport (EditorCanvas → PlayerModel) and the 2D paint
 * surface (ViewportUV) need to read the same TextureManager instance so
 * pencil strokes land once and appear on both surfaces. This hook owns
 * the TextureManager; layer data lives in the store.
 *
 * On variant change:
 *   - The outgoing TM is disposed (caller-owned GPU resource contract).
 *   - A fresh TM is constructed.
 *   - The store's `layers` is reseeded with one base layer whose pixels
 *     come from `createPlaceholderSkinPixels(variant)`.
 *   - (Persistence may subsequently replace layers via hydration — see
 *     EditorLayout for the sequencing.)
 *
 * Returns null while the effect is still mounting (SSR-safe).
 */

import { useEffect, useMemo, useState } from 'react';

import { useEditorStore } from './store';
import { createPlaceholderSkinPixels } from '@/lib/three/placeholder-skin';
import type { Layer, SkinVariant } from './types';
import { TextureManager } from './texture';

export type TextureManagerBundle = {
  textureManager: TextureManager;
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
    const initialLayer = buildInitialLayer(variant);
    useEditorStore.getState().setLayers([initialLayer]);
    useEditorStore.getState().setActiveLayerId(initialLayer.id);
    tm.composite([initialLayer]);
    setBundle({ textureManager: tm });
    return () => {
      tm.dispose();
    };
  }, [variant]);

  return bundle;
}

/**
 * Resolve the active layer from the store. Returns null when layers
 * haven't been seeded yet (e.g., during the first frame of bundle mount).
 *
 * Narrow-selector contract: callers that only need the active layer id
 * (e.g., LayerPanel row highlight) should subscribe to `activeLayerId`
 * directly and not use this hook.
 */
export function useActiveLayer(): Layer | null {
  const layers = useEditorStore((s) => s.layers);
  const activeLayerId = useEditorStore((s) => s.activeLayerId);
  return useMemo(() => {
    if (layers.length === 0) return null;
    return layers.find((l) => l.id === activeLayerId) ?? layers[layers.length - 1];
  }, [layers, activeLayerId]);
}
