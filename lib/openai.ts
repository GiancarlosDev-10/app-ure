import OpenAI from 'openai';
import { z } from 'zod';
import type { Difficulty, GeneratedQuestion } from '@/types';

const apiKey = process.env.OPENAI_API_KEY;
const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';

// No revienta al importar (a diferencia de supabaseAdmin.ts) porque este
// módulo también se importa en build time; el error real aparece recién
// si se intenta generar una pregunta sin la key configurada.
const client = new OpenAI({ apiKey: apiKey || 'missing' });

// Antes esto era una sola frase descriptiva por nivel ("preguntas de
// análisis, comparación o síntesis...") y en la práctica "avanzado" no se
// distinguía de "intermedio": el modelo no tenía ninguna regla concreta
// ni ejemplo que lo obligara a subir la exigencia, solo una descripción
// vaga. Ahora cada nivel trae una regla verificable (cuántas partes del
// material tiene que combinar la respuesta) más un ejemplo ilustrativo
// de la ESTRUCTURA esperada (no del contenido — son genéricos a propósito
// para no filtrarse en la pregunta real).
const DIFFICULTY_GUIDE: Record<Difficulty, string> = {
  basico:
    'La respuesta correcta debe poder señalarse citando UNA sola frase casi textual del material. ' +
    'Prohibido pedir relacionar dos conceptos distintos o inferir algo que no esté dicho explícitamente. ' +
    'Ejemplo de estructura (no de contenido): "¿Qué año se fundó la institución?" — un dato aislado y explícito.',
  intermedio:
    'La pregunta debe obligar a conectar EXACTAMENTE dos ideas, datos o pasos distintos del material ' +
    '(causa-efecto, comparación simple, o aplicar una definición a una situación breve). ' +
    'Si se puede responder citando una sola frase aislada, está mal clasificada como intermedia. ' +
    'Ejemplo de estructura: "¿Por qué la medida X reduce el riesgo Y descrito antes?" — conecta una causa con un efecto de dos partes distintas.',
  avanzado:
    'La pregunta debe exigir analizar, comparar o sintetizar información que aparece en AL MENOS TRES partes ' +
    'distintas del material, o evaluar una consecuencia que el material no dice literal sino que se deduce de ' +
    'combinar varias ideas. Prohibido que la respuesta sea un dato aislado o un solo paso de una lista — si se ' +
    'puede responder citando una sola frase, está mal clasificada como avanzada. ' +
    'Ejemplo de estructura: dado que el material describe los procedimientos A, B y C, "¿qué pasaría si se aplica A sin haber completado B?" — combina varios procedimientos para deducir algo no dicho literalmente.',
};

// Antes la temperatura era fija (0.7) para los tres niveles. Básico se
// beneficia de menos "creatividad" (recall literal, más determinístico);
// avanzado se beneficia de más variación para que de verdad combine y no
// se quede pegado al fragmento más obvio del contexto.
const DIFFICULTY_TEMPERATURE: Record<Difficulty, number> = {
  basico: 0.3,
  intermedio: 0.6,
  avanzado: 0.85,
};

// Tope de caracteres que se mandan como contexto al modelo por llamada.
// Bajarlo es la palanca principal de velocidad: la latencia de gpt-4o-mini
// crece con el tamaño del prompt. 20k caracteres (~10-15 páginas de un
// manual) alcanza de sobra para generar UNA pregunta bien fundamentada.
const MAX_CONTEXT_CHARS = 20_000;

/**
 * Elige el fragmento del documento que se manda como contexto.
 *
 * - Documento corto (<= tope): va entero.
 * - Documento con marcadores [página N]: se parte por páginas y se toma
 *   un grupo de páginas contiguas al azar que quepa en el tope. Los
 *   cortes siempre caen en límites de página (nunca a mitad de una idea)
 *   y cada fragmento arranca con su marcador — la cita "Fuente: página N"
 *   sale más confiable porque el marcador relevante está siempre visible.
 * - Documento largo sin marcadores: ventana de posición aleatoria (el
 *   comportamiento anterior, como red de seguridad).
 */
