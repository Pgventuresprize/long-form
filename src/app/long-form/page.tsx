import { DashboardShell } from "@/components/dashboard-shell"
import { Paywall } from "@/components/funciones/paywall"
import { accesoA } from "@/lib/funciones"

export const dynamic = "force-dynamic"

export const metadata = { title: "Long-form · Plogy Studio" }

/**
 * Long-form: de una grabacion larga al video editado y a lo que sale de el. En beta cerrada: sin
 * la funcion se ve el paywall y no se lee nada de la cuenta.
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
  return (
    <DashboardShell title="Long-form">
      <p className="text-muted-foreground text-sm">Todavía no hay videos.</p>
    </DashboardShell>
  )
}
