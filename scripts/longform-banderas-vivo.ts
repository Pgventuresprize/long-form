/**
 * Con las banderas apagadas para las marcas de prueba, cada pantalla nueva muestra el paywall y no
 * sus datos. Solo contra el Supabase local y con `next dev` corriendo.
 *
 *   npx tsx --env-file=.env.local scripts/longform-banderas-vivo.ts
 *
 * Apaga las tres banderas como excepcion de las marcas de la semilla, revisa y las deja como estaban.
 */
import puppeteer, { type Page } from "puppeteer-core"

import { supabaseAdmin } from "../src/engine/supabase-admin"

const BASE = process.env.LF_CAPTURAS_URL ?? "http://localhost:3000"
const CHROME = process.env.CHROME ?? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
const CORREO = process.env.SEMILLA_CORREO ?? "prueba@studio.local"
const CLAVE = process.env.SEMILLA_CLAVE ?? "prueba-longform-1"

const PANTALLAS: { ruta: string; debe: RegExp; noDebe?: RegExp }[] = [
  { ruta: "/long-form", debe: /Beta privada/, noDebe: /Todavía no hay videos/ },
  { ruta: "/marca?tab=long-form", debe: /Beta privada/, noDebe: /Guardar estilo|Tu estilo para videos largos/ },
  { ruta: "/marcas", debe: /Beta privada/, noDebe: /Nombre de la marca/ },
]

async function entrar(p: Page) {
  await p.goto(`${BASE}/login`, { waitUntil: "networkidle2" })
  await p.type("#email", CORREO)
  await p.type("#password", CLAVE)
  await p.waitForFunction(() => {
    const i = document.querySelector<HTMLInputElement>('input[name="cf-turnstile-response"]')
    return !i || i.value.length > 0
  })
  await p.click('button[type="submit"][class*="h-12"]')
  await p.waitForFunction(() => location.pathname !== "/login", { timeout: 120000 })
}

async function main() {
  const url = process.env.SUPABASE_URL ?? ""
  if (!/^http:\/\/(127\.0\.0\.1|localhost)/.test(url)) throw new Error("Solo en local.")
  const db = supabaseAdmin()
  const { data: usuarios } = await db.auth.admin.listUsers({ page: 1, perPage: 200 })
  const yo = usuarios?.users.find((u) => u.email === CORREO)
  if (!yo) throw new Error("Corre antes scripts/longform-semilla.ts")
  const { data: miembros } = await db.from("account_members").select("account_id").eq("user_id", yo.id)
  const cuentas = ((miembros ?? []) as { account_id: string }[]).map((m) => m.account_id)
  const filas = cuentas.flatMap((id) => ["long_form", "marcas_multiples", "estilo_long_form"].map((clave) => ({ account_id: id, clave, encendida: false })))
  await db.from("cuenta_funciones").upsert(filas, { onConflict: "account_id,clave" })

  const fallos: string[] = []
  const b = await puppeteer.launch({ executablePath: CHROME, headless: true })
  try {
    const p = await b.newPage()
    p.setDefaultNavigationTimeout(240000)
    p.setDefaultTimeout(240000)
    await entrar(p)
    for (const s of PANTALLAS) {
      await p.goto(`${BASE}${s.ruta}`, { waitUntil: "networkidle2" })
      const texto = await p.evaluate(() => document.body.innerText)
      if (!s.debe.test(texto)) fallos.push(`${s.ruta}: no muestra el paywall`)
      if (s.noDebe?.test(texto)) fallos.push(`${s.ruta}: muestra lo que esta en beta`)
    }
    // El candado en el sidebar.
    const candado = await p.evaluate(() => [...document.querySelectorAll("a")].some((a) => a.textContent?.includes("Long-form") && a.textContent.includes("beta privada")))
    if (!candado) fallos.push("sidebar: Long-form sin candado")
  } finally {
    await b.close()
    await db.from("cuenta_funciones").delete().in("account_id", cuentas)
  }
  if (fallos.length) {
    console.error(fallos.join("\n"))
    process.exit(1)
  }
  console.log(`Banderas apagadas: ${PANTALLAS.length} pantallas con paywall y el candado en el sidebar.`)
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
