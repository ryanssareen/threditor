// @vitest-environment jsdom
//
// M14 Unit 4: ShareButton component tests.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ShareButton } from '../ShareButton';

// @ts-expect-error — React 19 act env flag
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const PROPS = {
  shareUrl: 'https://threditor.vercel.app/skin/019dbb09',
  shareText: {
    short: 'Shaded Hoodie by ryanssareen — a classic Minecraft skin',
    long: 'A classic Minecraft skin by ryanssareen. 17 likes. Tagged hoodie, shading.',
  },
  skinName: 'Shaded Hoodie',
};

type ClipboardShape = { writeText: (t: string) => Promise<void> };

describe('ShareButton', () => {
  let container: HTMLDivElement;
  let root: Root;
  let originalShare: typeof navigator.share | undefined;
  let originalCanShare: typeof navigator.canShare | undefined;
  let originalClipboard: Clipboard | undefined;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let windowOpenSpy: any;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    originalShare = navigator.share;
    originalCanShare = navigator.canShare;
    originalClipboard = navigator.clipboard;

    windowOpenSpy = vi
      .spyOn(window, 'open')
      .mockImplementation(() => null);
  });

  afterEach(() => {
    act(() => root.unmount());
    document.body.removeChild(container);

    // Restore navigator props.
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      writable: true,
      value: originalShare,
    });
    Object.defineProperty(navigator, 'canShare', {
      configurable: true,
      writable: true,
      value: originalCanShare,
    });
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      writable: true,
      value: originalClipboard,
    });

    windowOpenSpy.mockRestore();
    vi.useRealTimers();
  });

  const render = () =>
    act(() => {
      root.render(<ShareButton {...PROPS} />);
    });

  const click = (sel: string) => {
    const el = container.querySelector<HTMLElement>(sel);
    if (el === null) throw new Error(`No element found for ${sel}`);
    act(() => {
      el.click();
    });
  };

  it('renders a Share trigger button', () => {
    render();
    const trigger = container.querySelector<HTMLButtonElement>(
      '[data-testid="share-trigger"]',
    );
    expect(trigger).not.toBeNull();
    expect(trigger?.textContent?.trim()).toBe('Share');
    expect(trigger?.getAttribute('aria-haspopup')).toBe('menu');
    expect(trigger?.getAttribute('aria-expanded')).toBe('false');
  });

  it('opens the menu on click when Web Share API is unavailable', () => {
    // Ensure no native share present.
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: undefined,
    });
    render();
    click('[data-testid="share-trigger"]');

    const menu = container.querySelector('[data-testid="share-menu"]');
    expect(menu).not.toBeNull();
    const items = menu?.querySelectorAll('[role="menuitem"]');
    expect(items?.length).toBe(5);
    expect(
      container
        .querySelector('[data-testid="share-trigger"]')
        ?.getAttribute('aria-expanded'),
    ).toBe('true');
  });

  it('invokes navigator.share directly when the Web Share API is available', async () => {
    const shareSpy = vi.fn().mockResolvedValue(undefined);
    const canShareSpy = vi.fn().mockReturnValue(true);
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: shareSpy,
    });
    Object.defineProperty(navigator, 'canShare', {
      configurable: true,
      value: canShareSpy,
    });

    render();
    click('[data-testid="share-trigger"]');
    // Native share should fire; menu should NOT open.
    expect(shareSpy).toHaveBeenCalledTimes(1);
    expect(shareSpy).toHaveBeenCalledWith({
      title: PROPS.skinName,
      text: PROPS.shareText.short,
      url: PROPS.shareUrl,
    });
    expect(
      container.querySelector('[data-testid="share-menu"]'),
    ).toBeNull();
    // Flush microtasks (the awaited promise) so we don't leak into the
    // next test's state.
    await Promise.resolve();
  });

  it('falls through to the menu when canShare returns false', () => {
    const shareSpy = vi.fn();
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: shareSpy,
    });
    Object.defineProperty(navigator, 'canShare', {
      configurable: true,
      value: () => false,
    });
    render();
    click('[data-testid="share-trigger"]');
    expect(shareSpy).not.toHaveBeenCalled();
    expect(
      container.querySelector('[data-testid="share-menu"]'),
    ).not.toBeNull();
  });

  it('writes the URL to the clipboard and shows "Copied"', async () => {
    vi.useFakeTimers();
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: undefined,
    });
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText } as ClipboardShape,
    });

    render();
    click('[data-testid="share-trigger"]');
    click('[data-testid="share-copy"]');
    // Flush the awaited clipboard write.
    await act(async () => {
      await Promise.resolve();
    });

    expect(writeText).toHaveBeenCalledWith(PROPS.shareUrl);
    const copyBtn = container.querySelector('[data-testid="share-copy"]');
    expect(copyBtn?.textContent).toContain('Copied');

    // Advance past the 2s auto-revert window.
    await act(async () => {
      vi.advanceTimersByTime(2100);
    });
    expect(copyBtn?.textContent).not.toContain('Copied');
  });

  it('opens the Twitter intent URL in a new tab', () => {
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: undefined,
    });
    render();
    click('[data-testid="share-trigger"]');
    click('[data-testid="share-twitter"]');

    expect(windowOpenSpy).toHaveBeenCalledTimes(1);
    const [url, target, features] = windowOpenSpy.mock.calls[0];
    expect(String(url)).toMatch(/^https:\/\/twitter\.com\/intent\/tweet\?/);
    const parsed = new URL(String(url));
    expect(parsed.searchParams.get('url')).toBe(PROPS.shareUrl);
    expect(parsed.searchParams.get('text')).toBe(PROPS.shareText.short);
    expect(target).toBe('_blank');
    expect(features).toBe('noopener,noreferrer');
  });

  it('opens the Facebook intent URL', () => {
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: undefined,
    });
    render();
    click('[data-testid="share-trigger"]');
    click('[data-testid="share-facebook"]');
    const [url] = windowOpenSpy.mock.calls[0];
    expect(String(url)).toMatch(/^https:\/\/www\.facebook\.com\/sharer/);
  });

  it('opens the Reddit intent URL with url + title', () => {
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: undefined,
    });
    render();
    click('[data-testid="share-trigger"]');
    click('[data-testid="share-reddit"]');
    const [url] = windowOpenSpy.mock.calls[0];
    expect(String(url)).toMatch(/^https:\/\/www\.reddit\.com\/submit\?/);
    // URLSearchParams uses `+` for spaces; decode via URL API to assert
    // semantic round-trip rather than a specific encoding scheme.
    const parsed = new URL(String(url));
    expect(parsed.searchParams.get('title')).toBe(PROPS.skinName);
    expect(parsed.searchParams.get('url')).toBe(PROPS.shareUrl);
  });

  it('opens the LinkedIn intent URL', () => {
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: undefined,
    });
    render();
    click('[data-testid="share-trigger"]');
    click('[data-testid="share-linkedin"]');
    const [url] = windowOpenSpy.mock.calls[0];
    expect(String(url)).toMatch(
      /^https:\/\/www\.linkedin\.com\/sharing\/share-offsite/,
    );
  });

  it('closes the menu when Escape is pressed', () => {
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: undefined,
    });
    render();
    click('[data-testid="share-trigger"]');
    expect(
      container.querySelector('[data-testid="share-menu"]'),
    ).not.toBeNull();

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(
      container.querySelector('[data-testid="share-menu"]'),
    ).toBeNull();
  });

  it('closes the menu when clicking outside', () => {
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: undefined,
    });
    render();
    click('[data-testid="share-trigger"]');
    act(() => {
      const outside = document.createElement('div');
      document.body.appendChild(outside);
      outside.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      document.body.removeChild(outside);
    });
    expect(
      container.querySelector('[data-testid="share-menu"]'),
    ).toBeNull();
  });

  it('ignores AbortError when user dismisses the native share sheet', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const abortErr = Object.assign(new Error('User dismissed'), {
      name: 'AbortError',
    });
    const shareSpy = vi.fn().mockRejectedValue(abortErr);
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: shareSpy,
    });
    Object.defineProperty(navigator, 'canShare', {
      configurable: true,
      value: () => true,
    });

    render();
    click('[data-testid="share-trigger"]');
    await act(async () => {
      await Promise.resolve();
    });

    expect(shareSpy).toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
