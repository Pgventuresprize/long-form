/**
 * Convierte un preset del motor (por ejemplo presets/plogy de plogy-longform) en el estilo long form
 * de una cuenta: colores, fuente, logos, CTA con su QR, textos, musica y efectos.
 *
 *   npx tsx --env-file=.env.local scripts/longform-importar-preset.ts <slug-de-la-cuenta> <carpeta-del-preset>
 *
 * La musica que no es MP3 ni WAV (la intro de Plogy es .mp4) se convierte a MP3 con ffmpeg (FFMPEG o
 * el del PATH). Los WAV se suben tal cual. Deja el estilo confirmado. Se puede correr varias veces:
 * reemplaza el estilo y suma los audios de nuevo.
 */
import { execFileSync } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

import { formatoPorFirma } from "../src/engine/long-form/audio"
import { MOMENTOS_SFX, SFX_MOTOR, normalizarEstilo, type Archivo, type EstiloLongForm } from "../src/engine/long-form/estilo"
import { BUCKET_LF, guardarEstilo } from "../src/engine/long-form/estilo-datos"
import { supabaseAdmin } from "../src/engine/supabase-admin"

type Preset = {
  nombre: string
  colores: Record<string, string | string[]>
  fuente: { familia: string; woff2?: string; ttf?: string; cuerpo?: string }
  logos: Record<string, string>
  caja_alfa?: number
  redes?: [string, string][]
  handle?: string
  web?: string
  ctas?: Record<string, { qr?: string; kick: string; head: string; sub: string; cta: string; cap: string }>
  musica?: { intro?: string; cierre?: string; loudness_lufs?: number }
  sfx?: Record<string, string>
  textos?: Record<string, string>
  reglas?: Record<string, number>
}

const FFMPEG = process.env.FFMPEG ?? "ffmpeg"
const MIME: Record<string, string> = { png: "image/png", svg: "image/svg+xml", jpg: "image/jpeg", mp3: "audio/mpeg", wav: "audio/wav", woff2: "font/woff2", ttf: "font/ttf" }

/** Las etiquetas del preset a la marca de asteriscos del estilo. */
const aAsteriscos = (html: string) =>
  html
    .replace(/<\/?(span|b|strong)>/g, "*")
    .replace(/<[^>]+>/g, "")
    .replace(/\*\s*\*/g, "")
    .trim()

