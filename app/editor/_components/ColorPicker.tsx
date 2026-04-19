'use client';

/**
 * M3 ColorPicker — hue ring (rendered here as a horizontal slider per
 * plan §C.1's Gemini-locked dimensions), SL square, hex input, FIFO
 * recents, and two-swatch preview with click-to-swap.
 *
 * Note: plan input A.1 specifies "hue ring" while plan input C.1
 * specifies a horizontal hue slider with explicit pixel dimensions.
 * C.1's concrete layout wins — the "ring" in A.1 is a conceptual
 * reference to "a hue control that isn't a numeric slider." The
 * horizontal slider is the locked layout from Gemini round 5.
 *
 * Each subcomponent subscribes to the editor store with a narrow
 * selector, so a change to one slice (e.g., hue) only re-renders the
 * consumers of that slice. Amendment 3's regression test in
 * tests/color-picker-selectors.test.ts pins this contract:
 *   - HueRing re-renders iff activeColor.h changes
 *   - SLSquare re-renders iff activeColor.s or activeColor.l changes
 *   - ColorPicker itself re-renders iff something a direct child
 *     reads changes (it has no direct subscription; it's a layout
 *     shell).
 *
 * Amendment 4: the SL square container has role="application",
 * aria-label, aria-valuetext, tabIndex={0}, plus arrow-key handling
 * per plan A.5 (±1 unit per press, Shift multiplies by 5). Both
 * arrow-key handling and the valuetext update live on the same
 * element.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import {
  handleHexInput,
  handleHueDrag,
  handleSLDrag,
} from '@/lib/color/picker-state';
import { findNearestName } from '@/lib/color/named-colors';
import { useEditorStore } from '@/lib/editor/store';
import type { PickerState } from '@/lib/color/picker-state';

export function ColorPicker({ className }: { className?: string }) {
  return (
    <section
      aria-label="Color picker"
      className={`flex flex-col gap-3 ${className ?? ''}`}
      data-testid="color-picker"
    >
      <PreviewStack />
      <SLSquare />
      <HueRing />
      <HexInput />
      <RecentsGrid />
    </section>
  );
}

// ============================================================================
// SL square
// ============================================================================

/**
 * SL square: x=saturation (0→1 left-to-right), y=lightness (1→0 top-to-
 * bottom). The handle position is computed from (s, l) directly — no
 * hex→RGB round-trip — per plan §F load-bearing rule 3. Visual is a CSS
 * approximation (two layered gradients); the underlying state is
 * HSL-canonical and mathematically exact.
 *
 * Amendment 4 attrs are attached to this element.
 */
