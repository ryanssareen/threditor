import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Skin Editor',
  description: 'A free, open-source 3D Minecraft skin editor for the web.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="font-sans">{children}</body>
    </html>
  );
}
