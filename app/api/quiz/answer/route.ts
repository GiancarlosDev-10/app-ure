import { NextResponse } from 'next/server';
import { requireRole, handleApiError, ApiAuthError } from '@/lib/apiAuth';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { answerQuestionSchema } from '@/lib/schemas';

interface IncrementResult {
  questions_used: number;
  questions_limit: number;
}

export async function POST(req: Request) {
  try {
    const session = await requireRole(['demo', 'paid']);
    const userId = session.user!.id;

    const body = await req.json();
    const parsed = answerQuestionSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? 'Datos inválidos.' },
        { status: 400 }
      );
    }

    const supabase = getSupabaseAdmin();

    const { data: question, error: questionError } = await supabase
      .from('quiz_questions')
      .select('id, user_id, correct_index, explanation, answered_at')
      .eq('id', parsed.data.questionId)
      .single();

    if (questionError || !question) {
      throw new ApiAuthError('La pregunta no existe.', 404);
    }
    if (question.user_id !== userId) {
      throw new ApiAuthError('Esa pregunta no te pertenece.', 403);
    }
    if (question.answered_at) {
      throw new ApiAuthError('Esta pregunta ya fue respondida.', 409);
    }

    const isCorrect = parsed.data.selectedIndex === question.correct_index;

    const { error: updateError } = await supabase
      .from('quiz_questions')
      .update({
        user_answer_index: parsed.data.selectedIndex,
        is_correct: isCorrect,
        answered_at: new Date().toISOString(),
      })
      .eq('id', question.id);

    if (updateError) throw updateError;

    // Incremento atómico de questions_used (RPC en Postgres, ver
    // supabase/schema.sql) para no pisarse si el usuario dispara
    // preguntas en paralelo.
    const { data: usageRows, error: usageError } = await supabase.rpc(
      'increment_questions_used',
      { p_user_id: userId }
    );

    if (usageError) throw usageError;
    // El aviso de "cerca del límite" no se manda por correo: se calcula
    // en vivo en el dashboard de /admin (ver app/admin/page.tsx).
    const usage = (usageRows as IncrementResult[] | null)?.[0];

    return NextResponse.json({
      correct: isCorrect,
      correctIndex: question.correct_index,
      explanation: question.explanation,
      questionsUsed: usage?.questions_used ?? null,
      questionsLimit: usage?.questions_limit ?? null,
    });
  } catch (e) {
    return handleApiError(e);
  }
}
