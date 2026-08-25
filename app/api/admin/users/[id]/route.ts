import { NextResponse } from 'next/server';
import { requireRole, handleApiError } from '@/lib/apiAuth';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { hashPassword } from '@/lib/password';
import { updateUserSchema } from '@/lib/schemas';

const LIST_COLUMNS =
  'id, email, role, active, expiration_date, questions_used, questions_limit, alert_threshold, bound_device_id, created_at';

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  try {
    await requireRole('admin');

    const body = await req.json();
    const parsed = updateUserSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? 'Datos inválidos.' },
        { status: 400 }
      );
    }

    const updatePayload: Record<string, unknown> = {};
    if (parsed.data.email) updatePayload.email = parsed.data.email.toLowerCase();
    if (parsed.data.role) updatePayload.role = parsed.data.role;
    if (typeof parsed.data.active === 'boolean') updatePayload.active = parsed.data.active;
    if (parsed.data.expirationDate) updatePayload.expiration_date = parsed.data.expirationDate;
    if (parsed.data.questionsLimit) updatePayload.questions_limit = parsed.data.questionsLimit;

    if (parsed.data.password) {
      updatePayload.password_hash = await hashPassword(parsed.data.password);
      // Un reset de contraseña corta cualquier sesión activa (fuerza re-login).
      updatePayload.current_session_token = null;
    }
    if (parsed.data.resetDevice) {
      updatePayload.bound_device_id = null;
    }

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from('users')
      .update(updatePayload)
      .eq('id', params.id)
      .select(LIST_COLUMNS)
      .single();

    if (error) {
      if (error.code === '23505') {
        return NextResponse.json({ error: 'Ya existe un usuario con ese correo.' }, { status: 409 });
      }
      throw error;
    }
    if (!data) {
      return NextResponse.json({ error: 'Usuario no encontrado.' }, { status: 404 });
    }

    return NextResponse.json({ user: data });
  } catch (e) {
    return handleApiError(e);
  }
}
