'use client';

/**
 * M11 Unit 1: publish metadata dialog.
 *
 * Collects name + optional comma-separated tags, calls the caller-
 * provided `onPublish` handler with the normalized payload, then shows
 * success / error state. The actual fetch + OG generation happens in
 * the caller (EditorHeader in Unit 6) — keeps this component testable
 * against a plain handler spy.
 *
 * Pattern: mirrors M10 AuthDialog (ARIA role=dialog, aria-modal,
 * focus trap, Escape + backdrop close) and M8 ExportDialog's
 * Sensitive handling. Escape + backdrop are no-ops while
 * state === 'loading'.
 */

import { useEffect, useRef, useState } from 'react';

import {
  MAX_TAG_LENGTH,
  MAX_TAGS,
  validateName,
  validateTags,
} from '@/lib/editor/tags';

type PublishMeta = {
  name: string;
  tags: string[];
};

export type PublishResult = {
  skinId: string;
  permalinkUrl: string;
  ogImageUrl: string | null;
};

type DialogState = 'idle' | 'loading' | 'success' | 'error';

type Props = {
  isOpen: boolean;
  onClose: () => void;
  onPublish: (meta: PublishMeta) => Promise<PublishResult>;
  /**
   * Optional handler invoked after a successful publish when the user
   * has ticked the "Start new skin after publishing" checkbox. Receives
   * no args; the caller is expected to reset the document and close
   * the dialog.
   */
  onCreateNew?: () => void;
};

const FOCUSABLE =
  'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"]), input:not([disabled]), textarea:not([disabled]), select:not([disabled])';

function getFocusable(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE));
}

