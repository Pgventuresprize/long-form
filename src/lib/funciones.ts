import "server-only"

import { cookies } from "next/headers"

import { encendidasDe, tieneFuncion, type Funcion } from "@/engine/funciones"
import { COOKIE_CUENTA, cuentaActual, cuentasDelUsuario, type CuentaConRol } from "@/lib/accounts"
import { usuarioActual } from "@/lib/supabase/auth"

/**
 * Las banderas desde la interfaz. Se comprueban aqui, en el servidor, en cada pagina, accion y
 * ruta nueva: esconder un boton no cierra nada.
 */

export const BETA_CERRADA = "Esta función está en beta privada."

/** Para una pagina: la cuenta y si tiene la funcion. Sin ella, la pagina pinta el paywall. */
export async function accesoA(clave: Funcion): Promise<{ cuenta: CuentaConRol; tiene: boolean }> {
  const cuenta = await cuentaActual()
  return { cuenta, tiene: await tieneFuncion(cuenta.id, clave) }
}

/** Para una accion de servidor: el id de la cuenta, o lanza si no tiene la funcion. */
export async function idDeCuentaCon(clave: Funcion): Promise<string> {
  const cuenta = await cuentaActual()
  if (!(await tieneFuncion(cuenta.id, clave))) throw new Error(BETA_CERRADA)
  return cuenta.id
}

/**
 * Para una ruta de API: la cuenta si hay sesion, pertenece y tiene la funcion; si no, `null` y la
 * ruta responde 404 sin datos. No redirige, porque una ruta no es una pagina.
 */
export async function cuentaDeRutaCon(clave: Funcion): Promise<CuentaConRol | null> {
  const usuario = await usuarioActual()
  if (!usuario) return null
  const cuentas = await cuentasDelUsuario()
  if (cuentas.length === 0) return null
  // La misma eleccion que cuentaActual, sin sus redirecciones.
  const elegida = (await cookies()).get(COOKIE_CUENTA)?.value
  const cuenta = cuentas.find((c) => c.slug === elegida) ?? cuentas.find((c) => !c.suspendida_en) ?? cuentas[0]
  if (cuenta.suspendida_en) return null
  return (await tieneFuncion(cuenta.id, clave)) ? cuenta : null
}

/** Las encendidas de la cuenta activa, para el sidebar y el menu del chat. */
export async function funcionesEncendidas(accountId: string): Promise<Funcion[]> {
  return [...(await encendidasDe(accountId))]
}
