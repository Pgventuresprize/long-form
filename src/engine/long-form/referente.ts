/**
 * El referente de edicion: un video que la persona quiere imitar. El motor lo mide y lo entiende en la etapa
 * `referente` (long-form/motor/editor/etapas/referente.py) y deja aqui lo que encontro. Del referente solo se
 * toma el estilo: nada suyo llega al video final.
 */

export const VIDEO_REFERENTE = /\.(mp4|mov|m4v|mkv|webm)$/i

/**
 * Donde va el referente en Storage. Lleva su prefijo propio (los demas archivos van numerados, "entrada/3-x.mp4"):
 * asi el navegador reconoce su firma y le da el archivo del referente.
 */
export function rutaReferente(accountId: string, proyectoId: string, nombreLimpio: string): string {
  return `${accountId}/${proyectoId}/entrada/referente-${nombreLimpio}`
}

export function esRutaReferente(ruta: string): boolean {
  return /\/entrada\/referente-[^/]*$/.test(ruta)
}

/** Lo que guarda el motor en `estado.referente` (None si el proyecto no tiene). */
export type EstadoReferente = {
  origen: "archivo" | "enlace"
  metricas: {
    duracion_s: number
    analizado_s: number
    recortado: boolean
    planos: { cortes: number; cortes_min: number; mediana_s: number; distribucion: Record<string, number> }
    audio: { voz: boolean; ritmo?: "suave" | "normal" | "fuerte"; musica: string } | null
  }
  ficha: {
    por_ia: boolean
    resumen: string
    tono_editorial: string
  } & Record<string, unknown>
  parametros: Record<string, number | boolean>
  resumen: { ve: string[]; aplica: string[]; pendiente: string[] }
}

/** El referente del estado del proyecto, si la etapa ya lo analizo y tiene lo que la tarjeta muestra. */
export function referenteDe(estado: Record<string, unknown>): EstadoReferente | null {
  const r = estado.referente as EstadoReferente | null | undefined
  return r && typeof r === "object" && r.resumen && Array.isArray(r.resumen.ve) ? r : null
}

const PRIVADA = /^(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|0\.|\[)/i

/**
 * Un enlace de referente usable: http o https, con dominio publico y sin datos de acceso. El motor solo lo baja
 * si quien lo opera encendio yt-dlp (LF_YTDLP); si no, la etapa pide subir el archivo. No es una prueba de que
 * el video exista: eso lo dice el motor al bajarlo.
 */
export function validarUrlReferente(texto: string): { ok: true; url: string } | { ok: false; error: string } {
  const t = texto.trim()
  if (!t) return { ok: false, error: "Pega el enlace del video de referencia." }
  if (t.length > 500) return { ok: false, error: "El enlace del referente es demasiado largo." }
  let u: URL
  try {
    u = new URL(t)
  } catch {
    return { ok: false, error: "El enlace del referente no es válido." }
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return { ok: false, error: "El enlace del referente tiene que empezar por https://." }
  if (u.username || u.password) return { ok: false, error: "El enlace del referente no puede llevar usuario ni contraseña." }
  if (!u.hostname.includes(".") || PRIVADA.test(u.hostname)) return { ok: false, error: "El enlace del referente tiene que ser de un sitio público." }
  return { ok: true, url: u.toString() }
}
