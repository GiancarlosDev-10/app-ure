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
// OJO: 0.3 en básico + selección de ventana al azar causó preguntas
// repetidas exactas en producción (verificado con datos reales). Ahora
// que pickContextWindow rota en vez de tirar al azar (ver más abajo), el
// riesgo baja mucho, pero se deja 0.4 en vez de 0.3 como margen extra:
// menos determinístico, sigue siendo bastante más literal que los otros
// dos niveles.
const DIFFICULTY_TEMPERATURE: Record<Difficulty, number> = {
  basico: 0.4,
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
 * - Documento con marcadores [página N]: el documento se parte en ventanas
 *   CONSECUTIVAS que no se pisan, y `windowSeed` elige cuál toca. Los
 *   cortes siempre caen en límites de página (nunca a mitad de una idea)
 *   y cada fragmento arranca con su marcador — la cita "Fuente: página N"
 *   sale más confiable porque el marcador relevante está siempre visible.
 * - Documento largo sin marcadores: ventana de posición determinística
 *   por `windowSeed` (red de seguridad para documentos viejos sin páginas).
 *
 * ANTES el seed corría el ARRANQUE de a una página, pero la ventana mide
 * ~10 páginas: dos preguntas seguidas compartían el 91% del contexto
 * (medido sobre un documento real de 153 páginas), y en 8 preguntas el
 * modelo solo avanzaba 7 páginas de 153. Por eso salían 3, 4 y hasta 5
 * preguntas de la misma página. Ahora el seed salta de ventana ENTERA:
 * cada pregunta cae en una parte distinta del material y el documento
 * completo se recorre en ~15 preguntas en vez de 153.
 *
 * Las ventanas se solapan a propósito en UNA página: una lista o
 * clasificación que empieza en una página y termina en la siguiente
 * queda completa dentro de al menos una ventana, así el modelo nunca ve
 * media enumeración cortada por el corte de ventana.
 */
function pickContextWindow(markdown: string, windowSeed: number): string {
  if (markdown.length <= MAX_CONTEXT_CHARS) return markdown;

  const pageSplits = markdown.split(/(?=\[página \d+\])/i);
  // split deja lo anterior al primer marcador en [0]; si hay 2+ trozos
  // reales con marcador, usamos la división por páginas.
  if (pageSplits.length > 2) {
    // Se calculan solo los LÍMITES de cada ventana (con las longitudes),
    // sin armar el texto de todas: recién se concatena la elegida.
    const bounds: [number, number][] = [];
    let i = 0;
    while (i < pageSplits.length) {
      let len = 0;
      let j = i;
      while (j < pageSplits.length && (len === 0 || len + pageSplits[j].length <= MAX_CONTEXT_CHARS)) {
        len += pageSplits[j].length;
        j++;
      }
      bounds.push([i, j]);
      if (j >= pageSplits.length) break;
      i = Math.max(j - 1, i + 1); // -1 = la página de solapamiento
    }

    const [from, to] = bounds[windowSeed % bounds.length];
    return pageSplits.slice(from, to).join('').slice(0, MAX_CONTEXT_CHARS + 2_000);
  }

  const maxStart = markdown.length - MAX_CONTEXT_CHARS;
  // *2654435761 (primo grande, hash multiplicativo de Knuth) para que
  // seeds consecutivos caigan en puntos bien separados del documento en
  // vez de ir avanzando de a poquito.
  const start = (windowSeed * 2654435761) % maxStart;
  return markdown.slice(start, start + MAX_CONTEXT_CHARS);
}

/**
 * Lee los números de página de la cita "Fuente: página N" / "Fuente:
 * páginas N y M" que el modelo deja al final de la explicación. Se usa
 * para saber sobre qué páginas se preguntó hace poco y pedirle al modelo
 * que se corra a otra parte del material.
 */
export function extractCitedPages(explanation: string): number[] {
  const tail = explanation.match(/fuente:\s*p[aá]ginas?\s*([\d\s,y·–—-]+)/i);
  if (!tail) return [];
  return [...tail[1].matchAll(/\d+/g)].map((m) => Number(m[0]));
}

// 1 de cada 3 preguntas sale en formato "completar el espacio en blanco".
const CLOZE_EVERY = 3;

/**
 * Decide si a esta pregunta le toca el formato "completar".
 *
 * OJO con el detalle que motiva el hash: `windowSeed` ya elige la ventana
 * del documento (`seed % cantidadDeVentanas`). Si el formato saliera de
 * `seed % 3` directo, en cualquier documento con 3, 6, 9 o 15 ventanas
 * ambos ciclos quedarían sincronizados y SIEMPRE las mismas páginas
 * saldrían en formato completar, mientras que el resto del libro nunca lo
 * usaría. El hash rompe esa correlación: mezcla los bits del seed de forma
 * no lineal, así el formato queda repartido parejo sobre todas las
 * ventanas. (Multiplicar por una constante no servía: k*seed y seed dan el
 * mismo resto mod 3 si k ≡ 1 mod 3.)
 */
function shouldUseCloze(windowSeed: number): boolean {
  let x = windowSeed | 0;
  x = Math.imul(x ^ (x >>> 16), 2246822507);
  x = Math.imul(x ^ (x >>> 13), 3266489909);
  const hashed = (x ^ (x >>> 16)) >>> 0;
  return hashed % CLOZE_EVERY === 0;
}

export function normalizeQuestionText(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/[¿?.,!¡]/g, '')
    .replace(/\s+/g, ' ');
}

