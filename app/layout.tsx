import type { Metadata } from 'next';
import { Geist, JetBrains_Mono } from 'next/font/google';
import './globals.css';

const geistSans = Geist({
  subsets: ['latin'],
  variable: '--font-geist',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-jetbrains-mono',
});

export const metadata: Metadata = {
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
        {children}
      </body>
    </html>
  );
}
