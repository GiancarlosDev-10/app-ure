import { getServerSession } from 'next-auth';
import Link from 'next/link';
import { authOptions } from '@/lib/auth';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { PageHeader } from '@/components/page-header';
import { Logo } from '@/components/logo';
import {
  estimateCostUsd,
  HISTORICAL_COST_USD_BASELINE,
  TRACKING_STARTED_AT,
} from '@/lib/openaiCost';

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

interface UsageStats {
  totalQuestions: number;
  estimatedCostUsd: number;
}

async function getUsageStats(): Promise<UsageStats> {
  const supabase = getSupabaseAdmin();
  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';

  // Cuenta total y tokens no dependen entre sí: van en paralelo.
  const [{ count }, { data: tokenRows }] = await Promise.all([
    supabase.from('quiz_questions').select('id', { count: 'exact', head: true }),
    supabase.from('quiz_questions').select('prompt_tokens, completion_tokens'),
  ]);

  // El costo por pregunta varía según el tamaño del contexto que le tocó
  // (documentos grandes vs chicos), por eso se suma tokens reales fila
  // por fila en vez de multiplicar por un promedio fijo.
  const trackedCost = (tokenRows ?? []).reduce(
    (sum, row) => sum + estimateCostUsd(model, row.prompt_tokens, row.completion_tokens),
    0
  );

  return {
    totalQuestions: count ?? 0,
    estimatedCostUsd: HISTORICAL_COST_USD_BASELINE + trackedCost,
  };
}

export default async function AdminPage() {
  // Las consultas no dependen entre sí: se disparan en paralelo en vez de
  // una tras otra (cada una cruza a Supabase en otra región).
  const [session, usersNearLimit, usageStats] = await Promise.all([
    getServerSession(authOptions),
    getUsersNearLimit(),
    getUsageStats(),
  ]);

  return (
    <main className="container">
      <div className="card">
        <PageHeader email={session?.user?.email} />
        <div className="brand-header">
          <Logo size={56} />
          <h1>Panel de administración</h1>
        </div>

        <nav className="nav-links" style={{ justifyContent: 'center' }}>
          <Link href="/admin/content">📄 Contenido</Link>
          <Link href="/admin/users">👤 Usuarios</Link>
        </nav>

        <div
          style={{
            marginTop: '1.25rem',
            padding: '1rem',
            borderRadius: '10px',
            background: 'rgba(255, 255, 255, 0.03)',
            border: '1px solid #232c46',
            display: 'flex',
            gap: '1.5rem',
            flexWrap: 'wrap',
          }}
        >
          <div>
            <p className="hint" style={{ margin: 0 }}>
              Preguntas generadas (todas las cuentas, incluye demo)
            </p>
            <p style={{ margin: '0.2rem 0 0', fontSize: '1.6rem', fontWeight: 700 }}>
              {usageStats.totalQuestions}
            </p>
          </div>
          <div>
            <p className="hint" style={{ margin: 0 }}>
              Costo estimado OpenAI
            </p>
            <p style={{ margin: '0.2rem 0 0', fontSize: '1.6rem', fontWeight: 700 }}>
              ${usageStats.estimatedCostUsd.toFixed(2)}
            </p>
            <p className="hint" style={{ margin: '0.2rem 0 0', fontSize: '0.72rem' }}>
              Incluye ${HISTORICAL_COST_USD_BASELINE.toFixed(2)} gastados antes de trackear
              tokens (dashboard de OpenAI, base fija) + lo real desde el {TRACKING_STARTED_AT}.
            </p>
          </div>
        </div>

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
      </div>
    </main>
  );
}
