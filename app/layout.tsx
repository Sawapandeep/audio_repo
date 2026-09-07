import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'AudioDrop',
  description: 'A mobile-first audio downloader powered by yt-dlp.',
  applicationName: 'AudioDrop',

  icons: {
    icon: '/icons/audiodrop.svg',
    shortcut: '/icons/audiodrop.svg',
    apple: '/icons/audiodrop.svg',
  },
};

export const viewport: Viewport = {
  themeColor: '#090b10',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}