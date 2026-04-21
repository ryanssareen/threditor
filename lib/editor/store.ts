/**
 * M3: the editor's global Zustand store.
 *
 * Design notes (load-bearing for M4+):
 *
 * 1. FLAT STATE TREE. No slice middleware, no immer, no persist middleware.
 *    Zustand v5's base `create` is all we need at M6's surface.
 *
 * 2. NARROW SELECTORS PER SUBSCRIPTION. Every consumer must subscribe with
 *    a narrow selector:
 *        const activeColor = useEditorStore((s) => s.activeColor);
 *    NOT:
 *        const { activeColor } = useEditorStore((s) => s);     // BAD
 *        const activeColor = useEditorStore().activeColor;     // BAD
 *    Broad subscriptions cause every consumer to re-render on every mutation.
 *
 * 3. LOCAL STATE FOR HIGH-FREQUENCY UI. Hover position, SL-square drag, and
 *    wheel/pan intermediate values stay in component state or refs.
 *
 * 4. PERSISTENCE IS EXTERNAL. lib/editor/persistence.ts subscribes to the
 *    store and handles the debounced IDB write per M3 plan amendment 5.
 *
 * 5. (M6) LAYER PIXELS ARE MUTATED IN PLACE. `Layer.pixels` is a
 *    Uint8ClampedArray that stamps write to directly; the store's layer
 *    array identity does NOT change on every stroke. Only layer METADATA
 *    changes (name / opacity / blend / visible) and layer LIFECYCLE
 *    changes (add / delete / reorder) produce a new `layers` array.
 *    Subscribers who need to re-render on pixel changes listen to the
 *    TextureManager's rAF-driven `needsUpdate` flag, not store selectors.
 */

import { create } from 'zustand';

import {
  DEFAULT_PALETTE,
  DEFAULT_PREVIOUS_COLOR,
} from '@/lib/color/palette';
import { pickerStateFromHex, type PickerState } from '@/lib/color/picker-state';
import type { Layer, SkinVariant } from './types';

/**
 * M5: the four paint tools. Mirror was originally scaffolded as a fifth
 * member here but DESIGN §9 describes it as a modifier on subsequent
 * strokes, not a tool swap — it was promoted to its own boolean slot
 * (`mirrorEnabled`) during M5 per plan D1.
 */
export type ToolId = 'pencil' | 'eraser' | 'picker' | 'bucket';

/** Bidirectional hover state (M4 R5/R7). Null when no pixel is hovered. */
export type HoveredPixel = { x: number; y: number; target: 'base' | 'overlay' } | null;

/** Brush size in pixels. Stamp is N×N centered on cursor pixel. */
export type BrushSize = 1 | 2 | 3 | 4;

/** IndexedDB persistence status per plan amendment 5. */
export type SavingState =
  | 'pending'
  | 'enabled'
  | 'disabled:private'
  | 'disabled:quota'
  | 'disabled:error';

export type BlendMode = 'normal' | 'multiply' | 'overlay' | 'screen';

