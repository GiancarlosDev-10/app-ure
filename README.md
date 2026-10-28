# App URE — PWA de estudio (Next.js + Supabase + NextAuth + OpenAI)

PWA para que los alumnos practiquen con preguntas de opción múltiple
generadas por IA a partir del material de estudio (normas legales
peruanas convertidas a markdown). **En producción** en
`https://app-ure.vercel.app`, con Supabase real y alumnos usándola.

- **Admin**: crea usuarios (demo/pago, vencimiento, límite de preguntas),
  sube el material, lo asigna y ve el uso y el costo estimado de OpenAI.
- **Alumno**: elige material + dificultad, genera preguntas, responde con
  feedback inmediato y repasa las que falló.

Gestor de paquetes: **bun** (no npm — `bun install` bloquea scripts
`postinstall` por defecto, más seguro para dependencias de terceros).

## 1. Estructura

```
app/
  api/auth/[...nextauth]/route.ts        # endpoint de NextAuth
  api/admin/users/route.ts               # GET (listar) / POST (crear usuario)
  api/admin/users/[id]/route.ts          # PATCH (rol, activo, vencimiento, límite, reset pass)
  api/admin/users/[id]/duplicates/route.ts # GET preguntas repetidas de un usuario (soporte)
  api/admin/content/route.ts             # GET (listar) / POST (subir markdown + asignar)
  api/admin/content/[id]/route.ts        # PATCH (activar/desactivar) / DELETE (borra + sus preguntas)
  api/admin/content/paginate/route.ts    # POST vista previa: PDF+markdown → markdown con [página N] (no guarda)
  api/quiz/content/route.ts              # GET material asignado al alumno logueado
  api/quiz/generate/route.ts             # POST genera 1 pregunta con OpenAI (no revela la respuesta)
  api/quiz/answer/route.ts               # POST corrige, guarda, incrementa uso
  api/quiz/review/route.ts               # GET preguntas que el alumno falló (modo repaso, 0 tokens)
  api/quiz/review/answer/route.ts        # POST corrige en modo repaso (no consume cupo)
  login/page.tsx                         # login
  admin/page.tsx                         # dashboard: usuarios cerca del límite + costo estimado OpenAI
  admin/users/page.tsx                   # crear/editar usuarios
  admin/content/page.tsx                 # paginar, subir y asignar material
  student/page.tsx                       # generar/responder preguntas + "Practicar lo que fallé"
  layout.tsx, page.tsx, globals.css
components/                              # providers, session-guard, logo, theme-toggle, modal, etc.
lib/
  auth.ts           # NextAuthOptions: Credentials + bcrypt + sesión única
  apiAuth.ts        # requireRole()/handleApiError() para proteger route handlers
  schemas.ts        # validación zod
  openai.ts         # generateQuestion(): ventana de contexto + prompt + validación de la respuesta
  openaiCost.ts     # precios por modelo para el costo estimado de /admin
  pagination.ts     # motor que inserta marcadores [página N] en el markdown
  pdfText.ts        # extracción de texto por página de un PDF (unpdf)
  supabaseAdmin.ts  # cliente Supabase con service_role (solo servidor)
  password.ts       # hash/verify con bcryptjs
  rateLimit.ts      # 5 intentos fallidos / 15 min, respaldado en Supabase
types/              # tipos de tablas + extensión de Session/JWT
supabase/schema.sql # tablas + función increment_questions_used (atómica)
scripts/
  create-admin.ts   # crea/actualiza el usuario admin
  spij-to-md.ts     # norma del SPIJ (PDF) → markdown de estudio con [página N]
  paginate.ts       # CLI de paginación de cualquier markdown (usa lib/pagination.ts)
middleware.ts       # protege /admin, /student, /api/admin, /api/quiz por rol
next.config.js      # PWA (next-pwa)
```

## 2. Cómo funciona la generación de preguntas

1. El alumno entra a `/student`, elige un material asignado y un nivel
   (básico/intermedio/avanzado).
2. `POST /api/quiz/generate` revalida server-side que el material sea
   suyo, que la cuenta esté activa/vigente y con cupo; recién ahí llama a
   OpenAI.
