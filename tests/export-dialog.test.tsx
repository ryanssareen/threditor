// @vitest-environment jsdom
//
// M8 Unit 2 + 3: ExportDialog tests.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { ExportDialog } from '../app/editor/_components/ExportDialog';
import { useEditorStore } from '../lib/editor/store';
import type { Layer } from '../lib/editor/types';

// Mock the export module so the dialog tests don't depend on the
// canvas + toBlob plumbing (already covered by tests/export.test.ts).
vi.mock('../lib/editor/export', () => ({
  exportLayersToBlob: vi.fn(async () => new Blob([new Uint8Array([1])], { type: 'image/png' })),
  downloadBlob: vi.fn(async () => {}),
  buildExportFilename: (
    variant: string,
    _at?: Date,
    resolution: number = 64,
  ) => {
    const suffix = resolution === 64 ? '' : `-${resolution}`;
    return `skin-${variant}-stub${suffix}.png`;
  },
  sanitizeFilename: (s: string) => s,
}));

import * as exportMod from '../lib/editor/export';

// @ts-expect-error — React 19 act env flag
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const makeLayer = (id: string): Layer => ({
  id,
  name: id,
  visible: true,
  opacity: 1,
  blendMode: 'normal',
  pixels: new Uint8ClampedArray(64 * 64 * 4),
});

function resetStore() {
  useEditorStore.setState({
    variant: 'classic',
    hasEditedSinceTemplate: false,
    lastAppliedTemplateId: null,
  });
}

