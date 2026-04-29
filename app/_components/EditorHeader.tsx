'use client';

/**
 * Editor route header — design-system skin per threditor-design-system.
 *
 * Three auth states preserved from M10 Unit 5:
 *   - auth pending (loading=true): skeleton pulse avatar
 *   - signed out: "Sign In" button that opens AuthDialog
 *   - signed in: UserMenu with avatar + email + sign out
 *
 * Editor-specific controls (variant toggle, undo/redo, templates,
 * new skin, saved pill) are optional — the header still renders
 * with just `onPublishClick` so the existing M10 tests pass.
 */

import Link from 'next/link';
import { useState } from 'react';

import { useAuth } from '@/app/_providers/AuthProvider';
import type { SavingState } from '@/lib/editor/store';
import type { SkinVariant } from '@/lib/editor/types';

import { AuthDialog } from './AuthDialog';
import { UserMenu } from './UserMenu';

type Props = {
  onPublishClick?: () => void;
  /** Active skin variant. Required for the segmented control. */
  variant?: SkinVariant;
  onVariantChange?: (next: SkinVariant) => void;
  canUndo?: boolean;
  canRedo?: boolean;
  onUndo?: () => void;
  onRedo?: () => void;
  onOpenTemplates?: () => void;
  onNewSkin?: () => void;
  savingState?: SavingState;
};

