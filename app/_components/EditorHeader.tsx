'use client';

/**
 * M10 Unit 5: fixed top header for the editor route.
 *
 * Three states:
 *   - auth pending (loading=true): skeleton pulse avatar
 *   - signed out: "Sign In" button that opens AuthDialog
 *   - signed in: UserMenu with avatar + email + sign out
 *
 * Fixed at top, z-40 so it sits above the editor's z-30 pill layer
 * from M8's luminance indicator but below the modal dialog (z-50).
 * Occupies ~56px (3.5rem); the editor page offsets content by pt-14
 * to match.
 */

import Link from 'next/link';
import { useState } from 'react';

import { useAuth } from '@/app/_providers/AuthProvider';

import { AuthDialog } from './AuthDialog';
import { UserMenu } from './UserMenu';

// AuthDialog and UserMenu are imported statically here. Their heavy
// firebase/auth dependencies (signInWithPopup, createUser…, signOut)
// are imported dynamically *inside the handler functions* so they
// land in code-split chunks that only load when the user clicks Sign
// In / Sign Out — keeping the editor's critical path lean.

type Props = {
  /**
   * M11: called when a signed-in user clicks Publish. Parent owns
   * the PublishDialog + the actual export/upload flow — EditorHeader
   * is decorative. When the user clicks Publish while signed out,
   * EditorHeader opens AuthDialog with a "Sign in to publish" hint
   * internally; the parent only hears about it once the user is
   * signed in and clicks Publish again.
   */
  onPublishClick?: () => void;
};

export function EditorHeader({ onPublishClick }: Props = {}) {
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

  return (
    <>
      <header
        data-testid="editor-header"
        className="fixed left-0 right-0 top-0 z-40 border-b border-ui-border bg-ui-base"
      >
        <div className="flex h-14 items-center justify-between px-4">
          <Link
            href="/"
            className="text-lg font-semibold text-text-primary transition-colors hover:text-accent"
            data-testid="editor-header-home"
          >
            threditor
          </Link>

          <div className="flex items-center gap-2">
            {!loading && onPublishClick !== undefined && (
              <button
                type="button"
                data-testid="editor-header-publish"
                onClick={handlePublishFromHeader}
                className="rounded border border-accent bg-transparent px-3 py-1.5 text-sm font-medium text-accent transition-colors hover:bg-accent hover:text-canvas"
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
                className="rounded bg-accent px-4 py-2 text-sm font-medium text-canvas transition-colors hover:bg-accent-hover"
              >
                Sign In
              </button>
            )}
          </div>
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
