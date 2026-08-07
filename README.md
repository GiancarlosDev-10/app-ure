# App URE — PWA de estudio (Next.js + Supabase + NextAuth + OpenAI)

Estado actual: **el flujo completo está programado** — estructura del
proyecto, Supabase, NextAuth (roles, bcrypt, sesión única, rate limiting),
panel de admin (usuarios + carga de contenido markdown) y generación de
preguntas con OpenAI (contador de uso + alerta a los 1800). Lo único que
falta es **conectar un Supabase real** — ver sección 3 — porque hasta
ahora todo se verificó con `bun run typecheck` / `bun run build` y
variables de entorno de prueba, nunca contra una base de datos de verdad.

Gestor de paquetes: **bun** (no npm — `bun install` bloquea scripts
`postinstall` por defecto, más seguro para dependencias de terceros).

## 1. Qué quedó armado

```
app/
  api/auth/[...nextauth]/route.ts     # endpoint de NextAuth
  api/admin/users/route.ts            # GET (listar) / POST (crear usuario)
  api/admin/users/[id]/route.ts       # PATCH (rol, activo, vencimiento, límite, reset pass)
  api/admin/content/route.ts          # GET (listar) / POST (subir markdown + asignar)
  api/quiz/content/route.ts           # GET contenido asignado al alumno logueado
  api/quiz/generate/route.ts          # POST genera 1 pregunta con OpenAI (no revela la respuesta)
  api/quiz/answer/route.ts            # POST corrige, guarda, incrementa uso, dispara alerta 1800
  login/page.tsx                      # login (client component)
  admin/page.tsx                      # dashboard admin (nav + banner de usuarios cerca del límite)
  admin/users/page.tsx                # crear/editar usuarios (rol, activo, vencimiento, límite, reset pass)
  admin/content/page.tsx              # subir markdown + asignar a usuario + listado
  student/page.tsx                    # elegir material+dificultad, responder, feedback inmediato
  layout.tsx, providers.tsx           # SessionProvider + manifest PWA
  session-guard.tsx                   # fuerza logout si la sesión se invalidó
  sign-out-button.tsx, logo.tsx
  page.tsx                            # redirige según sesión/rol
  globals.css
lib/
  auth.ts             # NextAuthOptions: Credentials + bcrypt + sesión única
  apiAuth.ts           # requireRole()/handleApiError() para proteger route handlers
  schemas.ts           # validación zod (usuarios, contenido, generar/responder pregunta)
  openai.ts             # generateQuestion(): prompt + JSON mode + validación zod de la respuesta
  supabaseAdmin.ts       # cliente Supabase con service_role (solo servidor)
  password.ts             # hash/verify con bcryptjs
  rateLimit.ts             # 5 intentos fallidos / 15 min, respaldado en Supabase
types/
  index.ts                   # tipos de las tablas + tipos "seguros para cliente"
  next-auth.d.ts              # extensión de Session/JWT (id, role, error)
supabase/
  schema.sql                    # tablas + función increment_questions_used (atómica)
scripts/
  create-admin.ts                 # crea/actualiza el primer usuario admin (bun run)
middleware.ts                      # protege /admin, /student, /api/admin, /api/quiz por rol
next.config.js                       # PWA (next-pwa)
public/
  manifest.json, favicon-32.png
  icons/ (icon-192.png, icon-512.png, apple-touch-icon.png)
  images/logo.jpg
.env.example
```

## 2. Cómo funciona la generación de preguntas

1. El alumno entra a `/student`, elige entre el material que el admin le
   asignó y un nivel (básico/intermedio/avanzado).
2. `POST /api/quiz/generate` revalida server-side que el contenido sea
   suyo, que la cuenta esté activa/vigente y que no haya llegado al
   límite; recién ahí llama a OpenAI (`lib/openai.ts`, `gpt-4o-mini`,
   `response_format: json_object`) pidiéndole una pregunta en JSON, la
   valida con zod y la guarda en `quiz_questions`. **Al cliente solo se le
   manda la pregunta y las 4 opciones — nunca el índice correcto ni la
   explicación.**
3. El alumno responde → `POST /api/quiz/answer` compara contra lo
   guardado en el servidor, marca la pregunta como respondida (no se
   puede recontar dos veces la misma), incrementa `questions_used` con la
   función atómica `increment_questions_used` (evita condiciones de
   carrera) y recién en la respuesta revela si acertó + la explicación.
4. **Alerta de los 1800**: el admin la ve directo en `/admin` — un banner
   (⚠️ N usuario(s) cerca del límite, con el detalle de cada uno)
   calculado en el momento contra `questions_used`/`alert_threshold`. No
   hay correo ni servicio externo involucrado: es una decisión deliberada,
   no una limitación — se resolvió así a propósito en vez de con Resend.

## 3. Cómo quedó resuelto cada requisito de seguridad

