'use client';

/**
 * M3: responsive layout coordinator.
 * M6: multi-layer aware. Resolves `activeLayer` from the store and
 * threads it to paint surfaces. Owns the `TextureManager` (via the
 * bundle hook), the persistence subscription, and (forthcoming Unit 7)
 * the UndoStack + Cmd+Z keydown listener.
 */

import { useEffect, useMemo, useRef, useState } from 'react';

import { initPersistence, loadDocument } from '@/lib/editor/persistence';
import { useEditorStore } from '@/lib/editor/store';
import { useTextureManagerBundle } from '@/lib/editor/use-texture-manager';
import type { Layer } from '@/lib/editor/types';
import { EditorCanvas } from './EditorCanvas';
import { Sidebar } from './Sidebar';
import { ViewportUV } from './ViewportUV';

export function EditorLayout() {
  const variant = useEditorStore((s) => s.variant);
  const layers = useEditorStore((s) => s.layers);
  const activeLayerId = useEditorStore((s) => s.activeLayerId);
  const bundle = useTextureManagerBundle(variant);

  // Resolve the active layer from the store. Falls back to the last
  // layer if activeLayerId has drifted (which the store guards against,
  // but belt-and-suspenders for hydration timing).
  const activeLayer: Layer | null = useMemo(() => {
    if (layers.length === 0) return null;
    return layers.find((l) => l.id === activeLayerId) ?? layers[layers.length - 1];
  }, [layers, activeLayerId]);

  // Hold the full layers array in a ref so persistence reads the freshest
  // pixel buffers at flush time without re-subscribing on every change.
  const layersRef = useRef(layers);
  layersRef.current = layers;

  // markDirty is threaded as a prop to ViewportUV so the persistence
  // singleton is not module-scope.
  const markDirtyRef = useRef<() => void>(() => {});

  // M4 Unit 0 (P1 from M3 review): hydrationPending gates paint interaction
  // until loadDocument() resolves.
  const [hydrationPending, setHydrationPending] = useState(true);

  // Hydrate from IndexedDB then install persistence.
  useEffect(() => {
    if (bundle === null) return;
    let cancelled = false;
    let persistenceCleanup: (() => void) | undefined;

    setHydrationPending(true);

    (async () => {
      const doc = await loadDocument();
      if (cancelled) return;

      if (doc !== null && doc.layers.length > 0) {
        // M6: restore all layers. Validate each layer's pixel length;
        // fall back silently on malformed records.
        const restored: Layer[] = [];
        for (const saved of doc.layers) {
          if (
            saved.pixels instanceof Uint8ClampedArray &&
            saved.pixels.length === 64 * 64 * 4
          ) {
            restored.push({
              id: saved.id,
              name: saved.name,
              visible: saved.visible,
              opacity:
                typeof saved.opacity === 'number' && saved.opacity >= 0 && saved.opacity <= 1
                  ? saved.opacity
                  : 1,
              blendMode:
                saved.blendMode === 'multiply' ||
                saved.blendMode === 'overlay' ||
                saved.blendMode === 'screen'
                  ? saved.blendMode
                  : 'normal',
              pixels: saved.pixels,
            });
          }
        }
        if (restored.length > 0) {
          useEditorStore.getState().setLayers(restored);
          const activeStillExists = restored.some((l) => l.id === doc.activeLayerId);
          useEditorStore.getState().setActiveLayerId(
            activeStillExists ? doc.activeLayerId : restored[restored.length - 1].id,
          );
          bundle.textureManager.composite(restored);
        }
        if (
          (doc.variant === 'classic' || doc.variant === 'slim') &&
          doc.variant !== variant
        ) {
          useEditorStore.setState({ variant: doc.variant });
        }
      }

      if (!cancelled) {
        const { markDirty, cleanup } = initPersistence({
          getLayers: () => layersRef.current,
          getActiveLayerId: () => useEditorStore.getState().activeLayerId,
          createdAt: doc?.createdAt,
        });
        markDirtyRef.current = markDirty;
        persistenceCleanup = cleanup;
        setHydrationPending(false);
      }
    })();

    return () => {
      cancelled = true;
      persistenceCleanup?.();
      markDirtyRef.current = () => {};
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bundle]);

  // Recomposite whenever layer metadata (visibility, opacity, blend mode,
  // or layer-set identity) changes. Pixel mutations do NOT trigger this
  // — paint surfaces flush via `textureManager.flushLayer` during the
  // stroke and call `composite` on pointerup.
  useEffect(() => {
    if (bundle === null) return;
    if (layers.length === 0) return;
    bundle.textureManager.composite(layers);
    markDirtyRef.current();
  }, [bundle, layers]);

  return (
    <div className="flex h-dvh w-dvw flex-col sm:flex-row">
      <div className="relative h-[30vh] w-full shrink-0 sm:h-full sm:w-auto sm:flex-1">
        <EditorCanvas
          texture={bundle?.textureManager.getTexture() ?? null}
          variant={variant}
          textureManager={bundle?.textureManager}
          layer={activeLayer ?? undefined}
          markDirty={() => markDirtyRef.current()}
          hydrationPending={hydrationPending}
        />
      </div>

      <div className="relative h-[40vh] w-full shrink-0 sm:h-full sm:w-auto sm:flex-1">
        {bundle !== null && activeLayer !== null ? (
          <ViewportUV
            textureManager={bundle.textureManager}
            layer={activeLayer}
            markDirty={() => markDirtyRef.current()}
            hydrationPending={hydrationPending}
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
