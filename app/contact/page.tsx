import type { Metadata } from 'next';

import ContactPageBody from '@/app/_components/ContactPageBody';
import LandingFooter from '@/app/_components/LandingFooter';
import MarketingHeader from '@/app/_components/MarketingHeader';

export const metadata: Metadata = {
  title: 'Contact — Threditor',
  description:
    'Bug reports, feature ideas, partnerships. Real humans, replies usually within 48 hours.',
};

export default function ContactPage() {
  return (
    <>
      <MarketingHeader />
      <main>
        <section className="page-hero">
          <div className="landing-container page-hero__inner">
            <p className="section__eyebrow">Get in touch</p>
            <h1>
              Found a bug? Want a feature?{' '}
              <span className="accent">Tell us.</span>
            </h1>
            <p className="page-hero__lede">
              We read everything. Real humans, no support queue — replies
              usually within 48 hours.
            </p>
          </div>
        </section>
        <ContactPageBody />
      </main>
      <LandingFooter />
    </>
  );
}