- **bcrypt**: `lib/password.ts`, 12 salt rounds.
- **Sesión única por cuenta**: en `authorize()` se genera un
  `current_session_token` nuevo en cada login y se guarda en `users`. El
  callback `jwt` de NextAuth revalida ese token contra la BD en cada
  request; si no coincide (login desde otro dispositivo), marca
  `token.invalidated = true`. El middleware corta el acceso (páginas →
  redirect a `/login`; API → 401 JSON) y `session-guard.tsx` fuerza
  `signOut()` en el cliente con el mensaje "se inició sesión en otro
  dispositivo". Resetear la contraseña desde el panel admin también corta
  la sesión activa de esa cuenta.
- **Rate limiting (5 intentos)**: `lib/rateLimit.ts`, respaldado en la
  tabla `login_attempts` de Supabase (no en memoria, porque en Vercel cada
  invocación serverless es independiente). Ventana de 15 minutos,
  configurable en el mismo archivo.
- **Rutas protegidas dos veces**: `middleware.ts` (edge, por rol) +
  `requireRole(...)` dentro de cada route handler (`lib/apiAuth.ts`), para
  que un matcher mal configurado no deje nada expuesto. `/api/quiz/*`
  además revalida contenido/cupo/vigencia server-side antes de gastar una
  llamada a OpenAI, y la respuesta correcta nunca viaja al cliente hasta
  que el alumno ya contestó.
- **Variables de entorno**: todas las claves (Supabase, OpenAI, NextAuth)
  están en `.env.example`, nunca hardcodeadas. La
  `SUPABASE_SERVICE_ROLE_KEY` solo se usa en `lib/supabaseAdmin.ts`, que
  explícitamente revienta si se intenta importar desde el cliente.
- **PDF nunca se sube**: no existe ningún endpoint que acepte PDF; el
  formulario de admin, el esquema (`study_content.markdown`) y el prompt
  a OpenAI solo manejan texto markdown ya procesado.

## 4. Setup de Supabase (pendiente — esto es lo único que falta para probar todo)

1. Creá un proyecto en [supabase.com](https://supabase.com).
2. Andá a **SQL Editor** y corré el contenido de [`supabase/schema.sql`](supabase/schema.sql)
   completo. Crea las tablas `users`, `study_content`, `quiz_questions`,
   `login_attempts`, la función `increment_questions_used`, RLS habilitado
   y sin policies públicas (todo el acceso es server-side con la
   service_role key).
3. En **Project Settings → API** copiá:
   - `Project URL` → `NEXT_PUBLIC_SUPABASE_URL`
   - `anon public` → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `service_role` → `SUPABASE_SERVICE_ROLE_KEY` (¡secreta, solo servidor!)

## 5. Setup local

```bash
bun install
cp .env.example .env.local
# completá .env.local con las claves de Supabase, OPENAI_API_KEY y
# NEXTAUTH_SECRET (generar con: openssl rand -base64 32).

# crear el primer usuario admin
bun run create-admin -- admin@tudominio.com "unaClaveSegura123"

bun run dev
```

Abrí `http://localhost:3000` → te redirige a `/login`. Con el admin
creado: `/admin` → **Usuarios** (crear un demo/pago) → **Contenido**
(subir markdown y asignarlo) → deslogueate y entrá con ese usuario a
`/student` para generar y responder preguntas.

> `bun install` bloquea por defecto los scripts `postinstall` de
> dependencias transitivas que no conocés (vas a ver un aviso "Blocked N
> postinstall"). Es intencional. Si algún día hace falta confiar en uno,
> `bun pm untrusted` lista cuáles son y `bun pm trust <paquete>` lo habilita
> a mano — nunca automático.

## 6. Deploy en Vercel

1. Importá el repo en Vercel.
2. En **Project Settings → General**, confirmá que detecta `bun.lock` y usa
   Bun como package manager (Vercel lo autodetecta por el lockfile).
3. Cargá todas las variables de `.env.example` en **Project Settings →
   Environment Variables** (Production y Preview).
4. `NEXTAUTH_URL` en producción debe ser la URL pública (ej.
   `https://app-ure.vercel.app`).

## 7. Próximos pasos (no incluidos todavía)

- **Smoke test contra Supabase real**: nada de lo de arriba se probó con
  datos reales todavía. En cuanto haya proyecto de Supabase, conviene
  correr el flujo completo una vez de punta a punta (crear admin → crear
  demo → subir contenido → generar y responder preguntas → confirmar que
  `questions_used` sube y que el correo de alerta llega a los 1800).
- **Vencimiento 30/09**: ya se valida en cada login y en cada request
  (`jwt` callback) y también antes de generar una pregunta; falta la
  variante "aviso previo" si se quiere avisar unos días antes de vencer.
- **Panel de contenido**: por ahora solo permite crear/listar. Falta
  editar/desactivar/reasignar un `study_content` existente.
- **Historial del alumno**: `quiz_questions` ya guarda todo (correcta,
  elegida, si acertó), pero no hay una vista de "mi progreso" todavía.
- **`sharp`** no está instalado (no hace falta en Vercel, lo resuelve la
  plataforma). Si en algún momento se hace self-host fuera de Vercel,
  agregarlo como dependencia para que la optimización de imágenes ande
  igual de rápido.
