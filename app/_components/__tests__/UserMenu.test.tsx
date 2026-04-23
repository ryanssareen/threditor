// @vitest-environment jsdom
//
// M10 Unit 4 — UserMenu tests.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const firebaseAuthMocks = vi.hoisted(() => ({
  signOut: vi.fn().mockResolvedValue(undefined),
}));
const useAuthMock = vi.hoisted(() => vi.fn());

vi.mock('firebase/auth', () => firebaseAuthMocks);

vi.mock('@/lib/firebase/client', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getFirebase: () => ({ auth: { __stub: true } as any }),
}));

vi.mock('@/app/_providers/AuthProvider', () => ({
  useAuth: useAuthMock,
}));

import { UserMenu } from '../UserMenu';

// @ts-expect-error — React 19 act env flag
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe('UserMenu', () => {
  let container: HTMLDivElement;
  let root: Root;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    act(() => root.unmount());
    document.body.removeChild(container);
    vi.unstubAllGlobals();
  });

  const render = () =>
    act(() => {
      root.render(<UserMenu />);
    });

  const $ = (testid: string): HTMLElement | null =>
    document.querySelector(`[data-testid="${testid}"]`);

  it('renders nothing when user is null', () => {
    useAuthMock.mockReturnValue({ user: null, loading: false });
    render();
    expect(container.firstChild).toBeNull();
  });

  it('renders trigger when user is signed in', () => {
    useAuthMock.mockReturnValue({
      user: {
        displayName: 'Alice Liddell',
        email: 'alice@example.com',
        photoURL: null,
      },
      loading: false,
    });
    render();
    expect($('user-menu-trigger')).not.toBeNull();
    expect(
      (document.querySelector('.sm\\:inline') as HTMLElement)?.textContent,
    ).toBe('Alice Liddell');
  });

  it('renders initials when photoURL is null', () => {
    useAuthMock.mockReturnValue({
      user: { displayName: 'John Doe', email: 'j@x.com', photoURL: null },
      loading: false,
    });
    render();
    // Initials render in the fallback avatar div.
    expect(container.textContent).toContain('JD');
  });

  it('falls back to email-local-part when displayName is missing', () => {
    useAuthMock.mockReturnValue({
      user: { displayName: null, email: 'bob@acme.com', photoURL: null },
      loading: false,
    });
    render();
    // Initials of "bob" → "B".
    expect(container.textContent).toContain('B');
  });

  it('dropdown opens on trigger click and shows email', () => {
    useAuthMock.mockReturnValue({
      user: { displayName: 'Alice', email: 'alice@example.com', photoURL: null },
      loading: false,
    });
    render();
    expect($('user-menu-dropdown')).toBeNull();
    act(() => {
      ($('user-menu-trigger') as HTMLButtonElement).click();
    });
    expect($('user-menu-dropdown')).not.toBeNull();
    expect($('user-menu-email')?.textContent).toBe('alice@example.com');
  });

  it('dropdown closes when clicking outside', () => {
    useAuthMock.mockReturnValue({
      user: { displayName: 'Alice', email: 'a@x.com', photoURL: null },
      loading: false,
    });
    render();
    act(() => {
      ($('user-menu-trigger') as HTMLButtonElement).click();
    });
    expect($('user-menu-dropdown')).not.toBeNull();
    act(() => {
      document.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });
    expect($('user-menu-dropdown')).toBeNull();
  });

  it('sign-out button calls /api/auth/signout and firebase signOut', async () => {
    useAuthMock.mockReturnValue({
      user: { displayName: 'Alice', email: 'a@x.com', photoURL: null },
      loading: false,
    });
    render();
    act(() => {
      ($('user-menu-trigger') as HTMLButtonElement).click();
    });
    await act(async () => {
      ($('user-menu-sign-out') as HTMLButtonElement).click();
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/signout', {
      method: 'POST',
    });
    expect(firebaseAuthMocks.signOut).toHaveBeenCalled();
  });

  it('sign-out still runs firebase signOut even when /api/auth/signout fetch rejects', async () => {
    useAuthMock.mockReturnValue({
      user: { displayName: 'Alice', email: 'a@x.com', photoURL: null },
      loading: false,
    });
    fetchMock.mockRejectedValue(new Error('network down'));
    render();
    act(() => {
      ($('user-menu-trigger') as HTMLButtonElement).click();
    });
    await act(async () => {
      ($('user-menu-sign-out') as HTMLButtonElement).click();
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(firebaseAuthMocks.signOut).toHaveBeenCalled();
  });

  it('displays photoURL img when provided', () => {
    useAuthMock.mockReturnValue({
      user: {
        displayName: 'Alice',
        email: 'a@x.com',
        photoURL: 'https://example.com/alice.jpg',
      },
      loading: false,
    });
    render();
    const img = container.querySelector('img');
    expect(img?.getAttribute('src')).toBe('https://example.com/alice.jpg');
  });
});
