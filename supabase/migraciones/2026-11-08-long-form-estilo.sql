-- Long form, parte 1: el estilo editorial de cada marca y su biblioteca de audio.
--
-- lf_estilos guarda el estilo de long form de una cuenta (src/engine/long-form/estilo.ts): colores,
-- fuente, logos, CTA de video, musica, efectos, subtitulos, silencios, densidad de graficos, clips,
-- nivel de esfuerzo y personas recurrentes. lf_biblioteca guarda la musica y los efectos (MP3 o WAV)
-- que el estilo usa por id.
--
-- Todo con account_id, RLS activo y sin politicas: el filtro lo pone el servidor, como el resto de
-- Studio. Los archivos van al bucket privado `longform`, en <cuenta>/estilo/...
--
-- Aditiva: no cambia nada de lo que corre.
--
-- Para deshacer:
--   drop table if exists public.lf_biblioteca;
--   drop table if exists public.lf_estilos;
--   delete from storage.buckets where id = 'longform';  -- solo si esta vacio

create table if not exists public.lf_estilos (
  account_id  uuid primary key references public.accounts (id) on delete cascade,
  config      jsonb not null default '{}'::jsonb,
  -- Paso el onboarding de long form (la persona confirmo la propuesta).
  listo       boolean not null default false,
  version     integer not null default 1,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
alter table public.lf_estilos enable row level security;

create table if not exists public.lf_biblioteca (
  id              uuid primary key default gen_random_uuid(),
  account_id      uuid not null references public.accounts (id) on delete cascade,
  tipo            text not null,
  -- Para que momento es (intro, cierre, rotulo, barra, popup, cita, pregunta, transicion...).
  momento         text,
  nombre          text not null default '',
  ruta            text not null,
  formato         text not null,
  bytes           bigint not null,
  duracion_s      real,
  -- Se confirma al subir (firma del archivo) y otra vez en el motor (ffprobe).
  verificado      boolean not null default false,
  created_at      timestamptz not null default now(),
  constraint lf_biblioteca_tipo_check    check (tipo in ('musica', 'sfx')),
  constraint lf_biblioteca_formato_check check (formato in ('mp3', 'wav')),
  constraint lf_biblioteca_bytes_check   check (bytes > 0 and bytes <= 52428800),
  constraint lf_biblioteca_nombre_len    check (char_length(nombre) <= 120)
);
create index if not exists lf_biblioteca_cuenta_idx on public.lf_biblioteca (account_id, tipo, created_at desc);
create unique index if not exists lf_biblioteca_ruta_idx on public.lf_biblioteca (ruta);
alter table public.lf_biblioteca enable row level security;

-- El bucket privado de long form. Sin limite propio por archivo: manda el del proyecto (en Pro se
-- sube en Storage > Settings para que entren las grabaciones).
insert into storage.buckets (id, name, public)
values ('longform', 'longform', false)
on conflict (id) do nothing;
