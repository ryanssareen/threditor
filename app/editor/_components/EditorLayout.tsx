'use client';

/**
 * M3: responsive layout coordinator.
 * M6: multi-layer aware. Resolves `activeLayer` from the store and
 * threads it to paint surfaces. Owns the `TextureManager` (via the
 * bundle hook), the persistence subscription, the UndoStack, and the
 * window-level Cmd/Ctrl+Z / Cmd+Shift+Z keydown listener.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  applyTemplate,
  cancelActiveTransition,
  type ApplyTemplateActions,
} from '@/lib/editor/apply-template';
import { initPersistence, loadDocument } from '@/lib/editor/persistence';
import { useEditorStore } from '@/lib/editor/store';
import { UndoStack, writeLayerRegion, type EditorActions } from '@/lib/editor/undo';
import { useTextureManagerBundle } from '@/lib/editor/use-texture-manager';
import type { Layer, Stroke, TemplateMeta } from '@/lib/editor/types';
import { AffordancePulse } from './AffordancePulse';
import { ContextualHintOverlay } from './ContextualHintOverlay';
import { EditorCanvas } from './EditorCanvas';
import type { LayerLifecycleCommand } from './LayerPanel';
import { Sidebar } from './Sidebar';
import { TemplateGate } from './TemplateGate';
import { useTemplateGate } from './useTemplateGate';
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

  // UndoStack is scoped to the editor session. Reload = empty stack
  // (matches Photoshop/Figma/Procreate web behavior, plan §D3).
  const undoStackRef = useRef<UndoStack | null>(null);
  if (undoStackRef.current === null) undoStackRef.current = new UndoStack();
  const undoStack = undoStackRef.current;

  // Stable bundle ref so the keydown handler reads the current bundle
  // without depending on it (which would rebind the listener).
  const bundleRef = useRef(bundle);
  bundleRef.current = bundle;

  // M4 Unit 0 (P1 from M3 review): hydrationPending gates paint interaction
  // until loadDocument() resolves.
  const [hydrationPending, setHydrationPending] = useState(true);

  // M7 Unit 5/6: hoisted gate state. Shared between TemplateGate (render)
  // and TemplateMenuButton (in Sidebar) so both siblings can dispatch events.
  const gate = useTemplateGate(hydrationPending);

  // M7 Unit 7: crossfade + Y-rotation pulse keys. Bumped on successful apply.
  const [texFadeKey, setTexFadeKey] = useState(0);
  const [yRotationPulseKey, setYRotationPulseKey] = useState(0);

  // Undo/redo button reactivity: bump a version counter when the stack
  // mutates so canUndo/canRedo checks re-run during render.
  const [, setUndoVersion] = useState(0);
  useEffect(() => {
    return undoStack.subscribe(() => setUndoVersion((v) => v + 1));
  }, [undoStack]);

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

        // M7 Unit 8: restore template-aware flags from IDB. These drive
        // the Ghost-picker gate on next mount and the M8 export
        // guardrail. Transient UI state (activeContextualHint,
        // pulseTarget) is NOT restored — on reload mid-transition the
        // hint/pulse default to null (the apply-template itself has
        // already landed in IDB; only the post-apply timeline is lost).
        useEditorStore.setState({
          hasEditedSinceTemplate:
            typeof doc.hasEditedSinceTemplate === 'boolean'
              ? doc.hasEditedSinceTemplate
              : true,
          lastAppliedTemplateId:
            typeof doc.lastAppliedTemplateId === 'string'
              ? doc.lastAppliedTemplateId
              : null,
        });
      }

      if (!cancelled) {
        const { markDirty, cleanup } = initPersistence({
          getLayers: () => layersRef.current,
          getActiveLayerId: () => useEditorStore.getState().activeLayerId,
          createdAt: doc?.createdAt,
          getHasEditedSinceTemplate: () =>
            useEditorStore.getState().hasEditedSinceTemplate,
          getLastAppliedTemplateId: () =>
            useEditorStore.getState().lastAppliedTemplateId,
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

  // ── Undo/redo wiring ─────────────────────────────────────────────────

  const buildActions = useCallback((): EditorActions => {
    const store = useEditorStore.getState();
    return {
      getLayers: () => layersRef.current,
      setLayerPixelRegion: (layerId, bbox, region) => {
        writeLayerRegion(layersRef.current, layerId, bbox, region);
      },
      insertLayerAt: (layer, index) => store.insertLayerAt(layer, index),
      deleteLayer: (id) => {
        store.deleteLayer(id);
      },
      reorderLayers: (from, to) => store.reorderLayers(from, to),
      setLayerName: (id, name) => store.renameLayer(id, name),
      setLayerOpacity: (id, opacity) => store.setLayerOpacity(id, opacity),
      setLayerBlendMode: (id, mode) => store.setLayerBlendMode(id, mode),
      setLayerVisible: (id, visible) => store.setLayerVisible(id, visible),
      recomposite: () => {
        const b = bundleRef.current;
        if (b === null) return;
        b.textureManager.composite(layersRef.current);
        markDirtyRef.current();
      },
      strokeActive: () => useEditorStore.getState().strokeActive,
      // M7: apply-template snapshot swap. Cancels any in-flight
      // +700ms/+1000ms transition timers BEFORE the swap so they
      // can't fire against the newly-restored state (plan D8 +
      // Unit 4 clarification #1b).
      applyTemplateSnapshot: (snapshot) => {
        cancelActiveTransition();
        useEditorStore.getState().applyTemplateState(snapshot);
        useEditorStore.getState().setActiveContextualHint(null);
        useEditorStore.getState().setPulseTarget(null);
      },
    };
  }, []);

  const handleStrokeCommit = useCallback(
    (stroke: Stroke) => {
      undoStack.push({ kind: 'stroke', stroke });
      // M7: first stroke after apply-template (or session start)
      // flips hasEditedSinceTemplate true. markEdited is idempotent
      // so subsequent strokes are no-ops at the store level. This
      // rides the M6 dispatcher-chokepoint; zero per-tool changes.
      useEditorStore.getState().markEdited();
    },
    [undoStack],
  );

  const handleStrokeActive = useCallback((active: boolean) => {
    useEditorStore.getState().setStrokeActive(active);
  }, []);

  const handleLayerUndoPush = useCallback(
    (cmd: LayerLifecycleCommand) => {
      undoStack.push(cmd);
    },
    [undoStack],
  );

  // M7 Unit 4: apply-template orchestrator. TemplateGate + the menu
  // button funnel through here. pixels are the already-decoded RGBA
  // buffer from lib/editor/templates.ts.decodeTemplatePng.
  const handleApplyTemplate = useCallback(
    (template: TemplateMeta, pixels: Uint8ClampedArray) => {
      const applyActions: ApplyTemplateActions = {
        getLayers: () => layersRef.current,
        getActiveLayerId: () => useEditorStore.getState().activeLayerId,
        getVariant: () => useEditorStore.getState().variant,
        getHasEditedSinceTemplate: () =>
          useEditorStore.getState().hasEditedSinceTemplate,
        getLastAppliedTemplateId: () =>
          useEditorStore.getState().lastAppliedTemplateId,
        strokeActive: () => useEditorStore.getState().strokeActive,
        hydrationPending: () => hydrationPending,
        applyTemplateSnapshot: (snapshot) => {
          // Note: top-level applyTemplate already called
          // cancelActiveTransition() at the start of the orchestrator
          // (clarification #1a). This path is just the store write.
          useEditorStore.getState().applyTemplateState(snapshot);
          useEditorStore.getState().setActiveContextualHint(null);
          useEditorStore.getState().setPulseTarget(null);
        },
        recomposite: () => {
          const b = bundleRef.current;
          if (b === null) return;
          b.textureManager.composite(layersRef.current);
          markDirtyRef.current();
        },
        setActiveContextualHint: (hint) => {
          useEditorStore.getState().setActiveContextualHint(hint);
        },
        setPulseTarget: (target) => {
          useEditorStore.getState().setPulseTarget(target);
        },
        clearContextualHint: () => {
          useEditorStore.getState().clearContextualHint();
        },
      };

      const result = applyTemplate(
        applyActions,
        (cmd) => undoStack.push(cmd),
        template,
        pixels,
      );
      if (!result.ok) {
        console.warn(`applyTemplate rejected: ${result.reason}`);
      } else {
        setTexFadeKey((k) => k + 1);
        setYRotationPulseKey((k) => k + 1);
      }
    },
    [undoStack, hydrationPending],
  );

  const handleUndo = useCallback(() => {
    if (useEditorStore.getState().strokeActive) return;
    undoStack.undo(buildActions());
  }, [undoStack, buildActions]);

  const handleRedo = useCallback(() => {
    if (useEditorStore.getState().strokeActive) return;
    undoStack.redo(buildActions());
  }, [undoStack, buildActions]);

  // M7 Unit 0: user-initiated variant toggle clears the undo stack.
  // User variant changes are NOT undoable per D5 — replaying stroke
  // commands across a variant switch is semantically ambiguous and
  // would require layer-aware variant-scoped snapshots that exceed the
  // M6 memory budget. Apply-template's variant flip is a different
  // path (applyTemplateState) and preserves the stack.
  const handleUserVariantChange = useCallback(
    (next: 'classic' | 'slim') => {
      undoStack.clear();
      useEditorStore.getState().setVariant(next);
    },
    [undoStack],
  );

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      // Focus guard: shortcuts should never fire from within inputs,
      // textareas, contenteditable, or role=application widgets (matches
      // the Toolbar shortcut convention introduced in M3).
      const target = e.target as HTMLElement | null;
      if (target !== null && target instanceof HTMLElement) {
        const tag = target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA') return;
        if (target.isContentEditable) return;
        if (target.getAttribute('role') === 'application') return;
      }

      // Modifier guard: Meta XOR Ctrl must be held; Alt blocks.
      const hasCmd = e.metaKey || e.ctrlKey;
      if (!hasCmd) return;
      if (e.metaKey && e.ctrlKey) return;
      if (e.altKey) return;

      const key = e.key.toLowerCase();
      if (key !== 'z') return;

      // Block during an active stroke (D10).
      if (useEditorStore.getState().strokeActive) {
        e.preventDefault();
        return;
      }

      e.preventDefault();
      const actions = buildActions();
      if (e.shiftKey) {
        undoStack.redo(actions);
      } else {
        undoStack.undo(actions);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [undoStack, buildActions]);

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
          onStrokeCommit={handleStrokeCommit}
          onStrokeActive={handleStrokeActive}
          texFadeKey={texFadeKey}
          yRotationPulseKey={yRotationPulseKey}
        />
        {/* M7 Unit 7: contextual hint bubble */}
        <ContextualHintOverlay />
        {/* M7 Unit 7: headless affordance pulse coordinator */}
        <AffordancePulse />
        {/* M7: overlay gate — absolutely positioned within the 3D pane */}
        <TemplateGate
          state={gate.state}
          dispatch={gate.dispatch}
          onApplyTemplate={handleApplyTemplate}
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
            onStrokeCommit={handleStrokeCommit}
            onStrokeActive={handleStrokeActive}
            className="h-full w-full"
          />
        ) : null}
      </div>

      <aside
        className="h-[30vh] w-full shrink-0 border-t border-ui-border bg-ui-surface sm:h-full sm:w-[280px] sm:border-l sm:border-t-0"
        style={{ paddingBottom: 'env(safe-area-inset-bottom, 0)' }}
      >
        <Sidebar
          className="h-full w-full"
          onLayerUndoPush={handleLayerUndoPush}
          onUserVariantChange={handleUserVariantChange}
          onOpenTemplateMenu={() =>
            gate.dispatch({ type: 'SHEET_OPENED_FROM_MENU' })
          }
          canUndo={undoStack.canUndo()}
          canRedo={undoStack.canRedo()}
          onUndo={handleUndo}
          onRedo={handleRedo}
        />
      </aside>
    </div>
  );
}
