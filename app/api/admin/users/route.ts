import { NextResponse } from 'next/server';
import { requireRole, handleApiError } from '@/lib/apiAuth';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { hashPassword } from '@/lib/password';
import { createUserSchema } from '@/lib/schemas';

const LIST_COLUMNS =
  'id, email, role, active, expiration_date, questions_used, questions_limit, alert_threshold, created_at';

export async function GET() {
  try {
    await requireRole('admin');
    const supabase = getSupabaseAdmin();

    const { data, error } = await supabase
      .from('users')
      .select(LIST_COLUMNS)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return NextResponse.json({ users: data });
  } catch (e) {
    return handleApiError(e);
  }
}

export async function POST(req: Request) {
  try {
    await requireRole('admin');

    const body = await req.json();
    const parsed = createUserSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? 'Datos inválidos.' },
        { status: 400 }
      );
    }

    const supabase = getSupabaseAdmin();
    const passwordHash = await hashPassword(parsed.data.password);

    const insertPayload: Record<string, unknown> = {
      email: parsed.data.email.toLowerCase(),
      password_hash: passwordHash,
      role: parsed.data.role,
      active: parsed.data.active,
    };
    if (parsed.data.expirationDate) insertPayload.expiration_date = parsed.data.expirationDate;
    if (parsed.data.questionsLimit) insertPayload.questions_limit = parsed.data.questionsLimit;

    const { data, error } = await supabase
      .from('users')
      .insert(insertPayload)
      .select(LIST_COLUMNS)
      .single();

    if (error) {
      if (error.code === '23505') {
        return NextResponse.json({ error: 'Ya existe un usuario con ese correo.' }, { status: 409 });
      }
      throw error;
    }

    return NextResponse.json({ user: data }, { status: 201 });
  } catch (e) {
    return handleApiError(e);
  }
}
