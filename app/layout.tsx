import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { Providers } from './providers';
import { SessionGuard } from './session-guard';
import './globals.css';

export const metadata: Metadata = {
  title: 'App URE — Estudio',
  description: 'PWA de estudio con preguntas generadas por IA a partir de material asignado.',
  manifest: '/manifest.json',
  icons: {
    icon: '/favicon-32.png',
    apple: '/icons/apple-touch-icon.png',
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'App URE',
  },
};

export const viewport: Viewport = {
  themeColor: '#0b1020',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es">
      <body>
        <Providers>
          <SessionGuard />
          {children}
        </Providers>
      </body>
    </html>
  );
}
