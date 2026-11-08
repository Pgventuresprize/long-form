import { readFileSync } from "node:fs"
import path from "node:path"

import { kitActivo } from "../marca/kit"
import { estiloDesdeConfig } from "../render/theme"
import { supabaseAdmin } from "../supabase-admin"
import { ESTILO_BASE, normalizarEstilo, type Archivo, type CtaVideo, type EstiloLongForm, type Fuente } from "./estilo"
import type { Recursos } from "./plantillas"

/**
 * El estilo long form en la base: leerlo, proponerlo a partir de la marca, guardarlo y armar lo
 * que la vista previa necesita (fuentes y URLs de los archivos).
 */

export const BUCKET_LF = "longform"

export type EstiloGuardado = { config: EstiloLongForm; listo: boolean; updatedAt: string | null }

export async function estiloDe(accountId: string): Promise<EstiloGuardado | null> {
  const { data, error } = await supabaseAdmin().from("lf_estilos").select("config, listo, updated_at").eq("account_id", accountId).maybeSingle()
  if (error || !data) return null
  const f = data as { config: unknown; listo: boolean; updated_at: string }
  return { config: normalizarEstilo(f.config), listo: f.listo, updatedAt: f.updated_at }
}

export async function guardarEstilo(accountId: string, config: EstiloLongForm, listo?: boolean): Promise<string | null> {
  const fila: Record<string, unknown> = { account_id: accountId, config: normalizarEstilo(config), updated_at: new Date().toISOString() }
  if (listo !== undefined) fila.listo = listo
  const { error } = await supabaseAdmin().from("lf_estilos").upsert(fila, { onConflict: "account_id" })
  return error ? error.message : null
}