export type EditorState = {
  // Model
  variant: SkinVariant;

  // Tools
  activeTool: ToolId;
  brushSize: BrushSize;

  // Color
  activeColor: PickerState;
  previousColor: PickerState;
  recentSwatches: string[];

  // View
  uvZoom: number;
  uvPan: { x: number; y: number };

  // Hover
  hoveredPixel: HoveredPixel;

  // Mirror modifier (M5).
  mirrorEnabled: boolean;

  // ── M6 multi-layer state ───────────────────────────────────────────
  // Bottom-to-top render order. Paint writes to the layer whose id is
  // `activeLayerId`. Pixels are mutated in place; metadata changes go
  // through the setLayer* actions below which produce a new array.
  layers: Layer[];
  activeLayerId: string;

  // M6 undo guard (plan D10): undo is ignored while the user is in the
  // middle of a stroke (pointerdown → pointerup). Paint surfaces bridge
  // their local paintingRef into this flag.
  strokeActive: boolean;

  // Persistence
  savingState: SavingState;

  // Actions — primitive setters
  setVariant: (v: SkinVariant) => void;
  setActiveTool: (t: ToolId) => void;
  setBrushSize: (n: BrushSize) => void;
  setActiveColor: (next: PickerState) => void;
  swapColors: () => void;
  setMirrorEnabled: (next: boolean) => void;
  toggleMirror: () => void;
  /**
   * Commit a color to the recents FIFO. ONLY call when the color affected
   * pixels (pencil stroke start, bucket fill commit). Do NOT call on picker
   * drag, hex typing, hover, or eyedropper sample.
   */
  commitToRecents: (hex: string) => void;
  setHoveredPixel: (next: HoveredPixel) => void;
  setUvZoom: (z: number) => void;
  setUvPan: (p: { x: number; y: number }) => void;
  setSavingState: (s: SavingState) => void;

  // ── M6 layer actions ────────────────────────────────────────────────
  /**
   * Replace the layers array wholesale. Used by bundle seed + persistence
   * hydration. Also used by undo when restoring a deleted layer (the
   * undo stack calls insertLayerAt which funnels through here internally).
   * Caller is responsible for ensuring activeLayerId still points at a
   * valid layer.
   */
  setLayers: (layers: Layer[]) => void;
  setActiveLayerId: (id: string) => void;
  setStrokeActive: (active: boolean) => void;

  /** Append a new layer at the top (end of array). Returns the new id. */
  addLayer: (layer: Layer) => string;
  /**
   * Restore a layer at a specific index. Used by undo of a delete.
   * The layer's existing id is preserved.
   */
  insertLayerAt: (layer: Layer, index: number) => void;
  /**
   * Remove a layer by id. Returns the { layer, index } that was removed
   * so callers (undo stack) can rebuild the inverse command. If the
   * target was the active layer, active shifts to the layer at the same
   * index (or the new last layer if the removed was last). Refuses to
   * delete the last remaining layer and returns null.
   */
  deleteLayer: (id: string) => { layer: Layer; index: number } | null;
  /** Move a layer from `from` index to `to` index. */
  reorderLayers: (from: number, to: number) => void;
  renameLayer: (id: string, name: string) => void;
  setLayerOpacity: (id: string, opacity: number) => void;
  setLayerBlendMode: (id: string, mode: BlendMode) => void;
  setLayerVisible: (id: string, visible: boolean) => void;
};

const INITIAL_ACTIVE_COLOR = pickerStateFromHex(DEFAULT_PALETTE[0]) ?? {
  h: 0,
  s: 0,
  l: 0,
  hex: '#000000',
};

const INITIAL_PREVIOUS_COLOR = pickerStateFromHex(DEFAULT_PREVIOUS_COLOR) ?? {
  h: 0,
  s: 0,
  l: 0,
  hex: '#ffffff',
};

const RECENTS_MAX = 8;

