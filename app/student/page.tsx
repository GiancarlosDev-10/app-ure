'use client';

import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { useSession } from 'next-auth/react';
import type { Difficulty } from '@/types';
import { Logo } from '@/components/logo';
import { PageHeader } from '@/components/page-header';
import { TypewriterText } from '@/components/typewriter-text';
import { CelebrationModal } from '@/components/celebration-modal';

// A propósito NO usa el mismo componente que "¡A darle!"/"Bienvenido":
// ahí el efecto es una bienvenida (una sola vez por sesión), acá cumple
// una función real — disimular que la IA tarda unos segundos en pensar
// la pregunta — así que se repite cada vez que se genera una. Dos líneas
// animadas en secuencia (la segunda arranca cuando termina la primera).
// A propósito el total (~1.8s) queda MENOR a la espera real (~2.7-3.3s):
// así "¡Prepárate!" termina de tipearse y se queda quieto, legible, en
// vez de cortarse recién al terminar justo cuando llega la respuesta.
const LOADING_LINE_1 = 'Cargando pregunta...';
const LOADING_LINE_2 = '¡Prepárate!';
const LOADING_LINE_1_SECONDS = 1.0;
const LOADING_LINE_2_SECONDS = 0.8;

interface ContentOption {
  id: string;
  title: string;
}

interface ActiveQuestion {
  id: string;
  question: string;
  options: string[];
  /** Solo en el repaso: la dificultad con la que se generó originalmente. */
  difficulty?: Difficulty;
}

/** Siguiente pregunta pedida en segundo plano mientras se lee la explicación. */
interface Prefetch {
  key: string;
  promise: Promise<ActiveQuestion>;
  settled: boolean;
}

