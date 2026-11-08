/**
 * El estilo editorial de long form de una marca: como se ven y suenan sus videos largos.
 *
 * Vive en `lf_estilos.config` (jsonb). Lo leen la pantalla de Marca, la vista previa y el motor
 * (Python), asi que la forma es un contrato: si cambia, sube `VERSION_ESTILO` y `normalizarEstilo`
 * sabe leer la anterior. Sin dependencias de Next ni de la base: se puede probar suelto.
 */

export const VERSION_ESTILO = 1

export const NIVELES = ["rapido", "normal", "detallado"] as const
export type Nivel = (typeof NIVELES)[number]
export const NOMBRE_NIVEL: Record<Nivel, string> = { rapido: "Rápido", normal: "Normal", detallado: "Detallado" }

export const SILENCIOS = ["suave", "normal", "fuerte"] as const
export type Silencios = (typeof SILENCIOS)[number]

export const DENSIDADES = ["pocos", "normal", "muchos"] as const
export type Densidad = (typeof DENSIDADES)[number]

export const FORMATOS_CLIP = ["real", "dividida"] as const
export type FormatoClip = (typeof FORMATOS_CLIP)[number]

/** Los momentos que llevan efecto de sonido. Los nombres del motor van en `SFX_MOTOR`. */
export const MOMENTOS_SFX = ["rotulo", "barra", "barra_sale", "popup", "cita", "pregunta", "pregunta_sale", "transicion"] as const
export type MomentoSfx = (typeof MOMENTOS_SFX)[number]
export const NOMBRE_MOMENTO: Record<MomentoSfx, string> = {
  rotulo: "Entrada de rótulo",
  barra: "Entrada de barra",
  barra_sale: "Salida de barra",
  popup: "Pop-up",
  cita: "Cita",
  pregunta: "Entrada de pregunta",
  pregunta_sale: "Salida de pregunta",
  transicion: "Transición",
}
export const SFX_MOTOR: Record<MomentoSfx, string> = {
  rotulo: "rotulo-entra",
  barra: "barra-entra",
  barra_sale: "barra-sale",
  popup: "popup-entra",
  cita: "cita-entra",
  pregunta: "pregunta-entra",
  pregunta_sale: "pregunta-sale",
  transicion: "transicion",
}

/** Un archivo del bucket privado `longform`, o de otro bucket de Studio (logos, kit). */
export type Archivo = { bucket: string; ruta: string }

export type Fuente =
  | { origen: "studio"; nombre: "Plogy Display" | "HeroFont" | "Space Grotesk" }
  | { origen: "kit"; familia: string; archivo: Archivo }
  | { origen: "subida"; familia: string; archivo: Archivo }

export type CtaVideo = {
  clave: string
  /** Linea pequena encima del titular. */
  kick: string
  /** El titular. Lo que va entre *asteriscos* sale con el degradado de la marca. */
  titular: string
  /** La linea de apoyo. Lo que va entre *asteriscos* sale en negrita. */
  apoyo: string
  /** El texto del boton. */
  boton: string
  /** Debajo del QR. */
  pie: string
  /** El enlace del QR. Si hay `qr` subido, manda la imagen. */
  url: string
  qr: Archivo | null
}

export type Persona = { id: string; nombre: string; cargo: string; handle: string; red: string; foto: Archivo | null }

