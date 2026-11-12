/**
 * Lo que la pantalla "Nuevo video" arma antes de crear el proyecto: que es cada archivo, en que orden van los
 * videos, para que suena cada musica y las opciones de entrega que van a `spec.opciones`. Sin dependencias: lo
 * importan el navegador, el servidor y las pruebas.
 */

// ------------------------------------------------------------------ archivos

/**
 * Lo que la persona dice que es cada archivo, segun donde lo puso: un video para editar, el audio grabado
 * aparte (reemplaza al de camara), apoyo (b-roll o imagen) o un PDF. Nunca se adivina por la extension.
 */
export const TIPOS_ENTRADA = ["fuente", "audio", "ilustracion", "pdf"] as const
export type TipoEntrada = (typeof TIPOS_ENTRADA)[number]

const VIDEO = /\.(mp4|mov|m4v|mkv|webm)$/i
const EXTENSIONES: Record<TipoEntrada, RegExp> = {
  fuente: VIDEO,
  audio: /\.(mp3|wav|m4a|aac)$/i,
  ilustracion: /\.(mp4|mov|m4v|mkv|webm|png|jpe?g|webp)$/i,
  pdf: /\.pdf$/i,
}

/** Para el `accept` de cada selector de archivos. */
export const ACEPTA_ENTRADA: Record<TipoEntrada, string> = {
  fuente: ".mp4,.mov,.m4v,.mkv,.webm,video/*",
  audio: ".mp3,.wav,.m4a,.aac,audio/*",
  ilustracion: ".mp4,.mov,.m4v,.mkv,.webm,.png,.jpg,.jpeg,.webp,video/*,image/png,image/jpeg,image/webp",
  pdf: ".pdf,application/pdf",
}

export const MENSAJE_ENTRADA: Record<TipoEntrada, string> = {
  fuente: "no es un video (mp4, mov, m4v, mkv o webm).",
  audio: "no es un audio (mp3, wav, m4a o aac).",
  ilustracion: "no es un video ni una imagen (mp4, mov, png, jpg o webp).",
  pdf: "no es un PDF.",
}

export function encajaEnTipo(nombre: string, tipo: TipoEntrada): boolean {
  return EXTENSIONES[tipo].test(nombre)
}

/** En la carpeta de apoyo, un PDF va como `pdf` y lo demas (videos e imagenes) como `ilustracion`. */
export function tipoDeApoyo(nombre: string): "ilustracion" | "pdf" | null {
  if (encajaEnTipo(nombre, "pdf")) return "pdf"
  return encajaEnTipo(nombre, "ilustracion") ? "ilustracion" : null
}

export const esVideoPorNombre = (nombre: string) => VIDEO.test(nombre)

/**
 * El orden de los videos que recibe el motor: los subidos y los reusados de la biblioteca, cada uno con su
 * posicion en la lista de la pantalla. Sin posicion, los subidos van primero y los reusados despues, cada grupo
 * en el orden en que llego. Devuelve de donde sale cada uno.
 */
export function ordenDeFuentes(subidos: { orden?: number }[], reusados: { orden?: number }[]): ({ de: "subida"; i: number } | { de: "reuso"; i: number })[] {
  const n = subidos.length
  const todos = [
    ...subidos.map((s, i) => ({ de: "subida" as const, i, orden: Number.isFinite(s.orden) ? Number(s.orden) : i })),
    ...reusados.map((r, i) => ({ de: "reuso" as const, i, orden: Number.isFinite(r.orden) ? Number(r.orden) : n + 1000 + i })),
  ]
  // sort es estable: a igual posicion, manda el orden de llegada.
  return todos.sort((a, b) => a.orden - b.orden).map(({ de, i }) => ({ de, i }))
}

/** Mover un elemento de una lista una posicion arriba (-1) o abajo (+1). */
export function mover<T>(lista: T[], i: number, paso: -1 | 1): T[] {
  const j = i + paso
  if (i < 0 || i >= lista.length || j < 0 || j >= lista.length) return lista
  const out = [...lista]
  ;[out[i], out[j]] = [out[j], out[i]]
  return out
}

// ------------------------------------------------------------------ musica

/** Para que suena una musica del video: al empezar, bajo toda la conversacion o al cerrar. */
export const USOS_MUSICA = ["intro", "fondo", "cierre"] as const
export type UsoMusica = (typeof USOS_MUSICA)[number]
export const NOMBRE_USO: Record<UsoMusica, string> = { intro: "Inicio", fondo: "Fondo", cierre: "Cierre" }

