import type { Metadata } from 'next';
import { Geist, JetBrains_Mono } from 'next/font/google';
import './globals.css';
import { AuthProvider } from './_providers/AuthProvider';
import { SITE_ORIGIN } from '@/lib/seo/site';

const geistSans = Geist({
  subsets: ['latin'],
  variable: '--font-geist',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-jetbrains-mono',
});

export const metadata: Metadata = {
  // M14: metadataBase lets child routes emit relative image URLs that
  // Next.js resolves against the canonical origin. Without it Next logs
  // a warning and may silently produce preview-deploy subdomain URLs in
  // OG cards, which then get cached by social platforms for 7–30 days.
  metadataBase: new URL(SITE_ORIGIN),
  title: {
    default: 'threditor — 3D Minecraft skin editor',
    template: '%s · threditor',
  },
  description:
    'A free, open-source 3D Minecraft skin editor for the web. Paint, preview on a live 3D model, and export a Minecraft-ready PNG.',
  openGraph: {
    title: 'threditor — 3D Minecraft skin editor',
    description:
      'Paint Minecraft skins with a live 3D preview. Templates, layers, undo, and export. Free and open-source.',
    type: 'website',
  },
  robots: { index: true, follow: true },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${jetbrainsMono.variable} font-sans antialiased`}>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
