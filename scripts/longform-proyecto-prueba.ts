/**
 * Crea un proyecto de long form con archivos locales, SOLO en el Supabase local, y lo encola.
 *
 *   npx tsx --env-file=.env.local scripts/longform-proyecto-prueba.ts <slug> <tipo> <nivel> "<titulo>" <video>[=Rol:Persona] ...
 *
 * tipo: camaras | meet. nivel: rapido | normal | detallado. Ejemplo:
 *   ... prueba-long-form camaras rapido "IA en deportes" A.mp4=A:Cesar B.mp4=B:Juanfra
 */
import { createReadStream, statSync } from "node:fs"
import path from "node:path"

import * as tus from "tus-js-client"

import { estiloDe } from "../src/engine/long-form/estilo-datos"
import { encolarEtapa } from "../src/engine/long-form/motor"
import { specDesdeEstilo } from "../src/engine/long-form/proyectos"
import type { Nivel } from "../src/engine/long-form/estilo"
import { supabaseAdmin } from "../src/engine/supabase-admin"

/** Subida reanudable (TUS) en trozos de 6 MB, como la hace la interfaz: un video de varios GB entra entero. */
function subirTus(archivo: string, ruta: string): Promise<void> {
  return new Promise((resolver, rechazar) => {
    const u = new tus.Upload(createReadStream(archivo), {
      endpoint: `${process.env.SUPABASE_URL}/storage/v1/upload/resumable`,
      headers: { authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`, "x-upsert": "true" },
      chunkSize: 6 * 1024 * 1024,
      uploadSize: statSync(archivo).size,
      retryDelays: [0, 2000, 5000, 10000],
      metadata: { bucketName: "longform", objectName: ruta, contentType: "video/mp4", cacheControl: "3600" },
      onError: rechazar,
      onSuccess: () => resolver(),
    })
    u.start()
  })
}

async function main() {
  if (!/^http:\/\/(127\.0\.0\.1|localhost)/.test(process.env.SUPABASE_URL ?? "")) throw new Error("Solo en local.")
  const [slug, tipo, nivel, titulo, ...videos] = process.argv.slice(2)
  const db = supabaseAdmin()
  const { data: cuenta } = await db.from("accounts").select("id, name").eq("slug", slug).maybeSingle()
  if (!cuenta) throw new Error(`No existe ${slug}`)
  const accountId = (cuenta as { id: string }).id
  const estilo = await estiloDe(accountId)
  if (!estilo) throw new Error("La cuenta no tiene estilo de long form")
  const spec = specDesdeEstilo(estilo.config, { esfuerzo: nivel as Nivel, marca: (cuenta as { name: string }).name })

  const { data: p, error } = await db
    .from("lf_proyectos")
    .insert({ account_id: accountId, titulo, esfuerzo: nivel, tipo, spec, tablero: "subiendo" })
    .select("id")
    .single()
  if (error || !p) throw new Error(error?.message)
  const pid = (p as { id: string }).id

  for (const v of videos) {
    const [archivo, extra] = v.split("=")
    const [rol, persona] = (extra ?? "").split(":")
    const nombre = path.basename(archivo)
    const ruta = `${accountId}/${pid}/entrada/${nombre.replace(/[^a-z0-9._-]+/gi, "-")}`
    const t0 = Date.now()
    await subirTus(archivo, ruta)
    await db.from("lf_archivos").insert({ account_id: accountId, proyecto_id: pid, tipo: "fuente", nombre, ruta, bytes: statSync(archivo).size, mime: "video/mp4", rol: rol || null, persona: persona || null, subida: "lista" })
    console.log(`subido ${nombre} en ${((Date.now() - t0) / 1000).toFixed(1)} s`)
  }
  await db.from("lf_proyectos").update({ tablero: "procesando" }).eq("id", pid)
  await encolarEtapa(pid, "ingesta")
  console.log(`proyecto ${pid} encolado`)
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
