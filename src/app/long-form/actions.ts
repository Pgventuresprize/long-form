"use server"

import { revalidatePath } from "next/cache"

import { NIVELES, type Nivel } from "@/engine/long-form/estilo"
import { estiloDe } from "@/engine/long-form/estilo-datos"
import { avisar, avisosDe, BUCKET, marcarLeidos, proyectoDe, urlsFirmadas, type Aviso, type Proyecto } from "@/engine/long-form/datos"
import { encolarEtapa } from "@/engine/long-form/motor"
import { formatoPorNombre, MENSAJE_FORMATO } from "@/engine/long-form/audio"
import { encajaEnTipo, MENSAJE_ENTRADA, opcionesDelSpec, opcionesValidas, ordenDeFuentes, TIPOS_ENTRADA, USOS_MUSICA, type OpcionesVideo, type TipoEntrada, type UsoMusica } from "@/engine/long-form/nuevo"
import { specDesdeEstilo, type SpecProyecto } from "@/engine/long-form/proyectos"
import { rutaReferente, validarUrlReferente, VIDEO_REFERENTE } from "@/engine/long-form/referente"
import { TIPOS_GRABACION } from "@/engine/long-form/tipos"
import { supabaseAdmin } from "@/engine/supabase-admin"
import { cuentaActual } from "@/lib/accounts"
import { idDeCuentaCon } from "@/lib/funciones"
import { usuarioActual } from "@/lib/supabase/auth"

/**
 * Las acciones de Long-form. Cada una comprueba la bandera `long_form` y que el proyecto sea de la cuenta
 * activa: una accion se puede llamar sin pasar por la pagina.
 */

type Hecho<T = object> = ({ ok: true } & T) | { ok: false; error: string }
const fallo = (e: unknown): { ok: false; error: string } => ({ ok: false, error: e instanceof Error ? e.message : String(e) })

const VIDEO = /\.(mp4|mov|m4v|mkv|webm)$/i
const AUDIO = /\.(mp3|wav|m4a|aac)$/i
const OTROS: Record<string, RegExp> = { pdf: /\.pdf$/i, foto: /\.(png|jpe?g|webp|heic)$/i }
const MAX_ARCHIVOS = 30
// Una letra por video. Sin S (audio aparte) ni X (tercera voz): el motor las reserva.
// Es la misma lista de long-form/motor/editor/etapas/ingesta.py (CLAVES).
const CLAVES_FUENTE = "ABCDEFGHIJKLMNOPQRTUVWYZ"
const MAX_FUENTES = 12

export type { UsoMusica }

/**
 * Un archivo que sube el navegador. `tipo` lo dice la pantalla segun donde lo puso la persona (videos para
 * editar, audio aparte, carpeta de apoyo); `uso`, para que es una musica. `orden` es la posicion de un video en
 * la lista de clips (solo `fuente`).
 */
type Entrada = { nombre: string; bytes: number; uso?: UsoMusica; tipo?: TipoEntrada; orden?: number }

/** Un video de un proyecto anterior de la marca que se vuelve a usar sin subirlo. Un id suelto va al final. */
type Reuso = string | { archivoId: string; orden?: number }

/**
 * Que es cada archivo. Una musica viene marcada con su `uso` (la persona dijo para que es): entra como
 * `musica` aunque sea un MP3 o un MP4, y de un video se usa solo el audio. Con `tipo`, manda lo que dijo la
 * persona (si la extension encaja). Sin nada, la extension, como antes (un MP3 suelto es el "audio aparte").
 */
function tipoDe(a: Entrada): "fuente" | "audio" | "pdf" | "foto" | "ilustracion" | "musica" | null {
  if (a.uso) return USOS_MUSICA.includes(a.uso) && formatoPorNombre(a.nombre, "") ? "musica" : null
  if (a.tipo !== undefined) return TIPOS_ENTRADA.includes(a.tipo) && encajaEnTipo(a.nombre, a.tipo) ? a.tipo : null
  const nombre = a.nombre
  if (VIDEO.test(nombre)) return "fuente"
  if (AUDIO.test(nombre)) return "audio"
  if (OTROS.pdf.test(nombre)) return "pdf"
  if (OTROS.foto.test(nombre)) return "foto"
  return null
}

