import HeroSection from './_components/LandingHero';
import LandingFooter from './_components/LandingFooter';
import LandingStrip from './_components/LandingStrip';
import MarketingHeader from './_components/MarketingHeader';

export default function LandingPage() {
  return (
    <>
      <MarketingHeader />
      <main>
        <HeroSection />
        <LandingStrip />
      </main>
      <LandingFooter />
    </>
  );
}
