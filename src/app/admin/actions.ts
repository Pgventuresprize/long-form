"use server"

import { revalidatePath } from "next/cache"

import type { Plan } from "@/engine/accounts"
import { registrarActividad, type NuevaActividad } from "@/engine/admin/actividad"
import { guardarRegistroAbierto } from "@/engine/admin/ajustes"
import { cambiarDeCuenta, cambiarGlobal, esFuncion, type Funcion } from "@/engine/funciones"
import { actualizarEmpresa, agregarMiembro, cambiarRol, crearEmpresa, quitarMiembro, reenviarInvitacion, usuarioPorCorreo, type Rol } from "@/engine/empresas"
import { supabaseAdmin } from "@/engine/supabase-admin"
import { adminActual, type Admin } from "@/lib/admin"
import { origenDeLaPeticion } from "@/lib/supabase/origen"

/**
 * Lo que puede hacer un administrador sobre toda la plataforma.
 *
 * Una accion de servidor se puede llamar sin pasar por la pagina, asi que cada una
 * comprueba por si misma quien la pide. Las que quitan o cambian algo piden motivo,
 * y todas dejan constancia en `admin_actividad`.
 */

export type Resultado = { ok: true; aviso: string } | { ok: false; error: string }

const PLAN: Record<Plan, string> = { basic: "Basic", advance: "Advance" }

/** Un bloqueo sin fecha de fin: Supabase lo pide como duracion. Son cien años. */
const BLOQUEO = "876000h"

const CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const fallo = (error: string): Resultado => ({ ok: false, error })

async function comoAdmin(fn: (yo: Admin) => Promise<Resultado>): Promise<Resultado> {
  const yo = await adminActual()
  if (!yo) return fallo("No tienes permiso para hacer esto.")
  try {
    const r = await fn(yo)
    revalidatePath("/admin", "layout")
    return r
  } catch (e) {
    return fallo(e instanceof Error ? e.message : String(e))
  }
}

/** Anota y responde. Si la accion salio pero no quedo registrada, tiene que saberse. */
async function hecho(yo: Admin, aviso: string, a: Omit<NuevaActividad, "actor">): Promise<Resultado> {
  const anotado = await registrarActividad({ ...a, actor: yo })
  return { ok: true, aviso: anotado ? aviso : `${aviso} Ojo: no quedó anotado en la actividad.` }
}

function motivoValido(motivo: string): string | null {
  const limpio = motivo.trim()
  return limpio.length >= 3 ? limpio : null
}

async function empresa(accountId: string): Promise<{ name: string; plan: Plan; suspendida_en: string | null } | null> {
  const { data } = await supabaseAdmin().from("accounts").select("name, plan, suspendida_en").eq("id", accountId).maybeSingle()
  return data as { name: string; plan: Plan; suspendida_en: string | null } | null
}

async function correoDe(userId: string): Promise<string | null> {
  const { data } = await supabaseAdmin().auth.admin.getUserById(userId)
  return data.user?.email ?? null
}

async function volverA(): Promise<string> {
  return `${await origenDeLaPeticion()}/auth/confirm`
}

// ------------------------------------------------------------------- Empresas

export async function cambiarPlan(accountId: string, plan: Plan, motivo: string): Promise<Resultado> {
  return comoAdmin(async (yo) => {
    const m = motivoValido(motivo)
    if (!m) return fallo("Escribe el motivo.")
    const e = await empresa(accountId)
    if (!e) return fallo("Esa empresa no existe.")
    if (e.plan === plan) return fallo(`${e.name} ya está en ${PLAN[plan]}.`)
    const r = await actualizarEmpresa(accountId, { plan })
    if (!r.ok) return r.error ? fallo(r.error) : fallo("No se pudo cambiar el plan.")
    return hecho(yo, `${e.name} ahora está en ${PLAN[plan]}.`, {
      tipo: "plan",
      accion: "Cambió el plan",
      sobre: e.name,
      accountId,
      detalle: `${PLAN[e.plan]} → ${PLAN[plan]}`,
      motivo: m,
    })
  })
}

export async function suspenderEmpresa(accountId: string, motivo: string): Promise<Resultado> {
  return comoAdmin(async (yo) => {
    const m = motivoValido(motivo)
    if (!m) return fallo("Escribe el motivo.")
    const e = await empresa(accountId)
    if (!e) return fallo("Esa empresa no existe.")
    if (e.suspendida_en) return fallo(`${e.name} ya está suspendida.`)
    const { error } = await supabaseAdmin()
      .from("accounts")
      .update({ suspendida_en: new Date().toISOString(), suspension_motivo: m })
      .eq("id", accountId)
    if (error) return fallo(`No se pudo suspender: ${error.message}`)
    return hecho(yo, `${e.name} quedó suspendida.`, { tipo: "bloqueo", accion: "Suspendió la empresa", sobre: e.name, accountId, motivo: m })
  })
}

