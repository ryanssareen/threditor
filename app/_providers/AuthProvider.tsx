'use client';

/**
 * M9 Unit 7: Firebase Auth context provider.
 *
 * Subscribes to `onAuthStateChanged` once (on mount) and exposes the
 * current user + loading flag via `useAuth()`. Consumers should:
 *   - render a skeleton / spinner while `loading === true`;
 *   - render a sign-in prompt when `user === null` after load;
 *   - render the authenticated UI when `user !== null`.
 *
 * The listener is cleaned up on unmount (React's unsubscribe return).
 * Multiple mounts cost one listener per mount — acceptable because
 * the only caller is the root layout.
 */

import {
  onAuthStateChanged,
  type User,
} from 'firebase/auth';
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';

import { getFirebase } from '@/lib/firebase/client';

type AuthContextValue = {
  user: User | null;
  loading: boolean;
};

// Sentinel context value. `useAuth()` throws if the sentinel is still
// the returned value (i.e., the hook was called outside the provider
// tree). Using `null` as the initial context so the identity check is
// reliable — a default `{ user: null, loading: true }` value would
// silently swallow the error.
//
// PII NOTE (M9 security review, decided M10 Unit 6):
// AuthContextValue.user is the full Firebase `User`, which includes
// email, phoneNumber, providerData, and per-provider UIDs. This is
// acceptable for M10-M12 — every consuming component legitimately
// needs uid (M10 UserMenu), email (M11 publish path, M13 settings),
// or displayName/photoURL (M10 avatar). Narrowing to
// `Pick<User, 'uid' | 'displayName' | 'photoURL'>` now would force
// a second hook `useFirebaseUser()` just for email, which adds surface
// without solving a real leak. Revisit in M13 when we have a concrete
// "settings page needs email but shouldn't live in global context"
// requirement. See docs/COMPOUND.md §M9 Gotchas for full discussion.
const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Init + subscribe wrapped in try so a misconfigured Firebase
    // project (missing env var, malformed apiKey, etc.) degrades to
    // "signed-out" instead of hanging the UI on `loading: true`
    // forever. onAuthStateChanged itself does not throw in normal
    // flows; getFirebase() throws on bad config.
    let unsubscribe: (() => void) | undefined;
    try {
      const { auth } = getFirebase();
      unsubscribe = onAuthStateChanged(auth, (next) => {
        setUser(next);
        setLoading(false);
      });
    } catch (err) {
      console.error('AuthProvider: Firebase init failed — app will render as signed-out.', err);
      setUser(null);
      setLoading(false);
    }
    return () => {
      unsubscribe?.();
    };
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (ctx === null) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return ctx;
}
