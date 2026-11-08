/**
 * La cola de long form (lf_encolar, lf_reclamar, lf_latido, lf_terminar) contra el Supabase local.
 * Sin base local, se salta.
 *
 *   node --env-file=.env.local --import tsx --test scripts/longform-cola.test.ts
 */
import assert from "node:assert/strict"
import { after, before, test } from "node:test"

import { supabaseAdmin } from "../src/engine/supabase-admin"

const LOCAL = /^http:\/\/(127\.0\.0\.1|localhost)/.test(process.env.SUPABASE_URL ?? "")
const db = LOCAL ? supabaseAdmin() : null
let cuenta = ""
let p1 = ""
let p2 = ""

async function rpc<T>(nombre: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await db!.rpc(nombre, args)
  if (error) throw new Error(error.message)
  return data as T
}

before(async () => {
  if (!db) return
  const { data } = await db.from("accounts").insert({ name: "Cola de prueba", slug: `cola-${Date.now()}`, plan: "basic" }).select("id").single()
  cuenta = (data as { id: string }).id
  const filas = await db.from("lf_proyectos").insert([{ account_id: cuenta, titulo: "Uno" }, { account_id: cuenta, titulo: "Dos" }]).select("id")
  ;[p1, p2] = ((filas.data ?? []) as { id: string }[]).map((f) => f.id)
  // Que ningun otro trabajo de la base se cuele en esta prueba.
  await db.from("lf_trabajos").update({ estado: "cancelado" }).in("estado", ["pendiente", "corriendo"])
})

after(async () => {
  if (db && cuenta) await db.from("accounts").delete().eq("id", cuenta)
})

test("encolar no duplica una etapa pendiente", { skip: !LOCAL }, async () => {
  const a = await rpc<number>("lf_encolar", { p_proyecto: p1, p_etapa: "ingesta" })
  const b = await rpc<number>("lf_encolar", { p_proyecto: p1, p_etapa: "ingesta" })
  assert.equal(a, b)
})

test("un proyecto nunca corre dos etapas a la vez", { skip: !LOCAL }, async () => {
  await rpc("lf_encolar", { p_proyecto: p1, p_etapa: "analisis" })
  await rpc("lf_encolar", { p_proyecto: p2, p_etapa: "ingesta" })
  const t1 = (await rpc<{ proyecto_id: string; id: number }[]>("lf_reclamar", { p_worker: "a" }))[0]
  const t2 = (await rpc<{ proyecto_id: string; id: number }[]>("lf_reclamar", { p_worker: "b" }))[0]
  assert.equal(t1.proyecto_id, p1)
  assert.equal(t2.proyecto_id, p2, "el segundo toma otro proyecto, no la etapa siguiente del primero")
  const t3 = await rpc<unknown[]>("lf_reclamar", { p_worker: "c" })
  assert.equal(t3.length, 0)
  await rpc("lf_terminar", { p_trabajo: t1.id, p_ok: true, p_costo: { segundos: 3 } })
  await rpc("lf_terminar", { p_trabajo: t2.id, p_ok: true })
  const { data } = await db!.from("lf_trabajos").select("estado, costo").eq("id", t1.id).single()
  assert.deepEqual(data, { estado: "hecho", costo: { segundos: 3 } })
})

test("un turno vencido vuelve a la cola y a los tres intentos queda en error", { skip: !LOCAL }, async () => {
  const t = (await rpc<{ id: number }[]>("lf_reclamar", { p_worker: "a", p_lease_seg: 0 }))[0]
  assert.ok(t, "toma la etapa pendiente del primer proyecto")
  for (let i = 0; i < 2; i++) {
    const otra = (await rpc<{ id: number }[]>("lf_reclamar", { p_worker: "b", p_lease_seg: 0 }))[0]
    assert.equal(otra?.id, t.id)
  }
  await rpc("lf_reclamar", { p_worker: "c", p_lease_seg: 0 })
  const { data } = await db!.from("lf_trabajos").select("estado, intentos").eq("id", t.id).single()
  assert.equal((data as { estado: string }).estado, "error")
})

test("Studio y el motor no se toman los trabajos", { skip: !LOCAL }, async () => {
  await rpc("lf_encolar", { p_proyecto: p2, p_etapa: "ideas", p_quien: "studio" })
  assert.equal((await rpc<unknown[]>("lf_reclamar", { p_worker: "m", p_quien: "motor" })).length, 0)
  const s = (await rpc<{ etapa: string; id: number }[]>("lf_reclamar", { p_worker: "s", p_quien: "studio" }))[0]
  assert.equal(s.etapa, "ideas")
  await rpc("lf_terminar", { p_trabajo: s.id, p_ok: true })
})

test("una cuenta suspendida espera", { skip: !LOCAL }, async () => {
  await db!.from("accounts").update({ suspendida_en: new Date().toISOString() }).eq("id", cuenta)
  await rpc("lf_encolar", { p_proyecto: p2, p_etapa: "plan" })
  assert.equal((await rpc<unknown[]>("lf_reclamar", { p_worker: "m" })).length, 0)
  await db!.from("accounts").update({ suspendida_en: null }).eq("id", cuenta)
  const t = (await rpc<{ etapa: string }[]>("lf_reclamar", { p_worker: "m" }))[0]
  assert.equal(t.etapa, "plan")
})

test("las funciones de la cola no se pueden llamar con la clave publica", { skip: !LOCAL }, async () => {
  const r = await fetch(`${process.env.SUPABASE_URL}/rest/v1/rpc/lf_reclamar`, {
    method: "POST",
    headers: { apikey: process.env.SUPABASE_PUBLISHABLE_KEY!, "content-type": "application/json" },
    body: JSON.stringify({ p_worker: "intruso" }),
  })
  assert.ok(r.status === 401 || r.status === 403 || r.status === 404, `respondio ${r.status}`)
})
