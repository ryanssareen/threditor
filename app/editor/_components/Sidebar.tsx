'use client';

import { useCallback } from 'react';

import type { BrushSize } from '@/lib/editor/store';
import { useEditorStore } from '@/lib/editor/store';
import { handleHexInput } from '@/lib/color/picker-state';
import { ColorPicker } from './ColorPicker';
import { LayerPanel, type LayerLifecycleCommand } from './LayerPanel';

type SidebarProps = {
  className?: string;
  onLayerUndoPush?: (cmd: LayerLifecycleCommand) => void;
  /** M16 Unit 6: open the AI generation dialog. */
  onOpenAi?: () => void;
  /** M8 Unit 2: open the export dialog. */
  onOpenExport?: () => void;
};

export function Sidebar({
  className,
  onLayerUndoPush,
  onOpenAi,
  onOpenExport,
}: SidebarProps) {
  return (
    <div className={`flex h-full w-full flex-col bg-ui-base ${className ?? ''}`}>
      <div className="flex flex-1 flex-col gap-[22px] overflow-y-auto px-4 py-[18px]">
        <ColorSection />
        <BrushSection />
        <LayersSection onLayerUndoPush={onLayerUndoPush} />
        {onOpenAi !== undefined && <AiCard onOpen={onOpenAi} />}
        {onOpenExport !== undefined && <ExportButton onOpen={onOpenExport} />}
      </div>
    </div>
  );
}

// ============================================================================
// Color
// ============================================================================

const QUICK_PALETTE: { hex: string; name: string }[] = [
  { hex: '#6b3a1e', name: 'dirt' },
  { hex: '#4a7a32', name: 'grass' },
  { hex: '#7f7f7f', name: 'stone' },
  { hex: '#3366cc', name: 'water' },
  { hex: '#e06a1c', name: 'lava' },
  { hex: '#f2c94c', name: 'gold' },
  { hex: '#c03a2b', name: 'redstone' },
  { hex: '#0d0d0d', name: 'obsidian' },
];

function ColorSection() {
  const activeColor = useEditorStore((s) => s.activeColor);
  const setActiveColor = useEditorStore((s) => s.setActiveColor);

  const select = useCallback(
    (hex: string) => {
      const next = handleHexInput(activeColor, hex);
      if (next !== activeColor) setActiveColor(next);
    },
    [activeColor, setActiveColor],
  );

  return (
    <section>
      <SectionHead label="Color" meta={activeColor.hex.toUpperCase()} />

      <div className="mb-2.5 flex items-center gap-2.5">
        <div
          aria-hidden="true"
          className="h-11 w-11 flex-shrink-0 rounded-sm border border-ui-border"
          style={{ background: activeColor.hex }}
        />
        <ColorPicker className="min-w-0 flex-1" />
      </div>

      <div className="grid grid-cols-8 gap-1">
        {QUICK_PALETTE.map(({ hex, name }) => {
          const pressed = hex.toLowerCase() === activeColor.hex.toLowerCase();
          return (
            <button
              key={hex}
              type="button"
              aria-label={`${name} ${hex}`}
              aria-pressed={pressed}
              onClick={() => select(hex)}
              className={[
                'aspect-square rounded-sm border transition-transform',
                pressed
                  ? 'border-accent shadow-[inset_0_0_0_1px_var(--color-accent)]'
                  : 'border-ui-border hover:scale-105 hover:border-accent',
              ].join(' ')}
              style={{ background: hex }}
            />
          );
        })}
      </div>
    </section>
  );
}

// ============================================================================
// Brush
// ============================================================================

const BRUSH_SIZES: BrushSize[] = [1, 2, 3, 4];
const BRUSH_DOT_PX: Record<BrushSize, number> = { 1: 3, 2: 5, 3: 7, 4: 9 };

