-- ============================================================
-- APP URE — Esquema de base de datos (Supabase / Postgres)
-- ============================================================
-- Ejecutar en: Supabase Dashboard > SQL Editor
--
-- Notas de diseño:
-- - La autenticación la maneja NextAuth (Credentials + bcrypt), NO Supabase Auth.
--   Por eso la tabla `users` es propia (no auth.users) y solo se accede
--   desde el servidor con la service_role key.
-- - RLS queda habilitado en todas las tablas sin policies públicas:
--   nadie con la anon key puede leer/escribir nada. Solo la service_role
--   key (usada exclusivamente en server actions / API routes) puede
--   operar, porque service_role ignora RLS por diseño de Supabase.
-- - El PDF original NUNCA se guarda. Solo se persiste el markdown ya
--   procesado (columna study_content.markdown).
-- ============================================================

create extension if not exists "pgcrypto";

-- ------------------------------------------------------------
-- Tabla: users
-- Mapeo de los campos pedidos:
--   id                  -> id
--   correo              -> email
--   contraseña hasheada -> password_hash (bcrypt)
--   rol                 -> role ('admin' | 'demo' | 'paid')
--   activo              -> active
--   fecha vencimiento   -> expiration_date (default 2026-09-30)
--   preguntas usadas    -> questions_used
--   límite de preguntas -> questions_limit (default 2000)
-- ------------------------------------------------------------
create table if not exists public.users (
  id                          uuid primary key default gen_random_uuid(),
  email                       text not null unique,
  password_hash               text not null,
  role                        text not null default 'demo'
                              check (role in ('admin', 'demo', 'paid')),
  active                      boolean not null default true,
  expiration_date             date not null default '2026-09-30',
  questions_used              integer not null default 0 check (questions_used >= 0),
  questions_limit             integer not null default 2000 check (questions_limit > 0),
  -- Umbral para el aviso "cerca del límite" que se ve en /admin (banner
  -- calculado en vivo: questions_used >= alert_threshold). No dispara
  -- correo, solo se muestra en el dashboard del admin.
  alert_threshold             integer not null default 1800,
  -- Control de sesión única por cuenta:
  current_session_token       text,
  current_session_created_at  timestamptz,
  -- Columna en desuso: hubo un candado de dispositivo para cuentas 'paid'
  -- (bloqueaba el login desde un segundo dispositivo hasta que un admin lo
  -- liberaba a mano). Se sacó porque generaba falsos bloqueos (el ID vivía
  -- en localStorage del navegador, no en el hardware, así que cambiar de
  -- navegador/PWA en el mismo dispositivo ya lo disparaba) y porque la
  -- sesión única (current_session_token) ya evita el uso simultáneo sin
  -- necesidad de bloquear el login. Se deja la columna sin usar en vez de
  -- borrarla para no perder el historial de qué dispositivo se vinculó.
  bound_device_id              text,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now()
);

create index if not exists users_email_idx on public.users (lower(email));
create index if not exists users_role_idx on public.users (role);

