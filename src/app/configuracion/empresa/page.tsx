import { DashboardShell } from "@/components/dashboard-shell"
import { EmpresaAdmin } from "@/components/configuracion/empresa-admin"
import { miembrosDe } from "@/engine/empresas"
import { puedeCrearMarca } from "@/engine/marcas"
import { cuentaActual, cuentasDelUsuario } from "@/lib/accounts"
import { usuarioActual } from "@/lib/supabase/auth"

export const dynamic = "force-dynamic"

export const metadata = { title: "Empresa · Plogy Studio" }

/**
 * La empresa abierta: su nombre, su plan (basic o advance) y sus miembros, y
 * la creacion de empresas nuevas.
 */
export default async function EmpresaPage() {
  const [cuenta, cuentas, yo] = await Promise.all([cuentaActual(), cuentasDelUsuario(), usuarioActual()])
  const [miembros, permiso] = await Promise.all([miembrosDe(cuenta.id), yo ? puedeCrearMarca(yo.id) : Promise.resolve({ puede: false as const })])
  return (
    <DashboardShell title="Empresa">
      <EmpresaAdmin
        empresa={{ name: cuenta.name, plan: cuenta.plan, slug: cuenta.slug }}
        esOwner={cuenta.rol === "owner"}
        miembros={miembros}
        yo={yo?.id ?? ""}
        empresas={cuentas.map((c) => ({ name: c.name, plan: c.plan, rol: c.rol }))}
        puedeCrear={permiso.puede}
      />
    </DashboardShell>
  )
}