3. `lib/openai.ts` arma el pedido:
   - **Ventana de contexto**: manda hasta ~20.000 caracteres del material,
     cortados en límites de página. La ventana rota pregunta a pregunta
     para recorrer todo el documento en vez de repetir las mismas páginas.
   - **Prompt**: reglas concretas por nivel (cuántas partes del material
     hay que combinar), distractores tomados del propio material, 1 de
     cada 3 preguntas en formato "completar el espacio".
   - **Orden del JSON**: `explanation` va **antes** de `correctIndex`, para
     que el modelo razone primero y elija después (con el orden inverso a
     veces la explicación justificaba otra opción).
   - Reglas para que **ninguna incorrecta sea verdadera** (ni como
     excepción) y para que la correcta sea un hecho del material, no una
     opinión.
4. La respuesta se valida con zod. Las páginas citadas se filtran contra
   las que realmente estaban en el contexto (nunca una página inventada) y
   la cita "Fuente: página N" la arma el código, no el modelo.
5. Se descarta una pregunta idéntica a una reciente del mismo alumno
   (hasta 2 reintentos) y se guarda en `quiz_questions`. **Al cliente solo
   se le manda la pregunta y las 4 opciones — nunca el índice correcto ni
   la explicación.**
6. El alumno responde → `POST /api/quiz/answer` compara contra lo guardado,
   incrementa `questions_used` con la función atómica
   `increment_questions_used` y recién ahí revela si acertó + la
   explicación.
7. **Repaso**: "Practicar lo que fallé" vuelve a mostrar las preguntas
   respondidas mal. No llama a OpenAI ni consume cupo.
8. **Aviso de límite**: `/admin` muestra un banner con los usuarios que
   pasaron su `alert_threshold` (por defecto 1800). Es solo visual, sin
   correo.

## 3. Modelo de OpenAI y costos

**Modelo actual: `gpt-4.1-mini`** (variable `OPENAI_MODEL`; si falta, el
código usa ese mismo por defecto).

Se eligió en oct. 2026 comparando 10 preguntas reales (mismo material y
semilla) con el prompt actual:

| Modelo | Errores graves | Latencia media | Precio (USD / 1M tokens, entrada / salida) |
|---|---|---|---|
| `gpt-4o-mini` | 5 de 10 | 3,3 s | $0,15 / $0,60 |
| **`gpt-4.1-mini`** | **0 de 10** | **4,4 s** | **$0,40 / $1,60** |
| `gpt-5-mini` | 0 de 10 | 16 s | $0,25 / $2,00 (+ tokens de razonamiento) |

Errores graves = dos opciones correctas, o explicación que contradice la
respuesta marcada.

- **Consumo**: ~5.400 tokens por pregunta (≈5.000 de entrada). A precio de
  lista sale ~$0,0025 por pregunta (~$2,50 cada 1.000).
- **Cupo gratis**: la organización de OpenAI tiene activado *Data controls
  → Sharing → Share inputs and outputs* (el material es normativa pública
  y no se envían datos de alumnos). Eso da hasta **2,5 M tokens diarios
  gratis** en modelos mini, unas **460 preguntas por día**. Lo que pase de
  ahí se cobra a precio de lista.
- **Cuenta prepaga** con recarga automática desactivada: si el saldo
  llega a $0 la generación falla hasta recargar, pero nunca se cobra de
  más.
- El **costo estimado de `/admin`** usa los precios de `lib/openaiCost.ts`
  y no sabe del cupo gratis, así que **sobreestima**. El gasto real se ve
  en *Usage* del dashboard de OpenAI.

**Para cambiar de modelo**: cambiá `OPENAI_MODEL` (local y Vercel) y
agregá su precio en `lib/openaiCost.ts` (si no está, el costo de esas
preguntas se cuenta como $0). Los modelos `gpt-5*` son de razonamiento:
`lib/openai.ts` ya les saca `temperature` (la rechazan) y les manda
`reasoning_effort: 'low'`.

## 4. Seguridad

- **bcrypt**: `lib/password.ts`, 12 salt rounds.
- **Sesión única por cuenta**: cada login genera un
  `current_session_token` nuevo en `users`. El callback `jwt` lo revalida
  contra la BD; si no coincide (login desde otro dispositivo), el
  middleware corta el acceso y `session-guard.tsx` hace `signOut()` con el
  aviso "se inició sesión en otro dispositivo". Resetear la contraseña
  desde el admin también corta la sesión activa.
- **Rate limiting (5 intentos / 15 min)**: `lib/rateLimit.ts`, respaldado
  en la tabla `login_attempts` (no en memoria: en Vercel cada invocación
  serverless es independiente).
