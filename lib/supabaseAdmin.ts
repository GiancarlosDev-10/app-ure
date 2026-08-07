import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Cliente Supabase con la service_role key.
 *
 * SOLO se importa desde código que corre en el servidor (route handlers,
 * server actions, NextAuth callbacks). La service_role key ignora RLS,
 * así que este archivo NUNCA debe importarse desde un componente cliente
 * ni exponerse al bundle del navegador.
 */

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl) {
  throw new Error('Falta la variable de entorno NEXT_PUBLIC_SUPABASE_URL');
}
if (!serviceRoleKey) {
  throw new Error('Falta la variable de entorno SUPABASE_SERVICE_ROLE_KEY');
}

let _supabaseAdmin: SupabaseClient | null = null;

export function getSupabaseAdmin(): SupabaseClient {
  if (typeof window !== 'undefined') {
    throw new Error(
      'getSupabaseAdmin() no debe llamarse desde el cliente (usaría la service_role key).'
    );
  }

  if (!_supabaseAdmin) {
    _supabaseAdmin = createClient(supabaseUrl as string, serviceRoleKey as string, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }

  return _supabaseAdmin;
}
