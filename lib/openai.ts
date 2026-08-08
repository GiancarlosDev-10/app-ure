import OpenAI from 'openai';
import { z } from 'zod';
import type { Difficulty, GeneratedQuestion } from '@/types';

const apiKey = process.env.OPENAI_API_KEY;
const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';

// No revienta al importar (a diferencia de supabaseAdmin.ts) porque este
// módulo también se importa en build time; el error real aparece recién
// si se intenta generar una pregunta sin la key configurada.
const client = new OpenAI({ apiKey: apiKey || 'missing' });

const DIFFICULTY_GUIDE: Record<Difficulty, string> = {
  basico:
    'Preguntas directas sobre definiciones, datos y conceptos explícitos que aparecen tal cual en el material.',
  intermedio:
    'Preguntas que exigen relacionar dos o más ideas del material, o aplicar un concepto a un caso simple.',
  avanzado:
    'Preguntas de análisis, comparación o síntesis: requieren entender el material en profundidad, no solo memorizarlo.',
};

// Tope de caracteres que se mandan como contexto al modelo por llamada.
// gpt-4o-mini soporta ~128k tokens de contexto (~350-450k caracteres en
// español); 60.000 cubre documentos largos reales con margen de sobra,
// sin disparar el costo/latencia por pregunta innecesariamente. Para
// documentos aun más largos que este tope, ver pickContextWindow abajo.
const MAX_CONTEXT_CHARS = 60_000;

/**
 * Si el markdown entra completo dentro del tope, se manda entero. Si no,
 * en vez de recortar siempre desde el principio (lo que dejaría el resto
 * del documento sin usar nunca), se toma una ventana de tamaño fijo pero
 * en una posición aleatoria — así, a lo largo de varias preguntas
 * generadas, se termina cubriendo el documento completo en vez de
 * repetir siempre la introducción.
 */
function pickContextWindow(markdown: string): string {
  if (markdown.length <= MAX_CONTEXT_CHARS) return markdown;
  const maxStart = markdown.length - MAX_CONTEXT_CHARS;
  const start = Math.floor(Math.random() * maxStart);
  return markdown.slice(start, start + MAX_CONTEXT_CHARS);
}

const generatedQuestionSchema = z.object({
  question: z.string().min(1),
  options: z.array(z.string().min(1)).length(4),
  correctIndex: z.number().int().min(0).max(3),
  explanation: z.string().min(1),
});

export async function generateQuestion(
  markdown: string,
  difficulty: Difficulty
): Promise<GeneratedQuestion> {
  if (!apiKey) {
    throw new Error('Falta configurar OPENAI_API_KEY en el servidor.');
  }

  const context = pickContextWindow(markdown);

  const completion = await client.chat.completions.create({
    model,
    temperature: 0.7,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: [
          'Sos un generador de preguntas de examen en español.',
          'Trabajás EXCLUSIVAMENTE con el material que te pasan: nunca inventás datos que no estén ahí.',
          'Devolvés únicamente un objeto JSON, sin texto adicional, con esta forma exacta:',
          '{"question": string, "options": [string, string, string, string], "correctIndex": number, "explanation": string}',
          '"correctIndex" es la posición (0 a 3) de la opción correcta dentro de "options".',
          'Las 4 opciones deben ser plausibles y del mismo estilo (nada de "todas las anteriores" ni relleno obvio).',
          '"explanation" debe justificar la respuesta correcta citando o parafraseando el material.',
        ].join(' '),
      },
      {
        role: 'user',
        content: [
          `Nivel de dificultad: ${difficulty}. ${DIFFICULTY_GUIDE[difficulty]}`,
          '',
          'Material de estudio:',
          '"""',
          context,
          '"""',
          '',
          'Generá UNA sola pregunta de opción múltiple en JSON según las instrucciones del sistema.',
        ].join('\n'),
      },
    ],
  });

  const raw = completion.choices[0]?.message?.content;
  if (!raw) {
    throw new Error('OpenAI no devolvió contenido.');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('OpenAI devolvió un JSON inválido.');
  }

  const result = generatedQuestionSchema.safeParse(parsed);
  if (!result.success) {
    console.error('openai: respuesta con formato inesperado', result.error.issues, raw);
    throw new Error('La respuesta de OpenAI no tiene el formato esperado.');
  }

  return {
    question: result.data.question,
    options: result.data.options as [string, string, string, string],
    correctIndex: result.data.correctIndex,
    explanation: result.data.explanation,
  };
}
