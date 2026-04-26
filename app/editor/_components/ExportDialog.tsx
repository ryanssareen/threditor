'use client';

/**
 * M8 Unit 2+3: export dialog.
 *
 * - Pattern copied from TemplateBottomSheet (focus trap, Esc, backdrop
 *   click, role="dialog" + aria-modal="true"). Zero new dependencies.
 * - Variant selector with mismatch warning when user overrides.
 * - M8 Unit 3: 0 ms-edit guardrail body when
 *   `hasEditedSinceTemplate === false && lastAppliedTemplateId !== null`.
 * - Export happens inside the click handler's synchronous stack
 *   (Safari user-gesture); the anchor-click fallback inside downloadBlob
 *   preserves the gesture.
 */

import { useEffect, useRef, useState } from 'react';

import {
  buildExportFilename,
  downloadBlob,
  exportLayersToBlob,
  type SupportedResolution,
} from '@/lib/editor/export';
import { useEditorStore } from '@/lib/editor/store';
import type { Layer, SkinVariant } from '@/lib/editor/types';

const RESOLUTION_OPTIONS: ReadonlyArray<{
  value: SupportedResolution;
  label: string;
  sublabel: string;
}> = [
  { value: 64, label: '64×64', sublabel: 'Minecraft standard' },
  { value: 128, label: '128×128', sublabel: 'HD · modded only' },
  { value: 256, label: '256×256', sublabel: 'HD · modded only' },
  { value: 512, label: '512×512', sublabel: 'HD · modded only' },
];

type Props = {
  open: boolean;
  onClose: () => void;
  /** Snapshot of the live layers at open-time. */
  getLayers: () => Layer[];
};

const FOCUSABLE =
  'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"]), input:not([disabled]), textarea:not([disabled]), select:not([disabled])';

function getFocusable(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE));
}