export async function reactivarEmpresa(accountId: string, motivo: string): Promise<Resultado> {
  return comoAdmin(async (yo) => {
    const m = motivoValido(motivo)
    if (!m) return fallo("Escribe el motivo.")
    const e = await empresa(accountId)
    if (!e) return fallo("Esa empresa no existe.")
    const { error } = await supabaseAdmin().from("accounts").update({ suspendida_en: null, suspension_motivo: null }).eq("id", accountId)
    if (error) return fallo(`No se pudo reactivar: ${error.message}`)
    return hecho(yo, `${e.name} volvió a estar activa.`, { tipo: "bloqueo", accion: "Reactivó la empresa", sobre: e.name, accountId, motivo: m })
  })
}

/** Una empresa para un cliente: su owner queda por correo, con invitacion si no tiene cuenta. */
export async function crearEmpresaPanel(nombre: string, plan: Plan, correoOwner: string): Promise<Resultado> {
  return comoAdmin(async (yo) => {
    const correo = correoOwner.trim().toLowerCase()
    if (!CORREO.test(correo)) return fallo("Ese correo no es válido.")
    let owner = await usuarioPorCorreo(correo)
    let invitado = false
    if (!owner) {
      const { data, error } = await supabaseAdmin().auth.admin.inviteUserByEmail(correo, { redirectTo: await volverA() })
      if (error || !data.user) return fallo(`No se pudo mandar la invitación: ${error?.message ?? "sin respuesta"}`)
      owner = { id: data.user.id }
      invitado = true
    }
    const r = await crearEmpresa(nombre, plan, owner.id)
    if (!r.ok) return r
    return hecho(yo, invitado ? `Empresa creada. Le mandamos una invitación a ${correo}.` : `Empresa creada. ${correo} ya puede entrar.`, {
      tipo: "acceso",
      accion: "Creó la empresa",
      sobre: nombre.trim(),
      accountId: r.id,
      usuarioId: owner.id,
      detalle: `${PLAN[plan]}, owner ${correo}`,
    })
  })
}

// ------------------------------------------------------------------- Accesos

export async function darAcceso(accountId: string, correoUsuario: string, rol: Rol): Promise<Resultado> {
  return comoAdmin(async (yo) => {
    const e = await empresa(accountId)
    if (!e) return fallo("Esa empresa no existe.")
    const correo = correoUsuario.trim().toLowerCase()
    // agregarMiembro le pisa el rol a quien ya esta: podria dejar la empresa sin owner.
    const existente = await usuarioPorCorreo(correo)
    if (existente) {
      const { data } = await supabaseAdmin().from("account_members").select("user_id").eq("account_id", accountId).eq("user_id", existente.id).maybeSingle()
      if (data) return fallo(`${correo} ya es miembro de ${e.name}. Para cambiarle el rol, usa su fila.`)
    }
    const r = await agregarMiembro(accountId, correo, rol, await volverA())
    if (!r.ok) return fallo(r.error)
    return hecho(yo, r.invitado ? `Le mandamos una invitación a ${correo}.` : `${correo} ya puede entrar a ${e.name}.`, {
      tipo: "acceso",
      accion: "Dio acceso",
      sobre: correo,
      accountId,
      detalle: `${rol} en ${e.name}`,
    })
  })
}

export async function cambiarRolPanel(accountId: string, userId: string, rol: Rol): Promise<Resultado> {
  return comoAdmin(async (yo) => {
    const e = await empresa(accountId)
    if (!e) return fallo("Esa empresa no existe.")
    const r = await cambiarRol(accountId, userId, rol)
    if (!r.ok) return fallo(r.error)
    return hecho(yo, "Rol actualizado.", {
      tipo: "acceso",
      accion: "Cambió el rol",
      sobre: (await correoDe(userId)) ?? userId,
      accountId,
      usuarioId: userId,
      detalle: `${rol} en ${e.name}`,
    })
  })
}