describe('ExportDialog', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeAll(() => {
    // jsdom polyfills
    if (typeof URL.createObjectURL !== 'function') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (URL as any).createObjectURL = () => 'blob:stub';
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (URL as any).revokeObjectURL = () => {};
    }
  });

  beforeEach(() => {
    resetStore();
    vi.mocked(exportMod.exportLayersToBlob).mockClear();
    vi.mocked(exportMod.downloadBlob).mockClear();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    document.body.removeChild(container);
  });

  const render = (open: boolean, onClose = () => {}) => {
    act(() => {
      root.render(
        <ExportDialog
          open={open}
          onClose={onClose}
          getLayers={() => [makeLayer('base')]}
        />,
      );
    });
  };

  const $ = (testid: string): HTMLElement | null =>
    document.querySelector(`[data-testid="${testid}"]`);

  // ── Unit 2: normal dialog ──

  it('does not render when open=false', () => {
    render(false);
    expect($('export-dialog')).toBeNull();
  });

  it('renders normal body when no guardrail', () => {
    render(true);
    expect($('export-dialog')).not.toBeNull();
    expect($('export-dialog-guardrail')).toBeNull();
  });

  it('preselects variant matching current store variant', () => {
    useEditorStore.setState({ variant: 'slim' });
    render(true);
    const slimRadio = document.querySelector<HTMLInputElement>(
      'input[name="export-variant"][value="slim"]',
    );
    expect(slimRadio?.checked).toBe(true);
  });

  it('shows mismatch warning when user picks non-current variant', () => {
    render(true);
    expect($('export-variant-mismatch')).toBeNull();
    // Click the label — React's onChange fires from the synthetic click
    // on the native input (hidden via sr-only but still focusable).
    const slimLabel = $('export-variant-slim') as HTMLLabelElement;
    act(() => {
      slimLabel.click();
    });
    expect($('export-variant-mismatch')).not.toBeNull();
  });

  it('clicking Export calls exportLayersToBlob + downloadBlob + onClose', async () => {
    const onClose = vi.fn();
    render(true, onClose);
    const btn = $('export-submit') as HTMLButtonElement;

    await act(async () => {
      btn.click();
      // Wait for the async handleExport chain to settle.
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(exportMod.exportLayersToBlob).toHaveBeenCalledTimes(1);
    expect(exportMod.downloadBlob).toHaveBeenCalledTimes(1);
    expect(exportMod.downloadBlob).toHaveBeenCalledWith(
      expect.any(Blob),
      'skin-classic-stub.png',
    );
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Escape key closes the dialog', () => {
    const onClose = vi.fn();
    render(true, onClose);
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('backdrop click closes the dialog', () => {
    const onClose = vi.fn();
    render(true, onClose);
    act(() => {
      ($('export-dialog-backdrop') as HTMLElement).click();
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Cancel button closes without exporting', () => {
    const onClose = vi.fn();
    render(true, onClose);
    act(() => {
      ($('export-cancel') as HTMLButtonElement).click();
    });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(exportMod.exportLayersToBlob).not.toHaveBeenCalled();
  });

  // ── M15: resolution picker ──

  it('renders all four resolution radios (64/128/256/512)', () => {
    render(true);
    expect($('export-resolution-64')).not.toBeNull();
    expect($('export-resolution-128')).not.toBeNull();
    expect($('export-resolution-256')).not.toBeNull();
    expect($('export-resolution-512')).not.toBeNull();
  });

  it('64x64 is preselected by default', () => {
    render(true);
    const r64 = document.querySelector<HTMLInputElement>(
      'input[name="export-resolution"][value="64"]',
    );
    expect(r64?.checked).toBe(true);
  });

  it('selecting an HD resolution shows the modded-only help note', () => {
    render(true);
    expect($('export-hd-note')).toBeNull();
    act(() => {
      ($('export-resolution-256') as HTMLLabelElement).click();
    });
    expect($('export-hd-note')).not.toBeNull();
  });

  it('switching back to 64 hides the help note', () => {
    render(true);
    act(() => {
      ($('export-resolution-512') as HTMLLabelElement).click();
    });
    expect($('export-hd-note')).not.toBeNull();
    act(() => {
      ($('export-resolution-64') as HTMLLabelElement).click();
    });
    expect($('export-hd-note')).toBeNull();
  });

  it('filename preview appends -{size} when a non-64 resolution is picked', () => {
    render(true);
    // Default 64: no suffix.
    expect($('export-filename-preview')?.textContent).toBe(
      'skin-classic-stub.png',
    );
    // Pick 128.
    act(() => {
      ($('export-resolution-128') as HTMLLabelElement).click();
    });
    expect($('export-filename-preview')?.textContent).toBe(
      'skin-classic-stub-128.png',
    );
  });

  it('Export at 256 passes { resolution: 256 } to exportLayersToBlob', async () => {
    const onClose = vi.fn();
    render(true, onClose);
    act(() => {
      ($('export-resolution-256') as HTMLLabelElement).click();
    });
    await act(async () => {
      ($('export-submit') as HTMLButtonElement).click();
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(exportMod.exportLayersToBlob).toHaveBeenCalledTimes(1);
    expect(exportMod.exportLayersToBlob).toHaveBeenCalledWith(
      expect.any(Array),
      { resolution: 256 },
    );
    expect(exportMod.downloadBlob).toHaveBeenCalledWith(
      expect.any(Blob),
      'skin-classic-stub-256.png',
    );
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Re-opening the dialog resets the resolution to 64 (not sticky)', () => {
    const onClose = vi.fn();
    render(true, onClose);
    act(() => {
      ($('export-resolution-512') as HTMLLabelElement).click();
    });
    expect(
      document.querySelector<HTMLInputElement>(
        'input[name="export-resolution"][value="512"]',
      )?.checked,
    ).toBe(true);
    // Close, re-open.
    render(false);
    render(true, onClose);
    expect(
      document.querySelector<HTMLInputElement>(
        'input[name="export-resolution"][value="64"]',
      )?.checked,
    ).toBe(true);
  });

  // ── Unit 3: guardrail branch ──

  it('renders guardrail body when template applied + zero edits', () => {
    useEditorStore.setState({
      hasEditedSinceTemplate: false,
      lastAppliedTemplateId: 'identity:whitedogg',
    });
    render(true);
    expect($('export-dialog-guardrail')).not.toBeNull();
    expect($('export-dialog')).toBeNull();
  });

  it('guardrail does NOT render for fresh session (no template)', () => {
    useEditorStore.setState({
      hasEditedSinceTemplate: false,
      lastAppliedTemplateId: null,
    });
    render(true);
    expect($('export-dialog')).not.toBeNull();
    expect($('export-dialog-guardrail')).toBeNull();
  });

  it('guardrail does NOT render after at least one edit', () => {
    useEditorStore.setState({
      hasEditedSinceTemplate: true,
      lastAppliedTemplateId: 'identity:whitedogg',
    });
    render(true);
    expect($('export-dialog')).not.toBeNull();
    expect($('export-dialog-guardrail')).toBeNull();
  });

  it('"Edit first" closes the dialog without exporting', () => {
    useEditorStore.setState({
      hasEditedSinceTemplate: false,
      lastAppliedTemplateId: 'identity:whitedogg',
    });
    const onClose = vi.fn();
    render(true, onClose);
    act(() => {
      ($('export-guardrail-edit-first') as HTMLButtonElement).click();
    });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(exportMod.exportLayersToBlob).not.toHaveBeenCalled();
  });

  it('"Export anyway" proceeds with export', async () => {
    useEditorStore.setState({
      hasEditedSinceTemplate: false,
      lastAppliedTemplateId: 'identity:whitedogg',
    });
    const onClose = vi.fn();
    render(true, onClose);
    await act(async () => {
      ($('export-guardrail-anyway') as HTMLButtonElement).click();
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(exportMod.exportLayersToBlob).toHaveBeenCalledTimes(1);
    expect(exportMod.downloadBlob).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
