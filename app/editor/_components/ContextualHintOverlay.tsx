'use client';

import { useEffect } from 'react';

import { useEditorStore } from '@/lib/editor/store';

export function ContextualHintOverlay() {
  const hint = useEditorStore((s) => s.activeContextualHint);

  useEffect(() => {
    if (hint === null) return;

    let listenerId: ReturnType<typeof setTimeout> | null = null;

    listenerId = setTimeout(() => {
      const handler = () => {
        useEditorStore.getState().clearContextualHint();
      };
      document.addEventListener('pointerdown', handler, { once: true });
    }, 100);

    return () => {
      if (listenerId !== null) clearTimeout(listenerId);
    };
  }, [hint]);

  if (hint === null) return null;

  return (
    <div
      data-testid="contextual-hint"
      role="status"
      aria-live="polite"
      className="pointer-events-none absolute left-1/2 top-4 z-50 -translate-x-1/2"
    >
      <div className="relative rounded-md border border-ui-border bg-ui-surface px-3 py-2 shadow-panel">
        <span className="text-sm text-text-primary">{hint}</span>
        {/* caret pointing down */}
        <span
          aria-hidden="true"
          className="absolute left-1/2 top-full -translate-x-1/2 border-4 border-transparent border-t-ui-border"
        />
        <span
          aria-hidden="true"
          className="absolute left-1/2 top-full -translate-x-1/2 translate-y-[-1px] border-4 border-transparent border-t-ui-surface"
        />
      </div>
    </div>
  );
}
