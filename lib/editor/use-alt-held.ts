'use client';

/**
 * M5: track whether Alt is currently held via a stable ref (no re-renders).
 * Both paint surfaces (ViewportUV, PlayerModel) read this on pointerdown to
 * decide whether to sample-then-exit (alt-picker) or start a regular stroke.
 *
 * Ref-based by design: storing altHeld in React state would cause every
 * paint-surface consumer to re-render on every Alt press, and Alt is
 * pressed during hover/navigation — not worth the cost.
 *
 * Focus guard: don't flip the ref when focus is in an editable element.
 * Alt combos in hex inputs or future text fields shouldn't bleed into
 * paint semantics.
 */

import { useEffect, useRef } from 'react';

export function useAltHeld(): React.RefObject<boolean> {
  const ref = useRef(false);

  useEffect(() => {
    const isEditable = (target: EventTarget | null): boolean => {
      if (target === null) return false;
      const el = target as HTMLElement;
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') return true;
      if (el.isContentEditable) return true;
      return false;
    };

    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Alt' && !isEditable(e.target)) ref.current = true;
    };
    const onKeyUp = (e: KeyboardEvent): void => {
      if (e.key === 'Alt') ref.current = false;
    };
    // Reset when the window loses focus so a stuck-modifier (window switch
    // while Alt was held) doesn't persist on return.
    const onBlur = (): void => {
      ref.current = false;
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, []);

  return ref;
}
