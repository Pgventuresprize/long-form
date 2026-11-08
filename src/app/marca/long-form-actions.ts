"use server"

import { revalidatePath } from "next/cache"
import QRCode from "qrcode"

import { formatoPorFirma, formatoPorNombre, MAX_AUDIO_BYTES, MENSAJE_FORMATO, mimeDe } from "@/engine/long-form/audio"
import { normalizarEstilo, type Archivo, type EstiloLongForm } from "@/engine/long-form/estilo"
import { BUCKET_LF, guardarEstilo, recursosDe } from "@/engine/long-form/estilo-datos"
import { ejemplo, paginaDePieza, paginaDeSubtitulo, type Disposicion, type TipoPieza } from "@/engine/long-form/plantillas"
import { supabaseAdmin } from "@/engine/supabase-admin"
import { cuentaActual } from "@/lib/accounts"
import { idDeCuentaCon } from "@/lib/funciones"

/**
 * Marca > Estilo editorial > Long form. Todo detras de `estilo_long_form`, comprobado en cada
 * accion: una accion se puede llamar sin pasar por la pagina.
 */

type Hecho<T = object> = ({ ok: true } & T) | { ok: false; error: string }

const fallo = (e: unknown): { ok: false; error: string } => ({ ok: false, error: e instanceof Error ? e.message : String(e) })

export async function guardarEstiloLongForm(config: unknown, opciones: { confirmar?: boolean } = {}): Promise<Hecho> {
  try {
    const accountId = await idDeCuentaCon("estilo_long_form")
    const error = await guardarEstilo(accountId, normalizarEstilo(config), opciones.confirmar ? true : undefined)
    if (error) return { ok: false, error: `No se pudo guardar: ${error}` }
    revalidatePath("/marca")
    revalidatePath("/long-form")
    return { ok: true }
  } catch (e) {
    return fallo(e)
  }
}

const PIEZAS_PREVIA: TipoPieza[] = ["rotulo", "barra", "cita", "pregunta", "popup", "tarjeta-intro", "tarjeta-cierre"]

/** La vista previa con el mismo HTML que dibuja el motor, para el estilo que se esta editando. */
export async function vistaPreviaLongForm(
  config: unknown,
  disposicion: Disposicion = "pantalla"
): Promise<Hecho<{ paginas: Partial<Record<TipoPieza | "subtitulo", string>> }>> {
  try {
    await idDeCuentaCon("estilo_long_form")
    const cuenta = await cuentaActual()
    const e = normalizarEstilo(config)
    const r = await recursosDe(e)
    const paginas: Partial<Record<TipoPieza | "subtitulo", string>> = {}
    for (const t of PIEZAS_PREVIA) paginas[t] = paginaDePieza(e, t, ejemplo(e, t, cuenta.name), r, disposicion)
    paginas.subtitulo = paginaDeSubtitulo(e, r)
    return { ok: true, paginas }
  } catch (e) {
    return fallo(e)
  }
}

// ------------------------------------------------------------------ audio

/** Paso 1: el servidor valida nombre, tipo y tamano y da una direccion de subida de un solo uso. */
export async function prepararSubidaAudio(datos: { nombre: string; mime: string; bytes: number }): Promise<Hecho<{ ruta: string; url: string }>> {
  try {
    const accountId = await idDeCuentaCon("estilo_long_form")
    const formato = formatoPorNombre(datos.nombre, datos.mime)
    if (!formato) return { ok: false, error: MENSAJE_FORMATO }
    if (!(datos.bytes > 0) || datos.bytes > MAX_AUDIO_BYTES) return { ok: false, error: "El archivo no puede pasar de 50 MB." }
    const ruta = `${accountId}/estilo/audio/${crypto.randomUUID()}.${formato}`
    const { data, error } = await supabaseAdmin().storage.from(BUCKET_LF).createSignedUploadUrl(ruta)
    if (error || !data) return { ok: false, error: `No se pudo preparar la subida: ${error?.message ?? "sin respuesta"}` }
    return { ok: true, ruta, url: data.signedUrl }
  } catch (e) {
    return fallo(e)
  }
}

/**
 * Paso 2: con el archivo ya subido, el servidor lee su firma. Si no es MP3 o WAV de verdad (un MP4
 * renombrado, por ejemplo), se borra y se rechaza.
 */
export async function registrarAudio(datos: {
  ruta: string
  nombre: string
  tipo: "musica" | "sfx"
  momento: string | null
  duracion: number | null
}): Promise<Hecho<{ id: string }>> {
  try {
    const accountId = await idDeCuentaCon("estilo_long_form")
    if (!datos.ruta.startsWith(`${accountId}/estilo/audio/`)) return { ok: false, error: "Esa subida no es de esta marca." }
    const db = supabaseAdmin()
    const { data, error } = await db.storage.from(BUCKET_LF).download(datos.ruta)
    if (error || !data) return { ok: false, error: "No encontramos el archivo subido. Intenta otra vez." }
    const bytes = new Uint8Array(await data.arrayBuffer())
    const esperado = datos.ruta.endsWith(".mp3") ? "mp3" : "wav"
    if (formatoPorFirma(bytes.subarray(0, 16)) !== esperado) {
      await db.storage.from(BUCKET_LF).remove([datos.ruta])
      return { ok: false, error: `${MENSAJE_FORMATO} Este archivo no lo es por dentro.` }
    }
    const { data: fila, error: e2 } = await db
      .from("lf_biblioteca")
      .insert({
        account_id: accountId,
        tipo: datos.tipo === "musica" ? "musica" : "sfx",
        momento: datos.momento,
        nombre: datos.nombre.slice(0, 120),
        ruta: datos.ruta,
        formato: esperado,
        bytes: bytes.byteLength,
        duracion_s: datos.duracion && Number.isFinite(datos.duracion) ? datos.duracion : null,
        verificado: true,
      })
      .select("id")
      .single()
    if (e2 || !fila) return { ok: false, error: `No se pudo guardar: ${e2?.message ?? "sin respuesta"}` }
    revalidatePath("/marca")
    return { ok: true, id: (fila as { id: string }).id }
  } catch (e) {
    return fallo(e)
  }
}

