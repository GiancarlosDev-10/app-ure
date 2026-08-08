import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { Inter, JetBrains_Mono } from 'next/font/google';
import { Providers } from '@/components/providers';
import { SessionGuard } from '@/components/session-guard';
import './globals.css';

// Inter: la sans-serif del mockup de referencia (portal DIGPE) — se usa
// solo en los h1 (ver globals.css). JetBrains Mono: la monoespaciada
// tipo "dev tool" para el resto del cuerpo. Las dos self-hosted por
// Next.js, sin request externo en cada visita.
const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });
const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  display: 'swap',
});

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
      <body className={`${inter.variable} ${jetbrainsMono.variable}`}>
        <Providers>
          <SessionGuard />
          {children}
        </Providers>
      </body>
    </html>
  );
}
