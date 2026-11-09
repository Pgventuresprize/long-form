import type { ProyectoResumen, Tablero } from "@/engine/long-form/datos"
import { NOMBRE_NIVEL } from "@/engine/long-form/estilo"
import { Badge } from "@/components/ui/badge"

export const COLUMNAS: { valor: Tablero; nombre: string; vacio: string }[] = [
  { valor: "subiendo", nombre: "Subiendo", vacio: "Nada subiendo." },
  { valor: "procesando", nombre: "Procesando", vacio: "Nada en proceso." },
  { valor: "revision", nombre: "Te toca revisar", vacio: "Nada por revisar." },
  { valor: "listo", nombre: "Listo", vacio: "Ningún video listo todavía." },
  { valor: "difusion", nombre: "En difusión", vacio: "Nada en difusión." },
  { valor: "enviado", nombre: "Enviado", vacio: "Nada enviado a la parrilla." },
]

/** El paso a paso del proyecto y en cual va, segun la fase que escribe el motor. */
export const PASOS = ["Subida", "Análisis", "Revisión", "Render", "Difusión", "Enviado"] as const

const FASE_A_PASO: Record<string, number> = {
  subiendo: 0,
  borrador: 0,
  en_cola: 1,
  ingesta: 1,
  analisis: 1,
  clasificar: 1,
  transcripcion: 1,
  plan: 1,
  revision_reparto: 2,
  revision_guion: 2,
  graficos: 3,
  render: 3,
  qa: 3,
  listo: 4,
  difusion: 4,
  enviado: 5,
}

/** La etapa que fallo: el motor deja el detalle como "<etapa>: <error>". */
export function etapaFallida(p: { detalle?: string | null }): string | null {
  const m = /^([a-z_]+):/.exec(p.detalle ?? "")
  return m && m[1] in FASE_A_PASO ? m[1] : null
}

export function pasoDe(p: { fase: string; tablero: Tablero; detalle?: string | null }): number {
  if (p.tablero === "enviado") return 5
  if (p.tablero === "difusion") return 4
  if (p.tablero === "error") return FASE_A_PASO[etapaFallida(p) ?? ""] ?? 1
  if (p.fase === "en_cola" && p.detalle) return FASE_A_PASO[p.detalle] ?? 1
  return FASE_A_PASO[p.fase] ?? 1
}

/** En palabras: que esta pasando y quien tiene que hacer algo. */
export function quienActua(p: Pick<ProyectoResumen, "tablero" | "fase">): { texto: string; tuyo: boolean } {
  if (p.tablero === "revision") return { texto: p.fase === "revision_reparto" ? "Te toca: quién es quién" : "Te toca: el guion", tuyo: true }
  if (p.tablero === "listo") return { texto: "Te toca: revisar el video", tuyo: true }
  if (p.tablero === "difusion") return { texto: "Te toca: aprobar clips y carruseles", tuyo: true }
  if (p.tablero === "error") return { texto: "Algo falló: reintenta", tuyo: true }
  if (p.tablero === "subiendo") return { texto: "Subiendo archivos", tuyo: false }
  if (p.tablero === "enviado") return { texto: "En la parrilla", tuyo: false }
  return { texto: "Studio está trabajando", tuyo: false }
}

const ETAPAS: Record<string, string> = {
  en_cola: "En cola",
  ingesta: "Leyendo los archivos",
  analisis: "Analizando quién habla",
  clasificar: "Reconociendo el tipo de grabación",
  transcripcion: "Transcribiendo",
  plan: "Armando el guion",
  graficos: "Dibujando los gráficos",
  render: "Editando el video",
  qa: "Revisando la calidad",
  revision_reparto: "Quién es quién",
  revision_guion: "Revisión del guion",
  listo: "Listo",
  error: "Falló",
}

export function nombreEtapa(fase: string): string {
  return ETAPAS[fase] ?? fase
}

export function BadgeNivel({ nivel }: { nivel: keyof typeof NOMBRE_NIVEL }) {
  return <Badge variant="secondary">{NOMBRE_NIVEL[nivel]}</Badge>
}

export function duracionLegible(s: number | null): string | null {
  if (!s) return null
  const m = Math.round(s / 60)
  return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`
}
