import { NextResponse } from 'next/server';
import { requireRole, handleApiError, ApiAuthError } from '@/lib/apiAuth';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { generateQuestion, normalizeQuestionText, extractCitedPages } from '@/lib/openai';
import { generateQuestionSchema } from '@/lib/schemas';

// Cuántas preguntas recientes (de este usuario+contenido) se revisan para
// no repetir una idéntica. 150 alcanza de sobra para el caso que motivó
// esto (usuarios con miles de preguntas de límite, pero que en la
// práctica reportan repetidas mucho antes de llegar ahí).
const DEDUPE_WINDOW = 150;

// De cuántas preguntas recientes se toman las páginas ya usadas para
// pedirle al modelo que cambie de tema. Corto a propósito: es la queja
// concreta ("3, 4, 5 preguntas seguidas de la misma página"), y una lista
// larga terminaría vetando medio documento.
const RECENT_PAGES_WINDOW = 8;
const MAX_RETRIES_ON_DUPLICATE = 2;

export async function POST(req: Request) {
  try {
    const session = await requireRole(['demo', 'paid']);
    const userId = session.user!.id;

    const body = await req.json();
    const parsed = generateQuestionSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? 'Datos inválidos.' },
        { status: 400 }
      );
    }

    const supabase = getSupabaseAdmin();

    // Defensa extra además del middleware/JWT: releer el estado real de
    // la cuenta (activo, vencimiento, cupo) y del contenido justo antes
    // de gastar una llamada a OpenAI. Las tres consultas no dependen
    // entre sí, así que van en paralelo en vez de una tras otra. La
    // tercera trae el historial reciente de preguntas de este usuario
    // para este contenido: su cantidad decide qué ventana de contexto
    // usar (rotación determinística, ver lib/openai.ts) y sus textos
    // sirven para detectar una repetida exacta antes de devolverla.
    const [userResult, contentResult, historyResult] = await Promise.all([
      supabase
        .from('users')
        .select('active, expiration_date, questions_used, questions_limit')
        .eq('id', userId)
        .single(),
      supabase
        .from('study_content')
        .select('id, markdown, active, assigned_to')
        .eq('id', parsed.data.contentId)
        .single(),
      supabase
        .from('quiz_questions')
        .select('question, explanation', { count: 'exact' })
        .eq('user_id', userId)
        .eq('content_id', parsed.data.contentId)
        .order('created_at', { ascending: false })
        .limit(DEDUPE_WINDOW),
    ]);

    const { data: userRow, error: userError } = userResult;
    if (userError || !userRow) throw new ApiAuthError('Usuario no encontrado.', 404);

    const today = new Date().toISOString().slice(0, 10);
    if (!userRow.active || userRow.expiration_date < today) {
      throw new ApiAuthError('Tu acceso está inactivo o venció.', 403);
    }
    if (userRow.questions_used >= userRow.questions_limit) {
      throw new ApiAuthError(
        `Llegaste al límite de ${userRow.questions_limit} preguntas. Contacta al administrador.`,
        403
      );
    }

    const { data: content, error: contentError } = contentResult;
    if (contentError || !content) {
      throw new ApiAuthError('El contenido no existe.', 404);
    }
    if (content.assigned_to !== userId || !content.active) {
      throw new ApiAuthError('Ese contenido no está asignado a tu cuenta.', 403);
    }

    const windowSeed = historyResult.count ?? 0;
    const history = historyResult.data ?? [];
    const recentQuestions = new Set(history.map((q) => normalizeQuestionText(q.question)));

    // Páginas citadas en las últimas preguntas: se le pasan al modelo para
    // que no vuelva a preguntar sobre lo mismo. Solo las más recientes —
    // con toda la ventana de dedupe (150) la lista sería tan larga que
    // taparía medio documento y no dejaría margen para generar nada.
    const recentPages = [
      ...new Set(history.slice(0, RECENT_PAGES_WINDOW).flatMap((q) => extractCitedPages(q.explanation ?? ''))),
    ].sort((a, b) => a - b);

    let generated = await generateQuestion(
      content.markdown,
      parsed.data.difficulty,
      windowSeed,
      recentPages
    );
    let retries = 0;
    while (
      recentQuestions.has(normalizeQuestionText(generated.question)) &&
      retries < MAX_RETRIES_ON_DUPLICATE
    ) {
      retries++;
      // Salto grande (no solo +1) para caer en una ventana bien distinta,
      // no la de al lado.
      generated = await generateQuestion(
        content.markdown,
        parsed.data.difficulty,
        windowSeed + retries * 97,
        recentPages
      );
    }

    const { data: saved, error: saveError } = await supabase
      .from('quiz_questions')
      .insert({
        user_id: userId,
        content_id: content.id,
        difficulty: parsed.data.difficulty,
        question: generated.question,
        options: generated.options,
        correct_index: generated.correctIndex,
        explanation: generated.explanation,
        prompt_tokens: generated.promptTokens,
        completion_tokens: generated.completionTokens,
      })
      .select('id, question, options')
      .single();

    if (saveError) throw saveError;

    // OJO: nunca se manda correctIndex ni explanation acá — eso recién
    // se revela en /api/quiz/answer, para que el feedback sea real.
    return NextResponse.json({
      id: saved.id,
      question: saved.question,
      options: saved.options,
    });
  } catch (e) {
    return handleApiError(e);
  }
}
