// @vitest-environment jsdom
//
// M10 Unit 3 — AuthDialog tests.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mocks must be declared before importing the component under test.
const firebaseAuthMocks = vi.hoisted(() => ({
  signInWithPopup: vi.fn(),
  signInWithEmailAndPassword: vi.fn(),
  createUserWithEmailAndPassword: vi.fn(),
  GoogleAuthProvider: vi.fn().mockImplementation(() => ({})),
}));

vi.mock('firebase/auth', () => firebaseAuthMocks);

vi.mock('@/lib/firebase/client', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getFirebase: () => ({ auth: { __stub: true } as any }),
}));

import { AuthDialog } from '../AuthDialog';

// @ts-expect-error — React 19 act env flag
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe('AuthDialog', () => {
  let container: HTMLDivElement;
  let root: Root;
  let fetchMock: ReturnType<typeof vi.fn>;

  const makeUser = (overrides: Record<string, unknown> = {}) => ({
    user: {
      getIdToken: vi.fn().mockResolvedValue('stub-id-token'),
      uid: 'user-123',
      ...overrides,
    },
  });

  beforeEach(() => {
    vi.clearAllMocks();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    act(() => root.unmount());
    document.body.removeChild(container);
    vi.unstubAllGlobals();
  });

  const render = (isOpen: boolean, onClose = vi.fn()) => {
    act(() => {
      root.render(<AuthDialog isOpen={isOpen} onClose={onClose} />);
    });
    return onClose;
  };

  const $ = (testid: string): HTMLElement | null =>
    document.querySelector(`[data-testid="${testid}"]`);

  it('does not render when isOpen=false', () => {
    render(false);
    expect($('auth-dialog')).toBeNull();
  });

  it('renders when isOpen=true', () => {
    render(true);
    expect($('auth-dialog')).not.toBeNull();
    expect(document.getElementById('auth-dialog-title')?.textContent).toBe(
      'Sign in to Threditor',
    );
  });

  it('close button invokes onClose', () => {
    const onClose = render(true);
    act(() => {
      ($('auth-dialog-close') as HTMLButtonElement).click();
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('backdrop click invokes onClose', () => {
    const onClose = render(true);
    act(() => {
      ($('auth-dialog-backdrop') as HTMLElement).click();
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('toggles between signin and signup modes', () => {
    render(true);
    expect(document.getElementById('auth-dialog-title')?.textContent).toBe(
      'Sign in to Threditor',
    );
    act(() => {
      ($('auth-dialog-switch-signup') as HTMLButtonElement).click();
    });
    expect(document.getElementById('auth-dialog-title')?.textContent).toBe(
      'Create an account',
    );
    act(() => {
      ($('auth-dialog-switch-signin') as HTMLButtonElement).click();
    });
    expect(document.getElementById('auth-dialog-title')?.textContent).toBe(
      'Sign in to Threditor',
    );
  });

  it('email sign-in happy path: calls Firebase, posts session cookie, closes', async () => {
    firebaseAuthMocks.signInWithEmailAndPassword.mockResolvedValue(makeUser());
    const onClose = render(true);

    // Use the real HTMLInputElement setter pattern to trigger React's
    // synthetic onChange (plain .value assignment doesn't).
    const emailInput = $('auth-dialog-email') as HTMLInputElement;
    const passwordInput = $('auth-dialog-password') as HTMLInputElement;
    act(() => {
      const nativeSetter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      )?.set;
      nativeSetter?.call(emailInput, 'alice@example.com');
      emailInput.dispatchEvent(new Event('input', { bubbles: true }));
      nativeSetter?.call(passwordInput, 'correct-horse');
      passwordInput.dispatchEvent(new Event('input', { bubbles: true }));
    });

    await act(async () => {
      ($('auth-dialog-submit') as HTMLButtonElement).click();
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(firebaseAuthMocks.signInWithEmailAndPassword).toHaveBeenCalledWith(
      expect.anything(),
      'alice@example.com',
      'correct-horse',
    );
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/auth/session',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ idToken: 'stub-id-token' }),
      }),
    );
    // onClose fires after the 500ms success delay.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 550));
    });
    expect(onClose).toHaveBeenCalled();
  });

  it('email signup path uses createUserWithEmailAndPassword', async () => {
    firebaseAuthMocks.createUserWithEmailAndPassword.mockResolvedValue(
      makeUser(),
    );
    render(true);
    act(() => {
      ($('auth-dialog-switch-signup') as HTMLButtonElement).click();
    });
    const emailInput = $('auth-dialog-email') as HTMLInputElement;
    const passwordInput = $('auth-dialog-password') as HTMLInputElement;
    const nativeSetter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )?.set;
    act(() => {
      nativeSetter?.call(emailInput, 'new@example.com');
      emailInput.dispatchEvent(new Event('input', { bubbles: true }));
      nativeSetter?.call(passwordInput, 'hunter2hunter2');
      passwordInput.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      ($('auth-dialog-submit') as HTMLButtonElement).click();
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(firebaseAuthMocks.createUserWithEmailAndPassword).toHaveBeenCalled();
    expect(firebaseAuthMocks.signInWithEmailAndPassword).not.toHaveBeenCalled();
  });

  // Helper: fill email + password before submit so the form's
  // `required` HTML validation doesn't block the submit path.
  const fillCredentials = (emailVal = 'x@example.com', pwVal = 'hunter2') => {
    const nativeSetter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )?.set;
    const e = $('auth-dialog-email') as HTMLInputElement;
    const p = $('auth-dialog-password') as HTMLInputElement;
    act(() => {
      nativeSetter?.call(e, emailVal);
      e.dispatchEvent(new Event('input', { bubbles: true }));
      nativeSetter?.call(p, pwVal);
      p.dispatchEvent(new Event('input', { bubbles: true }));
    });
  };

  it('displays known error message for auth/wrong-password', async () => {
    firebaseAuthMocks.signInWithEmailAndPassword.mockRejectedValue({
      code: 'auth/wrong-password',
    });
    render(true);
    fillCredentials();
    await act(async () => {
      ($('auth-dialog-submit') as HTMLButtonElement).click();
      await new Promise((r) => setTimeout(r, 0));
    });
    expect($('auth-dialog-error')?.textContent).toBe('Incorrect password');
  });

  it('displays generic fallback for unknown error codes', async () => {
    firebaseAuthMocks.signInWithEmailAndPassword.mockRejectedValue({
      code: 'auth/something-weird',
    });
    render(true);
    fillCredentials();
    await act(async () => {
      ($('auth-dialog-submit') as HTMLButtonElement).click();
      await new Promise((r) => setTimeout(r, 0));
    });
    expect($('auth-dialog-error')?.textContent).toBe('Authentication failed');
  });

  it('silently returns to idle on auth/popup-closed-by-user', async () => {
    firebaseAuthMocks.signInWithPopup.mockRejectedValue({
      code: 'auth/popup-closed-by-user',
    });
    render(true);
    await act(async () => {
      ($('auth-dialog-google') as HTMLButtonElement).click();
      await new Promise((r) => setTimeout(r, 0));
    });
    expect($('auth-dialog-error')).toBeNull();
  });

  it('shows error when /api/auth/session POST fails', async () => {
    firebaseAuthMocks.signInWithEmailAndPassword.mockResolvedValue(makeUser());
    fetchMock.mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: 'Authentication failed' }),
    });
    render(true);
    fillCredentials();
    await act(async () => {
      ($('auth-dialog-submit') as HTMLButtonElement).click();
      await new Promise((r) => setTimeout(r, 0));
    });
    expect($('auth-dialog-error')?.textContent).toBe('Authentication failed');
  });

  it('Google sign-in happy path: calls signInWithPopup and posts session cookie', async () => {
    firebaseAuthMocks.signInWithPopup.mockResolvedValue(makeUser());
    render(true);
    await act(async () => {
      ($('auth-dialog-google') as HTMLButtonElement).click();
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(firebaseAuthMocks.signInWithPopup).toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/session', expect.any(Object));
  });
});