function BrushSection() {
  const brushSize = useEditorStore((s) => s.brushSize);
  const setBrushSize = useEditorStore((s) => s.setBrushSize);

  return (
    <section>
      <SectionHead label="Brush" meta={`${brushSize}px`} />
      <div
        role="group"
        aria-label="Brush size"
        data-pulse-target="brush"
        className="flex gap-1"
      >
        {BRUSH_SIZES.map((n) => {
          const pressed = brushSize === n;
          const dot = BRUSH_DOT_PX[n];
          return (
            <button
              key={n}
              type="button"
              aria-pressed={pressed}
              data-testid={`brush-size-${n}`}
              onClick={() => setBrushSize(n)}
              className={[
                'flex flex-1 flex-col items-center gap-1 rounded-sm border bg-ui-surface py-2 font-mono text-xs transition-colors',
                pressed
                  ? 'border-accent text-accent'
                  : 'border-ui-border text-text-primary hover:border-accent hover:text-accent',
              ].join(' ')}
            >
              <span
                aria-hidden="true"
                className="rounded-full bg-current"
                style={{ width: dot, height: dot }}
              />
              <span>{n}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

// ============================================================================
// Layers
// ============================================================================

function LayersSection({
  onLayerUndoPush,
}: {
  onLayerUndoPush?: (cmd: LayerLifecycleCommand) => void;
}) {
  const layerCount = useEditorStore((s) => s.layers.length);
  return (
    <section>
      <SectionHead label="Layers" meta={String(layerCount)} />
      <LayerPanel onUndoPush={onLayerUndoPush} />
    </section>
  );
}

// ============================================================================
// AI card
// ============================================================================

function AiCard({ onOpen }: { onOpen: () => void }) {
  return (
    <section>
      <button
        type="button"
        data-testid="sidebar-ai-button"
        aria-label="Generate skin with AI"
        onClick={onOpen}
        className="group flex w-full flex-col gap-2.5 rounded-md border border-accent/30 bg-[radial-gradient(ellipse_100%_80%_at_50%_0%,rgba(0,229,255,0.06),transparent_70%)] bg-ui-base p-3.5 text-left transition-colors hover:border-accent"
      >
        <div className="flex items-center justify-between">
          <span className="inline-flex items-center gap-1.5 font-mono text-xs tracking-[0.05em] text-text-primary">
            <span aria-hidden="true" className="text-accent">
              ✦
            </span>
            <span>AI generate</span>
          </span>
          <span className="font-mono text-[9px] uppercase tracking-[0.15em] text-text-muted">
            ~4s
          </span>
        </div>

        <div className="rounded-sm border border-ui-surface bg-canvas px-2.5 py-2 font-mono text-[11px] text-text-secondary transition-colors group-hover:border-ui-border group-hover:text-text-primary">
          <span className="italic text-text-muted">
            forest knight, mossy leather armor…
          </span>
        </div>

        <span className="inline-flex items-center justify-center gap-2 rounded-sm bg-accent px-3 py-2 text-sm font-semibold text-canvas transition-colors group-hover:bg-accent-hover">
          <span>Generate</span>
          <span aria-hidden="true" className="font-mono">
            →
          </span>
        </span>
      </button>
    </section>
  );
}

// ============================================================================
// Export
// ============================================================================

function ExportButton({ onOpen }: { onOpen: () => void }) {
  return (
    <button
      type="button"
      data-testid="sidebar-export-button"
      onClick={onOpen}
      className="flex w-full items-center justify-between rounded-sm border border-ui-border bg-transparent px-3.5 py-2.5 font-mono text-xs font-medium text-text-primary transition-colors hover:border-accent hover:text-accent"
    >
      <span>Export PNG</span>
      <span className="font-mono text-[10px] text-text-muted">64×64</span>
    </button>
  );
}

// ============================================================================
// Section head
// ============================================================================

function SectionHead({ label, meta }: { label: string; meta?: string }) {
  return (
    <div className="mb-2 flex items-baseline justify-between">
      <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-text-muted">
        {label}
      </span>
      {meta !== undefined && (
        <span className="font-mono text-[10px] tracking-[0.04em] text-text-muted">
          {meta}
        </span>
      )}
    </div>
  );
}
