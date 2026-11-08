-- Long form, parte 2: proyectos, archivos, cola del motor, linea de tiempo, avisos y difusion.
--
-- Portado del esquema del motor (plogy-longform/supabase/schema.sql) con lo de Studio: cada tabla
-- lleva account_id, el acceso lo filtra el servidor (RLS activo y sin politicas) y las funciones de
-- la cola son security definer con execute quitado a public, anon y authenticated.
--
-- `estado` (jsonb) es lo que escribe cada etapa del motor (reparto, guion, render...), `fase` el paso
-- en que va y `tablero` la columna del inicio de Long-form. Aditiva: no cambia nada de lo que corre.
--
-- Para deshacer, en este orden:
--   drop table if exists public.lf_envios, public.lf_piezas, public.lf_ideas, public.lf_avisos,
--     public.lf_eventos, public.lf_trabajos, public.lf_archivos, public.lf_proyectos;
--   drop function if exists public.lf_encolar, public.lf_reclamar, public.lf_latido, public.lf_terminar,
--     public.lf_guardar_estado;

create table if not exists public.lf_proyectos (
  id             uuid primary key default gen_random_uuid(),
  account_id     uuid not null references public.accounts (id) on delete cascade,
  titulo         text not null,
  esfuerzo       text not null default 'normal',
  -- Lo decide la etapa clasificar; antes de eso, nulo.
  tipo           text,
  evidencia      jsonb not null default '{}'::jsonb,
  notas          text not null default '',
  cta_defecto    text,
  spec           jsonb not null default '{}'::jsonb,
  estado         jsonb not null default '{}'::jsonb,
  fase           text not null default 'borrador',
  detalle        text,
  progreso       real,
  tablero        text not null default 'subiendo',
  duracion_s     real,
  miniatura      text,
  creado_por     uuid,
  creado         timestamptz not null default now(),
  actualizado    timestamptz not null default now(),
  constraint lf_proyectos_esfuerzo_check check (esfuerzo in ('rapido', 'normal', 'detallado')),
  constraint lf_proyectos_tipo_check check (tipo is null or tipo in ('meet', 'camaras', 'partes', 'una_camara', 'podcast', 'charla', 'pantalla')),
  constraint lf_proyectos_tablero_check check (tablero in ('subiendo', 'procesando', 'revision', 'listo', 'difusion', 'enviado', 'error')),
  constraint lf_proyectos_titulo_len check (char_length(titulo) between 1 and 160)
);
create index if not exists lf_proyectos_cuenta_idx on public.lf_proyectos (account_id, actualizado desc);
alter table public.lf_proyectos enable row level security;

create table if not exists public.lf_archivos (
  id           uuid primary key default gen_random_uuid(),
  account_id   uuid not null references public.accounts (id) on delete cascade,
  proyecto_id  uuid not null references public.lf_proyectos (id) on delete cascade,
  tipo         text not null,
  nombre       text not null,
  -- <cuenta>/<proyecto>/entrada/... o .../salida/...: la arma el servidor.
  ruta         text not null,
  bytes        bigint,
  mime         text,
  -- Cada render es una version nueva; las anteriores se conservan.
  version      integer,
  -- Las entradas nacen pendientes y pasan a lista cuando termina su subida.
  subida       text not null default 'lista',
  rol          text,
  persona      text,
  meta         jsonb not null default '{}'::jsonb,
  creado       timestamptz not null default now(),
  constraint lf_archivos_tipo_check check (tipo in ('fuente', 'audio', 'pdf', 'ilustracion', 'foto', 'musica', 'salida', 'proxy', 'clip', 'zip', 'miniatura')),
  constraint lf_archivos_subida_check check (subida in ('pendiente', 'lista'))
);
create unique index if not exists lf_archivos_ruta_idx on public.lf_archivos (ruta);
create index if not exists lf_archivos_proyecto_idx on public.lf_archivos (proyecto_id, tipo);
alter table public.lf_archivos enable row level security;

