// @vitest-environment jsdom
//
// M11 Unit 1 — PublishDialog tests.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PublishDialog, type PublishResult } from '../PublishDialog';

// @ts-expect-error — React 19 act env flag
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const fillInput = (el: HTMLInputElement, value: string) => {
  const nativeSetter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    'value',
  )?.set;
  nativeSetter?.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
};

describe('PublishDialog', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    document.body.removeChild(container);
  });

  const render = (
    isOpen: boolean,
    onClose = vi.fn(),
    onPublish: (meta: { name: string; tags: string[] }) => Promise<PublishResult> = vi.fn(async () => ({
      skinId: 'stub-id',
      permalinkUrl: '/skin/stub-id',
      ogImageUrl: null,
    })),
    onCreateNew?: () => void,
  ) => {
    act(() => {
      root.render(
        <PublishDialog
          isOpen={isOpen}
          onClose={onClose}
          onPublish={onPublish}
          onCreateNew={onCreateNew}
        />,
      );
    });
    return { onClose, onPublish, onCreateNew };
  };

  const $ = (testid: string): HTMLElement | null =>
    document.querySelector(`[data-testid="${testid}"]`);

  it('does not render when isOpen=false', () => {
    render(false);
    expect($('publish-dialog')).toBeNull();
  });

  it('renders when isOpen=true', () => {
    render(true);
    expect($('publish-dialog')).not.toBeNull();
  });

  it('X button closes the dialog', () => {
    const { onClose } = render(true);
    act(() => {
      ($('publish-dialog-close') as HTMLButtonElement).click();
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('backdrop click closes the dialog', () => {
    const { onClose } = render(true);
    act(() => {
      ($('publish-dialog-backdrop') as HTMLElement).click();
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Escape key closes the dialog', () => {
    const { onClose } = render(true);
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('happy path: fills form + submits → onPublish called with normalized payload', async () => {
    const onPublish = vi.fn(async () => ({
      skinId: 'abc',
      permalinkUrl: '/skin/abc',
      ogImageUrl: null,
    }));
    render(true, vi.fn(), onPublish);
    fillInput($('publish-dialog-name') as HTMLInputElement, '  My Cool Skin  ');
    fillInput($('publish-dialog-tags') as HTMLInputElement, 'Cool, Cool, BLUE');
    await act(async () => {
      ($('publish-dialog-submit') as HTMLButtonElement).click();
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(onPublish).toHaveBeenCalledWith({
      name: 'My Cool Skin',
      tags: ['cool', 'blue'],
    });
  });

  it('success state shows permalink + Copy button', async () => {
    render(true, vi.fn(), async () => ({
      skinId: 'abc',
      permalinkUrl: 'https://x.y/skin/abc',
      ogImageUrl: null,
    }));
    fillInput($('publish-dialog-name') as HTMLInputElement, 'Cool Skin');
    await act(async () => {
      ($('publish-dialog-submit') as HTMLButtonElement).click();
      await new Promise((r) => setTimeout(r, 0));
    });
    expect($('publish-dialog-success')).not.toBeNull();
    expect($('publish-dialog-permalink')?.textContent).toBe('https://x.y/skin/abc');
    expect($('publish-dialog-copy')).not.toBeNull();
  });

  it('empty name blocks submit (client-side validation)', async () => {
    const onPublish = vi.fn();
    render(true, vi.fn(), onPublish);
    // Browser native validation prevents submit when required field is empty.
    // The form's onSubmit handler never runs. Assert onPublish not called.
    await act(async () => {
      ($('publish-dialog-submit') as HTMLButtonElement).click();
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(onPublish).not.toHaveBeenCalled();
  });

  it('too many tags shows inline error without calling onPublish', async () => {
    const onPublish = vi.fn();
    render(true, vi.fn(), onPublish);
    fillInput($('publish-dialog-name') as HTMLInputElement, 'Cool');
    fillInput($('publish-dialog-tags') as HTMLInputElement, 'a,b,c,d,e,f,g,h,i');
    await act(async () => {
      ($('publish-dialog-submit') as HTMLButtonElement).click();
      await new Promise((r) => setTimeout(r, 0));
    });
    expect($('publish-dialog-error')?.textContent).toContain('Maximum 8');
    expect(onPublish).not.toHaveBeenCalled();
  });

  it('onPublish rejection shows error + preserves form input', async () => {
    const onPublish = vi.fn(async () => {
      throw new Error('Network broken');
    });
    render(true, vi.fn(), onPublish);
    fillInput($('publish-dialog-name') as HTMLInputElement, 'Cool');
    await act(async () => {
      ($('publish-dialog-submit') as HTMLButtonElement).click();
      await new Promise((r) => setTimeout(r, 0));
    });
    expect($('publish-dialog-error')?.textContent).toContain('Network broken');
    // Form values preserved (name still present).
    expect(($('publish-dialog-name') as HTMLInputElement).value).toBe('Cool');
  });

  it('Escape is a no-op while loading', async () => {
    let resolvePublish: (v: PublishResult) => void;
    const onPublish = vi.fn(
      () =>
        new Promise<PublishResult>((r) => {
          resolvePublish = r;
        }),
    );
    const onClose = vi.fn();
    render(true, onClose, onPublish);
    fillInput($('publish-dialog-name') as HTMLInputElement, 'Cool');
    act(() => {
      ($('publish-dialog-submit') as HTMLButtonElement).click();
    });
    // Now in loading state. Escape should not close.
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(onClose).not.toHaveBeenCalled();

    // Resolve so the test doesn't leak the pending promise into afterEach.
    await act(async () => {
      resolvePublish!({ skinId: 'x', permalinkUrl: '/skin/x', ogImageUrl: null });
      await new Promise((r) => setTimeout(r, 0));
    });
  });

  it('hides "Start new skin" checkbox when onCreateNew not provided', () => {
    render(true);
    expect($('publish-dialog-create-new')).toBeNull();
  });

  it('shows "Start new skin" checkbox when onCreateNew provided', () => {
    render(true, vi.fn(), undefined, vi.fn());
    const cb = $('publish-dialog-create-new') as HTMLInputElement | null;
    expect(cb).not.toBeNull();
    expect(cb!.checked).toBe(false);
  });

  it('checkbox checked + publish success → onCreateNew called', async () => {
    const onCreateNew = vi.fn();
    render(true, vi.fn(), undefined, onCreateNew);
    fillInput($('publish-dialog-name') as HTMLInputElement, 'Cool');
    act(() => {
      ($('publish-dialog-create-new') as HTMLInputElement).click();
    });
    await act(async () => {
      ($('publish-dialog-submit') as HTMLButtonElement).click();
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(onCreateNew).toHaveBeenCalledTimes(1);
  });

  it('checkbox unchecked + publish success → onCreateNew NOT called', async () => {
    const onCreateNew = vi.fn();
    render(true, vi.fn(), undefined, onCreateNew);
    fillInput($('publish-dialog-name') as HTMLInputElement, 'Cool');
    await act(async () => {
      ($('publish-dialog-submit') as HTMLButtonElement).click();
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(onCreateNew).not.toHaveBeenCalled();
  });

  it('checkbox checked + publish FAILURE → onCreateNew NOT called', async () => {
    const onCreateNew = vi.fn();
    const onPublish = vi.fn(async () => {
      throw new Error('Network broken');
    });
    render(true, vi.fn(), onPublish, onCreateNew);
    fillInput($('publish-dialog-name') as HTMLInputElement, 'Cool');
    act(() => {
      ($('publish-dialog-create-new') as HTMLInputElement).click();
    });
    await act(async () => {
      ($('publish-dialog-submit') as HTMLButtonElement).click();
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(onCreateNew).not.toHaveBeenCalled();
  });

  it('backdrop click is a no-op while loading', async () => {
    let resolvePublish: (v: PublishResult) => void;
    const onPublish = vi.fn(
      () =>
        new Promise<PublishResult>((r) => {
          resolvePublish = r;
        }),
    );
    const onClose = vi.fn();
    render(true, onClose, onPublish);
    fillInput($('publish-dialog-name') as HTMLInputElement, 'Cool');
    act(() => {
      ($('publish-dialog-submit') as HTMLButtonElement).click();
    });
    act(() => {
      ($('publish-dialog-backdrop') as HTMLElement).click();
    });
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => {
      resolvePublish!({ skinId: 'x', permalinkUrl: '/skin/x', ogImageUrl: null });
      await new Promise((r) => setTimeout(r, 0));
    });
  });
});
