import { NextResponse } from 'next/server';
import { requireRole, handleApiError } from '@/lib/apiAuth';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { reviewListSchema } from '@/lib/schemas';

// Tope de errores que se traen para repasar de una vez. Sobra para una
// sesión de repaso y mantiene la respuesta chica.
const REVIEW_LIMIT = 200;

// Preguntas que el alumno ya respondió MAL en este material, para el modo
// "Repasar mis errores". No llama a OpenAI (cero tokens): son preguntas ya
// generadas y guardadas en quiz_questions. Igual que /api/quiz/generate,
// nunca manda correct_index ni explanation — eso se revela recién en
// /api/quiz/review/answer.
export async function GET(req: Request) {
  try {
    const session = await requireRole(['demo', 'paid']);
    const userId = session.user!.id;

    const parsed = reviewListSchema.safeParse({
      contentId: new URL(req.url).searchParams.get('contentId'),
    });
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? 'Datos inválidos.' },
        { status: 400 }
      );
    }

    // El filtro por user_id ya garantiza que solo vea sus propias preguntas.
    const { data, error } = await getSupabaseAdmin()
      .from('quiz_questions')
      .select('id, question, options, difficulty')
      .eq('user_id', userId)
      .eq('content_id', parsed.data.contentId)
      .eq('is_correct', false)
      // Las ya acertadas en un repaso anterior no vuelven a aparecer.
      .is('review_cleared_at', null)
      .order('answered_at', { ascending: false })
      .limit(REVIEW_LIMIT);

    if (error) throw error;
    return NextResponse.json({ questions: data ?? [] });
  } catch (e) {
    return handleApiError(e);
  }
}
