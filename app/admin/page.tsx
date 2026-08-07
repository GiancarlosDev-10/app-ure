import { getServerSession } from 'next-auth';
import Link from 'next/link';
import { authOptions } from '@/lib/auth';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { SignOutButton } from '../sign-out-button';
import { Logo } from '../logo';

interface UsageAlertRow {
  id: string;
  email: string;
  questions_used: number;
  questions_limit: number;
  alert_threshold: number;
}

async function getUsersNearLimit(): Promise<UsageAlertRow[]> {
  const supabase = getSupabaseAdmin();
  // El filtro "questions_used >= alert_threshold" compara dos columnas
  // entre sí, así que se resuelve acá en JS en vez de en la query
  // (son a lo sumo un puñado de usuarios activos, no hace falta más).
  const { data, error } = await supabase
    .from('users')
    .select('id, email, questions_used, questions_limit, alert_threshold')
    .eq('active', true)
    .in('role', ['demo', 'paid']);

  if (error || !data) return [];
  return data.filter((u) => u.questions_used >= u.alert_threshold);
}

export default async function AdminPage() {
  const session = await getServerSession(authOptions);
  const usersNearLimit = await getUsersNearLimit();

  return (
    <main className="container">
      <div className="card">
        <div className="brand-header">
          <Logo size={56} />
          <h1>Panel de administración</h1>
        </div>
        <p>Sesión: {session?.user?.email}</p>

        <nav className="nav-links" style={{ justifyContent: 'center' }}>
          <Link href="/admin/content">📄 Contenido</Link>
          <Link href="/admin/users">👤 Usuarios</Link>
        </nav>

        {usersNearLimit.length > 0 && (
          <div
            style={{
              marginTop: '1.25rem',
              padding: '1rem',
              borderRadius: '10px',
              background: 'rgba(245, 158, 11, 0.12)',
              border: '1px solid rgba(245, 158, 11, 0.4)',
            }}
          >
            <p style={{ margin: 0, fontWeight: 600, color: '#fbbf24' }}>
              ⚠️ {usersNearLimit.length} usuario{usersNearLimit.length > 1 ? 's' : ''} cerca del
              límite de preguntas
            </p>
            <ul style={{ margin: '0.5rem 0 0', paddingLeft: '1.1rem', fontSize: '0.875rem' }}>
              {usersNearLimit.map((u) => (
                <li key={u.id}>
                  {u.email} — {u.questions_used} / {u.questions_limit}
                </li>
              ))}
            </ul>
          </div>
        )}

        <SignOutButton />
      </div>
    </main>
  );
}
