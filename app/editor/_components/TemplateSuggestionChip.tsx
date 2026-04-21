'use client';

/**
 * M7 Unit 5: floating suggestion chip shown between idle and bottom sheet.
 *
 * Anchored horizontally centred, above the lower viewport edge.
 * Min 44×44 px touch targets on interactive elements (WCAG 2.5.5).
 */

type Props = {
  onOpen: () => void;
  onDismiss: () => void;
};

export function TemplateSuggestionChip({ onOpen, onDismiss }: Props) {
  return (
    <div
      style={{
        position: 'absolute',
        bottom: '20%',
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 40,
      }}
      className="flex items-center gap-1 rounded-full border border-ui-border bg-ui-surface px-4 py-2 shadow-lg"
    >
      <button
        type="button"
        data-testid="template-chip"
        onClick={onOpen}
        className="font-mono text-sm text-text-primary hover:text-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        Try a starting style
      </button>

      <button
        type="button"
        data-testid="template-chip-dismiss"
        aria-label="Dismiss template suggestion"
        onClick={onDismiss}
        style={{ minWidth: 44, minHeight: 44 }}
        className="flex items-center justify-center text-text-secondary hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        ×
      </button>
    </div>
  );
}
