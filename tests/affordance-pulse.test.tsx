// @vitest-environment jsdom
/**
 * M7 Unit 7 — AffordancePulse component tests.
 */

import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { useEditorStore } from '../lib/editor/store';
import { AffordancePulse } from '../app/editor/_components/AffordancePulse';

// @ts-expect-error — jsdom-react environment flag
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function resetStore() {
  useEditorStore.setState({ pulseTarget: null });
}

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

// Helper elements with data-pulse-target attributes
let colorEl: HTMLDivElement;
let mirrorEl: HTMLDivElement;
let brushEl: HTMLDivElement;

beforeEach(() => {
  resetStore();

  container = document.createElement('div');
  document.body.appendChild(container);

  colorEl = document.createElement('div');
  colorEl.setAttribute('data-pulse-target', 'color');
  document.body.appendChild(colorEl);

  mirrorEl = document.createElement('div');
  mirrorEl.setAttribute('data-pulse-target', 'mirror');
  document.body.appendChild(mirrorEl);

  brushEl = document.createElement('div');
  brushEl.setAttribute('data-pulse-target', 'brush');
  document.body.appendChild(brushEl);

  act(() => {
    root = createRoot(container);
    root.render(createElement(AffordancePulse));
  });
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
  colorEl.remove();
  mirrorEl.remove();
  brushEl.remove();
  resetStore();
});

describe('AffordancePulse', () => {
  it('renders null (no DOM output)', () => {
    expect(container.childElementCount).toBe(0);
  });

  it('sets data-pulse="true" on the color element when pulseTarget is "color"', () => {
    act(() => {
      useEditorStore.getState().setPulseTarget('color');
    });
    expect(colorEl.dataset.pulse).toBe('true');
    expect(mirrorEl.dataset.pulse).toBeUndefined();
    expect(brushEl.dataset.pulse).toBeUndefined();
  });

  it('sets data-pulse="true" on the mirror element when pulseTarget is "mirror"', () => {
    act(() => {
      useEditorStore.getState().setPulseTarget('mirror');
    });
    expect(mirrorEl.dataset.pulse).toBe('true');
    expect(colorEl.dataset.pulse).toBeUndefined();
  });

  it('clears data-pulse when pulseTarget returns to null', () => {
    act(() => {
      useEditorStore.getState().setPulseTarget('color');
    });
    expect(colorEl.dataset.pulse).toBe('true');

    act(() => {
      useEditorStore.getState().setPulseTarget(null);
    });
    expect(colorEl.dataset.pulse).toBeUndefined();
  });

  it('target change A → B: clears A attribute before setting B', () => {
    act(() => {
      useEditorStore.getState().setPulseTarget('color');
    });
    expect(colorEl.dataset.pulse).toBe('true');

    act(() => {
      useEditorStore.getState().setPulseTarget('mirror');
    });
    // color should be cleared
    expect(colorEl.dataset.pulse).toBeUndefined();
    // mirror should be set
    expect(mirrorEl.dataset.pulse).toBe('true');
  });

  it('target change A → B → A restores correctly', () => {
    act(() => {
      useEditorStore.getState().setPulseTarget('brush');
    });
    expect(brushEl.dataset.pulse).toBe('true');

    act(() => {
      useEditorStore.getState().setPulseTarget('color');
    });
    expect(brushEl.dataset.pulse).toBeUndefined();
    expect(colorEl.dataset.pulse).toBe('true');

    act(() => {
      useEditorStore.getState().setPulseTarget('brush');
    });
    expect(colorEl.dataset.pulse).toBeUndefined();
    expect(brushEl.dataset.pulse).toBe('true');
  });
});
