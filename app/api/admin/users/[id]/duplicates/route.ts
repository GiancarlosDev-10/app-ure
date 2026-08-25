import { NextResponse } from 'next/server';
import { requireRole, handleApiError } from '@/lib/apiAuth';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { normalizeQuestionText } from '@/lib/openai';

// Reemplaza el script suelto que corría a mano cada vez que un cliente
// reportaba "me salió la misma pregunta de nuevo" (Amancay, Fernández,
// Gómez, Simbala) — mismo chequeo, ahora accesible desde el panel.
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    await requireRole('admin');
    const supabase = getSupabaseAdmin();

    // Supabase corta en 1000 filas por default — un usuario con
    // questions_limit alto (hasta 2000+, sin tope duro en el esquema)
    // puede superarlo fácil. Se pagina hasta traer todo, si no las
    // repetidas que caen después de la fila 1000 quedaban invisibles.
    const PAGE_SIZE = 1000;
    const questions: { question: string; difficulty: string }[] = [];
    for (let from = 0; ; from += PAGE_SIZE) {
      const { data, error } = await supabase
        .from('quiz_questions')
        .select('question, difficulty')
        .eq('user_id', params.id)
        .order('created_at', { ascending: true })
        .range(from, from + PAGE_SIZE - 1);

      if (error) throw error;
      questions.push(...(data ?? []));
      if (!data || data.length < PAGE_SIZE) break;
    }

    const groups = new Map<string, { question: string; difficulty: string; count: number }>();
    for (const q of questions) {
      const key = normalizeQuestionText(q.question);
      const existing = groups.get(key);
      if (existing) {
        existing.count++;
      } else {
        groups.set(key, { question: q.question, difficulty: q.difficulty, count: 1 });
      }
    }

    const duplicateGroups = [...groups.values()]
      .filter((g) => g.count > 1)
      .sort((a, b) => b.count - a.count);

    return NextResponse.json({
      total: questions.length,
      distinct: groups.size,
      duplicateGroups,
    });
  } catch (e) {
    return handleApiError(e);
  }
}
