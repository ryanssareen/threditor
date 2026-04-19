'use client';

import { useEffect } from 'react';

import type { ToolId } from '@/lib/editor/store';
import { useEditorStore } from '@/lib/editor/store';

type ToolDef = {
  id: ToolId;
  label: string;
  enabled: boolean;
};

const TOOLS: ToolDef[] = [
  { id: 'pencil', label: 'Pencil', enabled: true },
  { id: 'eraser', label: 'Eraser (M5)', enabled: false },
  { id: 'picker', label: 'Picker (M5)', enabled: false },
  { id: 'bucket', label: 'Bucket (M5)', enabled: false },
  { id: 'mirror', label: 'Mirror (M5)', enabled: false },
];

export function Toolbar({ className }: { className?: string }) {
  const activeTool = useEditorStore((s) => s.activeTool);
  const setActiveTool = useEditorStore((s) => s.setActiveTool);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key !== 'b' && e.key !== 'B') return;
      const target = e.target as HTMLElement | null;
      if (!target) return;
      const tag = target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (target.isContentEditable) return;
      setActiveTool('pencil');
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [setActiveTool]);

  return (
    <div className={className}>
      <div className="flex flex-col gap-1">
        {TOOLS.map(({ id, label, enabled }) => {
          const isActive = activeTool === id;
          return enabled ? (
            <button
              key={id}
              data-testid={`tool-${id}`}
              aria-pressed={isActive}
              onClick={() => setActiveTool(id)}
              className={[
                'bg-ui-surface border border-ui-border text-text-primary',
                'font-mono text-sm px-3 py-2 rounded-sm text-left',
                'hover:border-accent transition-colors',
                isActive ? 'border-accent' : '',
              ]
                .filter(Boolean)
                .join(' ')}
            >
              {label}
            </button>
          ) : (
            <button
              key={id}
              data-testid={`tool-${id}`}
              disabled
              aria-disabled={true}
              className={[
                'bg-ui-surface border border-ui-border text-text-primary',
                'font-mono text-sm px-3 py-2 rounded-sm text-left',
                'opacity-50 cursor-not-allowed',
              ].join(' ')}
            >
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
