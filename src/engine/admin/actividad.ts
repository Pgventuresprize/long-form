import { supabaseAdmin } from "../supabase-admin"

/**
 * El registro de lo que pasa con las empresas y sus accesos.
 *
 * Vive en el motor y no en el panel porque tambien lo escriben los owners desde
 * Configuracion y el registro de cuentas nuevas. Devuelve si quedo anotado en vez
 * de lanzar: quien llama decide, y el panel avisa si una accion no quedo registrada.
 */

export type TipoActividad = "plan" | "acceso" | "bloqueo" | "plataforma" | "funcion"

export type NuevaActividad = {
  /** Quien lo hizo. Sin actor, lo hizo el sistema. */
  actor?: { id: string; email: string } | null
  tipo: TipoActividad
  accion: string
  sobre: string
  accountId?: string | null
  usuarioId?: string | null
  detalle?: string | null
  motivo?: string | null
}

export async function registrarActividad(a: NuevaActividad): Promise<boolean> {
  try {
    const { error } = await supabaseAdmin()
      .from("admin_actividad")
      .insert({
        actor_id: a.actor?.id ?? null,
        actor: a.actor?.email ?? "Sistema",
        tipo: a.tipo,
        accion: a.accion,
        sobre: a.sobre,
        account_id: a.accountId ?? null,
        usuario_id: a.usuarioId ?? null,
        detalle: a.detalle ?? null,
        motivo: a.motivo ?? null,
      })
    if (error) {
      console.error("[actividad] No se pudo anotar:", error.message)
      return false
    }
    return true
  } catch (e) {
    console.error("[actividad] No se pudo anotar:", e instanceof Error ? e.message : e)
    return false
  }
}
