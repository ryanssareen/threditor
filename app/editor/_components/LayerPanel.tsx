'use client';

/**
 * M6 LayerPanel — add / delete / reorder / rename / opacity / blend /
 * visibility. Renders top-to-bottom (top UI row = top visual layer =
 * last entry in `store.layers[]`).
 *
 * Layer-lifecycle actions optionally push to the undo stack via the
 * `onUndoPush` callback (wired by EditorLayout in Unit 7). When the
 * callback is absent (tests, standalone renders) the panel mutates the
 * store directly without undo support.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';

import type { BlendMode } from '@/lib/editor/store';
import { useEditorStore } from '@/lib/editor/store';
import type { Layer } from '@/lib/editor/types';

export type LayerLifecycleCommand =
  | { kind: 'layer-add'; layer: Layer; insertedAt: number }
  | { kind: 'layer-delete'; layer: Layer; removedFrom: number }
  | { kind: 'layer-reorder'; from: number; to: number }
  | { kind: 'layer-rename'; id: string; before: string; after: string }
  | { kind: 'layer-opacity'; id: string; before: number; after: number }
  | { kind: 'layer-blend'; id: string; before: BlendMode; after: BlendMode }
  | { kind: 'layer-visibility'; id: string; before: boolean; after: boolean };

type LayerPanelProps = {
  className?: string;
  onUndoPush?: (cmd: LayerLifecycleCommand) => void;
};

const BLEND_MODES: { value: BlendMode; label: string }[] = [
  { value: 'normal', label: 'Normal' },
  { value: 'multiply', label: 'Multiply' },
  { value: 'overlay', label: 'Overlay' },
  { value: 'screen', label: 'Screen' },
];

function makeBlankPixels(): Uint8ClampedArray {
  return new Uint8ClampedArray(64 * 64 * 4);
}

function uniqueLayerName(existing: Layer[], base: string): string {
  const names = new Set(existing.map((l) => l.name));
  if (!names.has(base)) return base;
  for (let i = 2; i < 1000; i++) {
    const candidate = `${base} ${i}`;
    if (!names.has(candidate)) return candidate;
  }
  return `${base} ${Date.now()}`;
}

function newLayerId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `layer-${Math.random().toString(36).slice(2)}-${Date.now()}`;
}

export function LayerPanel({ className, onUndoPush }: LayerPanelProps) {
  const layers = useEditorStore((s) => s.layers);
  const activeLayerId = useEditorStore((s) => s.activeLayerId);

  // Top-to-bottom UI order. `layers` is bottom-to-top; reverse for
  // rendering but preserve the original array index in `arrayIndex`.
  const rows = useMemo(
    () => layers.map((layer, i) => ({ layer, arrayIndex: i })).reverse(),
    [layers],
  );

  const handleAdd = useCallback(() => {
    const name = uniqueLayerName(layers, 'Layer');
    const layer: Layer = {
      id: newLayerId(),
      name,
      visible: true,
      opacity: 1,
      blendMode: 'normal',
      pixels: makeBlankPixels(),
    };
    useEditorStore.getState().addLayer(layer);
    onUndoPush?.({ kind: 'layer-add', layer, insertedAt: layers.length });
  }, [layers, onUndoPush]);

  return (
    <div
      className={`flex flex-col gap-1 ${className ?? ''}`}
      data-testid="layer-panel"
    >
      <div className="flex items-center justify-between px-1">
        <span className="font-mono text-xs uppercase tracking-wide text-text-secondary">
          Layers
        </span>
        <button
          type="button"
          aria-label="Add layer"
          data-testid="layer-add"
          onClick={handleAdd}
          className="rounded-sm border border-ui-border bg-ui-base px-2 py-0.5 font-mono text-xs text-text-primary hover:border-accent"
        >
          +
        </button>
      </div>

      <ul role="list" className="flex flex-col gap-1">
        {rows.map(({ layer, arrayIndex }) => (
          <LayerRow
            key={layer.id}
            layer={layer}
            arrayIndex={arrayIndex}
            total={layers.length}
            isActive={layer.id === activeLayerId}
            onUndoPush={onUndoPush}
          />
        ))}
      </ul>
    </div>
  );
}

type LayerRowProps = {
  layer: Layer;
  arrayIndex: number;
  total: number;
  isActive: boolean;
  onUndoPush?: (cmd: LayerLifecycleCommand) => void;
};

function LayerRow({ layer, arrayIndex, total, isActive, onUndoPush }: LayerRowProps) {
  const [renaming, setRenaming] = useState(false);
  const [draftName, setDraftName] = useState(layer.name);

  const activate = useCallback(() => {
    useEditorStore.getState().setActiveLayerId(layer.id);
  }, [layer.id]);

  const toggleVisibility = useCallback(() => {
    const before = layer.visible;
    useEditorStore.getState().setLayerVisible(layer.id, !before);
    onUndoPush?.({
      kind: 'layer-visibility',
      id: layer.id,
      before,
      after: !before,
    });
  }, [layer.id, layer.visible, onUndoPush]);

  const commitRename = useCallback(
    (next: string) => {
      const trimmed = next.trim();
      if (trimmed.length === 0 || trimmed === layer.name) {
        setRenaming(false);
        setDraftName(layer.name);
        return;
      }
      useEditorStore.getState().renameLayer(layer.id, trimmed);
      onUndoPush?.({
        kind: 'layer-rename',
        id: layer.id,
        before: layer.name,
        after: trimmed,
      });
      setRenaming(false);
    },
    [layer.id, layer.name, onUndoPush],
  );

  const handleBlendChange = useCallback(
    (next: BlendMode) => {
      if (next === layer.blendMode) return;
      useEditorStore.getState().setLayerBlendMode(layer.id, next);
      onUndoPush?.({
        kind: 'layer-blend',
        id: layer.id,
        before: layer.blendMode,
        after: next,
      });
    },
    [layer.id, layer.blendMode, onUndoPush],
  );

  const moveTowardTop = useCallback(() => {
    // UI "up" = towards top = array index + 1.
    const to = arrayIndex + 1;
    if (to >= total) return;
    useEditorStore.getState().reorderLayers(arrayIndex, to);
    onUndoPush?.({ kind: 'layer-reorder', from: arrayIndex, to });
  }, [arrayIndex, total, onUndoPush]);

  const moveTowardBottom = useCallback(() => {
    // UI "down" = towards bottom = array index - 1.
    const to = arrayIndex - 1;
    if (to < 0) return;
    useEditorStore.getState().reorderLayers(arrayIndex, to);
    onUndoPush?.({ kind: 'layer-reorder', from: arrayIndex, to });
  }, [arrayIndex, onUndoPush]);

  const handleDelete = useCallback(() => {
    if (total <= 1) return;
    const removed = useEditorStore.getState().deleteLayer(layer.id);
    if (removed === null) return;
    onUndoPush?.({
      kind: 'layer-delete',
      layer: removed.layer,
      removedFrom: removed.index,
    });
  }, [layer.id, total, onUndoPush]);

  useEffect(() => {
    if (!renaming) setDraftName(layer.name);
  }, [layer.name, renaming]);

  return (
    <li
      data-testid={`layer-row-${layer.id}`}
      data-active={isActive ? 'true' : 'false'}
      onClick={activate}
      className={`relative flex items-center gap-1 rounded-sm border px-1 py-1 font-mono text-xs ${
        isActive
          ? 'border-accent bg-accent/10 text-text-primary'
          : 'border-ui-border bg-ui-base text-text-secondary hover:border-accent/60'
      }`}
    >
      {isActive ? (
        <span
          aria-hidden="true"
          className="absolute left-0 top-0 h-full w-[3px] rounded-l-sm bg-accent"
        />
      ) : null}

      <button
        type="button"
        aria-label={layer.visible ? 'Hide layer' : 'Show layer'}
        aria-pressed={layer.visible}
        data-testid={`layer-visibility-${layer.id}`}
        onClick={(e) => {
          e.stopPropagation();
          toggleVisibility();
        }}
        className="flex h-6 w-6 items-center justify-center rounded-sm hover:bg-ui-surface"
      >
        {layer.visible ? '◉' : '○'}
      </button>

      <div className="flex-1 min-w-0">
        {renaming ? (
          <input
            type="text"
            value={draftName}
            autoFocus
            data-testid={`layer-name-input-${layer.id}`}
            onChange={(e) => setDraftName(e.target.value)}
            onBlur={() => commitRename(draftName)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitRename(draftName);
              else if (e.key === 'Escape') {
                setRenaming(false);
                setDraftName(layer.name);
              }
            }}
            onClick={(e) => e.stopPropagation()}
            className="w-full rounded-sm border border-ui-border bg-ui-surface px-1 text-text-primary"
          />
        ) : (
          <button
            type="button"
            data-testid={`layer-name-${layer.id}`}
            onDoubleClick={(e) => {
              e.stopPropagation();
              setRenaming(true);
            }}
            className="block w-full truncate text-left"
          >
            {layer.name}
          </button>
        )}
      </div>

      <select
        aria-label="Blend mode"
        data-testid={`layer-blend-${layer.id}`}
        value={layer.blendMode}
        onChange={(e) => handleBlendChange(e.target.value as BlendMode)}
        onClick={(e) => e.stopPropagation()}
        className="rounded-sm border border-ui-border bg-ui-base px-1 py-0.5 text-text-primary"
      >
        {BLEND_MODES.map((m) => (
          <option key={m.value} value={m.value}>
            {m.label}
          </option>
        ))}
      </select>

      <OpacityControl layer={layer} isActive={isActive} onUndoPush={onUndoPush} />

      <div className="flex items-center">
        <button
          type="button"
          aria-label="Move layer up"
          data-testid={`layer-up-${layer.id}`}
          disabled={arrayIndex >= total - 1}
          onClick={(e) => {
            e.stopPropagation();
            moveTowardTop();
          }}
          className="flex h-6 w-5 items-center justify-center rounded-sm hover:bg-ui-surface disabled:opacity-30"
        >
          {'▲'}
        </button>
        <button
          type="button"
          aria-label="Move layer down"
          data-testid={`layer-down-${layer.id}`}
          disabled={arrayIndex <= 0}
          onClick={(e) => {
            e.stopPropagation();
            moveTowardBottom();
          }}
          className="flex h-6 w-5 items-center justify-center rounded-sm hover:bg-ui-surface disabled:opacity-30"
        >
          {'▼'}
        </button>
      </div>

      <button
        type="button"
        aria-label="Delete layer"
        data-testid={`layer-delete-${layer.id}`}
        disabled={total <= 1}
        onClick={(e) => {
          e.stopPropagation();
          handleDelete();
        }}
        className="flex h-6 w-6 items-center justify-center rounded-sm hover:bg-red-500/20 disabled:opacity-30"
      >
        {'×'}
      </button>
    </li>
  );
}

type OpacityControlProps = {
  layer: Layer;
  isActive: boolean;
  onUndoPush?: (cmd: LayerLifecycleCommand) => void;
};

function OpacityControl({ layer, isActive, onUndoPush }: OpacityControlProps) {
  const dragBeforeRef = useRef<number | null>(null);

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLInputElement>) => {
      dragBeforeRef.current = layer.opacity;
      e.stopPropagation();
    },
    [layer.opacity],
  );

  const onChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const v = Number(e.target.value) / 100;
      useEditorStore.getState().setLayerOpacity(layer.id, v);
    },
    [layer.id],
  );

  const onPointerUp = useCallback(() => {
    const before = dragBeforeRef.current;
    const after = useEditorStore.getState().layers.find((l) => l.id === layer.id)?.opacity;
    dragBeforeRef.current = null;
    if (before === null || after === undefined) return;
    if (before === after) return;
    onUndoPush?.({ kind: 'layer-opacity', id: layer.id, before, after });
  }, [layer.id, onUndoPush]);

  if (!isActive) {
    return (
      <span
        data-testid={`layer-opacity-readout-${layer.id}`}
        className="w-10 text-right text-text-secondary"
      >
        {Math.round(layer.opacity * 100)}%
      </span>
    );
  }

  return (
    <input
      type="range"
      aria-label="Layer opacity"
      data-testid={`layer-opacity-${layer.id}`}
      min={0}
      max={100}
      value={Math.round(layer.opacity * 100)}
      onChange={onChange}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onClick={(e) => e.stopPropagation()}
      className="w-16"
    />
  );
}
