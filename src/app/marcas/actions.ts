"use server"

import { revalidatePath } from "next/cache"

import { cambiarCuenta } from "@/app/cuenta/actions"
import { registrarActividad } from "@/engine/admin/actividad"
import { crearEmpresa } from "@/engine/empresas"
import { copiarComun, copiarConexionClaude, marcasPropias, puedeCrearMarca } from "@/engine/marcas"
import { supabaseAdmin } from "@/engine/supabase-admin"
import { usuarioActual } from "@/lib/supabase/auth"

export type ResultadoMarca =
  | { ok: true; aviso: string; destino: string }
  | { ok: false; error: string; paywall?: boolean }

/**
 * Crear una marca: su cuenta, su membresia de owner y su configuracion (el mismo `crearEmpresa`
 * del registro). La primera es gratis; desde la segunda, sin `marcas_multiples`, la respuesta pide
 * el paywall. Opcional: copiar lo comun y la conexion de Claude de una marca donde se es owner.
 * La marca nueva queda pendiente de onboarding y se abre en /empezar.
 */
export async function crearMarca(datos: { nombre: string; copiarDe?: string | null; claude?: boolean }): Promise<ResultadoMarca> {
  const yo = await usuarioActual()
  if (!yo) return { ok: false, error: "Tu sesión se cerró. Vuelve a entrar." }

  const permiso = await puedeCrearMarca(yo.id)
  if (!permiso.puede) return { ok: false, error: "Crear otra marca está en beta privada.", paywall: true }

  const origen = datos.copiarDe?.trim() || null
  if (origen && !(await marcasPropias(yo.id)).includes(origen)) {
    return { ok: false, error: "Solo puedes copiar de una marca donde eres owner." }
  }

  const r = await crearEmpresa(datos.nombre, "basic", yo.id)
  if (!r.ok) return { ok: false, error: r.error.replace("la empresa", "la marca") }

  const avisos: string[] = []
  if (origen) avisos.push(...(await copiarComun(origen, r.id)).avisos)
  if (origen && datos.claude) {
    const e = await copiarConexionClaude(origen, r.id)
    if (e) avisos.push(`Claude: ${e}`)
  }
  // El onboarding corre para la marca nueva aunque el registro lo tenga apagado: se entra a
  // /empezar al crearla. Lo copiado ya esta en sus tablas, asi que el Estratega lo encuentra.
  await supabaseAdmin().from("accounts").update({ onboarding: "pendiente" }).eq("id", r.id)

  await registrarActividad({
    actor: yo.email ? { id: yo.id, email: yo.email } : null,
    tipo: "plataforma",
    accion: "Creó una marca",
    sobre: datos.nombre.trim(),
    accountId: r.id,
    detalle: origen ? "Con lo común copiado de otra marca." : "Marca nueva, vacía.",
  })
  await cambiarCuenta(r.slug)
  revalidatePath("/", "layout")

  const aviso = avisos.length ? `Marca creada. Algunas cosas no se copiaron: ${avisos.join(" ")}` : "Marca creada."
  return { ok: true, aviso, destino: "/empezar" }
}
