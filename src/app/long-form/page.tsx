import Link from "next/link"
import { PaletteIcon } from "lucide-react"

import { DashboardShell } from "@/components/dashboard-shell"
import { Paywall } from "@/components/funciones/paywall"
import { TableroLongForm } from "@/components/long-form/tablero"
import { Button } from "@/components/ui/button"
import { tieneFuncion } from "@/engine/funciones"
import { proyectosDe } from "@/engine/long-form/datos"
import { estiloDe } from "@/engine/long-form/estilo-datos"
import { accesoA } from "@/lib/funciones"

export const dynamic = "force-dynamic"

export const metadata = { title: "Long-form · Plogy Studio" }

/**
 * Long-form: de una grabacion larga al video editado y a lo que sale de el. En beta cerrada: sin la funcion
 * se ve el paywall y no se lee nada de la cuenta.
 */
export default async function LongFormPage() {
  const { cuenta, tiene } = await accesoA("long_form")
  if (!tiene) {
    return (
      <DashboardShell title="Long-form">
        <Paywall clave="long_form" accountId={cuenta.id} />
      </DashboardShell>
    )
  }
  const [proyectos, estilo, puedeEstilo] = await Promise.all([proyectosDe(cuenta.id), estiloDe(cuenta.id), tieneFuncion(cuenta.id, "estilo_long_form")])

  if (!estilo?.listo && proyectos.length === 0) {
    return (
      <DashboardShell title="Long-form">
        <div className="mx-auto flex max-w-md flex-col items-center gap-3 py-12 text-center">
          <span className="bg-muted flex size-12 items-center justify-center rounded-xl" aria-hidden>
            <PaletteIcon className="size-6" />
          </span>
          <h2 className="font-display text-2xl">Primero, tu estilo</h2>
          <p className="text-muted-foreground text-sm">
            Los videos salen con la música, los colores, la fuente y los CTA de tu marca. Toma un minuto y lo armamos con lo que ya tienes.
          </p>
          {puedeEstilo ? (
            <Button variant="brand" nativeButton={false} render={<Link href="/marca?tab=long-form" />}>
              Configurar el estilo
            </Button>
          ) : (
            <p className="text-sm">El estilo de long form todavía no está activo para esta marca.</p>
          )}
        </div>
      </DashboardShell>
    )
  }

  return (
    <DashboardShell title="Long-form">
      <TableroLongForm proyectos={proyectos} />
    </DashboardShell>
  )
}