async function main() {
  const [slug, carpeta] = process.argv.slice(2)
  if (!slug || !carpeta) throw new Error("Uso: longform-importar-preset.ts <slug> <carpeta>")
  const db = supabaseAdmin()
  const { data: cuenta } = await db.from("accounts").select("id, name").eq("slug", slug).maybeSingle()
  if (!cuenta) throw new Error(`No existe la cuenta ${slug}`)
  const accountId = (cuenta as { id: string }).id
  const p = JSON.parse(readFileSync(path.join(carpeta, "marca.json"), "utf8").replace(/^﻿/, "")) as Preset

  const subir = async (local: string, clase: string): Promise<Archivo> => {
    const ext = local.split(".").pop()!.toLowerCase()
    const ruta = `${accountId}/estilo/${clase}/${path.basename(local).replace(/[^a-z0-9.-]+/gi, "-").toLowerCase()}`
    const { error } = await db.storage.from(BUCKET_LF).upload(ruta, readFileSync(local), { contentType: MIME[ext] ?? "application/octet-stream", upsert: true })
    if (error) throw new Error(`No se pudo subir ${local}: ${error.message}`)
    return { bucket: BUCKET_LF, ruta }
  }

  const tmp = mkdtempSync(path.join(tmpdir(), "lf-preset-"))
  const audio = async (rel: string, tipo: "musica" | "sfx", momento: string): Promise<string | null> => {
    let local = path.join(carpeta, rel)
    if (!existsSync(local)) return null
    const ext = local.split(".").pop()!.toLowerCase()
    if (ext !== "mp3" && ext !== "wav") {
      // Solo MP3 o WAV: lo demas se convierte una vez aqui.
      const mp3 = path.join(tmp, path.basename(local).replace(/\.[^.]+$/, ".mp3"))
      execFileSync(FFMPEG, ["-y", "-v", "error", "-i", local, "-vn", "-c:a", "libmp3lame", "-b:a", "192k", mp3])
      local = mp3
    }
    const formato = formatoPorFirma(new Uint8Array(readFileSync(local).subarray(0, 16)))
    if (!formato) throw new Error(`${local} no es MP3 ni WAV por dentro`)
    const a = await subir(local, "audio")
    const dur = Number(execFileSync(FFMPEG.replace(/ffmpeg(\.exe)?$/i, "ffprobe$1"), ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", local]).toString().trim())
    const { data, error } = await db
      .from("lf_biblioteca")
      .upsert(
        { account_id: accountId, tipo, momento, nombre: path.basename(local), ruta: a.ruta, formato, bytes: readFileSync(local).byteLength, duracion_s: Number.isFinite(dur) ? dur : null, verificado: true },
        { onConflict: "ruta" }
      )
      .select("id")
      .single()
    if (error) throw new Error(error.message)
    return (data as { id: string }).id
  }

  const e: EstiloLongForm = normalizarEstilo({})
  const c = p.colores
  Object.assign(e.colores, {
    tinta: c.tinta,
    papel: c.papel,
    apagado: c.apagado,
    acento: c.acento,
    acento_texto: c.acento_texto,
    borde: c.borde,
    fondo_escenario: c.fondo_escenario,
    kick: c.kick,
    degradado: c.degradado,
  })
  e.fuente = p.fuente.familia === "Plogy Display" ? { origen: "studio", nombre: "Plogy Display" } : { origen: "subida", familia: p.fuente.familia, archivo: await subir(path.join(carpeta, p.fuente.woff2 ?? p.fuente.ttf!), "fuente") }
  if (p.fuente.cuerpo) e.cuerpo = p.fuente.cuerpo
  e.logo = {
    sobre_acento: p.logos.sobre_acento ? await subir(path.join(carpeta, p.logos.sobre_acento), "logo") : null,
    sobre_oscuro: p.logos.sobre_oscuro_png ? await subir(path.join(carpeta, p.logos.sobre_oscuro_png), "logo") : null,
  }
  e.caja_alfa = p.caja_alfa ?? e.caja_alfa
  e.redes = p.redes ?? []
  e.handle = p.handle ?? ""
  e.web = p.web ?? ""
  e.textos = { ...e.textos, ...(p.textos ?? {}) }
  e.ctas = await Promise.all(
    Object.entries(p.ctas ?? {}).map(async ([clave, x]) => ({
      clave,
      kick: x.kick,
      titular: aAsteriscos(x.head),
      apoyo: aAsteriscos(x.sub),
      boton: x.cta,
      pie: x.cap,
      url: "",
      qr: x.qr ? await subir(path.join(carpeta, x.qr), "qr") : null,
    }))
  )
  e.clips.cta = e.ctas[0]?.clave ?? null
  const r = p.reglas ?? {}
  e.graficos = (r.barra_cada_min ?? 7) <= 5 ? "muchos" : (r.barra_cada_min ?? 7) >= 12 ? "pocos" : "normal"

  if (p.musica?.intro) e.musica.intro = await audio(p.musica.intro, "musica", "intro")
  e.musica.cierre = p.musica?.cierre === p.musica?.intro ? e.musica.intro : p.musica?.cierre ? await audio(p.musica.cierre, "musica", "cierre") : null
  if (p.musica?.loudness_lufs) e.musica.loudness_lufs = p.musica.loudness_lufs
  for (const m of MOMENTOS_SFX) {
    const rel = p.sfx?.[SFX_MOTOR[m]]
    if (rel) e.sfx[m] = await audio(rel, "sfx", m)
  }

  const error = await guardarEstilo(accountId, e, true)
  if (error) throw new Error(error)
  console.log(`Estilo de ${(cuenta as { name: string }).name} importado: ${e.ctas.length} CTA, ${Object.values(e.sfx).filter((x) => typeof x === "string").length} efectos, música ${e.musica.intro ? "sí" : "no"}.`)
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
