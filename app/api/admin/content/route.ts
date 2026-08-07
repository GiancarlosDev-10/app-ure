import { NextResponse } from 'next/server';
import { requireRole, handleApiError } from '@/lib/apiAuth';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { createContentSchema } from '@/lib/schemas';

export async function GET() {
  try {
    await requireRole('admin');
    const supabase = getSupabaseAdmin();

    // `assigned_to` y `created_by` apuntan las dos a `users`, por eso hay
    // que nombrar la FK explícita para que PostgREST no ambigüe el join.
    const { data, error } = await supabase
      .from('study_content')
      .select(
        'id, title, assigned_to, active, created_at, assigned_user:users!study_content_assigned_to_fkey(email)'
      )
      .order('created_at', { ascending: false });

    if (error) throw error;
    return NextResponse.json({ content: data });
  } catch (e) {
    return handleApiError(e);
  }
}

export async function POST(req: Request) {
  try {
    const session = await requireRole('admin');

    const body = await req.json();
    const parsed = createContentSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? 'Datos inválidos.' },
        { status: 400 }
      );
    }

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from('study_content')
      .insert({
        title: parsed.data.title,
        markdown: parsed.data.markdown,
        assigned_to: parsed.data.assignedTo,
        created_by: session.user!.id,
      })
      .select('id, title, assigned_to, active, created_at')
      .single();

    if (error) {
      // FK violation: el usuario asignado no existe.
      if (error.code === '23503') {
        return NextResponse.json({ error: 'El usuario asignado no existe.' }, { status: 400 });
      }
      throw error;
    }

    return NextResponse.json({ content: data }, { status: 201 });
  } catch (e) {
    return handleApiError(e);
  }
}
