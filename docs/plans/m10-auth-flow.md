# M10: Auth Flow — Implementation Plan

**Milestone:** M10 (Phase 2 First User Feature)  
**Status:** Planning  
**Created:** 2026-04-23  
**Compound Engineering Phase:** Plan  
**Depends on:** M9 (Firebase + Supabase Scaffolding)

---

## 1. Objectives

Ship the first user-visible Phase 2 feature: sign-in/sign-out UI with session persistence. Users can authenticate via Email/Password or Google OAuth, see their profile in a persistent dropdown menu, and maintain auth state across page reloads via httpOnly session cookies.

**Success metrics:**
- User can sign in with Google in <3 clicks (OAuth popup → consent → redirect → signed in)
- User can sign in with Email/Password in <5 seconds (type credentials → submit → signed in)
- Session persists across page reload (no re-auth required)
- Auth state visible in UI within 200ms of page load
- Zero regression in Phase 1 editor functionality
- Bundle size increase under 15 kB (UI components + auth logic)

**Non-goals (deferred to M11-M14):**
- User profile creation in Firestore (happens on first skin publish in M11)
- Avatar upload (uses Firebase Auth photoURL from OAuth provider)
- Password reset flow (basic "forgot password" only)
- Email verification (optional for MVP)

---

## 2. Dependencies Analysis

### 2.1 What M9 provides

**From M9 (already shipped):**
- `lib/firebase/client.ts` — `getFirebase()` returns `{app, auth, db}`
- `lib/firebase/admin.ts` — `getAdminFirebase()` returns `{app, auth, db}`
- `lib/firebase/types.ts` — `UserProfile`, `SharedSkin`, `Like` types
- `app/_providers/AuthProvider.tsx` — React context with `{user, loading}`
- Firestore rules deployed (but `/users` collection not yet used)
- Session cookie infrastructure: Admin SDK's `createSessionCookie()` and `verifySessionCookie()` already available

**Key M9 learnings to apply:**
- **AuthProvider PII surface (M9 COMPOUND §Gotchas):** Consider narrowing exposed User fields to `Pick<User, 'uid' | 'displayName' | 'photoURL'>`
- **Missing env var validation (M9 residual):** Add fail-fast checks in auth routes
- **server-only barrier:** New API routes must use `import 'server-only'` for Admin SDK access

### 2.2 Required packages

**No new production dependencies.** Everything needed is already in M9:
- `firebase@^11.2.0` — client auth (`signInWithPopup`, `signInWithEmailAndPassword`)
- `firebase-admin@^13.8.0` — server session cookies

**Dev dependencies (already installed):**
- `@testing-library/react@16.1.0` — for AuthDialog component tests
- `@testing-library/user-event` — may need to add for input simulation

**Check if user-event is present:**
```bash
npm list @testing-library/user-event
```

If not present, add in Unit 0:
```bash
npm install -D @testing-library/user-event@^14.5.0
```

### 2.3 Environment variables

**Current state (from M9):**
All Firebase vars already in `.env.local`:
- `NEXT_PUBLIC_FIREBASE_*` (6 client vars)
- `FIREBASE_ADMIN_*` (3 server vars)

**No new env vars needed for M10.**

**Validation requirement:**
Per M9 residual, add fail-fast env var checks in `/api/auth/session` route before calling Admin SDK.

---

## 3. Architecture Decisions

### 3.1 Session cookie pattern (server-side auth)

**Decision:** Use Firebase Admin SDK session cookies, not client-side ID tokens.

**Rationale:**
- Server components need auth state for SSR (M12 gallery, M13 profile pages)
- ID tokens expire after 1 hour; session cookies can last 14 days
- httpOnly cookies prevent XSS token theft
- Next.js App Router server components can read cookies synchronously

**Implementation:**
```
User signs in (client) → Firebase Auth ID token
                      ↓
POST /api/auth/session (server route)
  ├→ Verify ID token with Admin SDK
  ├→ Create session cookie (5 days TTL)
  └→ Set httpOnly cookie

Subsequent page loads:
  ├→ Server component reads session cookie from headers
  ├→ Calls verifySessionCookie() → Firebase UID
  └→ Fetches user data if needed
```

**Session duration:** 5 days (120 hours)
- Longer than typical web session (24h) but shorter than "remember me" (14d)
- Balance between convenience and security
- User can manually sign out to invalidate early

**Cookie attributes:**
```typescript
{
  maxAge: 60 * 60 * 24 * 5,  // 5 days in seconds
  httpOnly: true,             // Prevent JS access
  secure: process.env.NODE_ENV === 'production',  // HTTPS only in prod
  sameSite: 'lax',            // CSRF protection
  path: '/',                  // Available site-wide
}
```

### 3.2 AuthDialog UX pattern

**Decision:** Modal dialog (not inline form) triggered by "Sign In" button in header.

**Rationale:**
- Keeps editor UI clean (no persistent auth form)
- Modal focus-traps user during auth flow
- Familiar pattern (GitHub, Vercel, most SaaS)
- Easily dismissible if user wants to explore first

**Trigger locations:**
- Top-right header: "Sign In" button (always visible when signed out)
- Export dialog: Soft prompt if user tries to publish (M11 feature)

**Modal structure:**
```
┌─────────────────────────────────────┐
│  Sign in to Threditor          [X] │
├─────────────────────────────────────┤
│                                     │
│  [Continue with Google]             │  ← Primary CTA
│                                     │
│  ──────── or ────────               │
│                                     │
│  Email: [___________________]       │
│  Password: [___________________]    │
│  [Sign In]  [Create Account]       │
│                                     │
│  Forgot password?                   │
└─────────────────────────────────────┘
```

