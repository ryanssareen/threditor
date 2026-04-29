'use client';

/**
 * M17 Stage 1 UI: clarifying-questions dialog (step-by-step wizard).
 *
 * Spawned by EditorLayout when /api/ai/generate returns
 * `{ status: 'needs_clarification', questions }`. The dialog walks
 * the user through one question at a time. Each step renders up to
 * 4 button options, a free-text input (saved as a string answer),
 * a per-question skip, and back/next navigation. A small "skip all"
 * link at the bottom calls `onSkip` to bypass the entire flow.
 *
 * Mirrors the AIGenerateDialog discipline: hand-rolled ARIA dialog,
 * focus trap, Escape + backdrop close, idle/loading/error state.
 */

import { useEffect, useRef, useState } from 'react';
import type { ClarificationQuestion, UserAnswers } from '@/lib/ai/types';

const FOCUSABLE =
  'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"]), input:not([disabled]), textarea:not([disabled]), select:not([disabled])';

function getFocusable(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE));
}

const CUSTOM_SENTINEL = '__custom__';

type DialogState = 'idle' | 'loading' | 'error';

type Props = {
  isOpen: boolean;
  questions: ClarificationQuestion[];
  /** Submit collected answers. Any question the user skipped is omitted. */
  onSubmit: (answers: UserAnswers) => Promise<void>;
  /** Skip ALL questions — generate with the original prompt only. */
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
  const [currentStep, setCurrentStep] = useState(0);
  const [answers, setAnswers] = useState<UserAnswers>({});
  const [customInput, setCustomInput] = useState('');
  const [state, setState] = useState<DialogState>('idle');
  const [error, setError] = useState('');
  const dialogRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setCurrentStep(0);
    setAnswers({});
    setCustomInput('');
    setState('idle');
    setError('');
    returnFocusRef.current = (document.activeElement as HTMLElement | null) ?? null;
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const el = dialogRef.current;
    if (el === null) return;
    getFocusable(el)[0]?.focus();
  }, [isOpen, currentStep]);

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

  if (!isOpen || questions.length === 0) return null;

  const currentQuestion = questions[currentStep];
  const isLastQuestion = currentStep === questions.length - 1;
  const currentAnswer = answers[currentQuestion.id];
  const customSelected = currentAnswer === CUSTOM_SENTINEL;
  const trimmedCustom = customInput.trim();
  const canAdvance =
    (typeof currentAnswer === 'string' &&
      currentAnswer.length > 0 &&
      !customSelected) ||
    trimmedCustom.length > 0;

  const handleBackdropClick = () => {
    if (state === 'loading') return;
    onClose();
  };

  const handleOptionSelect = (option: string) => {
    if (state === 'loading') return;
    setAnswers((prev) => ({ ...prev, [currentQuestion.id]: option }));
    setCustomInput('');
  };

  const handleCustomFocus = () => {
    if (state === 'loading') return;
    setAnswers((prev) => ({ ...prev, [currentQuestion.id]: CUSTOM_SENTINEL }));
  };

  const finalizeAnswersForStep = (base: UserAnswers): UserAnswers => {
    if (trimmedCustom.length > 0) {
      return { ...base, [currentQuestion.id]: trimmedCustom };
    }
    if (base[currentQuestion.id] === CUSTOM_SENTINEL) {
      const out = { ...base };
      delete out[currentQuestion.id];
      return out;
    }
    return base;
  };

  const submit = async (finalAnswers: UserAnswers) => {
    setState('loading');
    setError('');
    try {
      await onSubmit(finalAnswers);
    } catch (err) {
      const msg =
        err instanceof Error && err.message.length > 0
          ? err.message
          : 'Generation failed — try again.';
      setError(msg);
      setState('idle');
    }
  };

  const handleNext = () => {
    if (state === 'loading' || !canAdvance) return;
    const next = finalizeAnswersForStep(answers);
    setAnswers(next);

    if (isLastQuestion) {
      submit(next);
      return;
    }
    setCurrentStep((s) => s + 1);
    setCustomInput('');
  };

  const handleSkipQuestion = () => {
    if (state === 'loading') return;
    const next = { ...answers };
    delete next[currentQuestion.id];
    setAnswers(next);
    setCustomInput('');

    if (isLastQuestion) {
      submit(next);
      return;
    }
    setCurrentStep((s) => s + 1);
  };

  const handleBack = () => {
    if (state === 'loading' || currentStep === 0) return;
    setCurrentStep((s) => s - 1);
    setCustomInput('');
    setError('');
  };

  const handleSkipAll = async () => {
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
          <div className="mb-3">
            <p
              data-testid="ai-clarify-step-label"
              className="font-mono text-[10px] uppercase tracking-[0.2em] text-text-muted"
            >
              Question {currentStep + 1} of {questions.length}
            </p>
            <p className="mt-2 text-base text-text-primary">
              {currentQuestion.question}
            </p>
          </div>

          <div
            data-testid="ai-clarify-progress"
            className="mb-5 flex gap-1.5"
            aria-hidden="true"
          >
            {questions.map((q, idx) => (
              <div
                key={q.id}
                className={`h-1.5 flex-1 rounded-full transition-colors ${
                  idx < currentStep
                    ? 'bg-accent'
                    : idx === currentStep
                    ? 'bg-accent/70'
                    : 'bg-ui-border'
                }`}
              />
            ))}
          </div>

          {error !== '' && (
            <div
              role="alert"
              data-testid="ai-clarify-error"
              className="mb-4 whitespace-pre-wrap break-words rounded border border-red-500/20 bg-red-500/10 p-3 font-mono text-xs text-red-400"
            >
              {error}
            </div>
          )}

          <div
            role="radiogroup"
            aria-label={currentQuestion.question}
            className="mb-3 space-y-2"
          >
            {currentQuestion.options.slice(0, 4).map((option) => {
              const selected = currentAnswer === option;
              return (
                <button
                  key={option}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  data-testid={`ai-clarify-opt-${currentQuestion.id}-${option}`}
                  disabled={state === 'loading'}
                  onClick={() => handleOptionSelect(option)}
                  className={`w-full rounded-sm border px-4 py-2.5 text-left font-mono text-xs transition-colors disabled:opacity-50 ${
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

          <div className="mb-5">
            <label
              htmlFor="ai-clarify-custom"
              className={`mb-1 block font-mono text-[10px] uppercase tracking-[0.2em] transition-colors ${
                customSelected || trimmedCustom.length > 0
                  ? 'text-accent'
                  : 'text-text-muted'
              }`}
            >
              Or type your own
            </label>
            <input
              id="ai-clarify-custom"
              type="text"
              value={customInput}
              onChange={(e) => setCustomInput(e.target.value)}
              onFocus={handleCustomFocus}
              disabled={state === 'loading'}
              placeholder="Enter your answer…"
              data-testid="ai-clarify-custom-input"
              className={`w-full rounded-sm border bg-ui-base px-3 py-2 font-mono text-xs text-text-primary placeholder:text-text-muted transition-colors focus:outline-none disabled:opacity-50 ${
                customSelected || trimmedCustom.length > 0
                  ? 'border-accent'
                  : 'border-ui-border focus:border-accent'
              }`}
            />
          </div>

          <div className="flex items-center gap-2">
            {currentStep > 0 && (
              <button
                type="button"
                onClick={handleBack}
                disabled={state === 'loading'}
                data-testid="ai-clarify-back"
                className="rounded-sm border border-ui-border bg-transparent px-3 py-2 font-mono text-xs text-text-secondary transition-colors hover:border-accent hover:text-accent disabled:opacity-50"
              >
                ← Back
              </button>
            )}
            <button
              type="button"
              onClick={handleSkipQuestion}
              disabled={state === 'loading'}
              data-testid="ai-clarify-skip-question"
              className="rounded-sm border border-ui-border bg-transparent px-3 py-2 font-mono text-xs text-text-secondary transition-colors hover:border-accent hover:text-accent disabled:opacity-50"
            >
              Skip this
            </button>
            <button
              type="button"
              onClick={handleNext}
              disabled={state === 'loading' || !canAdvance}
              data-testid="ai-clarify-next"
              className="ml-auto flex-1 rounded-sm bg-accent px-4 py-2 font-mono text-sm font-semibold text-canvas transition-colors hover:bg-accent-hover disabled:opacity-50"
            >
              {state === 'loading'
                ? 'Generating…'
                : isLastQuestion
                ? 'Generate →'
                : 'Next →'}
            </button>
          </div>

          <button
            type="button"
            onClick={handleSkipAll}
            disabled={state === 'loading'}
            data-testid="ai-clarify-skip"
            className="mt-4 w-full text-center font-mono text-[10px] uppercase tracking-[0.2em] text-text-muted underline-offset-2 transition-colors hover:text-accent hover:underline disabled:opacity-50"
          >
            Skip all questions and generate anyway
          </button>
        </div>
      </div>
    </>
  );
}

export default AIClarificationDialog;
