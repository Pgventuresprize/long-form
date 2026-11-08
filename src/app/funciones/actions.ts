"use server"

import { esFuncion, registrarInteres } from "@/engine/funciones"
import { cuentaActual } from "@/lib/accounts"
import { usuarioActual } from "@/lib/supabase/auth"

/** "Quiero acceso" en el paywall de una funcion en beta: queda anotado para el panel. */
export async function quieroAcceso(clave: string): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!esFuncion(clave)) return { ok: false, error: "Esa función no existe." }
  const usuario = await usuarioActual()
  if (!usuario) return { ok: false, error: "Inicia sesión otra vez." }
  const cuenta = await cuentaActual()
  const error = await registrarInteres(cuenta.id, clave, { id: usuario.id, email: usuario.email ?? null })
  return error ? { ok: false, error: "No se pudo anotar. Intenta otra vez." } : { ok: true }
}