export type EstiloLongForm = {
  version: number
  colores: {
    tinta: string
    papel: string
    apagado: string
    acento: string
    acento_texto: string
    borde: string
    fondo_escenario: string
    kick: string
    degradado: string[]
  }
  fuente: Fuente
  /** La fuente del texto corrido (la linea de apoyo de las barras). */
  cuerpo: string
  logo: { sobre_acento: Archivo | null; sobre_oscuro: Archivo | null }
  caja_alfa: number
  handle: string
  web: string
  redes: [string, string][]
  textos: { pie_intro: string; cierre_titulo: string; pregunta: string; popup: string; en_esta_sesion: string }
  ctas: CtaVideo[]
  musica: { intro: string | null; cierre: string | null; volumen: number; loudness_lufs: number }
  sfx: Partial<Record<MomentoSfx, string | null>> & { volumen: number }
  subtitulos: {
    /** La fuente del estilo o una de Studio. */
    fuente: "marca" | "studio"
    tamano: "chico" | "mediano" | "grande"
    color: string
    fondo: string
    fondo_alfa: number
    /** La palabra que se esta diciendo, en este color. Vacio: sin resaltado. */
    resaltado: string
    mayusculas: boolean
  }
  silencios: Silencios
  graficos: Densidad
  clips: { formatos: FormatoClip[]; duracion_min: number; duracion_max: number; cta: string | null }
  esfuerzo: Nivel
  personas: Persona[]
}

const HEX = /^#[0-9a-f]{6}$/i
const hex = (v: unknown, def: string) => (typeof v === "string" && HEX.test(v.trim()) ? v.trim().toLowerCase() : def)
const txt = (v: unknown, def = "", max = 200) => (typeof v === "string" ? v.trim().slice(0, max) : def)
const num = (v: unknown, def: number, min: number, max: number) => {
  const n = typeof v === "number" ? v : Number(v)
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def
}
const de = <T extends string>(lista: readonly T[], v: unknown, def: T): T => (lista as readonly unknown[]).includes(v) ? (v as T) : def
const archivo = (v: unknown): Archivo | null => {
  const a = v as Partial<Archivo> | null
  return a && typeof a.bucket === "string" && typeof a.ruta === "string" && a.ruta ? { bucket: a.bucket, ruta: a.ruta } : null
}

export const ESTILO_BASE: EstiloLongForm = {
  version: VERSION_ESTILO,
  colores: {
    tinta: "#171310",
    papel: "#ffffff",
    apagado: "#625951",
    acento: "#ff5b00",
    acento_texto: "#b43d00",
    borde: "#a39486",
    fondo_escenario: "#100d0c",
    kick: "#c9bfb6",
    degradado: [],
  },
  fuente: { origen: "studio", nombre: "HeroFont" },
  cuerpo: "'Helvetica Neue', Helvetica, Arial, sans-serif",
  logo: { sobre_acento: null, sobre_oscuro: null },
  caja_alfa: 0.85,
  handle: "",
  web: "",
  redes: [],
  textos: { pie_intro: "", cierre_titulo: "Síguenos", pregunta: "Pregunta", popup: "Síguenos", en_esta_sesion: "En esta sesión" },
  ctas: [],
  musica: { intro: null, cierre: null, volumen: 0.8, loudness_lufs: -17 },
  sfx: { volumen: 0.7 },
  subtitulos: { fuente: "marca", tamano: "mediano", color: "#ffffff", fondo: "#000000", fondo_alfa: 0.85, resaltado: "", mayusculas: true },
  silencios: "normal",
  graficos: "normal",
  clips: { formatos: ["real", "dividida"], duracion_min: 30, duracion_max: 90, cta: null },
  esfuerzo: "normal",
  personas: [],
}

