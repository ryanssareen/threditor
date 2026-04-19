'use client';

/**
 * M3: responsive layout coordinator.
 *
 * Owns the single TextureManager + Layer the paint loop writes into and
 * the persistence subscription that auto-saves them to IndexedDB. Hands
 * them to the two consumers that need synchronized pixel views:
 *
 *   - `ViewportUV` (2D paint surface) — mounts TM's offscreen canvas
 *     into its own DOM with CSS transform for zoom/pan.
 *   - `EditorCanvas` (3D viewport) — passes TM's `CanvasTexture` to
 *     `PlayerModel` as the material map.
 *
 * Also renders the `Sidebar` (ColorPicker + Toolbar + VariantToggle +
 * BrushSizeRadio + SavingStatus chip).
 *
 * Desktop ≥640px: `[3D | 2D | Sidebar 280px]` horizontal split.
 * Mobile <640px: `[3D 30vh][2D 40vh][Sidebar remaining, safe-area-inset]`
 * vertical stack.
 */

import { useEffect, useRef } from 'react';

import { initPersistence, loadDocument } from '@/lib/editor/persistence';
import { useEditorStore } from '@/lib/editor/store';
import { useTextureManagerBundle } from '@/lib/editor/use-texture-manager';
import { EditorCanvas } from './EditorCanvas';
import { Sidebar } from './Sidebar';
import { ViewportUV } from './ViewportUV';

export function EditorLayout() {
  const variant = useEditorStore((s) => s.variant);
  const bundle = useTextureManagerBundle(variant);

  // Hold the current layer in a ref so persistence can read the freshest
  // pixel buffer at flush time without re-subscribing on every change.
  const layerRef = useRef(bundle?.layer ?? null);
  layerRef.current = bundle?.layer ?? null;

  // Hydrate from IndexedDB then install persistence — sequenced so that
  // initPersistence cannot fire a write with blank pixels before the saved
  // doc is copied into the layer. A race between the probe completing and
  // loadDocument returning is prevented by not installing persistence at all
  // until after loadDocument settles.
  useEffect(() => {
    if (bundle === null) return;
    let cancelled = false;
    let persistenceCleanup: (() => void) | undefined;

    (async () => {
      const doc = await loadDocument();
      if (cancelled) return;

      if (doc !== null) {
        // Restore: copy the saved pixels into the current Layer and
        // recomposite. We avoid swapping Layer objects because that would
        // tear down / rebuild the TextureManager unnecessarily.
        const saved = doc.layers[0];
        if (
          saved !== undefined &&
          saved.pixels instanceof Uint8ClampedArray &&
          saved.pixels.length === bundle.layer.pixels.length
        ) {
          bundle.layer.pixels.set(saved.pixels);
          bundle.textureManager.composite([bundle.layer]);
        }
        if (
          (doc.variant === 'classic' || doc.variant === 'slim') &&
          doc.variant !== variant
        ) {
          useEditorStore.setState({ variant: doc.variant });
        }
      }

      if (!cancelled) {
        persistenceCleanup = initPersistence({
          getLayer: () => layerRef.current,
          createdAt: doc?.createdAt,
        });
      }
    })();

    return () => {
      cancelled = true;
      persistenceCleanup?.();
    };
    // layerRef is stable; bundle change triggers a fresh hydrate pass.
    // variant intentionally excluded — we hydrate once per bundle (which
    // already changes on variant) and otherwise let the save path
    // persist the new variant naturally.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bundle]);

  return (
    <div className="flex h-dvh w-dvw flex-col sm:flex-row">
      <div className="relative h-[30vh] w-full shrink-0 sm:h-full sm:w-auto sm:flex-1">
        <EditorCanvas
          texture={bundle?.textureManager.getTexture() ?? null}
          variant={variant}
        />
      </div>

      <div className="relative h-[40vh] w-full shrink-0 sm:h-full sm:w-auto sm:flex-1">
        {bundle !== null ? (
          <ViewportUV
            textureManager={bundle.textureManager}
            layer={bundle.layer}
            className="h-full w-full"
          />
        ) : null}
      </div>

      <aside
        className="h-[30vh] w-full shrink-0 border-t border-ui-border bg-ui-surface sm:h-full sm:w-[280px] sm:border-l sm:border-t-0"
        style={{ paddingBottom: 'env(safe-area-inset-bottom, 0)' }}
      >
        <Sidebar className="h-full w-full" />
      </aside>
    </div>
  );
}
