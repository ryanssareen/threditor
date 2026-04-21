'use client';

/**
 * M7 Unit 6: a single template card inside the bottom sheet.
 *
 * Thumbnail error state: diagonal-hatch pattern + "Unavailable" label.
 * Card is still clickable when the thumb fails (the apply orchestrator
 * logs a warning on decode failure; the card itself is not disabled).
 */

import { useState } from 'react';

import type { TemplateMeta } from '@/lib/editor/types';

type Props = {
  template: TemplateMeta;
  onClick: () => void;
};

export function TemplateCard({ template, onClick }: Props) {
  const [thumbError, setThumbError] = useState(false);

  const variantLabel = template.variant === 'slim' ? 'Slim' : 'Classic';

  return (
    <button
      type="button"
      data-testid={`template-card-${template.id}`}
      onClick={onClick}
      className="flex flex-col gap-1 rounded-md border border-ui-border bg-ui-base p-2 text-left hover:border-accent/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      style={{ scrollSnapAlign: 'start', minWidth: 120 }}
    >
      {thumbError ? (
        <div
          aria-label="Thumbnail unavailable"
          style={{
            width: '100%',
            aspectRatio: '1',
            background:
              'repeating-linear-gradient(45deg, #333 0px, #333 2px, #222 2px, #222 10px)',
          }}
          className="rounded"
        />
      ) : (
        <img
          src={template.thumbnail}
          alt={template.label}
          onError={() => setThumbError(true)}
          style={{ width: '100%', aspectRatio: '1', objectFit: 'cover' }}
          className="rounded"
        />
      )}

      <span className="truncate font-mono text-xs text-text-primary">
        {thumbError ? 'Unavailable' : template.label}
      </span>

      <span className="inline-block rounded-sm border border-ui-border px-1 font-mono text-xs text-text-secondary">
        {variantLabel}
      </span>
    </button>
  );
}
