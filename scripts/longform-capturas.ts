/**
 * Capturas de las pantallas de long form junto a pantallas de Studio, a 1440 y 390 px, en claro y en
 * oscuro (la clase .dark puesta a mano: Studio no tiene interruptor de tema).
 *
 *   npx tsx scripts/longform-capturas.ts <carpeta> [ruta ...]
 *
 * Necesita `next dev` corriendo en LF_CAPTURAS_URL (por defecto http://localhost:3000), la semilla
 * (scripts/longform-semilla.ts) y Chrome instalado (CHROME o la ruta de siempre en Windows).
 */
import { mkdirSync } from "node:fs"
import path from "node:path"

import puppeteer, { type Page } from "puppeteer-core"

const BASE = process.env.LF_CAPTURAS_URL ?? "http://localhost:3000"
const CHROME = process.env.CHROME ?? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
const CORREO = process.env.SEMILLA_CORREO ?? "prueba@studio.local"
const CLAVE = process.env.SEMILLA_CLAVE ?? "prueba-longform-1"

const [, , carpeta = "capturas", ...rutas] = process.argv
const RUTAS = rutas.length ? rutas : ["/marca?tab=long-form", "/marca?tab=visual", "/marcas", "/long-form", "/admin/funciones"]
const TAMANOS = [
  { nombre: "1440", width: 1440, height: 1000 },
  { nombre: "390", width: 390, height: 844 },
]

async function entrar(p: Page) {
  await p.goto(`${BASE}/login`, { waitUntil: "networkidle2" })
  await p.type("#email", CORREO)
  await p.type("#password", CLAVE)
  // Turnstile con las claves de prueba se resuelve solo; se espera a que deje su respuesta.
  await p.waitForFunction(() => {
    const i = document.querySelector<HTMLInputElement>('input[name="cf-turnstile-response"]')
    return !i || i.value.length > 0
  }, { timeout: 30000 })
  await Promise.all([p.waitForNavigation({ waitUntil: "networkidle2" }), p.click('button[type="submit"][class*="h-12"]')])
}

async function main() {
  mkdirSync(carpeta, { recursive: true })
  const navegador = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox"] })
  const p = await navegador.newPage()
  // En next dev la primera visita a cada ruta compila: puede pasar del minuto.
  p.setDefaultNavigationTimeout(240000)
  p.setDefaultTimeout(240000)
  await p.setViewport({ width: 1440, height: 1000 })
  await entrar(p)
  // LF_CUENTA=<slug> abre esa marca (la cookie solo propone; la pertenencia se comprueba igual).
  if (process.env.LF_CUENTA) await p.setCookie({ name: "hancel_cuenta", value: process.env.LF_CUENTA, url: BASE })
  const hechas: string[] = []
  for (const ruta of RUTAS) {
    for (const t of TAMANOS) {
      await p.setViewport({ width: t.width, height: t.height })
      await p.goto(`${BASE}${ruta}`, { waitUntil: "networkidle2", timeout: 120000 })
      // Las vistas previas se piden al servidor despues de montar: se esperan los iframes.
      await p.waitForFunction(() => document.querySelectorAll("[data-slot=skeleton]").length === 0, { timeout: 60000 }).catch(() => {})
      await new Promise((r) => setTimeout(r, 1500))
      for (const tema of ["claro", "oscuro"] as const) {
        await p.evaluate((oscuro) => document.documentElement.classList.toggle("dark", oscuro), tema === "oscuro")
        await new Promise((r) => setTimeout(r, 300))
        const ancho = await p.evaluate(() => document.documentElement.scrollWidth)
        const nombre = `${ruta.replace(/[^a-z0-9]+/gi, "_").replace(/^_|_$/g, "") || "inicio"}-${t.nombre}-${tema}.png`
        // fullPage no pinta los iframes de la vista previa: se agranda la ventana al alto de la pagina.
        const alto = await p.evaluate(() => document.documentElement.scrollHeight)
        await p.setViewport({ width: t.width, height: Math.min(alto, 6000) })
        await new Promise((r) => setTimeout(r, 600))
        await p.screenshot({ path: path.join(carpeta, nombre) })
        await p.setViewport({ width: t.width, height: t.height })
        hechas.push(`${nombre}${ancho > t.width ? `  (desborda: ${ancho}px)` : ""}`)
      }
    }
  }
  await navegador.close()
  console.log(hechas.join("\n"))
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
