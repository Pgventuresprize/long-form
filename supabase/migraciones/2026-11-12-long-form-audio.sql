-- Long form, audio: musica de fondo y audio tomado de videos.
--
-- La biblioteca de audio de la marca (lf_biblioteca) acepta ahora M4A y AAC, y videos MP4 y MOV de los
-- que el motor usa solo el sonido (src/engine/long-form/audio.ts). Un video pesa mas que un audio: el
-- tope sube a 200 MB. "fondo" es un momento nuevo de la musica, sin cambio de esquema (momento es texto).
--
-- Los efectos de la biblioteca de Studio (`studio:<slug>`) no van en esta tabla: viven en el repo
-- (long-form/plantillas/sfx) y el estilo los nombra por su slug.
--
-- Aditiva: lo que ya estaba guardado sigue valiendo.
--
-- Para deshacer (solo si no quedaron filas con los formatos nuevos o de mas de 50 MB):
--   alter table public.lf_biblioteca drop constraint lf_biblioteca_formato_check;
--   alter table public.lf_biblioteca add constraint lf_biblioteca_formato_check check (formato in ('mp3', 'wav'));
--   alter table public.lf_biblioteca drop constraint lf_biblioteca_bytes_check;
--   alter table public.lf_biblioteca add constraint lf_biblioteca_bytes_check check (bytes > 0 and bytes <= 52428800);

alter table public.lf_biblioteca drop constraint if exists lf_biblioteca_formato_check;
alter table public.lf_biblioteca
  add constraint lf_biblioteca_formato_check check (formato in ('mp3', 'wav', 'm4a', 'aac', 'mp4', 'mov'));

alter table public.lf_biblioteca drop constraint if exists lf_biblioteca_bytes_check;
alter table public.lf_biblioteca
  add constraint lf_biblioteca_bytes_check check (bytes > 0 and bytes <= 209715200);
