'use client';

import { Suspense, useState, type FormEvent } from 'react';
import { signIn, getSession } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Logo } from '@/components/logo';
import { EyeIcon, EyeOffIcon } from '@/components/icons';

const URL_ERROR_MESSAGES: Record<string, string> = {
  'session-invalidated':
    'Tu sesión se cerró porque se inició sesión con esta cuenta en otro dispositivo.',
};

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const urlError = searchParams.get('error');

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(
    urlError ? URL_ERROR_MESSAGES[urlError] ?? null : null
  );

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const res = await signIn('credentials', {
      email,
      password,
      redirect: false,
    });

    if (res?.error) {
      setLoading(false);
      setError(res.error);
      return;
    }

    // En vez de mandar a "/" y que esa página vuelva a resolver el rol
    // con su propia consulta a Supabase (otro round-trip completo + un
    // render de página de más), lo resolvemos acá con el fetch de sesión
    // que de todas formas hace falta hacer una vez logueado.
    const session = await getSession();
    setLoading(false);

    const destination = session?.user?.role === 'admin' ? '/admin' : '/student';
    router.push(destination);
    router.refresh();
  }

  return (
    <main className="container center-screen">
      <div className="card">
        <div className="brand-header">
          <Logo size={72} />
          <h1>Bienvenido</h1>
        </div>
        <form onSubmit={handleSubmit}>
          <label htmlFor="email">Correo</label>
          <input
            id="email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
          />

          <label htmlFor="password">Contraseña</label>
          <div className="input-toggle-wrap">
            <input
              id="password"
              type={showPassword ? 'text' : 'password'}
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
            <button
              type="button"
              className="toggle-visibility-btn"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
              tabIndex={-1}
            >
              {showPassword ? <EyeOffIcon /> : <EyeIcon />}
            </button>
          </div>

          <button type="submit" disabled={loading}>
            {loading ? 'Ingresando…' : 'Ingresar'}
          </button>

          {error && <p className="error">{error}</p>}
        </form>
      </div>
    </main>
  );
}
