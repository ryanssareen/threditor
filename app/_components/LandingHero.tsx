'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

const PROMPTS: ReadonlyArray<string> = [
  'forest knight, leather armor, mossy green',
  'redstone wizard, glowing staff, dark robes',
  'lava golem, cracked obsidian skin',
  'snow-pirate captain, frosted tricorn',
  'cyber-shogun, neon trim, charcoal kimono',
];

const ROTATE_MS = 2800;
const FADE_MS = 200;

export default function LandingHero() {
  const [index, setIndex] = useState(0);
  const [fading, setFading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const id = window.setInterval(() => {
      if (cancelled) return;
      setFading(true);
      window.setTimeout(() => {
        if (cancelled) return;
        setIndex((i) => (i + 1) % PROMPTS.length);
        setFading(false);
      }, FADE_MS);
    }, ROTATE_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  return (
    <section className="hero" id="top">
      <div className="landing-container hero__grid">
        <div>
          <p className="hero__eyebrow">
            Powered by Groq + Cloudflare Workers AI
          </p>
          <h1 className="hero__title">
            Type a prompt. Get a{' '}
            <span className="hero__title-accent">Minecraft skin</span> in
            seconds.
          </h1>
          <p className="hero__subtitle">
            A free, open-source 3D skin editor with native AI generation.
            Describe what you want — a forest knight, a glow-in-the-dark
            astronaut, a redstone wizard — and we paint a 64×64 atlas you can
            keep editing by hand.
          </p>
          <div className="hero__ctas">
            <Link
              href="/editor"
              prefetch={false}
              className="btn btn-primary btn-lg"
              data-testid="hero-cta"
            >
              Open the editor →
            </Link>
            <Link href="/features" className="btn btn-ghost btn-lg">
              See features
            </Link>
          </div>
          <p className="hero__meta">
            MIT licensed · No account required to paint · &lt; 4 s p50
            generation
          </p>
        </div>

        <div className="hero__stage" aria-hidden="true">
          <div className="hero__stage-inner">
            <SteveSvg />
          </div>
          <div className="hero__stage-prompt">
            <span className="hero__stage-pulse" />
            <span className="hero__stage-prompt-label">Live</span>
            <span
              className="hero__stage-prompt-text"
              data-fading={fading ? 'true' : 'false'}
            >
              {PROMPTS[index]}
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}

function SteveSvg() {
  return (
    <svg
      className="hero__steve"
      viewBox="0 0 80 100"
      xmlns="http://www.w3.org/2000/svg"
      shapeRendering="crispEdges"
      role="img"
      aria-label="Pixel character preview"
    >
      <rect x="24" y="6" width="32" height="32" fill="#6b3a1e" stroke="#262626" />
      <rect x="30" y="16" width="6" height="4" fill="#ffffff" />
      <rect x="44" y="16" width="6" height="4" fill="#ffffff" />
      <rect x="32" y="17" width="3" height="3" fill="#3366cc" />
      <rect x="46" y="17" width="3" height="3" fill="#3366cc" />
      <rect x="34" y="26" width="12" height="4" fill="#3a1f10" />
      <rect x="20" y="38" width="40" height="36" fill="#4a7a32" stroke="#262626" />
      <rect x="36" y="46" width="8" height="4" fill="#3a6228" />
      <rect x="6" y="40" width="14" height="32" fill="#6b3a1e" stroke="#262626" />
      <rect x="60" y="40" width="14" height="32" fill="#6b3a1e" stroke="#262626" />
      <rect x="20" y="74" width="18" height="22" fill="#3a4ce0" stroke="#262626" />
      <rect x="42" y="74" width="18" height="22" fill="#3a4ce0" stroke="#262626" />
    </svg>
  );
}
