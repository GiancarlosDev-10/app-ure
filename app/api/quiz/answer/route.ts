import { NextResponse } from 'next/server';
import { requireRole, handleApiError, ApiAuthError } from '@/lib/apiAuth';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { answerQuestionSchema } from '@/lib/schemas';

interface SubmitAnswerResult {
  correct_index: number;
  explanation: string;
  is_correct: boolean;
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

    // Antes eran 3 llamadas seguidas (buscar la pregunta, guardar la
    // respuesta, incrementar el contador); ahora es 1 sola función de
    // Postgres que hace las 3 cosas de forma atómica.
    const { data: rows, error } = await supabase.rpc('submit_answer', {
      p_question_id: parsed.data.questionId,
      p_user_id: userId,
      p_selected_index: parsed.data.selectedIndex,
    });

    if (error) {
      if (error.message.includes('question_not_found')) {
        throw new ApiAuthError('La pregunta no existe.', 404);
      }
      if (error.message.includes('question_not_owned')) {
        throw new ApiAuthError('Esa pregunta no te pertenece.', 403);
      }
      if (error.message.includes('already_answered')) {
        throw new ApiAuthError('Esta pregunta ya fue respondida.', 409);
      }
      throw error;
    }

    const result = (rows as SubmitAnswerResult[] | null)?.[0];
    if (!result) {
      throw new Error('submit_answer no devolvió resultado.');
    }

    return NextResponse.json({
      correct: result.is_correct,
      correctIndex: result.correct_index,
      explanation: result.explanation,
      questionsUsed: result.questions_used,
      questionsLimit: result.questions_limit,
    });
  } catch (e) {
    return handleApiError(e);
  }
}
