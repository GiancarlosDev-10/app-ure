import { NextResponse } from 'next/server';
import { requireRole, handleApiError, ApiAuthError } from '@/lib/apiAuth';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { generateQuestion } from '@/lib/openai';
import { generateQuestionSchema } from '@/lib/schemas';

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
    // de gastar una llamada a OpenAI. Las dos consultas no dependen
    // entre sí, así que van en paralelo en vez de una tras otra.
    const [userResult, contentResult] = await Promise.all([
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
    ]);

    const { data: userRow, error: userError } = userResult;
    if (userError || !userRow) throw new ApiAuthError('Usuario no encontrado.', 404);

    const today = new Date().toISOString().slice(0, 10);
    if (!userRow.active || userRow.expiration_date < today) {
      throw new ApiAuthError('Tu acceso está inactivo o venció.', 403);
    }
    if (userRow.questions_used >= userRow.questions_limit) {
      throw new ApiAuthError(
        `Llegaste al límite de ${userRow.questions_limit} preguntas. Contactá al administrador.`,
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

    const generated = await generateQuestion(content.markdown, parsed.data.difficulty);

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
