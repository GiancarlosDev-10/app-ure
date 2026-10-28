import { NextResponse } from 'next/server';
import { requireRole, handleApiError, ApiAuthError } from '@/lib/apiAuth';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { answerQuestionSchema } from '@/lib/schemas';

// Corrige una pregunta del modo repaso. A diferencia de /api/quiz/answer
// la respuesta original (la que se falló) queda como estaba y no se
// incrementa questions_used — el repaso no gasta tokens, así que tampoco
// consume cupo. Lo único que escribe: si acierta, marca review_cleared_at
// para que la pregunta salga de la lista de errores.
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
    const { data: row, error } = await supabase
      .from('quiz_questions')
      .select('user_id, correct_index, explanation, answered_at')
      .eq('id', parsed.data.questionId)
      .maybeSingle();

    if (error) throw error;
    if (!row) throw new ApiAuthError('La pregunta no existe.', 404);
    if (row.user_id !== userId) throw new ApiAuthError('Esa pregunta no te pertenece.', 403);
    // Solo se repasan preguntas ya respondidas: si no, esto serviría para
    // ver la respuesta de una pregunta nueva sin que cuente.
    if (!row.answered_at) throw new ApiAuthError('Esa pregunta todavía no fue respondida.', 409);

    const correct = parsed.data.selectedIndex === row.correct_index;
    if (correct) {
      const { error: clearError } = await supabase
        .from('quiz_questions')
        .update({ review_cleared_at: new Date().toISOString() })
        .eq('id', parsed.data.questionId)
        .eq('user_id', userId);
      if (clearError) throw clearError;
    }

    return NextResponse.json({
      correct,
      correctIndex: row.correct_index,
      explanation: row.explanation,
      questionsUsed: null,
      questionsLimit: null,
    });
  } catch (e) {
    return handleApiError(e);
  }
}
