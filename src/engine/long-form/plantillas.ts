import { readFileSync } from "node:fs"
import path from "node:path"

import { degradadoDe, gradCss, marcado, type Archivo, type EstiloLongForm } from "./estilo"

/**
 * Las plantillas de los graficos de long form (`long-form/plantillas`), llenas con el estilo de la
 * marca. El motor llena las mismas en Python (`long-form/motor/editor/plantillas.py`): una prueba
 * compara las dos salidas. Aqui sirven para la vista previa de Marca.
 */

export const ANCHO = 1920
export const ALTO = 1080

export type TipoPieza = "pregunta" | "cita" | "rotulo" | "barra" | "popup" | "etiquetas" | "foto" | "tarjeta-intro" | "tarjeta-cierre"
export type Disposicion = "pantalla" | "escenario"

const DIR = path.join(process.cwd(), "long-form", "plantillas")
const cache = new Map<string, string>()

export function leerPlantilla(nombre: string): string {
  let t = cache.get(nombre)
  if (t === undefined) {
    t = readFileSync(path.join(DIR, nombre), "utf8")
    cache.set(nombre, t)
  }
  return t
}

const escapar = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;")

export type Datos = Record<string, string | number | null | undefined>

/** `{{#x}}..{{/x}}` si x tiene valor, `{{{x}}}` tal cual, `{{x}}` escapado. Lo mismo que el motor. */
export function rellenar(plantilla: string, datos: Datos): string {
  const valor = (k: string) => {
    const v = datos[k]
    return v === null || v === undefined ? "" : String(v)
  }
  let salida = plantilla.replace(/\{\{#(\w+)\}\}([\s\S]*?)\{\{\/\1\}\}/g, (_, k: string, dentro: string) => (valor(k) ? dentro : ""))
  salida = salida.replace(/\{\{\{(\w+)\}\}\}/g, (_, k: string) => valor(k))
  salida = salida.replace(/\{\{(\w+)\}\}/g, (_, k: string) => escapar(valor(k)))
  return salida
}

/** En CSS los huecos son valores: no se escapan como HTML, pero no pueden cerrar la regla. */
function rellenarCss(css: string, datos: Datos): string {
  return css.replace(/\{\{(\w+)\}\}/g, (_, k: string) => {
    const v = datos[k]
    const s = v === null || v === undefined ? "" : String(v)
    return k === "fuentes" ? s : s.replace(/[<>{}]/g, "")
  })
}

export function esferaSvg(paradas: string[]): string {
  const n = paradas.length - 1
  const stops = paradas.map((c, i) => `<stop offset="${(i / Math.max(n, 1)).toFixed(2)}" stop-color="${c}"/>`).join("")
  return (
    `<svg class="sphere" viewBox="27 27 27 27"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">${stops}` +
    `</linearGradient></defs><circle cx="40.5" cy="40.5" r="13.5" fill="url(#g)"/></svg>`
  )
}

export function familiaDe(e: EstiloLongForm): string {
  return e.fuente.origen === "studio" ? e.fuente.nombre : e.fuente.familia
}

/** Las variables de los CSS, sacadas del estilo. */
export function variablesCss(e: EstiloLongForm, fuentesCss: string, fondo = "transparent"): Datos {
  const grad = degradadoDe(e)
  return {
    fuentes: fuentesCss,
    ancho: ANCHO,
    alto: ALTO,
    fondo,
    familia: familiaDe(e).replace(/['"\\]/g, ""),
    tinta: e.colores.tinta,
    papel: e.colores.papel,
    acento: e.colores.acento,
    acento_texto: e.colores.acento_texto,
    apagado: e.colores.apagado,
    kick: e.colores.kick,
    borde: e.colores.borde,
    caja_alfa: e.caja_alfa,
    degradado_h: gradCss(grad),
    degradado_v: gradCss(grad, "180deg"),
    cuerpo: e.cuerpo,
  }
}

export type Recursos = {
  /** El @font-face de la fuente del estilo, ya con su archivo. */
  fuentesCss: string
  /** URL (o data URI) de un archivo del estilo. */
  url: (a: Archivo | null) => string | null
}

/** Los huecos de cada pieza a partir de lo que dice el guion (o los datos de ejemplo). */
export function datosDePieza(e: EstiloLongForm, tipo: TipoPieza, p: Datos, r: Recursos): Datos {
  const esfera = esferaSvg(degradadoDe(e))
  switch (tipo) {
    case "pregunta":
      return { etiqueta: e.textos.pregunta, num: p.num, encabezado: p.encabezado, texto: p.texto }
    case "cita":
      return { texto: p.texto, quien: p.quien, rol: p.rol }
    case "rotulo":
      return { esfera, nombre: p.nombre, rol: p.rol, handle: p.handle, red: p.red ?? "Instagram" }
    case "barra": {
      const cta = e.ctas.find((c) => c.clave === p.cta) ?? e.ctas[0]
      if (!cta) return { esfera, kick: "", head: "", sub: "", cta: "", qr: null, cap: "" }
      return {
        esfera,
        kick: cta.kick,
        head: marcado(cta.titular, "span"),
        sub: marcado(cta.apoyo, "b"),
        cta: cta.boton,
        qr: r.url(cta.qr),
        cap: cta.pie,
      }
    }
    case "popup":
      return { esfera, texto: e.textos.popup, handle: e.handle }
    case "etiquetas":
      return { izquierda: p.izquierda, derecha: p.derecha }
    case "foto":
      return { ...p, wmax: Number(p.w) - 24, hmax: Number(p.h) - 24 }
    case "tarjeta-intro": {
      const t = String(p.titulo ?? "")
      return { logo: logoHtml(e, r), titulo: t, tam: t.length <= 16 ? 170 : t.length <= 28 ? 130 : 104, subtitulo: p.subtitulo, pie: p.pie ?? e.textos.pie_intro }
    }
    case "tarjeta-cierre": {
      const chips = e.redes.map(([red, h]) => `<span class="chip">${escapar(red)} <em>${escapar(h)}</em></span>`).join("")
      return { logo: logoHtml(e, r), titulo: e.textos.cierre_titulo, handle: e.handle, chips, web: e.web }
    }
  }
}

function logoHtml(e: EstiloLongForm, r: Recursos): string {
  const url = r.url(e.logo.sobre_acento)
  return url ? `<img class="logo" src="${escapar(url)}" alt="">` : ""
}

/** La pagina completa de una pieza, como la abre el navegador del motor. */
export function paginaDePieza(e: EstiloLongForm, tipo: TipoPieza, p: Datos, r: Recursos, disposicion: Disposicion = "pantalla"): string {
  const tarjeta = tipo === "tarjeta-intro" || tipo === "tarjeta-cierre"
  const vars = variablesCss(e, r.fuentesCss, tarjeta ? e.colores.acento : "transparent")
  const css = rellenarCss(leerPlantilla("base.css"), vars) + rellenarCss(leerPlantilla(tarjeta ? "tarjetas.css" : "piezas.css"), vars)
  const cuerpo = rellenar(leerPlantilla(`${tipo}.html`), datosDePieza(e, tipo, p, r))
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><style>${css}</style></head><body class="d-${disposicion}">${cuerpo}</body></html>`
}

/**
 * Los subtitulos de un clip vertical (1080x1920), para la vista previa. El motor los quema con
 * libass a partir de los mismos valores; esto es como se ven sobre un cuadro.
 */
export function paginaDeSubtitulo(e: EstiloLongForm, r: Recursos, texto = "La idea clara gana"): string {
  const s = e.subtitulos
  const tam = s.tamano === "chico" ? 54 : s.tamano === "grande" ? 86 : 68
  const familia = s.fuente === "marca" ? familiaDe(e).replace(/['"\\]/g, "") : "HeroFont"
  const alfa = Math.round(s.fondo_alfa * 255).toString(16).padStart(2, "0")
  const palabras = (s.mayusculas ? texto.toUpperCase() : texto).split(/\s+/)
  const cuerpo = palabras
    .map((p, i) => (s.resaltado && i === palabras.length - 1 ? `<span style="color:${s.resaltado}">${escapar(p)}</span>` : escapar(p)))
    .join(" ")
  return (
    `<!doctype html><html lang="es"><head><meta charset="utf-8"><style>${r.fuentesCss}` +
    `*{margin:0;padding:0;box-sizing:border-box}html,body{width:1080px;height:1920px;overflow:hidden;background:transparent}` +
    `.s{position:absolute;left:50%;bottom:520px;transform:translateX(-50%);white-space:nowrap;font-family:'${familia}',Arial,sans-serif;` +
    `font-weight:700;font-size:${tam}px;line-height:1;color:${s.color};background:${s.fondo}${alfa};padding:.5em}</style></head>` +
    `<body><div class="s">${cuerpo}</div></body></html>`
  )
}

/** Lo que muestra la vista previa cuando todavia no hay un video: con los datos de la marca. */
export function ejemplo(e: EstiloLongForm, tipo: TipoPieza, nombreMarca: string): Datos {
  const persona = e.personas[0]
  switch (tipo) {
    case "pregunta":
      return { num: "01", encabezado: "En esta sesión", texto: "¿Por qué una idea clara vale más que diez publicaciones?" }
    case "cita":
      return { texto: "Lo que no se explica en una frase, todavía no está claro.", quien: persona?.nombre ?? "Nombre Apellido", rol: persona?.cargo ?? "Cargo" }
    case "rotulo":
      return { nombre: persona?.nombre ?? "Nombre Apellido", rol: persona?.cargo ?? "Cargo o tema", handle: persona?.handle ?? e.handle, red: persona?.red ?? "Instagram" }
    case "barra":
      return { cta: e.clips.cta ?? e.ctas[0]?.clave ?? "" }
    case "tarjeta-intro":
      return { titulo: `Un video de ${nombreMarca}`, subtitulo: persona ? persona.nombre : "" }
    default:
      return {}
  }
}
