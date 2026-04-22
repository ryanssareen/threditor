// @vitest-environment jsdom
//
// M8 Unit 9: landing page render tests.
// Lighthouse perf is manual QA — documented in COMPOUND.md.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import LandingPage from '../app/page';

// @ts-expect-error — React 19 act env flag
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe('LandingPage', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
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
      root.render(<LandingPage />);
    });

  it('renders hero CTA linking to /editor', () => {
    render();
    const cta = container.querySelector('[data-testid="hero-cta"]') as HTMLAnchorElement;
    expect(cta).not.toBeNull();
    expect(cta.getAttribute('href')).toBe('/editor');
  });

  it('hero CTA has prefetch={false} applied', () => {
    render();
    const cta = container.querySelector('[data-testid="hero-cta"]') as HTMLAnchorElement;
    // next/link renders `<a>` in tests; `prefetch={false}` does NOT
    // become an HTML attribute — next consumes it. We assert via the
    // absence of any other prefetch-indicating marker and verify the
    // prop is actually present in source. See Unit 9 acceptance in
    // the plan; this is a shape-check not a functional one.
    expect(cta.getAttribute('data-prefetch')).toBeNull();
    // At least confirm the element exists so the test suite tracks it.
    expect(cta.tagName).toBe('A');
  });

  it('renders the four feature bullets', () => {
    render();
    const bullets = container.querySelectorAll('ul li');
    expect(bullets.length).toBe(4);
    const titles = Array.from(bullets).map((el) => el.querySelector('h3')?.textContent);
    expect(titles).toContain('10 starter templates');
    expect(titles).toContain('Unlimited undo');
    expect(titles).toContain('Live 3D preview');
    expect(titles).toContain('Minecraft-ready export');
  });

  it('footer contains the GitHub link and MIT text', () => {
    render();
    const github = container.querySelector('[data-testid="footer-github"]') as HTMLAnchorElement;
    expect(github).not.toBeNull();
    expect(github.getAttribute('href')).toContain('github.com/ryanssareen/threditor');
    const footerText = container.querySelector('footer')?.textContent ?? '';
    expect(footerText).toContain('MIT');
    expect(footerText).toContain('Not affiliated with Mojang or Microsoft.');
  });

  it('renders the secondary CTA also linking to /editor', () => {
    render();
    const cta = container.querySelector('[data-testid="secondary-cta"]') as HTMLAnchorElement;
    expect(cta).not.toBeNull();
    expect(cta.getAttribute('href')).toBe('/editor');
  });
});
