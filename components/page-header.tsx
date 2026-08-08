'use client';

import { signOut } from 'next-auth/react';
import { LogoutIcon } from './icons';

/**
 * Barra superior común a /student y las pantallas de /admin: cerrar
 * sesión a la izquierda, avatar con la inicial del correo a la derecha.
 * Reemplaza el "Sesión: correo@..." + botón de cerrar sesión sueltos al
 * final de cada página.
 */
export function PageHeader({ email }: { email?: string | null }) {
  const initial = email?.trim().charAt(0).toUpperCase() || '?';

  return (
    <div className="page-header">
      <button
        type="button"
        className="icon-btn"
        onClick={() => signOut({ callbackUrl: '/login' })}
        aria-label="Cerrar sesión"
        title="Cerrar sesión"
      >
        <LogoutIcon />
      </button>
      <div className="user-avatar" title={email ?? undefined}>
        {initial}
      </div>
    </div>
  );
}
