// @vitest-environment jsdom
/**
 * M7 Unit 0: use-texture-manager placeholder-seed decoupling.
 *
 * Verifies the two-effect split:
 *   - Effect A (TM lifecycle, deps: [variant]) disposes + rebuilds TM on
 *     variant change. Does NOT seed placeholder.
 *   - Effect B (placeholder seed, deps: [bundle, layers.length, variant])
 *     seeds a placeholder when layers are empty post-bundle-mount.
 *
 * Critical path: apply-template (M7 Unit 4) populates layers + variant
 * atomically → Effect A sees the new variant AND populated layers →
 * Effect A composites those layers, Effect B sees layers.length > 0
 * and skips seed. User variant toggle path: setVariant clears layers
 * so Effect B reseeds for the new variant.
 */

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { useTextureManagerBundle } from '../lib/editor/use-texture-manager';
import { useEditorStore } from '../lib/editor/store';
import type { Layer } from '../lib/editor/types';

type HookHarnessProps = {
  variant: 'classic' | 'slim';
  onBundleChange: (bundle: ReturnType<typeof useTextureManagerBundle>) => void;
};

function HookHarness({ variant, onBundleChange }: HookHarnessProps): null {
  const bundle = useTextureManagerBundle(variant);
  onBundleChange(bundle);
  return null;
}

function resetStore(): void {
  useEditorStore.setState({
    variant: 'classic',
    layers: [],
    activeLayerId: '',
  });
}

// @ts-expect-error — jsdom-react environment flag for createRoot + act
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe('use-texture-manager — placeholder seed decoupling', () => {
  let container: HTMLDivElement;

  // jsdom doesn't ship Canvas 2D rendering; stub getContext so
  // TextureManager's default constructor path succeeds. Returned ctx
  // is a minimal no-op shape.
  beforeAll(() => {
    vi.stubGlobal(
      'ImageData',
      class {
        data: Uint8ClampedArray;
        width: number;
        height: number;
        constructor(data: Uint8ClampedArray, width: number, height: number) {
          this.data = data;
          this.width = width;
          this.height = height;
        }
      },
    );
    HTMLCanvasElement.prototype.getContext = function mockGetContext() {
      return {
        imageSmoothingEnabled: true,
        globalAlpha: 1,
        globalCompositeOperation: 'source-over',
        fillStyle: '#000',
        clearRect: () => {},
        fillRect: () => {},
        putImageData: () => {},
        drawImage: () => {},
        getImageData: () => ({
          data: new Uint8ClampedArray(64 * 64 * 4).fill(80),
          width: 64,
          height: 64,
        }),
      } as unknown as CanvasRenderingContext2D;
    } as unknown as HTMLCanvasElement['getContext'];
  });

  beforeEach(() => {
    resetStore();
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.removeChild(container);
    vi.restoreAllMocks();
  });

  it('seeds placeholder when mounted with empty layers', async () => {
    let captured: ReturnType<typeof useTextureManagerBundle> = null;
    const onBundleChange = (b: typeof captured): void => {
      captured = b;
    };

    await act(async () => {
      const root = createRoot(container);
      root.render(
        <HookHarness variant="classic" onBundleChange={onBundleChange} />,
      );
    });

    expect(captured).not.toBeNull();
    const layers = useEditorStore.getState().layers;
    expect(layers.length).toBe(1);
    expect(layers[0].id).toBe('base');
    expect(layers[0].pixels.length).toBe(64 * 64 * 4);
  });

  it('does NOT reseed placeholder when layers are pre-populated', async () => {
    // Simulate apply-template: populate layers + variant atomically
    // before the hook mounts.
    const templateLayer: Layer = {
      id: 'template:test',
      name: 'Template',
      visible: true,
      opacity: 1,
      blendMode: 'normal',
      pixels: new Uint8ClampedArray(64 * 64 * 4).fill(200),
    };
    useEditorStore.setState({
      layers: [templateLayer],
      activeLayerId: templateLayer.id,
    });

    await act(async () => {
      const root = createRoot(container);
      root.render(<HookHarness variant="classic" onBundleChange={() => {}} />);
    });

    const layers = useEditorStore.getState().layers;
    expect(layers.length).toBe(1);
    expect(layers[0].id).toBe('template:test');
    // Placeholder was NOT seeded over the template.
    expect(layers[0].pixels[0]).toBe(200);
  });

  it('setVariant clears layers so Effect B reseeds for the new variant', async () => {
    await act(async () => {
      const root = createRoot(container);
      root.render(<HookHarness variant="classic" onBundleChange={() => {}} />);
    });

    // Initial seed for classic
    const classicLayers = useEditorStore.getState().layers;
    expect(classicLayers.length).toBe(1);
    const classicPixelsRef = classicLayers[0].pixels;

    // User variant toggle via store action. In the real flow,
    // EditorLayout's handleUserVariantChange would wrap this with
    // undoStack.clear(); the hook behavior is the same.
    await act(async () => {
      useEditorStore.getState().setVariant('slim');
    });

    // After variant toggle: layers should be a fresh placeholder for
    // slim, NOT the classic placeholder reference.
    const slimLayers = useEditorStore.getState().layers;
    expect(slimLayers.length).toBe(1);
    expect(slimLayers[0].id).toBe('base');
    expect(slimLayers[0].pixels).not.toBe(classicPixelsRef);
  });

  it('setVariant is a no-op when the target matches current variant', () => {
    useEditorStore.getState().setVariant('classic');
    const layersBefore = useEditorStore.getState().layers;
    useEditorStore.getState().setVariant('classic');
    const layersAfter = useEditorStore.getState().layers;
    expect(layersAfter).toBe(layersBefore);
  });

  it('pre-populated layers survive a variant flip (apply-template path)', async () => {
    // Mount hook; seed placeholder for classic.
    await act(async () => {
      const root = createRoot(container);
      root.render(<HookHarness variant="classic" onBundleChange={() => {}} />);
    });

    // Simulate apply-template atomically setting variant + layers.
    // In Unit 4 this is via applyTemplateState; for Unit 0 we test
    // the underlying invariant: if layers are present when the
    // variant effect fires, they are preserved.
    const templateLayer: Layer = {
      id: 'template:slim-test',
      name: 'Slim Template',
      visible: true,
      opacity: 1,
      blendMode: 'normal',
      pixels: new Uint8ClampedArray(64 * 64 * 4).fill(150),
    };
    await act(async () => {
      useEditorStore.setState({
        variant: 'slim',
        layers: [templateLayer],
        activeLayerId: templateLayer.id,
      });
    });

    const layers = useEditorStore.getState().layers;
    expect(layers.length).toBe(1);
    expect(layers[0].id).toBe('template:slim-test');
    expect(layers[0].pixels[0]).toBe(150);
  });
});
