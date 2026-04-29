'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const NAV_LINKS = [
  { href: '/features', label: 'Features' },
  { href: '/contact', label: 'Contact' },
] as const;

export default function MarketingHeader() {
  const pathname = usePathname() ?? '';

  return (
    <header className="landing-header">
      <div className="landing-container landing-header__inner">
        <Link href="/" className="landing-header__wordmark">
          threditor
        </Link>
        <nav className="landing-header__nav" aria-label="Primary">
          {NAV_LINKS.map(({ href, label }) => {
            const active = pathname === href;
            return (
              <Link
                key={href}
                href={href}
                className="landing-header__link"
                style={active ? { color: 'var(--color-text-primary)' } : undefined}
                aria-current={active ? 'page' : undefined}
              >
                {label}
              </Link>
            );
          })}
        </nav>
        <div className="landing-header__cta">
          <Link href="/login" className="btn btn-ghost">
            Log in
          </Link>
          <Link href="/signup" className="btn btn-primary">
            Sign up free
          </Link>
        </div>
      </div>
    </header>
  );
}
