"use server"

import { revalidatePath } from "next/cache"

import { supabaseAdmin } from "@/engine/supabase-admin"
import { crearVideo, escribirGuion } from "@/engine/videos/guion"
import { exportarVideo, idDeDisenoCanva } from "@/engine/videos/publicar"
import { idDeCuentaAdvance } from "@/lib/accounts"

/**
 * Las acciones de Video studio. Todas se acotan a la cuenta abierta: el id del
 * video llega del cliente.
 */

export type ResultadoVideo = { ok: true; aviso?: string } | { ok: false; error: string }

const listo = (aviso?: string): ResultadoVideo => {
  revalidatePath("/videos")
  // La configuracion del short form vive tambien en Marca > Estilo editorial.
  revalidatePath("/marca")
  return { ok: true, aviso }
}
const fallo = (error: unknown): ResultadoVideo => {
  revalidatePath("/videos")
  return { ok: false, error: error instanceof Error ? error.message : String(error) }
}

async function videoDeLaCuenta(id: string) {
  const accountId = await idDeCuentaAdvance()
  const { data } = await supabaseAdmin()
    .from("video_items")
    .select("id, status, cartridge_id, export_status")
    .eq("id", id)
    .eq("account_id", accountId)
    .maybeSingle()
  return data as { id: string; status: string; cartridge_id: string | null; export_status: string | null } | null
}

/** El agente toma una idea segun la configuracion y escribe su guion. */
export async function generarGuionAhora(): Promise<ResultadoVideo> {
  try {
    const r = await crearVideo(await idDeCuentaAdvance())
    if (!r.ok) return fallo(r.error)
    return r.guion ? listo("Guion listo en Escenas.") : fallo(`Se tomó la idea pero el guion falló: ${r.error}`)
  } catch (e) {
    return fallo(e)
  }
}

export async function reescribirGuion(id: string): Promise<ResultadoVideo> {
  const v = await videoDeLaCuenta(id)
  if (!v) return fallo("Ese video no es de esta cuenta.")
  if (!["idea", "escenas"].includes(v.status)) return fallo("Solo se reescribe el guion antes de pasar a Clips.")
  const r = await escribirGuion(id)
  return r.ok ? listo("Guion reescrito.") : fallo(r.error)
}

/** Escenas y Clips se mueven a mano, en los dos sentidos. */
export async function moverVideo(id: string, destino: "escenas" | "clips"): Promise<ResultadoVideo> {
  const v = await videoDeLaCuenta(id)
  if (!v) return fallo("Ese video no es de esta cuenta.")
  if (!["escenas", "clips"].includes(v.status)) return fallo("Ese video no se puede mover ahí.")
  const { error } = await supabaseAdmin().from("video_items").update({ status: destino, updated_at: new Date().toISOString() }).eq("id", id)
  return error ? fallo(error.message) : listo()
}

/**
 * Entregar el video: la persona deja el enlace de Canva y el video pasa a la
 * etapa Video. Se exporta de Canva enseguida (si se corta, el tick lo reintenta)
 * y, si su hora esta cerca, queda programado.
 */
