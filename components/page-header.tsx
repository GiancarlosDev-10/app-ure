'use client';

import { signOut } from 'next-auth/react';
import { LogoutIcon } from './icons';
import { ThemeToggle } from './theme-toggle';

/**
 * Barra superior común a /student y las pantallas de /admin: cerrar
 * sesión a la izquierda, avatar con la inicial del correo a la derecha.
 * Reemplaza el "Sesión: correo@..." + botón de cerrar sesión sueltos al
 * final de cada página.
 *
 * `showThemeToggle` solo lo pasa /student — el panel de admin se queda
 * fijo en oscuro por ahora.
 */
export function PageHeader({
  email,
  showThemeToggle = false,
}: {
  email?: string | null;
  showThemeToggle?: boolean;
}) {
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
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
        {showThemeToggle && <ThemeToggle />}
        <div className="user-avatar" title={email ?? undefined}>
          {initial}
        </div>
      </div>
    </div>
  );
}
