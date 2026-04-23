// @vitest-environment jsdom
//
// M9 Unit 7 — AuthProvider + useAuth.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the client SDK module so the provider can subscribe without
// actually calling Firebase. Drives the onAuthStateChanged callback
// from the test so we can observe the state transition.
let authCallback: ((user: { uid: string } | null) => void) | null = null;
const unsubscribe = vi.fn();

vi.mock('@/lib/firebase/client', () => ({
  getFirebase: () => ({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    auth: { __stub: true } as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    app: { __stub: true } as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    db: { __stub: true } as any,
  }),
}));

vi.mock('firebase/auth', () => ({
  onAuthStateChanged: (
    _auth: unknown,
    cb: (user: { uid: string } | null) => void,
  ) => {
    authCallback = cb;
    return unsubscribe;
  },
}));

import { AuthProvider, useAuth } from '../AuthProvider';

// @ts-expect-error — React 19 act env flag
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function Probe() {
  const { user, loading } = useAuth();
  return (
    <div>
      <span data-testid="loading">{loading ? 'loading' : 'ready'}</span>
      <span data-testid="user">{user === null ? 'signed-out' : user.uid}</span>
    </div>
  );
}

describe('AuthProvider', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    authCallback = null;
    unsubscribe.mockClear();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    document.body.removeChild(container);
  });

  const render = () =>
    act(() => {
      root.render(
        <AuthProvider>
          <Probe />
        </AuthProvider>,
      );
    });

  const $ = (id: string) =>
    container.querySelector(`[data-testid="${id}"]`) as HTMLElement;

  it('mounts in loading state (auth listener has not fired yet)', () => {
    render();
    expect($('loading').textContent).toBe('loading');
    expect($('user').textContent).toBe('signed-out');
  });

  it('transitions to ready / signed-out when onAuthStateChanged fires with null', () => {
    render();
    act(() => {
      authCallback?.(null);
    });
    expect($('loading').textContent).toBe('ready');
    expect($('user').textContent).toBe('signed-out');
  });

  it('exposes the authenticated user when onAuthStateChanged fires with a user object', () => {
    render();
    act(() => {
      authCallback?.({ uid: 'user-123' });
    });
    expect($('loading').textContent).toBe('ready');
    expect($('user').textContent).toBe('user-123');
  });

  it('unsubscribes the auth listener on unmount', () => {
    render();
    act(() => root.unmount());
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    // Re-mount happens in beforeEach of the next test; don't unmount
    // in afterEach too.
    root = createRoot(container);
  });

  it('useAuth throws when used outside AuthProvider', () => {
    let caught: unknown;
    const Orphan = () => {
      try {
        useAuth();
      } catch (e) {
        caught = e;
      }
      return null;
    };
    act(() => {
      root.render(<Orphan />);
    });
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toMatch(/AuthProvider/);
  });
});
