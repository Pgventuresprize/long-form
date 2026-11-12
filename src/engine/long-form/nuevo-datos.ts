import { supabaseAdmin } from "../supabase-admin"
import { normalizarEstilo, type Archivo } from "./estilo"

/**
 * Lo que la pantalla "Nuevo video" lee de la base: las marcas de la persona con su logo y sus colores, y los
 * videos que la marca ya subio en proyectos anteriores (para usarlos otra vez sin subirlos). Quien llama ya
 * comprobo la sesion, la pertenencia y la bandera.
 */

export type MarcaNuevo = {
  id: string
  slug: string
  nombre: string
  /** Del estilo long form, si lo tiene. Sin estilo, los de Studio. */
  acento: string
  tinta: string
  degradado: string[]
  /** El logo y el fondo sobre el que va (el acento o la tinta). */
  logo: { url: string; sobre: "acento" | "tinta" } | null
  /** Tiene estilo de long form confirmado. */
  listo: boolean
}

async function urlDe(a: Archivo | null): Promise<string | null> {
  if (!a) return null
  const s = supabaseAdmin().storage.from(a.bucket)
  if (a.bucket === "carousels") return s.getPublicUrl(a.ruta).data.publicUrl
  const { data } = await s.createSignedUrl(a.ruta, 3600)
  return data?.signedUrl ?? null
}

export async function marcasParaNuevo(cuentas: { id: string; slug: string; name: string; suspendida_en?: string | null }[]): Promise<MarcaNuevo[]> {
  const activas = cuentas.filter((c) => !c.suspendida_en)
  if (!activas.length) return []
  const { data } = await supabaseAdmin().from("lf_estilos").select("account_id, config, listo").in("account_id", activas.map((c) => c.id))
  const estilos = new Map(((data ?? []) as { account_id: string; config: unknown; listo: boolean }[]).map((f) => [f.account_id, f]))
  return Promise.all(
    activas.map(async (c) => {
      const f = estilos.get(c.id)
      const e = normalizarEstilo(f?.config ?? {})
      const [sobreAcento, sobreTinta] = await Promise.all([urlDe(e.logo.sobre_acento), e.logo.sobre_acento ? null : urlDe(e.logo.sobre_oscuro)])
      return {
        id: c.id,
        slug: c.slug,
        nombre: c.name,
        acento: e.colores.acento,
        tinta: e.colores.tinta,
        degradado: e.colores.degradado,
        logo: sobreAcento ? { url: sobreAcento, sobre: "acento" as const } : sobreTinta ? { url: sobreTinta, sobre: "tinta" as const } : null,
        listo: Boolean(f?.listo),
      }
    })
  )
}

export type ClipPrevio = { id: string; nombre: string; bytes: number | null; duracion: number | null; proyecto: string; creado: string }

/**
 * Los videos que la marca ya subio (tipo fuente, subida lista), del mas nuevo al mas viejo. Un mismo video
 * reusado varias veces aparece una vez. La duracion sale de lo que midio la ingesta del motor, si ya corrio.
 */
export async function clipsPrevios(accountId: string, limite = 60): Promise<ClipPrevio[]> {
  const db = supabaseAdmin()
  const { data } = await db
    .from("lf_archivos")
    .select("id, proyecto_id, nombre, bytes, rol, creado")
    .eq("account_id", accountId)
    .eq("tipo", "fuente")
    .eq("subida", "lista")
    .order("creado", { ascending: false })
    .limit(limite * 3)
  const filas = (data ?? []) as { id: string; proyecto_id: string; nombre: string; bytes: number | null; rol: string | null; creado: string }[]
  if (!filas.length) return []
  const ids = [...new Set(filas.map((f) => f.proyecto_id))]
  const { data: ps } = await db.from("lf_proyectos").select("id, titulo, fuentes:estado->ingesta->fuentes").eq("account_id", accountId).in("id", ids)
  type Medida = { clave?: string; nombre?: string; duracion?: number }
  const proyectos = new Map(((ps ?? []) as { id: string; titulo: string; fuentes: Medida[] | null }[]).map((p) => [p.id, p]))
  const vistos = new Set<string>()
  const out: ClipPrevio[] = []
  for (const f of filas) {
    const p = proyectos.get(f.proyecto_id)
    if (!p) continue
    const clave = `${f.nombre}:${f.bytes ?? ""}`
    if (vistos.has(clave)) continue
    vistos.add(clave)
    const m = Array.isArray(p.fuentes) ? (p.fuentes.find((x) => f.rol && x.clave === f.rol) ?? p.fuentes.find((x) => x.nombre === f.nombre)) : undefined
    out.push({ id: f.id, nombre: f.nombre, bytes: f.bytes, duracion: typeof m?.duracion === "number" ? m.duracion : null, proyecto: p.titulo, creado: f.creado })
    if (out.length >= limite) break
  }
  return out
}
