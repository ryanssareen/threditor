'use client';

/**
 * M13 Unit 5: edit-profile modal.
 *
 * Tiny dialog — just a display-name field. Follows the AuthDialog /
 * PublishDialog pattern (fixed + z-50 backdrop, click-outside to
 * close, Escape key, focus trap via initial autoFocus).
 *
 * On save: PATCH /api/users/me with a bearer token (the route also
 * accepts the session cookie as a fallback). On success: calls
 * `router.refresh()` so the parent Server Component re-fetches the
 * user doc and the header re-renders with the new name.
 */

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { useAuth } from '@/app/_providers/AuthProvider';

const MAX_DISPLAY_NAME = 50;

type Props = {
  isOpen: boolean;
  onClose: () => void;
  currentDisplayName: string;
  username: string;
};

type DialogState =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'error'; message: string }
  | { kind: 'success' };

export function EditProfileDialog({
  isOpen,
  onClose,
  currentDisplayName,
  username,
}: Props) {
  const { user } = useAuth();
  const router = useRouter();
  const [displayName, setDisplayName] = useState(currentDisplayName);
  const [state, setState] = useState<DialogState>({ kind: 'idle' });
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    setDisplayName(currentDisplayName);
    setState({ kind: 'idle' });
    // Autofocus on open so the user can type immediately.
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [isOpen, currentDisplayName]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const trimmed = displayName.trim();
  const changed = trimmed !== currentDisplayName.trim();
  const valid =
    trimmed.length > 0 &&
    trimmed.length <= MAX_DISPLAY_NAME &&
    !/[\u0000-\u001f\u007f]/.test(trimmed);
  const canSave = changed && valid && state.kind !== 'saving';

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSave) return;
    if (user === null) {
      setState({ kind: 'error', message: 'You are signed out — please sign in again.' });
      return;
    }

    setState({ kind: 'saving' });
    try {
      const idToken = await user.getIdToken(false);
      const res = await fetch('/api/users/me', {
        method: 'PATCH',
        credentials: 'include',
        headers: {
          Authorization: `Bearer ${idToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ displayName: trimmed }),
      });
      if (!res.ok) {
        let msg = `Update failed (HTTP ${res.status})`;
        try {
          const data = (await res.json()) as { error?: string };
          if (typeof data.error === 'string' && data.error.length > 0) {
            msg = data.error;
          }
        } catch {
          // ignore JSON parse failure
        }
        setState({ kind: 'error', message: msg });
        return;
      }
      setState({ kind: 'success' });
      // Re-fetch the Server Component tree so the header shows the new name.
      router.refresh();
      setTimeout(onClose, 400);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Network error';
      setState({ kind: 'error', message: msg });
    }
  };

  return (
    <div
      data-testid="edit-profile-backdrop"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-profile-title"
        data-testid="edit-profile-dialog"
        className="w-full max-w-md rounded-lg border border-ui-border bg-ui-surface p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-6 flex items-center justify-between">
          <h2
            id="edit-profile-title"
            className="text-xl font-semibold text-text-primary"
          >
            Edit profile
          </h2>
          <button
            type="button"
            onClick={onClose}
            data-testid="edit-profile-close"
            aria-label="Close dialog"
            className="text-text-secondary transition-colors hover:text-text-primary"
          >
            ✕
          </button>
        </div>

        {state.kind === 'error' && (
          <div
            role="alert"
            data-testid="edit-profile-error"
            className="mb-4 whitespace-pre-wrap break-words rounded border border-red-500/20 bg-red-500/10 p-3 font-mono text-xs text-red-400"
          >
            {state.message}
          </div>
        )}

        {state.kind === 'success' && (
          <div
            role="status"
            data-testid="edit-profile-success"
            className="mb-4 rounded border border-accent/20 bg-accent/10 p-3 font-mono text-xs text-accent"
          >
            Saved.
          </div>
        )}

        <form onSubmit={handleSave} className="space-y-4">
          <div>
            <label
              htmlFor="edit-profile-display-name"
              className="mb-1 block text-sm text-text-secondary"
            >
              Display name
            </label>
            <input
              id="edit-profile-display-name"
              ref={inputRef}
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              maxLength={MAX_DISPLAY_NAME}
              disabled={state.kind === 'saving'}
              data-testid="edit-profile-display-name"
              className="block w-full rounded border border-ui-border bg-ui-base px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none disabled:opacity-60"
              autoComplete="off"
              spellCheck={false}
            />
            <p className="mt-1 flex justify-between text-xs text-text-muted">
              <span>Shown on your profile and on every skin you publish.</span>
              <span data-testid="edit-profile-count">
                {trimmed.length}/{MAX_DISPLAY_NAME}
              </span>
            </p>
          </div>

          <div>
            <label
              htmlFor="edit-profile-username"
              className="mb-1 block text-sm text-text-secondary"
            >
              Username
            </label>
            <input
              id="edit-profile-username"
              type="text"
              value={username}
              disabled
              data-testid="edit-profile-username"
              className="block w-full rounded border border-ui-border bg-ui-base px-3 py-2 text-sm text-text-muted"
            />
            <p className="mt-1 text-xs text-text-muted">
              Username changes aren&apos;t available yet.
            </p>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={state.kind === 'saving'}
              data-testid="edit-profile-cancel"
              className="rounded border border-ui-border px-4 py-2 text-sm text-text-secondary transition-colors hover:border-accent/60 hover:text-text-primary disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!canSave}
              data-testid="edit-profile-save"
              className="rounded bg-accent px-4 py-2 text-sm font-semibold text-canvas transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              {state.kind === 'saving' ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
