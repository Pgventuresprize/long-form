-- ---------------------------------------------------------------------------
-- Esquema completo de engine-hancel.
--
-- Reconstruye la base entera desde cero. Es idempotente: se puede volver a
-- ejecutar sobre una base existente sin borrar datos ni duplicar objetos.
--
-- Uso: Supabase Dashboard -> SQL Editor -> pegar todo -> Run.
-- Despues, scheduler.sql monta el cron del motor dentro de Postgres.
--
-- Orden: tablas -> indices -> RLS -> semillas. Las dependencias por clave
-- foranea obligan a crear engine_categories antes que engine_segments y
-- pipeline_runs antes que pipeline_events.
-- ---------------------------------------------------------------------------

create extension if not exists pgcrypto;

-- ------------------------------------------------------------------ noticias

-- El corpus. Una fila por articulo; `link` es la identidad real de una noticia
-- y por eso lleva UNIQUE: la ingesta hace upsert con onConflict:"link" e
-- ignoreDuplicates, que es un ON CONFLICT DO NOTHING sobre esta restriccion.
create table if not exists public.raw_news (
  id                   uuid primary key default gen_random_uuid(),

  -- Escrito por la ingesta desde la taxonomia: niche = engine_categories.slug,
  -- tema = engine_segments.label. Son texto plano, no claves foraneas: una
  -- noticia sobrevive al borrado del segmento que la trajo.
  niche                text        not null,
  tema                 text        not null,

  title                text        not null,
  link                 text        not null,
  snippet              text,
  -- Serper devuelve la fecha como texto libre ("2 hours ago"), no como fecha.
  date_serper          text,
  source               text,
  image_url            text,

  status               text        not null default 'pending_analysis',

  -- Los rellena el agente de analisis, no la ingesta.
  relevance_score      numeric,
  keywords_matched     text[],
  analysis_notes       text,

  query_used           text,
  created_at           timestamptz not null default now(),
  analyzed_at          timestamptz,

  -- Cuerpo completo del articulo, traido despues de la ingesta.
  full_content         text,
  content_fetched_at   timestamptz,
  content_fetch_status text,

  -- Rastro de las empujadas a mano al pipeline. La seleccion automatica solo
  -- genera por encima del umbral; cuando alguien arrastra una que no llegaba,
  -- esa discrepancia es el dato: el analisis la califico bajo y una persona la
  -- vio valiosa. Se congelan score y umbral de ese momento porque los dos
  -- cambian despues, y sin congelarlos el patron seria irrecuperable.
  promoted_by_hand     boolean     not null default false,
  promoted_at          timestamptz,
  promoted_score       numeric,
  promoted_threshold   numeric,

  -- La noticia que ya conto este mismo hecho, con status = 'duplicate'. El
  -- UNIQUE de abajo solo pilla la misma URL, y un anuncio lo publican veinte
  -- medios con veinte enlaces distintos. Se decide al ir a generar el angulo,
  -- cuando quedan pocas; la repetida no se borra, se aparta enlazada a la que
  -- se quedo con el hecho.
  duplicate_of_news_id uuid references public.raw_news (id) on delete set null,

  constraint raw_news_link_key unique (link)
);

create index if not exists raw_news_created_at_idx on public.raw_news (created_at desc);
create index if not exists raw_news_niche_idx      on public.raw_news (niche);
create index if not exists raw_news_status_idx     on public.raw_news (status);
create index if not exists raw_news_niche_tema_idx on public.raw_news (niche, tema);
create index if not exists raw_news_promovidas_idx  on public.raw_news (account_id, promoted_at desc)
  where promoted_by_hand;
create index if not exists raw_news_duplicate_of_idx on public.raw_news (duplicate_of_news_id)
  where duplicate_of_news_id is not null;

-- Una noticia, un trabajo de angulo, una pieza por red.
--
-- No lo impedia nada, y bastaba con que dos pasadas del tick se solaparan: las
-- dos leian la cola antes de que ninguna escribiera y las dos encolaban. Asi
-- salieron cuatro angulos del mismo hecho, y de cada uno su carrusel y su pieza
-- de Facebook. La comprobacion en codigo no puede cerrarlo, porque la carrera
-- ocurre entre leer y escribir; el unico sitio donde se cierra es aqui.
create unique index if not exists jobs_angle_una_por_noticia
  on public.jobs_angle (account_id, raw_news_id);
create unique index if not exists content_pieces_una_por_red
  on public.content_pieces (account_id, raw_news_id, network)
  where raw_news_id is not null;

-- ------------------------------------------------------------------ corridas

-- Una fila por ejecucion del motor. Nace en 'running' y se cierra en
-- 'completed' o 'failed'; el ensayo en seco no abre corrida.
create table if not exists public.pipeline_runs (
  id                 uuid primary key default gen_random_uuid(),
  run_type           text        not null,
  status             text        not null default 'running',
  started_at         timestamptz not null default now(),
  ended_at           timestamptz,
  raw_inserted       integer,
  duplicates_removed integer,
  error_message      text
);

create index if not exists pipeline_runs_started_at_idx on public.pipeline_runs (started_at desc);

-- Traza paso a paso de cada corrida, volcada al terminar. `run_id` admite NULL
-- porque el ensayo en seco emite eventos sin corrida asociada.
create table if not exists public.pipeline_events (
  id     bigint generated always as identity primary key,
  run_id uuid references public.pipeline_runs (id) on delete cascade,
  at     timestamptz not null default now(),
  kind   text        not null,
  label  text,
  detail jsonb
);

create index if not exists pipeline_events_at_idx     on public.pipeline_events (at desc);
create index if not exists pipeline_events_run_id_idx on public.pipeline_events (run_id);

-- ----------------------------------------------------------------- taxonomia

-- Categoria de contenido. `slug` es lo que acaba en raw_news.niche, de ahi el
-- formato restringido: la UI valida lo mismo antes de escribir.
create table if not exists public.engine_categories (
  id          uuid primary key default gen_random_uuid(),
  name        text        not null,
  slug        text        not null,
  description text,
  color       text        not null default '#8b8b8b',
  is_active   boolean     not null default true,
  position    integer     not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint engine_categories_slug_key   unique (slug),
  constraint engine_categories_slug_check check (slug ~ '^[A-Za-z0-9_-]+$')
);

-- Una busqueda concreta contra Serper. El borrado de la categoria arrastra sus
-- segmentos; las noticias ya ingeridas no se tocan.
create table if not exists public.engine_segments (
  id          uuid primary key default gen_random_uuid(),
  category_id uuid        not null references public.engine_categories (id) on delete cascade,
  label       text        not null,
  query       text        not null,
  hl          text        not null default 'en',
  gl          text        not null default 'us',
  num         integer     not null default 15,
  freshness   text        not null default 'qdr:d',
  is_active   boolean     not null default true,
  position    integer     not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  -- La UI traduce el 23505 de aqui a "ya existe un segmento con ese nombre".
  constraint engine_segments_category_label_key unique (category_id, label)
);

create index if not exists engine_segments_category_id_idx on public.engine_segments (category_id);

-- ------------------------------------------------------------------- capas

-- Las capas del nuevo pipeline de generacion (etapa 2), paralelo a las
-- noticias. El contenido nace de una idea que combina capas, no de una noticia.
-- Todo cuelga de una cuenta. RLS activo y sin politicas: solo service role.

