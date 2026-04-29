import type { Metadata } from 'next';

import LandingFeatures from '@/app/_components/LandingFeatures';
import LandingFooter from '@/app/_components/LandingFooter';
import MarketingHeader from '@/app/_components/MarketingHeader';

export const metadata: Metadata = {
  title: 'Features — Threditor',
  description:
    'Six things that make threditor different — sub-4s AI generation, live 3D preview, unlimited undo, free forever.',
};

export default function FeaturesPage() {
  return (
    <>
      <MarketingHeader />
      <main>
        <section className="page-hero">
          <div className="landing-container page-hero__inner">
            <p className="section__eyebrow">What you get</p>
            <h1>
              Built for Minecraft skin makers,{' '}
              <span className="accent">not for AI demos.</span>
            </h1>
            <p className="page-hero__lede">
              Most browser skin editors are either fast or good. We chose both —
              by spending the AI budget on quality and the engineering budget on
              the paint loop.
            </p>
          </div>
        </section>
        <div className="features-page">
          <LandingFeatures />
        </div>
      </main>
      <LandingFooter />
    </>
  );
}
