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
import { TIMING } from '@/lib/editor/templates';
import { UndoStack, writeLayerRegion, type EditorActions } from '@/lib/editor/undo';
import { useTextureManagerBundle } from '@/lib/editor/use-texture-manager';
import type { Layer, Stroke, TemplateMeta } from '@/lib/editor/types';
import { EditorHeader } from '@/app/_components/EditorHeader';
import type { PublishResult } from '@/app/_components/PublishDialog';
import { AffordancePulse } from './AffordancePulse';
import { ContextualHintOverlay } from './ContextualHintOverlay';
import { EditorCanvas } from './EditorCanvas';
import { ExportDialog } from './ExportDialog';
import { LuminanceToggle } from './LuminanceToggle';
import type { LayerLifecycleCommand } from './LayerPanel';
import { Sidebar } from './Sidebar';
import { TemplateGate } from './TemplateGate';
import { useTemplateGate } from './useTemplateGate';
import { ViewportUV } from './ViewportUV';
import dynamic from 'next/dynamic';

// M11: lazy-load the PublishDialog — both the dialog and its
// onPublish handler (which dynamically imports the OG generator
// from lib/editor/og-image.ts) stay out of the editor critical
// path until the user clicks Publish.
const PublishDialog = dynamic(
  () => import('@/app/_components/PublishDialog').then((m) => m.PublishDialog),
  { ssr: false },
);

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

  // M8 Unit 2: export dialog open state.
  const [exportOpen, setExportOpen] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);

  // M8 Unit 7/8: first-paint sequence.
  //
  // Fires once per session when (a) hydration completed and (b) no
  // template has been applied (lastAppliedTemplateId === null). A
  // returning user with a saved template skips the sequence — they
  // know the app.
  //
  // Sequence:
  //   t=0   → set data-first-paint="true" on root; CSS glow on brush radio
  //   t=600 → clear the data attribute (glow fades naturally)
  //   t=700 → setActiveContextualHint("Try painting — click anywhere.")
  //   t=1000→ setPulseTarget("brush") (M7 AffordancePulse clears at +600ms)
  //   t=1600→ if no stroke fired, bump firstPaintPulseKey for Y-rotation
  //
  // Cancelled on first stroke OR component unmount. Timer bundle
  // follows the M7 `cancelActiveTransition()` pattern.
  const [firstPaintActive, setFirstPaintActive] = useState(false);
  const firstPaintFiredRef = useRef(false);
  const firstPaintTimersRef = useRef<{
    glow: ReturnType<typeof setTimeout> | null;
    hint: ReturnType<typeof setTimeout> | null;
    pulse: ReturnType<typeof setTimeout> | null;
    pulseKey: ReturnType<typeof setTimeout> | null;
  }>({ glow: null, hint: null, pulse: null, pulseKey: null });

  const cancelFirstPaint = useCallback(() => {
    const t = firstPaintTimersRef.current;
    if (t.glow !== null) clearTimeout(t.glow);
    if (t.hint !== null) clearTimeout(t.hint);
    if (t.pulse !== null) clearTimeout(t.pulse);
    if (t.pulseKey !== null) clearTimeout(t.pulseKey);
    firstPaintTimersRef.current = {
      glow: null,
      hint: null,
      pulse: null,
      pulseKey: null,
    };
    setFirstPaintActive(false);
  }, []);

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

  // M8 Unit 7/8: first-paint trigger. Runs exactly once per session,
  // when hydration settles with no template applied. Reload with a
  // template restored skips the sequence (returning-user assumption).
  useEffect(() => {
    if (hydrationPending) return;
    if (firstPaintFiredRef.current) return;
    const lastApplied = useEditorStore.getState().lastAppliedTemplateId;
    if (lastApplied !== null) return;
    firstPaintFiredRef.current = true;
    setFirstPaintActive(true);

    const timers = firstPaintTimersRef.current;
    timers.glow = setTimeout(() => {
      setFirstPaintActive(false);
    }, TIMING.FIRST_PAINT_GLOW_MS);
    timers.hint = setTimeout(() => {
      useEditorStore.getState().setActiveContextualHint(
        'Try painting — click anywhere on the model.',
      );
    }, TIMING.HINT_DELAY_MS);
    timers.pulse = setTimeout(() => {
      useEditorStore.getState().setPulseTarget('brush');
    }, TIMING.PULSE_DELAY_MS);
    timers.pulseKey = setTimeout(() => {
      if (useEditorStore.getState().strokeActive) return;
      if (useEditorStore.getState().hasEditedSinceTemplate) return;
      // Reuse yRotationPulseKey — first-paint and apply-template
      // pulses never overlap (apply-template requires a user action
      // after mount, by which time first-paint has completed).
      setYRotationPulseKey((k) => k + 1);
    }, TIMING.FIRST_PAINT_PULSE_MS);

    return () => {
      cancelFirstPaint();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrationPending]);

  // First-paint cancellation on first stroke — the M7 markEdited chokepoint
  // flips hasEditedSinceTemplate; when it flips true while the first-paint
  // sequence is active, cancel pending timers.
  useEffect(() => {
    return useEditorStore.subscribe((state, prev) => {
      if (!prev.hasEditedSinceTemplate && state.hasEditedSinceTemplate) {
        cancelFirstPaint();
      }
    });
  }, [cancelFirstPaint]);

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

      // M8 Unit 6: L (no modifiers) toggles luminance. Same focus-guard
      // conventions as the undo shortcut. Checked before the Cmd/Z
      // branch because L is a plain-key shortcut.
      if (!e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) {
        if (e.key.toLowerCase() === 'l') {
          e.preventDefault();
          const store = useEditorStore.getState();
          store.setLuminanceEnabled(!store.luminanceEnabled);
          return;
        }
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

  // M11 Unit 6: publish flow.
  //
  // PublishDialog's onPublish handler is the seam that ties together
  // M8's exportLayersToBlob (the PNG), M11 Unit 2's generateOGImage
  // (the 1200x630 WebP), and M11 Unit 5's /api/skins/publish route.
  // Heavy three.js code for OG generation is imported dynamically so
  // it stays off the editor's critical path.
  const handlePublish = useCallback(
    async (meta: { name: string; tags: string[] }): Promise<PublishResult> => {
      if (bundle === null) {
        throw new Error('Editor not ready');
      }
      const [
        { exportLayersToBlob },
        { generateOGImage },
        { generateThumbnail },
      ] = await Promise.all([
        import('@/lib/editor/export'),
        import('@/lib/editor/og-image'),
        import('@/lib/editor/thumbnail'),
      ]);

      const pngBlob = await exportLayersToBlob(layersRef.current);
      // OG (1200×630) and thumbnail (128×128) are generated sequentially
      // rather than in parallel: each spins up its own WebGLRenderer, so
      // running in parallel would double the GPU memory high-water mark
      // and doubles the risk of a tab-level WebGL context loss on weaker
      // machines. Sequential is ~200ms slower on a fast laptop but
      // safer for the long tail of users.
      const canvasSource = bundle.textureManager.getCanvas();
      const ogBlob = await generateOGImage(canvasSource, variant);
      const thumbBlob = await generateThumbnail(canvasSource, variant);

      // Bearer-token auth path — cookie-free. Grab a fresh Firebase
      // ID token client-side and send it in the Authorization header.
      // The server verifies it directly with the Admin SDK. This
      // bypasses any Vercel edge layer (Deployment Protection, etc.)
      // that may strip Set-Cookie headers from the session route.
      const { getFirebase } = await import('@/lib/firebase/client');
      const { auth } = getFirebase();
      const currentUser = auth.currentUser;
      if (currentUser === null) {
        throw new Error(
          'You are not signed in. Click Sign In in the top right, then try Publish again.',
        );
      }
      const idToken = await currentUser.getIdToken(/* forceRefresh */ false);

      const form = new FormData();
      form.append('name', meta.name);
      for (const tag of meta.tags) form.append('tags', tag);
      form.append('variant', variant);
      form.append('skinPng', pngBlob, 'skin.png');
      if (ogBlob !== null) {
        form.append('ogWebp', ogBlob, 'skin-og.webp');
      }
      if (thumbBlob !== null) {
        form.append('thumbWebp', thumbBlob, 'skin-thumb.webp');
      }

      const res = await fetch('/api/skins/publish', {
        method: 'POST',
        body: form,
        credentials: 'include',
        headers: {
          Authorization: `Bearer ${idToken}`,
        },
      });

      if (!res.ok) {
        let msg = `Publish failed (HTTP ${res.status})`;
        let debugStr = '';
        try {
          const data = (await res.json()) as {
            error?: string;
            debug?: Record<string, unknown>;
          };
          if (typeof data.error === 'string' && data.error.length > 0) {
            msg = data.error;
          }
          if (data.debug !== undefined) {
            debugStr = JSON.stringify(data.debug);
            console.error('publish debug:', data.debug);
          }
        } catch {
          // response wasn't JSON — use the generic message
        }
        const fullMsg = debugStr !== '' ? `${msg}\n\n${debugStr}` : msg;
        throw new Error(fullMsg);
      }
      const data = (await res.json()) as {
        skinId: string;
        permalinkUrl: string;
        ogImageUrl: string | null;
      };
      return {
        skinId: data.skinId,
        permalinkUrl:
          typeof window !== 'undefined'
            ? `${window.location.origin}${data.permalinkUrl}`
            : data.permalinkUrl,
        ogImageUrl: data.ogImageUrl,
      };
    },
    [bundle, variant],
  );

  // M10: h-dvh - 3.5rem leaves 56px (h-14) at the top for the fixed
  // EditorHeader, so the 2D + 3D + sidebar flex layout fits in the
  // remaining viewport.
  return (
    <>
      <EditorHeader onPublishClick={() => setPublishOpen(true)} />
      <div
        className="flex h-[calc(100dvh-3.5rem)] w-dvw flex-col sm:flex-row"
        data-first-paint={firstPaintActive ? 'true' : undefined}
      >
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
        {/* M8 Unit 6: luminance mode pill */}
        <LuminanceToggle />
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
          onOpenExport={() => setExportOpen(true)}
        />
      </aside>

      {/* M8 Unit 2: export dialog */}
      <ExportDialog
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        getLayers={() => layersRef.current}
      />

      {/* M11 Unit 6: publish dialog — lazy-loaded. */}
      <PublishDialog
        isOpen={publishOpen}
        onClose={() => setPublishOpen(false)}
        onPublish={handlePublish}
      />
    </div>
    </>
  );
}
