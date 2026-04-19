/**
 * M3: the editor's global Zustand store.
 *
 * Design notes (load-bearing for M4+):
 *
 * 1. FLAT STATE TREE. No slice middleware, no immer, no persist middleware.
 *    Zustand v5's base `create` is all we need at M3's surface. If M6's
 *    layer state grows to >15 fields, revisit middleware composition.
 *
 * 2. NARROW SELECTORS PER SUBSCRIPTION. Every consumer must subscribe with
 *    a narrow selector:
 *        const activeColor = useEditorStore((s) => s.activeColor);
 *    NOT:
 *        const { activeColor } = useEditorStore((s) => s);     // BAD
 *        const activeColor = useEditorStore().activeColor;     // BAD
 *    Broad subscriptions cause every consumer to re-render on every mutation.
 *    Amendment 3's ColorPicker re-render regression test enforces this for
 *    HueRing + ColorPicker; extend to any new consumer that appears in M4+.
 *
 * 3. LOCAL STATE FOR HIGH-FREQUENCY UI. Hover position, SL-square drag, and
 *    wheel/pan intermediate values stay in component state or refs. Global
 *    store is for values other components read, not for every-frame state.
 *
 * 4. PERSISTENCE IS EXTERNAL. lib/editor/persistence.ts subscribes to the
 *    store (not via middleware) and handles the debounced IDB write + the
 *    Safari-private / quota race per M3 plan amendment 5.
 */

import { create } from 'zustand';

import {
  DEFAULT_PALETTE,
  DEFAULT_PREVIOUS_COLOR,
} from '@/lib/color/palette';
import { pickerStateFromHex, type PickerState } from '@/lib/color/picker-state';
import type { SkinVariant } from './types';

/** Tools enumerated up-front even though only 'pencil' is active in M3. */
export type ToolId = 'pencil' | 'eraser' | 'picker' | 'bucket' | 'mirror';

/** Brush size in pixels. Stamp is N×N centered on cursor pixel. */
export type BrushSize = 1 | 2 | 3 | 4;

/** IndexedDB persistence status per plan amendment 5. */
export type SavingState =
  | 'pending'
  | 'enabled'
  | 'disabled:private'
  | 'disabled:quota';

export type EditorState = {
  // Model
  variant: SkinVariant;

  // Tools
  activeTool: ToolId;
  brushSize: BrushSize;

  // Color
  activeColor: PickerState;
  /** Offset-rendered previous swatch (A.7). Swaps with activeColor on click. */
  previousColor: PickerState;
  /** FIFO, max 8. Only inserts when a color affects pixels (A.2). */
  recentSwatches: string[];

  // View
  uvZoom: number;
  uvPan: { x: number; y: number };

  // Persistence
  savingState: SavingState;

  // Actions
  setVariant: (v: SkinVariant) => void;
  setActiveTool: (t: ToolId) => void;
  setBrushSize: (n: BrushSize) => void;
  setActiveColor: (next: PickerState) => void;
  swapColors: () => void;
  /**
   * Commit a color to the recents FIFO. ONLY call when the color affected
   * pixels (pencil stroke start, bucket fill commit). Do NOT call on picker
   * drag, hex typing, hover, or eyedropper sample.
   */
  commitToRecents: (hex: string) => void;
  setUvZoom: (z: number) => void;
  setUvPan: (p: { x: number; y: number }) => void;
  setSavingState: (s: SavingState) => void;
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

  savingState: 'pending',

  setVariant: (v) => set({ variant: v }),
  setActiveTool: (t) => set({ activeTool: t }),
  setBrushSize: (n) => set({ brushSize: n }),

  setActiveColor: (next) =>
    set((prev) => ({
      activeColor: next,
      previousColor: prev.activeColor,
    })),

  swapColors: () =>
    set((prev) => ({
      activeColor: prev.previousColor,
      previousColor: prev.activeColor,
    })),

  commitToRecents: (hex) =>
    set((prev) => {
      const normalized = hex.toLowerCase();
      const existingHead = prev.recentSwatches[0]?.toLowerCase();
      // Same-color-twice-in-a-row: no-op (A.2).
      if (existingHead === normalized) return prev;
      // Move-to-front if already present; otherwise insert at head, trim tail.
      const filtered = prev.recentSwatches.filter(
        (s) => s.toLowerCase() !== normalized,
      );
      filtered.unshift(normalized);
      if (filtered.length > RECENTS_MAX) filtered.length = RECENTS_MAX;
      return { recentSwatches: filtered };
    }),

  setUvZoom: (z) => set({ uvZoom: z }),
  setUvPan: (p) => set({ uvPan: p }),
  setSavingState: (s) => set({ savingState: s }),
}));
