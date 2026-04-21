'use client';

/**
 * M7 Unit 6: template picker bottom sheet.
 *
 * - Full-width, anchored to bottom, max-height ~50vh.
 * - Focus trap: Tab cycles within the sheet.
 * - Esc → onCloseTransient.
 * - Backdrop click → onCloseTransient.
 * - × button behaviour depends on `source` prop (see D10).
 * - ARIA: role="dialog" + aria-modal="true".
 */

import { useEffect, useRef, useState } from 'react';

import type { TemplateCategory, TemplateManifest, TemplateMeta } from '@/lib/editor/types';
import { TemplateCard } from './TemplateCard';

type Props = {
  manifest: TemplateManifest | null;
  source: 'ghost' | 'menu';
  onSelect: (template: TemplateMeta) => void;
  onCloseTransient: () => void;
  onClosePersistent: () => void;
};

// ─── Focus trap helpers ───────────────────────────────────────────────────

const FOCUSABLE_SELECTORS =
  'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"]), input:not([disabled]), textarea:not([disabled]), select:not([disabled])';

function getFocusable(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTORS));
}

// ─── Skeleton card ────────────────────────────────────────────────────────

function SkeletonCard() {
  return (
    <div
      className="flex flex-col gap-1 rounded-md border border-ui-border bg-ui-base p-2"
      style={{ minWidth: 120 }}
      aria-hidden="true"
    >
      <div
        className="rounded bg-ui-surface"
        style={{ width: '100%', aspectRatio: '1' }}
      />
      <div className="h-3 w-3/4 rounded bg-ui-surface" />
      <div className="h-3 w-1/2 rounded bg-ui-surface" />
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────

export function TemplateBottomSheet({
  manifest,
  source,
  onSelect,
  onCloseTransient,
  onClosePersistent,
}: Props) {
  const sheetRef = useRef<HTMLDivElement>(null);

  // Track the active category tab.
  const firstCategory = manifest?.categories[0] ?? null;
  const [activeCatId, setActiveCatId] = useState<string>(firstCategory?.id ?? '');

  // Keep activeCatId in sync when manifest loads.
  useEffect(() => {
    if (manifest !== null && activeCatId === '') {
      setActiveCatId(manifest.categories[0]?.id ?? '');
    }
  }, [manifest, activeCatId]);

  // Focus the first focusable element on mount.
  useEffect(() => {
    const sheet = sheetRef.current;
    if (sheet === null) return;
    const focusable = getFocusable(sheet);
    focusable[0]?.focus();
  }, []);

  // Focus trap: Tab / Shift-Tab cycle within the sheet.
  useEffect(() => {
    const sheet = sheetRef.current;
    if (sheet === null) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCloseTransient();
        return;
      }

      if (e.key !== 'Tab') return;

      const focusable = getFocusable(sheet);
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onCloseTransient]);

  const handleCloseButton = () => {
    if (source === 'ghost') {
      onClosePersistent();
    } else {
      onCloseTransient();
    }
  };

  // Determine which templates to show.
  const activeCategory: TemplateCategory | null =
    manifest?.categories.find((c) => c.id === activeCatId) ??
    manifest?.categories[0] ??
    null;

  return (
    <>
      {/* Backdrop */}
      <div
        data-testid="template-sheet-backdrop"
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 49,
          background: 'rgba(0,0,0,0.4)',
        }}
        onClick={onCloseTransient}
        aria-hidden="true"
      />

      {/* Sheet */}
      <div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="template-sheet-title"
        data-testid="template-sheet"
        style={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          zIndex: 50,
          maxHeight: '50vh',
          display: 'flex',
          flexDirection: 'column',
        }}
        className="rounded-t-xl border-t border-ui-border bg-ui-surface"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-ui-border px-4 py-3">
          <h2
            id="template-sheet-title"
            className="font-mono text-sm font-medium text-text-primary"
          >
            Start with a template
          </h2>
          <button
            type="button"
            aria-label="Close template picker"
            onClick={handleCloseButton}
            data-testid="template-sheet-close"
            className="flex h-8 w-8 items-center justify-center rounded text-text-secondary hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            ×
          </button>
        </div>

        {/* Category tabs */}
        {manifest !== null && manifest.categories.length > 0 && (
          <div
            role="tablist"
            aria-label="Template categories"
            className="flex gap-1 overflow-x-auto border-b border-ui-border px-4 py-2"
          >
            {manifest.categories.map((cat) => (
              <button
                key={cat.id}
                type="button"
                role="tab"
                aria-selected={activeCatId === cat.id}
                onClick={() => setActiveCatId(cat.id)}
                data-testid={`template-tab-${cat.id}`}
                className={`shrink-0 rounded-sm border border-ui-border px-3 py-1 font-mono text-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                  activeCatId === cat.id
                    ? 'border-accent text-accent'
                    : 'text-text-secondary hover:text-text-primary'
                }`}
              >
                {cat.label}
              </button>
            ))}
          </div>
        )}

        {/* Card strip */}
        <div
          style={{
            overflowX: 'auto',
            overflowY: 'hidden',
            scrollSnapType: 'x mandatory',
            padding: '12px 16px',
            display: 'flex',
            gap: 8,
          }}
          data-testid="template-card-strip"
        >
          {manifest === null ? (
            <>
              <SkeletonCard />
              <SkeletonCard />
              <SkeletonCard />
            </>
          ) : activeCategory === null ? null : (
            activeCategory.templates.map((tpl) => (
              <TemplateCard key={tpl.id} template={tpl} onClick={() => onSelect(tpl)} />
            ))
          )}
        </div>
      </div>
    </>
  );
}