export function EditorHeader({
  onPublishClick,
  variant,
  onVariantChange,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onOpenTemplates,
  onNewSkin,
  savingState,
}: Props = {}) {
  const { user, loading } = useAuth();
  const [showAuthDialog, setShowAuthDialog] = useState(false);
  const [authHint, setAuthHint] = useState<string | undefined>(undefined);

  const handlePublishFromHeader = () => {
    if (user === null) {
      setAuthHint('Sign in to publish');
      setShowAuthDialog(true);
      return;
    }
    onPublishClick?.();
  };

  const showEditorChrome =
    variant !== undefined ||
    onUndo !== undefined ||
    onRedo !== undefined ||
    onOpenTemplates !== undefined ||
    onNewSkin !== undefined;

  return (
    <>
      <header
        data-testid="editor-header"
        className="fixed left-0 right-0 top-0 z-40 flex h-14 items-center justify-between gap-3 border-b border-ui-border bg-ui-base px-4"
      >
        {/* ── Left: wordmark + new/templates/variant ───────────────────── */}
        <div className="flex items-center gap-3">
          <Link
            href="/"
            className="text-[17px] font-semibold leading-none text-text-primary transition-colors hover:text-accent"
            data-testid="editor-header-home"
          >
            threditor
          </Link>

          {showEditorChrome && (
            <>
              <span className="hidden h-[22px] w-px bg-ui-border md:inline-block" />

              {onNewSkin !== undefined && (
                <button
                  type="button"
                  data-testid="editor-header-new-skin"
                  onClick={onNewSkin}
                  title="Start a fresh skin"
                  className="hidden items-center gap-2 rounded-sm border border-ui-border bg-ui-surface px-3 py-1.5 font-mono text-xs text-text-primary transition-colors hover:border-accent hover:text-accent md:inline-flex"
                >
                  <span
                    aria-hidden="true"
                    className="grid h-[18px] w-[18px] place-items-center rounded-sm border border-ui-border bg-ui-base font-sans text-[14px] font-medium leading-none text-accent"
                  >
                    +
                  </span>
                  <span>New skin</span>
                </button>
              )}

              {onOpenTemplates !== undefined && (
                <button
                  type="button"
                  data-testid="editor-header-templates"
                  onClick={onOpenTemplates}
                  className="hidden items-center gap-2 rounded-sm border border-ui-border bg-transparent px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.15em] text-text-secondary transition-colors hover:border-accent hover:text-accent md:inline-flex"
                >
                  <span>Templates</span>
                  <span className="text-[9px] text-text-muted transition-colors group-hover:text-accent">
                    ▾
                  </span>
                </button>
              )}

              {variant !== undefined && onVariantChange !== undefined && (
                <span className="hidden h-[22px] w-px bg-ui-border md:inline-block" />
              )}

              {variant !== undefined && onVariantChange !== undefined && (
                <div
                  role="group"
                  aria-label="Skin variant"
                  className="hidden gap-0 rounded-sm border border-ui-border bg-ui-base p-[2px] md:inline-flex"
                >
                  {(
                    [
                      { id: 'classic', label: 'Classic' },
                      { id: 'slim', label: 'Slim' },
                    ] as { id: SkinVariant; label: string }[]
                  ).map(({ id, label }) => {
                    const pressed = variant === id;
                    return (
                      <button
                        key={id}
                        type="button"
                        data-testid={`variant-${id}`}
                        aria-pressed={pressed}
                        onClick={() => onVariantChange(id)}
                        className={[
                          'rounded-[1px] px-2.5 py-1 font-mono text-[11px] transition-colors',
                          pressed
                            ? 'bg-ui-surface text-accent'
                            : 'text-text-secondary hover:text-text-primary',
                        ].join(' ')}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>

        {/* ── Right: undo/redo + saved + publish + auth ────────────────── */}
        <div className="flex items-center gap-2">
          {showEditorChrome && onUndo !== undefined && onRedo !== undefined && (
            <div className="hidden overflow-hidden rounded-sm border border-ui-border bg-ui-surface md:inline-flex">
              <button
                type="button"
                data-testid="undo-button"
                onClick={onUndo}
                disabled={canUndo === false}
                title="Undo (⌘Z)"
                className="flex items-center gap-1.5 px-2.5 py-1.5 font-mono text-[11px] text-text-secondary transition-colors hover:text-accent disabled:cursor-not-allowed disabled:text-ui-border disabled:hover:text-ui-border"
              >
                <span>Undo</span>
                <span className="text-[10px] text-text-muted">⌘Z</span>
              </button>
              <button
                type="button"
                data-testid="redo-button"
                onClick={onRedo}
                disabled={canRedo === false}
                title="Redo (⇧⌘Z)"
                className="flex items-center gap-1.5 border-l border-ui-border px-2.5 py-1.5 font-mono text-[11px] text-text-secondary transition-colors hover:text-accent disabled:cursor-not-allowed disabled:text-ui-border disabled:hover:text-ui-border"
              >
                <span>Redo</span>
                <span className="text-[10px] text-text-muted">⇧⌘Z</span>
              </button>
            </div>
          )}

          {showEditorChrome && savingState !== undefined && (
            <SavedPill state={savingState} />
          )}

          {showEditorChrome && (
            <span className="hidden h-[22px] w-px bg-ui-border md:inline-block" />
          )}

          {!loading && onPublishClick !== undefined && (
            <button
              type="button"
              data-testid="editor-header-publish"
              onClick={handlePublishFromHeader}
              className="rounded-sm border border-accent bg-transparent px-3.5 py-1.5 text-sm font-medium text-accent transition-colors hover:bg-accent hover:text-canvas"
            >
              Publish
            </button>
          )}

          {loading ? (
            <div
              data-testid="editor-header-loading"
              aria-hidden="true"
              className="h-8 w-8 animate-pulse rounded-full bg-ui-surface"
            />
          ) : user !== null ? (
            <UserMenu />
          ) : (
            <button
              type="button"
              data-testid="editor-header-sign-in"
              onClick={() => {
                setAuthHint(undefined);
                setShowAuthDialog(true);
              }}
              className="rounded-sm bg-accent px-3.5 py-1.5 text-sm font-semibold text-canvas transition-colors hover:bg-accent-hover"
            >
              Sign In
            </button>
          )}
        </div>
      </header>

      <AuthDialog
        isOpen={showAuthDialog}
        onClose={() => {
          setShowAuthDialog(false);
          setAuthHint(undefined);
        }}
        initialHint={authHint}
      />
    </>
  );
}

const SAVED_LABEL: Record<SavingState, string> = {
  pending: 'Saving…',
  enabled: 'Saved',
  'disabled:private': 'Private mode',
  'disabled:quota': 'Storage full',
  'disabled:error': 'Save error',
};

const SAVED_DOT: Record<SavingState, string> = {
  pending: 'bg-text-muted',
  enabled: 'bg-green-500 shadow-[0_0_6px_rgba(34,197,94,0.4)]',
  'disabled:private': 'bg-red-500',
  'disabled:quota': 'bg-red-500',
  'disabled:error': 'bg-red-500',
};

function SavedPill({ state }: { state: SavingState }) {
  return (
    <div
      className="hidden items-center gap-2 px-2.5 py-1.5 font-mono text-[11px] text-text-secondary md:inline-flex"
      title="Auto-saved locally"
    >
      <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${SAVED_DOT[state]}`} />
      <span>{SAVED_LABEL[state]}</span>
    </div>
  );
}
