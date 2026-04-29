'use client';

/**
 * Standalone /login and /signup share the same auth surface as the
 * editor's AuthDialog: Google OAuth via signInWithPopup +
 * email/password. Mints the server-side session cookie via
 * /api/auth/session on success and then routes the user.
 *
 * The design mockup showed a "Continue with GitHub" button — we
 * replace it with Google OAuth, which is the only OAuth provider
 * actually wired through Firebase + admin verification.
 */

import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useState } from 'react';
import type { AuthError } from 'firebase/auth';

import { getFirebase } from '@/lib/firebase/client';

type Mode = 'signin' | 'signup';

const ERROR_MESSAGES: Record<string, string> = {
  'auth/invalid-email': 'Please enter a valid email address.',
  'auth/user-not-found': 'No account found with this email.',
  'auth/wrong-password': 'Incorrect password.',
  'auth/invalid-credential': 'Incorrect email or password.',
  'auth/email-already-in-use': 'An account with this email already exists.',
  'auth/weak-password': 'Password should be at least 6 characters.',
  'auth/network-request-failed': 'Network error. Check your connection.',
};

const SILENT_CODES = new Set([
  'auth/popup-closed-by-user',
  'auth/cancelled-popup-request',
]);

async function postSessionCookie(idToken: string): Promise<void> {
  const res = await fetch('/api/auth/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idToken }),
    credentials: 'include',
  });
  if (!res.ok) throw new Error(`Session creation failed (HTTP ${res.status})`);
}

async function rollbackClientSignin(): Promise<void> {
  try {
    const [{ signOut }] = await Promise.all([import('firebase/auth')]);
    const { auth } = getFirebase();
    await signOut(auth);
  } catch {
    /* best-effort */
  }
}

type Props = { mode: Mode };

export default function AuthForm({ mode }: Props) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [oauthBusy, setOauthBusy] = useState(false);
  const [bannerError, setBannerError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<{
    email?: string;
    password?: string;
    confirm?: string;
  }>({});

  const handleAuthError = (err: unknown): void => {
    const code = (err as AuthError)?.code ?? '';
    if (SILENT_CODES.has(code)) return;
    setBannerError(ERROR_MESSAGES[code] ?? 'Authentication failed. Try again.');
  };

  const handleGoogle = async (): Promise<void> => {
    setOauthBusy(true);
    setBannerError('');
    let firebaseSignedIn = false;
    try {
      const { signInWithPopup, GoogleAuthProvider } = await import(
        'firebase/auth'
      );
      const { auth } = getFirebase();
      const result = await signInWithPopup(auth, new GoogleAuthProvider());
      firebaseSignedIn = true;
      const idToken = await result.user.getIdToken();
      await postSessionCookie(idToken);
      router.push('/editor');
    } catch (err) {
      if (firebaseSignedIn) await rollbackClientSignin();
      handleAuthError(err);
    } finally {
      setOauthBusy(false);
    }
  };

  const validate = (): boolean => {
    const errs: typeof fieldErrors = {};
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errs.email = 'Enter a valid email address.';
    }
    if (mode === 'signup' && password.length < 6) {
      errs.password = 'Password must be at least 6 characters.';
    } else if (password.length === 0) {
      errs.password = 'Password is required.';
    }
    if (mode === 'signup' && confirm !== password) {
      errs.confirm = 'Passwords do not match.';
    }
    setFieldErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleEmail = async (e: React.FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    if (submitting) return;
    setBannerError('');
    if (!validate()) return;
    setSubmitting(true);
    let firebaseSignedIn = false;
    try {
      const { signInWithEmailAndPassword, createUserWithEmailAndPassword } =
        await import('firebase/auth');
      const { auth } = getFirebase();
      const result =
        mode === 'signin'
          ? await signInWithEmailAndPassword(auth, email, password)
          : await createUserWithEmailAndPassword(auth, email, password);
      firebaseSignedIn = true;
      const idToken = await result.user.getIdToken();
      await postSessionCookie(idToken);
      router.push('/editor');
    } catch (err) {
      if (firebaseSignedIn) await rollbackClientSignin();
      handleAuthError(err);
    } finally {
      setSubmitting(false);
    }
  };

  const submitLabel = submitting
    ? mode === 'signin'
      ? 'Logging in…'
      : 'Creating account…'
    : mode === 'signin'
      ? 'Log in'
      : 'Create account';

  return (
    <form onSubmit={handleEmail} className="auth-form" noValidate>
      {bannerError !== '' && (
        <div className="auth-error-banner" role="alert">
          <span aria-hidden="true">✕</span>
          <span>{bannerError}</span>
        </div>
      )}

      <div
        className={`auth-row ${fieldErrors.email !== undefined ? 'invalid' : ''}`}
      >
        <label htmlFor="auth-email">Email</label>
        <input
          id="auth-email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          required
        />
        <span className="auth-row__err">{fieldErrors.email ?? ''}</span>
      </div>

      <div
        className={`auth-row ${fieldErrors.password !== undefined ? 'invalid' : ''}`}
      >
        <label htmlFor="auth-password">Password</label>
        <div className="auth-input-wrap">
          <input
            id="auth-password"
            type={showPw ? 'text' : 'password'}
            autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={mode === 'signin' ? 'Your password' : 'At least 6 characters'}
            required
            minLength={mode === 'signup' ? 6 : undefined}
          />
          <button
            type="button"
            className="auth-toggle-pw"
            aria-label={showPw ? 'Hide password' : 'Show password'}
            onClick={() => setShowPw((v) => !v)}
          >
            {showPw ? '🙈' : '👁'}
          </button>
        </div>
        <span className="auth-row__err">{fieldErrors.password ?? ''}</span>
      </div>

      {mode === 'signup' && (
        <div
          className={`auth-row ${fieldErrors.confirm !== undefined ? 'invalid' : ''}`}
        >
          <label htmlFor="auth-confirm">Confirm password</label>
          <input
            id="auth-confirm"
            type={showPw ? 'text' : 'password'}
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="Re-enter your password"
            required
          />
          <span className="auth-row__err">{fieldErrors.confirm ?? ''}</span>
        </div>
      )}

      <button
        type="submit"
        className="auth-submit"
        disabled={submitting || oauthBusy}
        aria-busy={submitting}
      >
        {submitLabel}
      </button>

      <div className="auth-divider">or</div>

      <button
        type="button"
        className="auth-oauth"
        onClick={handleGoogle}
        disabled={submitting || oauthBusy}
      >
        <svg className="auth-oauth__icon" viewBox="0 0 24 24" aria-hidden="true">
          <path
            fill="#EA4335"
            d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
          />
          <path
            fill="#4285F4"
            d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
          />
          <path
            fill="#FBBC05"
            d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"
          />
          <path
            fill="#34A853"
            d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53l-3.66 2.84C3.99 20.53 7.7 23 12 23z"
          />
        </svg>
        {oauthBusy ? 'Redirecting…' : 'Continue with Google'}
      </button>

      <p className="auth-bottom">
        {mode === 'signin' ? (
          <>
            No account yet? <Link href="/signup">Create one free →</Link>
          </>
        ) : (
          <>
            Already have an account? <Link href="/login">Log in →</Link>
          </>
        )}
      </p>
    </form>
  );
}