const generatedQuestionSchema = z.object({
  question: z.string().min(1),
  options: z.array(z.string().min(1)).length(4),
  correctIndex: z.number().int().min(0).max(3),
  explanation: z.string().min(1),
  // La fuente viaja como CAMPO del JSON, no como texto al final de la
  // explicación. Antes se le pedía al modelo "terminá con Fuente: página N"
  // y en la práctica se lo olvidaba el ~14% de las veces (medido sobre
  // preguntas reales en producción). Un campo estructurado se cumple mucho
  // más, y además permite validar contra las páginas que de verdad estaban
  // en el contexto en vez de confiar en lo que escribió.
  sourcePages: z.array(z.number().int().positive()).optional(),
});

export async function generateQuestion(
  markdown: string,
  difficulty: Difficulty,
  windowSeed: number,
  /** Páginas citadas en las preguntas más recientes: se le pide al modelo correrse a otra parte. */
  recentPages: number[] = []
): Promise<GeneratedQuestion & { promptTokens: number | null; completionTokens: number | null }> {
  if (!apiKey) {
    throw new Error('Falta configurar OPENAI_API_KEY en el servidor.');
  }

  const context = pickContextWindow(markdown, windowSeed);
  const hasPageMarkers = /\[página \d+\]/i.test(context);
  const useCloze = shouldUseCloze(windowSeed);

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
          '{"question": string, "options": [string, string, string, string], "correctIndex": number, "explanation": string, "sourcePages": number[]}',
          '"correctIndex" es la posición (0 a 3) de la opción correcta dentro de "options".',
          // Antes acá solo decía "las 4 opciones deben ser plausibles y del mismo
          // estilo". En la práctica el modelo igual inventaba distractores genéricos
          // o ajenos al tema, y la correcta se sacaba por descarte sin saber el
          // contenido (reportado por el usuario en los tres niveles). Estas reglas
          // son concretas y verificables, no una descripción de intención.
          'REGLAS DE LAS OPCIONES (críticas):',
          '1) Las 3 opciones incorrectas deben construirse con material REAL del texto: términos,',
          'conceptos, clasificaciones, requisitos, funciones o cifras que SÍ aparecen en el material,',
          'tomados de otra parte del contenido o de un concepto vecino parecido.',
          '2) Cada opción incorrecta debe ser algo que el material afirma en OTRO contexto pero que NO',
          'responde esta pregunta puntual. Ese es exactamente el tipo de distractor que se busca:',
          'quien no estudió no puede descartarlo, porque "suena" del libro y de hecho lo es.',
          '3) Prohibido inventar opciones absurdas, genéricas, obviamente ajenas al tema o que no',
          'aparezcan en ninguna parte del material.',
          // "Largos parecidos" a secas no alcanzaba: midiendo 6 preguntas reales,
          // en 3 la correcta era la más larga. La regla numérica es verificable,
          // y el modelo la cumple mucho mejor que una indicación cualitativa.
          '4) Las 4 opciones deben tener largo, forma gramatical y nivel de detalle PARECIDOS: contá los',
          'caracteres de cada opción y asegurate de que la más larga no supere a la más corta en más del',
          '25%. La opción correcta NO puede ser la más larga ni la más detallada del grupo — si te quedó',
          'así, acortala o alargá las incorrectas hasta emparejarlas antes de responder. Que la correcta',
          'se note por ser la más elaborada permite acertar por descarte sin saber el tema.',
          '5) Prohibido "todas las anteriores", "ninguna de las anteriores" y opciones de relleno.',
          '"explanation" debe justificar la respuesta correcta citando o parafraseando el material,',
          'y además explicar en una frase por qué la opción más tentadora de las incorrectas no sirve.',
          'La pregunta se redacta como una pregunta de examen normal, directa: nunca menciones "el material",',
          '"el texto", "el documento" ni frases como "según el material de estudio" dentro de "question".',
          'Si en el material aparecen marcadores de página con el formato exacto [página N], "sourcePages"',
          'es OBLIGATORIO: poné ahí los números de las páginas en las que está lo que justifica la respuesta,',
          'tomados de los marcadores [página N] que ves en el material (nunca inventes un número que no aparezca).',
          // Sin esto el modelo citaba UNA sola página aunque la respuesta se apoyara
          // en dos (típico: una enumeración que arranca en una página y termina en la
          // siguiente). El alumno iba a la página citada, encontraba 3 de los 5
          // conceptos y parecía un error de la app.
          'Si la respuesta se apoya en MÁS de una página —por ejemplo una lista, clasificación o enumeración',
          'que empieza en una página y sigue en la siguiente— poné TODAS las páginas necesarias en el array,',
          'no solo la primera. Nunca cites una sola página si la respuesta completa no está entera en ella.',
          'No escribas la fuente dentro de "explanation": va únicamente en "sourcePages".',
          'Si el material NO tiene marcadores de página, dejá "sourcePages" como array vacío y no menciones',
          '"página" en ningún lado — nunca falsifiques una fuente que no esté en el texto.',
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
          // El formato lo decide el código (1 de cada 3), no el modelo: pedirle
          // "a veces usá este formato" da un cumplimiento irregular, igual que
          // pasaba con la cita de página antes de volverla un campo del JSON.
          ...(useCloze
            ? [
                'FORMATO DE ESTA PREGUNTA: completar el espacio en blanco.',
                'En vez de una pregunta con signo de interrogación, "question" debe ser una AFIRMACIÓN tomada',
                'del material con exactamente UN espacio en blanco escrito como "______" (seis guiones bajos).',
                'Las 4 opciones son los candidatos a llenar ese espacio: cada una tiene que encajar',
                'gramaticalmente en la oración, de modo que las cuatro se lean como frases bien formadas y',
                'solo el contenido las diferencie.',
                'El espacio en blanco debe caer sobre el concepto que se evalúa (un término, una clasificación',
                'o una conclusión), nunca sobre una palabra de relleno como un artículo, una preposición o un',
                'verbo auxiliar. No pongas más de un espacio en blanco.',
                // Salió en la prueba real: "El Jefe, como líder, debe ser el único
                // ______ que conduce al grupo", con la respuesta "Líder". La palabra
                // ya estaba en la oración, así que se acertaba sin saber el tema.
                'PROHIBIDO que la respuesta correcta (o una variante evidente de ella) aparezca ya escrita en',
                'la parte visible de la afirmación: si el propio enunciado contiene la palabra que va en el',
                'espacio, la pregunta se responde sola. Reformulá la oración para que eso no pase.',
                'La afirmación debe tener contexto suficiente para ser respondible por alguien que estudió el',
                'material, y leerse con naturalidad: nada de frases forzadas o con redacción retorcida solo',
                'para acomodar el espacio en blanco.',
                'La regla de dificultad del nivel sigue aplicando igual: en intermedio y avanzado lo que va en',
                'el espacio no puede ser un dato escrito tal cual en una sola línea del material, sino algo que',
                'exija combinar las partes que pide el nivel.',
                '',
              ]
            : []),
          'Material de estudio:',
          '"""',
          context,
          '"""',
          '',
          // Segunda defensa contra la repetición de páginas, además de la
          // rotación de ventanas: aunque la ventana sea distinta, dentro de
          // ella el modelo tiende a elegir el mismo fragmento "jugoso".
          // Es una preferencia, no una prohibición: si el fragmento no da
          // para otra cosa, es mejor una buena pregunta repetida de página
          // que una pregunta forzada.
          ...(recentPages.length > 0
            ? [
                `Hace poco ya se preguntó sobre estas páginas: ${recentPages.join(', ')}.`,
                'Si el material de arriba te lo permite, basá esta pregunta en OTRA parte del contenido.',
                'Si no hay alternativa razonable, priorizá la calidad de la pregunta por encima de esta preferencia.',
                '',
              ]
            : []),
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

  // Páginas que de verdad estaban en el fragmento que se mandó: cualquier
  // número fuera de esta lista es inventado y se descarta.
  const pagesInContext = new Set(
    [...context.matchAll(/\[página (\d+)\]/gi)].map((m) => Number(m[1]))
  );
  const citedPages = (result.data.sourcePages ?? [])
    .filter((p) => pagesInContext.has(p))
    .sort((a, b) => a - b);

  // El campo estructurado + la validación de arriba llevaron los fallos de
  // cita de ~14% a 0 sobre 30 generaciones reales, pero un LLM nunca da
  // garantía dura: si igual devuelve el array vacío, la pregunta sale sin
  // fuente. No se inventa una página para tapar el hueco (sería peor
  // mandar al alumno a la página equivocada) — se deja registrado para
  // poder detectarlo en los logs en vez de que pase desapercibido.
  if (hasPageMarkers && citedPages.length === 0) {
    console.warn(
      'openai: el modelo no devolvió sourcePages válidas pese a haber marcadores en el contexto.',
      { sourcePages: result.data.sourcePages, question: result.data.question.slice(0, 120) }
    );
  }

  return {
    // El modelo escribe el espacio con cantidades distintas de guiones bajos
    // (salieron de 5, 6 y 10 en la misma tanda). Se normaliza acá para que
    // en pantalla el hueco se vea siempre igual, sin depender de que acierte
    // el largo exacto.
    question: result.data.question.replace(/_{3,}/g, '______'),
    options: result.data.options as [string, string, string, string],
    correctIndex: result.data.correctIndex,
    explanation: buildExplanation(result.data.explanation, hasPageMarkers, citedPages),
    promptTokens: completion.usage?.prompt_tokens ?? null,
    completionTokens: completion.usage?.completion_tokens ?? null,
  };
}

