'use client';

/**
 * M17 Stage 1 UI: clarifying-questions dialog.
 *
 * Spawned by EditorLayout when /api/ai/generate returns
 * `{ status: 'needs_clarification', questions }`. The dialog
 * collects answers via single-select / multi-select pill rows and
 * calls `onSubmit(answers)` with a `UserAnswers` map. The handler
 * fires the second /api/ai/generate request with `userAnswers` +
 * `skipClarification: true` to skip Stage-1 the second time around.
 *
 * Mirrors the AIGenerateDialog discipline: hand-rolled ARIA dialog,
 * focus trap, Escape + backdrop close, idle/loading state.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import type { ClarificationQuestion, UserAnswers } from '@/lib/ai/types';

const FOCUSABLE =
  'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"]), input:not([disabled]), textarea:not([disabled]), select:not([disabled])';

function getFocusable(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE));
}

type DialogState = 'idle' | 'loading' | 'error';

type Props = {
  isOpen: boolean;
  questions: ClarificationQuestion[];
  /**
   * User submitted answers for every required (single_select)
   * question. Multi-select questions may be empty arrays.
   * Resolves on success; rejects with an Error whose `message` the
   * dialog displays.
   */
  onSubmit: (answers: UserAnswers) => Promise<void>;
  /** User skipped questions — generate with the original prompt only. */
  onSkip: () => Promise<void>;
  onClose: () => void;
};

export function AIClarificationDialog({
  isOpen,
  questions,
  onSubmit,
  onSkip,
  onClose,
}: Props) {
  const [answers, setAnswers] = useState<UserAnswers>({});
  const [state, setState] = useState<DialogState>('idle');
  const [error, setError] = useState('');
  const dialogRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setAnswers({});
    setState('idle');
    setError('');
    returnFocusRef.current = (document.activeElement as HTMLElement | null) ?? null;
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const el = dialogRef.current;
    if (el === null) return;
    getFocusable(el)[0]?.focus();
  }, [isOpen]);

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

  useEffect(() => {
    if (isOpen) return;
    returnFocusRef.current?.focus?.();
  }, [isOpen]);

  // Single-select answers are required to enable Generate. Multi-select
  // is optional — leaving none picked is allowed, the answer is just
  // omitted from the payload.
  const allRequiredAnswered = useMemo(() => {
    for (const q of questions) {
      if (q.type !== 'single_select') continue;
      const v = answers[q.id];
      if (typeof v !== 'string' || v.length === 0) return false;
    }
    return true;
  }, [questions, answers]);

  if (!isOpen) return null;

  const handleBackdropClick = () => {
    if (state === 'loading') return;
    onClose();
  };

  const handleSelect = (q: ClarificationQuestion, option: string) => {
    if (state === 'loading') return;
    setAnswers((prev) => {
      if (q.type === 'single_select') {
        return { ...prev, [q.id]: option };
      }
      const current = Array.isArray(prev[q.id]) ? (prev[q.id] as string[]) : [];
      const next = current.includes(option)
        ? current.filter((o) => o !== option)
        : [...current, option];
      const out = { ...prev };
      if (next.length === 0) {
        delete out[q.id];
      } else {
        out[q.id] = next;
      }
      return out;
    });
  };

  const handleSubmit = async () => {
    if (state === 'loading' || !allRequiredAnswered) return;
    setState('loading');
    setError('');
    try {
      await onSubmit(answers);
      // Parent closes the dialog on success.
    } catch (err) {
      const msg =
        err instanceof Error && err.message.length > 0
          ? err.message
          : 'Generation failed — try again.';
      setError(msg);
      setState('idle');
    }
  };

  const handleSkip = async () => {
    if (state === 'loading') return;
    setState('loading');
    setError('');
    try {
      await onSkip();
    } catch (err) {
      const msg =
        err instanceof Error && err.message.length > 0
          ? err.message
          : 'Generation failed — try again.';
      setError(msg);
      setState('idle');
    }
  };

  return (
    <>
      <div
        data-testid="ai-clarify-backdrop"
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
        aria-labelledby="ai-clarify-title"
        data-testid="ai-clarify-dialog"
        className="fixed left-1/2 top-1/2 z-50 max-h-[85vh] w-full max-w-md -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-lg border border-ui-border bg-ui-surface"
      >
        <div className="flex items-center justify-between border-b border-ui-border px-5 py-3">
          <h2
            id="ai-clarify-title"
            className="font-mono text-sm font-medium text-text-primary"
          >
            ✨ Help us get it right
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={state === 'loading'}
            data-testid="ai-clarify-close"
            aria-label="Close dialog"
            className="text-text-secondary transition-colors hover:text-text-primary disabled:opacity-50"
          >
            ✕
          </button>
        </div>

        <div className="px-5 py-4">
          <p className="mb-4 text-sm text-text-secondary">
            A few quick questions to make your skin sharper.
          </p>

          {error !== '' && (
            <div
              role="alert"
              data-testid="ai-clarify-error"
              className="mb-4 whitespace-pre-wrap break-words rounded border border-red-500/20 bg-red-500/10 p-3 font-mono text-xs text-red-400"
            >
              {error}
            </div>
          )}

          <div className="space-y-5">
            {questions.map((q) => (
              <fieldset key={q.id} className="space-y-2">
                <legend className="font-mono text-xs uppercase tracking-wider text-text-muted">
                  {q.question}
                  {q.type === 'multi_select' && (
                    <span className="ml-2 text-text-muted/70 normal-case tracking-normal">
                      (multi-select, optional)
                    </span>
                  )}
                </legend>
                <div
                  role={q.type === 'single_select' ? 'radiogroup' : 'group'}
                  className="flex flex-wrap gap-2"
                >
                  {q.options.map((option) => {
                    const selected =
                      q.type === 'single_select'
                        ? answers[q.id] === option
                        : Array.isArray(answers[q.id]) &&
                          (answers[q.id] as string[]).includes(option);
                    return (
                      <button
                        key={option}
                        type="button"
                        role={q.type === 'single_select' ? 'radio' : 'checkbox'}
                        aria-checked={selected}
                        data-testid={`ai-clarify-opt-${q.id}-${option}`}
                        disabled={state === 'loading'}
                        onClick={() => handleSelect(q, option)}
                        className={`rounded-sm border px-3 py-2 font-mono text-xs transition-colors disabled:opacity-50 ${
                          selected
                            ? 'border-accent bg-accent/15 text-accent'
                            : 'border-ui-border bg-ui-base text-text-secondary hover:border-accent/60 hover:text-text-primary'
                        }`}
                      >
                        {option}
                      </button>
                    );
                  })}
                </div>
              </fieldset>
            ))}
          </div>

          <div className="mt-6 flex gap-2">
            <button
              type="button"
              onClick={handleSubmit}
              disabled={state === 'loading' || !allRequiredAnswered}
              data-testid="ai-clarify-submit"
              className="flex-1 rounded-sm bg-accent px-4 py-2 font-mono text-sm font-semibold text-canvas transition-colors hover:bg-accent-hover disabled:opacity-50"
            >
              {state === 'loading' ? 'Generating…' : 'Generate'}
            </button>
            <button
              type="button"
              onClick={handleSkip}
              disabled={state === 'loading'}
              data-testid="ai-clarify-skip"
              className="rounded-sm border border-ui-border bg-transparent px-4 py-2 font-mono text-sm text-text-secondary transition-colors hover:border-accent hover:text-accent disabled:opacity-50"
            >
              Skip questions
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

export default AIClarificationDialog;
