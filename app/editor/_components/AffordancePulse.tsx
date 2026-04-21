'use client';

import { useEffect, useRef } from 'react';

import { useEditorStore } from '@/lib/editor/store';

export function AffordancePulse() {
  const pulseTarget = useEditorStore((s) => s.pulseTarget);
  const previousTargetRef = useRef<string | null>(null);

  useEffect(() => {
    const prev = previousTargetRef.current;
    const next = pulseTarget;

    if (prev !== null) {
      const prevEl = document.querySelector<HTMLElement>(
        `[data-pulse-target="${prev}"]`,
      );
      if (prevEl !== null) {
        delete prevEl.dataset.pulse;
      }
    }

    if (next !== null) {
      const nextEl = document.querySelector<HTMLElement>(
        `[data-pulse-target="${next}"]`,
      );
      if (nextEl !== null) {
        nextEl.dataset.pulse = 'true';
      }
    }

    previousTargetRef.current = next;
  }, [pulseTarget]);

  return null;
}
