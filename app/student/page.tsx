'use client';

import { useEffect, useState, type CSSProperties } from 'react';
import { useSession } from 'next-auth/react';
import type { Difficulty } from '@/types';
import { Logo } from '@/components/logo';
import { PageHeader } from '@/components/page-header';
import { TypewriterText } from '@/components/typewriter-text';

// A propósito NO usa el mismo componente que "¡A darle!"/"Bienvenido":
// ahí el efecto es una bienvenida (una sola vez por sesión), acá cumple
// una función real — disimular que la IA tarda unos segundos en pensar
// la pregunta — así que se repite cada vez que se genera una.
const LOADING_PHRASE = 'Cargando pregunta... ¡Prepárate!';

interface ContentOption {
  id: string;
  title: string;
}

interface ActiveQuestion {
  id: string;
  question: string;
  options: string[];
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

  function handleBackToSelection() {
    // "Siguiente pregunta" ya no dispara otra generación al toque: te
    // deja elegir la dificultad de nuevo antes de gastar la llamada.
    setQuestion(null);
    setFeedback(null);
    setSelectedOption(null);
  }

  async function handleGenerate() {
    setGenerating(true);
    setError(null);
    setFeedback(null);
    setSelectedOption(null);
    setQuestion(null);

    try {
      const res = await fetch('/api/quiz/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contentId, difficulty }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'No se pudo generar la pregunta.');
      setQuestion(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error inesperado.');
    } finally {
      setGenerating(false);
    }
  }

  async function handleAnswer() {
    if (!question || selectedOption === null) return;
    setAnswering(true);
    setError(null);

    try {
      const res = await fetch('/api/quiz/answer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ questionId: question.id, selectedIndex: selectedOption }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'No se pudo registrar tu respuesta.');
      setFeedback(json);
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
            <p style={{ fontWeight: 600, fontSize: '1.05rem', marginTop: '0.75rem' }}>
              <span
                className="typewriter"
                style={{ '--tw-chars': LOADING_PHRASE.length } as CSSProperties}
              >
                {LOADING_PHRASE}
              </span>
            </p>
          ) : (
            <h1>
              <TypewriterText text="¡A darle!" storageKey="student-adarle" />
            </h1>
          )}
        </div>

        {!generating && loadingContent && <p className="hint">Cargando tu contenido…</p>}

        {!generating && !loadingContent && contentList.length === 0 && (
          <p className="hint">
            Todavía no tenés material asignado. Pedile al administrador que te asigne uno.
          </p>
        )}

        {!generating && !loadingContent && contentList.length > 0 && !question && (
          <>
            <div
              style={{
                marginTop: '1.25rem',
                padding: '0.85rem 1rem',
                borderRadius: '10px',
                background: 'var(--t-panel-bg)',
                border: '1px solid var(--t-panel-border)',
                fontSize: '0.8rem',
                lineHeight: 1.6,
              }}
            >
              <strong>Cómo funciona:</strong>
              <br />
              1️⃣ Elige la dificultad.
              <br />
              2️⃣ Genera una pregunta.
              <br />
              3️⃣ Responde y lee la explicación.
            </div>

            <p className="hint" style={{ marginTop: '1rem' }}>
              Material: {contentList[0].title}
            </p>

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
          </>
        )}

        {question && (
          <div style={{ marginTop: '1.25rem' }}>
            <span className="badge badge-demo">{DIFFICULTY_LABEL[difficulty]}</span>
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
                <button type="button" onClick={handleGenerate} disabled={generating}>
                  {generating ? 'Generando…' : 'Siguiente pregunta'}
                </button>
              </div>
            )}
          </div>
        )}

        {error && <p className="error">{error}</p>}
      </div>
    </main>
  );
}