const limpio = (n: string) => n.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9._-]+/gi, "-").slice(-120)

async function proyectoPropio(id: string): Promise<{ accountId: string; p: Proyecto }> {
  const accountId = await idDeCuentaCon("long_form")
  const p = await proyectoDe(accountId, id)
  if (!p) throw new Error("Ese video no existe o no es de esta marca.")
  return { accountId, p }
}

export type Subida = { archivoId: string; nombre: string; ruta: string; token: string }
export type DestinoSubida = { endpoint: string; apikey: string; bucket: string }

/**
 * El referente de edicion (opcional): un video que se sube como los demas, con tipo explicito 'referente' (no
 * pasa por `tipoDe`: un .mp4 suelto seria una fuente), o un enlace que queda en spec.referente_url. Solo se usa
 * para medir su estilo; nada suyo llega al video.
 */
export type ReferenteNuevo = { nombre: string; bytes: number } | { url: string }

/**
 * Nuevo video: crea el proyecto con sus archivos pendientes y da una firma de un solo uso por archivo.
 * El navegador sube directo a Storage por TUS; el archivo no pasa por Studio.
 */
export async function crearProyecto(datos: {
  titulo: string
  esfuerzo: Nivel
  notas: string
  ctaDefecto: string | null
  archivos: Entrada[]
  /**
   * Videos de proyectos anteriores de la marca (ids de `lf_archivos`, tipo fuente y ya subidos) que se usan otra
   * vez. No se suben: Storage los copia a la carpeta del proyecto nuevo.
   */
  reutilizar?: Reuso[]
  /** Musica elegida de la biblioteca de la marca para este video (ids de `lf_biblioteca`), por uso. */
  musicaBiblioteca?: Partial<Record<UsoMusica, string>>
  referente?: ReferenteNuevo | null
  /** Formato, duracion, subtitulos, gancho y capitulos: van a spec.opciones (ver `opcionesDelSpec`). */
  opciones?: OpcionesVideo
}): Promise<Hecho<{ id: string; subidas: Subida[]; destino: DestinoSubida }>> {
  try {
    const accountId = await idDeCuentaCon("long_form")
    const [cuenta, yo] = await Promise.all([cuentaActual(), usuarioActual()])
    const titulo = datos.titulo.trim().slice(0, 160)
    if (!titulo) return { ok: false, error: "Ponle un título al video." }
    if (!NIVELES.includes(datos.esfuerzo)) return { ok: false, error: "Elige un nivel." }
    const archivos = Array.isArray(datos.archivos) ? datos.archivos : []
    const reusos = [...new Map((datos.reutilizar ?? []).map((r) => (typeof r === "string" ? { archivoId: r } : r)).filter((r) => typeof r?.archivoId === "string").map((r) => [r.archivoId, r])).values()]
    if (!archivos.length && !reusos.length) return { ok: false, error: "Agrega al menos un video." }
    if (archivos.length + reusos.length > MAX_ARCHIVOS) return { ok: false, error: `Como mucho ${MAX_ARCHIVOS} archivos por video.` }
    const tipos = archivos.map((a) => tipoDe(a))
    const malo = archivos.find((_, i) => !tipos[i])
    if (malo) return { ok: false, error: malo.uso ? `${malo.nombre}: ${MENSAJE_FORMATO}` : malo.tipo ? `${malo.nombre} ${MENSAJE_ENTRADA[malo.tipo] ?? "no se puede usar."}` : `${malo.nombre} no es un video, un audio, un PDF ni una foto.` }
    const nFuentes = tipos.filter((t) => t === "fuente").length + reusos.length
    if (!nFuentes) return { ok: false, error: "Agrega al menos un video." }
    if (nFuentes > MAX_FUENTES) return { ok: false, error: `Como mucho ${MAX_FUENTES} videos para editar.` }
    // El motor usa un solo audio aparte y un solo PDF: con dos, el segundo no saldria y nadie se enteraria.
    if (archivos.filter((a, i) => a.tipo === "audio" && tipos[i] === "audio").length > 1) return { ok: false, error: "Sube un solo audio aparte." }
    if (archivos.filter((a, i) => a.tipo === "pdf" && tipos[i] === "pdf").length > 1) return { ok: false, error: "Sube un solo PDF por video." }
    const repetido = USOS_MUSICA.find((u) => archivos.filter((a) => a.uso === u).length + (datos.musicaBiblioteca?.[u] ? 1 : 0) > 1)
    if (repetido) return { ok: false, error: `Elige una sola música de ${repetido === "intro" ? "inicio" : repetido}.` }
    const ref = referenteValido(datos.referente)
    if (!ref.ok) return ref
    const op = opcionesValidas(datos.opciones)
    if (!op.ok) return op

    const estilo = await estiloDe(accountId)
    if (!estilo?.listo) return { ok: false, error: "Primero confirma el estilo de long form en Marca." }
    const base = specDesdeEstilo(estilo.config, { notas: datos.notas, ctaDefecto: datos.ctaDefecto, esfuerzo: datos.esfuerzo, marca: cuenta.name })
    const spec: SpecProyecto & Record<string, unknown> = {
      ...base,
      opciones: { ...base.opciones, ...opcionesDelSpec(op.opciones) },
      ...(ref.url ? { referente_url: ref.url } : {}),
    }

    const db = supabaseAdmin()
    // Los videos que se reusan: de esta marca, fuentes y ya subidos. Lo demas no se copia aunque llegue su id.
    type Previo = { id: string; nombre: string; ruta: string; bytes: number | null; persona: string | null }
    let previos: Previo[] = []
    if (reusos.length) {
      const { data } = await db.from("lf_archivos").select("id, nombre, ruta, bytes, persona").eq("account_id", accountId).eq("tipo", "fuente").eq("subida", "lista").in("id", reusos.map((r) => r.archivoId))
      const filas = (data ?? []) as Previo[]
      previos = reusos.map((r) => filas.find((f) => f.id === r.archivoId)).filter((f): f is Previo => Boolean(f && f.ruta.startsWith(`${accountId}/`)))
      if (previos.length !== reusos.length) return { ok: false, error: "Uno de los videos de la biblioteca ya no está. Quítalo y vuelve a intentarlo." }
    }
    // La musica elegida de la biblioteca: el motor la baja de Storage por su ruta (render.py, `musica_<uso>`).
    const elegidas = Object.entries(datos.musicaBiblioteca ?? {}).filter(([u, aid]) => USOS_MUSICA.includes(u as UsoMusica) && aid)
    if (elegidas.length) {
      const { data: filasBib } = await db.from("lf_biblioteca").select("id, ruta").eq("account_id", accountId).eq("tipo", "musica").in("id", elegidas.map(([, aid]) => aid!))
      for (const [uso, aid] of elegidas) {
        const fila = ((filasBib ?? []) as { id: string; ruta: string }[]).find((f) => f.id === aid)
        if (!fila) return { ok: false, error: "Una de las músicas elegidas ya no está en la biblioteca." }
        spec[`musica_${uso}`] = fila.ruta
      }
    }
    // El tipo de grabacion lo decide la etapa clasificar del motor: hasta entonces queda nulo.
    const { data: p, error } = await db
      .from("lf_proyectos")
      .insert({ account_id: accountId, titulo, esfuerzo: datos.esfuerzo, notas: datos.notas.slice(0, 4000), cta_defecto: datos.ctaDefecto, tipo: null, spec, tablero: "subiendo", fase: "subiendo", creado_por: yo?.id ?? null })
      .select("id")
      .single()
    if (error || !p) return { ok: false, error: `No se pudo crear: ${error?.message ?? "sin respuesta"}` }
    const id = (p as { id: string }).id

    // Si algo falla de aqui en adelante, el proyecto a medias se borra (con sus filas): no queda colgado en el tablero.
    const copias: { de: string; a: string }[] = []
    const deshacer = async (error: string): Promise<{ ok: false; error: string }> => {
      await db.from("lf_proyectos").delete().eq("id", id)
      if (copias.length) await db.storage.from(BUCKET).remove(copias.map((c) => c.a))
      return { ok: false, error }
    }

    type Fila = { account_id: string; proyecto_id: string; tipo: string; nombre: string; ruta: string; bytes: number | null; rol: string | null; persona?: string | null; subida: string; creado?: string }
    // Cada subida guarda su posicion en `archivos` en la ruta ("entrada/3-nombre.mp4"): asi el navegador sabe que
    // archivo va con cada firma.
    const filaDe = (a: Entrada, i: number): Fila => ({ account_id: accountId, proyecto_id: id, tipo: tipos[i]!, nombre: a.nombre.slice(0, 200), ruta: `${accountId}/${id}/entrada/${i + 1}-${limpio(a.nombre)}`, bytes: a.bytes, rol: tipos[i] === "musica" ? a.uso! : null, subida: "pendiente" })

    // Los videos van en el orden de la lista de clips, subidos y reusados mezclados. La letra de cada uno (A, B...)
    // sigue ese orden.
    const subidosFuente = archivos.map((a, i) => ({ a, i })).filter(({ i }) => tipos[i] === "fuente")
    const orden = ordenDeFuentes(subidosFuente.map(({ a }) => ({ orden: a.orden })), reusos)
    const fuentes: Fila[] = orden.map((o, k) => {
      if (o.de === "subida") return { ...filaDe(subidosFuente[o.i].a, subidosFuente[o.i].i), rol: CLAVES_FUENTE[k] }
      // Un reuso no se sube otra vez: Storage copia el original a la carpeta de este proyecto (cada proyecto tiene
      // sus archivos, y la ruta es unica en lf_archivos).
      const p = previos[o.i]
      const ruta = `${accountId}/${id}/entrada/r${o.i + 1}-${limpio(p.nombre)}`
      copias.push({ de: p.ruta, a: ruta })
      return { account_id: accountId, proyecto_id: id, tipo: "fuente", nombre: p.nombre.slice(0, 200), ruta, bytes: p.bytes, rol: CLAVES_FUENTE[k], persona: p.persona, subida: "lista" }
    })
    const filas: Fila[] = [...fuentes, ...archivos.flatMap((a, i) => (tipos[i] === "fuente" ? [] : [filaDe(a, i)]))]
    // El referente es un archivo mas del proyecto, con su tipo explicito y su propia ruta.
    if (ref.archivo) {
      const { nombre, bytes } = ref.archivo
      filas.push({ account_id: accountId, proyecto_id: id, tipo: "referente", nombre: nombre.slice(0, 200), ruta: rutaReferente(accountId, id, limpio(nombre)), bytes, rol: null, subida: "pendiente" })
    }
    // El motor lee los archivos por `creado`: una marca de tiempo por fila, en orden, para que los videos le
    // lleguen como estan en la lista (en un solo insert todas tendrian la misma).
    const t0 = Date.now()
    filas.forEach((f, k) => (f.creado = new Date(t0 + k).toISOString()))

    const copiadas = await Promise.all(copias.map((c) => db.storage.from(BUCKET).copy(c.de, c.a)))
    const fallida = copiadas.findIndex((r) => r.error)
    if (fallida >= 0) return deshacer(`No se pudo usar ${fuentes.find((f) => f.ruta === copias[fallida].a)?.nombre ?? "un video de la biblioteca"}: ${copiadas[fallida].error?.message}`)

    const { data: insertados, error: e2 } = await db.from("lf_archivos").insert(filas).select("id, nombre, ruta, subida")
    if (e2) return deshacer(`No se pudieron registrar los archivos: ${e2.message}`)

    const subidas: Subida[] = []
    for (const a of ((insertados ?? []) as { id: string; nombre: string; ruta: string; subida: string }[]).filter((x) => x.subida === "pendiente")) {
      const { data, error: e3 } = await db.storage.from(BUCKET).createSignedUploadUrl(a.ruta, { upsert: true })
      if (e3 || !data) return deshacer(`No se pudo preparar la subida: ${e3?.message ?? "sin respuesta"}`)
      subidas.push({ archivoId: a.id, nombre: a.nombre, ruta: a.ruta, token: data.token })
    }
    // Todo venia de la biblioteca: no hay nada que esperar, el proceso empieza ya.
    if (!subidas.length) {
      await db.from("lf_proyectos").update({ tablero: "procesando", fase: "en_cola", detalle: "ingesta" }).eq("id", id)
      await avisar(accountId, id, "subida", "Material listo", `${titulo}: empieza el proceso.`)
      await encolarEtapa(id, "ingesta")
    }
    revalidatePath("/long-form")
    return { ok: true, id, subidas, destino: destinoSubida() }
  } catch (e) {
    return fallo(e)
  }
}

