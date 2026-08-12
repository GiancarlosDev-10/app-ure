'use client';

import { signOut } from 'next-auth/react';
import { ArrowLeftIcon, LogoutIcon } from './icons';
import { ThemeToggle } from './theme-toggle';

/**
 * Barra superior común a /student y las pantallas de /admin: ícono de
 * salir a la izquierda, avatar con la inicial del correo a la derecha.
 *
 * Ese ícono es contextual cuando se pasa `onBack`: en vez de cerrar
 * sesión, vuelve atrás (por ejemplo, de una pregunta activa al selector
 * de dificultad en /student). Sin `onBack`, es el logout real de
 * siempre — así en la pantalla "de arriba" (nada que "volver") el mismo
 * botón cierra sesión de verdad.
 *
 * `showThemeToggle` solo lo pasa /student — el panel de admin se queda
 * fijo en oscuro por ahora.
 */
export function PageHeader({
  email,
  showThemeToggle = false,
  onBack,
}: {
  email?: string | null;
  showThemeToggle?: boolean;
  onBack?: () => void;
}) {
  const initial = email?.trim().charAt(0).toUpperCase() || '?';

  return (
    <div className="page-header">
      <button
        type="button"
        className="icon-btn"
        onClick={onBack ?? (() => signOut({ callbackUrl: '/login' }))}
        aria-label={onBack ? 'Volver' : 'Cerrar sesión'}
        title={onBack ? 'Volver' : 'Cerrar sesión'}
      >
        {onBack ? <ArrowLeftIcon /> : <LogoutIcon />}
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
