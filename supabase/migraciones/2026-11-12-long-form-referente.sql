-- Long form: el referente de edicion.
--
-- La persona puede adjuntar a un proyecto un video cuya edicion quiere imitar. Va como un archivo mas
-- del proyecto, con tipo 'referente' (uno por proyecto). El motor lo mide y lo entiende en la etapa
-- `referente` (long-form/motor/editor/etapas/referente.py) y deja el resultado en
-- lf_proyectos.estado.referente. Del referente solo se toma el estilo: nada suyo llega al video final.
--
-- El enlace (en vez del archivo) no necesita columnas: va en lf_proyectos.spec.referente_url.
--
-- Aditiva e idempotente: solo amplia el check de lf_archivos.tipo.
--
-- Para deshacer (antes, borrar o cambiar de tipo las filas con tipo = 'referente'):
--   alter table public.lf_archivos drop constraint if exists lf_archivos_tipo_check;
--   alter table public.lf_archivos add constraint lf_archivos_tipo_check check (tipo in ('fuente', 'audio', 'pdf',
--     'ilustracion', 'foto', 'musica', 'salida', 'proxy', 'clip', 'zip', 'miniatura'));

alter table public.lf_archivos drop constraint if exists lf_archivos_tipo_check;
alter table public.lf_archivos add constraint lf_archivos_tipo_check
  check (tipo in ('fuente', 'audio', 'pdf', 'ilustracion', 'foto', 'musica', 'salida', 'proxy', 'clip', 'zip', 'miniatura', 'referente'));
