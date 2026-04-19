// @vitest-environment jsdom
//
// Amendment 3 — ColorPicker selector regression test.
//
// Pins the narrow-selector contract documented in lib/editor/store.ts
// design notes (2). Two assertions:
//
//   a. When the whole `activeColor` is replaced with a new PickerState
//      whose hue is unchanged, the HueRing subcomponent does NOT
//      re-render — because it subscribes to `activeColor.h` only.
//   b. When an unrelated slice (brushSize) is mutated, neither
//      ColorPicker nor HueRing re-renders.
//
// Render counting uses React.Profiler — one callback per commit per
// tracked component. Mounting commits count as 1 each; subsequent
// updates increment only when React actually re-runs the render
// function for that component.
//
// Note the `.test.ts` extension despite the JSX: vitest / esbuild
// accept JSX in .ts files when the caller writes tsx shapes (we use
// React.createElement directly to avoid needing a .tsx file and the
// plugin-react wiring).

import { createElement, Profiler, type ProfilerOnRenderCallback } from 'react';
import { act } from 'react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';

beforeAll(() => {
  // React 18+ needs this flag for act() to behave silently.
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

import {
  ColorPicker,
  HueRing,
} from '../app/editor/_components/ColorPicker';
import { pickerStateFromHex } from '../lib/color/picker-state';
import { useEditorStore } from '../lib/editor/store';

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function mount(tree: React.ReactNode): void {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(tree);
  });
}

function unmount(): void {
  act(() => {
    root?.unmount();
  });
  if (container !== null) document.body.removeChild(container);
  root = null;
  container = null;
}

afterEach(() => {
  unmount();
  useEditorStore.setState({
    activeColor: pickerStateFromHex('#6b3a1e')!,
    previousColor: pickerStateFromHex('#4a7a32')!,
    recentSwatches: [],
    brushSize: 1,
    variant: 'classic',
    activeTool: 'pencil',
  });
});

describe('ColorPicker selector contract (amendment 3)', () => {
  it('HueRing does NOT re-render when activeColor changes but hue stays the same', () => {
    let hueRenderCount = 0;
    const onRender: ProfilerOnRenderCallback = (id) => {
      if (id === 'HueRing') hueRenderCount += 1;
    };

    // Seed a known activeColor with h=0 (pure red family).
    act(() => {
      useEditorStore.setState({
        activeColor: pickerStateFromHex('#ff0000')!,
      });
    });

    mount(
      createElement(
        Profiler,
        { id: 'HueRing', onRender },
        createElement(HueRing),
      ),
    );

    // One mount commit expected.
    expect(hueRenderCount).toBe(1);

    // Change activeColor to another red-family color: still h=0, but
    // different saturation & hex. HueRing's narrow selector reads
    // activeColor.h only; the new h matches, so no re-render should
    // fire.
    const nextSameHue = pickerStateFromHex('#ff8080')!;
    // Sanity: hues match. (Note: hexToRgbToHsl can produce non-zero
    // hues for some reds due to rounding; pickerStateFromHex('#ff8080')
    // with rgb 255,128,128 yields h=0.)
    expect(Math.round(nextSameHue.h)).toBe(Math.round(0));

    act(() => {
      useEditorStore.setState({ activeColor: nextSameHue });
    });

    expect(hueRenderCount).toBe(1); // still 1 — no re-render
  });

  it('HueRing DOES re-render when activeColor.h changes', () => {
    // Baseline: make sure the selector DOES trigger on real hue changes
    // so a broken selector doesn't silently pass the previous test.
    let hueRenderCount = 0;
    const onRender: ProfilerOnRenderCallback = (id) => {
      if (id === 'HueRing') hueRenderCount += 1;
    };

    act(() => {
      useEditorStore.setState({
        activeColor: pickerStateFromHex('#ff0000')!, // h=0
      });
    });

    mount(
      createElement(
        Profiler,
        { id: 'HueRing', onRender },
        createElement(HueRing),
      ),
    );
    expect(hueRenderCount).toBe(1);

    act(() => {
      useEditorStore.setState({
        activeColor: pickerStateFromHex('#00ff00')!, // h=120
      });
    });

    expect(hueRenderCount).toBe(2); // +1 on hue change
  });

  it('ColorPicker does NOT re-render when brushSize changes', () => {
    let pickerRenderCount = 0;
    const onRender: ProfilerOnRenderCallback = (id) => {
      if (id === 'ColorPicker') pickerRenderCount += 1;
    };

    mount(
      createElement(
        Profiler,
        { id: 'ColorPicker', onRender },
        createElement(ColorPicker),
      ),
    );
    expect(pickerRenderCount).toBe(1);

    // brushSize mutation: nothing inside the ColorPicker subtree reads
    // brushSize, so the Profiler at the ColorPicker root should not see
    // any additional commit.
    act(() => {
      useEditorStore.setState({ brushSize: 2 });
    });

    expect(pickerRenderCount).toBe(1);
  });
});
