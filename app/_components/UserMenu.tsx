'use client';

/**
 * M10 Unit 4: signed-in user menu.
 *
 * Renders only when `useAuth()` reports a non-null user. Opens on
 * click to show the signed-in email + a Sign Out button. Closes on
 * click-outside via a document-level mousedown listener installed
 * only while open.
 *
 * Sign Out is a two-step:
 *   1. POST /api/auth/signout  (revokes refresh tokens + clears
 *      httpOnly cookie)
 *   2. Firebase signOut(auth) (clears client-side Auth state so the
 *      AuthProvider subscription fires with null)
 *
 * If #1 fails, #2 still runs — user's local state is cleared; the
 * server session is left for its 5-day TTL to expire.
 */

import { signOut } from 'firebase/auth';
import { useEffect, useRef, useState } from 'react';

import { useAuth } from '@/app/_providers/AuthProvider';
import { getFirebase } from '@/lib/firebase/client';

function initialsOf(name: string): string {
  return name
    .split(' ')
    .map((n) => n[0] ?? '')
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

export function UserMenu() {
  const { user } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const onMouseDown = (e: MouseEvent) => {
      if (
        menuRef.current !== null &&
        !menuRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [isOpen]);

  if (user === null) return null;

  const handleSignOut = async () => {
    try {
      await fetch('/api/auth/signout', { method: 'POST' });
    } catch (err) {
      console.error('UserMenu: /api/auth/signout failed', err);
    }
    try {
      const { auth } = getFirebase();
      await signOut(auth);
    } catch (err) {
      console.error('UserMenu: firebase signOut failed', err);
    }
    setIsOpen(false);
  };

  const displayName =
    user.displayName ?? user.email?.split('@')[0] ?? 'User';
  const initials = initialsOf(displayName);

  return (
    <div className="relative" ref={menuRef}>
      <button
        type="button"
        onClick={() => setIsOpen((o) => !o)}
        data-testid="user-menu-trigger"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        className="flex items-center gap-2 rounded px-3 py-2 transition-colors hover:bg-ui-surface"
      >
        {user.photoURL !== null ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={user.photoURL}
            alt={displayName}
            className="h-8 w-8 rounded-full"
          />
        ) : (
          <div
            aria-hidden="true"
            className="flex h-8 w-8 items-center justify-center rounded-full bg-accent text-sm font-semibold text-canvas"
          >
            {initials}
          </div>
        )}
        <span className="hidden text-sm text-text-primary sm:inline">
          {displayName}
        </span>
        <svg
          className={`h-4 w-4 text-text-secondary transition-transform ${isOpen ? 'rotate-180' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M19 9l-7 7-7-7"
          />
        </svg>
      </button>

      {isOpen && (
        <div
          role="menu"
          data-testid="user-menu-dropdown"
          className="absolute right-0 mt-2 w-64 overflow-hidden rounded-lg border border-ui-border bg-ui-surface shadow-panel"
        >
          <div className="border-b border-ui-border px-4 py-3">
            <div className="text-sm font-medium text-text-primary">
              Signed in as
            </div>
            <div
              data-testid="user-menu-email"
              className="truncate text-sm text-text-secondary"
            >
              {user.email}
            </div>
          </div>
          <div className="py-1">
            <button
              type="button"
              onClick={handleSignOut}
              data-testid="user-menu-sign-out"
              role="menuitem"
              className="w-full px-4 py-2 text-left text-sm text-text-primary transition-colors hover:bg-ui-base"
            >
              Sign Out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