**Tab order:**
1. Google button (most common)
2. Email input
3. Password input
4. Sign In button
5. Create Account link
6. Forgot password link
7. Close X

**State machine:**
```
idle → sign_in_loading → signed_in → modal_closed
     → sign_up_loading → signed_up → modal_closed
     → error → idle (show error message, allow retry)
```

**Error handling:**
- `auth/invalid-email`: "Please enter a valid email address"
- `auth/user-not-found`: "No account found. Create one below."
- `auth/wrong-password`: "Incorrect password. Try again or reset it."
- `auth/popup-closed-by-user`: Silently dismiss (user intentionally closed)
- `auth/network-request-failed`: "Network error. Check your connection."

### 3.3 UserMenu design

**Decision:** Avatar dropdown in top-right corner (replaces "Sign In" button when authenticated).

**Structure:**
```
┌─────────────────────────────┐
│  [Avatar] displayName  [▼] │  ← Click to open
└─────────────────────────────┘
          ↓ (opens dropdown)
┌─────────────────────────────┐
│  Signed in as               │
│  user@example.com           │
├─────────────────────────────┤
│  My Profile (M13)           │  ← Deferred
│  My Skins (M13)             │  ← Deferred
├─────────────────────────────┤
│  Sign Out                   │
└─────────────────────────────┘
```

**Avatar source priority:**
1. Firebase Auth `photoURL` (from Google OAuth)
2. Fallback: Initials in colored circle (like GitHub)
3. Fallback: Generic user icon (if no displayName)

**Sign-out flow:**
```
User clicks "Sign Out"
  ↓
POST /api/auth/signout
  ├→ Revoke session cookie via Admin SDK
  ├→ Clear cookie in response
  └→ Return success

Client receives response
  ↓
Firebase client-side signOut()
  ↓
AuthProvider detects null user
  ↓
UI updates (menu disappears, "Sign In" button returns)
```

### 3.4 Server-side auth helper

**Decision:** Create `lib/firebase/auth.ts` for server-side session helpers (deferred from M9).

**Implementation:**
```typescript
// lib/firebase/auth.ts
import 'server-only';
import { cookies } from 'next/headers';
import { getAdminFirebase } from './admin';

export async function getServerSession(): Promise<{ uid: string } | null> {
  const sessionCookie = (await cookies()).get('session')?.value;
  if (!sessionCookie) return null;

  try {
    const { auth } = getAdminFirebase();
    const decodedClaims = await auth.verifySessionCookie(sessionCookie, true);
    return { uid: decodedClaims.uid };
  } catch (error) {
    // Session expired or invalid
    return null;
  }
}

export async function requireServerSession(): Promise<{ uid: string }> {
  const session = await getServerSession();
  if (!session) {
    throw new Error('Unauthorized: No valid session');
  }
  return session;
}
```

**Usage in server components (M12+):**
```typescript
// app/gallery/page.tsx (server component)
import { getServerSession } from '@/lib/firebase/auth';

export default async function GalleryPage() {
  const session = await getServerSession();
  // session is {uid: string} | null
  // Render "Sign in to like" vs "Like" button based on session
}
```

**Usage in API routes:**
```typescript
// app/api/skins/[id]/like/route.ts
import { requireServerSession } from '@/lib/firebase/auth';

export async function POST(req: Request) {
  const { uid } = await requireServerSession();  // Throws if not signed in
  // ... like toggle logic
}
```

---

## 4. Unit-by-Unit Implementation Plan

### Unit 0: Dependencies (if needed)

**Check:**
```bash
npm list @testing-library/user-event
```

**If not present:**
```bash
npm install -D @testing-library/user-event@^14.5.0
```

**Validation:**
- `package.json` updated
- `npm run build` succeeds

---

### Unit 1: Session Cookie Routes

**Files created:**
- `app/api/auth/session/route.ts`
- `app/api/auth/signout/route.ts`
- `app/api/auth/__tests__/session.test.ts`

**Implementation: `/api/auth/session/route.ts`**

```typescript
import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { getAdminFirebase } from '@/lib/firebase/admin';

const SESSION_DURATION = 60 * 60 * 24 * 5 * 1000;  // 5 days in milliseconds

// Fail-fast env validation (per M9 residual)
function validateEnv() {
  const required = [
    'FIREBASE_ADMIN_PROJECT_ID',
    'FIREBASE_ADMIN_CLIENT_EMAIL',
    'FIREBASE_ADMIN_PRIVATE_KEY',
  ];
  const missing = required.filter(key => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(`Missing required env vars: ${missing.join(', ')}`);
  }
}

export async function POST(req: NextRequest) {
  try {
    validateEnv();
    
    const { idToken } = await req.json();
    if (!idToken || typeof idToken !== 'string') {
      return NextResponse.json(
        { error: 'Missing or invalid idToken' },
        { status: 400 }
      );
    }

    const { auth } = getAdminFirebase();
    
    // Verify the ID token first (throws if invalid/expired)
    await auth.verifyIdToken(idToken);
    
    // Create session cookie
    const sessionCookie = await auth.createSessionCookie(idToken, {
      expiresIn: SESSION_DURATION,
    });

    const response = NextResponse.json({ success: true });
    response.cookies.set('session', sessionCookie, {
      maxAge: SESSION_DURATION / 1000,  // Convert to seconds
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
    });

    return response;
  } catch (error) {
    console.error('Session creation failed:', error);
    return NextResponse.json(
      { error: 'Authentication failed' },
      { status: 401 }
    );
  }
}
```

**Implementation: `/api/auth/signout/route.ts`**