export async function quitarAcceso(accountId: string, userId: string, motivo: string): Promise<Resultado> {
  return comoAdmin(async (yo) => {
    const m = motivoValido(motivo)
    if (!m) return fallo("Escribe el motivo.")
    const e = await empresa(accountId)
    if (!e) return fallo("Esa empresa no existe.")
    const r = await quitarMiembro(accountId, userId)
    if (!r.ok) return fallo(r.error)
    return hecho(yo, `Se le quitó el acceso a ${e.name}.`, {
      tipo: "acceso",
      accion: "Quitó el acceso",
      sobre: (await correoDe(userId)) ?? userId,
      accountId,
      usuarioId: userId,
      detalle: `De ${e.name}`,
      motivo: m,
    })
  })
}

export async function reenviarInvitacionPanel(accountId: string, userId: string): Promise<Resultado> {
  return comoAdmin(async () => {
    const r = await reenviarInvitacion(accountId, userId, await volverA())
    return r.ok ? { ok: true, aviso: `Le volvimos a mandar la invitación a ${r.email}.` } : fallo(r.error)
  })
}

// ------------------------------------------------------------------- Usuarios

export async function bloquearUsuario(userId: string, motivo: string): Promise<Resultado> {
  return comoAdmin(async (yo) => {
    if (userId === yo.id) return fallo("No puedes bloquearte a ti mismo.")
    const m = motivoValido(motivo)
    if (!m) return fallo("Escribe el motivo.")
    const correo = await correoDe(userId)
    if (!correo) return fallo("Ese usuario no existe.")
    const supabase = supabaseAdmin()
    const { error } = await supabase.auth.admin.updateUserById(userId, { ban_duration: BLOQUEO })
    if (error) return fallo(`No se pudo bloquear: ${error.message}`)
    // El bloqueo ya cierra la puerta (ver `usuarioActual`); esto ademas borra sus sesiones.
    await supabase.rpc("admin_cerrar_sesiones", { p_usuario: userId })
    return hecho(yo, `${correo} quedó bloqueado.`, { tipo: "bloqueo", accion: "Bloqueó al usuario", sobre: correo, usuarioId: userId, motivo: m })
  })
}

export async function desbloquearUsuario(userId: string, motivo: string): Promise<Resultado> {
  return comoAdmin(async (yo) => {
    const m = motivoValido(motivo)
    if (!m) return fallo("Escribe el motivo.")
    const correo = await correoDe(userId)
    if (!correo) return fallo("Ese usuario no existe.")
    const { error } = await supabaseAdmin().auth.admin.updateUserById(userId, { ban_duration: "none" })
    if (error) return fallo(`No se pudo desbloquear: ${error.message}`)
    return hecho(yo, `${correo} ya puede entrar.`, { tipo: "bloqueo", accion: "Desbloqueó al usuario", sobre: correo, usuarioId: userId, motivo: m })
  })
}

export async function cerrarSesionesUsuario(userId: string): Promise<Resultado> {
  return comoAdmin(async (yo) => {
    if (userId === yo.id) return fallo("Para cerrar tu sesión usa el menú de tu cuenta.")
    const correo = await correoDe(userId)
    if (!correo) return fallo("Ese usuario no existe.")
    const { error } = await supabaseAdmin().rpc("admin_cerrar_sesiones", { p_usuario: userId })
    if (error) return fallo(`No se pudieron cerrar: ${error.message}`)
    return hecho(yo, `Se cerraron las sesiones de ${correo}.`, { tipo: "acceso", accion: "Cerró las sesiones", sobre: correo, usuarioId: userId })
  })
}

/** Le manda el enlace para que elija su contraseña. Nadie ve ni toca la que tiene. */
export async function enviarEnlaceContrasena(userId: string): Promise<Resultado> {
  return comoAdmin(async (yo) => {
    const correo = await correoDe(userId)
    if (!correo) return fallo("Ese usuario no existe.")
    const { error } = await supabaseAdmin().auth.resetPasswordForEmail(correo, { redirectTo: await volverA() })
    if (error) return fallo(error.status === 429 ? "Ya se pidió uno hace poco. Espera un minuto." : `No se pudo mandar: ${error.message}`)
    return hecho(yo, `Le mandamos un enlace a ${correo}.`, { tipo: "acceso", accion: "Envió enlace de contraseña", sobre: correo, usuarioId: userId })
  })
}

// ------------------------------------------------------------- Administradores