async function fetchNewQuestion(contentId: string, difficulty: Difficulty): Promise<ActiveQuestion> {
  const res = await fetch('/api/quiz/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contentId, difficulty }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? 'No se pudo generar la pregunta.');
  return json;
}

function shuffle<T>(items: T[]): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

interface Feedback {
  correct: boolean;
  correctIndex: number;
  explanation: string;
  questionsUsed: number | null;
  questionsLimit: number | null;
}

const DIFFICULTY_LABEL: Record<Difficulty, string> = {
  basico: 'Básico',
  intermedio: 'Intermedio',
  avanzado: 'Avanzado',
};

export default function StudentPage() {
  const { data: session } = useSession();

  const [contentList, setContentList] = useState<ContentOption[]>([]);
  const [loadingContent, setLoadingContent] = useState(true);
  const [contentId, setContentId] = useState('');
  const [difficulty, setDifficulty] = useState<Difficulty>('basico');

  const [question, setQuestion] = useState<ActiveQuestion | null>(null);
  const [selectedOption, setSelectedOption] = useState<number | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  const [generating, setGenerating] = useState(false);
  const [answering, setAnswering] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Modo "Repasar mis errores": preguntas ya falladas de este material,
  // servidas desde la base (cero tokens, no cuentan para el límite).
  const [reviewPool, setReviewPool] = useState<ActiveQuestion[]>([]);
  // Para no mostrar "¡No tienes errores!" un instante antes de que llegue la lista.
  const [reviewLoaded, setReviewLoaded] = useState(false);
  // Pop-up "¡No tienes errores!" al tocar el repaso sin errores.
  const [showNoErrors, setShowNoErrors] = useState(false);
  // Estable para que el listener de Esc del modal no se re-registre en cada render.
  const closeNoErrors = useCallback(() => setShowNoErrors(false), []);
  const [reviewMode, setReviewMode] = useState(false);
  const [reviewQueue, setReviewQueue] = useState<ActiveQuestion[]>([]);

  const prefetchRef = useRef<Prefetch | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/quiz/content');
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? 'No se pudo cargar tu contenido.');
        setContentList(json.content);
        if (json.content[0]) setContentId(json.content[0].id);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Error inesperado.');
      } finally {
        setLoadingContent(false);
      }
    })();
  }, []);

  // Cantidad de errores para repasar del material elegido. Se recarga al
  // volver a la pantalla de selección, así incluye lo recién fallado.
  useEffect(() => {
    if (question || !contentId) return;
    let cancelled = false;
    setReviewLoaded(false);
    (async () => {
      try {
        const res = await fetch(`/api/quiz/review?contentId=${contentId}`);
        const json = await res.json();
        if (!cancelled && res.ok) {
          setReviewPool(json.questions);
          setReviewLoaded(true);
        }
      } catch {
        // Sin repaso disponible no se rompe nada: ni botón ni mensaje.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [contentId, question]);

  function handleBackToSelection() {
    // "Siguiente pregunta" ya no dispara otra generación al toque: te
    // deja elegir la dificultad de nuevo antes de gastar la llamada.
    setQuestion(null);
    setFeedback(null);
    setSelectedOption(null);
    setReviewMode(false);
    setReviewQueue([]);
  }

  // Mientras el alumno lee la explicación, se pide la siguiente pregunta
  // del mismo material y dificultad. Al tocar "Siguiente pregunta" ya está
  // lista (o a medio camino), en vez de esperar los 3-6 s de OpenAI. Si
  // cambia de material/dificultad, la clave no coincide y se genera de cero.
  function startPrefetch() {
    const key = `${contentId}|${difficulty}`;
    if (prefetchRef.current?.key === key) return;
    const entry: Prefetch = { key, promise: fetchNewQuestion(contentId, difficulty), settled: false };
    entry.promise.then(
      () => {
        entry.settled = true;
      },
      () => {
        entry.settled = true;
      }
    );
    prefetchRef.current = entry;
  }

  async function handleGenerate() {
    setError(null);
    const key = `${contentId}|${difficulty}`;
    const pre = prefetchRef.current?.key === key ? prefetchRef.current : null;
    prefetchRef.current = null;

    const showLoading = () => {
      setGenerating(true);
      setQuestion(null);
      setFeedback(null);
      setSelectedOption(null);
    };
    // Si la pre-carga ya llegó, se reemplaza la pregunta sin pasar por la
    // pantalla de "Cargando pregunta...".
    if (!pre?.settled) showLoading();

    try {
      let next = pre ? await pre.promise.catch(() => null) : null;
      if (!next) {
        showLoading();
        next = await fetchNewQuestion(contentId, difficulty);
      }
      setReviewMode(false);
      setFeedback(null);
      setSelectedOption(null);
      setQuestion(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error inesperado.');
    } finally {
      setGenerating(false);
    }
  }

  function handleStartReview() {
    const [first, ...rest] = shuffle(reviewPool);
    if (!first) {
      setShowNoErrors(true);
      return;
    }
    setError(null);
    setFeedback(null);
    setSelectedOption(null);
    setReviewMode(true);
    setReviewQueue(rest);
    setQuestion(first);
  }

  function handleNextReview() {
    const [next, ...rest] = reviewQueue;
    if (!next) {
      handleBackToSelection();
      return;
    }
    setFeedback(null);
    setSelectedOption(null);
    setReviewQueue(rest);
    setQuestion(next);
  }

  async function handleAnswer() {
    if (!question || selectedOption === null) return;
    setAnswering(true);
    setError(null);

    try {
      // El repaso se corrige sin tocar la base ni el contador.
      const res = await fetch(reviewMode ? '/api/quiz/review/answer' : '/api/quiz/answer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ questionId: question.id, selectedIndex: selectedOption }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'No se pudo registrar tu respuesta.');
      setFeedback(json);
      if (!reviewMode) startPrefetch();
      // Acertada en el repaso: sale de la lista ya (el servidor la marcó).
      if (reviewMode && json.correct) {
        setReviewPool((pool) => pool.filter((q) => q.id !== question.id));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error inesperado.');
    } finally {
      setAnswering(false);
    }
  }

  return (
    <main className="container themeable">
      <div>
        <PageHeader
          email={session?.user?.email}
          showThemeToggle
          onBack={question ? handleBackToSelection : undefined}
        />
        <div className="brand-header">
          <Logo size={56} />
          {generating ? (
            <div style={{ fontWeight: 700, fontSize: '1.5rem', marginTop: '1.25rem', lineHeight: 1.5 }}>
              <div>
                <span
                  className="typewriter"
                  style={
                    {
                      '--tw-chars': LOADING_LINE_1.length,
                      '--tw-duration': `${LOADING_LINE_1_SECONDS}s`,
                    } as CSSProperties
                  }
                >
                  {LOADING_LINE_1}
                </span>
              </div>
              <div style={{ marginTop: '0.9rem' }}>
                <span
                  className="typewriter"
                  style={
                    {
                      '--tw-chars': LOADING_LINE_2.length,
                      '--tw-duration': `${LOADING_LINE_2_SECONDS}s`,
                      '--tw-delay': `${LOADING_LINE_1_SECONDS}s`,
                    } as CSSProperties
                  }
                >
                  {LOADING_LINE_2}
                </span>
              </div>
            </div>
          ) : (
            <h1>
              <TypewriterText text="¡A darle!" storageKey="student-adarle" />
            </h1>
          )}
        </div>

        {!generating && loadingContent && <p className="hint">Cargando tu contenido…</p>}

        {!generating && !loadingContent && contentList.length === 0 && (
          <p className="hint">
            Todavía no tienes material asignado. Pídele al administrador que te asigne uno.
          </p>
        )}

        {showNoErrors && <CelebrationModal message="¡No tienes errores, sigue así!" onClose={closeNoErrors} />}

        {!generating && !loadingContent && contentList.length > 0 && !question && (
          <>
            <div
              className="how-it-works"
              style={{
                marginTop: '1.25rem',
                padding: '0.85rem 1rem',
                borderRadius: '10px',
                background: 'var(--t-panel-bg)',
                border: '1px solid var(--t-panel-border)',
                lineHeight: 1.6,
              }}
            >
              <strong>Cómo funciona:</strong>
              <br />
              1️⃣ Elige tu material de estudio y la dificultad.
              <br />
              2️⃣ Genera una pregunta.
              <br />
              3️⃣ Responde y lee la explicación.
            </div>

            {contentList.length === 1 ? (
              <p className="hint" style={{ marginTop: '1rem' }}>
                Material: {contentList[0].title}
              </p>
            ) : (
              <>
                {/* Desplegable en vez de una tarjeta por material: con varias
                    normas (8 en el temario jurídico) las tarjetas ocupaban
                    media pantalla en el celular. */}
                <label htmlFor="content">Elige lo que quieres estudiar</label>
                <select id="content" value={contentId} onChange={(e) => setContentId(e.target.value)}>
                  {contentList.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.title}
                    </option>
                  ))}
                </select>
              </>
            )}

            <label htmlFor="difficulty">Elige la dificultad</label>
            <select
              id="difficulty"
              value={difficulty}
              onChange={(e) => setDifficulty(e.target.value as Difficulty)}
            >
              <option value="basico">Básico</option>
              <option value="intermedio">Intermedio</option>
              <option value="avanzado">Avanzado</option>
            </select>

            <button type="button" disabled={generating} onClick={handleGenerate}>
              {generating ? 'Generando…' : 'Generar pregunta'}
            </button>

            {/* Repaso: vuelve a mostrar lo que falló en este material, desde
                la base. Botón secundario (borde, sin relleno) para que no
                compita con "Generar pregunta". */}
            {/* Siempre visible una vez cargada la lista. Sin errores no muestra
                "(0)": al tocarlo abre el pop-up de "¡No tienes errores!". */}
            {reviewLoaded && (
              <button
                type="button"
                onClick={handleStartReview}
                style={{
                  background: 'transparent',
                  color: 'var(--t-text)',
                  border: '1px solid var(--accent)',
                }}
              >
                Practicar lo que fallé{reviewPool.length > 0 ? ` (${reviewPool.length})` : ''}
              </button>
            )}
          </>
        )}

        {question && (
          <div style={{ marginTop: '1.25rem' }}>
            {/* Con varios materiales asignados, recordar de cuál es la pregunta.
                El selector está oculto mientras hay pregunta, así que contentId
                sigue siendo el material con el que se generó. */}
            {contentList.length > 1 && (
              <p className="hint" style={{ marginTop: 0, marginBottom: '0.5rem', fontWeight: 600 }}>
                {/* Solo el nombre corto: "Ley 32069 – Contrataciones Públicas" → "Ley 32069" */}
                {contentList.find((c) => c.id === contentId)?.title.split(' – ')[0]}
              </p>
            )}
            <span className="badge badge-demo">{DIFFICULTY_LABEL[question.difficulty ?? difficulty]}</span>
            {reviewMode && (
              <span className="badge badge-demo" style={{ marginLeft: '0.4rem' }}>
                Repaso
              </span>
            )}
            <p style={{ fontWeight: 600, marginTop: '0.75rem', textAlign: 'justify' }}>
              {question.question}
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {question.options.map((opt, i) => {
                const isSelected = selectedOption === i;
                const showResult = feedback !== null;
                const isCorrectOption = showResult && i === feedback!.correctIndex;
                const isWrongPick = showResult && isSelected && !isCorrectOption;

                return (
                  <button
                    key={i}
                    type="button"
                    disabled={showResult || answering}
                    onClick={() => setSelectedOption(i)}
                    style={{
                      marginTop: 0,
                      textAlign: 'left',
                      fontWeight: 400,
                      // Las opciones correcta/incorrecta se resaltan con un
                      // fondo saturado en los dos temas, así que el texto
                      // blanco siempre contrasta bien ahí. Sin resaltar,
                      // el texto sigue el color del tema activo.
                      color: isCorrectOption || isWrongPick ? '#f2f4f8' : 'var(--t-text)',
                      background: isCorrectOption
                        ? 'var(--t-correct-bg)'
                        : isWrongPick
                          ? 'var(--t-wrong-bg)'
                          : isSelected
                            ? 'var(--t-option-selected-bg)'
                            : 'var(--t-option-bg)',
                      border: isSelected ? '1px solid var(--accent)' : '1px solid var(--t-border)',
                    }}
                  >
                    {opt}
                  </button>
                );
              })}
            </div>

            {!feedback && (
              <button
                type="button"
                disabled={selectedOption === null || answering}
                onClick={handleAnswer}
              >
                {answering ? 'Enviando…' : 'Responder'}
              </button>
            )}

            {feedback && (
              <div style={{ marginTop: '1rem' }}>
                <p
                  style={{
                    color: feedback.correct ? 'var(--t-success)' : 'var(--t-danger)',
                    fontWeight: 600,
                  }}
                >
                  {feedback.correct ? '✅ ¡Correcto!' : '❌ No era esa.'}
                </p>
                <p className="hint">{feedback.explanation}</p>
                {reviewMode ? (
                  <button type="button" onClick={handleNextReview}>
                    {reviewQueue.length > 0 ? 'Siguiente error' : 'Terminar repaso'}
                  </button>
                ) : (
                  <button type="button" onClick={handleGenerate} disabled={generating}>
                    {generating ? 'Generando…' : 'Siguiente pregunta'}
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {error && <p className="error">{error}</p>}
      </div>
    </main>
  );
}
