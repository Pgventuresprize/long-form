/**
 * Musica y efectos de long form. Se aceptan audios (MP3, WAV, M4A, AAC) y videos (MP4, MOV): de un
 * video se usa solo su audio, que extrae el motor con ffmpeg al editar. Se valida en tres sitios con la
 * misma regla: el navegador (extension y tipo), el servidor (la firma del archivo, con
 * `formatoPorFirma`) y el motor (ffprobe: si no trae pista de audio, se avisa y no se usa). Sin
 * dependencias: lo importan el navegador y el servidor.
 */

export const FORMATOS_AUDIO = ["mp3", "wav", "m4a", "aac", "mp4", "mov"] as const
export type FormatoAudio = (typeof FORMATOS_AUDIO)[number]

/** Un audio solo pesa poco; un video trae imagen y pesa mas, aunque solo se use su sonido. */
export const MAX_AUDIO_BYTES = 50 * 1024 * 1024
export const MAX_VIDEO_AUDIO_BYTES = 200 * 1024 * 1024

export const esVideo = (f: FormatoAudio) => f === "mp4" || f === "mov"
export const maxBytesDe = (f: FormatoAudio) => (esVideo(f) ? MAX_VIDEO_AUDIO_BYTES : MAX_AUDIO_BYTES)

export const ACEPTA_AUDIO =
  ".mp3,.wav,.m4a,.aac,.mp4,.mov,audio/mpeg,audio/wav,audio/x-wav,audio/wave,audio/mp4,audio/x-m4a,audio/aac,video/mp4,video/quicktime"

const EXT: Record<string, FormatoAudio> = { mp3: "mp3", wav: "wav", m4a: "m4a", aac: "aac", mp4: "mp4", mov: "mov" }

const MIME: Record<string, FormatoAudio[]> = {
  "audio/mpeg": ["mp3"],
  "audio/mp3": ["mp3"],
  "audio/wav": ["wav"],
  "audio/x-wav": ["wav"],
  "audio/wave": ["wav"],
  "audio/vnd.wave": ["wav"],
  "audio/mp4": ["m4a", "mp4"],
  "audio/x-m4a": ["m4a"],
  "audio/m4a": ["m4a"],
  "audio/aac": ["aac", "m4a"],
  "audio/x-aac": ["aac"],
  "video/mp4": ["mp4", "m4a"],
  "video/quicktime": ["mov"],
}

export const MENSAJE_FORMATO = "La música y los efectos tienen que ser MP3, WAV, M4A o AAC, o un video MP4 o MOV (se usa su audio)."

export function mensajeTamano(f: FormatoAudio): string {
  return esVideo(f) ? "Un video no puede pasar de 200 MB. Si es más largo, sube solo el audio." : "El archivo no puede pasar de 50 MB."
}

/** Lo que dicen el nombre y el tipo. Si se contradicen, no vale. */
export function formatoPorNombre(nombre: string, mime: string): FormatoAudio | null {
  const porExt = EXT[nombre.toLowerCase().split(".").pop() ?? ""]
  if (!porExt) return null
  // Algunos navegadores no ponen tipo: entonces manda la extension y despues la firma.
  if (!mime) return porExt
  return MIME[mime.toLowerCase()]?.includes(porExt) ? porExt : null
}

/**
 * El contenedor que dicen los primeros bytes: "mp4" vale para M4A, MP4 y MOV (todos son cajas ISO
 * con "ftyp" o, en los MOV viejos, "moov"/"wide"/"mdat" al empezar).
 */
export type Contenedor = "mp3" | "wav" | "aac" | "mp4"

export function formatoPorFirma(b: Uint8Array): Contenedor | null {
  if (b.length >= 12 && ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 4) === "WAVE") return "wav"
  if (b.length >= 3 && ascii(b, 0, 3) === "ID3") return "mp3"
  if (b.length >= 8 && ["ftyp", "moov", "wide", "mdat", "free", "skip"].includes(ascii(b, 4, 4))) return "mp4"
  if (b.length >= 2 && b[0] === 0xff && (b[1] & 0xe0) === 0xe0) {
    const capa = (b[1] >> 1) & 0x03
    // MPEG capa III es MP3; capa "00" con sincronia de 12 bits es una cabecera ADTS (AAC suelto).
    if (capa === 0x01) return "mp3"
    if (capa === 0x00 && (b[1] & 0xf0) === 0xf0) return "aac"
  }
  return null
}

export const contenedorDe = (f: FormatoAudio): Contenedor => (f === "m4a" || f === "mp4" || f === "mov" ? "mp4" : f)

function ascii(b: Uint8Array, desde: number, n: number): string {
  let s = ""
  for (let i = desde; i < desde + n; i++) s += String.fromCharCode(b[i])
  return s
}

// ------------------------------------------------------------------ intro y cierre propios

/**
 * La intro o el cierre que la marca ya tiene hechos (estilo `intro` / `cierre` en modo `video`): un MP4 o MOV de
 * hasta 200 MB. Misma regla que la musica en video: extension y tipo en el navegador, firma en el servidor y
 * ffprobe en el motor (si no se lee, va la tarjeta de Studio).
 */
export const ACEPTA_VIDEO_MARCA = ".mp4,.mov,video/mp4,video/quicktime"
export const MENSAJE_VIDEO_MARCA = "La intro y el cierre tienen que ser un video MP4 o MOV."
export const MENSAJE_TAMANO_VIDEO_MARCA = "El video no puede pasar de 200 MB."

export function formatoVideoMarca(nombre: string, mime: string): "mp4" | "mov" | null {
  const f = formatoPorNombre(nombre, mime)
  return f === "mp4" || f === "mov" ? f : null
}

export function mimeDe(f: FormatoAudio): string {
  return { mp3: "audio/mpeg", wav: "audio/wav", m4a: "audio/mp4", aac: "audio/aac", mp4: "video/mp4", mov: "video/quicktime" }[f]
}
