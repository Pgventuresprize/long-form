import { redirect } from "next/navigation"

import { DashboardShell } from "@/components/dashboard-shell"
import { Paywall } from "@/components/funciones/paywall"
import { CrearMarca } from "@/components/marcas/crear-marca"
import { ListaMarcas } from "@/components/marcas/lista-marcas"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { puedeCrearMarca, tieneClaude } from "@/engine/marcas"
import { cuentaActual, cuentasDelUsuario } from "@/lib/accounts"
import { usuarioActual } from "@/lib/supabase/auth"

export const dynamic = "force-dynamic"

export const metadata = { title: "Mis marcas · Plogy Studio" }

/**
 * Mis marcas: las marcas de la persona, cambiar entre ellas y crear una nueva. La primera marca es
 * gratis; desde la segunda, sin marcas_multiples, en lugar del formulario sale el paywall.
 */
export default async function MarcasPage() {
  const yo = await usuarioActual()
  if (!yo) redirect("/login")
  const [cuenta, cuentas, permiso] = await Promise.all([cuentaActual(), cuentasDelUsuario(), puedeCrearMarca(yo.id)])
  const propias = cuentas.filter((c) => c.rol === "owner" && !c.suspendida_en)
  const conClaude = await Promise.all(propias.map(async (c) => ({ id: c.id, nombre: c.name, claude: await tieneClaude(c.id) })))

  return (
    <DashboardShell title="Mis marcas">
      <div className="flex max-w-3xl flex-col gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Tus marcas</CardTitle>
            <CardDescription>Cada marca tiene su voz, sus pilares, su kit y sus redes. Cambia de una a otra cuando quieras.</CardDescription>
          </CardHeader>
          <CardContent>
            <ListaMarcas actual={cuenta.id} marcas={cuentas.map((c) => ({ id: c.id, slug: c.slug, nombre: c.name, rol: c.rol, plan: c.plan, suspendida: Boolean(c.suspendida_en) }))} />
          </CardContent>
        </Card>

        {permiso.puede ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Crear marca</CardTitle>
              <CardDescription>Quedas como owner y al crearla pasas por el inicio de la marca para dejarla lista.</CardDescription>
            </CardHeader>
            <CardContent>
              <CrearMarca origenes={conClaude} />
            </CardContent>
          </Card>
        ) : (
          <Paywall clave="marcas_multiples" accountId={cuenta.id} />
        )}
      </div>
    </DashboardShell>
  )
}