/** Lee lo guardado (de cualquier version) y lo deja completo y dentro de sus limites. */
export function normalizarEstilo(bruto: unknown): EstiloLongForm {
  const r = (bruto ?? {}) as Record<string, unknown>
  const b = ESTILO_BASE
  const c = (r.colores ?? {}) as Record<string, unknown>
  const f = (r.fuente ?? {}) as Record<string, unknown>
  const fuente: Fuente =
    f.origen === "kit" || f.origen === "subida"
      ? archivo(f.archivo)
        ? { origen: f.origen, familia: txt(f.familia, "Marca", 80), archivo: archivo(f.archivo)! }
        : b.fuente
      : { origen: "studio", nombre: de(["Plogy Display", "HeroFont", "Space Grotesk"] as const, f.nombre, "HeroFont") }
  const t = (r.textos ?? {}) as Record<string, unknown>
  const m = (r.musica ?? {}) as Record<string, unknown>
  const s = (r.sfx ?? {}) as Record<string, unknown>
  const sub = (r.subtitulos ?? {}) as Record<string, unknown>
  const cl = (r.clips ?? {}) as Record<string, unknown>
  const lg = (r.logo ?? {}) as Record<string, unknown>
  const id = (v: unknown) => (typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v) ? v : null)

  const sfx: EstiloLongForm["sfx"] = { volumen: num(s.volumen, b.sfx.volumen, 0, 1) }
  for (const k of MOMENTOS_SFX) sfx[k] = id(s[k])

  const formatos = Array.isArray(cl.formatos) ? cl.formatos.filter((x): x is FormatoClip => (FORMATOS_CLIP as readonly unknown[]).includes(x)) : b.clips.formatos
  const dmin = num(cl.duracion_min, b.clips.duracion_min, 15, 120)
  const dmax = num(cl.duracion_max, b.clips.duracion_max, 20, 180)

  const ctas = (Array.isArray(r.ctas) ? r.ctas : []).slice(0, 8).map((x, i): CtaVideo => {
    const o = (x ?? {}) as Record<string, unknown>
    return {
      clave: txt(o.clave, `cta-${i + 1}`, 40).toLowerCase().replace(/[^a-z0-9-]+/g, "-") || `cta-${i + 1}`,
      kick: txt(o.kick, "", 60),
      titular: txt(o.titular, "", 60),
      apoyo: txt(o.apoyo, "", 160),
      boton: txt(o.boton, "", 30),
      pie: txt(o.pie, "", 40),
      url: txt(o.url, "", 300),
      qr: archivo(o.qr),
    }
  })

  const personas = (Array.isArray(r.personas) ? r.personas : []).slice(0, 40).map((x): Persona => {
    const o = (x ?? {}) as Record<string, unknown>
    return {
      id: id(o.id) ?? crypto.randomUUID(),
      nombre: txt(o.nombre, "", 60),
      cargo: txt(o.cargo, "", 80),
      handle: txt(o.handle, "", 40),
      red: txt(o.red, "Instagram", 20),
      foto: archivo(o.foto),
    }
  })

  return {
    version: VERSION_ESTILO,
    colores: {
      tinta: hex(c.tinta, b.colores.tinta),
      papel: hex(c.papel, b.colores.papel),
      apagado: hex(c.apagado, b.colores.apagado),
      acento: hex(c.acento, b.colores.acento),
      acento_texto: hex(c.acento_texto, b.colores.acento_texto),
      borde: hex(c.borde, b.colores.borde),
      fondo_escenario: hex(c.fondo_escenario, b.colores.fondo_escenario),
      kick: hex(c.kick, b.colores.kick),
      degradado: Array.isArray(c.degradado) ? c.degradado.filter((x): x is string => typeof x === "string" && HEX.test(x)).slice(0, 5).map((x) => x.toLowerCase()) : [],
    },
    fuente,
    cuerpo: txt(r.cuerpo, b.cuerpo, 120).replace(/[;{}<>]/g, "") || b.cuerpo,
    logo: { sobre_acento: archivo(lg.sobre_acento), sobre_oscuro: archivo(lg.sobre_oscuro) },
    caja_alfa: num(r.caja_alfa, b.caja_alfa, 0.5, 1),
    handle: txt(r.handle, "", 40),
    web: txt(r.web, "", 80),
    redes: (Array.isArray(r.redes) ? r.redes : [])
      .filter((x): x is [unknown, unknown] => Array.isArray(x) && x.length === 2)
      .slice(0, 6)
      .map(([a, z]) => [txt(a, "", 20), txt(z, "", 40)] as [string, string])
      .filter(([a, z]) => a && z),
    textos: {
      pie_intro: txt(t.pie_intro, b.textos.pie_intro, 60),
      cierre_titulo: txt(t.cierre_titulo, b.textos.cierre_titulo, 40) || b.textos.cierre_titulo,
      pregunta: txt(t.pregunta, b.textos.pregunta, 20) || b.textos.pregunta,
      popup: txt(t.popup, b.textos.popup, 30) || b.textos.popup,
      en_esta_sesion: txt(t.en_esta_sesion, b.textos.en_esta_sesion, 40) || b.textos.en_esta_sesion,
    },
    ctas,
    musica: { intro: id(m.intro), cierre: id(m.cierre), volumen: num(m.volumen, b.musica.volumen, 0, 1), loudness_lufs: num(m.loudness_lufs, b.musica.loudness_lufs, -30, -8) },
    sfx,
    subtitulos: {
      fuente: sub.fuente === "studio" ? "studio" : "marca",
      tamano: de(["chico", "mediano", "grande"] as const, sub.tamano, b.subtitulos.tamano),
      color: hex(sub.color, b.subtitulos.color),
      fondo: hex(sub.fondo, b.subtitulos.fondo),
      fondo_alfa: num(sub.fondo_alfa, b.subtitulos.fondo_alfa, 0, 1),
      resaltado: typeof sub.resaltado === "string" && HEX.test(sub.resaltado) ? sub.resaltado.toLowerCase() : "",
      mayusculas: sub.mayusculas !== false,
    },
    silencios: de(SILENCIOS, r.silencios, b.silencios),
    graficos: de(DENSIDADES, r.graficos, b.graficos),
    clips: {
      formatos: formatos.length ? [...new Set(formatos)] : b.clips.formatos,
      duracion_min: Math.min(dmin, dmax - 5),
      duracion_max: Math.max(dmax, dmin + 5),
      cta: ctas.some((x) => x.clave === cl.cta) ? String(cl.cta) : null,
    },
    esfuerzo: de(NIVELES, r.esfuerzo, b.esfuerzo),
    personas: personas.filter((p) => p.nombre),
  }
}

