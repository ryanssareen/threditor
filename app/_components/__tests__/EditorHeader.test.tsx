// @vitest-environment jsdom
//
// M10 Unit 5 — EditorHeader integration tests.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const useAuthMock = vi.hoisted(() => vi.fn());

vi.mock('@/app/_providers/AuthProvider', () => ({
  useAuth: useAuthMock,
}));

// Mock children so this test doesn't pull Firebase into the render tree.
vi.mock('../AuthDialog', () => ({
  AuthDialog: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? <div data-testid="auth-dialog-stub" /> : null,
}));

vi.mock('../UserMenu', () => ({
  UserMenu: () => <div data-testid="user-menu-stub" />,
}));

import { EditorHeader } from '../EditorHeader';

// @ts-expect-error — React 19 act env flag
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe('EditorHeader', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.clearAllMocks();
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
      root.render(<EditorHeader />);
    });

  const $ = (testid: string): HTMLElement | null =>
    document.querySelector(`[data-testid="${testid}"]`);

  it('shows loading skeleton when auth is pending', () => {
    useAuthMock.mockReturnValue({ user: null, loading: true });
    render();
    expect($('editor-header-loading')).not.toBeNull();
    expect($('editor-header-sign-in')).toBeNull();
    expect($('user-menu-stub')).toBeNull();
  });

  it('shows Sign In button when signed out', () => {
    useAuthMock.mockReturnValue({ user: null, loading: false });
    render();
    expect($('editor-header-sign-in')).not.toBeNull();
    expect($('user-menu-stub')).toBeNull();
  });

  it('shows UserMenu when signed in', () => {
    useAuthMock.mockReturnValue({
      user: { uid: 'u1', email: 'a@b.c', displayName: 'A', photoURL: null },
      loading: false,
    });
    render();
    expect($('user-menu-stub')).not.toBeNull();
    expect($('editor-header-sign-in')).toBeNull();
  });

  it('Sign In click opens AuthDialog', () => {
    useAuthMock.mockReturnValue({ user: null, loading: false });
    render();
    expect($('auth-dialog-stub')).toBeNull();
    act(() => {
      ($('editor-header-sign-in') as HTMLButtonElement).click();
    });
    expect($('auth-dialog-stub')).not.toBeNull();
  });

  it('home link targets /', () => {
    useAuthMock.mockReturnValue({ user: null, loading: false });
    render();
    expect(
      ($('editor-header-home') as HTMLAnchorElement).getAttribute('href'),
    ).toBe('/');
  });
});