/** El referente que pide la persona, ya revisado: un video subido o un enlace publico. */
function referenteValido(r: ReferenteNuevo | null | undefined): { ok: true; archivo?: { nombre: string; bytes: number }; url?: string } | { ok: false; error: string } {
  if (!r) return { ok: true }
  if ("url" in r) {
    const v = validarUrlReferente(String(r.url ?? ""))
    return v.ok ? { ok: true, url: v.url } : v
  }
  const nombre = String(r.nombre ?? "")
  const bytes = Number(r.bytes)
  if (!VIDEO_REFERENTE.test(nombre)) return { ok: false, error: `${nombre || "El referente"} no es un video (mp4, mov, m4v, mkv o webm).` }
  if (!Number.isFinite(bytes) || bytes <= 0) return { ok: false, error: "El video de referencia está vacío." }
  return { ok: true, archivo: { nombre, bytes } }
}

/** A donde sube el navegador. En Supabase en la nube, el dominio de Storage directo aguanta archivos grandes. */
function destinoSubida(): DestinoSubida {
  const url = process.env.SUPABASE_URL!.replace(/\/+$/, "")
  const base = url.includes(".supabase.co") ? url.replace(".supabase.co", ".storage.supabase.co") : url
  return { endpoint: `${base}/storage/v1/upload/resumable/sign`, apikey: process.env.SUPABASE_PUBLISHABLE_KEY!, bucket: BUCKET }
}

