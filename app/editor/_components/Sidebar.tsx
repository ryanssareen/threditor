'use client';

import type { BrushSize, SavingState } from '@/lib/editor/store';
import { useEditorStore } from '@/lib/editor/store';
import type { SkinVariant } from '@/lib/editor/types';
import { ColorPicker } from './ColorPicker';
import { LayerPanel, type LayerLifecycleCommand } from './LayerPanel';
import { TemplateMenuButton } from './TemplateMenuButton';
import { Toolbar } from './Toolbar';
import { UndoRedoControls } from './UndoRedoControls';

type SidebarProps = {
  className?: string;
  onLayerUndoPush?: (cmd: LayerLifecycleCommand) => void;
  /**
   * M7 Unit 0: user-initiated variant toggle callback. EditorLayout
   * wires this to clear the undo stack before the variant flips (the
   * store's setVariant clears layers atomically so the TM reseeds a
   * placeholder). If omitted, VariantToggle falls back to calling
   * setVariant directly.
   */
  onUserVariantChange?: (next: SkinVariant) => void;
  /** M7 Unit 6: open the template picker via the menu path (source:'menu'). */
  onOpenTemplateMenu?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
  onUndo?: () => void;
  onRedo?: () => void;
};

export function Sidebar({
  className,
  onLayerUndoPush,
  onUserVariantChange,
  onOpenTemplateMenu,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
}: SidebarProps) {
  return (
    <div
      className={`flex h-full w-full flex-col gap-4 overflow-y-auto p-4 ${className ?? ''}`}
    >
      {onOpenTemplateMenu !== undefined && (
        <TemplateMenuButton onOpen={onOpenTemplateMenu} />
      )}
      <Toolbar />
      {onUndo !== undefined && onRedo !== undefined && (
        <UndoRedoControls
          canUndo={canUndo ?? false}
          canRedo={canRedo ?? false}
          onUndo={onUndo}
          onRedo={onRedo}
        />
      )}
      <VariantToggle onUserVariantChange={onUserVariantChange} />
      <BrushSizeRadio />
      <ColorPicker />
      <LayerPanel onUndoPush={onLayerUndoPush} />
      <SavingStatusChip />
    </div>
  );
}


// ============================================================================
// Variant toggle — Classic / Slim segmented control
// ============================================================================

const VARIANTS: { id: SkinVariant; label: string }[] = [
  { id: 'classic', label: 'Classic' },
  { id: 'slim', label: 'Slim' },
];

function VariantToggle({
  onUserVariantChange,
}: {
  onUserVariantChange?: (next: SkinVariant) => void;
}) {
  const variant = useEditorStore((s) => s.variant);
  const setVariant = useEditorStore((s) => s.setVariant);

  const handleClick = (id: SkinVariant): void => {
    if (onUserVariantChange) {
      onUserVariantChange(id);
    } else {
      setVariant(id);
    }
  };

  return (
    <div
      role="group"
      aria-label="Skin variant"
      className="flex gap-1"
    >
      {VARIANTS.map(({ id, label }) => {
        const pressed = variant === id;
        return (
          <button
            key={id}
            type="button"
            aria-pressed={pressed}
            data-testid={`variant-${id}`}
            onClick={() => handleClick(id)}
            className={`flex-1 rounded-sm border border-ui-border bg-ui-base px-2 py-1 font-mono text-sm text-text-primary hover:border-accent/60 disabled:opacity-50 ${
              pressed ? 'border-accent' : ''
            }`}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

// ============================================================================
// Brush size radio — 4 buttons
// ============================================================================

const BRUSH_SIZES: BrushSize[] = [1, 2, 3, 4];

function BrushSizeRadio() {
  const brushSize = useEditorStore((s) => s.brushSize);
  const setBrushSize = useEditorStore((s) => s.setBrushSize);

  return (
    <div
      role="group"
      aria-label="Brush size"
      data-pulse-target="brush"
      className="flex gap-1"
    >
      {BRUSH_SIZES.map((n) => {
        const pressed = brushSize === n;
        return (
          <button
            key={n}
            type="button"
            aria-pressed={pressed}
            data-testid={`brush-size-${n}`}
            onClick={() => setBrushSize(n)}
            className={`flex-1 rounded-sm border border-ui-border bg-ui-base px-2 py-1 font-mono text-sm text-text-primary hover:border-accent/60 disabled:opacity-50 ${
              pressed ? 'border-accent' : ''
            }`}
          >
            {n}
          </button>
        );
      })}
    </div>
  );
}

// ============================================================================
// Saving status chip
// ============================================================================

const SAVING_CONFIG: Record<
  SavingState,
  { label: string; dotClass: string }
> = {
  pending: { label: 'Saving\u2026', dotClass: 'bg-text-secondary' },
  enabled: { label: 'Saving', dotClass: 'bg-green-500' },
  'disabled:private': {
    label: 'Saving disabled (Private Browsing)',
    dotClass: 'bg-red-500',
  },
  'disabled:quota': {
    label: 'Saving disabled (storage full)',
    dotClass: 'bg-red-500',
  },
  'disabled:error': {
    label: 'Saving disabled (unexpected error)',
    dotClass: 'bg-red-500',
  },
};

function SavingStatusChip() {
  const savingState = useEditorStore((s) => s.savingState);
  const { label, dotClass } = SAVING_CONFIG[savingState];

  return (
    <div className="mt-auto flex items-center gap-2 pt-2">
      <span
        aria-hidden="true"
        className={`h-2 w-2 flex-shrink-0 rounded-full ${dotClass}`}
      />
      <span className="font-mono text-xs text-text-secondary">{label}</span>
    </div>
  );
}
