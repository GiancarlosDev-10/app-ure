import type { AuthOptions, User as NextAuthUser } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import { randomUUID } from 'crypto';
import { getSupabaseAdmin } from './supabaseAdmin';
import { verifyPassword } from './password';
import { assertNotRateLimited, normalizeIdentifier, recordLoginAttempt } from './rateLimit';
import type { Role, UserRow } from '@/types';

const GENERIC_LOGIN_ERROR = 'Credenciales inválidas.';

export const authOptions: AuthOptions = {
  session: {
    strategy: 'jwt',
    maxAge: 8 * 60 * 60, // 8 horas
  },
  pages: {
    signIn: '/login',
  },
  providers: [
    CredentialsProvider({
      name: 'credentials',
      credentials: {
        email: { label: 'Correo', type: 'email' },
        password: { label: 'Contraseña', type: 'password' },
      },
      async authorize(credentials): Promise<NextAuthUser | null> {
        const email = normalizeIdentifier(credentials?.email ?? '');
        const password = credentials?.password ?? '';

        if (!email || !password) {
          throw new Error(GENERIC_LOGIN_ERROR);
        }

        // 1) Rate limiting: 5 intentos fallidos por ventana de 15 min.
        await assertNotRateLimited(email);

        const supabase = getSupabaseAdmin();
        const { data: userRow, error } = await supabase
          .from('users')
          .select('*')
          .eq('email', email)
          .maybeSingle<UserRow>();

        if (error) {
          console.error('auth: error consultando usuario', error);
          throw new Error(GENERIC_LOGIN_ERROR);
        }

        if (!userRow) {
          await recordLoginAttempt(email, false);
          throw new Error(GENERIC_LOGIN_ERROR);
        }

        if (!userRow.active) {
          await recordLoginAttempt(email, false);
          throw new Error('Tu cuenta está inactiva. Contactá al administrador.');
        }

        const today = new Date().toISOString().slice(0, 10);
        if (userRow.expiration_date && userRow.expiration_date < today) {
          await recordLoginAttempt(email, false);
          throw new Error('Tu acceso venció. Contactá al administrador para renovarlo.');
        }

        const passwordOk = await verifyPassword(password, userRow.password_hash);
        if (!passwordOk) {
          await recordLoginAttempt(email, false);
          throw new Error(GENERIC_LOGIN_ERROR);
        }

        // 2) Login correcto: éxito registrado y limpieza de intentos fallidos previos.
        await recordLoginAttempt(email, true);

        // 3) Sesión única por cuenta: se genera un nuevo token y se
        //    sobreescribe el anterior. Cualquier sesión activa con el
        //    token viejo quedará invalidada en el próximo request (ver
        //    callback `jwt` más abajo).
        const sessionToken = randomUUID();
        const { error: updateError } = await supabase
          .from('users')
          .update({
            current_session_token: sessionToken,
            current_session_created_at: new Date().toISOString(),
          })
          .eq('id', userRow.id);

        if (updateError) {
          console.error('auth: error actualizando sesión única', updateError);
          throw new Error('No se pudo iniciar sesión. Probá de nuevo.');
        }

        return {
          id: userRow.id,
          email: userRow.email,
          role: userRow.role,
          sessionToken,
        } as NextAuthUser & { role: Role; sessionToken: string };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        // Login recién hecho: sembramos el token con lo que devolvió authorize().
        const u = user as NextAuthUser & { role: Role; sessionToken: string };
        token.uid = u.id;
        token.role = u.role;
        token.sessionToken = u.sessionToken;
        token.invalidated = false;
        return token;
      }

      // Requests subsiguientes: se valida contra la BD que esta sigue
      // siendo la sesión "vigente" de la cuenta (sesión única por cuenta).
      if (token.uid) {
        const supabase = getSupabaseAdmin();
        const { data: current } = await supabase
          .from('users')
          .select('current_session_token, active, expiration_date, role')
          .eq('id', token.uid as string)
          .maybeSingle<Pick<UserRow, 'current_session_token' | 'active' | 'expiration_date' | 'role'>>();

        const today = new Date().toISOString().slice(0, 10);
        const stillValid =
          !!current &&
          current.active &&
          current.expiration_date >= today &&
          current.current_session_token === token.sessionToken;

        token.invalidated = !stillValid;
        if (current) token.role = current.role;
      }

      return token;
    },
    async session({ session, token }) {
      if (token.invalidated) {
        // La UI/middleware debe leer session.error y forzar signOut()
        // mostrando "Tu sesión se cerró porque iniciaste sesión en otro dispositivo".
        return {
          ...session,
          error: 'SessionInvalidated',
          user: undefined,
        };
      }

      if (session.user) {
        session.user.id = token.uid as string;
        session.user.role = token.role as Role;
      }

      return session;
    },
  },
};
