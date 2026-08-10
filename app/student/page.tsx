'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import type { Difficulty } from '@/types';
import { Logo } from '@/components/logo';
import { PageHeader } from '@/components/page-header';

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
    <main className="container">
      <div>
        <PageHeader email={session?.user?.email} />
        <div className="brand-header">
          <Logo size={56} />
          <h1>¡A darle!</h1>
        </div>

        {loadingContent && <p className="hint">Cargando tu contenido…</p>}

        {!loadingContent && contentList.length === 0 && (
          <p className="hint">
            Todavía no tenés material asignado. Pedile al administrador que te asigne uno.
          </p>
        )}

        {!loadingContent && contentList.length > 0 && !question && (
          <>
            <label htmlFor="content">Material</label>
            <select id="content" value={contentId} onChange={(e) => setContentId(e.target.value)}>
              {contentList.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </select>

            <label htmlFor="difficulty">Dificultad</label>
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
                      color: '#f2f4f8',
                      background: isCorrectOption
                        ? '#16532e'
                        : isWrongPick
                          ? '#5a1e1e'
                          : isSelected
                            ? 'var(--accent-soft)'
                            : '#0e1425',
                      border: isSelected ? '1px solid var(--accent)' : '1px solid #2c3757',
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
                <p style={{ color: feedback.correct ? '#4ade80' : '#f87171', fontWeight: 600 }}>
                  {feedback.correct ? '✅ ¡Correcto!' : '❌ No era esa.'}
                </p>
                <p className="hint">{feedback.explanation}</p>
                {feedback.questionsUsed !== null && (
                  <p className="hint">
                    Preguntas usadas: {feedback.questionsUsed} / {feedback.questionsLimit}
                  </p>
                )}
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
