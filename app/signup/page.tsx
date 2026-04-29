import type { Metadata } from 'next';
import Link from 'next/link';

import AuthForm from '@/app/_components/AuthForm';

export const metadata: Metadata = {
  title: 'Sign up — Threditor',
  description: 'Create a free Threditor account to save and publish your Minecraft skins.',
};

export default function SignupPage() {
  return (
    <div className="page" style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column' }}>
      <header className="auth-page-header">
        <Link href="/" className="landing-header__wordmark">
          threditor
        </Link>
        <span className="auth-page-header__aux">
          Already have an account? <Link href="/login">Log in →</Link>
        </span>
      </header>

      <div className="auth-shell">
        <aside className="auth-brand">
          <div className="auth-brand__top">
            <p className="auth-brand__eyebrow">Free forever</p>
            <p className="auth-brand__quote">
              Paint a skin in <span className="accent">seconds.</span>
            </p>
            <p className="auth-brand__sub">
              Sign up to save your skins, sync across devices, and publish to
              the gallery.
            </p>
          </div>
          <div className="auth-brand__bottom">
            <div className="auth-brand__stats">
              <div className="auth-stat">
                <span className="auth-stat__num">~3.8s</span>
                <span className="auth-stat__label">Median AI gen</span>
              </div>
              <div className="auth-stat">
                <span className="auth-stat__num">0$</span>
                <span className="auth-stat__label">Forever</span>
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
            <h1>Create your account</h1>
            <p className="auth-card__sub">
              Free forever. Already have an account?{' '}
              <Link href="/login">Log in</Link>
            </p>
            <AuthForm mode="signup" />
          </div>
        </main>
      </div>
    </div>
  );
}