/**
 * Darle un uso a una pista. Cada uso es de una sola: si otra ya lo tenia, se queda sin uso (la persona elige otro
 * para ella o la quita).
 */
export function conUso<T extends { id: string; uso: UsoMusica | null }>(pistas: T[], id: string, uso: UsoMusica | null): T[] {
  return pistas.map((p) => (p.id === id ? { ...p, uso } : uso && p.uso === uso ? { ...p, uso: null } : p))
}

/** El primer uso que nadie tiene, para la pista que se acaba de agregar. Fondo primero: es el que mas se nota. */
export function usoLibre(pistas: { uso: UsoMusica | null }[], preferido?: UsoMusica | null): UsoMusica | null {
  const tomados = new Set(pistas.map((p) => p.uso))
  if (preferido && !tomados.has(preferido)) return preferido
  return (["fondo", "intro", "cierre"] as const).find((u) => !tomados.has(u)) ?? null
}

// ------------------------------------------------------------------ opciones de entrega

export const FORMATOS_VIDEO = ["16:9", "9:16", "1:1"] as const
export type FormatoVideo = (typeof FORMATOS_VIDEO)[number]

/**
 * La duracion del video final: "lo que de el material" o un rango. Los rangos crecen en escala logaritmica (cada
 * uno es mas o menos el doble del anterior): de 30 s a 1 min, de 1 a 2, de 2 a 4... hasta 1 a 2 h. Asi el
 * control deslizable sirve igual para un video corto que para uno largo. Van en orden: el indice es la posicion
 * del control.
 */
export const DURACIONES = ["auto", "0.5-1", "1-2", "2-4", "4-8", "8-15", "15-30", "30-60", "60-120"] as const
export type Duracion = (typeof DURACIONES)[number]
/** Cada rango en minutos: [minimo, maximo]. Es lo que lee el motor (`duracion_rango_min`). */
export const RANGO_DURACION: Record<Exclude<Duracion, "auto">, [number, number]> = {
  "0.5-1": [0.5, 1],
  "1-2": [1, 2],
  "2-4": [2, 4],
  "4-8": [4, 8],
  "8-15": [8, 15],
  "15-30": [15, 30],
  "30-60": [30, 60],
  "60-120": [60, 120],
}

/** "30 s", "1 min", "1 h". */
export function minutosTexto(m: number): string {
  if (m < 1) return `${Math.round(m * 60)} s`
  if (m >= 60 && m % 60 === 0) return `${m / 60} h`
  return `${m} min`
}

export const NOMBRE_DURACION: Record<Duracion, string> = Object.fromEntries(
  DURACIONES.map((d) => {
    if (d === "auto") return [d, "Lo que dé el material"]
    const [a, b] = RANGO_DURACION[d]
    // "30 s – 1 min", "1–2 min", "1–2 h": la unidad una vez si es la misma
    const ua = minutosTexto(a).split(" ")[1]
    const ub = minutosTexto(b).split(" ")[1]
    const na = minutosTexto(a).split(" ")[0]
    return [d, ua === ub ? `${na}–${minutosTexto(b)}` : `${minutosTexto(a)} – ${minutosTexto(b)}`]
  })
) as Record<Duracion, string>

/** Auto deja la decision al estilo de la marca y al motor; Si y No mandan. */
export const TRIESTADOS = ["auto", "si", "no"] as const
export type Triestado = (typeof TRIESTADOS)[number]
export const NOMBRE_TRIESTADO: Record<Triestado, string> = { auto: "Auto", si: "Sí", no: "No" }

/**
 * `intro` y `cierre`: true es "la de mi marca" (lo que diga su estilo: tarjeta de Studio, su video o ninguno);
 * false la quita en este video.
 */
export type OpcionesVideo = { formato: FormatoVideo; duracion: Duracion; subtitulos: Triestado; gancho: Triestado; capitulos: boolean; intro: boolean; cierre: boolean }
export const OPCIONES_BASE: OpcionesVideo = { formato: "16:9", duracion: "auto", subtitulos: "auto", gancho: "auto", capitulos: true, intro: true, cierre: true }

/**
 * En un video de hasta 2 minutos, una intro y un cierre (unos 11 s con las tarjetas de Studio) pesan demasiado:
 * con esas duraciones arrancan apagados. La persona los puede volver a encender.
 */
