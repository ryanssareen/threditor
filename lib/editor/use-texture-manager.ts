/**
 * M3: shared TextureManager + Layer lifecycle hook.
 * M6: extended to N layers backed by the store.
 * M7 Unit 0: placeholder seed decoupled from TM lifecycle.
 *
 * Both the 3D viewport (EditorCanvas → PlayerModel) and the 2D paint
 * surface (ViewportUV) need to read the same TextureManager instance so
 * pencil strokes land once and appear on both surfaces. This hook owns
 * the TextureManager; layer data lives in the store.
 *
 * Two effects, each with a single responsibility:
 *
 *   - Effect A (deps: [variant]) — TM lifecycle. Dispose old TM on
 *     variant change, build a new one, composite whatever layers the
 *     store currently holds.
 *   - Effect B (deps: [bundle, layers.length, variant]) — placeholder
 *     seed. When a bundle exists and layers are empty, seed a single
 *     placeholder layer for the current variant.
 *
 * This split lets apply-template (M7) populate layers + flip variant
 * atomically: Effect A sees the non-empty layers on rebuild, Effect B
 * sees layers.length > 0 and skips the seed.
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

function buildPlaceholderLayer(variant: SkinVariant): Layer {
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
  // Effect B subscribes to layers.length via a narrow selector so it fires
  // only when the emptiness state flips (not on pixel mutations, which
  // don't change the array identity).
  const layersLength = useEditorStore((s) => s.layers.length);

  // Effect A: TM lifecycle. Disposes the previous TM, builds a new one,
  // composites whatever layers the store currently holds. Does NOT seed.
  useEffect(() => {
    const tm = new TextureManager();
    const currentLayers = useEditorStore.getState().layers;
    if (currentLayers.length > 0) {
      tm.composite(currentLayers);
    }
    setBundle({ textureManager: tm });
    return () => {
      tm.dispose();
    };
  }, [variant]);

  // Effect B: placeholder seed. Fires when the bundle exists and layers
  // are empty — either because this is the first mount OR because the
  // user toggled variants and setVariant cleared the layers. Skips when
  // apply-template or hydration has already populated layers.
  useEffect(() => {
    if (bundle === null) return;
    if (layersLength !== 0) return;
    const placeholder = buildPlaceholderLayer(variant);
    useEditorStore.getState().setLayers([placeholder]);
    useEditorStore.getState().setActiveLayerId(placeholder.id);
    bundle.textureManager.composite([placeholder]);
  }, [bundle, layersLength, variant]);

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
