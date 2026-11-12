import { PARAMETROS_SILENCIO, type EstiloLongForm, type Nivel } from "./estilo"

/**
 * Lo que el motor recibe de un proyecto (`lf_proyectos.spec`), armado a partir del estilo de la marca y
 * de lo que pone la persona al crear el video. El motor lo lee en `Contexto.spec` y `ctx.opcion(...)`.
 */
export type SpecProyecto = {
  idioma: string
  personas: { nombre: string; rol: string; handle: string; red: string }[]
  vocabulario: string[]
  ctas: string[]
  notas_editoriales: string
  opciones: Record<string, number | boolean | string | number[]>
  esfuerzo: Nivel
}

export function specDesdeEstilo(e: EstiloLongForm, datos: { notas?: string; ctaDefecto?: string | null; esfuerzo?: Nivel; marca?: string }): SpecProyecto {
  const s = PARAMETROS_SILENCIO[e.silencios]
  // El CTA por defecto va primero: es el que mas veces sale en las barras.
  const ctas = e.ctas.map((c) => c.clave)
  const primero = datos.ctaDefecto && ctas.includes(datos.ctaDefecto) ? datos.ctaDefecto : null
  return {
    idioma: "es",
    personas: e.personas.map((p) => ({ nombre: p.nombre, rol: p.cargo, handle: p.handle, red: p.red })),
    vocabulario: [datos.marca, e.handle, ...e.personas.map((p) => p.nombre)].filter((x): x is string => Boolean(x && x.trim())),
    ctas: primero ? [primero, ...ctas.filter((c) => c !== primero)] : ctas,
    notas_editoriales: (datos.notas ?? "").slice(0, 4000),
    opciones: {
      ...s,
      volumen_efectos: e.sfx.volumen,
      // Los clips no se renderizan con el largo: salen de Difusion, solo los aprobados.
      clips: 0,
      subtitulos_clips: true,
    },
    esfuerzo: datos.esfuerzo ?? e.esfuerzo,
  }
}
