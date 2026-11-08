"use server"

import { revalidatePath } from "next/cache"

import { cambiarCuenta } from "@/app/cuenta/actions"
import { registrarActividad } from "@/engine/admin/actividad"
import { actualizarEmpresa, agregarMiembro, cambiarRol, crearEmpresa, quitarMiembro, reenviarInvitacion, type Rol } from "@/engine/empresas"
import { puedeCrearMarca } from "@/engine/marcas"
import { cuentaActual, exigirOwner } from "@/lib/accounts"
import { supabaseAdmin } from "@/engine/supabase-admin"
import { usuarioActual } from "@/lib/supabase/auth"
import { origenDeLaPeticion } from "@/lib/supabase/origen"

/**
 * La gestion de la empresa abierta (nombre, miembros) y la creacion de empresas
 * nuevas. Gestionar la empresa es cosa de sus owners; crear una empresa nueva lo
 * puede cualquier usuario, y queda como su owner.
 *
 * El plan no se cambia desde aqui: lo decide un administrador en /admin. Si no,
 * cualquier owner podria subirse a Advance solo.
 */

export type Resultado = { ok: true; aviso?: string } | { ok: false; error: string }

async function comoOwner<T>(fn: (accountId: string) => Promise<T>): Promise<T | { ok: false; error: string }> {
  try {
    const cuenta = await exigirOwner()
    return await fn(cuenta.id)
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

async function correoDe(userId: string): Promise<string> {
  const { data } = await supabaseAdmin().auth.admin.getUserById(userId)
  return data.user?.email ?? userId
}

/** Deja constancia de un cambio de accesos hecho por un owner. */
async function anotarAcceso(accion: string, sobre: string, detalle: string, usuarioId?: string) {
  const [cuenta, yo] = await Promise.all([cuentaActual(), usuarioActual()])
  await registrarActividad({
    actor: yo?.email ? { id: yo.id, email: yo.email } : null,
    tipo: "acceso",
    accion,
    sobre,
    accountId: cuenta.id,
    usuarioId,
    detalle: `${detalle} en ${cuenta.name}.`,
  })
}

export async function guardarEmpresa(campos: { name: string }): Promise<Resultado> {
  const r = await comoOwner((id) => actualizarEmpresa(id, { name: campos.name }))
  revalidatePath("/", "layout")
  return r.ok ? { ok: true, aviso: "Empresa guardada." } : r
}

/**
 * Invita por correo. El owner ya no pone contraseña: quien no tiene cuenta la
 * elige desde el enlace de la invitacion, y nadie mas la conoce.
 */
export async function invitarMiembro(email: string, rol: Rol): Promise<Resultado> {
  const volverA = `${await origenDeLaPeticion()}/auth/confirm`
  const r = await comoOwner((id) => agregarMiembro(id, email, rol, volverA))
  revalidatePath("/configuracion/empresa")
  if (!r.ok) return r
  const correo = email.trim().toLowerCase()
  await anotarAcceso("Invitó a un miembro", correo, rol)
  return {
    ok: true,
    aviso:
      "invitado" in r && r.invitado
        ? `Le mandamos una invitación a ${correo}. Desde el enlace elige su contraseña y entra a esta empresa.`
        : `${correo} ya tenía cuenta: ya puede entrar a esta empresa con su contraseña.`,
  }
}

export async function reenviarInvitacionMiembro(userId: string): Promise<Resultado> {
  const volverA = `${await origenDeLaPeticion()}/auth/confirm`
  const r = await comoOwner((id) => reenviarInvitacion(id, userId, volverA))
  if (!r.ok) return r
  return { ok: true, aviso: "email" in r ? `Le volvimos a mandar la invitación a ${r.email}.` : "Invitación reenviada." }
}

export async function cambiarRolMiembro(userId: string, rol: Rol): Promise<Resultado> {
  const r = await comoOwner((id) => cambiarRol(id, userId, rol))
  revalidatePath("/configuracion/empresa")
  if (r.ok) await anotarAcceso("Cambió el rol", await correoDe(userId), rol, userId)
  return r
}

export async function quitarMiembroDeEmpresa(userId: string): Promise<Resultado> {
  const yo = await usuarioActual()
  if (yo?.id === userId) return { ok: false, error: "No puedes quitarte a ti mismo; pídeselo a otro owner." }
  const r = await comoOwner((id) => quitarMiembro(id, userId))
  revalidatePath("/configuracion/empresa")
  if (r.ok) await anotarAcceso("Quitó a un miembro", await correoDe(userId), "Quitado", userId)
  return r
}

/**
 * Toda marca nueva empieza en Basic: subirla a Advance es cosa de un administrador. La primera
 * marca es gratis; desde la segunda hace falta `marcas_multiples` (la misma regla de Mis marcas).
 */
export async function nuevaEmpresa(nombre: string): Promise<Resultado> {
  const yo = await usuarioActual()
  if (!yo) return { ok: false, error: "Sesión caducada: vuelve a entrar." }
  if (!(await puedeCrearMarca(yo.id)).puede) return { ok: false, error: "Crear otra marca está en beta privada. Pide acceso desde Mis marcas." }
  const r = await crearEmpresa(nombre, "basic", yo.id)
  if (!r.ok) return r
  await registrarActividad({ actor: yo.email ? { id: yo.id, email: yo.email } : null, tipo: "plataforma", accion: "Creó una marca", sobre: nombre.trim(), accountId: r.id, detalle: "Marca creada en Basic." })
  // Se abre la marca recien creada.
  await cambiarCuenta(r.slug)
  return { ok: true, aviso: `Marca creada. Ahora estás en ella: conecta sus servicios en Conexiones.` }
}
