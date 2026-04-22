'use client';

/**
 * M8 Unit 6: floating luminance indicator pill.
 *
 * Renders a top-center pill when `luminanceEnabled === true` with a
 * 500ms slide-down animation on mount. Removed when the flag flips
 * back to false. `role="status" aria-live="polite"` announces the
 * mode change to assistive tech without the alert-style aggression.
 *
 * Positioned absolutely inside its parent pane — EditorLayout mounts
 * it inside the 3D viewport container so the pill floats above the
 * scene without affecting layout.
 */

import { useEditorStore } from '@/lib/editor/store';

export function LuminanceToggle() {
  const luminanceEnabled = useEditorStore((s) => s.luminanceEnabled);
  if (!luminanceEnabled) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="luminance-pill"
      className="pointer-events-none absolute left-1/2 top-4 z-30 -translate-x-1/2 rounded-full border border-accent bg-ui-surface px-4 py-1.5 font-mono text-xs text-text-primary shadow-panel"
      style={{ animation: 'luminance-pill-slide-in 500ms ease-out' }}
    >
      <span aria-hidden="true">👁&nbsp;</span>Luminance Mode
    </div>
  );
}
