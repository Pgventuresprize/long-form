-- Banderas de funciones: lo que esta en beta cerrada.
--
-- Una bandera global por funcion, apagada por defecto, y una excepcion por cuenta que manda sobre
-- la global. Quien no tiene la funcion ve un paywall con "Quiero acceso", que queda anotado en
-- funcion_interes. Las enciende un administrador desde /admin/funciones o desde la ficha de la
-- empresa.
--
-- Aditiva: aplicarla no enciende nada. El codigo que la lee trata la tabla ausente como apagada.
--
-- Para deshacer:
--   drop table if exists public.funcion_interes;
--   drop table if exists public.cuenta_funciones;
--   drop table if exists public.platform_funciones;
--   y devolver el check de admin_actividad.tipo a ('plan', 'acceso', 'bloqueo', 'plataforma').

create table if not exists public.platform_funciones (
  clave       text primary key,
  nombre      text not null,
  descripcion text not null default '',
  encendida   boolean not null default false,
  updated_at  timestamptz not null default now()
);
alter table public.platform_funciones enable row level security;

insert into public.platform_funciones (clave, nombre, descripcion) values
  ('long_form', 'Long-form', 'Convierte una grabación larga en un video editado, clips y carruseles.'),
  ('marcas_multiples', 'Marcas múltiples', 'Crear más de una marca y copiar lo común entre ellas.'),
  ('estilo_long_form', 'Estilo long form', 'El estilo editorial de los videos largos en Marca.')
on conflict (clave) do nothing;

create table if not exists public.cuenta_funciones (
  account_id uuid not null references public.accounts (id) on delete cascade,
  clave      text not null references public.platform_funciones (clave) on delete cascade,
  encendida  boolean not null,
  motivo     text,
  por        uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (account_id, clave)
);
alter table public.cuenta_funciones enable row level security;

create table if not exists public.funcion_interes (
  id         uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts (id) on delete cascade,
  user_id    uuid,
  correo     text,
  clave      text not null references public.platform_funciones (clave) on delete cascade,
  created_at timestamptz not null default now(),
  unique (account_id, clave)
);
create index if not exists funcion_interes_clave_idx on public.funcion_interes (clave, created_at desc);
alter table public.funcion_interes enable row level security;

-- Los cambios de banderas se anotan en la actividad del panel.
alter table public.admin_actividad drop constraint if exists admin_actividad_tipo_check;
alter table public.admin_actividad add constraint admin_actividad_tipo_check
  check (tipo in ('plan', 'acceso', 'bloqueo', 'plataforma', 'funcion'));
