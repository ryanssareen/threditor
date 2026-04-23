'use client';

/**
 * M10 Unit 3: Firebase Auth dialog.
 *
 * Two mutually-exclusive sign-in paths:
 *   1. Google OAuth popup (signInWithPopup)
 *   2. Email/password (signInWithEmailAndPassword OR
 *      createUserWithEmailAndPassword depending on mode)
 *
 * Both paths hit the same post-success trail: call getIdToken() on
 * the resolved User and POST it to /api/auth/session so the server
 * mints the httpOnly session cookie. The client-side Firebase state
 * is still authoritative for realtime + Firestore rules; the cookie
 * is the SSR + server-only-write auth surface.
 *
 * User-cancelled popups (auth/popup-closed-by-user,
 * auth/cancelled-popup-request) reset to idle without showing an
 * error — the UX is "clicking X on Google's popup is not an error".
 */

import type { AuthError } from 'firebase/auth';
import { useState } from 'react';

import { getFirebase } from '@/lib/firebase/client';

type AuthMode = 'signin' | 'signup';
type AuthState = 'idle' | 'loading' | 'success' | 'error';

type Props = {
  isOpen: boolean;
  onClose: () => void;
  /**
   * M11: optional hint text shown above the Google sign-in button,
   * e.g. "Sign in to publish". Purely decorative — does not change
   * the auth flow.
   */
  initialHint?: string;
};

const ERROR_MESSAGES: Record<string, string> = {
  'auth/invalid-email': 'Please enter a valid email address',
  'auth/user-not-found': 'No account found with this email',
  'auth/wrong-password': 'Incorrect password',
  'auth/invalid-credential': 'Incorrect email or password',
  'auth/email-already-in-use': 'An account with this email already exists',
  'auth/weak-password': 'Password should be at least 6 characters',
  'auth/network-request-failed': 'Network error. Check your connection.',
  // Silently ignored — see the isSilent check below.
  'auth/popup-closed-by-user': '',
  'auth/cancelled-popup-request': '',
};

const SILENT_ERROR_CODES = new Set([
  'auth/popup-closed-by-user',
  'auth/cancelled-popup-request',
]);

async function postSessionCookie(idToken: string): Promise<void> {
  const res = await fetch('/api/auth/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idToken }),
  });
  if (!res.ok) {
    throw new Error(`Failed to create session (${res.status})`);
  }
}