export function PublishDialog({ isOpen, onClose, onPublish, onCreateNew }: Props) {
  const [state, setState] = useState<DialogState>('idle');
  const [name, setName] = useState('');
  const [tagsRaw, setTagsRaw] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState<PublishResult | null>(null);
  const [copied, setCopied] = useState(false);
  const [createNewAfter, setCreateNewAfter] = useState(false);

  const dialogRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  // Reset on open.
  useEffect(() => {
    if (!isOpen) return;
    setState('idle');
    setError('');
    setResult(null);
    setCopied(false);
    setCreateNewAfter(false);
    returnFocusRef.current = (document.activeElement as HTMLElement | null) ?? null;
  }, [isOpen]);

  // Focus first focusable on open.
  useEffect(() => {
    if (!isOpen) return;
    const el = dialogRef.current;
    if (el === null) return;
    getFocusable(el)[0]?.focus();
  }, [isOpen]);

  // Focus trap + Escape.
  useEffect(() => {
    if (!isOpen) return;
    const el = dialogRef.current;
    if (el === null) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (state === 'loading') {
          e.preventDefault();
          return;
        }
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      const focusable = getFocusable(el);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose, state]);

  // Auto-close after success.
  useEffect(() => {
    if (state !== 'success') return;
    const t = setTimeout(() => {
      onClose();
    }, 3000);
    return () => clearTimeout(t);
  }, [state, onClose]);

  // Restore focus.
  useEffect(() => {
    if (isOpen) return;
    returnFocusRef.current?.focus?.();
  }, [isOpen]);

  if (!isOpen) return null;

  const handleBackdropClick = () => {
    if (state === 'loading') return;
    onClose();
  };

  const handleCopy = async () => {
    if (result === null) return;
    try {
      if (typeof navigator.clipboard?.writeText === 'function') {
        await navigator.clipboard.writeText(result.permalinkUrl);
      } else {
        // Fallback for old Safari: textarea + execCommand.
        const ta = document.createElement('textarea');
        ta.value = result.permalinkUrl;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard denied — user can copy manually.
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setState('loading');
    setError('');

    const nameResult = validateName(name);
    if (!nameResult.ok) {
      setError(nameResult.error);
      setState('error');
      return;
    }

    const tagsResult = validateTags(tagsRaw);
    if (!tagsResult.ok) {
      setError(tagsResult.error);
      setState('error');
      return;
    }

    try {
      const res = await onPublish({ name: nameResult.name, tags: tagsResult.tags });
      setResult(res);
      setState('success');
      // "Publish & Create New" — caller resets the document and closes
      // the dialog, so the success UI never renders. The success-state
      // setters above still run so callers that don't pass onCreateNew
      // (or with the box unticked) get the normal post-publish UI.
      if (createNewAfter && onCreateNew !== undefined) {
        onCreateNew();
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Publish failed';
      setError(msg);
      setState('error');
    }
  };

  // Success body ────────────────────────────────────────────────
  if (state === 'success' && result !== null) {
    return (
      <>
        <div
          data-testid="publish-dialog-backdrop"
          style={{ position: 'fixed', inset: 0, zIndex: 49, background: 'rgba(0,0,0,0.5)' }}
          onClick={handleBackdropClick}
          aria-hidden="true"
        />
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="publish-dialog-title"
          data-testid="publish-dialog-success"
          className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg border border-ui-border bg-ui-surface p-6"
        >
          <h2
            id="publish-dialog-title"
            className="mb-2 text-xl font-semibold text-text-primary"
          >
            Published 🎉
          </h2>
          <p className="mb-4 text-sm text-text-secondary">
            Your skin is live. Share the link:
          </p>
          <div className="mb-4 flex items-center gap-2 rounded border border-ui-border bg-ui-base px-3 py-2">
            <code
              data-testid="publish-dialog-permalink"
              className="flex-1 truncate font-mono text-xs text-text-primary"
            >
              {result.permalinkUrl}
            </code>
            <button
              type="button"
              data-testid="publish-dialog-copy"
              onClick={handleCopy}
              className="shrink-0 rounded bg-accent px-3 py-1 text-xs font-medium text-canvas hover:bg-accent-hover"
            >
              {copied ? 'Copied!' : 'Copy'}
            </button>
          </div>
          <button
            type="button"
            onClick={onClose}
            data-testid="publish-dialog-success-close"
            className="w-full rounded border border-ui-border bg-ui-base px-4 py-2 text-sm text-text-secondary hover:text-text-primary"
          >
            Close
          </button>
        </div>
      </>
    );
  }

  // Form body ───────────────────────────────────────────────────
  return (
    <>
      <div
        data-testid="publish-dialog-backdrop"
        style={{ position: 'fixed', inset: 0, zIndex: 49, background: 'rgba(0,0,0,0.5)' }}
        onClick={handleBackdropClick}
        aria-hidden="true"
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="publish-dialog-title"
        data-testid="publish-dialog"
        className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg border border-ui-border bg-ui-surface"
      >
        <div className="flex items-center justify-between border-b border-ui-border px-5 py-3">
          <h2
            id="publish-dialog-title"
            className="font-mono text-sm font-medium text-text-primary"
          >
            Publish skin
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={state === 'loading'}
            data-testid="publish-dialog-close"
            aria-label="Close dialog"
            className="text-text-secondary transition-colors hover:text-text-primary disabled:opacity-50"
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-5 py-4">
          {error !== '' && (
            <div
              role="alert"
              data-testid="publish-dialog-error"
              className="mb-4 whitespace-pre-wrap break-words rounded border border-red-500/20 bg-red-500/10 p-3 font-mono text-xs text-red-400"
            >
              {error}
            </div>
          )}

          <div className="mb-4">
            <label
              htmlFor="publish-dialog-name"
              className="mb-1 block text-sm text-text-secondary"
            >
              Name <span className="text-red-400">*</span>
            </label>
            <input
              id="publish-dialog-name"
              data-testid="publish-dialog-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={state === 'loading'}
              maxLength={50}
              required
              className="w-full rounded border border-ui-border bg-ui-base px-3 py-2 text-text-primary focus:border-accent focus:outline-none disabled:opacity-50"
              placeholder="My cool skin"
            />
          </div>

          <div className="mb-4">
            <label
              htmlFor="publish-dialog-tags"
              className="mb-1 block text-sm text-text-secondary"
            >
              Tags <span className="text-text-muted">(optional, comma-separated, up to {MAX_TAGS})</span>
            </label>
            <input
              id="publish-dialog-tags"
              data-testid="publish-dialog-tags"
              type="text"
              value={tagsRaw}
              onChange={(e) => setTagsRaw(e.target.value)}
              disabled={state === 'loading'}
              className="w-full rounded border border-ui-border bg-ui-base px-3 py-2 text-text-primary focus:border-accent focus:outline-none disabled:opacity-50"
              placeholder="hoodie, blue, cat"
              maxLength={MAX_TAG_LENGTH * MAX_TAGS + MAX_TAGS * 2}
            />
          </div>

          {onCreateNew !== undefined && (
            <label className="mb-4 flex items-center gap-2 text-sm text-text-secondary">
              <input
                type="checkbox"
                data-testid="publish-dialog-create-new"
                checked={createNewAfter}
                onChange={(e) => setCreateNewAfter(e.target.checked)}
                disabled={state === 'loading'}
                className="rounded border-ui-border disabled:opacity-50"
              />
              Start new skin after publishing
            </label>
          )}

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={state === 'loading'}
              data-testid="publish-dialog-cancel"
              className="rounded border border-ui-border bg-ui-base px-3 py-1.5 font-mono text-sm text-text-secondary hover:text-text-primary disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={state === 'loading'}
              data-testid="publish-dialog-submit"
              className="rounded bg-accent px-3 py-1.5 font-mono text-sm font-semibold text-canvas hover:bg-accent-hover disabled:opacity-50"
            >
              {state === 'loading' ? 'Publishing…' : 'Publish'}
            </button>
          </div>
        </form>
      </div>
    </>
  );
}
