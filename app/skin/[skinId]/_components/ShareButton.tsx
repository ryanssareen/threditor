'use client';

/**
 * M14: share affordance for skin permalinks.
 *
 * On devices where `navigator.share` + `navigator.canShare` are both
 * present (iOS Safari, Android Chrome, some macOS Safari builds), the
 * button invokes the native sheet directly — no custom menu appears.
 *
 * On everything else, clicking toggles a dropdown menu with
 * Copy link / X / Facebook / Reddit / LinkedIn. Each intent opens in
 * a new tab via `window.open(..., 'noopener,noreferrer')`.
 *
 * Click-outside, Escape, and selecting an item all close the menu.
 * Focus returns to the trigger on close. Arrow-key navigation cycles
 * menu items; Home/End jump to first/last.
 *
 * `navigator.clipboard.writeText` is feature-detected and falls back
 * to a hidden-textarea `execCommand('copy')` path for older Safari /
 * insecure-origin edge cases.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import {
  facebookIntent,
  linkedinIntent,
  redditIntent,
  twitterIntent,
} from '@/lib/seo/share-intents';

type Props = {
  shareUrl: string;
  shareText: { short: string; long: string };
  skinName: string;
};

type Mode = 'closed' | 'menu';

const COPIED_LABEL_MS = 2000;

function canNativeShare(url: string): boolean {
  if (typeof navigator === 'undefined') return false;
  if (typeof navigator.share !== 'function') return false;
  // `canShare` is present on Safari/Chrome with a Web Share API
  // implementation. It returns false in some browsers (e.g. desktop
  // Firefox that shims `share`) — fall through to the menu there.
  if (typeof navigator.canShare !== 'function') return true;
  try {
    return navigator.canShare({ url });
  } catch {
    return false;
  }
}

function execCommandFallback(text: string): void {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.position = 'fixed';
  ta.style.top = '-9999px';
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand('copy');
  } finally {
    document.body.removeChild(ta);
  }
}

async function copyToClipboard(text: string): Promise<void> {
  if (
    typeof navigator !== 'undefined' &&
    typeof navigator.clipboard?.writeText === 'function'
  ) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Permission denied, document-not-focused, or any other reject —
      // fall through to the execCommand path rather than bubbling.
    }
  }
  execCommandFallback(text);
}

export function ShareButton({ shareUrl, shareText, skinName }: Props) {
  const [mode, setMode] = useState<Mode>('closed');
  const [copied, setCopied] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const copiedTimerRef = useRef<number | null>(null);

  const closeMenu = useCallback(() => {
    setMode('closed');
    triggerRef.current?.focus();
  }, []);

  // Click outside + Escape while menu is open.
  useEffect(() => {
    if (mode !== 'menu') return;

    const onClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        menuRef.current?.contains(target) === true ||
        triggerRef.current?.contains(target) === true
      ) {
        return;
      }
      setMode('closed');
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeMenu();
      }
    };

    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [mode, closeMenu]);

  // Clear "Copied" state timer on unmount.
  useEffect(() => {
    return () => {
      if (copiedTimerRef.current !== null) {
        window.clearTimeout(copiedTimerRef.current);
      }
    };
  }, []);

  const handleTriggerClick = useCallback(async () => {
    if (canNativeShare(shareUrl)) {
      try {
        await navigator.share({
          title: skinName,
          text: shareText.short,
          url: shareUrl,
        });
      } catch (err) {
        // AbortError (user dismissed) is normal — swallow silently.
        if (err instanceof Error && err.name === 'AbortError') return;
        console.warn('ShareButton: navigator.share failed', err);
      }
      return;
    }
    setMode((m) => (m === 'menu' ? 'closed' : 'menu'));
  }, [shareUrl, shareText, skinName]);

  const openIntent = useCallback(
    (url: string) => {
      window.open(url, '_blank', 'noopener,noreferrer');
      setMode('closed');
    },
    [],
  );

  const handleCopy = useCallback(async () => {
    try {
      await copyToClipboard(shareUrl);
      setCopied(true);
      if (copiedTimerRef.current !== null) {
        window.clearTimeout(copiedTimerRef.current);
      }
      copiedTimerRef.current = window.setTimeout(() => {
        setCopied(false);
        copiedTimerRef.current = null;
      }, COPIED_LABEL_MS);
    } catch (err) {
      console.warn('ShareButton: clipboard write failed', err);
    }
    // Do NOT close the menu; user may want to see the "Copied" label.
  }, [shareUrl]);

  // Arrow-key nav within the menu.
  const handleMenuKey = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      const items = menuRef.current?.querySelectorAll<HTMLElement>(
        '[role="menuitem"]',
      );
      if (items === undefined || items.length === 0) return;
      const arr = Array.from(items);
      const activeIdx = arr.indexOf(document.activeElement as HTMLElement);

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        const next = arr[(activeIdx + 1 + arr.length) % arr.length];
        next?.focus();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        const next = arr[(activeIdx - 1 + arr.length) % arr.length];
        next?.focus();
      } else if (e.key === 'Home') {
        e.preventDefault();
        arr[0]?.focus();
      } else if (e.key === 'End') {
        e.preventDefault();
        arr[arr.length - 1]?.focus();
      }
    },
    [],
  );

  const menuOpen = mode === 'menu';

  return (
    <div className="relative flex-1">
      <button
        ref={triggerRef}
        type="button"
        data-testid="share-trigger"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        onClick={handleTriggerClick}
        className="w-full rounded border border-ui-border bg-ui-surface px-3 py-2 text-center text-sm font-medium text-text-primary transition-colors hover:border-accent/60 hover:text-accent"
      >
        Share
      </button>

      {menuOpen && (
        <div
          ref={menuRef}
          role="menu"
          aria-label="Share menu"
          data-testid="share-menu"
          onKeyDown={handleMenuKey}
          className="absolute left-0 right-0 top-full z-20 mt-2 overflow-hidden rounded-lg border border-ui-border bg-ui-surface shadow-panel"
        >
          <button
            type="button"
            role="menuitem"
            data-testid="share-copy"
            onClick={handleCopy}
            className="block w-full px-4 py-2 text-left text-sm text-text-primary hover:bg-ui-base"
          >
            {copied ? 'Copied ✓' : 'Copy link'}
          </button>
          <button
            type="button"
            role="menuitem"
            data-testid="share-twitter"
            onClick={() =>
              openIntent(twitterIntent({ text: shareText.short, url: shareUrl }))
            }
            className="block w-full px-4 py-2 text-left text-sm text-text-primary hover:bg-ui-base"
          >
            Share on X
          </button>
          <button
            type="button"
            role="menuitem"
            data-testid="share-facebook"
            onClick={() => openIntent(facebookIntent({ url: shareUrl }))}
            className="block w-full px-4 py-2 text-left text-sm text-text-primary hover:bg-ui-base"
          >
            Share on Facebook
          </button>
          <button
            type="button"
            role="menuitem"
            data-testid="share-reddit"
            onClick={() =>
              openIntent(redditIntent({ url: shareUrl, title: skinName }))
            }
            className="block w-full px-4 py-2 text-left text-sm text-text-primary hover:bg-ui-base"
          >
            Share on Reddit
          </button>
          <button
            type="button"
            role="menuitem"
            data-testid="share-linkedin"
            onClick={() => openIntent(linkedinIntent({ url: shareUrl }))}
            className="block w-full px-4 py-2 text-left text-sm text-text-primary hover:bg-ui-base"
          >
            Share on LinkedIn
          </button>
        </div>
      )}
    </div>
  );
}
