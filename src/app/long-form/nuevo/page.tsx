import { redirect } from "next/navigation"

import { DashboardShell } from "@/components/dashboard-shell"
import { Paywall } from "@/components/funciones/paywall"
import { NuevoVideo } from "@/components/long-form/nuevo-video"
import { estiloDe } from "@/engine/long-form/estilo-datos"
import { accesoA } from "@/lib/funciones"

export const dynamic = "force-dynamic"

export const metadata = { title: "Nuevo video · Long-form · Plogy Studio" }

export default async function NuevoVideoPage() {
  const { cuenta, tiene } = await accesoA("long_form")
  if (!tiene) {
    return (
      <DashboardShell title="Nuevo video">
        <Paywall clave="long_form" accountId={cuenta.id} />
      </DashboardShell>
    )
  }
  const estilo = await estiloDe(cuenta.id)
  // Sin estilo confirmado el video no tendria con que editarse: primero el estilo.
  if (!estilo?.listo) redirect("/long-form")
  const ctas = estilo.config.ctas.map((c) => ({ clave: c.clave, nombre: c.titular.replace(/\*/g, "") || c.clave }))
  return (
    <DashboardShell title="Nuevo video">
      <NuevoVideo ctas={ctas} nivelDefecto={estilo.config.esfuerzo} ctaDefecto={estilo.config.clips.cta} />
    </DashboardShell>
  )
}
