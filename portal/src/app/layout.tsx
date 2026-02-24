import type { Metadata, Viewport } from 'next';
import './globals.css';
import { Providers } from './providers';

export const metadata: Metadata = {
  title:       'Operation Ghost — Mission Control Center',
  description: 'Command. Automate. Dominate. — Ghost AI System by Terry',
  keywords:    ['Ghost', 'AI', 'Mission Control', 'Discord Bot', 'Automation'],
  authors:     [{ name: 'Terry' }],
};

export const viewport: Viewport = {
  width:        'device-width',
  initialScale: 1,
  themeColor:   '#050A14',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      </head>
      <body className="bg-ghost-bg text-ghost-text antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
