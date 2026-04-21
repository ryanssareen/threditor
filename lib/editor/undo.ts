/**
 * M6: undo/redo command stack.
 *
 * Stack semantics per DESIGN §8 (amended by M6 plan):
 *
 *   - Push truncates the redo tail, appends the command, then evicts
 *     oldest while over either cap (bytes or count).
 *   - Undo applies the current command's `before`; redo applies the
 *     next command's `after`.
 *   - A redo whose target layer no longer exists silently advances
 *     the cursor (plan D9) — rebuilding a deleted layer from patches
 *     would require whole-layer snapshots, breaking the memory budget.
 *   - Undo is ignored while a stroke is active (plan D10).
 *
 * The stack is layer-structure-aware: layer-lifecycle commands
 * (add/delete/reorder/rename/opacity/blend/visibility) sit in the same
 * stack as pixel strokes per plan D3.
 *
 * This module is pure logic — no React imports, no zustand imports.
 * Callers (Unit 7 EditorLayout) plumb the store's action setters in
 * via the `EditorActions` adapter.
 */

import { applyRegion } from './diff';
import type { BlendMode } from './store';
import type { ApplyTemplateSnapshot, Layer, Stroke } from './types';

export const MAX_HISTORY_COUNT = 100;
export const MAX_HISTORY_BYTES = 5 * 1024 * 1024; // 5 MB

export type Command =
  | { kind: 'stroke'; stroke: Stroke }
  | { kind: 'layer-add'; layer: Layer; insertedAt: number }
  | { kind: 'layer-delete'; layer: Layer; removedFrom: number }
  | { kind: 'layer-reorder'; from: number; to: number }
  | { kind: 'layer-rename'; id: string; before: string; after: string }
  | { kind: 'layer-opacity'; id: string; before: number; after: number }
  | { kind: 'layer-blend'; id: string; before: BlendMode; after: BlendMode }
  | { kind: 'layer-visibility'; id: string; before: boolean; after: boolean }
  | {
      // M7: apply-template is a whole-document swap. before/after carry
      // layers + activeLayerId + variant + hasEditedSinceTemplate +
      // lastAppliedTemplateId. Undo/redo routes through
      // EditorActions.applyTemplateSnapshot which calls the store's
      // applyTemplateState atomic setter.
      kind: 'apply-template';
      before: ApplyTemplateSnapshot;
      after: ApplyTemplateSnapshot;
    };

/**
 * Minimal adapter the undo stack needs to mutate the store + layer
 * pixel buffers. The adapter is plumbed in by the owning component
 * (EditorLayout) so the stack stays pure of React / zustand imports.
 */
export type EditorActions = {
  /** Read the live layers array (reference into store). */
  getLayers: () => Layer[];
  /** Bypass-undo pixel write for stroke undo/redo. */
  setLayerPixelRegion: (
    layerId: string,
    bbox: { x: number; y: number; w: number; h: number },
    region: Uint8ClampedArray,
  ) => void;
  /** Structure helpers (store actions; these do not push to the stack). */
  insertLayerAt: (layer: Layer, index: number) => void;
  deleteLayer: (id: string) => void;
  reorderLayers: (from: number, to: number) => void;
  setLayerName: (id: string, name: string) => void;
  setLayerOpacity: (id: string, opacity: number) => void;
  setLayerBlendMode: (id: string, mode: BlendMode) => void;
  setLayerVisible: (id: string, visible: boolean) => void;
  /** Recomposite trigger after an undo/redo changes state. */
  recomposite: () => void;
  /** True while a pointer stroke is still in flight (D10). */
  strokeActive: () => boolean;
  /**
   * M7: apply an ApplyTemplateSnapshot in one atomic store write. Called
   * by undo/redo of apply-template commands. The adapter is expected to
   * also cancel any in-flight transition timers before swapping state.
   */
  applyTemplateSnapshot: (snapshot: ApplyTemplateSnapshot) => void;
};

/** Size estimate in bytes. Includes patch before/after + small constant. */
function sizeOfCommand(cmd: Command): number {
  if (cmd.kind === 'stroke') {
    let n = 128; // record overhead
    for (const p of cmd.stroke.patches) {
      n += p.before.byteLength + p.after.byteLength + 32;
    }
    return n;
  }
  if (cmd.kind === 'layer-add' || cmd.kind === 'layer-delete') {
    // Cost is dominated by the layer's pixels buffer.
    return 64 + cmd.layer.pixels.byteLength;
  }
  if (cmd.kind === 'apply-template') {
    // Sum pre + post layer pixel bytes. Metadata is ~128 bytes.
    let n = 128;
    for (const l of cmd.before.layers) n += l.pixels.byteLength;
    for (const l of cmd.after.layers) n += l.pixels.byteLength;
    return n;
  }
  // Rename / opacity / blend / visibility / reorder — tiny records.
  return 64;
}

export class UndoStack {
  private commands: Command[] = [];
  private cursor = -1;
  private bytes = 0;

