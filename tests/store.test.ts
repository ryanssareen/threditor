import { beforeEach, describe, expect, it } from 'vitest';

import { pickerStateFromHex } from '../lib/color/picker-state';
import { useEditorStore } from '../lib/editor/store';
import type { Layer } from '../lib/editor/types';

function resetStore(): void {
  useEditorStore.setState({
    activeColor: pickerStateFromHex('#ff0000')!,
    previousColor: pickerStateFromHex('#ffffff')!,
    recentSwatches: [],
  });
}

describe('useEditorStore — setActiveColor', () => {
  beforeEach(resetStore);

  it('updates previousColor when hex changes', () => {
    const store = useEditorStore.getState();
    const before = store.previousColor.hex;
    store.setActiveColor(pickerStateFromHex('#00ff00')!);
    const after = useEditorStore.getState();
    expect(after.activeColor.hex).toBe('#00ff00');
    expect(after.previousColor.hex).toBe('#ff0000');
    expect(after.previousColor.hex).not.toBe(before);
  });

  it('does NOT update previousColor when hex is unchanged (100 same-color calls)', () => {
    const startPrev = useEditorStore.getState().previousColor;
    const sameColor = pickerStateFromHex('#ff0000')!;

    for (let i = 0; i < 100; i++) {
      // Simulate SL drag producing slightly different HSL but same rendered hex
      useEditorStore.getState().setActiveColor({ ...sameColor, s: sameColor.s + i * 0.00001 });
    }

    const after = useEditorStore.getState();
    expect(after.previousColor).toBe(startPrev);
  });
});

describe('useEditorStore — resetDocument', () => {
  it('clears layers, activeLayerId, and template-aware flags', () => {
    const layer: Layer = {
      id: 'l1',
      name: 'Layer 1',
      visible: true,
      opacity: 1,
      blendMode: 'normal',
      pixels: new Uint8ClampedArray(64 * 64 * 4),
    };
    useEditorStore.setState({
      layers: [layer],
      activeLayerId: layer.id,
      hasEditedSinceTemplate: true,
      lastAppliedTemplateId: 'steve',
      activeContextualHint: 'try painting',
      pulseTarget: 'brush',
    });

    useEditorStore.getState().resetDocument();

    const after = useEditorStore.getState();
    expect(after.layers).toEqual([]);
    expect(after.activeLayerId).toBe('');
    expect(after.hasEditedSinceTemplate).toBe(false);
    expect(after.lastAppliedTemplateId).toBeNull();
    expect(after.activeContextualHint).toBeNull();
    expect(after.pulseTarget).toBeNull();
  });

  it('preserves variant and recentSwatches (user preferences, not document state)', () => {
    useEditorStore.setState({
      variant: 'slim',
      recentSwatches: ['#ff0000', '#00ff00'],
    });

    useEditorStore.getState().resetDocument();

    const after = useEditorStore.getState();
    expect(after.variant).toBe('slim');
    expect(after.recentSwatches).toEqual(['#ff0000', '#00ff00']);
  });
});
