'use client';

import Link from 'next/link';

export default function LandingHeader() {
  return (
    <header className="landing-header">
      <div className="landing-container landing-header__inner">
        <Link href="/" className="landing-header__wordmark">
          threditor
        </Link>
        <nav className="landing-header__nav" aria-label="Primary">
          <a href="#features" className="landing-header__link">
            Features
          </a>
          <a href="#how" className="landing-header__link">
            How it works
          </a>
          <a href="#contact" className="landing-header__link">
            Contact
          </a>
        </nav>
        <div className="landing-header__cta">
          <a href="#contact" className="btn btn-ghost">
            Talk to us
          </a>
          <Link href="/editor" className="btn btn-primary">
            Open the editor
          </Link>
        </div>
      </div>
    </header>
  );
}