/** De la URL publica de un logo (bucket carousels) a su archivo. */
export function archivoDeUrlPublica(url: string | null): Archivo | null {
  if (!url) return null
  const m = /\/storage\/v1\/object\/public\/([^/]+)\/([^?#]+)/.exec(url)
  return m ? { bucket: m[1], ruta: decodeURIComponent(m[2]) } : null
}

/**
 * La propuesta del onboarding: todo a partir del kit y de lo comun (colores, fuentes, logos, CTA,
 * nombre y usuario). No inventa nada de la marca: lo que no hay queda vacio.
 */
export async function proponerEstilo(accountId: string): Promise<EstiloLongForm> {
  const db = supabaseAdmin()
  const [perfil, config, ctas, kit] = await Promise.all([
    db.from("brand_profile").select("nombre, handle").eq("account_id", accountId).maybeSingle(),
    db.from("generation_config").select("carousel").eq("account_id", accountId).maybeSingle(),
    db.from("content_ctas").select("name, description, activo").eq("account_id", accountId).order("position"),
    kitActivo(accountId).catch(() => null),
  ])
  const p = (perfil.data ?? {}) as { nombre?: string | null; handle?: string | null }
  const carrusel = estiloDesdeConfig((config.data as { carousel?: unknown } | null)?.carousel)
  const e: EstiloLongForm = structuredClone(ESTILO_BASE)

  // Colores: los de la marca si los guardo; si no, los de su paleta.
  if (carrusel.colores) {
    e.colores.tinta = carrusel.colores.tinta.toLowerCase()
    e.colores.papel = carrusel.colores.papel.toLowerCase()
    e.colores.acento = carrusel.colores.acento.toLowerCase()
    e.colores.acento_texto = carrusel.colores.acentoTexto.toLowerCase()
    e.colores.degradado = carrusel.colores.degradado.map((c) => c.toLowerCase())
  } else if (/^#[0-9a-f]{6}$/i.test(carrusel.paleta.acento) && carrusel.paleta.acento.toLowerCase() !== "#ffffff") {
    e.colores.acento = carrusel.paleta.acento.toLowerCase()
  }

  // Fuente: la de titulos del kit activo si trae archivo; si no, la del carrusel.
  e.fuente = fuenteDelKit(kit) ?? { origen: "studio", nombre: carrusel.fuente === "SpaceGrotesk" ? "Space Grotesk" : "HeroFont" }

  // Logos: el oscuro va sobre el acento; el claro, sobre fondos oscuros.
  e.logo = { sobre_acento: archivoDeUrlPublica(carrusel.logoOscuro ?? carrusel.logoClaro), sobre_oscuro: archivoDeUrlPublica(carrusel.logoClaro) }

  e.handle = (p.handle ?? "").trim()
  e.textos.pie_intro = (p.nombre ?? "").trim()

  // CTA de video: los CTA activos de la marca, con su nombre como titular. Sin QR hasta que se ponga el enlace.
  const filas = ((ctas.data ?? []) as { name: string; description: string | null; activo: boolean | null }[]).filter((c) => c.activo !== false)
  e.ctas = filas.slice(0, 4).map(
    (c, i): CtaVideo => ({
      clave: `cta-${i + 1}`,
      kick: (p.nombre ?? "").trim().slice(0, 60),
      titular: c.name.slice(0, 60),
      apoyo: (c.description ?? "").slice(0, 160),
      boton: "Escanea",
      pie: e.handle,
      url: "",
      qr: null,
    })
  )
  e.clips.cta = e.ctas[0]?.clave ?? null
  return normalizarEstilo(e)
}

function fuenteDelKit(kit: Awaited<ReturnType<typeof kitActivo>>): Fuente | null {
  if (!kit) return null
  const titulos = kit.kit.sistema.fuentes.find((f) => /titul|display|head/i.test(f.papel))?.familia
  const archivos = kit.archivos.filter((a) => a.tipo === "fuente" && typeof a.meta.familia === "string")
  const elegido =
    archivos.find((a) => a.meta.familia === titulos && Number(a.meta.peso) >= 600) ??
    archivos.find((a) => a.meta.familia === titulos) ??
    archivos.find((a) => Number(a.meta.peso) >= 600) ??
    archivos[0]
  if (!elegido) return null
  return { origen: "kit", familia: String(elegido.meta.familia), archivo: { bucket: "marca-kits", ruta: elegido.ruta } }
}

// ------------------------------------------------------------------ vista previa

const FUENTES_STUDIO: Record<"Plogy Display" | "HeroFont" | "Space Grotesk", { archivo: string; formato: string; mime: string }> = {
  "Plogy Display": { archivo: "PlogyDisplay-Bold.woff2", formato: "woff2", mime: "font/woff2" },
  HeroFont: { archivo: "HeroFont-Bold.otf", formato: "opentype", mime: "font/otf" },
  "Space Grotesk": { archivo: "SpaceGrotesk-700.ttf", formato: "truetype", mime: "font/ttf" },
}

const FORMATO_POR_EXT: Record<string, [string, string]> = {
  woff2: ["woff2", "font/woff2"],
  woff: ["woff", "font/woff"],
  ttf: ["truetype", "font/ttf"],
  otf: ["opentype", "font/otf"],
}

async function bajar(a: Archivo): Promise<Buffer | null> {
  const { data, error } = await supabaseAdmin().storage.from(a.bucket).download(a.ruta)
  return error || !data ? null : Buffer.from(await data.arrayBuffer())
}

/** El @font-face de la fuente del estilo, con el archivo en data URI (la vista va en un iframe aislado). */
export async function fuenteComoCss(f: Fuente): Promise<string> {
  let datos: Buffer | null = null
  let formato = "truetype"
  let mime = "font/ttf"
  let familia: string
  if (f.origen === "studio") {
    const s = FUENTES_STUDIO[f.nombre]
    datos = readFileSync(path.join(process.cwd(), "long-form", "plantillas", "fuentes", s.archivo))
    formato = s.formato
    mime = s.mime
    familia = f.nombre
  } else {
    datos = await bajar(f.archivo)
    const ext = f.archivo.ruta.split(".").pop()?.toLowerCase() ?? "ttf"
    ;[formato, mime] = FORMATO_POR_EXT[ext] ?? ["truetype", "font/ttf"]
    familia = f.familia
  }
  if (!datos) return ""
  return `@font-face{font-family:'${familia.replace(/['"\\]/g, "")}';src:url(data:${mime};base64,${datos.toString("base64")}) format('${formato}');font-weight:700}`
}

/** Todos los archivos que nombra el estilo (logos, QR, fotos), con una URL que dura una hora. */
export async function recursosDe(e: EstiloLongForm): Promise<Recursos> {
  const archivos: Archivo[] = [e.logo.sobre_acento, e.logo.sobre_oscuro, ...e.ctas.map((c) => c.qr), ...e.personas.map((p) => p.foto)].filter((a): a is Archivo => a !== null)
  const urls = new Map<string, string>()
  await Promise.all(
    archivos.map(async (a) => {
      const clave = `${a.bucket}:${a.ruta}`
      if (urls.has(clave)) return
      if (a.bucket === "carousels") {
        urls.set(clave, supabaseAdmin().storage.from(a.bucket).getPublicUrl(a.ruta).data.publicUrl)
        return
      }
      const { data } = await supabaseAdmin().storage.from(a.bucket).createSignedUrl(a.ruta, 3600)
      if (data?.signedUrl) urls.set(clave, data.signedUrl)
    })
  )
  return {
    fuentesCss: await fuenteComoCss(e.fuente),
    url: (a) => (a ? (urls.get(`${a.bucket}:${a.ruta}`) ?? null) : null),
  }
}

// ------------------------------------------------------------------ biblioteca de audio

export type Audio = { id: string; tipo: "musica" | "sfx"; momento: string | null; nombre: string; formato: "mp3" | "wav"; bytes: number; duracion: number | null }

export async function bibliotecaDe(accountId: string): Promise<Audio[]> {
  const { data, error } = await supabaseAdmin()
    .from("lf_biblioteca")
    .select("id, tipo, momento, nombre, formato, bytes, duracion_s")
    .eq("account_id", accountId)
    .order("created_at", { ascending: false })
  if (error) return []
  return ((data ?? []) as { id: string; tipo: "musica" | "sfx"; momento: string | null; nombre: string; formato: "mp3" | "wav"; bytes: number; duracion_s: number | null }[]).map((f) => ({
    id: f.id,
    tipo: f.tipo,
    momento: f.momento,
    nombre: f.nombre,
    formato: f.formato,
    bytes: f.bytes,
    duracion: f.duracion_s,
  }))
}