function pickContextWindow(markdown: string): string {
  if (markdown.length <= MAX_CONTEXT_CHARS) return markdown;

  const pageSplits = markdown.split(/(?=\[página \d+\])/i);
  // split deja lo anterior al primer marcador en [0]; si hay 2+ trozos
  // reales con marcador, usamos la división por páginas.
  if (pageSplits.length > 2) {
    const startIdx = Math.floor(Math.random() * pageSplits.length);
    let chunk = '';
    for (let i = startIdx; i < pageSplits.length; i++) {
      if (chunk.length + pageSplits[i].length > MAX_CONTEXT_CHARS && chunk.length > 0) break;
      chunk += pageSplits[i];
    }
    if (chunk.length > 0) return chunk.slice(0, MAX_CONTEXT_CHARS + 2_000);
  }

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
): Promise<GeneratedQuestion & { promptTokens: number | null; completionTokens: number | null }> {
  if (!apiKey) {
    throw new Error('Falta configurar OPENAI_API_KEY en el servidor.');
  }

  const context = pickContextWindow(markdown);
  const hasPageMarkers = /\[página \d+\]/i.test(context);

  const completion = await client.chat.completions.create({
    model,
    temperature: DIFFICULTY_TEMPERATURE[difficulty],
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: [
          'Eres un generador de preguntas de examen en español.',
          'Trabajas EXCLUSIVAMENTE con el material que te pasan: nunca inventas datos que no estén ahí.',
          'Devuelves únicamente un objeto JSON, sin texto adicional, con esta forma exacta:',
          '{"question": string, "options": [string, string, string, string], "correctIndex": number, "explanation": string}',
          '"correctIndex" es la posición (0 a 3) de la opción correcta dentro de "options".',
          'Las 4 opciones deben ser plausibles y del mismo estilo (nada de "todas las anteriores" ni relleno obvio).',
          '"explanation" debe justificar la respuesta correcta citando o parafraseando el material.',
          'La pregunta se redacta como una pregunta de examen normal, directa: nunca menciones "el material",',
          '"el texto", "el documento" ni frases como "según el material de estudio" dentro de "question".',
          'Si en el material aparecen marcadores de página con el formato exacto [página N], es OBLIGATORIO',
          'terminar "explanation" con la cita "Fuente: página N" — usa el marcador más cercano ANTES del',
          'fragmento que justifica la respuesta. Una explicación sin esa cita se considera incompleta.',
          'Si el material NO tiene marcadores de página, no inventes ningún número ni menciones "página"',
          '— nunca falsifiques una fuente que no esté en el texto.',
          'La dificultad tiene que venir de CUÁNTAS partes del material hay que combinar para responder,',
          'nunca de la redacción: no disfraces una pregunta simple con vocabulario rebuscado, doble negación',
          'o frases enredadas para que "parezca" más difícil. El enunciado debe ser claro y directo en',
          'cualquier nivel — lo que cambia entre niveles es cuánto razonamiento exige la RESPUESTA, no',
          'cuánto cuesta entender la PREGUNTA.',
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
    explanation: stripHallucinatedPageCitation(result.data.explanation, hasPageMarkers),
    promptTokens: completion.usage?.prompt_tokens ?? null,
    completionTokens: completion.usage?.completion_tokens ?? null,
  };
}

/**
 * Defensa contra alucinaciones: el prompt le pide al modelo que no cite
 * página si el material no tenía marcadores, pero un LLM no garantiza
 * seguir esa instrucción el 100% de las veces. Acá se verifica de forma
 * determinística — si el contexto mandado no tenía ningún [página N],
 * se borra cualquier mención a "página" que la respuesta haya inventado,
 * sin importar qué haya hecho el modelo.
 */
function stripHallucinatedPageCitation(explanation: string, hasPageMarkers: boolean): string {
  if (hasPageMarkers) return explanation;
  return explanation
    .replace(/\s*fuente:\s*p[aá]gina\s*\d+\.?/gi, '')
    .replace(/\s*p[aá]gina\s*\d+\.?/gi, '')
    .trim();
}