export async function nombrarAdmin(correoUsuario: string): Promise<Resultado> {
  return comoAdmin(async (yo) => {
    const correo = correoUsuario.trim().toLowerCase()
    if (!CORREO.test(correo)) return fallo("Ese correo no es válido.")
    const usuario = await usuarioPorCorreo(correo)
    if (!usuario) return fallo("Ese correo no tiene cuenta en el Studio.")
    const { error } = await supabaseAdmin()
      .from("platform_admins")
      .upsert({ user_id: usuario.id, nombrado_por: yo.id }, { onConflict: "user_id", ignoreDuplicates: true })
    if (error) return fallo(`No se pudo nombrar: ${error.message}`)
    return hecho(yo, `${correo} ya entra a este panel.`, { tipo: "acceso", accion: "Nombró administrador", sobre: correo, usuarioId: usuario.id })
  })
}

export async function quitarAdmin(userId: string, motivo: string): Promise<Resultado> {
  return comoAdmin(async (yo) => {
    if (userId === yo.id) return fallo("No puedes quitarte a ti mismo: pídeselo a otro administrador.")
    const m = motivoValido(motivo)
    if (!m) return fallo("Escribe el motivo.")
    const supabase = supabaseAdmin()
    const correo = (await correoDe(userId)) ?? userId
    const { error } = await supabase.from("platform_admins").delete().eq("user_id", userId)
    if (error) return fallo(`No se pudo quitar: ${error.message}`)
    return hecho(yo, `${correo} ya no entra a este panel.`, { tipo: "acceso", accion: "Quitó administrador", sobre: correo, usuarioId: userId, motivo: m })
  })
}

export async function cambiarRegistro(abierto: boolean): Promise<Resultado> {
  return comoAdmin(async (yo) => {
    const r = await guardarRegistroAbierto(abierto)
    if (!r.ok) return fallo(`No se pudo guardar: ${r.error}`)
    return hecho(yo, abierto ? "Registro abierto." : "Ahora solo se entra por invitación.", {
      tipo: "plataforma",
      accion: abierto ? "Abrió el registro" : "Cerró el registro",
      sobre: "Plataforma",
    })
  })
}

// ------------------------------------------------------------ Funciones en beta

const NOMBRE_FUNCION: Record<Funcion, string> = {
  long_form: "Long-form",
  marcas_multiples: "Marcas múltiples",
  estilo_long_form: "Estilo long form",
}

/** Encender o apagar una funcion para todas las empresas. Pide motivo: llega a todos. */
export async function cambiarFuncionGlobal(clave: string, encendida: boolean, motivo: string): Promise<Resultado> {
  return comoAdmin(async (yo) => {
    if (!esFuncion(clave)) return fallo("Esa función no existe.")
    const m = motivoValido(motivo)
    if (!m) return fallo("Escribe el motivo.")
    const error = await cambiarGlobal(clave, encendida)
    if (error) return fallo(`No se pudo guardar: ${error}`)
    return hecho(yo, `${NOMBRE_FUNCION[clave]} ${encendida ? "encendida" : "apagada"} para todas las empresas.`, {
      tipo: "funcion",
      accion: encendida ? "Encendió una función para todos" : "Apagó una función para todos",
      sobre: NOMBRE_FUNCION[clave],
      motivo: m,
    })
  })
}

/**
 * La excepcion de una empresa: `si`, `no` o `global` (quitar la excepcion y seguir lo de todos).
 * Dar acceso no pide motivo; quitarlo si.
 */
export async function cambiarFuncionEmpresa(accountId: string, clave: string, valor: "si" | "no" | "global", motivo = ""): Promise<Resultado> {
  return comoAdmin(async (yo) => {
    if (!esFuncion(clave)) return fallo("Esa función no existe.")
    const e = await empresa(accountId)
    if (!e) return fallo("Esa empresa no existe.")
    const m = motivo.trim() || null
    if (valor === "no" && !motivoValido(motivo)) return fallo("Escribe el motivo.")
    const error = await cambiarDeCuenta(accountId, clave, valor === "global" ? null : valor === "si", { id: yo.id, motivo: m })
    if (error) return fallo(`No se pudo guardar: ${error}`)
    const texto = valor === "si" ? "ya tiene" : valor === "no" ? "ya no tiene" : "sigue lo de todos en"
    return hecho(yo, `${e.name} ${texto} ${NOMBRE_FUNCION[clave]}.`, {
      tipo: "funcion",
      accion: valor === "si" ? "Dio acceso a una función" : valor === "no" ? "Quitó acceso a una función" : "Quitó la excepción de una función",
      sobre: e.name,
      accountId,
      detalle: NOMBRE_FUNCION[clave],
      motivo: m,
    })
  })
}