  push(cmd: Command): void {
    // Truncate redo tail.
    if (this.cursor < this.commands.length - 1) {
      for (let i = this.cursor + 1; i < this.commands.length; i++) {
        this.bytes -= sizeOfCommand(this.commands[i]);
      }
      this.commands.length = this.cursor + 1;
    }
    this.commands.push(cmd);
    this.cursor = this.commands.length - 1;
    this.bytes += sizeOfCommand(cmd);

    // Evict-oldest while over either cap. D4.
    while (
      this.commands.length > MAX_HISTORY_COUNT ||
      this.bytes > MAX_HISTORY_BYTES
    ) {
      const evicted = this.commands.shift();
      if (evicted === undefined) break;
      this.bytes -= sizeOfCommand(evicted);
      this.cursor -= 1;
    }
  }

  canUndo(): boolean {
    return this.cursor >= 0;
  }

  canRedo(): boolean {
    return this.cursor < this.commands.length - 1;
  }

  undo(actions: EditorActions): boolean {
    if (actions.strokeActive()) return false;
    if (this.cursor < 0) return false;
    const cmd = this.commands[this.cursor];
    applyCommand(actions, cmd, 'before');
    this.cursor -= 1;
    actions.recomposite();
    return true;
  }

  redo(actions: EditorActions): boolean {
    if (actions.strokeActive()) return false;
    if (this.cursor >= this.commands.length - 1) return false;
    this.cursor += 1;
    const cmd = this.commands[this.cursor];
    applyCommand(actions, cmd, 'after');
    actions.recomposite();
    return true;
  }

  bytesUsed(): number {
    return this.bytes;
  }

  length(): number {
    return this.commands.length;
  }

  /** Visible for tests; do not rely on in production. */
  cursorIndex(): number {
    return this.cursor;
  }

  clear(): void {
    this.commands = [];
    this.cursor = -1;
    this.bytes = 0;
  }
}

/**
 * Apply a single command in the given direction. 'before' is undo
 * direction (restore the prior state); 'after' is redo direction
 * (re-apply the change).
 */
function applyCommand(
  actions: EditorActions,
  cmd: Command,
  dir: 'before' | 'after',
): void {
  switch (cmd.kind) {
    case 'stroke': {
      // Silent-skip if the target layer was deleted after the stroke
      // was recorded (D9).
      const layers = actions.getLayers();
      if (!layers.some((l) => l.id === cmd.stroke.layerId)) return;
      for (const patch of cmd.stroke.patches) {
        const region = dir === 'before' ? patch.before : patch.after;
        actions.setLayerPixelRegion(cmd.stroke.layerId, patch.bbox, region);
      }
      return;
    }
    case 'layer-add': {
      if (dir === 'before') {
        actions.deleteLayer(cmd.layer.id);
      } else {
        actions.insertLayerAt(cmd.layer, cmd.insertedAt);
      }
      return;
    }
    case 'layer-delete': {
      if (dir === 'before') {
        actions.insertLayerAt(cmd.layer, cmd.removedFrom);
      } else {
        actions.deleteLayer(cmd.layer.id);
      }
      return;
    }
    case 'layer-reorder': {
      if (dir === 'before') {
        actions.reorderLayers(cmd.to, cmd.from);
      } else {
        actions.reorderLayers(cmd.from, cmd.to);
      }
      return;
    }
    case 'layer-rename': {
      actions.setLayerName(cmd.id, dir === 'before' ? cmd.before : cmd.after);
      return;
    }
    case 'layer-opacity': {
      actions.setLayerOpacity(cmd.id, dir === 'before' ? cmd.before : cmd.after);
      return;
    }
    case 'layer-blend': {
      actions.setLayerBlendMode(cmd.id, dir === 'before' ? cmd.before : cmd.after);
      return;
    }
    case 'layer-visibility': {
      actions.setLayerVisible(cmd.id, dir === 'before' ? cmd.before : cmd.after);
      return;
    }
    case 'apply-template': {
      // M7: whole-document snapshot swap. The adapter is responsible
      // for cancelling any in-flight transition timers before the
      // store write so a stale +700ms hint / +1000ms pulse timer
      // doesn't fire against the newly-restored state.
      const snapshot = dir === 'before' ? cmd.before : cmd.after;
      actions.applyTemplateSnapshot(snapshot);
      return;
    }
  }
}

/**
 * Helper: write a pixel region to a specific layer's buffer. Exposed so
 * the EditorActions adapter can wire this up directly — it's the same
 * operation diff.applyRegion does, plus a layer lookup.
 */
export function writeLayerRegion(
  layers: readonly Layer[],
  layerId: string,
  bbox: { x: number; y: number; w: number; h: number },
  region: Uint8ClampedArray,
): boolean {
  const layer = layers.find((l) => l.id === layerId);
  if (layer === undefined) return false;
  applyRegion(layer.pixels, bbox, region);
  return true;
}
