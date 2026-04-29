import type { Metadata } from 'next';
import Link from 'next/link';

import AuthForm from '@/app/_components/AuthForm';

export const metadata: Metadata = {
  title: 'Log in — Threditor',
  description: 'Log in to access your saved Minecraft skins.',
};

export default function LoginPage() {
  return (
    <div className="page" style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column' }}>
      <header className="auth-page-header">
        <Link href="/" className="landing-header__wordmark">
          threditor
        </Link>
        <span className="auth-page-header__aux">
          No account? <Link href="/signup">Sign up free →</Link>
        </span>
      </header>

      <div className="auth-shell">
        <aside className="auth-brand">
          <div className="auth-brand__top">
            <p className="auth-brand__eyebrow">Welcome back</p>
            <p className="auth-brand__quote">
              Your skins are <span className="accent">waiting for you.</span>
            </p>
            <p className="auth-brand__sub">
              Pick up right where you left off. All your layers, history and
              exports stay intact.
            </p>
          </div>
          <div className="auth-brand__bottom">
            <div className="auth-brand__stats">
              <div className="auth-stat">
                <span className="auth-stat__num">∞</span>
                <span className="auth-stat__label">Undo steps</span>
              </div>
              <div className="auth-stat">
                <span className="auth-stat__num">64×64</span>
                <span className="auth-stat__label">Atlas size</span>
              </div>
              <div className="auth-stat">
                <span className="auth-stat__num">MIT</span>
                <span className="auth-stat__label">Open source</span>
              </div>
            </div>
          </div>
        </aside>

        <main className="auth-form-panel">
          <div className="auth-card">
            <h1>Welcome back</h1>
            <p className="auth-card__sub">
              Log in to access your saved skins. Don&apos;t have an account?{' '}
              <Link href="/signup">Sign up free</Link>
            </p>
            <AuthForm mode="signin" />
          </div>
        </main>
      </div>
    </div>
  );
}
