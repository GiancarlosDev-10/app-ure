import type { AuthOptions, User as NextAuthUser } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import { randomUUID } from 'crypto';
import { getSupabaseAdmin } from './supabaseAdmin';
import { verifyPassword } from './password';
import { isRateLimited, normalizeIdentifier, recordFailedAttempt, RATE_LIMIT_WINDOW_MINUTES } from './rateLimit';
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
        // ID persistente generado en el navegador (ver app/login/page.tsx),
        // no es un dato que tipee el usuario — viaja como credential más
        // porque NextAuth solo deja mandar campos extra por acá.
        deviceId: { label: 'Device', type: 'text' },
      },
      async authorize(credentials): Promise<NextAuthUser | null> {
        const email = normalizeIdentifier(credentials?.email ?? '');
        const password = credentials?.password ?? '';
        const deviceId = credentials?.deviceId?.trim() || null;

        if (!email || !password) {
          throw new Error(GENERIC_LOGIN_ERROR);
        }

        const supabase = getSupabaseAdmin();

        // 1) Rate limit y búsqueda del usuario no dependen entre sí:
        //    se disparan en paralelo en vez de una tras otra (importa
        //    especialmente acá porque la función y la base están en
        //    regiones distintas — ver nota en supabase/schema.sql).
        const [blocked, userResult] = await Promise.all([
          isRateLimited(email),
          supabase.from('users').select('*').eq('email', email).maybeSingle<UserRow>(),
        ]);

        if (blocked) {
          throw new Error(
            `Demasiados intentos fallidos. Prueba de nuevo en ${RATE_LIMIT_WINDOW_MINUTES} minutos.`
          );
        }

        const { data: userRow, error } = userResult;

        if (error) {
          console.error('auth: error consultando usuario', error);
          throw new Error(GENERIC_LOGIN_ERROR);
        }

        if (!userRow) {
          await recordFailedAttempt(email);
          throw new Error(GENERIC_LOGIN_ERROR);
        }

        if (!userRow.active) {
          await recordFailedAttempt(email);
          throw new Error('Tu cuenta está inactiva. Contacta al administrador.');
        }

        const today = new Date().toISOString().slice(0, 10);
        if (userRow.expiration_date && userRow.expiration_date < today) {
          await recordFailedAttempt(email);
          throw new Error('Tu acceso venció. Contacta al administrador para renovarlo.');
        }

        const passwordOk = await verifyPassword(password, userRow.password_hash);
        if (!passwordOk) {
          await recordFailedAttempt(email);
          throw new Error(GENERIC_LOGIN_ERROR);
        }

        // Candado de dispositivo: solo aplica a cuentas de pago (a pedido
        // del cliente, para que un usuario no pueda "prestar" su cuenta).
        // Admin y demo pueden seguir entrando desde cualquier lado.
        if (userRow.role === 'paid') {
          if (!deviceId) {
            // No debería pasar desde /login (siempre manda un deviceId),
            // pero sin uno no hay nada que validar ni vincular.
            await recordFailedAttempt(email);
            throw new Error(GENERIC_LOGIN_ERROR);
          }
          if (userRow.bound_device_id && userRow.bound_device_id !== deviceId) {
            await recordFailedAttempt(email);
            throw new Error(
              'Esta cuenta ya está vinculada a otro dispositivo. Contacta al administrador.'
            );
          }
        }

        // 2) Login correcto: registrar éxito + limpiar intentos fallidos +
        //    setear el nuevo token de sesión única (y vincular el
        //    dispositivo si es la primera vez), las 3 en una sola llamada
        //    RPC (antes eran 3 round-trips secuenciales).
        const sessionToken = randomUUID();
        const { error: completeError } = await supabase.rpc('complete_login', {
          p_user_id: userRow.id,
          p_identifier: email,
          p_session_token: sessionToken,
          p_device_id: userRow.role === 'paid' ? deviceId : null,
        });

        if (completeError) {
          console.error('auth: error en complete_login', completeError);
          throw new Error('No se pudo iniciar sesión. Prueba de nuevo.');
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
