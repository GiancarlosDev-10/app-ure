import { NextResponse } from 'next/server';
import { requireRole, handleApiError } from '@/lib/apiAuth';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';

// Contenido markdown asignado al usuario logueado (solo el activo).
// El alumno elige entre esto para generar preguntas; nunca ve el
// markdown de otro usuario.
export async function GET() {
  try {
    const session = await requireRole(['demo', 'paid']);
    const supabase = getSupabaseAdmin();

    const { data, error } = await supabase
      .from('study_content')
      .select('id, title, created_at')
      .eq('assigned_to', session.user!.id)
      .eq('active', true)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return NextResponse.json({ content: data });
  } catch (e) {
    return handleApiError(e);
  }
}