create table if not exists public.content_pillars (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts (id) on delete cascade,
  name text not null, description text, position integer not null default 0,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.content_topics (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts (id) on delete cascade,
  pillar_id uuid not null references public.content_pillars (id) on delete cascade,
  name text not null, description text, position integer not null default 0,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.content_subtopics (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts (id) on delete cascade,
  topic_id uuid not null references public.content_topics (id) on delete cascade,
  name text not null, description text, position integer not null default 0,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
alter table public.content_subtopics add column if not exists description text;

-- Listas de subtemas reutilizables: "Frutas" se escribe una vez y la usan los
-- temas que la necesiten. Sus elementos se materializan como subtemas del tema
-- (list_item_id), asi las ideas y los cartuchos no cambian.
create table if not exists public.content_subtopic_lists (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts (id) on delete cascade,
  name text not null, description text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.content_subtopic_list_items (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts (id) on delete cascade,
  list_id uuid not null references public.content_subtopic_lists (id) on delete cascade,
  name text not null, description text, position integer not null default 0,
  created_at timestamptz not null default now()
);
create table if not exists public.content_topic_lists (
  account_id uuid not null references public.accounts (id) on delete cascade,
  topic_id uuid not null references public.content_topics (id) on delete cascade,
  list_id uuid not null references public.content_subtopic_lists (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (topic_id, list_id)
);
alter table public.content_subtopics
  add column if not exists list_item_id uuid references public.content_subtopic_list_items (id) on delete cascade;
create unique index if not exists content_subtopics_tema_elemento_idx
  on public.content_subtopics (topic_id, list_item_id) where list_item_id is not null;
create index if not exists content_subtopic_lists_account_idx on public.content_subtopic_lists (account_id);
create index if not exists content_subtopic_list_items_list_idx on public.content_subtopic_list_items (list_id, position);
alter table public.content_subtopic_lists      enable row level security;
alter table public.content_subtopic_list_items enable row level security;
alter table public.content_topic_lists         enable row level security;
create table if not exists public.content_intents (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts (id) on delete cascade,
  name text not null, description text, position integer not null default 0,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.content_narratives (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts (id) on delete cascade,
  name text not null, description text, position integer not null default 0,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
-- Que narrativas desbloquea cada intencion.
create table if not exists public.content_intent_narratives (
  account_id uuid not null references public.accounts (id) on delete cascade,
  intent_id uuid not null references public.content_intents (id) on delete cascade,
  narrative_id uuid not null references public.content_narratives (id) on delete cascade,
  primary key (intent_id, narrative_id)
);
create table if not exists public.content_ctas (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts (id) on delete cascade,
  name text not null, description text, position integer not null default 0,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create index if not exists content_topics_pillar_idx     on public.content_topics (pillar_id);
create index if not exists content_subtopics_topic_idx   on public.content_subtopics (topic_id);
create index if not exists content_pillars_account_idx   on public.content_pillars (account_id);
create index if not exists content_intents_account_idx   on public.content_intents (account_id);
create index if not exists content_narratives_account_idx on public.content_narratives (account_id);

alter table public.content_pillars           enable row level security;
alter table public.content_topics            enable row level security;
alter table public.content_subtopics         enable row level security;
alter table public.content_intents           enable row level security;
alter table public.content_narratives        enable row level security;
alter table public.content_intent_narratives enable row level security;
alter table public.content_ctas              enable row level security;

-- Los cartuchos: las ideas del bloque 1 que consume el bloque 2. Una idea nace
-- de una combinacion de capas; un cartucho usado es una pieza generada.
create table if not exists public.content_cartridges (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts (id) on delete cascade,
  pillar_id uuid not null references public.content_pillars (id) on delete cascade,
  topic_id uuid references public.content_topics (id) on delete set null,
  subtopic_id uuid references public.content_subtopics (id) on delete set null,
  intent_id uuid references public.content_intents (id) on delete set null,
  narrative_id uuid references public.content_narratives (id) on delete set null,
  idea text not null, notes text,
  status text not null default 'available',
  used_at timestamptz, round integer not null default 1,
  created_at timestamptz not null default now(),
  constraint content_cartridges_status_check check (status in ('available', 'used'))
);
create index if not exists content_cartridges_pillar_idx on public.content_cartridges (pillar_id);
create index if not exists content_cartridges_disponibles_idx
  on public.content_cartridges (account_id, created_at) where status = 'available';
alter table public.content_cartridges enable row level security;

-- ---------------------------------------------------------------- bloque 2
--
-- Una receta es la configuracion preestablecida del bloque 2 (canal, formato,
-- plantilla, generador y cadencia) que el agente de contenido usa para
-- convertir cartuchos de un pilar en piezas. Canal y formato salen del catalogo
-- en codigo (src/lib/canales-catalogo.ts), no de tablas.
create table if not exists public.content_recipes (
  id           uuid primary key default gen_random_uuid(),
  account_id   uuid        not null references public.accounts (id) on delete cascade,
  pillar_id    uuid        not null references public.content_pillars (id) on delete cascade,
  name         text        not null,
  channel      text        not null,
  format       text        not null,
  generator    text        not null default 'canva',  -- canva | ninguno
  -- {brand_template_id, campos: {campo_canva: ruta_del_payload}}. Vacio hasta
  -- que se configure la capa Plantilla.
  template     jsonb,
  per_day      integer     not null default 1,
  run_at       integer[]   not null default '{}',     -- horas del dia (0-23), zona de la cuenta
  enabled      boolean     not null default true,
  last_run_at  timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint content_recipes_perday_check check (per_day between 1 and 20)
);
create index if not exists content_recipes_account_idx on public.content_recipes (account_id);
create index if not exists content_recipes_pillar_idx  on public.content_recipes (pillar_id);

-- Las piezas del estudio nuevo. Aparte de content_pieces, que cuelga de una
-- noticia: aqui la pieza nace de un cartucho.
create table if not exists public.studio_pieces (
  id              uuid primary key default gen_random_uuid(),
  account_id      uuid        not null references public.accounts (id) on delete cascade,
  recipe_id       uuid        references public.content_recipes (id) on delete set null,
  cartridge_id    uuid        references public.content_cartridges (id) on delete set null,
  channel         text        not null,
  format          text        not null,
  status          text        not null default 'generating',
  payload         jsonb,
  canva_design_id text,
  error           text,
  created_at      timestamptz not null default now(),
  published_at    timestamptz,
  constraint studio_pieces_status_check
    check (status in ('generating', 'generated', 'published', 'failed'))
);
create index if not exists studio_pieces_account_idx on public.studio_pieces (account_id, created_at desc);
create index if not exists studio_pieces_recipe_idx  on public.studio_pieces (recipe_id);

-- Los prompts del agente de ideas y del de contenido, por cuenta. null = el
-- que trae el codigo.
create table if not exists public.studio_settings (
  account_id     uuid primary key references public.accounts (id) on delete cascade,
  ideas_prompt   text,
  content_prompt text,
  updated_at     timestamptz not null default now()
);

alter table public.content_recipes enable row level security;
alter table public.studio_pieces   enable row level security;
alter table public.studio_settings enable row level security;

-- La publicacion del estudio: cuando y donde sale cada pieza. El agente de
-- publicacion arma el plan del dia (cada pilar publica a las publicar_horas:
-- su primera pieza a la primera hora, etc.; sin horas, un hueco cada
-- publicar_cada_min minutos desde publicar_desde, alternando pilares y
-- recetas) y publica cada pieza a la hora de su hueco en cada red de
-- publicar_redes (Composio).
alter table public.studio_settings
  add column if not exists publicar_activo boolean not null default false,
  add column if not exists publicar_desde text not null default '09:30',
  add column if not exists publicar_cada_min integer not null default 15,
  add column if not exists publicar_horas text[] not null default '{}',
  add column if not exists publicar_redes text[] not null default '{instagram,facebook}';

create table if not exists public.studio_publications (
  id             uuid primary key default gen_random_uuid(),
  account_id     uuid        not null references public.accounts (id) on delete cascade,
  piece_id       uuid        not null references public.studio_pieces (id) on delete cascade,
  recipe_id      uuid        references public.content_recipes (id) on delete set null,
  dia            date        not null,
  slot           integer     not null,
  red            text        not null,
  status         text        not null default 'programando',
  due_at         timestamptz,
  buffer_post_id text,
  error          text,
  intentos       integer     not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint studio_publications_red_check check (red in ('instagram', 'facebook')),
  constraint studio_publications_status_check check (status in ('programando', 'programada', 'publicada', 'error')),
  -- Un hueco del dia, una vez por red: dos pasadas no programan lo mismo.
  constraint studio_publications_slot_unico unique (account_id, dia, slot, red)
);
create index if not exists studio_publications_piece_idx on public.studio_publications (piece_id);
alter table public.studio_publications enable row level security;

-- Reclamo atomico de cartuchos: dos agentes que corren a la vez no se llevan la
-- misma idea. FOR UPDATE SKIP LOCKED salta las filas que otro ya bloqueo.
create or replace function public.reclamar_cartuchos(
  p_account uuid,
  p_pillar  uuid,
  p_limite  integer
)
returns setof public.content_cartridges
language sql
as $$
  update public.content_cartridges c
  set status = 'used', used_at = now()
  where c.id in (
    select id from public.content_cartridges
    where account_id = p_account and pillar_id = p_pillar and status = 'available'
    order by created_at
    limit p_limite
    for update skip locked
  )
  returning c.*;
$$;
revoke all on function public.reclamar_cartuchos(uuid, uuid, integer) from public, anon, authenticated;

-- La capa Plantilla: el estilo fijo de cada formato visual. Se define con
-- valores (estilo) y el sistema la construye en Canva como un diseno maestro
-- con marcadores ({{hook}}, {{titulo}}, {{cuerpo}}, {{n}}). Cada pieza es una
-- copia de ese maestro con los marcadores y las fotos reemplazados.
create table if not exists public.content_templates (
  id              uuid primary key default gen_random_uuid(),
  account_id      uuid        not null references public.accounts (id) on delete cascade,
  name            text        not null,
  format          text        not null,
  estilo          jsonb       not null default '{}'::jsonb,
  estructura      jsonb,       -- paginas, su rol y sus marcadores, leidos de Canva
  canva_design_id text,
  canva_edit_url  text,
  thumbnail_url   text,
  status          text        not null default 'borrador',
  error           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint content_templates_status_check check (status in ('borrador', 'creando', 'lista', 'error'))
);
create index if not exists content_templates_account_idx on public.content_templates (account_id, format);
alter table public.content_templates enable row level security;

-- La plantilla es un estilo grafico transversal (Infografia, Data-viz,
-- Fotografico, Ilustracion), no un diseno por formato: sirve a cualquier
-- receta y el sistema compone cada pieza para el tamano de su formato. tipo y
-- descripcion la definen; format queda sin uso.
alter table public.content_templates alter column format drop not null;
alter table public.content_templates add column if not exists tipo text;
alter table public.content_templates add column if not exists descripcion text;
alter table public.content_templates drop constraint if exists content_templates_tipo_check;
alter table public.content_templates add constraint content_templates_tipo_check
  check (tipo is null or tipo in ('infografia', 'dataviz', 'infodatos', 'fotografico', 'ilustracion'));

-- La receta apunta a su plantilla (la columna template, jsonb, quedo sin uso).
alter table public.content_recipes
  add column if not exists template_id uuid references public.content_templates (id) on delete set null;

-- La pieza recuerda su pilar, para el estudio por pilar.
alter table public.studio_pieces
  add column if not exists pillar_id uuid references public.content_pillars (id) on delete set null;
create index if not exists studio_pieces_pillar_idx on public.studio_pieces (pillar_id, created_at desc);

-- ------------------------------------------------------------------ agentes

-- Como se comporta cada agente del motor.
--
-- Antes esto estaba repartido en tres sitios que no se hablaban:
-- engine_settings mandaba sobre la ingesta, generation_config.generation_mode
-- sobre toda la generacion y publish_schedule sobre cada red. Con un solo
-- interruptor para analisis, angulo y contenido no se podia afinar un paso sin
-- tocar los otros.
--
--   manual       solo corre cuando alguien lo dispara desde el estudio
--   programado   corre a las horas marcadas, y entre medias acumula cola
--   automatico   corre en cuanto el paso anterior le entrega trabajo
--
-- `canal` solo lo usa publicacion, que tiene un horario por red; para el resto
-- va vacio y la clave primaria queda en (cuenta, agente).
create table if not exists public.agent_settings (
  account_id  uuid        not null references public.accounts (id) on delete cascade,
  agent       text        not null,
  canal       text        not null default '',

  -- Apagado, el agente no corre ni aparece en el tablero, sea cual sea su modo.
  -- Es distinto de "manual", que significa que lo disparas tu: sin la
  -- distincion, la unica forma de no publicar en una red era dejarla en manual
  -- y no pulsar nunca, con su columna ocupando sitio para siempre.
  enabled     boolean     not null default true,
  mode        text        not null default 'automatico',
  -- Los minutos del dia en que corre, de 0 a 1439: un 545 son las 09:05.
  -- Antes eran una lista de horas y un unico minuto para todas, asi que se
  -- podia pedir "9:30 y 18:30" pero no "9:10 y 9:30", y para publicar varias
  -- veces dentro de la misma hora eso no sirve. Fuera del modo programado se
  -- conservan: apagar y volver a programar no deberia perder el horario que
  -- costo decidir.
  run_at      integer[]   not null default '{}',
  batch_size  integer,
  last_run_at timestamptz,

  -- NULL significa "el que trae el codigo". Asi el prompt por defecto sigue
  -- versionado en git y la fila solo existe cuando alguien lo cambio de verdad.
  prompt      text,
  model       text,

  updated_at  timestamptz not null default now(),

  primary key (account_id, agent, canal),
  constraint agent_settings_mode_check
    check (mode in ('manual', 'programado', 'automatico')),
  constraint agent_settings_agent_check
    check (agent in ('extraccion', 'analisis', 'angulo', 'instagram', 'linkedin', 'criterio', 'revisor', 'publicacion', 'redaccion'))
);

-- Lleva los prompts de cada cuenta: cerrada como el resto, solo service role.
alter table public.agent_settings enable row level security;

-- -------------------------------------------------------------------- motor
create table if not exists public.engine_settings (
  id         boolean primary key default true,
  run_hours  integer[]   not null default '{11,18}',
  -- Minuto comun a todas las horas: 11 y 18 con run_minute 30 son 11:30 y 18:30.
  run_minute integer     not null default 0,
  timezone   text        not null default 'America/Bogota',
  enabled    boolean     not null default true,
  updated_at timestamptz not null default now(),

  constraint engine_settings_singleton   check (id),
  constraint engine_settings_run_minute_check check (run_minute between 0 and 59)
);

-- ----------------------------------------------------------------------- RLS
--
-- Todas las tablas solo se tocan con la service role, que salta RLS por
-- completo. Dejarlo activo y sin politicas las cierra a cualquier otra
-- credencial sin costo.
--
-- raw_news y pipeline_runs iban desactivadas porque el dashboard las leia con
-- la clave publicable; desde 2026-10-20 se leen tambien con la service role
-- (migraciones/2026-10-20-cimientos-multimarca.sql).

alter table public.raw_news      enable row level security;
alter table public.pipeline_runs enable row level security;

alter table public.pipeline_events   enable row level security;
alter table public.engine_categories enable row level security;
alter table public.engine_segments   enable row level security;
alter table public.engine_settings   enable row level security;

-- ------------------------------------------------------------------ semillas

-- Obligatoria: updateSchedule hace UPDATE, no upsert, y sin esta fila el
-- horario no se puede guardar.
insert into public.engine_settings (id, run_hours, run_minute, timezone, enabled)
values (true, '{11,18}', 0, 'America/Bogota', true)
on conflict (id) do nothing;

-- Opcional pero recomendable: las 16 busquedas portadas de n8n, las mismas que
-- FALLBACK_SEARCHES en src/engine/config.ts. Sin esto el motor sigue corriendo
-- (cae al respaldo del codigo), pero /engine/config aparece vacio y no hay nada
-- que editar desde la interfaz.
insert into public.engine_categories (name, slug, description, color, position) values
  ('AI',      'AI',      'Modelos, releases y laboratorios',   '#6366f1', 0),
  ('Startup', 'Startup', 'Lanzamientos, fundadores y movidas',  '#f59e0b', 1),
  ('Tech',    'Tech',    'Open source, seguridad e infra',      '#10b981', 2),
  ('VC',      'VC',      'Rondas, fondos y salidas',            '#ec4899', 3)
on conflict (slug) do nothing;

insert into public.engine_segments (category_id, label, query, hl, gl, num, freshness, position)
select c.id, s.label, s.query, s.hl, s.gl, 15, 'qdr:d', s.position
from (values
  ('AI',      'AI releases',                'AI releases',                                       'en', 'us', 0),
  ('AI',      'new AI model LLM',           'new AI model released LLM',                         'en', 'us', 1),
  ('AI',      'OpenAI',                     'OpenAI',                                            'en', 'us', 2),
  ('AI',      'Anthropic Claude',           'Anthropic Claude',                                  'en', 'us', 3),
  ('Startup', 'startup launch latam',       'startup launch latam colombia',                     'es', 'co', 0),
  ('Startup', 'SaaS product hunt',          'new SaaS product hunt launch',                      'en', 'us', 1),
  ('Startup', 'startup acquisition merger', 'startup acquisition merger shutdown pivot',         'en', 'us', 2),
  ('Startup', 'founder story',              'founder story startup lessons',                     'en', 'us', 3),
  ('Tech',    'open source release',        'open source software release github',               'en', 'us', 0),
  ('Tech',    'cybersecurity',              'cybersecurity breach vulnerability hack',           'en', 'us', 1),
  ('Tech',    'developer tools',            'developer tools framework API launch',              'en', 'us', 2),
  ('Tech',    'cloud hardware',             'cloud infrastructure GPU chip hardware',            'en', 'us', 3),
  ('VC',      'VC funding latam',           'venture capital funding raised latam',              'en', 'us', 0),
  ('VC',      'Series A B seed',            'Series A Series B seed round tech',                 'en', 'us', 1),
  ('VC',      'Kaszek Softbank a16z',       'Kaszek Softbank a16z Sequoia portfolio investment', 'en', 'us', 2),
  ('VC',      'IPO acquisition',            'startup IPO acquisition merger deal',               'en', 'us', 3)
) as s (niche, label, query, hl, gl, position)
join public.engine_categories c on c.slug = s.niche
on conflict (category_id, label) do nothing;

-- ---------------------------------------------------------------- generacion
--
-- Etapa 2: de una noticia analizada a una pieza de LinkedIn.
--
-- Dos clases de tabla, separadas a proposito:
--   jobs_*      buzones. El mecanismo de ejecucion de los agentes.
--   content_*   el resultado limpio que consume la interfaz.
-- Si algun dia se cambia la forma de llamar al modelo, solo cambian los buzones.

-- Tabla de una sola fila, como engine_settings: el check sobre la PK booleana
-- impide un segundo registro.
--
-- `score_threshold` nace NULL a proposito: el scoring lo define el usuario desde
-- la interfaz, y hasta entonces el modo automatico no selecciona nada. Un valor
-- inventado aqui encolaria noticias con un criterio que nadie eligio.
create table if not exists public.generation_config (
  id              boolean primary key default true,
  -- Las ranuras de personalizacion que se inyectan en cada job. En jsonb y no
  -- en columnas porque el juego de ranuras va a crecer; los valores admitidos
  -- se validan en src/engine/content/variables.ts, que es el unico que escribe.
  variables       jsonb       not null default
    '{"tono":"profesional","audiencia":"","voz_marca":"","cta":"","evitar":"","longitud":"medio","idioma":"es"}'::jsonb,
  score_threshold integer,
  generation_mode text        not null default 'manual',
  updated_at      timestamptz not null default now(),

  constraint generation_config_singleton       check (id),
  constraint generation_config_threshold_check check (score_threshold is null or score_threshold between 0 and 10),
  constraint generation_config_mode_check      check (generation_mode in ('auto', 'manual'))
);

-- Buzon del agente de angulo.
--
-- La app escribe la fila en 'pending' y avisa por webhook; la el agente lee
-- la cola, escribe `respuesta` y marca 'done' o 'failed'. El webhook solo
-- despierta: los datos viajan en `input`, nunca en la peticion.
--
-- `consumed_at` lo escribe SOLO la app, al materializar la respuesta. Es columna
-- aparte y no un cuarto estado por dos motivos: deja el contrato de el agente en
-- pending|done|failed exactamente como se especifico, y como el trigger de aviso
-- vigila `status`, la escritura de la app no se despierta a si misma en bucle.
create table if not exists public.jobs_angle (
  id           uuid primary key default gen_random_uuid(),
  raw_news_id  uuid        not null references public.raw_news (id) on delete cascade,
  input        jsonb       not null,
  status       text        not null default 'pending',
  respuesta    jsonb,
  error        text,
  created_at   timestamptz not null default now(),
  processed_at timestamptz,
  consumed_at  timestamptz,

  constraint jobs_angle_status_check check (status in ('pending', 'processing', 'done', 'failed'))
);

create index if not exists jobs_angle_status_idx      on public.jobs_angle (status, created_at);
create index if not exists jobs_angle_raw_news_id_idx on public.jobs_angle (raw_news_id);
-- Indice parcial sobre la consulta caliente: lo hecho y sin consumir.
create index if not exists jobs_angle_por_drenar_idx  on public.jobs_angle (created_at)
  where consumed_at is null and status in ('done', 'failed');

-- Un angulo editorial propuesto por el agente.
--
-- Cuantos angulos produce cada noticia lo decide el agente, no este esquema: se
-- materializa una fila por cada uno que venga en la respuesta y `position`
-- conserva el orden en que los propuso.
create table if not exists public.content_angles (
  id              uuid primary key default gen_random_uuid(),
  raw_news_id     uuid        not null references public.raw_news (id) on delete cascade,
  -- De que buzon salio; para auditar una generacion rara.
  job_angle_id    uuid        references public.jobs_angle (id) on delete set null,
  angle           text        not null,
  thesis          text,
  playbook_format text,
  status          text        not null default 'angled',
  position        integer     not null default 0,
  created_at      timestamptz not null default now(),

  constraint content_angles_status_check
    check (status in ('angled', 'pending_generation', 'generated', 'discarded'))
);

create index if not exists content_angles_raw_news_id_idx on public.content_angles (raw_news_id);
create index if not exists content_angles_status_idx      on public.content_angles (status, created_at desc);

-- Buzon de el agente de LinkedIn. Mismo contrato que jobs_angle.
create table if not exists public.jobs_linkedin (
  id               uuid primary key default gen_random_uuid(),
  content_angle_id uuid        not null references public.content_angles (id) on delete cascade,
  input            jsonb       not null,
  status           text        not null default 'pending',
  respuesta        jsonb,
  error            text,
  created_at       timestamptz not null default now(),
  processed_at     timestamptz,
  consumed_at      timestamptz,

  constraint jobs_linkedin_status_check check (status in ('pending', 'processing', 'done', 'failed'))
);

create index if not exists jobs_linkedin_status_idx     on public.jobs_linkedin (status, created_at);
create index if not exists jobs_linkedin_angle_id_idx   on public.jobs_linkedin (content_angle_id);
create index if not exists jobs_linkedin_por_drenar_idx on public.jobs_linkedin (created_at)
  where consumed_at is null and status in ('done', 'failed');

-- La pieza lista para revisar. `payload` guarda el post tal como lo devolvio la
-- agente; `variables_usadas` es la copia de las ranuras que produjeron ESTE
-- texto, para poder explicar despues por que salio asi. La publicacion a
-- LinkedIn no es parte de esta etapa.
--
-- `raw_news_id` va con on delete set null y no cascade: la pieza ya no depende
-- de la noticia, y perderla en una limpieza del corpus seria destruir trabajo.
create table if not exists public.content_pieces (
  id               uuid primary key default gen_random_uuid(),
  content_angle_id uuid        not null references public.content_angles (id) on delete cascade,
  raw_news_id      uuid        references public.raw_news (id) on delete set null,
  job_linkedin_id  uuid        references public.jobs_linkedin (id) on delete set null,
  network          text        not null default 'linkedin',
  payload          jsonb       not null,
  status           text        not null default 'generated',
  variables_usadas jsonb,
  override_puntual jsonb,
  created_at       timestamptz not null default now(),
  generated_at     timestamptz,
  approved_at      timestamptz,

  constraint content_pieces_status_check  check (status in ('generated', 'approved', 'rejected')),
  constraint content_pieces_network_check check (network in ('linkedin'))
);

create index if not exists content_pieces_angle_id_idx    on public.content_pieces (content_angle_id);
create index if not exists content_pieces_raw_news_id_idx on public.content_pieces (raw_news_id);
create index if not exists content_pieces_status_idx      on public.content_pieces (status, created_at desc);

-- RLS: mismo regimen que el resto de tablas de configuracion y motor. Solo entra
-- service_role, que es la credencial con la que se autentica tanto la app como
-- la el agente cuando escribe en su buzon. Que el agente toque solo
-- respuesta/status/error/processed_at es una convencion del contrato, no algo
-- que Postgres imponga.
alter table public.generation_config enable row level security;
alter table public.jobs_angle        enable row level security;
alter table public.jobs_linkedin     enable row level security;
alter table public.content_angles    enable row level security;
alter table public.content_pieces    enable row level security;

-- Obligatoria: el codigo lee y escribe con .eq("id", true), como engine_settings.
insert into public.generation_config (id) values (true) on conflict (id) do nothing;

-- ------------------------------------------------------------- publicacion
--
-- Publicar en LinkedIn la pieza generada.

-- La cuenta conectada por OAuth. Tabla de una sola fila, como engine_settings.
--
-- Guarda el token porque la app publica en nombre del miembro cuando el ya no
-- esta delante: un flujo que solo viviera en la sesion del navegador no serviria
-- para el modo automatico. De ahi RLS activo y solo service_role, igual que
-- engine_secrets, que custodia credenciales.
--
-- LinkedIn emite tokens de 60 dias y los refresh programaticos estan
-- restringidos a partners, asi que `expires_at` no es informativo: cuando pasa,
-- hay que reconectar a mano. La interfaz avisa una semana antes.
create table if not exists public.linkedin_account (
  id                 boolean primary key default true,
  access_token       text        not null,
  refresh_token      text,
  expires_at         timestamptz not null,
  refresh_expires_at timestamptz,
  -- urn:li:person:{sub}, que es lo que la Posts API espera en `author`.
  person_urn         text        not null,
  display_name       text,
  scope              text,
  connected_at       timestamptz not null default now(),

  constraint linkedin_account_singleton check (id)
);

alter table public.linkedin_account enable row level security;

-- Publicar en automatico nace apagado a proposito: manda contenido generado a
-- una cuenta real sin que nadie lo lea antes.
alter table public.generation_config
  add column if not exists autopublish boolean not null default false;

-- Una pieza publicada guarda el URN que devuelve LinkedIn, que es lo que
-- permite reconstruir la URL del post y no publicarla dos veces.
alter table public.content_pieces add column if not exists published_at  timestamptz;
alter table public.content_pieces add column if not exists linkedin_urn  text;
alter table public.content_pieces add column if not exists publish_error text;

alter table public.content_pieces drop constraint if exists content_pieces_status_check;
alter table public.content_pieces
  add constraint content_pieces_status_check
  -- 'publishing' es el reclamo atomico: una pieza se marca asi justo antes de
  -- salir a Buffer, para que dos pasadas no la publiquen a la vez. Faltaba aqui,
  -- y su ausencia hacia fallar el UPDATE del reclamo en cada pasada: la
  -- publicacion entera se paro hasta que se agrego.
  check (status in ('generated', 'approved', 'publishing', 'published', 'rejected'));

-- Lo que mira el modo automatico: generado o aprobado, y aun sin publicar.
create index if not exists content_pieces_publicables_idx on public.content_pieces (created_at)
  where status in ('generated', 'approved') and published_at is null;

-- --------------------------------------------------------------- instagram
--
-- Buzon de el agente de Instagram. Mismo contrato que los otros dos: la app
-- encola, el agente escribe `respuesta` y marca 'done'; la app materializa.
--
-- Aqui la app hace ademas un paso que las otras redes no tienen: dibujar las
-- imagenes del carrusel y subirlas al storage.
create table if not exists public.jobs_instagram (
  id               uuid primary key default gen_random_uuid(),
  content_angle_id uuid        not null references public.content_angles (id) on delete cascade,
  input            jsonb       not null,
  status           text        not null default 'pending',
  respuesta        jsonb,
  error            text,
  created_at       timestamptz not null default now(),
  processed_at     timestamptz,
  consumed_at      timestamptz,

  constraint jobs_instagram_status_check check (status in ('pending', 'processing', 'done', 'failed'))
);

create index if not exists jobs_instagram_status_idx     on public.jobs_instagram (status, created_at);
create index if not exists jobs_instagram_angle_id_idx   on public.jobs_instagram (content_angle_id);
create index if not exists jobs_instagram_por_drenar_idx on public.jobs_instagram (created_at)
  where consumed_at is null and status in ('done', 'failed');

alter table public.jobs_instagram enable row level security;

-- La pieza deja de ser solo de LinkedIn. Cada red guarda su propia forma en
-- `payload`: LinkedIn un texto, Instagram un caption con la lista ordenada de
-- imagenes.
alter table public.content_pieces drop constraint if exists content_pieces_network_check;
alter table public.content_pieces
  add constraint content_pieces_network_check check (network in ('linkedin', 'instagram'));

-- De que buzon salio, para auditar una generacion rara. Cada red tiene el suyo
-- y solo uno de los dos esta relleno.
alter table public.content_pieces
  add column if not exists job_instagram_id uuid references public.jobs_instagram (id) on delete set null;

-- Bucket publico para las imagenes del carrusel.
--
-- Publico a proposito: al publicar, Instagram descarga cada imagen desde sus
-- propios servidores, asi que una URL firmada y efimera no le sirve. Lo que se
-- sube es contenido pensado para publicarse, no datos privados.
insert into storage.buckets (id, name, public)
values ('carousels', 'carousels', true)
on conflict (id) do update set public = true;

-- ------------------------------------------------- programacion de publicacion
--
-- Cuando y cuanto se publica, por red.
--
-- Una fila por red y no un jsonb en generation_config porque cada red tiene su
-- propio ritmo: LinkedIn aguanta un post diario y a Instagram le sienta bien
-- otro horario. Separarlas deja ademas activar una y dejar la otra parada.
--
-- La zona horaria no se repite aqui: se usa la de engine_settings, para que toda
-- la aplicacion hable de un solo huso.
create table if not exists public.publish_schedule (
  network       text        primary key,
  enabled       boolean     not null default false,
  -- Horas locales. Vacio con enabled = publicar en cuanto haya, sin esperar.
  run_hours     integer[]   not null default '{}',
  run_minute    integer     not null default 0,
  -- Cuantas piezas por tanda. Si no hay tantas, se publica lo que haya.
  batch_size    integer     not null default 1,
  -- Cierre de la ultima tanda: impide repetirla cuando el tick vuelve a pasar
  -- cinco minutos despues, dentro de la misma hora programada.
  last_batch_at timestamptz,
  updated_at    timestamptz not null default now(),

  constraint publish_schedule_network_check check (network in ('linkedin', 'instagram')),
  constraint publish_schedule_minute_check  check (run_minute between 0 and 59),
  constraint publish_schedule_batch_check   check (batch_size between 1 and 20)
);

alter table public.publish_schedule enable row level security;

-- Las dos redes existen siempre, apagadas: asi la interfaz no inventa filas y el
-- estado por defecto es "no publica nada".
insert into public.publish_schedule (network) values ('linkedin'), ('instagram')
on conflict (network) do nothing;

-- El aspecto del carrusel, configurable desde /contenido/config.
alter table public.generation_config
  add column if not exists carousel jsonb not null default
    '{"paleta":"noche","fuente":"HeroFont","marca":"","mostrarPaginacion":true,"usarFotos":true}'::jsonb;

-- Para que redes genera el modo automatico.
--
-- Las dos por defecto: una noticia que supera el umbral se cuenta en LinkedIn y
-- en Instagram desde el mismo angulo, que es lo que hace que las dos redes digan
-- lo mismo con distinta forma en vez de parecer dos cuentas que no se conocen.
-- Quitar una de la lista la deja fuera del automatico sin tocar el envio manual,
-- que sigue pudiendo generar para cualquiera de las dos. Lista vacia = el
-- automatico saca angulos pero no genera nada, que es un estado valido: sirve
-- para acumular angulos y decidir a mano.
alter table public.generation_config
  add column if not exists auto_networks text[] not null default '{linkedin,instagram}'::text[];

alter table public.generation_config drop constraint if exists generation_config_auto_networks_check;
alter table public.generation_config
  add constraint generation_config_auto_networks_check
  check (auto_networks <@ array['linkedin', 'instagram']::text[]);

-- El URN de la imagen adjunta al post de LinkedIn.
--
-- Existe para poder responder despues a "¿este post salio con imagen?". Hasta
-- ahora la unica forma de saberlo era mirar el feed, y cuando se miraba ya no
-- habia arreglo posible. Nulo en las piezas publicadas antes de esta columna y
-- en las de Instagram, donde las imagenes viajan en `payload.images`.
alter table public.content_pieces add column if not exists image_urn text;

comment on column public.content_pieces.image_urn is
  'URN de la imagen adjunta al post. Permite comprobar despues que salio ilustrado.';

-- =========================================================================
-- Multicuenta
-- =========================================================================
--
-- Una cuenta es un espacio de trabajo entero: su taxonomia, sus noticias, su
-- contenido, su LinkedIn y su Instagram. Lo unico que comparten todas son las
-- credenciales de las herramientas —Serper, Pexels, la app de LinkedIn, las
-- agentes de Claude— porque son la misma maquinaria trabajando para clientes
-- distintos. Por eso esas siguen en el entorno y todo lo demas cuelga de aqui.

create table if not exists public.accounts (
  id                uuid primary key default gen_random_uuid(),
  name              text        not null,
  slug              text        not null,
  -- El canal de Instagram en Buffer. Vive aqui y no en el entorno porque cada
  -- cuenta publica en el suyo, y una variable no distingue cuentas.
  buffer_channel_id text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint accounts_slug_key   unique (slug),
  constraint accounts_slug_check check (slug ~ '^[a-z0-9-]+$')
);

-- Quien entra a que cuenta. `user_id` apunta a auth.users sin clave foranea: el
-- esquema auth es de Supabase y no conviene atarle cascadas nuestras.
create table if not exists public.account_members (
  account_id uuid        not null references public.accounts (id) on delete cascade,
  user_id    uuid        not null,
  created_at timestamptz not null default now(),

  primary key (account_id, user_id)
);

create index if not exists account_members_user_id_idx on public.account_members (user_id);

alter table public.accounts        enable row level security;
alter table public.account_members enable row level security;

insert into public.accounts (name, slug) values ('Hancel', 'hancel')
on conflict (slug) do nothing;

-- Las tablas con dueño directo. El bloque es idempotente: añade la columna,
-- rellena lo que hubiera con la primera cuenta y la deja obligatoria.
do $$
declare
  v_cuenta uuid;
  t text;
begin
  select id into v_cuenta from public.accounts order by created_at limit 1;

  foreach t in array array[
    'raw_news', 'pipeline_runs', 'pipeline_events', 'engine_categories',
    'jobs_angle', 'jobs_linkedin', 'jobs_instagram',
    'content_angles', 'content_pieces'
  ] loop
    execute format('alter table public.%I add column if not exists account_id uuid', t);
    execute format('update public.%I set account_id = %L where account_id is null', t, v_cuenta);
    execute format('alter table public.%I alter column account_id set not null', t);
    execute format('alter table public.%I drop constraint if exists %I', t, t || '_account_id_fkey');
    execute format(
      'alter table public.%I add constraint %I foreign key (account_id) references public.accounts (id) on delete cascade',
      t, t || '_account_id_fkey'
    );
    execute format('create index if not exists %I on public.%I (account_id)', t || '_account_id_idx', t);
  end loop;
end $$;

-- Los eventos del tick abarcan varias cuentas en la misma pasada: "revision de
-- la cola" no es de ninguna. Nulo significa "del motor".
alter table public.pipeline_events alter column account_id drop not null;

-- El enlace de una noticia era unico globalmente, y eso impedia que la segunda
-- cuenta ingiriera algo que ya tenia la primera. Son corpus independientes.
alter table public.raw_news drop constraint if exists raw_news_link_key;
alter table public.raw_news add constraint raw_news_account_link_key unique (account_id, link);

-- Mismo motivo con el slug de categoria: 'ia' puede existir en las dos.
alter table public.engine_categories drop constraint if exists engine_categories_slug_key;
alter table public.engine_categories
  add constraint engine_categories_account_slug_key unique (account_id, slug);

-- Las tres tablas de fila unica pasan a una fila por cuenta. El `id boolean`
-- que impedia la segunda fila desaparece: dejarlo seria arrastrar una columna
-- que ya no significa nada.
do $$
declare
  v_cuenta uuid;
  t text;
begin
  select id into v_cuenta from public.accounts order by created_at limit 1;

  foreach t in array array['engine_settings', 'generation_config', 'linkedin_account'] loop
    execute format('alter table public.%I add column if not exists account_id uuid', t);
    execute format('update public.%I set account_id = %L where account_id is null', t, v_cuenta);
    execute format('alter table public.%I drop constraint if exists %I', t, t || '_singleton');
    execute format('alter table public.%I drop constraint if exists %I', t, t || '_pkey');
    execute format('alter table public.%I alter column account_id set not null', t);
    execute format('alter table public.%I add primary key (account_id)', t);
    execute format('alter table public.%I drop column if exists id', t);
    execute format(
      'alter table public.%I add constraint %I foreign key (account_id) references public.accounts (id) on delete cascade',
      t, t || '_account_id_fkey'
    );
  end loop;
end $$;

-- publish_schedule tenia una fila por red; ahora una por cuenta y red.
alter table public.publish_schedule add column if not exists account_id uuid;
update public.publish_schedule
  set account_id = (select id from public.accounts order by created_at limit 1)
  where account_id is null;
alter table public.publish_schedule drop constraint if exists publish_schedule_pkey;
alter table public.publish_schedule alter column account_id set not null;
alter table public.publish_schedule add primary key (account_id, network);
alter table public.publish_schedule drop constraint if exists publish_schedule_account_id_fkey;
alter table public.publish_schedule
  add constraint publish_schedule_account_id_fkey
  foreign key (account_id) references public.accounts (id) on delete cascade;

-- Con varias cuentas el cron de ingesta es la union de todos los horarios, y esa
-- expresion combina minutos y horas en producto cartesiano: puede disparar dos
-- veces dentro de la misma hora. Comprobar solo la hora dejaria que una cuenta
-- ingiriera dos veces seguidas y gastara el doble de cuota de Serper para traer
-- lo mismo. Esta marca cierra la ventana, igual que `publish_schedule.last_batch_at`
-- hace con las tandas de publicacion.
alter table public.engine_settings add column if not exists last_ingest_at timestamptz;

comment on column public.engine_settings.last_ingest_at is
  'Cuando corrio la ultima ingesta. Impide repetirla dentro de la misma hora.';

-- =========================================================================
-- Facebook
-- =========================================================================
--
-- Facebook no tiene agente propia: cada carrusel de Instagram produce tambien su
-- version para Facebook —la portada como imagen y el texto de las laminas como
-- descripcion— siempre que la cuenta tenga pagina configurada. Se publica por
-- Buffer, como Instagram, en el canal que se pone desde la interfaz.

alter table public.accounts rename column buffer_channel_id to buffer_instagram_channel_id;
alter table public.accounts add column if not exists buffer_facebook_channel_id text;

comment on column public.accounts.buffer_instagram_channel_id is 'Canal de Instagram en Buffer. Se pone desde la interfaz.';
comment on column public.accounts.buffer_facebook_channel_id  is 'Canal (pagina) de Facebook en Buffer. Se pone desde la interfaz.';

alter table public.content_pieces drop constraint if exists content_pieces_network_check;
alter table public.content_pieces
  add constraint content_pieces_network_check check (network in ('linkedin', 'instagram', 'facebook'));

alter table public.publish_schedule drop constraint if exists publish_schedule_network_check;
alter table public.publish_schedule
  add constraint publish_schedule_network_check check (network in ('linkedin', 'instagram', 'facebook'));

-- Cada cuenta tiene su fila de horario para Facebook, apagada hasta que alguien
-- la encienda: nace sin horas y sin publicar, igual que las otras redes nuevas.
insert into public.publish_schedule (account_id, network)
select id, 'facebook' from public.accounts
on conflict (account_id, network) do nothing;

-- Facebook se elige como cualquier otra red al generar. No tiene agente propia:
-- sale del guion del carrusel de Instagram, y el trabajo del buzon lleva en
-- `input.destinos` que piezas producir.
alter table public.generation_config drop constraint if exists generation_config_auto_networks_check;
alter table public.generation_config
  add constraint generation_config_auto_networks_check
  check (auto_networks <@ array['linkedin', 'instagram', 'facebook']::text[]);

-- =========================================================================
-- Secretos del motor (no cuelgan de una cuenta)
-- =========================================================================
--
-- Las credenciales del motor. Tabla de una fila; RLS activo y sin politicas,
-- asi que solo la service role la lee.
--
-- El token de Claude corre toda la IA: uno solo para todas las cuentas y todos
-- los agentes, porque es una unica cuenta de Claude la que mueve el motor.
-- Tiene que tener scope de inferencia: el de `claude setup-token` o una API key
-- de consola.
--
-- La de Serper vive aqui y no en el entorno porque es la que mas se rota y
-- cambiarla no deberia obligar a redesplegar; SERPER_API_KEY queda de respaldo.
create table if not exists public.engine_secrets (
  id                       boolean primary key default true,
  claude_oauth_token       text,
  claude_token_updated_at  timestamptz,
  model_analisis           text,
  model_angulo             text,
  model_linkedin           text,
  model_instagram          text,
  composio_api_key         text,
  serper_api_key           text,
  updated_at               timestamptz not null default now(),
  constraint engine_secrets_singleton check (id)
);

alter table public.engine_secrets enable row level security;

insert into public.engine_secrets (id) values (true) on conflict (id) do nothing;

-- Modelo por paso de IA (analisis, angulo, LinkedIn, Instagram), global y
-- editable desde la interfaz. Reemplaza el modelo fijo que tenia cada agente.
alter table public.engine_secrets add column if not exists model_analisis  text not null default 'claude-haiku-4-5-20251001';
alter table public.engine_secrets add column if not exists model_angulo    text not null default 'claude-sonnet-5';
alter table public.engine_secrets add column if not exists model_linkedin  text not null default 'claude-sonnet-5';
alter table public.engine_secrets add column if not exists model_instagram text not null default 'claude-sonnet-5';
alter table public.engine_secrets add column if not exists gemini_api_key  text;
alter table public.generation_config add column if not exists ai_config jsonb not null default '{}'::jsonb;

-- Bloque 2: los modelos del agente de ideas y del de contenido, compartidos
-- por todas las cuentas. Canva no se guarda aqui: se conecta iniciando sesion
-- desde Conexiones y el motor busca la cuenta conectada en Composio.
alter table public.engine_secrets add column if not exists model_ideas     text not null default 'claude-sonnet-5';
alter table public.engine_secrets add column if not exists model_contenido text not null default 'claude-sonnet-5';
-- Sin uso: existio para pegar a mano la conexion de Canva, que ya no se hace.
alter table public.engine_secrets add column if not exists canva_connected_account_id text;

-- Cuando cambia el umbral de score, solo aplica a lo que entre despues: las
-- noticias que ya estaban no se re-evaluan. Cambiar el umbral no puede resucitar
-- hechos viejos que en su dia no llegaron.
alter table public.generation_config
  add column if not exists score_threshold_updated_at timestamptz;

comment on column public.generation_config.score_threshold_updated_at is
  'Cuando se cambio el umbral. La seleccion automatica solo mira noticias traidas despues.';

update public.generation_config
set score_threshold_updated_at = coalesce(score_threshold_updated_at, now());

-- `raw_news.status` gana 'discarded_date': la noticia se guarda igual pero no
-- entra al analisis porque el hecho ya es viejo (ver content/frescura.ts). Es
-- texto libre, no hay constraint que tocar.

-- ------------------------------------------------------------ video studio
--
-- El pipeline de videos: una idea, su guion por escenas (lo escribe el agente),
-- los clips y el montaje (los hace una persona en Flow y en Canva) y la
-- publicacion (el sistema exporta el MP4 de Canva y lo sube a cada red).
create table if not exists public.video_settings (
  account_id        uuid primary key references public.accounts (id) on delete cascade,
  modo              text        not null default 'manual',
  horas             integer[]   not null default '{}',
  pillar_id         uuid        references public.content_pillars (id) on delete set null,
  intent_id         uuid        references public.content_intents (id) on delete set null,
  narrative_id      uuid        references public.content_narratives (id) on delete set null,
  personaje_tag     text        not null default '@juan',
  personaje_nombre  text        not null default 'Juan',
  publicar_activo   boolean     not null default false,
  redes             text[]      not null default '{instagram,facebook}',
  model             text,
  prompt            text,
  updated_at        timestamptz not null default now(),
  constraint video_settings_modo_check check (modo in ('manual', 'automatico'))
);

create table if not exists public.video_items (
  id              uuid primary key default gen_random_uuid(),
  account_id      uuid        not null references public.accounts (id) on delete cascade,
  cartridge_id    uuid        references public.content_cartridges (id) on delete set null,
  pillar_id       uuid        references public.content_pillars (id) on delete set null,
  status          text        not null default 'idea',
  idea            text        not null,
  capas           jsonb,
  guion           jsonb,
  publicar_at     timestamptz,
  canva_url       text,
  canva_design_id text,
  video_url       text,
  export_status   text,
  error           text,
  intentos        integer     not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint video_items_status_check check (status in ('idea', 'escenas', 'clips', 'video', 'publicado')),
  constraint video_items_export_check check (export_status is null or export_status in ('pendiente', 'exportando', 'listo', 'error'))
);
create index if not exists video_items_account_idx on public.video_items (account_id, created_at desc);
-- Un video por hueco de publicacion: dos pasadas no crean dos para la misma hora.
create unique index if not exists video_items_hueco_unico on public.video_items (account_id, publicar_at) where publicar_at is not null;

create table if not exists public.video_publications (
  id             uuid primary key default gen_random_uuid(),
  account_id     uuid        not null references public.accounts (id) on delete cascade,
  video_id       uuid        not null references public.video_items (id) on delete cascade,
  red            text        not null,
  status         text        not null default 'programando',
  due_at         timestamptz,
  buffer_post_id text,
  error          text,
  intentos       integer     not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint video_publications_red_check check (red in ('instagram', 'facebook')),
  constraint video_publications_status_check check (status in ('programando', 'programada', 'publicada', 'error')),
  constraint video_publications_unico unique (video_id, red)
);

alter table public.video_settings     enable row level security;
alter table public.video_items        enable row level security;
alter table public.video_publications enable row level security;

-- ------------------------------------------------------------ multiempresa
-- Ver supabase/migraciones/2026-10-13-multiempresa.sql: plan de cada empresa,
-- rol de cada miembro y conexiones por empresa (account_secrets).
alter table public.accounts add column if not exists plan text not null default 'basic';
alter table public.accounts drop constraint if exists accounts_plan_check;
alter table public.accounts add constraint accounts_plan_check check (plan in ('basic', 'advance'));
update public.accounts set plan = 'advance' where slug = 'agro';
update public.accounts set plan = 'basic' where slug = 'hancel';

alter table public.account_members add column if not exists role text not null default 'member';
alter table public.account_members drop constraint if exists account_members_role_check;
alter table public.account_members add constraint account_members_role_check check (role in ('owner', 'member'));
update public.account_members set role = 'owner';

create table if not exists public.account_secrets (
  account_id              uuid primary key references public.accounts (id) on delete cascade,
  claude_oauth_token      text,
  claude_token_updated_at timestamptz,
  serper_api_key          text,
  gemini_api_key          text,
  composio_user_id        text,
  model_analisis          text not null default 'claude-haiku-4-5-20251001',
  model_angulo            text not null default 'claude-sonnet-5',
  model_linkedin          text not null default 'claude-sonnet-5',
  model_instagram         text not null default 'claude-sonnet-5',
  model_ideas             text not null default 'claude-sonnet-5',
  model_contenido         text not null default 'claude-sonnet-5',
  facebook_page_id        text,
  facebook_page_name      text,
  instagram_user_id       text,
  instagram_username      text,
  updated_at              timestamptz not null default now()
);
alter table public.account_secrets enable row level security;

-- ============================================================ redaccion
-- Ver supabase/migraciones/2026-10-14-pipeline-redaccion.sql.
create table if not exists public.news_sources (
  id           uuid primary key default gen_random_uuid(),
  account_id   uuid not null references public.accounts (id) on delete cascade,
  raw_news_id  uuid not null references public.raw_news (id) on delete cascade,
  url          text not null,
  origen       text not null default 'busqueda',
  medio        text,
  titulo       text,
  autor        text,
  fecha        text,
  tipo         text not null default 'medio',
  extracto     text,
  contenido    text,
  imagen       text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (raw_news_id, url),
  constraint news_sources_origen_check check (origen in ('noticia', 'busqueda', 'cobertura')),
  constraint news_sources_tipo_check check (tipo in ('primaria', 'parte_interesada', 'medio'))
);
create index if not exists news_sources_news_idx on public.news_sources (raw_news_id);
alter table public.news_sources enable row level security;

-- Una redaccion por noticia: pendiente -> redactando -> redactada |
-- material_insuficiente | error. `descartada` la saca de este pipeline sin
-- tocar la noticia en el de redes.
create table if not exists public.news_redacciones (
  id               uuid primary key default gen_random_uuid(),
  account_id       uuid not null references public.accounts (id) on delete cascade,
  raw_news_id      uuid not null unique references public.raw_news (id) on delete cascade,
  status           text not null default 'pendiente',
  titular          text,
  payload          jsonb,
  fuentes          jsonb,
  imagen_url       text,
  word_count       integer,
  model            text,
  error            text,
  intentos         integer not null default 0,
  promovida_a_mano boolean not null default false,
  redactada_at     timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint news_redacciones_status_check
    check (status in ('pendiente', 'redactando', 'redactada', 'material_insuficiente', 'error', 'descartada'))
);
create index if not exists news_redacciones_account_idx on public.news_redacciones (account_id, status);
alter table public.news_redacciones enable row level security;

-- El umbral propio del pipeline de redaccion.
alter table public.generation_config
  add column if not exists redaccion_score_threshold integer,
  add column if not exists redaccion_threshold_updated_at timestamptz not null default now();

-- El nicho (tema del portal) de cada noticia redactada.
alter table public.news_redacciones
  add column if not exists nicho_slug text,
  add column if not exists nicho_nombre text;
-- El portal de noticias de cada empresa (aplicada el 2026-10-15): la URL del
-- webhook y el secreto con que se firman los envios, el switch de envio
-- automatico, el estado del envio de cada redaccion y el registro de entregas.
alter table public.account_secrets
  add column if not exists web_webhook_url text,
  add column if not exists web_webhook_secret text;

alter table public.generation_config
  add column if not exists web_envio_auto boolean not null default true,
  add column if not exists web_auto_desde timestamptz not null default now();

alter table public.news_redacciones
  add column if not exists version integer not null default 1,
  add column if not exists slug text,
  add column if not exists imagen_credito jsonb,
  add column if not exists imagen_ancho integer,
  add column if not exists imagen_alto integer,
  add column if not exists web_status text,
  add column if not exists web_version integer not null default 0,
  add column if not exists web_url text,
  add column if not exists web_id_externo text,
  add column if not exists web_publicada_at timestamptz,
  add column if not exists web_enviada_at timestamptz,
  add column if not exists web_error text,
  add column if not exists web_intentos integer not null default 0,
  add column if not exists web_proximo_at timestamptz,
  add column if not exists web_evento_id text;

alter table public.news_redacciones drop constraint if exists news_redacciones_web_status_check;
alter table public.news_redacciones add constraint news_redacciones_web_status_check
  check (web_status is null or web_status in ('pendiente', 'enviando', 'enviada', 'error', 'retirada'));

create unique index if not exists news_redacciones_slug_idx on public.news_redacciones (account_id, slug) where slug is not null;
create index if not exists news_redacciones_web_idx on public.news_redacciones (account_id, web_status);

create table if not exists public.web_entregas (
  id           uuid primary key default gen_random_uuid(),
  account_id   uuid not null references public.accounts (id) on delete cascade,
  redaccion_id uuid references public.news_redacciones (id) on delete set null,
  evento_id    text not null,
  tipo         text not null,
  intento      integer not null default 1,
  status_code  integer,
  respuesta    text,
  error        text,
  ms           integer,
  created_at   timestamptz not null default now()
);
create index if not exists web_entregas_account_idx on public.web_entregas (account_id, created_at desc);
alter table public.web_entregas enable row level security;

-- =========================================================================
-- Perfil de marca
-- =========================================================================
-- Ver supabase/migraciones/2026-10-20-perfil-marca.sql.

-- --------------------------------------------------------- perfil de marca
-- Quien es la marca y como escribe. Una fila por cuenta. Los topes existen
-- porque todo esto entra en cada prompt: un perfil sin limite encarece cada
-- llamada a Claude.
create table if not exists public.brand_profile (
  account_id        uuid primary key references public.accounts (id) on delete cascade,
  nombre            text not null default '',
  handle            text not null default '',
  que_hace          text not null default '',
  mensaje_central   text not null default '',
  idioma            text not null default 'es',
  pais              text,
  voz_si            text not null default '',
  voz_no            text not null default '',
  reglas            text not null default '',
  frases_prohibidas text[] not null default '{}',
  temas_vetados     text not null default '',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint brand_profile_nombre_len     check (char_length(nombre) <= 60),
  constraint brand_profile_handle_len     check (char_length(handle) <= 40),
  constraint brand_profile_que_hace_len   check (char_length(que_hace) <= 600),
  constraint brand_profile_mensaje_len    check (char_length(mensaje_central) <= 300),
  constraint brand_profile_voz_si_len     check (char_length(voz_si) <= 1200),
  constraint brand_profile_voz_no_len     check (char_length(voz_no) <= 1200),
  constraint brand_profile_reglas_len     check (char_length(reglas) <= 2000),
  constraint brand_profile_vetados_len    check (char_length(temas_vetados) <= 1200),
  constraint brand_profile_frases_tope    check (cardinality(frases_prohibidas) <= 50),
  constraint brand_profile_idioma_check   check (idioma in ('es', 'en')),
  constraint brand_profile_pais_check     check (pais is null or pais ~ '^[A-Z]{2}$')
);
alter table public.brand_profile enable row level security;

-- ----------------------------------------------------------------- pilares
-- La pregunta que responde cada pilar ("¿Que creemos?"): es lo que deja al
-- modelo clasificar una pieza por su valor dominante y no por palabras sueltas.
alter table public.content_pillars add column if not exists pregunta text;

-- ------------------------------------------------- audiencias y verticales
-- La misma forma que los pilares, para editarlas con el mismo componente.
create table if not exists public.content_audiences (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts (id) on delete cascade,
  name text not null, description text, position integer not null default 0,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.content_verticals (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts (id) on delete cascade,
  name text not null, description text, position integer not null default 0,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists content_audiences_account_idx on public.content_audiences (account_id);
create index if not exists content_verticals_account_idx on public.content_verticals (account_id);
alter table public.content_audiences enable row level security;
alter table public.content_verticals enable row level security;

-- --------------------------------------------------------------------- CTA
-- Que pide cada CTA. Si `requiere_recurso`, el agente no lo usa hasta que
-- `recurso_listo`: no se ofrece por DM algo que nadie va a mandar.
alter table public.content_ctas add column if not exists tipo text not null default 'seguir';
alter table public.content_ctas add column if not exists requiere_recurso boolean not null default false;
alter table public.content_ctas add column if not exists recurso_listo boolean not null default false;
alter table public.content_ctas add column if not exists activo boolean not null default true;
alter table public.content_ctas drop constraint if exists content_ctas_tipo_check;
alter table public.content_ctas
  add constraint content_ctas_tipo_check check (tipo in ('seguir', 'comentar', 'palabra', 'dm', 'comercial'));


-- ====================================================== clasificacion angulo
-- Pilar, audiencia, vertical, objetivo y CTA de cada angulo, como foto de ids
-- y nombres. Ver migraciones/2026-10-20-clasificacion-angulo.sql.
alter table public.content_angles add column if not exists clasificacion jsonb;

-- El criterio de la marca, decidido antes de escribir. Ver
-- migraciones/2026-10-21-agente-criterio.sql.
alter table public.content_angles add column if not exists criterio jsonb;

-- ============================================================ skills de marca
-- Instrucciones propias de cada marca para sus agentes. Ver
-- migraciones/2026-10-20-skills-marca.sql.
create table if not exists public.brand_skills (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid not null references public.accounts (id) on delete cascade,
  nombre      text not null,
  descripcion text not null default '',
  texto       text not null default '',
  original    text not null default '',
  agentes     text[] not null default '{}',
  activo      boolean not null default true,
  position    integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint brand_skills_nombre_len      check (char_length(nombre) between 1 and 80),
  constraint brand_skills_descripcion_len check (char_length(descripcion) <= 300),
  constraint brand_skills_texto_len       check (char_length(texto) <= 8000),
  constraint brand_skills_original_len    check (char_length(original) <= 200000),
  constraint brand_skills_agentes_check   check (
    agentes <@ array['analisis', 'angulo', 'instagram', 'linkedin', 'criterio', 'revisor', 'redaccion', 'ideas', 'contenido', 'guion']::text[]
  )
);
create index if not exists brand_skills_account_idx on public.brand_skills (account_id, position);
alter table public.brand_skills enable row level security;
-- ================================================== recursos (reportes y guias)
-- El reporte o la guia que promete el cierre de una pieza, su buzon y el CTA
-- que lo pide (content_ctas.recurso_por_pieza). Tambien amplia las listas de
-- agentes, los ejemplos (red 'recurso') y web_entregas. La definicion completa
-- esta en migraciones/2026-10-24-recursos.sql. Las figuras de cada recurso
-- (content_recursos.figuras) se suman en migraciones/2026-10-25-recursos-figuras.sql.