export function ExportDialog({ open, onClose, getLayers }: Props) {
  const currentVariant = useEditorStore((s) => s.variant);
  const hasEditedSinceTemplate = useEditorStore((s) => s.hasEditedSinceTemplate);
  const lastAppliedTemplateId = useEditorStore((s) => s.lastAppliedTemplateId);

  // Local state — dialog owns the selected variant so the user can
  // override without mutating store (a wrong-variant export should not
  // flip the editor's variant). Re-sync on (re)open.
  const [selectedVariant, setSelectedVariant] = useState<SkinVariant>(currentVariant);
  // M15: resolution picker. Default to 64 (Minecraft standard) so the
  // existing user experience is unchanged; HD is an explicit opt-in.
  // Local state (not zustand) because the choice is per-export, not
  // part of the skin's canonical state.
  const [selectedResolution, setSelectedResolution] =
    useState<SupportedResolution>(64);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dialogRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  const guardrailActive =
    hasEditedSinceTemplate === false && lastAppliedTemplateId !== null;

  // On (re)open: sync selectedVariant, reset resolution to the
  // default (64 — vanilla), clear error, remember focus.
  useEffect(() => {
    if (!open) return;
    setSelectedVariant(currentVariant);
    setSelectedResolution(64);
    setError(null);
    returnFocusRef.current = (document.activeElement as HTMLElement | null) ?? null;
  }, [open, currentVariant]);

  // Focus first focusable element on open.
  useEffect(() => {
    if (!open) return;
    const el = dialogRef.current;
    if (el === null) return;
    const focusable = getFocusable(el);
    focusable[0]?.focus();
  }, [open]);

  // Focus trap + Escape → close.
  useEffect(() => {
    if (!open) return;
    const el = dialogRef.current;
    if (el === null) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
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
  }, [open, onClose]);

  // Restore focus on close.
  useEffect(() => {
    if (open) return;
    returnFocusRef.current?.focus?.();
  }, [open]);

  if (!open) return null;

  const filename = buildExportFilename(
    selectedVariant,
    new Date(),
    selectedResolution,
  );
  const variantMismatch = selectedVariant !== currentVariant;
  const isHdResolution = selectedResolution !== 64;

  const handleExport = async () => {
    setBusy(true);
    setError(null);
    try {
      const blob = await exportLayersToBlob(getLayers(), {
        resolution: selectedResolution,
      });
      await downloadBlob(blob, filename);
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown export error';
      setError(msg);
    } finally {
      setBusy(false);
    }
  };

  // ── Guardrail body (Unit 3) ────────────────────────────────────────
  if (guardrailActive) {
    return (
      <>
        <div
          data-testid="export-dialog-backdrop"
          style={{ position: 'fixed', inset: 0, zIndex: 49, background: 'rgba(0,0,0,0.4)' }}
          onClick={onClose}
          aria-hidden="true"
        />
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="export-dialog-title"
          data-testid="export-dialog-guardrail"
          className="fixed left-1/2 top-1/2 z-50 w-[min(420px,90vw)] -translate-x-1/2 -translate-y-1/2 rounded-md border border-ui-border bg-ui-surface shadow-panel"
        >
          <div className="border-b border-ui-border px-5 py-3">
            <h2
              id="export-dialog-title"
              className="font-mono text-sm font-medium text-text-primary"
            >
              Export without edits?
            </h2>
          </div>
          <div className="px-5 py-4">
            <p className="text-sm text-text-secondary">
              You applied a template but haven&apos;t made any edits yet.
              Exporting now will save the template as-is.
            </p>
          </div>
          <div className="flex justify-end gap-2 border-t border-ui-border px-5 py-3">
            <button
              type="button"
              data-testid="export-guardrail-edit-first"
              onClick={onClose}
              className="rounded-sm border border-accent bg-accent px-3 py-1.5 font-mono text-sm text-canvas hover:bg-accent-hover"
            >
              Edit first
            </button>
            <button
              type="button"
              data-testid="export-guardrail-anyway"
              onClick={handleExport}
              disabled={busy}
              className="rounded-sm border border-ui-border bg-ui-base px-3 py-1.5 font-mono text-sm text-text-secondary hover:text-text-primary disabled:opacity-50"
            >
              Export anyway
            </button>
          </div>
        </div>
      </>
    );
  }

  // ── Normal export body ────────────────────────────────────────────
  return (
    <>
      <div
        data-testid="export-dialog-backdrop"
        style={{ position: 'fixed', inset: 0, zIndex: 49, background: 'rgba(0,0,0,0.4)' }}
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="export-dialog-title"
        data-testid="export-dialog"
        className="fixed left-1/2 top-1/2 z-50 w-[min(420px,90vw)] -translate-x-1/2 -translate-y-1/2 rounded-md border border-ui-border bg-ui-surface shadow-panel"
      >
        <div className="border-b border-ui-border px-5 py-3">
          <h2
            id="export-dialog-title"
            className="font-mono text-sm font-medium text-text-primary"
          >
            Export skin
          </h2>
        </div>

        <div className="flex flex-col gap-4 px-5 py-4">
          <fieldset>
            <legend className="mb-2 block font-mono text-xs uppercase tracking-wide text-text-secondary">
              Variant
            </legend>
            <div role="radiogroup" aria-label="Skin variant" className="flex gap-1">
              {(['classic', 'slim'] as const).map((v) => (
                <label
                  key={v}
                  data-testid={`export-variant-${v}`}
                  className={`flex-1 cursor-pointer rounded-sm border px-2 py-1 text-center font-mono text-sm ${
                    selectedVariant === v
                      ? 'border-accent bg-ui-base text-text-primary'
                      : 'border-ui-border bg-ui-base text-text-secondary hover:border-accent/60'
                  }`}
                >
                  <input
                    type="radio"
                    name="export-variant"
                    value={v}
                    checked={selectedVariant === v}
                    onChange={() => setSelectedVariant(v)}
                    className="sr-only"
                  />
                  {v === 'classic' ? 'Classic' : 'Slim'}
                </label>
              ))}
            </div>
            {variantMismatch && (
              <p
                role="status"
                data-testid="export-variant-mismatch"
                className="mt-2 text-xs text-text-secondary"
              >
                This will export with <strong>{selectedVariant}</strong> proportions.
                The current skin uses <strong>{currentVariant}</strong>.
              </p>
            )}
          </fieldset>

          <fieldset>
            <legend className="mb-2 block font-mono text-xs uppercase tracking-wide text-text-secondary">
              Resolution
            </legend>
            <div
              role="radiogroup"
              aria-label="Export resolution"
              className="grid grid-cols-2 gap-1"
            >
              {RESOLUTION_OPTIONS.map((opt) => (
                <label
                  key={opt.value}
                  data-testid={`export-resolution-${opt.value}`}
                  className={`cursor-pointer rounded-sm border px-2 py-1.5 text-center font-mono text-xs leading-tight ${
                    selectedResolution === opt.value
                      ? 'border-accent bg-ui-base text-text-primary'
                      : 'border-ui-border bg-ui-base text-text-secondary hover:border-accent/60'
                  }`}
                >
                  <input
                    type="radio"
                    name="export-resolution"
                    value={opt.value}
                    checked={selectedResolution === opt.value}
                    onChange={() => setSelectedResolution(opt.value)}
                    className="sr-only"
                  />
                  <span className="block">{opt.label}</span>
                  <span className="block text-[10px] text-text-muted">
                    {opt.sublabel}
                  </span>
                </label>
              ))}
            </div>
            {isHdResolution && (
              <p
                role="status"
                data-testid="export-hd-note"
                className="mt-2 text-xs text-text-secondary"
              >
                Vanilla Minecraft requires 64×64. HD resolutions are pixel-
                upscaled for modded servers and resource packs — they don&apos;t
                add detail.
              </p>
            )}
          </fieldset>

          <div>
            <span className="block font-mono text-xs uppercase tracking-wide text-text-secondary">
              Filename
            </span>
            <code
              data-testid="export-filename-preview"
              className="mt-1 block truncate rounded-sm border border-ui-border bg-ui-base px-2 py-1 font-mono text-xs text-text-primary"
            >
              {filename}
            </code>
          </div>

          {error !== null && (
            <p
              role="alert"
              data-testid="export-error"
              className="rounded-sm border border-red-500 bg-red-500/10 px-2 py-1 text-xs text-red-300"
            >
              {error}
            </p>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-ui-border px-5 py-3">
          <button
            type="button"
            data-testid="export-cancel"
            onClick={onClose}
            className="rounded-sm border border-ui-border bg-ui-base px-3 py-1.5 font-mono text-sm text-text-secondary hover:text-text-primary"
          >
            Cancel
          </button>
          <button
            type="button"
            data-testid="export-submit"
            onClick={handleExport}
            disabled={busy}
            className="rounded-sm border border-accent bg-accent px-3 py-1.5 font-mono text-sm text-canvas hover:bg-accent-hover disabled:opacity-50"
          >
            {busy ? 'Exporting…' : 'Export'}
          </button>
        </div>
      </div>
    </>
  );
}