```typescript
import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getAdminFirebase } from '@/lib/firebase/admin';

export async function POST(req: NextRequest) {
  try {
    const cookieStore = await cookies();
    const sessionCookie = cookieStore.get('session')?.value;

    if (sessionCookie) {
      try {
        const { auth } = getAdminFirebase();
        const decodedClaims = await auth.verifySessionCookie(sessionCookie);
        // Revoke all refresh tokens for the user
        await auth.revokeRefreshTokens(decodedClaims.sub);
      } catch (error) {
        // Session already invalid - that's fine, still clear cookie
        console.log('Session already invalid during signout');
      }
    }

    const response = NextResponse.json({ success: true });
    response.cookies.delete('session');
    return response;
  } catch (error) {
    console.error('Sign out failed:', error);
    return NextResponse.json(
      { error: 'Sign out failed' },
      { status: 500 }
    );
  }
}
```

**Test file: `app/api/auth/__tests__/session.test.ts`**

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { POST as sessionPOST } from '../session/route';
import { POST as signoutPOST } from '../signout/route';
import { getAdminFirebase } from '@/lib/firebase/admin';

// Mock Admin SDK
vi.mock('@/lib/firebase/admin', () => ({
  getAdminFirebase: vi.fn(),
}));

describe('Session API Routes', () => {
  const mockAuth = {
    verifyIdToken: vi.fn(),
    createSessionCookie: vi.fn(),
    verifySessionCookie: vi.fn(),
    revokeRefreshTokens: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (getAdminFirebase as any).mockReturnValue({ auth: mockAuth });
  });

  describe('POST /api/auth/session', () => {
    it('creates session cookie on valid idToken', async () => {
      mockAuth.verifyIdToken.mockResolvedValue({ uid: 'test-uid' });
      mockAuth.createSessionCookie.mockResolvedValue('mock-session-cookie');

      const req = new Request('http://localhost/api/auth/session', {
        method: 'POST',
        body: JSON.stringify({ idToken: 'valid-token' }),
      });

      const response = await sessionPOST(req as any);
      const data = await response.json();

      expect(data.success).toBe(true);
      expect(mockAuth.verifyIdToken).toHaveBeenCalledWith('valid-token');
      expect(mockAuth.createSessionCookie).toHaveBeenCalled();
    });

    it('rejects missing idToken', async () => {
      const req = new Request('http://localhost/api/auth/session', {
        method: 'POST',
        body: JSON.stringify({}),
      });

      const response = await sessionPOST(req as any);
      expect(response.status).toBe(400);
    });

    it('rejects invalid idToken', async () => {
      mockAuth.verifyIdToken.mockRejectedValue(new Error('Invalid token'));

      const req = new Request('http://localhost/api/auth/session', {
        method: 'POST',
        body: JSON.stringify({ idToken: 'bad-token' }),
      });

      const response = await sessionPOST(req as any);
      expect(response.status).toBe(401);
    });
  });

  describe('POST /api/auth/signout', () => {
    it('revokes session and clears cookie', async () => {
      mockAuth.verifySessionCookie.mockResolvedValue({ sub: 'user-123' });
      mockAuth.revokeRefreshTokens.mockResolvedValue(undefined);

      const req = new Request('http://localhost/api/auth/signout', {
        method: 'POST',
        headers: { Cookie: 'session=mock-cookie' },
      });

      const response = await signoutPOST(req as any);
      const data = await response.json();

      expect(data.success).toBe(true);
      expect(mockAuth.revokeRefreshTokens).toHaveBeenCalledWith('user-123');
    });

    it('succeeds even with no session cookie', async () => {
      const req = new Request('http://localhost/api/auth/signout', {
        method: 'POST',
      });

      const response = await signoutPOST(req as any);
      expect(response.status).toBe(200);
    });
  });
});
```

**Acceptance criteria:**
- [ ] Session cookie created on valid ID token
- [ ] Session cookie has correct attributes (httpOnly, secure in prod, 5 day TTL)
- [ ] Invalid ID tokens rejected with 401
- [ ] Sign out revokes refresh tokens and clears cookie
- [ ] Env validation throws on missing vars
- [ ] All tests pass

---

### Unit 2: Server-Side Auth Helper

**Files created:**
- `lib/firebase/auth.ts`
- `lib/firebase/__tests__/auth.test.ts`

**Implementation: `lib/firebase/auth.ts`**

```typescript
import 'server-only';
import { cookies } from 'next/headers';
import { getAdminFirebase } from './admin';
import type { DecodedIdToken } from 'firebase-admin/auth';

export type ServerSession = {
  uid: string;
  email?: string;
  emailVerified?: boolean;
};

export async function getServerSession(): Promise<ServerSession | null> {
  try {
    const cookieStore = await cookies();
    const sessionCookie = cookieStore.get('session')?.value;
    
    if (!sessionCookie) {
      return null;
    }

    const { auth } = getAdminFirebase();
    const decodedClaims: DecodedIdToken = await auth.verifySessionCookie(
      sessionCookie,
      true  // checkRevoked = true
    );

    return {
      uid: decodedClaims.uid,
      email: decodedClaims.email,
      emailVerified: decodedClaims.email_verified,
    };
  } catch (error) {
    // Session expired, revoked, or invalid - return null
    return null;
  }
}

