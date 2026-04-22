'use client';

type UndoRedoControlsProps = {
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
};

export function UndoRedoControls({
  canUndo,
  canRedo,
  onUndo,
  onRedo,
}: UndoRedoControlsProps) {
  return (
    <div
      role="group"
      aria-label="History"
      className="flex gap-1"
    >
      <button
        type="button"
        data-testid="undo-button"
        aria-label="Undo"
        title="Undo (⌘Z)"
        disabled={!canUndo}
        onClick={onUndo}
        className="flex-1 rounded-sm border border-ui-border bg-ui-surface px-2 py-1 font-mono text-sm text-text-primary hover:border-accent transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
      >
        Undo
      </button>
      <button
        type="button"
        data-testid="redo-button"
        aria-label="Redo"
        title="Redo (⇧⌘Z)"
        disabled={!canRedo}
        onClick={onRedo}
        className="flex-1 rounded-sm border border-ui-border bg-ui-surface px-2 py-1 font-mono text-sm text-text-primary hover:border-accent transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
      >
        Redo
      </button>
    </div>
  );
}
