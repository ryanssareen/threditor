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

const TOOL_KEY_MAP: Record<string, ToolId> = {
  b: 'pencil',
  e: 'eraser',
  i: 'picker',
  g: 'bucket',
};

type Variant = 'rail' | 'stack';

export function Toolbar({
  className,
  variant = 'stack',
}: {
  className?: string;
  variant?: Variant;
}) {
  const activeTool = useEditorStore((s) => s.activeTool);
  const setActiveTool = useEditorStore((s) => s.setActiveTool);
  const mirrorEnabled = useEditorStore((s) => s.mirrorEnabled);
  const toggleMirror = useEditorStore((s) => s.toggleMirror);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const target = e.target as HTMLElement | null;
      if (target !== null && target instanceof HTMLElement) {
        const tag = target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA') return;
        if (target.isContentEditable) return;
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

  if (variant === 'rail') {
    return (
      <nav
        aria-label="Tools"
        className={`flex w-16 flex-col items-center gap-1 border-r border-ui-border bg-ui-base py-3 ${className ?? ''}`}
      >
        {TOOLS.map(({ id, label, key }) => {
          const isActive = activeTool === id;
          return (
            <RailButton
              key={id}
              data-testid={`tool-${id}`}
              isActive={isActive}
              onClick={() => setActiveTool(id)}
              title={`${label} (${key})`}
              label={label}
              hotkey={key}
            />
          );
        })}

        <div className="my-1 h-px w-8 bg-ui-surface" />

        <RailButton
          data-testid="tool-mirror"
          data-mirror-enabled={mirrorEnabled}
          data-pulse-target="mirror"
          isActive={mirrorEnabled}
          onClick={toggleMirror}
          title={`Mirror ${mirrorEnabled ? 'on' : 'off'} (M)`}
          label="Mirror"
          hotkey="M"
        />
      </nav>
    );
  }

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
          data-pulse-target="mirror"
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

type RailButtonProps = {
  isActive: boolean;
  onClick: () => void;
  title: string;
  label: string;
  hotkey: string;
} & Record<`data-${string}`, string | boolean | undefined>;

function RailButton({
  isActive,
  onClick,
  title,
  label,
  hotkey,
  ...rest
}: RailButtonProps) {
  return (
    <button
      type="button"
      title={title}
      aria-pressed={isActive}
      onClick={onClick}
      className={[
        'grid h-12 w-12 place-items-center rounded-sm border bg-ui-surface transition-colors',
        isActive
          ? 'border-accent'
          : 'border-ui-border hover:border-accent',
      ].join(' ')}
      {...rest}
    >
      <span
        className={[
          'flex flex-col items-center gap-1 leading-none transition-colors',
          isActive ? 'text-accent' : 'text-text-primary group-hover:text-accent',
        ].join(' ')}
      >
        <span className="font-mono text-[11px] leading-none">{label}</span>
        <span className="font-mono text-[9px] leading-none tracking-[0.05em] text-text-muted">
          {hotkey}
        </span>
      </span>
    </button>
  );
}