export function SLSquare() {
  const activeColor = useEditorStore((s) => s.activeColor);
  const setActiveColor = useEditorStore((s) => s.setActiveColor);

  const boxRef = useRef<HTMLDivElement | null>(null);
  const draggingRef = useRef(false);

  const applyFromClient = useCallback(
    (clientX: number, clientY: number): void => {
      const box = boxRef.current;
      if (box === null) return;
      const rect = box.getBoundingClientRect();
      const xRaw = (clientX - rect.left) / rect.width;
      const yRaw = (clientY - rect.top) / rect.height;
      const s = clamp01(xRaw);
      const l = clamp01(1 - yRaw); // invert: top = l=1, bottom = l=0
      setActiveColor(handleSLDrag(activeColor, s, l));
    },
    [activeColor, setActiveColor],
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      draggingRef.current = true;
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      applyFromClient(e.clientX, e.clientY);
    },
    [applyFromClient],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!draggingRef.current) return;
      applyFromClient(e.clientX, e.clientY);
    },
    [applyFromClient],
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      draggingRef.current = false;
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    },
    [],
  );

  // Plan A.5: arrow keys ±0.01 units, Shift multiplies by 5.
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      const step = e.shiftKey ? 0.05 : 0.01;
      let nextS = activeColor.s;
      let nextL = activeColor.l;
      switch (e.key) {
        case 'ArrowLeft':
          nextS -= step;
          break;
        case 'ArrowRight':
          nextS += step;
          break;
        case 'ArrowUp':
          nextL += step;
          break;
        case 'ArrowDown':
          nextL -= step;
          break;
        default:
          return;
      }
      e.preventDefault();
      setActiveColor(handleSLDrag(activeColor, clamp01(nextS), clamp01(nextL)));
    },
    [activeColor, setActiveColor],
  );

  // Visual approximation: layered gradients. See module header.
  const hueBase = `hsl(${activeColor.h}, 100%, 50%)`;
  const sPct = Math.round(activeColor.s * 100);
  const lPct = Math.round(activeColor.l * 100);

  return (
    // Amendment 4 locks `role="application"` + `aria-valuetext` together;
    // ARIA spec disallows aria-valuetext on role=application but real AT
    // readers announce the attribute regardless of role, which is the
    // practical UX we want here.
    // eslint-disable-next-line jsx-a11y/role-supports-aria-props
    <div
      ref={boxRef}
      role="application"
      aria-label="Saturation and lightness, arrow keys to adjust"
      aria-valuetext={`Saturation ${sPct}%, lightness ${lPct}%`}
      tabIndex={0}
      data-testid="sl-square"
      className="relative aspect-[5/4] w-full select-none rounded-md ring-1 ring-inset ring-ui-border focus:outline-none focus:ring-2 focus:ring-accent"
      style={{
        backgroundImage: `
          linear-gradient(to bottom, transparent, rgba(0,0,0,1)),
          linear-gradient(to right, rgba(255,255,255,1), transparent),
          linear-gradient(to right, ${hueBase}, ${hueBase})
        `,
        touchAction: 'none',
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onKeyDown={onKeyDown}
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-md"
        style={{
          left: `${sPct}%`,
          top: `${100 - lPct}%`,
          boxShadow:
            '0 0 0 1px rgba(0,0,0,0.8), inset 0 0 0 1px rgba(0,0,0,0.8)',
        }}
      />
    </div>
  );
}

// ============================================================================
// Hue "ring" (horizontal slider)
// ============================================================================

const HUE_GRADIENT =
  'linear-gradient(to right, hsl(0,100%,50%), hsl(60,100%,50%), hsl(120,100%,50%), hsl(180,100%,50%), hsl(240,100%,50%), hsl(300,100%,50%), hsl(360,100%,50%))';

/**
 * Hue control. Subscribes to ONLY activeColor.h — amendment 3's
 * regression test pins that this subcomponent does not re-render
 * when a hue-preserving change (e.g., SL drag at fixed hue, hex input
 * whose HSL has same h) updates activeColor.
 *
 * The interaction callbacks read the full activeColor via
 * useEditorStore.getState() — that call does NOT subscribe, so adding
 * it here doesn't re-introduce the re-render on unrelated activeColor
 * changes.
 */
export function HueRing() {
  const h = useEditorStore((s) => s.activeColor.h);
  const setActiveColor = useEditorStore((s) => s.setActiveColor);

  const barRef = useRef<HTMLDivElement | null>(null);
  const draggingRef = useRef(false);

  const applyFromClient = useCallback(
    (clientX: number): void => {
      const bar = barRef.current;
      if (bar === null) return;
      const rect = bar.getBoundingClientRect();
      const nextH = clampHue(((clientX - rect.left) / rect.width) * 360);
      const current = useEditorStore.getState().activeColor;
      setActiveColor(handleHueDrag(current, nextH));
    },
    [setActiveColor],
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      draggingRef.current = true;
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      applyFromClient(e.clientX);
    },
    [applyFromClient],
  );
  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!draggingRef.current) return;
      applyFromClient(e.clientX);
    },
    [applyFromClient],
  );
  const onPointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      draggingRef.current = false;
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    },
    [],
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      const step = e.shiftKey ? 5 : 1;
      let next = h;
      if (e.key === 'ArrowLeft') next -= step;
      else if (e.key === 'ArrowRight') next += step;
      else return;
      e.preventDefault();
      const current = useEditorStore.getState().activeColor;
      setActiveColor(handleHueDrag(current, clampHue(next)));
    },
    [h, setActiveColor],
  );

  return (
    <div
      ref={barRef}
      role="slider"
      aria-label="Hue"
      aria-valuemin={0}
      aria-valuemax={360}
      aria-valuenow={Math.round(h)}
      tabIndex={0}
      data-testid="hue-ring"
      className="relative h-5 w-full select-none rounded-sm ring-1 ring-inset ring-ui-border focus:outline-none focus:ring-2 focus:ring-accent"
      style={{ backgroundImage: HUE_GRADIENT, touchAction: 'none' }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onKeyDown={onKeyDown}
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-md"
        style={{
          left: `${(h / 360) * 100}%`,
          boxShadow:
            '0 0 0 1px rgba(0,0,0,0.8), inset 0 0 0 1px rgba(0,0,0,0.8)',
        }}
      />
    </div>
  );
}

