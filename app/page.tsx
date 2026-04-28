import Header from './_components/LandingHeader';
import HeroSection from './_components/LandingHero';
import FeaturesSection from './_components/LandingFeatures';
import DemoSection from './_components/LandingDemo';
import ContactSection from './_components/LandingContact';
import LandingFooter from './_components/LandingFooter';

export default function LandingPage() {
  return (
    <>
      <Header />
      <main>
        <HeroSection />
        <FeaturesSection />
        <DemoSection />
        <ContactSection />
      </main>
      <LandingFooter />
    </>
  );
}
