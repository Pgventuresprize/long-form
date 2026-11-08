/**
 * Dibuja cada pieza del estilo long form de una cuenta, a tamano real, para revisarlas sin abrir
 * Studio. Las mismas paginas que la vista previa.
 *
 *   npx tsx --env-file=.env.local scripts/longform-capturas-piezas.ts <slug> <carpeta>
 */
import { mkdirSync } from "node:fs"
import path from "node:path"

import puppeteer from "puppeteer-core"

import { estiloDe, recursosDe } from "../src/engine/long-form/estilo-datos"
import { ejemplo, paginaDePieza, paginaDeSubtitulo, type TipoPieza } from "../src/engine/long-form/plantillas"
import { supabaseAdmin } from "../src/engine/supabase-admin"

const CHROME = process.env.CHROME ?? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
const TIPOS: TipoPieza[] = ["rotulo", "barra", "cita", "pregunta", "popup", "tarjeta-intro", "tarjeta-cierre"]

async function main() {
  const [slug, carpeta] = process.argv.slice(2)
  const { data } = await supabaseAdmin().from("accounts").select("id, name").eq("slug", slug).maybeSingle()
  if (!data) throw new Error(`No existe ${slug}`)
  const cuenta = data as { id: string; name: string }
  const guardado = await estiloDe(cuenta.id)
  if (!guardado) throw new Error("Esa cuenta no tiene estilo")
  const r = await recursosDe(guardado.config)
  mkdirSync(carpeta, { recursive: true })
  const b = await puppeteer.launch({ executablePath: CHROME, headless: true })
  const p = await b.newPage()
  for (const disp of ["pantalla", "escenario"] as const) {
    for (const t of TIPOS) {
      if (disp === "escenario" && t.startsWith("tarjeta")) continue
      await p.setViewport({ width: 1920, height: 1080 })
      await p.setContent(paginaDePieza(guardado.config, t, ejemplo(guardado.config, t, cuenta.name), r, disp), { waitUntil: "load", timeout: 90000 })
      await new Promise((x) => setTimeout(x, 900))
      await p.screenshot({ path: path.join(carpeta, `${disp}-${t}.png`), omitBackground: false })
    }
  }
  await p.setViewport({ width: 1080, height: 1920 })
  await p.setContent(paginaDeSubtitulo(guardado.config, r), { waitUntil: "load", timeout: 90000 })
  await p.screenshot({ path: path.join(carpeta, "subtitulo.png") })
  await b.close()
  console.log(`Listo en ${carpeta}`)
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
