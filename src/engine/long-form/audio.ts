/**
 * Musica y efectos de long form: solo MP3 o WAV. Se valida en tres sitios con la misma regla:
 * el navegador (extension y tipo), el servidor (la firma del archivo, con `formatoPorFirma`) y el
 * motor (ffprobe). Sin dependencias: lo importan el navegador y el servidor.
 */

export const FORMATOS_AUDIO = ["mp3", "wav"] as const
export type FormatoAudio = (typeof FORMATOS_AUDIO)[number]

export const MAX_AUDIO_BYTES = 50 * 1024 * 1024

export const ACEPTA_AUDIO = ".mp3,.wav,audio/mpeg,audio/wav,audio/x-wav,audio/wave"

const MIME: Record<string, FormatoAudio> = {
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/wave": "wav",
  "audio/vnd.wave": "wav",
}

export const MENSAJE_FORMATO = "La música y los efectos tienen que ser MP3 o WAV."

/** Lo que dicen el nombre y el tipo. Si se contradicen, no vale. */
export function formatoPorNombre(nombre: string, mime: string): FormatoAudio | null {
  const ext = nombre.toLowerCase().split(".").pop() ?? ""
  const porExt = ext === "mp3" ? "mp3" : ext === "wav" ? "wav" : null
  if (!porExt) return null
  // Algunos navegadores no ponen tipo: entonces manda la extension y despues la firma.
  if (!mime) return porExt
  const porMime = MIME[mime.toLowerCase()]
  return porMime === porExt ? porExt : null
}

/** Lo que dicen los primeros bytes del archivo. */
export function formatoPorFirma(b: Uint8Array): FormatoAudio | null {
  if (b.length >= 12 && ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 4) === "WAVE") return "wav"
  if (b.length >= 3 && ascii(b, 0, 3) === "ID3") return "mp3"
  // Sin etiqueta ID3: un cuadro MPEG de audio, capa III.
  if (b.length >= 2 && b[0] === 0xff && (b[1] & 0xe0) === 0xe0 && ((b[1] >> 1) & 0x03) === 0x01) return "mp3"
  return null
}

function ascii(b: Uint8Array, desde: number, n: number): string {
  let s = ""
  for (let i = desde; i < desde + n; i++) s += String.fromCharCode(b[i])
  return s
}

export function mimeDe(f: FormatoAudio): string {
  return f === "mp3" ? "audio/mpeg" : "audio/wav"
}