-- ------------------------------------------------------------
-- Tabla: study_content
-- Markdown subido por el admin y asignado a un usuario puntual.
-- El PDF nunca se sube: solo llega texto/markdown ya convertido.
-- ------------------------------------------------------------
create table if not exists public.study_content (
  id            uuid primary key default gen_random_uuid(),
  title         text not null,
  markdown      text not null,
  assigned_to   uuid not null references public.users (id) on delete cascade,
  created_by    uuid not null references public.users (id) on delete restrict,
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists study_content_assigned_to_idx on public.study_content (assigned_to);

-- ------------------------------------------------------------
-- Tabla: quiz_questions
-- Registro de cada pregunta generada por OpenAI a partir del
-- markdown, la dificultad elegida y la respuesta del usuario.
-- Sirve de auditoría y para llevar questions_used de forma exacta.
-- ------------------------------------------------------------
create table if not exists public.quiz_questions (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.users (id) on delete cascade,
  content_id      uuid not null references public.study_content (id) on delete cascade,
  difficulty      text not null check (difficulty in ('basico', 'intermedio', 'avanzado')),
  question        text not null,
  options         jsonb not null, -- ["opción A", "opción B", "opción C", "opción D"]
  correct_index   integer not null check (correct_index between 0 and 3),
  explanation     text not null, -- se guarda al generar, se muestra recién al responder
  user_answer_index integer,
  is_correct      boolean,
  answered_at     timestamptz,
  -- Tokens reales que devolvió OpenAI para esta generación (completion.usage).
  -- Quedan NULL en preguntas generadas antes de que se empezara a trackear
  -- esto — el costo acumulado del panel admin arranca desde ahí, no
  -- inventa el gasto histórico (ver lib/openaiCost.ts).
  prompt_tokens     integer,
  completion_tokens integer,
  created_at      timestamptz not null default now()
);

create index if not exists quiz_questions_user_id_idx on public.quiz_questions (user_id);

-- ------------------------------------------------------------
-- Tabla: login_attempts
-- Soporte para rate limiting (5 intentos) en el login.
-- ------------------------------------------------------------
create table if not exists public.login_attempts (
  id            uuid primary key default gen_random_uuid(),
  identifier    text not null, -- normalmente email normalizado en minúsculas
  ip            text,
  success       boolean not null,
  attempted_at  timestamptz not null default now()
);

create index if not exists login_attempts_identifier_idx on public.login_attempts (identifier, attempted_at desc);

-- ------------------------------------------------------------
-- Trigger genérico para mantener updated_at al día
-- ------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_users_updated_at on public.users;
create trigger trg_users_updated_at
  before update on public.users
  for each row execute function public.set_updated_at();

drop trigger if exists trg_content_updated_at on public.study_content;
create trigger trg_content_updated_at
  before update on public.study_content
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------
-- Función: increment_questions_used
-- Incrementa questions_used de forma atómica (UPDATE ... RETURNING en
-- una sola sentencia, sin round-trip de "leer, sumar en la app, escribir"
-- que podría pisarse entre requests concurrentes del mismo usuario).
-- ------------------------------------------------------------
create or replace function public.increment_questions_used(p_user_id uuid)
returns table (
  questions_used   integer,
  questions_limit  integer
) as $$
begin
  return query
    update public.users
    set questions_used = users.questions_used + 1
    where users.id = p_user_id
    returning users.questions_used, users.questions_limit;
end;
$$ language plpgsql;

-- ------------------------------------------------------------
-- Función: submit_answer
-- Junta en una sola llamada (antes eran 3 round-trips secuenciales:
-- buscar la pregunta, guardar la respuesta, incrementar el contador) la
-- validación de dueño/no-respondida + la corrección + el incremento de
-- questions_used. FOR UPDATE bloquea la fila mientras dura la función
-- para que un doble submit simultáneo de la misma pregunta no cuente
-- dos veces.
-- ------------------------------------------------------------
create or replace function public.submit_answer(
  p_question_id uuid,
  p_user_id uuid,
  p_selected_index int
) returns table (
  correct_index    integer,
  explanation      text,
  is_correct       boolean,
  questions_used   integer,
  questions_limit  integer
) as $$
declare
  v_correct_index integer;
  v_explanation   text;
  v_owner         uuid;
  v_answered_at   timestamptz;
  v_is_correct    boolean;
begin
  select qq.correct_index, qq.explanation, qq.user_id, qq.answered_at
  into v_correct_index, v_explanation, v_owner, v_answered_at
  from public.quiz_questions qq
  where qq.id = p_question_id
  for update;

  if v_owner is null then
    raise exception 'question_not_found';
  end if;
  if v_owner <> p_user_id then
    raise exception 'question_not_owned';
  end if;
  if v_answered_at is not null then
    raise exception 'already_answered';
  end if;

  v_is_correct := (p_selected_index = v_correct_index);

  update public.quiz_questions
  set user_answer_index = p_selected_index,
      is_correct = v_is_correct,
      answered_at = now()
  where id = p_question_id;

  update public.users
  set questions_used = users.questions_used + 1
  where id = p_user_id;

  return query
    select v_correct_index, v_explanation, v_is_correct,
           u.questions_used, u.questions_limit
    from public.users u
    where u.id = p_user_id;
end;
$$ language plpgsql;

-- ------------------------------------------------------------
-- Función: complete_login
-- Junta en una sola llamada (un solo round-trip de red) las 3 escrituras
-- que pasan justo después de validar la contraseña: registrar el intento
-- exitoso, limpiar los intentos fallidos previos, y setear el nuevo
-- token de sesión única. Antes eran 3 llamadas HTTP secuenciales
-- separadas; en Vercel Hobby (función en iad1, Supabase en sa-east-1)
-- cada una paga el cruce de continente, así que juntarlas en una función
-- de Postgres ahorra ese costo dos veces.
-- ------------------------------------------------------------
drop function if exists public.complete_login(uuid, text, text);
drop function if exists public.complete_login(uuid, text, text, text);

create or replace function public.complete_login(
  p_user_id uuid,
  p_identifier text,
  p_session_token text
) returns void as $$
begin
  insert into public.login_attempts (identifier, success)
  values (p_identifier, true);

  delete from public.login_attempts
  where identifier = p_identifier and success = false;

  update public.users
  set current_session_token = p_session_token,
      current_session_created_at = now()
  where id = p_user_id;
end;
$$ language plpgsql;

-- ------------------------------------------------------------
-- Row Level Security: habilitado, sin policies para anon/authenticated.
-- Todo el acceso ocurre server-side con la service_role key.
-- ------------------------------------------------------------
alter table public.users enable row level security;
alter table public.study_content enable row level security;
alter table public.quiz_questions enable row level security;
alter table public.login_attempts enable row level security;

-- ------------------------------------------------------------
-- Grants: RLS controla QUÉ filas puede tocar cada rol, pero primero
-- Postgres exige que el rol tenga permiso para tocar la tabla. El rol
-- "service_role" (el que usa la SUPABASE_SERVICE_ROLE_KEY / secret key)
-- ignora RLS por completo, pero igual necesita estos grants explícitos;
-- si las tablas se crearon desde el SQL Editor en vez del Table Editor,
-- Supabase no los otorga solo. anon/authenticated NO reciben nada acá
-- a propósito: nunca deben poder tocar estas tablas directo.
-- ------------------------------------------------------------
grant usage on schema public to service_role;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;

alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant all on sequences to service_role;
alter default privileges in schema public grant execute on functions to service_role;

-- ------------------------------------------------------------
-- Seed opcional: primer usuario admin (cambia el hash antes de correrlo).
-- Genera el hash con bcrypt (ver lib/password.ts) y pégalo aquí, o
-- crea el admin desde un script/API en vez de SQL a mano.
-- ------------------------------------------------------------
-- insert into public.users (email, password_hash, role, active)
-- values ('admin@tudominio.com', '$2a$12$REEMPLAZAR_HASH', 'admin', true);
