import Link from 'next/link';

const FOOTER_LINKS = [
  { href: '/features', label: 'Features' },
  { href: '/contact', label: 'Contact' },
  { href: '/login', label: 'Log in' },
  { href: '/signup', label: 'Sign up' },
];

export default function LandingFooter() {
  return (
    <footer className="landing-footer">
      <div className="landing-container landing-footer__inner">
        <span>
          <a
            href="https://github.com/ryanssareen/threditor"
            target="_blank"
            rel="noreferrer"
            data-testid="footer-github"
          >
            ← threditor
          </a>{' '}
          · MIT
        </span>
        <nav aria-label="Footer">
          {FOOTER_LINKS.map(({ href, label }, i) => (
            <span key={href}>
              <Link href={href}>{label}</Link>
              {i < FOOTER_LINKS.length - 1 ? '  ·  ' : ''}
            </span>
          ))}
        </nav>
        <span>Not affiliated with Mojang or Microsoft.</span>
      </div>
    </footer>
  );
}
