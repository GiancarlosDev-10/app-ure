'use client';

import { useEffect, useState, type CSSProperties } from 'react';

/**
 * Muestra `text` con efecto "máquina de escribir" (ver .typewriter en
 * globals.css) solo la primera vez que aparece en esta sesión del
 * navegador (sessionStorage, se resetea al cerrar la pestaña/navegador).
 * Las veces siguientes se muestra el texto directo, sin animar.
 */
export function TypewriterText({ text, storageKey }: { text: string; storageKey: string }) {
  const [animate, setAnimate] = useState(false);

  useEffect(() => {
    const key = `typewriter-seen:${storageKey}`;
    if (!sessionStorage.getItem(key)) {
      sessionStorage.setItem(key, '1');
      setAnimate(true);
    }
  }, [storageKey]);

  if (!animate) return <>{text}</>;

  return (
    <span className="typewriter" style={{ '--tw-chars': text.length } as CSSProperties}>
      {text}
    </span>
  );
}
