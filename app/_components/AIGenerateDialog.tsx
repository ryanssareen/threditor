'use client';

/**
 * M16 Unit 5: AI generation prompt dialog.
 * M17 ADDITION: Dual-mode UI (Fast vs High Quality).
 *
 * Mirrors PublishDialog (M11 Unit 1) — hand-rolled ARIA dialog,
 * focus trap, Escape + backdrop close, idle/loading/success/error
 * state machine. The `onGenerate` handler is injected by the caller
 * (EditorLayout in Unit 6); this component is transport-agnostic.
 *
 * Submit is disabled when:
 *   - prompt is empty (after trim)
 *   - prompt length > 200 (the textarea has maxLength=200 too;
 *     defense-in-depth)
 *   - state === 'loading'
 *
 * Success state auto-closes after 1.5s. Error state stays until the
 * user clicks Retry or closes — the prompt text is preserved across
 * retries.
 */

import { useEffect, useRef, useState } from 'react';

const PROMPT_MAX = 200;

const FOCUSABLE =
  'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"]), input:not([disabled]), textarea:not([disabled]), select:not([disabled])';

function getFocusable(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE));
}

type DialogState = 'idle' | 'loading' | 'success' | 'error';
type AiMode = 'groq' | 'cloudflare';

type Props = {
  isOpen: boolean;
  onClose: () => void;
  /**
   * Resolves on successful generation; rejects with an Error whose
   * `message` the dialog displays. The handler is responsible for
   * calling addLayer / pushing undo — this component renders state
   * and forwards the prompt only.
   * 
   * M17: Now accepts mode parameter (groq = fast, cloudflare = high quality).
   */
  onGenerate: (prompt: string, mode: AiMode) => Promise<void>;
};

