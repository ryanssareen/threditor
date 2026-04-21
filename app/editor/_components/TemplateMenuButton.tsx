'use client';

/**
 * M7 Unit 6: sidebar button that opens the template picker via the menu path.
 *
 * source:'menu' — dismiss from this flow does NOT persist templates-dismissed
 * (D10). The button is always visible so returning users can re-browse.
 */

type Props = {
  onOpen: () => void;
};

export function TemplateMenuButton({ onOpen }: Props) {
  return (
    <button
      type="button"
      aria-label="Templates"
      data-testid="template-menu-button"
      onClick={onOpen}
      className="flex w-full items-center gap-2 rounded-sm border border-ui-border bg-ui-base px-3 py-2 font-mono text-sm text-text-primary hover:border-accent/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
    >
      {/* CSS-only grid icon */}
      <span aria-hidden="true" className="flex flex-col gap-[3px]">
        {[0, 1, 2].map((row) => (
          <span key={row} className="flex gap-[3px]">
            {[0, 1, 2].map((col) => (
              <span
                key={col}
                className="h-[4px] w-[4px] rounded-[1px] bg-text-secondary"
              />
            ))}
          </span>
        ))}
      </span>
      Templates
    </button>
  );
}
