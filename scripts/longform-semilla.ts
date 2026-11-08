/**
 * Datos de ejemplo de long form, SOLO para el Supabase local.
 *
 *   npx tsx --env-file=.env.local scripts/longform-semilla.ts
 *
 * Crea (o reutiliza) una persona confirmada, administradora de la plataforma, con una marca
 * "Prueba Long-form" y una segunda sin acceso, para ver las pantallas con y sin las banderas.
 * Se niega a correr contra algo que no sea localhost.
 */
import { asegurarConfiguracion, crearEmpresa } from "../src/engine/empresas"
import { supabaseAdmin } from "../src/engine/supabase-admin"

const CORREO = process.env.SEMILLA_CORREO ?? "prueba@studio.local"
const CLAVE = process.env.SEMILLA_CLAVE ?? "prueba-longform-1"

async function main() {
  const url = process.env.SUPABASE_URL ?? ""
  if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(url)) throw new Error(`Solo en local. SUPABASE_URL es ${url || "(vacio)"}`)
  const db = supabaseAdmin()

  const { data: lista } = await db.auth.admin.listUsers({ page: 1, perPage: 200 })
  let usuario = lista?.users.find((u) => u.email === CORREO) ?? null
  if (!usuario) {
    const { data, error } = await db.auth.admin.createUser({ email: CORREO, password: CLAVE, email_confirm: true, user_metadata: { full_name: "Prueba Long-form" } })
    if (error || !data.user) throw new Error(`No se pudo crear la persona: ${error?.message}`)
    usuario = data.user
  }
  await db.from("platform_admins").upsert({ user_id: usuario.id }, { onConflict: "user_id" })

  const marcas: Record<string, string> = {}
  for (const nombre of ["Prueba Long-form", "Otra marca"]) {
    const { data: ya } = await db.from("accounts").select("id").eq("name", nombre).maybeSingle()
    let id = (ya as { id: string } | null)?.id
    if (!id) {
      const r = await crearEmpresa(nombre, "advance", usuario.id)
      if (!r.ok) throw new Error(r.error)
      id = r.id
    }
    await asegurarConfiguracion(id)
    await db.from("accounts").update({ onboarding: "listo", plan: "advance" }).eq("id", id)
    marcas[nombre] = id
  }
  await db.from("brand_profile").upsert({ account_id: marcas["Prueba Long-form"], nombre: "Prueba Long-form", handle: "@prueba.lf" }, { onConflict: "account_id" })
  const ctas = await db.from("content_ctas").select("id", { count: "exact", head: true }).eq("account_id", marcas["Prueba Long-form"])
  if (!ctas.count) {
    await db.from("content_ctas").insert([
      { account_id: marcas["Prueba Long-form"], name: "Únete a la comunidad", description: "Aprende con otras personas que están construyendo con IA.", position: 0 },
      { account_id: marcas["Prueba Long-form"], name: "Agenda una consulta", description: "Conversemos sobre tu negocio.", position: 1 },
    ])
  }

  console.log(JSON.stringify({ correo: CORREO, clave: CLAVE, marcas }, null, 2))
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