-- La cola. `quien` dice quien la toma: el motor (video y audio) o Studio (los pasos de Claude).
create table if not exists public.lf_trabajos (
  id           bigserial primary key,
  account_id   uuid not null references public.accounts (id) on delete cascade,
  proyecto_id  uuid not null references public.lf_proyectos (id) on delete cascade,
  etapa        text not null,
  quien        text not null default 'motor',
  datos        jsonb not null default '{}'::jsonb,
  estado       text not null default 'pendiente',
  intentos     integer not null default 0,
  worker       text,
  lease_hasta  timestamptz,
  error        text,
  -- Segundos de maquina, minutos de audio, tokens: lo que costo la etapa.
  costo        jsonb not null default '{}'::jsonb,
  creado       timestamptz not null default now(),
  empezado     timestamptz,
  terminado    timestamptz,
  constraint lf_trabajos_estado_check check (estado in ('pendiente', 'corriendo', 'hecho', 'error', 'cancelado')),
  constraint lf_trabajos_quien_check check (quien in ('motor', 'studio'))
);
create index if not exists lf_trabajos_cola_idx on public.lf_trabajos (quien, estado, creado) where estado in ('pendiente', 'corriendo');
create index if not exists lf_trabajos_proyecto_idx on public.lf_trabajos (proyecto_id, id desc);
alter table public.lf_trabajos enable row level security;

-- La linea de tiempo del proyecto: cada etapa con su duracion y su costo, y lo que pasa en medio.
create table if not exists public.lf_eventos (
  id           bigserial primary key,
  account_id   uuid not null references public.accounts (id) on delete cascade,
  proyecto_id  uuid not null references public.lf_proyectos (id) on delete cascade,
  nivel        text not null default 'info',
  etapa        text,
  mensaje      text not null,
  inicio       timestamptz,
  fin          timestamptz,
  duracion_ms  bigint,
  costo        jsonb,
  creado       timestamptz not null default now()
);
create index if not exists lf_eventos_proyecto_idx on public.lf_eventos (proyecto_id, id desc);
alter table public.lf_eventos enable row level security;

-- Los avisos de la campana. Los ve toda la marca; cada persona los marca como leidos.
create table if not exists public.lf_avisos (
  id           uuid primary key default gen_random_uuid(),
  account_id   uuid not null references public.accounts (id) on delete cascade,
  proyecto_id  uuid references public.lf_proyectos (id) on delete cascade,
  tipo         text not null,
  titulo       text not null,
  cuerpo       text not null default '',
  accion       text,
  leido_por    uuid[] not null default '{}',
  creado       timestamptz not null default now(),
  constraint lf_avisos_tipo_check check (tipo in ('subida', 'transcripcion', 'revision', 'sugerencias', 'video', 'clips', 'parrilla', 'error'))
);
create index if not exists lf_avisos_cuenta_idx on public.lf_avisos (account_id, creado desc);
alter table public.lf_avisos enable row level security;

-- Difusion: las ideas del video, las piezas propuestas (clips y carruseles) y lo enviado a la parrilla.
create table if not exists public.lf_ideas (
  id               uuid primary key default gen_random_uuid(),
  account_id       uuid not null references public.accounts (id) on delete cascade,
  proyecto_id      uuid not null references public.lf_proyectos (id) on delete cascade,
  tipo             text not null,
  inicio           real not null,
  fin              real not null,
  quien            text,
  cita             text not null default '',
  cita_verificada  boolean not null default false,
  resumen          text not null default '',
  porque           text not null default '',
  creado           timestamptz not null default now()
);
create index if not exists lf_ideas_proyecto_idx on public.lf_ideas (proyecto_id, inicio);
alter table public.lf_ideas enable row level security;

create table if not exists public.lf_piezas (
  id           uuid primary key default gen_random_uuid(),
  account_id   uuid not null references public.accounts (id) on delete cascade,
  proyecto_id  uuid not null references public.lf_proyectos (id) on delete cascade,
  idea_id      uuid references public.lf_ideas (id) on delete set null,
  tipo         text not null,
  estado       text not null default 'propuesta',
  inicio       real,
  fin          real,
  datos        jsonb not null default '{}'::jsonb,
  creado       timestamptz not null default now(),
  actualizado  timestamptz not null default now(),
  constraint lf_piezas_tipo_check check (tipo in ('clip', 'carrusel')),
  constraint lf_piezas_estado_check check (estado in ('propuesta', 'aprobada', 'descartada', 'renderizando', 'lista', 'enviada', 'error'))
);
create index if not exists lf_piezas_proyecto_idx on public.lf_piezas (proyecto_id, tipo, estado);
alter table public.lf_piezas enable row level security;

create table if not exists public.lf_envios (
  id                uuid primary key default gen_random_uuid(),
  account_id        uuid not null references public.accounts (id) on delete cascade,
  pieza_id          uuid not null unique references public.lf_piezas (id) on delete cascade,
  chat_trabajo_id   uuid,
  raw_news_id       uuid,
  content_piece_id  uuid,
  conversacion_id   uuid,
  creado            timestamptz not null default now()
);
alter table public.lf_envios enable row level security;

-- ------------------------------------------------------------------- la cola

