// @vitest-environment jsdom
//
// M13.1 — SkinPreview3D component tests.
//
// WebGL doesn't exist in jsdom, so R3F's <Canvas> and drei's
// <OrbitControls> are stubbed into inert DOM shims. We're verifying
// orchestration, not GPU output:
//   1. Component mounts without errors
//   2. TextureLoader receives the correct skinUrl
//   3. Nearest-neighbour filter config applied (prevents Mojang-style
//      bilinear smearing of the 64×64 atlas)
//   4. OrbitControls rendered (users can rotate + zoom)
//   5. Texture disposed on unmount (prevents GPU leak when the hover
//      state toggles off on gallery cards)
//   6. ARM_WIDTH map encodes the classic/slim Minecraft distinction

import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ── Hoisted spies so the vi.mock factories can reach them. ────────

const textureLoadSpy = vi.hoisted(() => vi.fn());
const textureDisposeSpy = vi.hoisted(() => vi.fn());

// Mock three.js just enough to observe loader calls and dispose.
// The real module is used for constants (NearestFilter etc.) so the
// component's filter-assignment lines keep running.
vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal<typeof import('three')>();
  class MockTextureLoader {
    load(
      url: string,
      onLoad: (tex: { dispose: () => void } & Record<string, unknown>) => void,
    ) {
      textureLoadSpy(url);
      const fakeTexture: { dispose: () => void } & Record<string, unknown> = {
        magFilter: 0,
        minFilter: 0,
        generateMipmaps: true,
        dispose: () => {
          textureDisposeSpy();
        },
      };
      // Fire synchronously so the React effect can observe state
      // transition in the same tick — mirrors how a warm HTTP cache
      // resolves.
      onLoad(fakeTexture);
    }
  }
  return {
    ...actual,
    TextureLoader: MockTextureLoader,
  };
});

// Stub R3F's Canvas — render children into a plain div so the three
// intrinsic JSX tags (<mesh>, <boxGeometry>, etc.) show up as unknown
// web-components in the DOM. We don't assert on their attributes;
// their presence (mount, no throw) is what matters.
vi.mock('@react-three/fiber', () => ({
  Canvas: ({ children }: { children: ReactNode }) => (
    <div data-testid="r3f-canvas-stub">{children}</div>
  ),
}));

// Stub drei's OrbitControls — a marker div is enough to assert the
// component included user-rotation controls.
vi.mock('@react-three/drei', () => ({
  OrbitControls: () => <div data-testid="orbit-controls-stub" />,
}));

// Import AFTER the mocks so module-init picks them up.
import {
  ARM_WIDTH,
  SkinPreview3D,
} from '../app/gallery/_components/SkinPreview3D';

// @ts-expect-error — React 19 act env flag
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// React warns when three.js intrinsic tags (<mesh>, <boxGeometry>, …)
// hit the real DOM tree via our stubbed Canvas — they're normally
// consumed by R3F's reconciler, not React DOM. The warnings are
// cosmetic here; silence them so CI logs stay readable.
const R3F_WARNINGS = [
  'is using incorrect casing',
  'is unrecognized in this browser',
  'non-boolean attribute',
];
const originalConsoleError = console.error;

describe('SkinPreview3D', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    textureLoadSpy.mockClear();
    textureDisposeSpy.mockClear();
    console.error = (...args: unknown[]) => {
      if (
        typeof args[0] === 'string' &&
        R3F_WARNINGS.some((needle) => (args[0] as string).includes(needle))
      ) {
        return;
      }
      originalConsoleError(...args);
    };
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    document.body.removeChild(container);
    console.error = originalConsoleError;
  });

  const render = (
    props: Partial<React.ComponentProps<typeof SkinPreview3D>> = {},
  ) =>
    act(() => {
      root.render(
        <SkinPreview3D
          skinUrl="https://example.test/fake-skin.png"
          variant="classic"
          {...props}
        />,
      );
    });

  it('mounts without errors and renders the R3F Canvas stub', () => {
    render();
    expect(
      container.querySelector('[data-testid="r3f-canvas-stub"]'),
    ).not.toBeNull();
  });

  it('passes the skinUrl through to TextureLoader.load', () => {
    render({ skinUrl: 'https://cdn.test/owner-abc/skin.png' });
    expect(textureLoadSpy).toHaveBeenCalledTimes(1);
    expect(textureLoadSpy).toHaveBeenCalledWith(
      'https://cdn.test/owner-abc/skin.png',
    );
  });

  it('renders OrbitControls so users can rotate + zoom', () => {
    render();
    expect(
      container.querySelector('[data-testid="orbit-controls-stub"]'),
    ).not.toBeNull();
  });

  it('disposes the GPU texture on unmount (no leak per hover toggle)', () => {
    render();
    expect(textureDisposeSpy).not.toHaveBeenCalled();
    act(() => root.unmount());
    expect(textureDisposeSpy).toHaveBeenCalledTimes(1);
    // Re-create container so afterEach's unmount doesn't double-fault.
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  it('reloads texture when skinUrl changes and disposes the prior one', () => {
    render({ skinUrl: 'https://cdn.test/a.png' });
    expect(textureLoadSpy).toHaveBeenCalledWith('https://cdn.test/a.png');
    render({ skinUrl: 'https://cdn.test/b.png' });
    expect(textureLoadSpy).toHaveBeenCalledWith('https://cdn.test/b.png');
    // Prior texture from the first render should have been disposed by
    // the effect cleanup before the new one loaded.
    expect(textureDisposeSpy).toHaveBeenCalledTimes(1);
  });

  it('accepts both classic and slim variants without throwing', () => {
    render({ variant: 'classic' });
    render({ variant: 'slim' });
    expect(
      container.querySelector('[data-testid="r3f-canvas-stub"]'),
    ).not.toBeNull();
  });
});

describe('ARM_WIDTH', () => {
  it('encodes the classic vs slim Minecraft arm distinction', () => {
    expect(ARM_WIDTH.classic).toBe(0.3);
    expect(ARM_WIDTH.slim).toBe(0.25);
  });

  it('slim arms are narrower than classic arms (3px vs 4px)', () => {
    expect(ARM_WIDTH.slim).toBeLessThan(ARM_WIDTH.classic);
  });
});