export async function borrarAudio(id: string): Promise<Hecho> {
  try {
    const accountId = await idDeCuentaCon("estilo_long_form")
    const db = supabaseAdmin()
    const { data } = await db.from("lf_biblioteca").select("ruta").eq("account_id", accountId).eq("id", id).maybeSingle()
    if (!data) return { ok: true }
    await db.storage.from(BUCKET_LF).remove([(data as { ruta: string }).ruta])
    await db.from("lf_biblioteca").delete().eq("account_id", accountId).eq("id", id)
    revalidatePath("/marca")
    return { ok: true }
  } catch (e) {
    return fallo(e)
  }
}

/** Una URL de una hora para escuchar un audio de la biblioteca. */
export async function urlDeAudio(id: string): Promise<Hecho<{ url: string; mime: string }>> {
  try {
    const accountId = await idDeCuentaCon("estilo_long_form")
    const db = supabaseAdmin()
    const { data } = await db.from("lf_biblioteca").select("ruta, formato").eq("account_id", accountId).eq("id", id).maybeSingle()
    if (!data) return { ok: false, error: "Ese audio ya no existe." }
    const f = data as { ruta: string; formato: "mp3" | "wav" }
    const { data: firmada } = await db.storage.from(BUCKET_LF).createSignedUrl(f.ruta, 3600)
    if (!firmada?.signedUrl) return { ok: false, error: "No se pudo abrir el audio." }
    return { ok: true, url: firmada.signedUrl, mime: mimeDe(f.formato) }
  } catch (e) {
    return fallo(e)
  }
}

// ------------------------------------------------------------------ imagenes y fuentes

const IMAGENES: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/svg+xml": "svg" }
const FUENTES: Record<string, string> = { woff2: "woff2", woff: "woff", ttf: "ttf", otf: "otf" }
const MAX_IMAGEN = 3 * 1024 * 1024

/** Logo, QR, foto de una persona o el archivo de una fuente. Archivos chicos: van por la accion. */
export async function subirArchivoEstilo(form: FormData): Promise<Hecho<{ archivo: Archivo; familia?: string }>> {
  try {
    const accountId = await idDeCuentaCon("estilo_long_form")
    const clase = String(form.get("clase") ?? "")
    const f = form.get("archivo")
    if (!(f instanceof File) || f.size === 0) return { ok: false, error: "Elige un archivo." }
    if (f.size > MAX_IMAGEN) return { ok: false, error: "El archivo no puede pasar de 3 MB." }
    let ext: string | undefined
    if (clase === "fuente") {
      ext = FUENTES[f.name.toLowerCase().split(".").pop() ?? ""]
      if (!ext) return { ok: false, error: "La fuente tiene que ser WOFF2, WOFF, TTF u OTF." }
    } else if (["logo", "qr", "foto"].includes(clase)) {
      ext = IMAGENES[f.type]
      if (!ext || (ext === "svg" && clase !== "logo")) return { ok: false, error: "La imagen tiene que ser PNG, JPG o WEBP." }
    } else {
      return { ok: false, error: "Ese archivo no va aquí." }
    }
    const ruta = `${accountId}/estilo/${clase}/${crypto.randomUUID()}.${ext}`
    const { error } = await supabaseAdmin()
      .storage.from(BUCKET_LF)
      .upload(ruta, Buffer.from(await f.arrayBuffer()), { contentType: f.type || "application/octet-stream" })
    if (error) return { ok: false, error: `No se pudo subir: ${error.message}` }
    const familia = clase === "fuente" ? f.name.replace(/\.[^.]+$/, "").replace(/[-_](bold|regular|medium|black|semibold|\d+)$/i, "").slice(0, 60) : undefined
    return { ok: true, archivo: { bucket: BUCKET_LF, ruta }, familia }
  } catch (e) {
    return fallo(e)
  }
}

/** El QR de un CTA a partir de su enlace, guardado como PNG para que el motor lo use igual. */
export async function qrDeEnlace(url: string): Promise<Hecho<{ archivo: Archivo }>> {
  try {
    const accountId = await idDeCuentaCon("estilo_long_form")
    const limpio = url.trim()
    if (!/^https?:\/\/\S+$/i.test(limpio) || limpio.length > 300) return { ok: false, error: "Pon un enlace completo, con https://" }
    const png = await QRCode.toBuffer(limpio, { type: "png", width: 520, margin: 1, errorCorrectionLevel: "M" })
    const ruta = `${accountId}/estilo/qr/${crypto.randomUUID()}.png`
    const { error } = await supabaseAdmin().storage.from(BUCKET_LF).upload(ruta, png, { contentType: "image/png" })
    if (error) return { ok: false, error: `No se pudo guardar el QR: ${error.message}` }
    return { ok: true, archivo: { bucket: BUCKET_LF, ruta } }
  } catch (e) {
    return fallo(e)
  }
}

export type { EstiloLongForm }
