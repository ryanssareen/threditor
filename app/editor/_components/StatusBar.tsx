'use client';

import { useEditorStore, type SavingState } from '@/lib/editor/store';

const TOOL_KEY: Record<string, string> = {
  pencil: 'B',
  eraser: 'E',
  picker: 'I',
  bucket: 'G',
};

const SAVED_LABEL: Record<SavingState, string> = {
  pending: 'Saving…',
  enabled: 'Saved locally',
  'disabled:private': 'Saving disabled (Private Browsing)',
  'disabled:quota': 'Saving disabled (storage full)',
  'disabled:error': 'Saving disabled',
};

export function StatusBar() {
  const tool = useEditorStore((s) => s.activeTool);
  const brushSize = useEditorStore((s) => s.brushSize);
  const color = useEditorStore((s) => s.activeColor.hex);
  const mirror = useEditorStore((s) => s.mirrorEnabled);
  const layerCount = useEditorStore((s) => s.layers.length);
  const savingState = useEditorStore((s) => s.savingState);

  return (
    <footer
      data-testid="editor-statusbar"
      className="flex h-7 items-center justify-between border-t border-ui-surface bg-[#050505] px-3.5 font-mono text-[10px] tracking-[0.05em] text-text-muted"
    >
      <div className="flex items-center gap-3.5 whitespace-nowrap">
        <span className="inline-flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className={
              savingState === 'enabled'
                ? 'text-green-500'
                : savingState.startsWith('disabled')
                  ? 'text-red-500'
                  : 'text-text-muted'
            }
          >
            ●
          </span>
          {SAVED_LABEL[savingState]}
        </span>
        <span className="text-ui-border">·</span>
        <span>64 × 64</span>
        <span className="text-ui-border">·</span>
        <span>
          <span className="text-accent">{TOOL_KEY[tool] ?? '·'}</span> {tool} ·{' '}
          {brushSize}px · <span className="text-accent">{color.toUpperCase()}</span>
        </span>
      </div>

      <div className="hidden items-center gap-3.5 whitespace-nowrap lg:flex">
        <span>Mirror {mirror ? 'on' : 'off'}</span>
        <span className="text-ui-border">·</span>
        <span>
          {layerCount} {layerCount === 1 ? 'layer' : 'layers'}
        </span>
        <span className="text-ui-border">·</span>
        <span>MIT · github.com/threditor</span>
      </div>
    </footer>
  );
}
