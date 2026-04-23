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
