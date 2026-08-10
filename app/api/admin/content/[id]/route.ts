import { NextResponse } from 'next/server';
import { requireRole, handleApiError } from '@/lib/apiAuth';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { updateContentSchema } from '@/lib/schemas';

// Activar/desactivar: el contenido inactivo deja de aparecer en el
// desplegable del alumno (GET /api/quiz/content filtra por active=true),
// pero se conserva junto con el historial de preguntas ya respondidas.
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  try {
    await requireRole('admin');

    const body = await req.json();
    const parsed = updateContentSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? 'Datos inválidos.' },
        { status: 400 }
      );
    }

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from('study_content')
      .update({ active: parsed.data.active })
      .eq('id', params.id)
      .select('id, title, active')
      .single();

    if (error) throw error;
    if (!data) return NextResponse.json({ error: 'Contenido no encontrado.' }, { status: 404 });

    return NextResponse.json({ content: data });
  } catch (e) {
    return handleApiError(e);
  }
}

// Borrado real: por el ON DELETE CASCADE del esquema, también borra las
// preguntas (quiz_questions) generadas a partir de este contenido. Es
// permanente — para solo dejar de asignarlo, usar PATCH (desactivar).
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  try {
    await requireRole('admin');
    const supabase = getSupabaseAdmin();

    const { error, count } = await supabase
      .from('study_content')
      .delete({ count: 'exact' })
      .eq('id', params.id);

    if (error) throw error;
    if (!count) return NextResponse.json({ error: 'Contenido no encontrado.' }, { status: 404 });

    return NextResponse.json({ ok: true });
  } catch (e) {
    return handleApiError(e);
  }
}