export async function requireServerSession(): Promise<ServerSession> {
  const session = await getServerSession();
  if (!session) {
    throw new Error('Unauthorized: No valid session');
  }
  return session;
}
```

**Test file: `lib/firebase/__tests__/auth.test.ts`**

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getServerSession, requireServerSession } from '../auth';
import { getAdminFirebase } from '../admin';
import { cookies } from 'next/headers';

vi.mock('../admin');
vi.mock('next/headers');

describe('Server-side auth helpers', () => {
  const mockAuth = {
    verifySessionCookie: vi.fn(),
  };

  const mockCookies = {
    get: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (getAdminFirebase as any).mockReturnValue({ auth: mockAuth });
    (cookies as any).mockResolvedValue(mockCookies);
  });

  describe('getServerSession', () => {
    it('returns session when cookie is valid', async () => {
      mockCookies.get.mockReturnValue({ value: 'valid-session-cookie' });
      mockAuth.verifySessionCookie.mockResolvedValue({
        uid: 'user-123',
        email: 'test@example.com',
        email_verified: true,
      });

      const session = await getServerSession();
      
      expect(session).toEqual({
        uid: 'user-123',
        email: 'test@example.com',
        emailVerified: true,
      });
    });

    it('returns null when no cookie present', async () => {
      mockCookies.get.mockReturnValue(undefined);

      const session = await getServerSession();
      expect(session).toBeNull();
    });

    it('returns null when session cookie is invalid', async () => {
      mockCookies.get.mockReturnValue({ value: 'expired-cookie' });
      mockAuth.verifySessionCookie.mockRejectedValue(
        new Error('auth/session-cookie-expired')
      );

      const session = await getServerSession();
      expect(session).toBeNull();
    });
  });

  describe('requireServerSession', () => {
    it('returns session when valid', async () => {
      mockCookies.get.mockReturnValue({ value: 'valid-session-cookie' });
      mockAuth.verifySessionCookie.mockResolvedValue({
        uid: 'user-123',
        email: 'test@example.com',
      });

      const session = await requireServerSession();
      expect(session.uid).toBe('user-123');
    });

    it('throws when no valid session', async () => {
      mockCookies.get.mockReturnValue(undefined);

      await expect(requireServerSession()).rejects.toThrow('Unauthorized');
    });
  });
});
```

**Acceptance criteria:**
- [ ] `getServerSession()` returns session data when valid
- [ ] `getServerSession()` returns null when cookie missing/invalid
- [ ] `requireServerSession()` throws on missing session
- [ ] All tests pass

---

### Unit 3: AuthDialog Component

**Files created:**
- `app/_components/AuthDialog.tsx`
- `app/_components/__tests__/AuthDialog.test.tsx`

**Implementation: `app/_components/AuthDialog.tsx`**

```typescript
'use client';

import { useState } from 'react';
import { 
  signInWithPopup, 
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  type AuthError,
} from 'firebase/auth';
import { getFirebase } from '@/lib/firebase/client';

type AuthMode = 'signin' | 'signup';
type AuthState = 'idle' | 'loading' | 'success' | 'error';

type Props = {
  isOpen: boolean;
  onClose: () => void;
};

const ERROR_MESSAGES: Record<string, string> = {
  'auth/invalid-email': 'Please enter a valid email address',
  'auth/user-not-found': 'No account found with this email',
  'auth/wrong-password': 'Incorrect password',
  'auth/email-already-in-use': 'An account with this email already exists',
  'auth/weak-password': 'Password should be at least 6 characters',
  'auth/network-request-failed': 'Network error. Check your connection.',
  'auth/popup-closed-by-user': '', // Silently ignore
  'auth/cancelled-popup-request': '', // Silently ignore
};

export function AuthDialog({ isOpen, onClose }: Props) {
  const [mode, setMode] = useState<AuthMode>('signin');
  const [state, setState] = useState<AuthState>('idle');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  if (!isOpen) return null;

  const handleGoogleSignIn = async () => {
    setState('loading');
    setError('');
    
    try {
      const { auth } = getFirebase();
      const provider = new GoogleAuthProvider();
      const result = await signInWithPopup(auth, provider);
      
      // Create session cookie
      const idToken = await result.user.getIdToken();
      const response = await fetch('/api/auth/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken }),
      });

      if (!response.ok) {
        throw new Error('Failed to create session');
      }

      setState('success');
      setTimeout(onClose, 500);  // Brief success state before closing
    } catch (err) {
      const authError = err as AuthError;
      const message = ERROR_MESSAGES[authError.code] || 'Sign in failed';
      if (message) {
        setError(message);
        setState('error');
      } else {
        // Silently ignore user-cancelled popups
        setState('idle');
      }
    }
  };

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setState('loading');
    setError('');

    try {
      const { auth } = getFirebase();
      
      const result = mode === 'signin'
        ? await signInWithEmailAndPassword(auth, email, password)
        : await createUserWithEmailAndPassword(auth, email, password);

      // Create session cookie
      const idToken = await result.user.getIdToken();
      const response = await fetch('/api/auth/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken }),
      });

      if (!response.ok) {
        throw new Error('Failed to create session');
      }

      setState('success');
      setTimeout(onClose, 500);
    } catch (err) {
      const authError = err as AuthError;
      const message = ERROR_MESSAGES[authError.code] || 'Authentication failed';
      setError(message);
      setState('error');
    }
  };

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
    >
      <div 
        className="bg-ui-surface border border-ui-border rounded-lg p-6 w-full max-w-md"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-semibold text-text-primary">
            {mode === 'signin' ? 'Sign in to Threditor' : 'Create an account'}
          </h2>
          <button
            onClick={onClose}
            className="text-text-secondary hover:text-text-primary transition-colors"
            aria-label="Close dialog"
          >
            ✕
          </button>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded text-red-400 text-sm">
            {error}
          </div>
        )}

        <button
          onClick={handleGoogleSignIn}
          disabled={state === 'loading'}
          className="w-full py-3 px-4 bg-white text-gray-900 rounded hover:bg-gray-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 mb-4"
        >
          <svg className="w-5 h-5" viewBox="0 0 24 24">
            <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
            <path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
            <path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
            <path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
          </svg>
          {state === 'loading' ? 'Signing in...' : 'Continue with Google'}
        </button>

        <div className="relative mb-4">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-ui-border"></div>
          </div>
          <div className="relative flex justify-center text-sm">
            <span className="px-2 bg-ui-surface text-text-secondary">or</span>
          </div>
        </div>

        <form onSubmit={handleEmailAuth} className="space-y-4">
          <div>
            <label htmlFor="email" className="block text-sm text-text-secondary mb-1">
              Email
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full px-3 py-2 bg-ui-base border border-ui-border rounded text-text-primary focus:outline-none focus:border-accent"
            />
          </div>

          <div>
            <label htmlFor="password" className="block text-sm text-text-secondary mb-1">
              Password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
              className="w-full px-3 py-2 bg-ui-base border border-ui-border rounded text-text-primary focus:outline-none focus:border-accent"
            />
          </div>

          <button
            type="submit"
            disabled={state === 'loading'}
            className="w-full py-3 px-4 bg-accent hover:bg-accent-hover text-black rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {state === 'loading' 
              ? (mode === 'signin' ? 'Signing in...' : 'Creating account...')
              : (mode === 'signin' ? 'Sign In' : 'Create Account')
            }
          </button>
        </form>

        <div className="mt-4 text-center text-sm text-text-secondary">
          {mode === 'signin' ? (
            <>
              Don't have an account?{' '}
              <button
                onClick={() => setMode('signup')}
                className="text-accent hover:text-accent-hover"
              >
                Create one
              </button>
            </>
          ) : (
            <>
              Already have an account?{' '}
              <button
                onClick={() => setMode('signin')}
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
```

