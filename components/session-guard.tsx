'use client';

import { useEffect } from 'react';
import { useSession, signOut } from 'next-auth/react';

/**
 * Componente invisible que fuerza el cierre de sesión en este dispositivo
 * cuando detecta que la cuenta inició sesión en otro lugar (sesión única).
 * NextAuth revalida la sesión al montar, al recuperar foco de la ventana
 * y periódicamente (SessionProvider), así que el aviso llega sin recargar
 * la página manualmente.
 */
export function SessionGuard() {
  const { data: session } = useSession();

  useEffect(() => {
    if (session?.error === 'SessionInvalidated') {
      signOut({
        callbackUrl: '/login?error=session-invalidated',
      });
    }
  }, [session]);

  return null;
}
