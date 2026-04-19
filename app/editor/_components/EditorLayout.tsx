'use client';

/**
 * M3: responsive layout coordinator.
 *
 * Owns the single TextureManager + Layer the paint loop writes into,
 * and hands them to the two consumers that need synchronized pixel
 * views:
 *
 *   - `ViewportUV` (2D paint surface) — mounts TM's offscreen canvas
 *     into its own DOM with CSS transform for zoom/pan.
 *   - `EditorCanvas` (3D viewport) — passes TM's `CanvasTexture` to
 *     `PlayerModel` as the material map.
 *
 * Desktop ≥640px: `[3D | 2D | Sidebar 280px]` horizontal split.
 * Mobile <640px: `[3D 30vh][2D 40vh][Sheet remaining, safe-area-inset]`
 * vertical stack. M3 Step 10 lands the Sidebar; this step renders it
 * as an empty placeholder div so the layout math is right from day one.
 */

import { useEditorStore } from '@/lib/editor/store';
import { useTextureManagerBundle } from '@/lib/editor/use-texture-manager';
import { EditorCanvas } from './EditorCanvas';
import { ViewportUV } from './ViewportUV';

export function EditorLayout() {
  // Narrow selector — EditorLayout only re-renders on variant change.
  const variant = useEditorStore((s) => s.variant);
  const bundle = useTextureManagerBundle(variant);

  return (
    <div className="flex h-dvh w-dvw flex-col sm:flex-row">
      {/* 3D viewport */}
      <div className="relative h-[30vh] w-full shrink-0 sm:h-full sm:w-auto sm:flex-1">
        <EditorCanvas
          texture={bundle?.textureManager.getTexture() ?? null}
          variant={variant}
        />
      </div>

      {/* 2D paint surface */}
      <div className="relative h-[40vh] w-full shrink-0 sm:h-full sm:w-auto sm:flex-1">
        {bundle !== null ? (
          <ViewportUV
            textureManager={bundle.textureManager}
            layer={bundle.layer}
            className="h-full w-full"
          />
        ) : null}
      </div>

      {/* Sidebar placeholder — Step 10 renders ColorPicker + Toolbar here. */}
      <aside
        className="h-[30vh] w-full shrink-0 border-t border-ui-border bg-ui-surface sm:h-full sm:w-[280px] sm:border-l sm:border-t-0"
        style={{ paddingBottom: 'env(safe-area-inset-bottom, 0)' }}
      >
        {/* Sidebar body lands in Step 10 (Sidebar.tsx). */}
      </aside>
    </div>
  );
}
