/**
 * Las pestanas de Marca. Aparte de marca-tabs.tsx porque la pagina, que es de
 * servidor, tambien las lee: un valor exportado desde un modulo "use client"
 * le llega al servidor como referencia de cliente, no como el array.
 *
 * Dos grupos: lo comun (lo que leen todos los agentes) y el estilo editorial de
 * cada formato. Los valores son los de siempre, para que los enlaces con ?tab=
 * sigan abriendo lo mismo; solo se suman short-form y long-form.
 */
export const PESTANAS = [
  { valor: "identidad", etiqueta: "Identidad", grupo: "comun", seccion: "identidad" },
  { valor: "voz", etiqueta: "Voz", grupo: "comun", seccion: "voz" },
  { valor: "editorial", etiqueta: "Pilares y temas", grupo: "comun", seccion: "editorial" },
  { valor: "cta", etiqueta: "CTA", grupo: "comun", seccion: "cta" },
  { valor: "visual", etiqueta: "Visual", grupo: "comun", seccion: "visual" },
  { valor: "imagenes", etiqueta: "Imágenes", grupo: "comun", seccion: "imagenes" },
  { valor: "kit", etiqueta: "Kit de diseño", grupo: "estilo", seccion: "carruseles" },
  { valor: "skills", etiqueta: "Skills", grupo: "estilo", seccion: "carruseles" },
  { valor: "ejemplos", etiqueta: "Ejemplos", grupo: "estilo", seccion: "carruseles" },
  { valor: "short-form", etiqueta: "Short form", grupo: "estilo", seccion: "short-form" },
  { valor: "long-form", etiqueta: "Long form", grupo: "estilo", seccion: "long-form" },
] as const
export type Pestana = (typeof PESTANAS)[number]["valor"]
export type Grupo = (typeof PESTANAS)[number]["grupo"]

export const GRUPOS: { valor: Grupo; etiqueta: string }[] = [
  { valor: "comun", etiqueta: "Lo común" },
  { valor: "estilo", etiqueta: "Estilo editorial" },
]

/** Las secciones del estilo editorial; Carruseles agrupa tres pestanas. */
export const SECCIONES_ESTILO = [
  { valor: "carruseles", etiqueta: "Carruseles" },
  { valor: "short-form", etiqueta: "Short form" },
  { valor: "long-form", etiqueta: "Long form" },
] as const
export type SeccionEstilo = (typeof SECCIONES_ESTILO)[number]["valor"]

export function esPestana(x: string | undefined): x is Pestana {
  return PESTANAS.some((p) => p.valor === x)
}

export function pestana(valor: Pestana) {
  return PESTANAS.find((p) => p.valor === valor)!
}
