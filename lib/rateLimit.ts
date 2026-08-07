import { getSupabaseAdmin } from './supabaseAdmin';

/**
 * Rate limiting de login basado en la tabla `login_attempts` de Supabase.
 * Se guarda ahí (en vez de memoria) porque Vercel corre cada invocación
 * serverless de forma aislada: un Map en memoria no sobrevive entre
 * requests ni se comparte entre instancias.
 */

const MAX_ATTEMPTS = 5;
const WINDOW_MINUTES = 15;

export function normalizeIdentifier(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Lanza si el identificador (normalmente el email) superó el máximo de
 * intentos fallidos permitidos dentro de la ventana de tiempo.
 */
export async function assertNotRateLimited(identifier: string): Promise<void> {
  const supabase = getSupabaseAdmin();
  const since = new Date(Date.now() - WINDOW_MINUTES * 60 * 1000).toISOString();

  const { count, error } = await supabase
    .from('login_attempts')
    .select('id', { count: 'exact', head: true })
    .eq('identifier', identifier)
    .eq('success', false)
    .gte('attempted_at', since);

  if (error) {
    // No bloqueamos el login por un fallo de la tabla de rate limit,
    // pero sí lo dejamos registrado para revisar.
    console.error('rateLimit: error consultando login_attempts', error);
    return;
  }

  if ((count ?? 0) >= MAX_ATTEMPTS) {
    throw new Error(
      `Demasiados intentos fallidos. Probá de nuevo en ${WINDOW_MINUTES} minutos.`
    );
  }
}

export async function recordLoginAttempt(
  identifier: string,
  success: boolean,
  ip?: string | null
): Promise<void> {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase.from('login_attempts').insert({
    identifier,
    success,
    ip: ip ?? null,
  });

  if (error) {
    console.error('rateLimit: error registrando intento de login', error);
  }

  // Si el intento fue exitoso, limpiamos el historial de fallos previos
  // para no dejar al usuario "medio bloqueado" en su próximo login.
  if (success) {
    await supabase
      .from('login_attempts')
      .delete()
      .eq('identifier', identifier)
      .eq('success', false);
  }
}