/** Una firma nueva para un archivo cuya subida se corto y vencio. */
export async function renovarSubida(proyectoId: string, archivoId: string): Promise<Hecho<{ token: string; destino: DestinoSubida }>> {
  try {
    const { p } = await proyectoPropio(proyectoId)
    const a = p.archivos.find((x) => x.id === archivoId)
    if (!a || a.subida !== "pendiente") return { ok: false, error: "Ese archivo ya no espera subida." }
    const { data, error } = await supabaseAdmin().storage.from(BUCKET).createSignedUploadUrl(a.ruta, { upsert: true })
    if (error || !data) return { ok: false, error: error?.message ?? "Sin firma" }
    return { ok: true, token: data.token, destino: destinoSubida() }
  } catch (e) {
    return fallo(e)
  }
}

/** Un archivo termino de subir. Cuando estan todos, el proyecto entra a procesarse. */
export async function subidaTerminada(proyectoId: string, archivoId: string): Promise<Hecho<{ completo: boolean }>> {
  try {
    const { accountId, p } = await proyectoPropio(proyectoId)
    const a = p.archivos.find((x) => x.id === archivoId)
    if (!a) return { ok: false, error: "Ese archivo no es de este video." }
    const db = supabaseAdmin()
    // Que de verdad este en Storage antes de darlo por subido.
    const carpeta = a.ruta.slice(0, a.ruta.lastIndexOf("/"))
    const { data: lista } = await db.storage.from(BUCKET).list(carpeta, { search: a.ruta.slice(carpeta.length + 1) })
    if (!lista?.length) return { ok: false, error: "El archivo no llegó completo. Vuelve a intentarlo." }
    await db.from("lf_archivos").update({ subida: "lista" }).eq("id", a.id)
    const faltan = p.archivos.filter((x) => x.id !== a.id && x.subida === "pendiente").length
    if (faltan === 0 && p.tablero === "subiendo") {
      await db.from("lf_proyectos").update({ tablero: "procesando", fase: "en_cola", detalle: "ingesta" }).eq("id", p.id)
      await avisar(accountId, p.id, "subida", "Subida terminada", `${p.titulo}: empieza el proceso.`)
      await encolarEtapa(p.id, "ingesta")
      revalidatePath("/long-form")
    }
    return { ok: true, completo: faltan === 0 }
  } catch (e) {
    return fallo(e)
  }
}