// ---------------------------------------------------------------- lo que lee el motor

/** Silencios: los parametros que usa `plan.py` (umbral relativo, minimo que se corta, aire). */
export const PARAMETROS_SILENCIO: Record<Silencios, { silencio_k: number; silencio_min: number; silencio_aire: number }> = {
  suave: { silencio_k: 0.3, silencio_min: 1.0, silencio_aire: 0.3 },
  normal: { silencio_k: 0.35, silencio_min: 0.6, silencio_aire: 0.18 },
  fuerte: { silencio_k: 0.4, silencio_min: 0.4, silencio_aire: 0.12 },
}

/** Densidad de graficos: cada cuantos minutos una barra y un pop-up, y cuantas veces cada CTA. */
export const PARAMETROS_GRAFICOS: Record<Densidad, { barra_cada_min: number; popup_cada_min: number; barras_por_cta_min: number }> = {
  pocos: { barra_cada_min: 12, popup_cada_min: 15, barras_por_cta_min: 1 },
  normal: { barra_cada_min: 7, popup_cada_min: 9, barras_por_cta_min: 2 },
  muchos: { barra_cada_min: 5, popup_cada_min: 6, barras_por_cta_min: 3 },
}

/** El degradado de la marca, o uno de dos tonos del acento si la marca no usa degradado. */
export function degradadoDe(e: EstiloLongForm): string[] {
  return e.colores.degradado.length >= 2 ? e.colores.degradado : [e.colores.acento, e.colores.acento_texto]
}

export function gradCss(paradas: string[], angulo = "90deg"): string {
  const n = paradas.length - 1
  return `linear-gradient(${angulo}, ${paradas.map((c, i) => `${c} ${Math.round((i * 100) / Math.max(n, 1))}%`).join(", ")})`
}

/** `*resaltado*` a HTML: en el titular de la barra va en <span> (degradado), en el apoyo en <b>. */
export function marcado(texto: string, etiqueta: "span" | "b"): string {
  const esc = texto.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
  return esc.replace(/\*([^*]+)\*/g, `<${etiqueta}>$1</${etiqueta}>`)
}