export function AuthDialog({ isOpen, onClose, initialHint }: Props) {
  const [mode, setMode] = useState<AuthMode>('signin');
  const [state, setState] = useState<AuthState>('idle');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  if (!isOpen) return null;

  const handleAuthError = (err: unknown): void => {
    const authError = err as AuthError;
    const code = authError?.code ?? '';
    if (SILENT_ERROR_CODES.has(code)) {
      setState('idle');
      return;
    }
    const message = ERROR_MESSAGES[code] ?? 'Authentication failed';
    setError(message);
    setState('error');
  };

  const handleGoogleSignIn = async () => {
    setState('loading');
    setError('');
    try {
      // Dynamic import so the popup + Google provider modules are in a
      // chunk that loads only when the user clicks Sign In — keeps the
      // editor's critical path lean. (Static import here hoists the
      // entire firebase/auth module into the /editor shared chunk.)
      const { signInWithPopup, GoogleAuthProvider } = await import(
        'firebase/auth'
      );
      const { auth } = getFirebase();
      const provider = new GoogleAuthProvider();
      const result = await signInWithPopup(auth, provider);
      const idToken = await result.user.getIdToken();
      await postSessionCookie(idToken);
      setState('success');
      setTimeout(onClose, 500);
    } catch (err) {
      handleAuthError(err);
    }
  };

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setState('loading');
    setError('');
    try {
      const { signInWithEmailAndPassword, createUserWithEmailAndPassword } =
        await import('firebase/auth');
      const { auth } = getFirebase();
      const result =
        mode === 'signin'
          ? await signInWithEmailAndPassword(auth, email, password)
          : await createUserWithEmailAndPassword(auth, email, password);
      const idToken = await result.user.getIdToken();
      await postSessionCookie(idToken);
      setState('success');
      setTimeout(onClose, 500);
    } catch (err) {
      handleAuthError(err);
    }
  };

  return (
    <div
      data-testid="auth-dialog-backdrop"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="auth-dialog-title"
        data-testid="auth-dialog"
        className="w-full max-w-md rounded-lg border border-ui-border bg-ui-surface p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-6 flex items-center justify-between">
          <h2
            id="auth-dialog-title"
            className="text-xl font-semibold text-text-primary"
          >
            {mode === 'signin' ? 'Sign in to Threditor' : 'Create an account'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            data-testid="auth-dialog-close"
            className="text-text-secondary transition-colors hover:text-text-primary"
            aria-label="Close dialog"
          >
            ✕
          </button>
        </div>

        {error !== '' && (
          <div
            role="alert"
            data-testid="auth-dialog-error"
            className="mb-4 rounded border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-400"
          >
            {error}
          </div>
        )}

        {error === '' && initialHint !== undefined && (
          <p
            data-testid="auth-dialog-hint"
            className="mb-4 text-center text-sm text-text-secondary"
          >
            {initialHint}
          </p>
        )}

        <button
          type="button"
          onClick={handleGoogleSignIn}
          disabled={state === 'loading'}
          data-testid="auth-dialog-google"
          className="mb-4 flex w-full items-center justify-center gap-2 rounded bg-white px-4 py-3 text-gray-900 transition-colors hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <svg className="h-5 w-5" viewBox="0 0 24 24" aria-hidden="true">
            <path
              fill="currentColor"
              d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
            />
            <path
              fill="currentColor"
              d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
            />
            <path
              fill="currentColor"
              d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
            />
            <path
              fill="currentColor"
              d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
            />
          </svg>
          {state === 'loading' ? 'Signing in…' : 'Continue with Google'}
        </button>

        <div className="relative mb-4">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-ui-border" />
          </div>
          <div className="relative flex justify-center text-sm">
            <span className="bg-ui-surface px-2 text-text-secondary">or</span>
          </div>
        </div>

        <form onSubmit={handleEmailAuth} className="space-y-4">
          <div>
            <label
              htmlFor="auth-dialog-email"
              className="mb-1 block text-sm text-text-secondary"
            >
              Email
            </label>
            <input
              id="auth-dialog-email"
              data-testid="auth-dialog-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full rounded border border-ui-border bg-ui-base px-3 py-2 text-text-primary focus:border-accent focus:outline-none"
            />
          </div>

          <div>
            <label
              htmlFor="auth-dialog-password"
              className="mb-1 block text-sm text-text-secondary"
            >
              Password
            </label>
            <input
              id="auth-dialog-password"
              data-testid="auth-dialog-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
              className="w-full rounded border border-ui-border bg-ui-base px-3 py-2 text-text-primary focus:border-accent focus:outline-none"
            />
          </div>

          <button
            type="submit"
            disabled={state === 'loading'}
            data-testid="auth-dialog-submit"
            className="w-full rounded bg-accent px-4 py-3 text-canvas transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            {state === 'loading'
              ? mode === 'signin'
                ? 'Signing in…'
                : 'Creating account…'
              : mode === 'signin'
                ? 'Sign In'
                : 'Create Account'}
          </button>
        </form>

        <div className="mt-4 text-center text-sm text-text-secondary">
          {mode === 'signin' ? (
            <>
              Don&apos;t have an account?{' '}
              <button
                type="button"
                onClick={() => setMode('signup')}
                data-testid="auth-dialog-switch-signup"
                className="text-accent hover:text-accent-hover"
              >
                Create one
              </button>
            </>
          ) : (
            <>
              Already have an account?{' '}
              <button
                type="button"
                onClick={() => setMode('signin')}
                data-testid="auth-dialog-switch-signin"
                className="text-accent hover:text-accent-hover"
              >
                Sign in
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
