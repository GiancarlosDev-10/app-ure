'use client';

import { useEffect, useState } from 'react';
import { SunIcon, MoonIcon } from './icons';

export const THEME_STORAGE_KEY = 'app-ure-theme';

type Theme = 'dark' | 'light';

/**
 * Toggle claro/oscuro. Alcance limitado a las pantallas que lo montan
 * (login y /student, ver .themeable en globals.css) — el panel de admin
 * no lo usa y se queda fijo en oscuro.
 *
 * La preferencia se guarda en localStorage (por dispositivo/navegador,
 * no depende de la cuenta) y se aplica vía [data-theme] en <html>. El
 * script inline en layout.tsx la aplica antes del primer paint para que
 * no haya flash del tema por defecto.
 */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>('dark');

  useEffect(() => {
    const current = document.documentElement.getAttribute('data-theme');
    setTheme(current === 'light' ? 'light' : 'dark');
  }, []);

  function toggle() {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem(THEME_STORAGE_KEY, next);
  }

  return (
    <button
      type="button"
      className="icon-btn"
      onClick={toggle}
      aria-label={theme === 'dark' ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'}
      title={theme === 'dark' ? 'Modo claro' : 'Modo oscuro'}
    >
      {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
    </button>
  );
}