- **Rutas protegidas dos veces**: `middleware.ts` (por rol) +
  `requireRole(...)` en cada route handler. `/api/quiz/*` revalida
  material/cupo/vigencia antes de gastar una llamada a OpenAI.
- **Variables de entorno**: ninguna clave hardcodeada (ver
  `.env.example`). `SUPABASE_SERVICE_ROLE_KEY` solo se usa en
  `lib/supabaseAdmin.ts`.
- **El PDF nunca se guarda**: la ruta de paginación lo procesa en memoria
  y solo se persiste el markdown final. A OpenAI solo viaja texto del
  material, nunca datos de alumnos.

## 5. Setup de Supabase (proyecto nuevo)

1. Creá un proyecto en [supabase.com](https://supabase.com).
2. En **SQL Editor** corré [`supabase/schema.sql`](supabase/schema.sql)
   completo: crea `users`, `study_content`, `quiz_questions`,
   `login_attempts`, la función `increment_questions_used`, RLS habilitado
   y sin policies públicas (todo el acceso es server-side con la
   service_role key).
3. En **Project Settings → API** copiá:
   - `Project URL` → `NEXT_PUBLIC_SUPABASE_URL`
   - `anon public` → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `service_role` → `SUPABASE_SERVICE_ROLE_KEY` (¡secreta, solo servidor!)

## 6. Setup local

```bash
bun install
cp .env.example .env.local
# completá .env.local con las claves de Supabase, OPENAI_API_KEY,
# OPENAI_MODEL y NEXTAUTH_SECRET (generar con: openssl rand -base64 32).

# crear el usuario admin
bun run create-admin -- admin@tudominio.com "unaClaveSegura123"

bun run dev
```

Abrí `http://localhost:3000` → redirige a `/login`. Con el admin:
`/admin` → **Usuarios** (crear un demo/pago) → **Contenido** (subir y
asignar material) → entrá con ese usuario a `/student`.

> `bun install` bloquea los scripts `postinstall` de dependencias que no
> conocés (aviso "Blocked N postinstall"). Es intencional: `bun pm
> untrusted` lista cuáles son y `bun pm trust <paquete>` habilita uno a
> mano.

### Preparar material nuevo

- **Normas del SPIJ**: `bun run spij-to-md` convierte el PDF (en
  `docs/pdf/`) en el markdown de estudio (en `docs/md/`): recorta los
  rangos del temario, quita concordancias y notas, deja la versión
  vigente de cada artículo y marcadores `[página N]` con la página real.
- **Otros documentos**: `bun run scripts/paginate.ts <md> <anchor>`, o la
  vista previa de paginación en `/admin/content` (sube PDF + markdown,
  devuelve el markdown paginado para revisar antes de asignarlo).

Los marcadores `[página N]` son los que permiten citar la fuente en cada
pregunta; un material sin ellos funciona, pero sin cita de página.

## 7. Deploy en Vercel

1. El repo está conectado a Vercel: **cada push a `main` despliega** solo.
2. Variables en **Project → Settings → Environment Variables**
   (Production y Preview), las mismas de `.env.example`.
   - **Un valor por variable, en una sola línea.** El campo Value es un
     cuadro de texto grande: si se pega `OPENAI_API_KEY` junto con otra
     línea, el SDK de OpenAI falla con "Connection error" (*not a legal
     HTTP header value*) y el alumno ve "Error interno del servidor".
   - Las variables tipo **Secret** no se pueden volver a leer ni pasar a
     Config: para corregir una, borrala y creala de nuevo.
   - `NEXTAUTH_URL` en producción: `https://app-ure.vercel.app`.
3. **Cambiar una variable no redeploya**: después de editarla hacé
   *Deployments → ⋯ → Redeploy* (o un push).
4. Si la generación falla en producción, el error real está en
   **Logs**, en la línea `API error:` de `/api/quiz/generate`.

## 8. Pendientes

- **Versión de Node**: `package.json` tiene `"node": ">=18.18.0"`, y
  Vercel avisa que sube de versión mayor sola. Conviene fijarla (ej.
  `"22.x"`) en un cambio aparte y probado.
- **Aviso previo de vencimiento**: el vencimiento ya se valida en cada
  login/request y antes de generar; falta avisar unos días antes.
- **Historial del alumno**: `quiz_questions` guarda todo, pero no hay una
  vista de "mi progreso" más allá del repaso de errores.
- **`sharp`** no está instalado (Vercel lo resuelve solo). Si se hace
  self-host fuera de Vercel, agregarlo.
