'use client';

import { useEffect } from 'react';

import type { ToolId } from '@/lib/editor/store';
import { useEditorStore } from '@/lib/editor/store';

type ToolDef = {
  id: ToolId;
  label: string;
  key: string;
};

const TOOLS: readonly ToolDef[] = [
  { id: 'pencil', label: 'Pencil', key: 'B' },
  { id: 'eraser', label: 'Eraser', key: 'E' },
  { id: 'picker', label: 'Picker', key: 'I' },
  { id: 'bucket', label: 'Bucket', key: 'G' },
];

// Map lowercased shortcut key → tool id. Mirror (M) is handled separately
// because it's a modifier toggle, not a tool swap.
const TOOL_KEY_MAP: Record<string, ToolId> = {
  b: 'pencil',
  e: 'eraser',
  i: 'picker',
  g: 'bucket',
};

export function Toolbar({ className }: { className?: string }) {
  const activeTool = useEditorStore((s) => s.activeTool);
  const setActiveTool = useEditorStore((s) => s.setActiveTool);
  const mirrorEnabled = useEditorStore((s) => s.mirrorEnabled);
  const toggleMirror = useEditorStore((s) => s.toggleMirror);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // M3 P2 #2: guard against Cmd/Ctrl/Alt combos so Cmd+B doesn't
      // swap tools + open the browser bookmark dialog at the same time.
      // Shift is allowed; capitalized keys still fire the same handler.
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const target = e.target as HTMLElement | null;
      if (target !== null && target instanceof HTMLElement) {
        const tag = target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA') return;
        if (target.isContentEditable) return;
        // ColorPicker SL square owns its own arrow-key handler via
        // role="application"; shortcuts shouldn't hijack focus from it.
        if (target.getAttribute('role') === 'application') return;
      }

      const key = e.key.toLowerCase();
      if (key === 'm') {
        toggleMirror();
        return;
      }
      const nextTool = TOOL_KEY_MAP[key];
      if (nextTool !== undefined) setActiveTool(nextTool);
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [setActiveTool, toggleMirror]);

  return (
    <div className={className}>
      <div className="flex flex-col gap-1">
        {TOOLS.map(({ id, label, key }) => {
          const isActive = activeTool === id;
          return (
            <button
              key={id}
              data-testid={`tool-${id}`}
              aria-pressed={isActive}
              onClick={() => setActiveTool(id)}
              className={[
                'bg-ui-surface border border-ui-border text-text-primary',
                'font-mono text-sm px-3 py-2 rounded-sm text-left',
                'hover:border-accent transition-colors flex justify-between',
                isActive ? 'border-accent' : '',
              ]
                .filter(Boolean)
                .join(' ')}
            >
              <span>{label}</span>
              <span className="text-text-muted ml-2">{key}</span>
            </button>
          );
        })}
        <button
          data-testid="tool-mirror"
          data-mirror-enabled={mirrorEnabled}
          aria-pressed={mirrorEnabled}
          onClick={toggleMirror}
          className={[
            'bg-ui-surface border text-text-primary',
            'font-mono text-sm px-3 py-2 rounded-sm text-left',
            'hover:border-accent transition-colors flex justify-between',
            mirrorEnabled ? 'border-accent' : 'border-ui-border',
          ]
            .filter(Boolean)
            .join(' ')}
        >
          <span>Mirror{mirrorEnabled ? ' (on)' : ''}</span>
          <span className="text-text-muted ml-2">M</span>
        </button>
      </div>
    </div>
  );
}
