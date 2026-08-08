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
 * Devuelve si el identificador ya superó el máximo de intentos fallidos
 * en la ventana de tiempo. No lanza (a diferencia de la versión anterior)
 * para poder correrla en paralelo con otras consultas vía Promise.all,
 * en vez de bloquear la cadena de requests secuenciales.
 */
export async function isRateLimited(identifier: string): Promise<boolean> {
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
    return false;
  }

  return (count ?? 0) >= MAX_ATTEMPTS;
}

export const RATE_LIMIT_WINDOW_MINUTES = WINDOW_MINUTES;

/**
 * Registra un intento de login fallido. El caso de éxito ya no pasa por
 * acá: se resuelve en una sola llamada RPC junto con el resto de las
 * escrituras post-login (ver lib/auth.ts + complete_login en Postgres).
 */
export async function recordFailedAttempt(identifier: string, ip?: string | null): Promise<void> {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase.from('login_attempts').insert({
    identifier,
    success: false,
    ip: ip ?? null,
  });

  if (error) {
    console.error('rateLimit: error registrando intento fallido', error);
  }
}