export async function entregarVideo(id: string, canvaUrl: string): Promise<ResultadoVideo> {
  const v = await videoDeLaCuenta(id)
  if (!v) return fallo("Ese video no es de esta cuenta.")
  if (!["escenas", "clips", "video"].includes(v.status)) return fallo("Ese video ya se publicó.")
  const disenoId = idDeDisenoCanva(canvaUrl)
  if (!disenoId) return fallo("Ese no es un enlace de diseño de Canva. Se ve así: https://www.canva.com/design/DAG…/edit")
  const { error } = await supabaseAdmin()
    .from("video_items")
    .update({
      status: "video",
      canva_url: canvaUrl.trim(),
      canva_design_id: disenoId,
      video_url: null,
      export_status: "pendiente",
      error: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
  if (error) return fallo(error.message)
  const ex = await exportarVideo(id)
  if (!ex.ok) return fallo(`Quedó en Video, pero la exportación de Canva falló: ${ex.error}. Se reintenta sola en la próxima pasada.`)
  return listo("Video exportado de Canva. Sale a su hora (o pulsa Publicar ahora).")
}

export async function reintentarExportacion(id: string): Promise<ResultadoVideo> {
  const v = await videoDeLaCuenta(id)
  if (!v || v.status !== "video") return fallo("Ese video no está en la etapa Video.")
  const r = await exportarVideo(id)
  return r.ok ? listo("Video exportado.") : fallo(r.error)
}

/**
 * Publica ya: el video queda para la proxima pasada del tick de publicacion
 * (como mucho cinco minutos). Publicar un reel tarda minutos en procesarse y no
 * cabe en una accion del navegador.
 */
export async function publicarVideoAhora(id: string): Promise<ResultadoVideo> {
  const v = await videoDeLaCuenta(id)
  if (!v || !["video", "publicado"].includes(v.status)) return fallo("Solo se publica un video entregado.")
  if (v.export_status !== "listo") {
    const ex = await exportarVideo(id)
    if (!ex.ok) return fallo(ex.error)
  }
  const supabase = supabaseAdmin()
  if (v.status === "video") {
    const { error } = await supabase.from("video_items").update({ publicar_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", id)
    if (error) return fallo(error.message)
  } else {
    // Ya publicado en alguna red: se reintentan las que fallaron, con un intento nuevo.
    await supabase.from("video_publications").update({ intentos: 0 }).eq("video_id", id).eq("status", "error")
  }
  return listo("Sale en la próxima pasada de publicación (como mucho cinco minutos).")
}

/** Descarta el video; si no se publico, su idea vuelve al banco. */
export async function descartarVideo(id: string): Promise<ResultadoVideo> {
  const v = await videoDeLaCuenta(id)
  if (!v) return fallo("Ese video no es de esta cuenta.")
  const supabase = supabaseAdmin()
  const { error } = await supabase.from("video_items").delete().eq("id", id)
  if (error) return fallo(error.message)
  if (v.cartridge_id && v.status !== "publicado") {
    await supabase.from("content_cartridges").update({ status: "available", used_at: null }).eq("id", v.cartridge_id)
  }
  return listo("Video descartado.")
}

export type CamposVideo = {
  modo: "manual" | "automatico"
  horas: number[]
  pillarId: string | null
  intentId: string | null
  narrativeId: string | null
  personajeTag: string
  personajeNombre: string
  publicarActivo: boolean
  redes: string[]
  model: string
  prompt: string
}

export async function guardarAjustesVideo(c: CamposVideo): Promise<ResultadoVideo> {
  const horas = [...new Set(c.horas)].filter((h) => Number.isInteger(h) && h >= 0 && h <= 23).sort((a, b) => a - b)
  if (c.modo === "automatico" && horas.length === 0) return fallo("En automático elige al menos una hora de publicación.")
  const redes = c.redes.filter((r) => r === "instagram" || r === "facebook")
  if (c.publicarActivo && redes.length === 0) return fallo("Elige al menos una red para publicar.")
  const tag = c.personajeTag.trim()
  if (tag && !tag.startsWith("@")) return fallo("El tag del personaje empieza por @, por ejemplo @juan.")
  try {
    const { error } = await supabaseAdmin()
      .from("video_settings")
      .upsert(
        {
          account_id: await idDeCuentaAdvance(),
          modo: c.modo,
          horas,
          pillar_id: c.pillarId || null,
          intent_id: c.intentId || null,
          narrative_id: c.narrativeId || null,
          personaje_tag: tag || "@juan",
          personaje_nombre: c.personajeNombre.trim() || "Juan",
          publicar_activo: c.publicarActivo,
          redes,
          model: c.model || null,
          prompt: c.prompt.trim() || null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "account_id" }
      )
    return error ? fallo(error.message) : listo("Configuración guardada.")
  } catch (e) {
    return fallo(e)
  }
}
