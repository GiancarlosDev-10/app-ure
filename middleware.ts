import { withAuth } from 'next-auth/middleware';
import { NextResponse } from 'next/server';
import type { Role } from '@/types';

const ROUTE_ROLES: Record<string, Role[]> = {
  '/admin': ['admin'],
  '/api/admin': ['admin'],
  '/student': ['demo', 'paid'],
  '/api/quiz': ['demo', 'paid'],
};

export default withAuth(
  function middleware(req) {
    const token = req.nextauth.token;
    const path = req.nextUrl.pathname;
    const isApi = path.startsWith('/api/');

    // Sesión invalidada porque se detectó login en otro dispositivo:
    // se corta acá mismo, antes de entrar a cualquier ruta protegida.
    if (token?.invalidated) {
      if (isApi) {
        return NextResponse.json(
          { error: 'Sesión inválida: se inició sesión en otro dispositivo.' },
          { status: 401 }
        );
      }
      const url = new URL('/login', req.url);
      url.searchParams.set('error', 'session-invalidated');
      const res = NextResponse.redirect(url);
      res.cookies.delete('next-auth.session-token');
      res.cookies.delete('__Secure-next-auth.session-token');
      return res;
    }

    const matchedPrefix = Object.keys(ROUTE_ROLES).find((prefix) => path.startsWith(prefix));
    if (matchedPrefix) {
      const allowedRoles = ROUTE_ROLES[matchedPrefix];
      if (!token?.role || !allowedRoles.includes(token.role as Role)) {
        if (isApi) {
          return NextResponse.json({ error: 'No autorizado.' }, { status: 403 });
        }
        return NextResponse.redirect(new URL('/', req.url));
      }
    }

    return NextResponse.next();
  },
  {
    callbacks: {
      // Solo exige "estar logueado"; el detalle de rol/invalidación se
      // resuelve arriba para poder responder distinto en página vs. API.
      authorized: ({ token }) => !!token,
    },
    pages: {
      signIn: '/login',
    },
  }
);

export const config = {
  matcher: ['/admin/:path*', '/student/:path*', '/api/admin/:path*', '/api/quiz/:path*'],
};