**Test file: `app/_components/__tests__/AuthDialog.test.tsx`**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AuthDialog } from '../AuthDialog';
import { getFirebase } from '@/lib/firebase/client';

vi.mock('@/lib/firebase/client');

describe('AuthDialog', () => {
  const mockOnClose = vi.fn();
  
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  it('renders when open', () => {
    render(<AuthDialog isOpen={true} onClose={mockOnClose} />);
    expect(screen.getByText('Sign in to Threditor')).toBeInTheDocument();
  });

  it('does not render when closed', () => {
    render(<AuthDialog isOpen={false} onClose={mockOnClose} />);
    expect(screen.queryByText('Sign in to Threditor')).not.toBeInTheDocument();
  });

  it('closes on X button click', () => {
    render(<AuthDialog isOpen={true} onClose={mockOnClose} />);
    fireEvent.click(screen.getByLabelText('Close dialog'));
    expect(mockOnClose).toHaveBeenCalled();
  });

  it('toggles between signin and signup modes', () => {
    render(<AuthDialog isOpen={true} onClose={mockOnClose} />);
    
    expect(screen.getByText('Sign in to Threditor')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Create one'));
    expect(screen.getByText('Create an account')).toBeInTheDocument();
  });

  it('displays error message on auth failure', async () => {
    const mockAuth = {
      signInWithEmailAndPassword: vi.fn().mockRejectedValue({
        code: 'auth/wrong-password',
      }),
    };
    (getFirebase as any).mockReturnValue({ auth: mockAuth });

    render(<AuthDialog isOpen={true} onClose={mockOnClose} />);
    
    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'test@example.com' },
    });
    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'wrong' },
    });
    fireEvent.click(screen.getByText('Sign In'));

    await waitFor(() => {
      expect(screen.getByText('Incorrect password')).toBeInTheDocument();
    });
  });
});
```

**Acceptance criteria:**
- [ ] Dialog renders when `isOpen={true}`
- [ ] Google sign-in button triggers OAuth popup
- [ ] Email/password form validates input
- [ ] Error messages display for common auth errors
- [ ] Mode toggles between signin/signup
- [ ] Dialog closes on success
- [ ] All tests pass

---

### Unit 4: UserMenu Component

**Files created:**
- `app/_components/UserMenu.tsx`
- `app/_components/__tests__/UserMenu.test.tsx`

**Implementation: `app/_components/UserMenu.tsx`**

```typescript
'use client';

import { useState, useRef, useEffect } from 'react';
import { signOut } from 'firebase/auth';
import { getFirebase } from '@/lib/firebase/client';
import { useAuth } from '@/app/_providers/AuthProvider';

