'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { CloseIcon } from './icons';

// Pop-up de festejo con lluvia de pica pica (confeti) hecha solo con CSS,
// sin librería. Se cierra con la X o con Esc. Se monta solo mientras está
// abierto (el padre lo renderiza condicionalmente), así cada apertura
// sortea un pica pica nuevo y la animación arranca de cero.

// Ráfaga de ~5 s en total: los papelitos salen escalonados durante los
// primeros 2 s (MAX_DELAY) y cada uno tarda 2,5–3 s en caer, así el último
// termina cerca de los 5 s. Más piezas que en una ráfaga corta para que no
// se vea ralo al repartirlas en más tiempo.
const PIECE_COUNT = 90;
const MAX_DELAY_S = 2;
const MIN_FALL_S = 2.5;
const MAX_FALL_S = 3;
const COLORS = ['var(--accent)', '#3b82f6', '#22c55e', '#ef4444', '#a855f7', '#f97316', '#f2f4f8'];

interface Piece {
  left: number;
  delay: number;
  duration: number;
  color: string;
  size: number;
  drift: number;
  round: boolean;
}

function randomPieces(): Piece[] {
  return Array.from({ length: PIECE_COUNT }, () => ({
    left: Math.random() * 100,
    delay: Math.random() * MAX_DELAY_S,
    duration: MIN_FALL_S + Math.random() * (MAX_FALL_S - MIN_FALL_S),
    color: COLORS[Math.floor(Math.random() * COLORS.length)],
    size: 6 + Math.random() * 6,
    drift: (Math.random() - 0.5) * 160,
    round: Math.random() < 0.3,
  }));
}

export function CelebrationModal({ message, onClose }: { message: string; onClose: () => void }) {
  const [pieces] = useState(randomPieces);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    // Foco en la X al abrir: Enter/Espacio también lo cierran desde teclado.
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop">
      <div className="confetti" aria-hidden="true">
        {pieces.map((p, i) => (
          <span
            key={i}
            className="confetti-piece"
            style={
              {
                left: `${p.left}%`,
                width: `${p.size}px`,
                height: `${p.round ? p.size : p.size * 0.45}px`,
                borderRadius: p.round ? '50%' : '1px',
                background: p.color,
                animationDelay: `${p.delay}s`,
                animationDuration: `${p.duration}s`,
                '--drift': `${p.drift}px`,
              } as CSSProperties
            }
          />
        ))}
      </div>

      <div className="modal-card" role="dialog" aria-modal="true" aria-labelledby="celebration-title">
        <button ref={closeRef} type="button" className="icon-btn modal-close" onClick={onClose} aria-label="Cerrar">
          <CloseIcon />
        </button>
        <div className="modal-emoji" aria-hidden="true">
          🎉
        </div>
        <p id="celebration-title" className="big-message" style={{ marginTop: '0.5rem' }}>
          {message}
        </p>
      </div>
    </div>
  );
}