/** Lo que la pantalla del proyecto vuelve a pedir cada pocos segundos mientras algo avanza. */
export async function estadoProyecto(id: string): Promise<Hecho<{ p: Proyecto; urls: Record<string, string> }>> {
  try {
    const { accountId, p } = await proyectoPropio(id)
    const urls = await urlsFirmadas(accountId, p.archivos.filter((a) => a.subida === "lista").map((a) => a.ruta))
    return { ok: true, p, urls }
  } catch (e) {
    return fallo(e)
  }
}

async function guardarEstado(id: string, clave: string, valor: unknown) {
  const { error } = await supabaseAdmin().rpc("lf_guardar_estado", { p_proyecto: id, p_clave: clave, p_valor: valor })
  if (error) throw new Error(error.message)
}

/** Revision 1: quien es quien. Sigue el plan. */
export async function aprobarReparto(id: string, reparto: { personas: Record<string, unknown>[] } & Record<string, unknown>): Promise<Hecho> {
  try {
    const { p } = await proyectoPropio(id)
    if (p.fase !== "revision_reparto") return { ok: false, error: "Este video no está esperando esa revisión." }
    const personas = (reparto.personas ?? []).slice(0, 20).map((x) => ({ ...x, nombre: String(x.nombre ?? "").slice(0, 60), rol: String(x.rol ?? "").slice(0, 80), handle: String(x.handle ?? "").slice(0, 40) }))
    await guardarEstado(id, "reparto_aprobado", { ...(p.estado.reparto as object), ...reparto, personas })
    await supabaseAdmin().from("lf_proyectos").update({ tablero: "procesando" }).eq("id", id)
    await encolarEtapa(id, "plan")
    revalidatePath(`/long-form/${id}`)
    return { ok: true }
  } catch (e) {
    return fallo(e)
  }
}