export function AIGenerateDialog({ isOpen, onClose, onGenerate }: Props) {
  const [state, setState] = useState<DialogState>('idle');
  const [prompt, setPrompt] = useState('');
  const [error, setError] = useState('');
  const [mode, setMode] = useState<AiMode>('groq'); // M17: default to fast mode

  const dialogRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  // Reset on open.
  useEffect(() => {
    if (!isOpen) return;
    setState('idle');
    setError('');
    returnFocusRef.current = (document.activeElement as HTMLElement | null) ?? null;
  }, [isOpen]);

  // Focus first focusable on open.
  useEffect(() => {
    if (!isOpen) return;
    const el = dialogRef.current;
    if (el === null) return;
    getFocusable(el)[0]?.focus();
  }, [isOpen]);

  // Focus trap + Escape (no-op while loading).
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
    }, 1500);
    return () => clearTimeout(t);
  }, [state, onClose]);

  // Restore focus on close.
  useEffect(() => {
    if (isOpen) return;
    returnFocusRef.current?.focus?.();
  }, [isOpen]);

  if (!isOpen) return null;

  const trimmed = prompt.trim();
  const submitDisabled =
    trimmed.length === 0 || prompt.length > PROMPT_MAX || state === 'loading';

  const handleBackdropClick = () => {
    if (state === 'loading') return;
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitDisabled) return;
    setState('loading');
    setError('');
    try {
      await onGenerate(trimmed, mode); // M17: pass mode
      setState('success');
    } catch (err) {
      const msg =
        err instanceof Error && err.message.length > 0
          ? err.message
          : 'Try a different prompt';
      setError(msg);
      setState('error');
    }
  };

  const handleRetry = () => {
    setState('idle');
    setError('');
  };

  return (
    <>
      <div
        data-testid="ai-dialog-backdrop"
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 49,
          background: 'rgba(0,0,0,0.5)',
        }}
        onClick={handleBackdropClick}
        aria-hidden="true"
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="ai-dialog-title"
        data-testid="ai-dialog"
        className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg border border-ui-border bg-ui-surface"
      >
        <div className="flex items-center justify-between border-b border-ui-border px-5 py-3">
          <h2
            id="ai-dialog-title"
            className="font-mono text-sm font-medium text-text-primary"
          >
            ✨ Generate with AI
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={state === 'loading'}
            data-testid="ai-dialog-close"
            aria-label="Close dialog"
            className="text-text-secondary transition-colors hover:text-text-primary disabled:opacity-50"
          >
            ✕
          </button>
        </div>

        {state === 'success' ? (
          <div
            className="px-5 py-6 text-center"
            data-testid="ai-dialog-success"
          >
            <div className="mb-2 text-2xl">🎨</div>
            <p className="font-mono text-sm text-text-primary">
              Generated! Added new layer.
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="px-5 py-4">
            {error !== '' && (
              <div
                role="alert"
                data-testid="ai-dialog-error"
                className="mb-4 whitespace-pre-wrap break-words rounded border border-red-500/20 bg-red-500/10 p-3 font-mono text-xs text-red-400"
              >
                {error}
              </div>
            )}

            {/* M17: Mode selector - Fast vs High Quality */}
            <div className="mb-4">
              <label className="mb-2 block text-sm text-text-secondary">
                Quality
              </label>
              <div role="group" aria-label="AI generation mode" className="flex gap-1">
                <button
                  type="button"
                  aria-pressed={mode === 'groq'}
                  data-testid="ai-mode-fast"
                  onClick={() => setMode('groq')}
                  disabled={state === 'loading'}
                  className={`flex-1 rounded-sm px-3 py-2 font-mono text-sm transition-all disabled:opacity-50 ${
                    mode === 'groq' 
                      ? 'border-2 border-accent bg-accent/15 text-accent shadow-[0_0_16px_rgba(0,229,255,0.4)] ring-2 ring-accent/30' 
                      : 'border border-ui-border bg-ui-base text-text-primary hover:border-accent/60'
                  }`}
                >
                  ⚡ Fast
                  <div className={`mt-0.5 text-xs ${mode === 'groq' ? 'text-accent/70' : 'text-text-muted'}`}>3-5 sec</div>
                </button>
                <button
                  type="button"
                  aria-pressed={mode === 'cloudflare'}
                  data-testid="ai-mode-quality"
                  onClick={() => setMode('cloudflare')}
                  disabled={state === 'loading'}
                  className={`flex-1 rounded-sm px-3 py-2 font-mono text-sm transition-all disabled:opacity-50 ${
                    mode === 'cloudflare' 
                      ? 'border-2 border-accent bg-accent/15 text-accent shadow-[0_0_16px_rgba(0,229,255,0.4)] ring-2 ring-accent/30' 
                      : 'border border-ui-border bg-ui-base text-text-primary hover:border-accent/60'
                  }`}
                >
                  ✨ High Quality
                  <div className={`mt-0.5 text-xs ${mode === 'cloudflare' ? 'text-accent/70' : 'text-text-muted'}`}>15-20 sec</div>
                </button>
              </div>
            </div>

            <div className="mb-4">
              <label
                htmlFor="ai-dialog-prompt"
                className="mb-1 block text-sm text-text-secondary"
              >
                Describe a Minecraft skin
              </label>
              <textarea
                id="ai-dialog-prompt"
                data-testid="ai-dialog-prompt"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                disabled={state === 'loading'}
                maxLength={PROMPT_MAX}
                rows={3}
                placeholder="a knight in red armor, holding a torch"
                className="w-full resize-none rounded border border-ui-border bg-ui-base px-3 py-2 text-text-primary focus:border-accent focus:outline-none disabled:opacity-50"
              />
              <div
                data-testid="ai-dialog-counter"
                className="mt-1 text-right font-mono text-xs text-text-muted"
              >
                {prompt.length}/{PROMPT_MAX}
              </div>
            </div>

            <div className="flex justify-end gap-2">
              {state === 'error' && (
                <button
                  type="button"
                  onClick={handleRetry}
                  data-testid="ai-dialog-retry"
                  className="rounded border border-ui-border bg-ui-base px-3 py-1.5 font-mono text-sm text-text-secondary hover:text-text-primary"
                >
                  Retry
                </button>
              )}
              <button
                type="button"
                onClick={onClose}
                disabled={state === 'loading'}
                data-testid="ai-dialog-cancel"
                className="rounded border border-ui-border bg-ui-base px-3 py-1.5 font-mono text-sm text-text-secondary hover:text-text-primary disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitDisabled}
                data-testid="ai-dialog-submit"
                className="rounded bg-accent px-3 py-1.5 font-mono text-sm font-semibold text-canvas hover:bg-accent-hover disabled:opacity-50"
              >
                {state === 'loading' ? 'Generating…' : 'Generate'}
              </button>
            </div>
          </form>
        )}
      </div>
    </>
  );
}