-- Encola una etapa; si ya hay una igual pendiente para el proyecto, no la duplica.
create or replace function public.lf_encolar(p_proyecto uuid, p_etapa text, p_datos jsonb default '{}'::jsonb, p_quien text default 'motor')
returns bigint language plpgsql security definer set search_path = public as $$
declare v_id bigint; v_cuenta uuid;
begin
  select account_id into v_cuenta from lf_proyectos where id = p_proyecto;
  if v_cuenta is null then raise exception 'proyecto % no existe', p_proyecto; end if;
  select id into v_id from lf_trabajos
   where proyecto_id = p_proyecto and etapa = p_etapa and estado = 'pendiente' limit 1;
  if v_id is not null then return v_id; end if;
  insert into lf_trabajos (account_id, proyecto_id, etapa, quien, datos)
  values (v_cuenta, p_proyecto, p_etapa, coalesce(p_quien, 'motor'), coalesce(p_datos, '{}'::jsonb))
  returning id into v_id;
  update lf_proyectos set fase = 'en_cola', detalle = p_etapa, actualizado = now() where id = p_proyecto;
  return v_id;
end $$;

-- Toma el trabajo mas antiguo de quien lo pide. Un proyecto nunca corre dos etapas a la vez; un
-- trabajo cuyo lease vencio vuelve a la cola, hasta tres intentos. Las cuentas suspendidas esperan.
create or replace function public.lf_reclamar(p_worker text, p_lease_seg integer default 900, p_quien text default 'motor')
returns setof public.lf_trabajos language plpgsql security definer set search_path = public as $$
declare v lf_trabajos;
begin
  update lf_trabajos set estado = 'error', error = 'Se detuvo tres veces en esta etapa.', terminado = now()
   where estado = 'corriendo' and lease_hasta < now() and intentos >= 3;
  select t.* into v from lf_trabajos t
    join accounts a on a.id = t.account_id
   where t.quien = coalesce(p_quien, 'motor')
     and a.suspendida_en is null
     and (t.estado = 'pendiente' or (t.estado = 'corriendo' and t.lease_hasta < now()))
     and not exists (select 1 from lf_trabajos o where o.proyecto_id = t.proyecto_id and o.id <> t.id
                     and o.estado = 'corriendo' and o.lease_hasta >= now())
   order by t.creado
   for update of t skip locked
   limit 1;
  if v.id is null then return; end if;
  update lf_trabajos set estado = 'corriendo', worker = p_worker, intentos = intentos + 1,
         lease_hasta = now() + make_interval(secs => p_lease_seg), empezado = coalesce(empezado, now())
   where id = v.id returning * into v;
  return next v;
end $$;

create or replace function public.lf_latido(p_trabajo bigint, p_lease_seg integer default 900)
returns void language sql security definer set search_path = public as $$
  update lf_trabajos set lease_hasta = now() + make_interval(secs => p_lease_seg)
   where id = p_trabajo and estado = 'corriendo';
$$;

create or replace function public.lf_terminar(p_trabajo bigint, p_ok boolean, p_error text default null, p_costo jsonb default null)
returns void language sql security definer set search_path = public as $$
  update lf_trabajos set estado = case when p_ok then 'hecho' else 'error' end,
         error = nullif(p_error, ''), terminado = now(), lease_hasta = null,
         costo = coalesce(p_costo, costo)
   where id = p_trabajo;
$$;

-- Merge atomico de una clave del estado: dos etapas nunca se pisan.
create or replace function public.lf_guardar_estado(p_proyecto uuid, p_clave text, p_valor jsonb)
returns void language sql security definer set search_path = public as $$
  update lf_proyectos set estado = jsonb_set(coalesce(estado, '{}'::jsonb), array[p_clave], coalesce(p_valor, 'null'::jsonb), true),
         actualizado = now()
   where id = p_proyecto;
$$;

revoke execute on function public.lf_encolar(uuid, text, jsonb, text) from public, anon, authenticated;
revoke execute on function public.lf_reclamar(text, integer, text) from public, anon, authenticated;
revoke execute on function public.lf_latido(bigint, integer) from public, anon, authenticated;
revoke execute on function public.lf_terminar(bigint, boolean, text, jsonb) from public, anon, authenticated;
revoke execute on function public.lf_guardar_estado(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.lf_encolar(uuid, text, jsonb, text) to service_role;
grant execute on function public.lf_reclamar(text, integer, text) to service_role;
grant execute on function public.lf_latido(bigint, integer) to service_role;
grant execute on function public.lf_terminar(bigint, boolean, text, jsonb) to service_role;
grant execute on function public.lf_guardar_estado(uuid, text, jsonb) to service_role;