/** Revision 2: el guion. Siguen los graficos y el render. */
export async function aprobarGuion(id: string, guion: Record<string, unknown>): Promise<Hecho> {
  try {
    const { p } = await proyectoPropio(id)
    if (p.fase !== "revision_guion") return { ok: false, error: "Este video no está esperando esa revisión." }
    await guardarEstado(id, "guion_aprobado", guion)
    await supabaseAdmin().from("lf_proyectos").update({ tablero: "procesando" }).eq("id", id)
    await encolarEtapa(id, "graficos")
    revalidatePath(`/long-form/${id}`)
    return { ok: true }
  } catch (e) {
    return fallo(e)
  }
}

/** Corregir: vuelve al guion desde lo aprobado. El render siguiente sale como version nueva. */
/**
 * La persona corrige el tipo de grabacion que eligio `clasificar`: queda fijo (spec.tipo_forzado) y el video se
 * vuelve a analizar desde ahi. Solo mientras revisa quien es quien, o si el proceso fallo (un tipo equivocado
 * puede hacer fallar el analisis). Lo ya subido no se toca.
 */
export async function cambiarTipo(id: string, tipo: string): Promise<Hecho> {
  try {
    const { p } = await proyectoPropio(id)
    if (!TIPOS_GRABACION.includes(tipo as (typeof TIPOS_GRABACION)[number])) return { ok: false, error: "Ese tipo de grabación no existe." }
    if (p.fase !== "revision_reparto" && p.tablero !== "error") return { ok: false, error: "El tipo se cambia al revisar quién es quién." }
    if (!p.estado.clasificacion) return { ok: false, error: "Espera a que Studio reconozca el tipo." }
    if (tipo === p.tipo) return { ok: true }
    const db = supabaseAdmin()
    const { error } = await db
      .from("lf_proyectos")
      .update({ spec: { ...p.spec, tipo_forzado: tipo }, tipo, tablero: "procesando", fase: "en_cola", detalle: "analisis" })
      .eq("id", id)
    if (error) return { ok: false, error: `No se pudo cambiar: ${error.message}` }
    await encolarEtapa(id, "analisis")
    revalidatePath(`/long-form/${id}`)
    return { ok: true }
  } catch (e) {
    return fallo(e)
  }
}

