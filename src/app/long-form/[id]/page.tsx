import { notFound } from "next/navigation"

import { DashboardShell } from "@/components/dashboard-shell"
import { Paywall } from "@/components/funciones/paywall"
import { ProyectoLongForm } from "@/components/long-form/proyecto"
import { proyectoDe, urlsFirmadas } from "@/engine/long-form/datos"
import { accesoA } from "@/lib/funciones"

export const dynamic = "force-dynamic"

export const metadata = { title: "Video · Long-form · Plogy Studio" }

export default async function ProyectoPage({ params }: { params: Promise<{ id: string }> }) {
  const { cuenta, tiene } = await accesoA("long_form")
  if (!tiene) {
    return (
      <DashboardShell title="Long-form">
        <Paywall clave="long_form" accountId={cuenta.id} />
      </DashboardShell>
    )
  }
  const { id } = await params
  const p = await proyectoDe(cuenta.id, id)
  if (!p) notFound()
  const urls = await urlsFirmadas(cuenta.id, p.archivos.filter((a) => a.subida === "lista").map((a) => a.ruta))
  return (
    <DashboardShell title={p.titulo}>
      <ProyectoLongForm inicial={p} urlsIniciales={urls} />
    </DashboardShell>
  )
}