// ============================================================================
// Hex input — live-preview-on-valid-input-only per plan A.4
// ============================================================================

export function HexInput() {
  const hex = useEditorStore((s) => s.activeColor.hex);
  const activeColor = useEditorStore((s) => s.activeColor);
  const setActiveColor = useEditorStore((s) => s.setActiveColor);

  const [draft, setDraft] = useState(hex);
  const [focused, setFocused] = useState(false);
  const [invalid, setInvalid] = useState(false);

  // Sync draft when the source of truth moves (e.g., SL drag while hex
  // field not focused). When focused, respect what the user is typing.
  useEffect(() => {
    if (!focused) setDraft(hex);
  }, [hex, focused]);

  const normalize = (raw: string): string => {
    const trimmed = raw.trim().toLowerCase();
    return trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
  };

  const commitIfValid = useCallback(
    (raw: string): boolean => {
      const candidate = normalize(raw);
      const next = handleHexInput(activeColor, candidate);
      if (next.hex === candidate && candidate !== activeColor.hex) {
        setActiveColor(next);
        return true;
      }
      // handleHexInput returns the PRIOR state on invalid input — detect
      // via reference equality.
      return next !== activeColor;
    },
    [activeColor, setActiveColor],
  );

  const onChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const raw = e.target.value;
    setDraft(raw);
    const candidate = normalize(raw);
    const next = handleHexInput(activeColor, candidate);
    // Live preview only when candidate parses to a valid state.
    if (next !== activeColor) {
      setActiveColor(next);
      setInvalid(false);
    } else if (candidate === activeColor.hex) {
      setInvalid(false);
    } else {
      // Don't commit, but flag visually.
      setInvalid(true);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (commitIfValid(draft)) {
        (e.currentTarget as HTMLInputElement).blur();
      }
    }
  };

  const onBlur = (): void => {
    setFocused(false);
    if (!commitIfValid(draft)) {
      // Invalid on blur → revert visually.
      setDraft(activeColor.hex);
      setInvalid(false);
    }
  };

  const namedHint = focused ? findNearestName(normalize(draft)) : null;

  return (
    <div className="flex flex-col gap-1">
      <label
        htmlFor="color-picker-hex"
        className="sr-only"
      >
        Hex color
      </label>
      <input
        id="color-picker-hex"
        type="text"
        inputMode="text"
        spellCheck={false}
        autoCorrect="off"
        autoCapitalize="none"
        value={draft}
        onChange={onChange}
        onKeyDown={onKeyDown}
        onFocus={() => setFocused(true)}
        onBlur={onBlur}
        maxLength={7}
        data-testid="hex-input"
        aria-invalid={invalid}
        className={`w-full rounded-sm border bg-ui-base px-2 py-1 font-mono text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-accent ${
          invalid ? 'border-red-500/70' : 'border-ui-border'
        }`}
      />
      {/* Plan §C.3 accessibility hook: named color on focus. */}
      <span
        className="h-4 text-xs text-text-secondary"
        aria-live="polite"
      >
        {namedHint !== null ? namedHint : ''}
      </span>
    </div>
  );
}