export function UserMenu() {
  const { user } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen]);

  if (!user) return null;

  const handleSignOut = async () => {
    try {
      // Revoke server session first
      await fetch('/api/auth/signout', { method: 'POST' });
      
      // Then sign out client-side
      const { auth } = getFirebase();
      await signOut(auth);
      
      setIsOpen(false);
    } catch (error) {
      console.error('Sign out failed:', error);
    }
  };

  const displayName = user.displayName || user.email?.split('@')[0] || 'User';
  const initials = displayName
    .split(' ')
    .map(n => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-3 py-2 rounded hover:bg-ui-surface transition-colors"
      >
        {user.photoURL ? (
          <img
            src={user.photoURL}
            alt={displayName}
            className="w-8 h-8 rounded-full"
          />
        ) : (
          <div className="w-8 h-8 rounded-full bg-accent flex items-center justify-center text-black text-sm font-semibold">
            {initials}
          </div>
        )}
        <span className="text-text-primary text-sm hidden sm:inline">
          {displayName}
        </span>
        <svg 
          className={`w-4 h-4 text-text-secondary transition-transform ${isOpen ? 'rotate-180' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-2 w-64 bg-ui-surface border border-ui-border rounded-lg shadow-panel overflow-hidden">
          <div className="px-4 py-3 border-b border-ui-border">
            <div className="text-text-primary text-sm font-medium">
              Signed in as
            </div>
            <div className="text-text-secondary text-sm truncate">
              {user.email}
            </div>
          </div>

          <div className="py-1">
            <button
              onClick={handleSignOut}
              className="w-full px-4 py-2 text-left text-sm text-text-primary hover:bg-ui-base transition-colors"
            >
              Sign Out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
```

**Test file: `app/_components/__tests__/UserMenu.test.tsx`**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { UserMenu } from '../UserMenu';
import { useAuth } from '@/app/_providers/AuthProvider';

vi.mock('@/app/_providers/AuthProvider');
vi.mock('@/lib/firebase/client');

describe('UserMenu', () => {
  const mockSignOut = vi.fn();
  
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn(() => Promise.resolve({ ok: true } as Response));
  });

  it('renders nothing when user is null', () => {
    (useAuth as any).mockReturnValue({ user: null, loading: false });
    const { container } = render(<UserMenu />);
    expect(container.firstChild).toBeNull();
  });

  it('renders user menu when user is signed in', () => {
    (useAuth as any).mockReturnValue({
      user: {
        displayName: 'Test User',
        email: 'test@example.com',
        photoURL: null,
      },
      loading: false,
    });

    render(<UserMenu />);
    expect(screen.getByText('Test User')).toBeInTheDocument();
  });

  it('shows dropdown when clicked', () => {
    (useAuth as any).mockReturnValue({
      user: {
        displayName: 'Test User',
        email: 'test@example.com',
        photoURL: null,
      },
      loading: false,
    });

    render(<UserMenu />);
    fireEvent.click(screen.getByText('Test User'));
    expect(screen.getByText('Signed in as')).toBeInTheDocument();
    expect(screen.getByText('test@example.com')).toBeInTheDocument();
  });

  it('calls sign out on button click', async () => {
    const mockAuth = { signOut: mockSignOut };
    const { getFirebase } = await import('@/lib/firebase/client');
    (getFirebase as any).mockReturnValue({ auth: mockAuth });

    (useAuth as any).mockReturnValue({
      user: {
        displayName: 'Test User',
        email: 'test@example.com',
      },
      loading: false,
    });

    render(<UserMenu />);
    fireEvent.click(screen.getByText('Test User'));
    fireEvent.click(screen.getByText('Sign Out'));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/auth/signout', {
        method: 'POST',
      });
      expect(mockSignOut).toHaveBeenCalled();
    });
  });

  it('displays initials when no photoURL', () => {
    (useAuth as any).mockReturnValue({
      user: {
        displayName: 'John Doe',
        email: 'john@example.com',
        photoURL: null,
      },
      loading: false,
    });

    render(<UserMenu />);
    expect(screen.getByText('JD')).toBeInTheDocument();
  });
});
```

**Acceptance criteria:**
- [ ] Menu renders when user is signed in
- [ ] Displays avatar (photoURL or initials)
- [ ] Dropdown opens on click
- [ ] Dropdown closes when clicking outside
- [ ] Sign out calls both routes (server + client)
- [ ] All tests pass

---

### Unit 5: Header Integration

**Files modified:**
- `app/_components/EditorHeader.tsx` (or create if doesn't exist)
- `app/editor/page.tsx`

**Implementation: `app/_components/EditorHeader.tsx`**

```typescript
'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/app/_providers/AuthProvider';
import { AuthDialog } from './AuthDialog';
import { UserMenu } from './UserMenu';

