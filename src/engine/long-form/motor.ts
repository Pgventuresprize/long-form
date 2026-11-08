import { timingSafeEqual } from "node:crypto"

import { supabaseAdmin } from "../supabase-admin"

/**
 * El puente entre Studio y el motor de long form.
 *
 * Studio deja el trabajo en `lf_trabajos` (con `lf_encolar`) y despierta al motor con un POST a
 * `LF_MOTOR_URL/despertar`, protegido con `LF_MOTOR_SECRETO`. El motor (Modal, o `python -m editor servir`
 * en local) vacia la cola, escribe su progreso y sus avisos en la base y encola la siguiente etapa. Si el
 * aviso no llega, el trabajo sigue en la cola y lo toma el proximo despertar.
 */

export type Quien = "motor" | "studio"

export async function encolarEtapa(proyectoId: string, etapa: string, datos: Record<string, unknown> = {}, quien: Quien = "motor"): Promise<number> {
  const { data, error } = await supabaseAdmin().rpc("lf_encolar", { p_proyecto: proyectoId, p_etapa: etapa, p_datos: datos, p_quien: quien })
  if (error) throw new Error(`No se pudo encolar ${etapa}: ${error.message}`)
  if (quien === "motor") await despertarMotor()
  return Number(data)
}

/** No lanza: si el motor no responde, el trabajo espera en la cola. */
export async function despertarMotor(): Promise<boolean> {
  const url = process.env.LF_MOTOR_URL?.trim()
  const secreto = process.env.LF_MOTOR_SECRETO?.trim()
  if (!url || !secreto) return false
  try {
    const r = await fetch(`${url.replace(/\/+$/, "")}/despertar`, {
      method: "POST",
      headers: { authorization: `Bearer ${secreto}`, "content-type": "application/json" },
      body: "{}",
      signal: AbortSignal.timeout(8000),
    })
    return r.ok
  } catch {
    return false
  }
}

/** Para las rutas que llama el motor: el mismo secreto, comparado en tiempo constante. */
export function esElMotor(request: Request): boolean {
  const secreto = process.env.LF_MOTOR_SECRETO?.trim()
  if (!secreto) return false
  const dado = Buffer.from(request.headers.get("authorization") ?? "")
  const esperado = Buffer.from(`Bearer ${secreto}`)
  return dado.length === esperado.length && timingSafeEqual(dado, esperado)
}

/** La cuenta de un proyecto. */
export async function cuentaDelProyecto(proyectoId: string): Promise<string | null> {
  if (!/^[0-9a-f-]{36}$/i.test(proyectoId)) return null
  const { data } = await supabaseAdmin().from("lf_proyectos").select("account_id").eq("id", proyectoId).maybeSingle()
  return (data as { account_id: string } | null)?.account_id ?? null
}