export const useEditorStore = create<EditorState>((set) => ({
  variant: 'classic',
  activeTool: 'pencil',
  brushSize: 1,

  activeColor: INITIAL_ACTIVE_COLOR,
  previousColor: INITIAL_PREVIOUS_COLOR,
  recentSwatches: [],

  uvZoom: 1,
  uvPan: { x: 0, y: 0 },

  hoveredPixel: null,

  mirrorEnabled: false,

  // M6: seeded empty. useTextureManagerBundle populates on mount.
  layers: [],
  activeLayerId: '',
  strokeActive: false,

  savingState: 'pending',

  // M7 Unit 0: atomic variant flip + layer clear. use-texture-manager's
  // Effect A sees the new variant and disposes+rebuilds the TM; Effect B
  // sees layers.length === 0 and reseeds a fresh placeholder for the new
  // variant. EditorLayout's VariantToggle handler wraps this with an
  // explicit undoStack.clear() since user-toggled variant changes are
  // NOT undoable (D5) — apply-template goes through applyTemplateState
  // which sets variant+layers together without going through setVariant.
  setVariant: (v) =>
    set((prev) => (prev.variant === v ? prev : { variant: v, layers: [] })),
  setActiveTool: (t) => set({ activeTool: t }),
  setBrushSize: (n) => set({ brushSize: n }),

  setActiveColor: (next) =>
    set((prev) =>
      next.hex === prev.activeColor.hex
        ? { activeColor: next }
        : { activeColor: next, previousColor: prev.activeColor },
    ),

  swapColors: () =>
    set((prev) => ({
      activeColor: prev.previousColor,
      previousColor: prev.activeColor,
    })),

  commitToRecents: (hex) =>
    set((prev) => {
      const normalized = hex.toLowerCase();
      const existingHead = prev.recentSwatches[0]?.toLowerCase();
      if (existingHead === normalized) return prev;
      const filtered = prev.recentSwatches.filter(
        (s) => s.toLowerCase() !== normalized,
      );
      filtered.unshift(normalized);
      if (filtered.length > RECENTS_MAX) filtered.length = RECENTS_MAX;
      return { recentSwatches: filtered };
    }),

  setHoveredPixel: (next) =>
    set((prev) =>
      prev.hoveredPixel === null && next === null ? prev : { hoveredPixel: next },
    ),
  setMirrorEnabled: (next) =>
    set((prev) => (prev.mirrorEnabled === next ? prev : { mirrorEnabled: next })),
  toggleMirror: () =>
    set((prev) => ({ mirrorEnabled: !prev.mirrorEnabled })),
  setUvZoom: (z) => set({ uvZoom: z }),
  setUvPan: (p) => set({ uvPan: p }),
  setSavingState: (s) => set({ savingState: s }),

  // ── M6 layer actions ────────────────────────────────────────────────

  setLayers: (layers) =>
    set((prev) => {
      if (prev.layers === layers) return prev;
      const activeStillExists = layers.some((l) => l.id === prev.activeLayerId);
      return {
        layers,
        activeLayerId: activeStillExists
          ? prev.activeLayerId
          : (layers[layers.length - 1]?.id ?? ''),
      };
    }),

  setActiveLayerId: (id) =>
    set((prev) => (prev.activeLayerId === id ? prev : { activeLayerId: id })),

  setStrokeActive: (active) =>
    set((prev) => (prev.strokeActive === active ? prev : { strokeActive: active })),

  addLayer: (layer) => {
    set((prev) => ({
      layers: [...prev.layers, layer],
      activeLayerId: layer.id,
    }));
    return layer.id;
  },

  insertLayerAt: (layer, index) =>
    set((prev) => {
      const next = prev.layers.slice();
      const clamped = Math.max(0, Math.min(index, next.length));
      next.splice(clamped, 0, layer);
      return { layers: next, activeLayerId: layer.id };
    }),

  deleteLayer: (id) => {
    let removed: { layer: Layer; index: number } | null = null;
    set((prev) => {
      if (prev.layers.length <= 1) return prev;
      const index = prev.layers.findIndex((l) => l.id === id);
      if (index < 0) return prev;
      const layer = prev.layers[index];
      removed = { layer, index };
      const next = prev.layers.slice();
      next.splice(index, 1);
      let nextActive = prev.activeLayerId;
      if (prev.activeLayerId === id) {
        const nextIdx = Math.min(index, next.length - 1);
        nextActive = next[nextIdx].id;
      }
      return { layers: next, activeLayerId: nextActive };
    });
    return removed;
  },

  reorderLayers: (from, to) =>
    set((prev) => {
      if (from === to) return prev;
      if (from < 0 || from >= prev.layers.length) return prev;
      if (to < 0 || to >= prev.layers.length) return prev;
      const next = prev.layers.slice();
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return { layers: next };
    }),

  renameLayer: (id, name) =>
    set((prev) => {
      if (name.length === 0) return prev;
      const idx = prev.layers.findIndex((l) => l.id === id);
      if (idx < 0) return prev;
      if (prev.layers[idx].name === name) return prev;
      const next = prev.layers.slice();
      next[idx] = { ...next[idx], name };
      return { layers: next };
    }),

  setLayerOpacity: (id, opacity) =>
    set((prev) => {
      const clamped = opacity < 0 ? 0 : opacity > 1 ? 1 : opacity;
      const idx = prev.layers.findIndex((l) => l.id === id);
      if (idx < 0) return prev;
      if (prev.layers[idx].opacity === clamped) return prev;
      const next = prev.layers.slice();
      next[idx] = { ...next[idx], opacity: clamped };
      return { layers: next };
    }),

  setLayerBlendMode: (id, mode) =>
    set((prev) => {
      const idx = prev.layers.findIndex((l) => l.id === id);
      if (idx < 0) return prev;
      if (prev.layers[idx].blendMode === mode) return prev;
      const next = prev.layers.slice();
      next[idx] = { ...next[idx], blendMode: mode };
      return { layers: next };
    }),

  setLayerVisible: (id, visible) =>
    set((prev) => {
      const idx = prev.layers.findIndex((l) => l.id === id);
      if (idx < 0) return prev;
      if (prev.layers[idx].visible === visible) return prev;
      const next = prev.layers.slice();
      next[idx] = { ...next[idx], visible };
      return { layers: next };
    }),
}));