export function EditorHeader() {
  const { user, loading } = useAuth();
  const [showAuthDialog, setShowAuthDialog] = useState(false);

  return (
    <>
      <header className="fixed top-0 left-0 right-0 z-40 bg-ui-base border-b border-ui-border">
        <div className="flex items-center justify-between px-4 py-3">
          <Link 
            href="/"
            className="text-text-primary text-lg font-semibold hover:text-accent transition-colors"
          >
            Threditor
          </Link>

          <div>
            {loading ? (
              <div className="w-8 h-8 rounded-full bg-ui-surface animate-pulse" />
            ) : user ? (
              <UserMenu />
            ) : (
              <button
                onClick={() => setShowAuthDialog(true)}
                className="px-4 py-2 bg-accent hover:bg-accent-hover text-black rounded transition-colors text-sm font-medium"
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
```

**Integration in `app/editor/page.tsx`:**

```typescript
import { EditorHeader } from '../_components/EditorHeader';
import { Editor } from './_components/Editor';

export default function EditorPage() {
  return (
    <>
      <EditorHeader />
      <div className="pt-14"> {/* Offset for fixed header */}
        <Editor />
      </div>
    </>
  );
}
```

**Acceptance criteria:**
- [ ] Header shows "Sign In" button when signed out
- [ ] Header shows UserMenu when signed in
- [ ] Header shows loading skeleton during auth check
- [ ] AuthDialog opens when "Sign In" clicked
- [ ] Header is fixed at top with proper z-index

---

### Unit 6: AuthProvider PII Refinement (from M9 residual)

**Files modified:**
- `app/_providers/AuthProvider.tsx`

**Decision:** Keep full `User` object for now, defer narrowing to M13 when we need granular permissions.

**Rationale:**
- M10 only needs `uid`, `displayName`, `photoURL`, `email`
- M11 (publish) needs `email` for user verification
- M13 (profile) needs `email` for settings
- Narrowing now would require creating a second hook (`useFirebaseUser()`) immediately
- Better to narrow when we have a concrete "settings page needs email but shouldn't live in global context" use case

**Document the decision:**

```typescript
// app/_providers/AuthProvider.tsx

/**
 * NOTE: AuthProvider exposes the full Firebase User object, which includes PII
 * (email, phoneNumber, providerData). This is acceptable for M10-M12 where all
 * consuming components need this data. In M13 (profile/settings), consider
 * narrowing the context value to Pick<User, 'uid' | 'displayName' | 'photoURL'>
 * and creating a separate useFirebaseUser() hook for components that need email.
 * 
 * See: M9 COMPOUND §Gotchas for full discussion.
 */
```

**No code changes in Unit 6.** Just add the comment above the `AuthContext` declaration.

---

## 5. Testing Strategy

### 5.1 Unit tests

**Coverage targets:**
- API routes: 100% (critical auth path)
- AuthDialog: 90% (UI component, some edge cases hard to test)
- UserMenu: 90%
- Server helpers: 100%

**Test files:**
- `app/api/auth/__tests__/session.test.ts` (12 tests)
- `lib/firebase/__tests__/auth.test.ts` (8 tests)
- `app/_components/__tests__/AuthDialog.test.tsx` (10 tests)
- `app/_components/__tests__/UserMenu.test.tsx` (8 tests)

**Total new tests:** ~38 (+38 from M9's 579 = 617 total)

### 5.2 Integration tests

**Manual testing checklist:**

**Google OAuth flow:**
1. Click "Sign In" → AuthDialog opens
2. Click "Continue with Google" → Popup opens
3. Select Google account → Consent screen
4. Approve → Redirect back
5. AuthDialog closes, UserMenu appears
6. Refresh page → Still signed in (session cookie works)

**Email/Password flow:**
1. Click "Sign In" → AuthDialog opens
2. Click "Create one" → Mode switches to signup
3. Enter email + password → Click "Create Account"
4. AuthDialog closes, UserMenu appears
5. Sign out → "Sign In" button returns
6. Sign in with same credentials → Works

**Error handling:**
1. Enter invalid email → "Please enter a valid email address"
2. Enter wrong password → "Incorrect password"
3. Try to create account with existing email → "An account with this email already exists"
4. Close Google popup during auth → No error, returns to idle state

### 5.3 Regression testing

**Existing Phase 1 tests must pass:**
- 579 tests from M9 should all still pass
- No new failures introduced by auth UI

**Editor functionality unchanged:**
- Painting still works
- Tools still work
- Export still works
- Templates still work

---

## 6. Edge Cases & Gotchas

### 6.1 Session cookie httpOnly flag

**Issue:** Client JS cannot read httpOnly cookies.

**Implication:** Client-side code must use `useAuth()` (Firebase Auth state), not cookies, for UI decisions. Server components use cookies via `getServerSession()`.

**Correct pattern:**
```typescript
// Client component
'use client';
function MyComponent() {
  const { user } = useAuth();  // ✅ Uses Firebase Auth, not cookie
  return user ? <div>Signed in</div> : <div>Sign out</div>;
}

// Server component
async function MyServerComponent() {
  const session = await getServerSession();  // ✅ Reads cookie
  return session ? <div>Signed in</div> : <div>Signed out</div>;
}
```

### 6.2 Double auth state (Firebase + session cookie)

**Issue:** Firebase Auth and session cookie can desync if user revokes session on one device.

**Mitigation:**
- Server-side: `verifySessionCookie` with `checkRevoked: true`
- Sign out calls both `/api/auth/signout` (revokes cookie) AND `signOut(auth)` (clears Firebase state)
- If session verification fails, cookie is stale → return null

**Edge case:** User signs out on device A, but Firebase Auth on device B still has local state. Next page load on B will detect stale cookie and force re-auth.

### 6.3 Popup blockers

**Issue:** `signInWithPopup()` can be blocked by browser popup blockers if not triggered by direct user action.

**Mitigation:**
- Google button is a real `<button>`, not a div with onclick
- Click handler calls `signInWithPopup` immediately (no async delay)
- If popup is blocked, Firebase throws `auth/popup-blocked` → catch and show message: "Please allow popups for this site"

**Fallback:** Could add `signInWithRedirect()` as alternative, but redirect UX is worse (full page redirect vs popup). Defer to post-MVP if users complain.

### 6.4 Email verification

**Issue:** Firebase Auth doesn't require email verification by default.

**Decision for M10:** Don't enforce email verification.

**Rationale:**
- Friction during signup (user has to check email before first use)
- Verification emails often land in spam
- For MVP, email is just a login identifier, not a communication channel
- Can add verification later if spam accounts become an issue

**If adding later:**
```typescript
// After createUserWithEmailAndPassword
await sendEmailVerification(result.user);
```

### 6.5 Password reset

**Issue:** Users will forget passwords.

**Decision for M10:** Show "Forgot password?" link, but don't implement flow yet.

**Rationale:**
- Password reset requires email send + landing page for token verification
- Low priority for MVP (users can create new account with different email)
- Can add in M10.5 or M11 if demand is high

**If adding later:**
```typescript
await sendPasswordResetEmail(auth, email);
```

### 6.6 Session cookie TTL vs Firebase token expiry

**Issue:** Session cookies last 5 days, but Firebase ID tokens expire after 1 hour.

**Non-issue:** Session cookies are independent of ID tokens. As long as the session cookie is valid (verified with Admin SDK), the user stays authenticated server-side. Client-side, Firebase SDK auto-refreshes tokens.

**Edge case:** If user's refresh token is revoked (via Admin SDK), the session cookie is also invalidated on next verify (because `checkRevoked: true`).

---

## 7. Acceptance Criteria

**Code quality:**
- [ ] All TypeScript compiles with zero errors
- [ ] All new tests pass (38+ new tests)
- [ ] All existing Phase 1 + M9 tests still pass (579/579)
- [ ] No ESLint warnings introduced
- [ ] Bundle size under 390 kB First Load JS (+15 kB budget from M9's 375 kB)

**Functionality:**
- [ ] User can sign in with Google OAuth (3-click flow)
- [ ] User can sign in with Email/Password
- [ ] User can create account with Email/Password
- [ ] Session persists across page reload
- [ ] User can sign out (clears session cookie + Firebase state)
- [ ] Auth state visible in UI within 200ms of page load
- [ ] Error messages display for common auth errors
- [ ] UserMenu displays avatar or initials
- [ ] AuthDialog closes on successful auth

**User experience:**
- [ ] "Sign In" button visible in header when signed out
- [ ] UserMenu visible in header when signed in
- [ ] AuthDialog opens on "Sign In" click
- [ ] AuthDialog closes on X button
- [ ] Dropdown closes when clicking outside
- [ ] Loading states show during auth operations
- [ ] No visual flicker during auth state resolution

**Security:**
- [ ] Session cookies are httpOnly (not accessible to JS)
- [ ] Session cookies are secure in production (HTTPS only)
- [ ] Session cookies have sameSite: 'lax' (CSRF protection)
- [ ] Refresh tokens are revoked on sign out
- [ ] Invalid session cookies return null (no crash)

**Documentation:**
- [ ] COMPOUND.md entry created (after Review phase)
- [ ] PII exposure decision documented in AuthProvider
- [ ] All edge cases documented in this plan

**User impact:**
- [ ] Editor still loads and functions identically to M9
- [ ] Auth UI is additive (doesn't break existing features)
- [ ] No performance regression (FCP/LCP within 5% of M9)

---

## 8. Rollback Plan

**If M10 breaks Phase 1 or M9:**

1. Revert commits:
   ```bash
   git revert HEAD~6..HEAD  # Revert last 6 commits (Units 1-6)
   git push origin main
   ```

2. No dependency removal needed (all packages from M9)

3. Redeploy Vercel:
   ```bash
   vercel --prod
   ```

**Rollback triggers:**
- Phase 1 test suite failure rate > 5%
- M9 infrastructure broken (Firebase Auth throws errors)
- Bundle size increase > 50 kB
- Auth dialog blocks editor UI (modal z-index issue)
- Critical security issue (session fixation, XSS, etc.)

---

## 9. Post-Merge Validation

**After merge to `main`:**

1. Deploy to Vercel production
2. Test auth flows on production:
   - Sign in with Google
   - Sign in with Email/Password
   - Create new account
   - Sign out
   - Refresh page (session persistence)
3. Verify Firebase Console shows new user in Authentication
4. Check Vercel Analytics for any JS errors
5. Run Lighthouse audit (target: Performance score ≥ 90)

**Monitoring:**
- Firebase Console → Authentication → Users (check new sign-ups)
- Vercel Dashboard → Analytics → Errors (watch for auth failures)
- Browser DevTools → Network → Check session cookie is set

---

## 10. Dependencies for Next Milestones

**M11 (Skin Upload) depends on M10:**
- `useAuth()` hook to check if user is signed in
- `getServerSession()` for server-side upload route
- User's Firebase UID for Supabase storage path (`skins/{uid}/...`)
- Session cookie for authenticating server route requests

**M12 (Gallery) depends on M10:**
- `getServerSession()` for server-side like state
- User's UID to filter "skins I liked"
- Auth state for "Sign in to like" prompt

**M13 (Profile) depends on M10:**
- User's UID to query `/skins` where `ownerUid == uid`
- User's email/displayName for profile header
- Session authentication for `/u/[username]` route

**If M10 is incomplete:**
- M11 cannot authenticate uploads
- M12 cannot show personalized like state
- M13 cannot render user profiles

---

## 11. Time Estimate

**Per-unit estimates (solo dev):**
- Unit 0 (Dependencies check): 5 minutes
- Unit 1 (Session routes): 90 minutes
- Unit 2 (Server helper): 45 minutes
- Unit 3 (AuthDialog): 2 hours
- Unit 4 (UserMenu): 1 hour
- Unit 5 (Header integration): 30 minutes
- Unit 6 (PII refinement doc): 10 minutes

**Total work phase:** ~5 hours  
**Review phase:** ~1.5 hours  
**Compound phase:** ~30 minutes  
**Total M10:** ~7 hours

**Risks to timeline:**
- Google OAuth popup issues in dev: +30 minutes
- Session cookie SameSite quirks: +30 minutes
- AuthDialog styling iterations: +45 minutes
- UserMenu dropdown positioning: +15 minutes

**Worst-case estimate:** 9 hours

---

## 12. Recommended Reading Before Starting

**From M9 COMPOUND:**
- §Gotchas → Like-toggle transaction issue (affects future M12 work, not M10)
- §Gotchas → AuthProvider PII surface (addressed in Unit 6)
- §Invariants → `server-only` barrier (applies to Unit 1 API routes)
- §Recommended reading → Session cookie implementation notes

**From DESIGN.md:**
- §11.2 Server-side auth pattern (session cookies vs ID tokens)
- §12.5 M10 milestone overview (confirms this plan aligns with original spec)

**From M9 files:**
- `app/_providers/AuthProvider.tsx` — Already provides `{user, loading}` context
- `lib/firebase/admin.ts` — Already exposes `getAdminFirebase().auth`
- `lib/firebase/client.ts` — Already exposes `getFirebase().auth`

---

**Plan phase complete. Ready to proceed to Work phase?**
