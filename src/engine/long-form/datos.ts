import { supabaseAdmin } from "../supabase-admin"

/**
 * Lecturas de Long-form, siempre acotadas a una cuenta: quien llama ya comprobo la bandera y la
 * pertenencia (cuentaActual). Ninguna devuelve filas de otra cuenta aunque le pasen un id ajeno.
 */

export const BUCKET = "longform"

export type Tablero = "subiendo" | "procesando" | "revision" | "listo" | "difusion" | "enviado" | "error"

export type ProyectoResumen = {
  id: string
  titulo: string
  esfuerzo: "rapido" | "normal" | "detallado"
  tablero: Tablero
  fase: string
  detalle: string | null
  progreso: number | null
  duracion: number | null
  miniatura: string | null
  actualizado: string
}

export type Archivo = { id: string; tipo: string; nombre: string; ruta: string; bytes: number | null; version: number | null; subida: string; rol: string | null; persona: string | null }
export type Evento = { id: number; nivel: string; etapa: string | null; mensaje: string; inicio: string | null; fin: string | null; duracion_ms: number | null; costo: Record<string, unknown> | null; creado: string }
export type Trabajo = { id: number; etapa: string; estado: string; error: string | null; creado: string; terminado: string | null }

export type Proyecto = ProyectoResumen & {
  tipo: string | null
  notas: string
  cta_defecto: string | null
  spec: Record<string, unknown>
  estado: Record<string, unknown>
  archivos: Archivo[]
  eventos: Evento[]
  trabajos: Trabajo[]
}

const CAMPOS = "id, titulo, esfuerzo, tablero, fase, detalle, progreso, duracion_s, miniatura, actualizado"

type Fila = Omit<ProyectoResumen, "duracion"> & { duracion_s: number | null }
const resumen = (f: Fila): ProyectoResumen => ({ ...f, duracion: f.duracion_s })

export async function proyectosDe(accountId: string): Promise<ProyectoResumen[]> {
  const { data, error } = await supabaseAdmin().from("lf_proyectos").select(CAMPOS).eq("account_id", accountId).order("actualizado", { ascending: false }).limit(200)
  if (error) throw new Error(`No se pudieron leer los videos: ${error.message}`)
  const filas = ((data ?? []) as Fila[]).map(resumen)
  // La miniatura es una ruta del bucket privado: se firma para el tablero.
  const urls = await urlsFirmadas(accountId, filas.flatMap((f) => (f.miniatura ? [f.miniatura] : [])))
  return filas.map((f) => ({ ...f, miniatura: f.miniatura ? (urls[f.miniatura] ?? null) : null }))
}

export async function proyectoDe(accountId: string, id: string): Promise<Proyecto | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null
  const db = supabaseAdmin()
  const { data } = await db
    .from("lf_proyectos")
    .select(`${CAMPOS}, tipo, notas, cta_defecto, spec, estado`)
    .eq("account_id", accountId)
    .eq("id", id)
    .maybeSingle()
  if (!data) return null
  const [archivos, eventos, trabajos] = await Promise.all([
    db.from("lf_archivos").select("id, tipo, nombre, ruta, bytes, version, subida, rol, persona").eq("proyecto_id", id).order("creado"),
    db.from("lf_eventos").select("id, nivel, etapa, mensaje, inicio, fin, duracion_ms, costo, creado").eq("proyecto_id", id).order("id", { ascending: false }).limit(300),
    db.from("lf_trabajos").select("id, etapa, estado, error, creado, terminado").eq("proyecto_id", id).order("id", { ascending: false }).limit(50),
  ])
  const f = data as Fila & { tipo: string | null; notas: string; cta_defecto: string | null; spec: Record<string, unknown>; estado: Record<string, unknown> }
  return {
    ...resumen(f),
    tipo: f.tipo,
    notas: f.notas,
    cta_defecto: f.cta_defecto,
    spec: f.spec ?? {},
    estado: f.estado ?? {},
    archivos: (archivos.data ?? []) as Archivo[],
    eventos: (eventos.data ?? []) as Evento[],
    trabajos: (trabajos.data ?? []) as Trabajo[],
  }
}

/** URLs firmadas de una hora para los archivos del proyecto (solo de esa cuenta: la ruta empieza por ella). */
export async function urlsFirmadas(accountId: string, rutas: string[], segundos = 3600): Promise<Record<string, string>> {
  const propias = [...new Set(rutas.filter((r) => r.startsWith(`${accountId}/`)))]
  if (!propias.length) return {}
  const { data } = await supabaseAdmin().storage.from(BUCKET).createSignedUrls(propias, segundos)
  return Object.fromEntries((data ?? []).filter((d) => d.signedUrl && d.path).map((d) => [d.path as string, d.signedUrl as string]))
}

// ------------------------------------------------------------------ avisos

export type Aviso = { id: string; proyecto_id: string | null; tipo: string; titulo: string; cuerpo: string; accion: string | null; creado: string; leido: boolean }

export async function avisosDe(accountId: string, userId: string, limite = 30): Promise<Aviso[]> {
  const { data } = await supabaseAdmin()
    .from("lf_avisos")
    .select("id, proyecto_id, tipo, titulo, cuerpo, accion, creado, leido_por")
    .eq("account_id", accountId)
    .order("creado", { ascending: false })
    .limit(limite)
  return ((data ?? []) as (Omit<Aviso, "leido"> & { leido_por: string[] })[]).map(({ leido_por, ...a }) => ({ ...a, leido: leido_por.includes(userId) }))
}

export async function marcarLeidos(accountId: string, userId: string, ids: string[] | "todos"): Promise<void> {
  const db = supabaseAdmin()
  let q = db.from("lf_avisos").select("id, leido_por").eq("account_id", accountId)
  if (ids !== "todos") q = q.in("id", ids.slice(0, 100))
  const { data } = await q.limit(200)
  const pendientes = ((data ?? []) as { id: string; leido_por: string[] }[]).filter((a) => !a.leido_por.includes(userId))
  await Promise.all(pendientes.map((a) => db.from("lf_avisos").update({ leido_por: [...a.leido_por, userId] }).eq("id", a.id)))
}

export async function avisar(accountId: string, proyectoId: string | null, tipo: string, titulo: string, cuerpo = ""): Promise<void> {
  await supabaseAdmin()
    .from("lf_avisos")
    .insert({ account_id: accountId, proyecto_id: proyectoId, tipo, titulo, cuerpo, accion: proyectoId ? `/long-form/${proyectoId}` : "/long-form" })
}

// ------------------------------------------------------------------ tiempo de salida

/**
 * Del tiempo de la grabacion al del video final: lo mismo que `Mapa` en el motor (contexto.py). `keep` son
 * los tramos que se conservan, ya en cuadros; `intro` los segundos de la tarjeta de inicio.
 */
export function tiempoDeSalida(keep: [number, number][], fps: number, intro: number, t: number): number {
  let acumulado = 0
  for (const [a, b] of keep) {
    const cuadros = Math.round((b - a) * fps)
    if (t < a) break
    if (t <= b) return intro + (acumulado + Math.min(Math.round((t - a) * fps), cuadros)) / fps
    acumulado += cuadros
  }
  return intro + acumulado / fps
}

export function mmss(s: number): string {
  const t = Math.max(0, Math.round(s))
  const h = Math.floor(t / 3600)
  const m = Math.floor((t % 3600) / 60)
  const ss = String(t % 60).padStart(2, "0")
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`
}
