/**
 * Crea (o resetea la contraseña de) el primer usuario admin.
 *
 * Uso:
 *   bun run scripts/create-admin.ts admin@tudominio.com "unaClaveSegura123"
 *
 * Bun carga .env / .env.local automáticamente, no hace falta dotenv.
 * Requiere en el entorno:
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */
import { createClient } from '@supabase/supabase-js';
import bcrypt from 'bcryptjs';

const [emailArg, passwordArg] = process.argv.slice(2);

if (!emailArg || !passwordArg) {
  console.error('Uso: bun run scripts/create-admin.ts <email> <password>');
  process.exit(1);
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  console.error(
    'Faltan NEXT_PUBLIC_SUPABASE_URL y/o SUPABASE_SERVICE_ROLE_KEY en el entorno (.env.local).'
  );
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey);
const email = emailArg.trim().toLowerCase();
const passwordHash = await bcrypt.hash(passwordArg, 12);

const { data, error } = await supabase
  .from('users')
  .upsert(
    {
      email,
      password_hash: passwordHash,
      role: 'admin',
      active: true,
    },
    { onConflict: 'email' }
  )
  .select('id, email, role')
  .single();

if (error) {
  console.error('Error creando/actualizando admin:', error.message);
  process.exit(1);
}

console.log('Admin listo:', data);