export const DURACIONES_CORTAS: readonly Duracion[] = ["0.5-1", "1-2"]
export const esDuracionCorta = (d: Duracion) => DURACIONES_CORTAS.includes(d)

/**
 * Cambiar la duracion: la intro y el cierre que la persona no toco siguen a la duracion (apagados en un video
 * corto, encendidos si no); los que toco se quedan como los dejo.
 */
export function conDuracion(o: OpcionesVideo, duracion: Duracion, tocados: { intro: boolean; cierre: boolean }): OpcionesVideo {
  const def = !esDuracionCorta(duracion)
  return { ...o, duracion, intro: tocados.intro ? o.intro : def, cierre: tocados.cierre ? o.cierre : def }
}

const de = <T extends string>(lista: readonly T[], v: unknown): T | null => ((lista as readonly unknown[]).includes(v) ? (v as T) : null)

/** Las opciones que llegan del navegador, revisadas. Sin opciones, las de siempre. */
export function opcionesValidas(v: unknown): { ok: true; opciones: OpcionesVideo } | { ok: false; error: string } {
  if (v === undefined || v === null) return { ok: true, opciones: { ...OPCIONES_BASE } }
  const o = v as Partial<Record<keyof OpcionesVideo, unknown>>
  const formato = de(FORMATOS_VIDEO, o.formato ?? OPCIONES_BASE.formato)
  if (!formato) return { ok: false, error: "Elige el formato: 16:9, 9:16 o 1:1." }
  const duracion = de(DURACIONES, o.duracion ?? OPCIONES_BASE.duracion)
  if (!duracion) return { ok: false, error: "Esa duración no existe." }
  const subtitulos = de(TRIESTADOS, o.subtitulos ?? "auto")
  const gancho = de(TRIESTADOS, o.gancho ?? "auto")
  if (!subtitulos || !gancho) return { ok: false, error: "Elige Auto, Sí o No." }
  if (o.capitulos !== undefined && typeof o.capitulos !== "boolean") return { ok: false, error: "Capítulos va encendido o apagado." }
  if ((o.intro !== undefined && typeof o.intro !== "boolean") || (o.cierre !== undefined && typeof o.cierre !== "boolean")) return { ok: false, error: "La intro y el cierre van con los de tu marca o sin ellos." }
  return {
    ok: true,
    opciones: { formato, duracion, subtitulos, gancho, capitulos: o.capitulos ?? OPCIONES_BASE.capitulos, intro: o.intro ?? OPCIONES_BASE.intro, cierre: o.cierre ?? OPCIONES_BASE.cierre },
  }
}

/**
 * Lo que va a `spec.opciones` (el contrato con el motor): `formato` y `capitulos` siempre; con un rango
 * elegido, `duracion_rango_min` ([minimo, maximo] en minutos) y `duracion_objetivo_min` (el maximo: el motor
 * corta hasta caber); `subtitulos` y `gancho` solo si la persona dijo Si o No (en Auto no van, y decide el motor);
 * `intro` y `cierre` solo en false, cuando la persona los quita (sin ellos, el motor usa los de la marca).
 */
export function opcionesDelSpec(o: OpcionesVideo): Record<string, number | boolean | string | number[]> {
  const r: Record<string, number | boolean | string | number[]> = { formato: o.formato, capitulos: o.capitulos }
  if (o.duracion !== "auto") {
    const [a, b] = RANGO_DURACION[o.duracion]
    r.duracion_rango_min = [a, b]
    r.duracion_objetivo_min = b
  }
  if (o.subtitulos !== "auto") r.subtitulos = o.subtitulos === "si"
  if (o.gancho !== "auto") r.gancho = o.gancho === "si"
  if (o.intro === false) r.intro = false
  if (o.cierre === false) r.cierre = false
  return r
}

// ------------------------------------------------------------------ indicaciones

/** Sumar una indicacion rapida a las notas, en su propia linea, sin repetirla. */
export function agregarIndicacion(texto: string, indicacion: string): string {
  const t = texto.trimEnd()
  if (t.toLowerCase().includes(indicacion.toLowerCase())) return texto
  return t ? `${t}\n${indicacion}` : indicacion
}

/** El titulo que se propone a partir del nombre del primer video. */
export function tituloDeArchivo(nombre: string): string {
  return nombre.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 120)
}
