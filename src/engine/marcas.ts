import { tieneFuncion } from "./funciones"
import { supabaseAdmin } from "./supabase-admin"

/**
 * Las marcas de una persona: cuantas tiene, si puede crear otra y copiar lo comun de una a otra.
 *
 * Cada marca es una cuenta (`accounts`). La primera marca de cada persona es gratis; desde la
 * segunda hace falta `marcas_multiples` en alguna de las marcas donde es owner. Crear marcas desde
 * el panel de administracion no pasa por aqui.
 */

/** Las marcas donde la persona es owner. */
export async function marcasPropias(userId: string): Promise<string[]> {
  const { data, error } = await supabaseAdmin().from("account_members").select("account_id").eq("user_id", userId).eq("role", "owner")
  if (error) throw new Error(`No se pudieron leer tus marcas: ${error.message}`)
  return ((data ?? []) as { account_id: string }[]).map((f) => f.account_id)
}

export type PermisoMarca = { puede: true } | { puede: false; motivo: "paywall" }

/** Sin marcas propias, la primera es gratis. Con alguna, hace falta la funcion en una de ellas. */
export async function puedeCrearMarca(userId: string): Promise<PermisoMarca> {
  const propias = await marcasPropias(userId)
  if (propias.length === 0) return { puede: true }
  for (const id of propias) if (await tieneFuncion(id, "marcas_multiples")) return { puede: true }
  return { puede: false, motivo: "paywall" }
}

// ------------------------------------------------------------------ Lo comun

/**
 * Lo comun de una marca: identidad, voz (do's & don'ts), pilares y temas, audiencias, verticales,
 * CTA, lo visual (colores, fuentes y logos) y la biblioteca de imagenes. No se copian secretos,
 * conexiones, kits, piezas ni conversaciones.
 */
export type QueCopiar = { comun: boolean; claude: boolean }

const TABLAS_LISTA = ["content_pillars", "content_audiences", "content_verticals", "content_ctas"] as const
const SIN_COPIAR = new Set(["id", "account_id", "created_at", "updated_at"])

function sinPropias<T extends Record<string, unknown>>(fila: T): Record<string, unknown> {
  return Object.fromEntries(Object.entries(fila).filter(([k]) => !SIN_COPIAR.has(k)))
}

/** Reemplaza la ruta de la marca de origen por la de destino en las URLs de los logos. */
export function moverRutas<T>(valor: T, origen: string, destino: string): T {
  return JSON.parse(JSON.stringify(valor ?? null).split(`/marca/${origen}/`).join(`/marca/${destino}/`)) as T
}

export async function copiarComun(origenId: string, destinoId: string): Promise<{ avisos: string[] }> {
  const db = supabaseAdmin()
  const avisos: string[] = []

  // Identidad y voz.
  const perfil = await db.from("brand_profile").select("*").eq("account_id", origenId).maybeSingle()
  if (perfil.data) {
    const { error } = await db.from("brand_profile").upsert({ ...sinPropias(perfil.data), account_id: destinoId }, { onConflict: "account_id" })
    if (error) avisos.push(`Identidad y voz: ${error.message}`)
  }

  // Pilares, audiencias, verticales y CTA, en su orden.
  for (const tabla of TABLAS_LISTA) {
    const { data, error } = await db.from(tabla).select("*").eq("account_id", origenId).order("position")
    if (error) {
      avisos.push(`${tabla}: ${error.message}`)
      continue
    }
    const filas = ((data ?? []) as Record<string, unknown>[]).map((f) => ({ ...sinPropias(f), account_id: destinoId }))
    if (filas.length === 0) continue
    // La marca nueva nace sin filas propias; si ya tuviera, no se duplican.
    const ya = await db.from(tabla).select("id", { count: "exact", head: true }).eq("account_id", destinoId)
    if (ya.count) continue
    const ins = await db.from(tabla).insert(filas)
    if (ins.error) avisos.push(`${tabla}: ${ins.error.message}`)
  }

  // Lo visual: colores, fuentes y logos, con los archivos copiados a la marca nueva.
  const config = await db.from("generation_config").select("carousel").eq("account_id", origenId).maybeSingle()
  const carousel = (config.data as { carousel?: Record<string, unknown> | null } | null)?.carousel
  if (carousel) {
    const logos = await db.storage.from("carousels").list(`marca/${origenId}`)
    for (const o of logos.data ?? []) {
      const r = await db.storage.from("carousels").copy(`marca/${origenId}/${o.name}`, `marca/${destinoId}/${o.name}`)
      if (r.error && !/exists/i.test(r.error.message)) avisos.push(`Logo ${o.name}: ${r.error.message}`)
    }
    const { error } = await db.from("generation_config").update({ carousel: moverRutas(carousel, origenId, destinoId) }).eq("account_id", destinoId)
    if (error) avisos.push(`Visual: ${error.message}`)
  }

  // La biblioteca de imagenes, con sus archivos.
  const imgs = await db.from("brand_imagenes").select("*").eq("account_id", origenId).eq("activa", true).limit(500)
  for (const img of (imgs.data ?? []) as Record<string, unknown>[]) {
    const id = crypto.randomUUID()
    const nueva: Record<string, unknown> = { ...sinPropias(img), id, account_id: destinoId }
    delete nueva.busqueda // columna generada
    let fallo = false
    for (const campo of ["ruta", "ruta_mini", "ruta_mini_recorte"] as const) {
      const ruta = img[campo]
      if (typeof ruta !== "string" || !ruta) continue
      const destino = ruta.replace(String(img.account_id), destinoId).replace(String(img.id), id)
      const r = await db.storage.from("marca-imagenes").copy(ruta, destino)
      if (r.error && !/exists/i.test(r.error.message)) fallo = true
      nueva[campo] = destino
    }
    if (fallo) {
      avisos.push(`Una imagen no se pudo copiar (${String(img.nombre_original ?? img.id)}).`)
      continue
    }
    const { error } = await db.from("brand_imagenes").insert(nueva)
    if (error) avisos.push(`Imagen ${String(img.nombre_original ?? img.id)}: ${error.message}`)
  }

  return { avisos }
}

/** "Usar la misma conexion de Claude": copia el token de la marca de origen. */
export async function copiarConexionClaude(origenId: string, destinoId: string): Promise<string | null> {
  const db = supabaseAdmin()
  const { data, error } = await db.from("account_secrets").select("claude_oauth_token").eq("account_id", origenId).maybeSingle()
  if (error) return error.message
  const token = (data as { claude_oauth_token: string | null } | null)?.claude_oauth_token
  if (!token) return "La marca de origen no tiene Claude conectado."
  const up = await db
    .from("account_secrets")
    .update({ claude_oauth_token: token, claude_token_updated_at: new Date().toISOString() })
    .eq("account_id", destinoId)
  return up.error ? up.error.message : null
}

/** Si una marca tiene Claude conectado, sin leer el token. */
export async function tieneClaude(accountId: string): Promise<boolean> {
  const { data } = await supabaseAdmin().from("account_secrets").select("claude_oauth_token").eq("account_id", accountId).maybeSingle()
  return Boolean((data as { claude_oauth_token: string | null } | null)?.claude_oauth_token)
}
