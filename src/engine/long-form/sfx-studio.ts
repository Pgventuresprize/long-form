import type { MomentoSfx } from "./estilo"

/**
 * Biblioteca de efectos de Studio: sonidos genericos, propios y gratis (los genera
 * `long-form/plantillas/sfx/generar.py`, dominio publico). Cualquier marca los usa sin subir nada.
 *
 * En el estilo se guardan como `studio:<slug>` en lugar del id de `lf_biblioteca`. El motor los copia
 * de `long-form/plantillas/sfx/<slug>.wav` (estilo.py). Si se agrega un sonido alla, se agrega aqui.
 */

export const PREFIJO_STUDIO = "studio:"

export type SfxStudio = { slug: string; nombre: string; duracion: number }

export const SFX_STUDIO: SfxStudio[] = [
  { slug: "whoosh-corto", nombre: "Whoosh corto", duracion: 0.55 },
  { slug: "whoosh-largo", nombre: "Whoosh largo", duracion: 1.1 },
  { slug: "swoosh-salida", nombre: "Swoosh de salida", duracion: 0.5 },
  { slug: "pop", nombre: "Pop", duracion: 0.14 },
  { slug: "burbuja", nombre: "Burbuja", duracion: 0.22 },
  { slug: "clic", nombre: "Clic", duracion: 0.05 },
  { slug: "tecla", nombre: "Tecla", duracion: 0.09 },
  { slug: "ding", nombre: "Ding", duracion: 1.3 },
  { slug: "campanita-doble", nombre: "Campanita doble", duracion: 1.1 },
  { slug: "riser", nombre: "Subida (riser)", duracion: 2 },
  { slug: "golpe-grave", nombre: "Golpe grave", duracion: 0.9 },
  { slug: "transicion-suave", nombre: "Transición suave", duracion: 0.9 },
]

/** Lo que pone "Usar los sonidos de Studio": un efecto que encaja con cada momento. */
export const SFX_SUGERIDOS: Record<MomentoSfx, string> = {
  rotulo: "whoosh-corto",
  barra: "whoosh-largo",
  barra_sale: "swoosh-salida",
  popup: "pop",
  cita: "burbuja",
  pregunta: "campanita-doble",
  pregunta_sale: "swoosh-salida",
  transicion: "transicion-suave",
}

export const idStudio = (slug: string) => `${PREFIJO_STUDIO}${slug}`

/** El sonido de Studio que nombra un id del estilo, o null si es de la biblioteca de la marca. */
export function sfxStudioDe(id: string | null | undefined): SfxStudio | null {
  if (!id || !id.startsWith(PREFIJO_STUDIO)) return null
  return SFX_STUDIO.find((s) => s.slug === id.slice(PREFIJO_STUDIO.length)) ?? null
}
