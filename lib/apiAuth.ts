import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from './auth';
import type { Role } from '@/types';

/**
 * Guard reutilizable para route handlers. Es una segunda capa de defensa
 * además del middleware: si algún día el matcher del middleware queda mal
 * configurado, el endpoint igual se protege solo.
 */
export class ApiAuthError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export async function requireRole(allowed: Role | Role[]) {
  const session = await getServerSession(authOptions);
  const roles = Array.isArray(allowed) ? allowed : [allowed];

  if (!session?.user || session.error) {
    throw new ApiAuthError('No autenticado.', 401);
  }
  if (!roles.includes(session.user.role)) {
    throw new ApiAuthError('No autorizado.', 403);
  }

  return session;
}

export function handleApiError(e: unknown) {
  if (e instanceof ApiAuthError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  console.error('API error:', e);
  return NextResponse.json({ error: 'Error interno del servidor.' }, { status: 500 });
}