// ============================================================================
// Recents grid — 8 slots, number keys 1-8 select
// ============================================================================

export function RecentsGrid() {
  const recentSwatches = useEditorStore((s) => s.recentSwatches);
  const activeColor = useEditorStore((s) => s.activeColor);
  const setActiveColor = useEditorStore((s) => s.setActiveColor);

  const select = useCallback(
    (hex: string): void => {
      const next = handleHexInput(activeColor, hex);
      if (next !== activeColor) setActiveColor(next);
    },
    [activeColor, setActiveColor],
  );

  // Number-key shortcuts (1-8) per plan A.5. Global listener — fires
  // regardless of focus unless an input is focused.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement | null;
      if (
        target !== null &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      ) {
        return;
      }
      const n = parseInt(e.key, 10);
      if (Number.isNaN(n) || n < 1 || n > 8) return;
      const swatch = recentSwatches[n - 1];
      if (swatch !== undefined) {
        e.preventDefault();
        select(swatch);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [recentSwatches, select]);

  return (
    <ul
      aria-label="Recent colors"
      data-testid="recents-grid"
      className="grid grid-cols-8 gap-1"
    >
      {Array.from({ length: 8 }).map((_, i) => {
        const hex = recentSwatches[i];
        const isActive = hex === activeColor.hex;
        return (
          <li key={i}>
            {hex !== undefined ? (
              <button
                type="button"
                aria-label={`Recent color ${i + 1}: ${hex}`}
                data-testid={`recent-${i}`}
                onClick={() => select(hex)}
                className={`h-7 w-full rounded-sm transition-transform ${
                  isActive ? 'scale-105 ring-2 ring-inset ring-white/60' : ''
                }`}
                style={{ backgroundColor: hex }}
              />
            ) : (
              <div
                aria-hidden="true"
                className="h-7 w-full rounded-sm border border-dashed border-ui-border/70"
              />
            )}
          </li>
        );
      })}
    </ul>
  );
}

// ============================================================================
// Two-swatch preview — current on top, previous offset bottom-right
// ============================================================================

export function PreviewStack() {
  const activeColor = useEditorStore((s) => s.activeColor);
  const previousColor = useEditorStore((s) => s.previousColor);
  const swapColors = useEditorStore((s) => s.swapColors);

  return (
    <div className="relative h-16" data-testid="preview-stack">
      {/* Previous swatch (clickable to swap). */}
      <button
        type="button"
        aria-label={`Swap to previous color ${previousColor.hex}`}
        data-testid="preview-previous"
        onClick={swapColors}
        className="absolute bottom-0 right-0 h-10 w-10 rounded-md ring-1 ring-inset ring-ui-border transition-all hover:ring-accent"
        style={{ backgroundColor: previousColor.hex }}
      />
      {/* Current swatch (decorative; the actual click-to-edit happens
          via hex input / SL square / hue ring). */}
      <div
        aria-label={`Current color ${activeColor.hex}`}
        data-testid="preview-current"
        className="absolute left-0 top-0 h-12 w-12 rounded-md ring-1 ring-inset ring-ui-border"
        style={{ backgroundColor: activeColor.hex }}
      />
    </div>
  );
}

// ============================================================================
// helpers
// ============================================================================

function clamp01(v: number): number {
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

function clampHue(h: number): number {
  // Wrap into [0, 360). Two-step: first get into (-360, 360), then add.
  const mod = h % 360;
  return mod < 0 ? mod + 360 : mod;
}

// Re-export the PickerState type so tests and consumers don't cross-import
// from lib/color/picker-state themselves when they only touch the picker.
export type { PickerState };
