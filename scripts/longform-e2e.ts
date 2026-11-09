/**
 * De punta a punta en el navegador, contra Studio y el motor en local:
 * nuevo video -> subida TUS -> proceso -> (revisiones segun el nivel) -> video listo.
 *
 *   npx tsx scripts/longform-e2e.ts <nivel> <carpeta-capturas> <video> [<video> ...]
 *
 * Necesita `next dev` (LF_CAPTURAS_URL), el motor (`long-form/motor/servir.ps1`), la semilla y una marca con
 * estilo confirmado abierta (LF_CUENTA=<slug>). Deja una captura de cada paso.
 */
import { mkdirSync } from "node:fs"
import path from "node:path"

import puppeteer, { type Page } from "puppeteer-core"

const BASE = process.env.LF_CAPTURAS_URL ?? "http://localhost:3000"
const CHROME = process.env.CHROME ?? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
const CORREO = process.env.SEMILLA_CORREO ?? "prueba@studio.local"
const CLAVE = process.env.SEMILLA_CLAVE ?? "prueba-longform-1"

const [, , nivel = "detallado", carpeta = "capturas-e2e", ...videos] = process.argv
const t0 = Date.now()
const seg = () => `${Math.round((Date.now() - t0) / 1000)} s`

async function foto(p: Page, nombre: string) {
  await p.screenshot({ path: path.join(carpeta, `${nombre}.png`) })
  console.log(`[${seg()}] ${nombre}`)
}

async function esperarTexto(p: Page, re: RegExp, minutos: number) {
  const hasta = Date.now() + minutos * 60_000
  while (Date.now() < hasta) {
    const texto = await p.evaluate(() => document.body.innerText)
    if (re.test(texto)) return texto
    if (/Algo falló en/.test(texto)) throw new Error(`El proyecto falló: ${texto.slice(texto.indexOf("Algo falló"), texto.indexOf("Algo falló") + 300)}`)
    await new Promise((r) => setTimeout(r, 5000))
  }
  throw new Error(`No apareció ${re} en ${minutos} min`)
}

async function main() {
  mkdirSync(carpeta, { recursive: true })
  const b = await puppeteer.launch({ executablePath: CHROME, headless: true })
  const p = await b.newPage()
  p.setDefaultTimeout(240_000)
  p.setDefaultNavigationTimeout(240_000)
  await p.setViewport({ width: 1440, height: 1000 })
  await p.goto(`${BASE}/login`, { waitUntil: "networkidle2" })
  await p.type("#email", CORREO)
  await p.type("#password", CLAVE)
  await p.waitForFunction(() => {
    const i = document.querySelector<HTMLInputElement>('input[name="cf-turnstile-response"]')
    return !i || i.value.length > 0
  })
  await p.click('button[type="submit"][class*="h-12"]')
  await p.waitForFunction(() => location.pathname !== "/login", { timeout: 120_000 })
  if (process.env.LF_CUENTA) await p.setCookie({ name: "hancel_cuenta", value: process.env.LF_CUENTA, url: BASE })

  await p.goto(`${BASE}/long-form/nuevo`, { waitUntil: "networkidle2" })
  const input = await p.$('input[type=file][multiple]')
  await input!.uploadFile(...videos)
  await p.$eval("#lf-titulo", (el) => ((el as HTMLInputElement).value = ""))
  await p.type("#lf-titulo", `Prueba ${nivel} ${new Date().toLocaleTimeString("es-CO")}`)
  const [boton] = await p.$$(`xpath/.//button[.//span[contains(., '${nivel === "rapido" ? "Rápido" : nivel === "normal" ? "Normal" : "Detallado"}')]]`)
  await boton.click()
  await foto(p, "1-nuevo-video")
  const [empezar] = await p.$$("xpath/.//button[contains(., 'Empezar')]")
  await empezar.click()
  await p.waitForFunction(() => /\/long-form\/[0-9a-f-]{36}$/.test(location.pathname), { timeout: 120_000 })
  await foto(p, "2-subiendo")

  const pasar = async (re: RegExp, boton: string, nombre: string) => {
    await esperarTexto(p, re, 60)
    await new Promise((r) => setTimeout(r, 1500))
    await foto(p, nombre)
    const [b2] = await p.$$(`xpath/.//button[contains(., '${boton}')]`)
    await b2.click()
    await new Promise((r) => setTimeout(r, 1500))
    const [b3] = await p.$$("xpath/.//button[contains(., 'Aprobar de todas formas')]")
    if (b3) await b3.click()
  }
  if (nivel === "detallado") await pasar(/confirma quién es quién/i, "Aprobar y seguir", "3-quien-es-quien")
  if (nivel !== "rapido") await pasar(/revisa el guion y apruébalo/i, "Aprobar guion", "4-guion")

  await esperarTexto(p, /Te toca: revisar el video/, 90)
  await p.reload({ waitUntil: "networkidle2" })
  const [pVideo] = await p.$$("xpath/.//button[@role='tab' and contains(., 'Video')]")
  await pVideo?.click()
  await new Promise((r) => setTimeout(r, 2000))
  await foto(p, "5-video-listo")
  await p.setViewport({ width: 390, height: 844 })
  await new Promise((r) => setTimeout(r, 1000))
  await foto(p, "6-video-listo-390")
  await b.close()
  console.log(`listo en ${seg()}`)
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
