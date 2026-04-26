// @vitest-environment jsdom
//
// M16 Unit 5 — AIGenerateDialog tests.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AIGenerateDialog } from '../AIGenerateDialog';

// @ts-expect-error — React 19 act env flag
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const fillTextarea = (el: HTMLTextAreaElement, value: string) => {
  const nativeSetter = Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    'value',
  )?.set;
  nativeSetter?.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
};

describe('AIGenerateDialog', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    vi.useRealTimers();
  });

  afterEach(() => {
    act(() => root.unmount());
    document.body.removeChild(container);
  });

  const render = (
    isOpen: boolean,
    onClose = vi.fn(),
    onGenerate: (prompt: string) => Promise<void> = vi.fn(async () => undefined),
  ) => {
    act(() => {
      root.render(
        <AIGenerateDialog
          isOpen={isOpen}
          onClose={onClose}
          onGenerate={onGenerate}
        />,
      );
    });
    return { onClose, onGenerate };
  };

  const $ = (testid: string): HTMLElement | null =>
    document.querySelector(`[data-testid="${testid}"]`);

  it('does not render when isOpen=false', () => {
    render(false);
    expect($('ai-dialog')).toBeNull();
  });

  it('renders when isOpen=true', () => {
    render(true);
    expect($('ai-dialog')).not.toBeNull();
    expect($('ai-dialog-prompt')).not.toBeNull();
    expect($('ai-dialog-submit')).not.toBeNull();
  });

  it('submit is disabled while prompt is empty', () => {
    render(true);
    expect(($('ai-dialog-submit') as HTMLButtonElement).disabled).toBe(true);
  });

  it('submit becomes enabled with non-empty prompt', () => {
    render(true);
    fillTextarea($('ai-dialog-prompt') as HTMLTextAreaElement, 'a knight');
    expect(($('ai-dialog-submit') as HTMLButtonElement).disabled).toBe(false);
  });

  it('whitespace-only prompt keeps submit disabled', () => {
    render(true);
    fillTextarea($('ai-dialog-prompt') as HTMLTextAreaElement, '    ');
    expect(($('ai-dialog-submit') as HTMLButtonElement).disabled).toBe(true);
  });

  it('counter shows {len}/200', () => {
    render(true);
    expect(($('ai-dialog-counter') as HTMLElement).textContent).toBe('0/200');
    fillTextarea($('ai-dialog-prompt') as HTMLTextAreaElement, 'hello');
    expect(($('ai-dialog-counter') as HTMLElement).textContent).toBe('5/200');
  });

  it('textarea has maxLength=200', () => {
    render(true);
    const ta = $('ai-dialog-prompt') as HTMLTextAreaElement;
    expect(ta.maxLength).toBe(200);
  });

  it('happy path: submit calls onGenerate with trimmed prompt', async () => {
    const onGenerate = vi.fn(async () => undefined);
    render(true, vi.fn(), onGenerate);
    fillTextarea(
      $('ai-dialog-prompt') as HTMLTextAreaElement,
      '  a knight  ',
    );
    await act(async () => {
      ($('ai-dialog-submit') as HTMLButtonElement).click();
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(onGenerate).toHaveBeenCalledWith('a knight');
  });

  it('shows success state after successful submit', async () => {
    render(true, vi.fn(), async () => undefined);
    fillTextarea($('ai-dialog-prompt') as HTMLTextAreaElement, 'hi');
    await act(async () => {
      ($('ai-dialog-submit') as HTMLButtonElement).click();
      await new Promise((r) => setTimeout(r, 0));
    });
    expect($('ai-dialog-success')).not.toBeNull();
  });

  it('auto-closes after success (1.5s)', async () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    render(true, onClose, async () => undefined);
    fillTextarea($('ai-dialog-prompt') as HTMLTextAreaElement, 'hi');
    await act(async () => {
      ($('ai-dialog-submit') as HTMLButtonElement).click();
      // Drain pending microtasks before advancing timers.
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    expect(onClose).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('shows error state when onGenerate rejects', async () => {
    const onGenerate = vi.fn(async () => {
      throw new Error('rate-limited — try again in 23m');
    });
    render(true, vi.fn(), onGenerate);
    fillTextarea($('ai-dialog-prompt') as HTMLTextAreaElement, 'hi');
    await act(async () => {
      ($('ai-dialog-submit') as HTMLButtonElement).click();
      await new Promise((r) => setTimeout(r, 0));
    });
    const err = $('ai-dialog-error');
    expect(err).not.toBeNull();
    expect(err?.textContent).toContain('rate-limited');
  });

  it('error → retry returns to idle with prompt preserved', async () => {
    const onGenerate = vi.fn(async () => {
      throw new Error('boom');
    });
    render(true, vi.fn(), onGenerate);
    fillTextarea($('ai-dialog-prompt') as HTMLTextAreaElement, 'hi');
    await act(async () => {
      ($('ai-dialog-submit') as HTMLButtonElement).click();
      await new Promise((r) => setTimeout(r, 0));
    });
    expect($('ai-dialog-error')).not.toBeNull();
    act(() => {
      ($('ai-dialog-retry') as HTMLButtonElement).click();
    });
    expect($('ai-dialog-error')).toBeNull();
    expect(($('ai-dialog-prompt') as HTMLTextAreaElement).value).toBe('hi');
  });

  it('Escape closes the dialog when idle', () => {
    const { onClose } = render(true);
    act(() => {
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      );
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Escape during loading is ignored', async () => {
    let resolve!: () => void;
    const promise = new Promise<void>((r) => {
      resolve = r;
    });
    const onGenerate = vi.fn(() => promise);
    const onClose = vi.fn();
    render(true, onClose, onGenerate);
    fillTextarea($('ai-dialog-prompt') as HTMLTextAreaElement, 'hi');
    act(() => {
      ($('ai-dialog-submit') as HTMLButtonElement).click();
    });
    // dialog is in loading state; Escape should NOT close.
    act(() => {
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      );
    });
    expect(onClose).not.toHaveBeenCalled();
    // Resolve to allow cleanup without leaking the pending promise.
    await act(async () => {
      resolve();
      await new Promise((r) => setTimeout(r, 0));
    });
  });

  it('backdrop click during loading is ignored', async () => {
    let resolve!: () => void;
    const promise = new Promise<void>((r) => {
      resolve = r;
    });
    const onGenerate = vi.fn(() => promise);
    const onClose = vi.fn();
    render(true, onClose, onGenerate);
    fillTextarea($('ai-dialog-prompt') as HTMLTextAreaElement, 'hi');
    act(() => {
      ($('ai-dialog-submit') as HTMLButtonElement).click();
    });
    act(() => {
      ($('ai-dialog-backdrop') as HTMLElement).click();
    });
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => {
      resolve();
      await new Promise((r) => setTimeout(r, 0));
    });
  });

  it('cancel button closes the dialog', () => {
    const { onClose } = render(true);
    act(() => {
      ($('ai-dialog-cancel') as HTMLButtonElement).click();
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('X button closes the dialog', () => {
    const { onClose } = render(true);
    act(() => {
      ($('ai-dialog-close') as HTMLButtonElement).click();
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('focus lands on first focusable element on open', () => {
    render(true);
    // First focusable is the X button.
    expect(document.activeElement).toBe($('ai-dialog-close'));
  });

  it('preserves prompt across close+reopen', () => {
    let isOpen = true;
    const onClose = vi.fn(() => {
      isOpen = false;
    });
    const setPrompt = (v: string) =>
      fillTextarea($('ai-dialog-prompt') as HTMLTextAreaElement, v);

    act(() => {
      root.render(
        <AIGenerateDialog
          isOpen={isOpen}
          onClose={onClose}
          onGenerate={async () => undefined}
        />,
      );
    });
    setPrompt('a knight');
    act(() => {
      root.render(
        <AIGenerateDialog
          isOpen={false}
          onClose={onClose}
          onGenerate={async () => undefined}
        />,
      );
    });
    act(() => {
      root.render(
        <AIGenerateDialog
          isOpen={true}
          onClose={onClose}
          onGenerate={async () => undefined}
        />,
      );
    });
    // Prompt is preserved (component-internal state, not isOpen-reset).
    expect(($('ai-dialog-prompt') as HTMLTextAreaElement).value).toBe('a knight');
  });
});