/**
 * Arma la explicación final con la cita de fuente en un formato único y
 * predecible, en vez de confiar en cómo la haya redactado el modelo.
 *
 * Dos defensas determinísticas acá:
 * 1. Si el material NO tenía marcadores, se borra cualquier mención a
 *    página que el modelo haya inventado igual.
 * 2. Si SÍ tenía, la cita se reescribe desde `citedPages` (ya filtrado
 *    contra las páginas realmente presentes en el contexto). Así la cita
 *    nunca falta por olvido del modelo ni apunta a una página inventada,
 *    y siempre sale con el mismo formato — que es el que después lee
 *    extractCitedPages() para no repetir páginas.
 */
function buildExplanation(
  explanation: string,
  hasPageMarkers: boolean,
  citedPages: number[]
): string {
  const limpia = explanation
    // Contempla la forma plural ("Fuente: páginas 12 y 13"), que se
    // habilitó para respuestas que se apoyan en más de una página.
    .replace(/\s*fuente:\s*p[aá]ginas?\s*[\d\s,y·–—-]*\d\.?/gi, '')
    .trim();

  if (!hasPageMarkers) {
    return limpia.replace(/\s*p[aá]ginas?\s*\d+(\s*y\s*\d+)?\.?/gi, '').trim();
  }
  if (citedPages.length === 0) return limpia;

  const lista =
    citedPages.length === 1
      ? `página ${citedPages[0]}`
      : `páginas ${citedPages.slice(0, -1).join(', ')} y ${citedPages[citedPages.length - 1]}`;
  return `${limpia} Fuente: ${lista}.`;
}
