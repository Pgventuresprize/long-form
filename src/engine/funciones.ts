import { supabaseAdmin } from "./supabase-admin"

/**
 * Banderas de funciones: lo que esta en beta cerrada.
 *
 * Manda, en este orden: la excepcion de la cuenta (`cuenta_funciones`), la bandera global
 * (`platform_funciones`) y, solo si las dos callan, `FUNCIONES_BETA` del entorno, que en local
 * vale `todas` y en produccion no existe. Si las tablas no estan o no responden, la funcion esta
 * apagada: un fallo nunca abre algo que estaba cerrado.
 *
 * No depende de Next: lo usan las paginas, las acciones, las rutas y el puente con el motor.
 */

export const FUNCIONES = ["long_form", "marcas_multiples", "estilo_long_form"] as const
export type Funcion = (typeof FUNCIONES)[number]

export function esFuncion(x: string): x is Funcion {
  return (FUNCIONES as readonly string[]).includes(x)
}

/** `FUNCIONES_BETA=todas` o una lista separada por comas. */
export function funcionesDelEntorno(valor = process.env.FUNCIONES_BETA): Set<Funcion> {
  const limpio = (valor ?? "").trim().toLowerCase()
  if (!limpio) return new Set()
  if (limpio === "todas") return new Set(FUNCIONES)
  return new Set(limpio.split(",").map((s) => s.trim()).filter(esFuncion))
}

export type EstadoFuncion = {
  clave: Funcion
  nombre: string
  descripcion: string
  global: boolean
  /** La excepcion de la cuenta, si la hay. */
  cuenta: boolean | null
  /** Lo que vale de verdad para la cuenta. */
  encendida: boolean
}

type FilaGlobal = { clave: string; nombre: string; descripcion: string; encendida: boolean }
type FilaCuenta = { clave: string; encendida: boolean }

/** Lo que decide, sin base: separado para poder probarlo. */
export function decidir(global: boolean | null, cuenta: boolean | null, entorno: boolean): boolean {
  if (cuenta !== null) return cuenta
  if (global === true) return true
  return entorno
}

/** El estado de las tres banderas para una cuenta. */
export async function funcionesDe(accountId: string): Promise<EstadoFuncion[]> {
  const entorno = funcionesDelEntorno()
  let globales: FilaGlobal[] = []
  let propias: FilaCuenta[] = []
  try {
    const db = supabaseAdmin()
    const [g, c] = await Promise.all([
      db.from("platform_funciones").select("clave, nombre, descripcion, encendida"),
      db.from("cuenta_funciones").select("clave, encendida").eq("account_id", accountId),
    ])
    if (!g.error) globales = (g.data ?? []) as FilaGlobal[]
    if (!c.error) propias = (c.data ?? []) as FilaCuenta[]
  } catch {
    // Sin base no se abre nada: queda solo lo del entorno, que en produccion es nada.
  }
  return FUNCIONES.map((clave) => {
    const g = globales.find((x) => x.clave === clave)
    const c = propias.find((x) => x.clave === clave)
    const cuenta = c ? c.encendida : null
    return {
      clave,
      nombre: g?.nombre ?? clave,
      descripcion: g?.descripcion ?? "",
      global: g?.encendida ?? false,
      cuenta,
      encendida: decidir(g ? g.encendida : null, cuenta, entorno.has(clave)),
    }
  })
}

export async function tieneFuncion(accountId: string, clave: Funcion): Promise<boolean> {
  const estado = await funcionesDe(accountId)
  return estado.find((e) => e.clave === clave)?.encendida ?? false
}

/** Las encendidas, para pintar el sidebar de una vez. */
export async function encendidasDe(accountId: string): Promise<Set<Funcion>> {
  return new Set((await funcionesDe(accountId)).filter((e) => e.encendida).map((e) => e.clave))
}

// ---------------------------------------------------------------- Panel de administracion

export async function cambiarGlobal(clave: Funcion, encendida: boolean): Promise<string | null> {
  const { error } = await supabaseAdmin()
    .from("platform_funciones")
    .update({ encendida, updated_at: new Date().toISOString() })
    .eq("clave", clave)
  return error ? error.message : null
}

/** `null` quita la excepcion y la cuenta vuelve a seguir la global. */
export async function cambiarDeCuenta(
  accountId: string,
  clave: Funcion,
  encendida: boolean | null,
  quien: { id: string; motivo?: string | null },
): Promise<string | null> {
  const db = supabaseAdmin()
  if (encendida === null) {
    const { error } = await db.from("cuenta_funciones").delete().eq("account_id", accountId).eq("clave", clave)
    return error ? error.message : null
  }
  const { error } = await db.from("cuenta_funciones").upsert(
    { account_id: accountId, clave, encendida, por: quien.id, motivo: quien.motivo ?? null, updated_at: new Date().toISOString() },
    { onConflict: "account_id,clave" },
  )
  return error ? error.message : null
}

export type Interes = { id: string; accountId: string; correo: string | null; clave: Funcion; at: string }

export async function registrarInteres(accountId: string, clave: Funcion, usuario: { id: string; email: string | null }): Promise<string | null> {
  const { error } = await supabaseAdmin()
    .from("funcion_interes")
    .upsert({ account_id: accountId, clave, user_id: usuario.id, correo: usuario.email }, { onConflict: "account_id,clave", ignoreDuplicates: true })
  return error ? error.message : null
}

export async function yaPidioAcceso(accountId: string, clave: Funcion): Promise<boolean> {
  const { data, error } = await supabaseAdmin().from("funcion_interes").select("id").eq("account_id", accountId).eq("clave", clave).maybeSingle()
  return !error && data !== null
}

export async function interesados(): Promise<Interes[]> {
  const { data, error } = await supabaseAdmin()
    .from("funcion_interes")
    .select("id, account_id, correo, clave, created_at")
    .order("created_at", { ascending: false })
    .limit(500)
  if (error) return []
  return ((data ?? []) as { id: string; account_id: string; correo: string | null; clave: string; created_at: string }[])
    .filter((f) => esFuncion(f.clave))
    .map((f) => ({ id: f.id, accountId: f.account_id, correo: f.correo, clave: f.clave as Funcion, at: f.created_at }))
}

/** Las excepciones de todas las cuentas, para la pantalla de banderas. */
export async function excepciones(): Promise<{ accountId: string; clave: Funcion; encendida: boolean }[]> {
  const { data, error } = await supabaseAdmin().from("cuenta_funciones").select("account_id, clave, encendida")
  if (error) return []
  return ((data ?? []) as { account_id: string; clave: string; encendida: boolean }[])
    .filter((f) => esFuncion(f.clave))
    .map((f) => ({ accountId: f.account_id, clave: f.clave as Funcion, encendida: f.encendida }))
}
