import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { JetBrains_Mono } from 'next/font/google';
import { Providers } from '@/components/providers';
import { SessionGuard } from '@/components/session-guard';
import './globals.css';

// Una sola tipografía para toda la app (títulos incluidos) — monoespaciada
// tipo "dev tool", self-hosted por Next.js, sin request externo en cada
// visita.
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
      <body className={jetbrainsMono.variable}>
        {/* Aplica el tema guardado ANTES de que React hidrate, para que
            no haya un flash del tema oscuro por defecto en /login o
            /student si el usuario ya había elegido claro. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{if(localStorage.getItem('app-ure-theme')==='light'){document.documentElement.setAttribute('data-theme','light')}}catch(e){}",
          }}
        />
        <Providers>
          <SessionGuard />
          {children}
        </Providers>
      </body>
    </html>
  );
}
