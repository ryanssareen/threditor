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

export function EditorHeader() {
  const { user, loading } = useAuth();
  const [showAuthDialog, setShowAuthDialog] = useState(false);

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

          <div>
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
                onClick={() => setShowAuthDialog(true)}
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
        onClose={() => setShowAuthDialog(false)}
      />
    </>
  );
}