/**
 * El referente fallo (un enlace que el servidor no baja, un archivo que no se lee): el video sigue sin el. Queda
 * anotado en spec.sin_referente y la etapa referente vuelve a correr, esta vez sin hacer nada.
 */
export async function seguirSinReferente(id: string): Promise<Hecho> {
  try {
    const { p } = await proyectoPropio(id)
    const fallido = p.trabajos.find((t) => t.estado === "error")
    if (p.tablero !== "error" || fallido?.etapa !== "referente") return { ok: false, error: "El referente no está fallando." }
    const { error } = await supabaseAdmin()
      .from("lf_proyectos")
      .update({ spec: { ...p.spec, sin_referente: true }, tablero: "procesando", fase: "en_cola", detalle: "referente" })
      .eq("id", id)
    if (error) return { ok: false, error: `No se pudo seguir: ${error.message}` }
    await encolarEtapa(id, "referente")
    revalidatePath(`/long-form/${id}`)
    return { ok: true }
  } catch (e) {
    return fallo(e)
  }
}

export async function corregir(id: string): Promise<Hecho> {
  try {
    const { p } = await proyectoPropio(id)
    const aprobado = p.estado.guion_aprobado ?? p.estado.guion
    if (!aprobado) return { ok: false, error: "Este video todavía no tiene guion." }
    if (!["listo", "difusion", "enviado"].includes(p.tablero)) return { ok: false, error: "Espera a que termine el proceso." }
    await guardarEstado(id, "guion", aprobado)
    await supabaseAdmin().from("lf_proyectos").update({ fase: "revision_guion", detalle: "Corrección", tablero: "revision" }).eq("id", id)
    revalidatePath(`/long-form/${id}`)
    return { ok: true }
  } catch (e) {
    return fallo(e)
  }
}

/** Reintentar la etapa que fallo. */
export async function reintentar(id: string): Promise<Hecho> {
  try {
    const { p } = await proyectoPropio(id)
    const fallido = p.trabajos.find((t) => t.estado === "error")
    if (p.tablero !== "error" || !fallido) return { ok: false, error: "No hay nada que reintentar." }
    await supabaseAdmin().from("lf_proyectos").update({ tablero: "procesando", fase: "en_cola", detalle: fallido.etapa }).eq("id", id)
    await encolarEtapa(id, fallido.etapa)
    revalidatePath(`/long-form/${id}`)
    return { ok: true }
  } catch (e) {
    return fallo(e)
  }
}

// ------------------------------------------------------------------ avisos

export async function misAvisos(): Promise<Hecho<{ avisos: Aviso[]; sinLeer: number }>> {
  try {
    const accountId = await idDeCuentaCon("long_form")
    const yo = await usuarioActual()
    if (!yo) return { ok: false, error: "Sin sesión" }
    const avisos = await avisosDe(accountId, yo.id)
    return { ok: true, avisos, sinLeer: avisos.filter((a) => !a.leido).length }
  } catch (e) {
    return fallo(e)
  }
}

export async function leerAvisos(ids: string[] | "todos"): Promise<Hecho> {
  try {
    const accountId = await idDeCuentaCon("long_form")
    const yo = await usuarioActual()
    if (!yo) return { ok: false, error: "Sin sesión" }
    await marcarLeidos(accountId, yo.id, ids)
    return { ok: true }
  } catch (e) {
    return fallo(e)
  }
}
