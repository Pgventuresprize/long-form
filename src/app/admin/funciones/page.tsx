import Link from "next/link"

import { AdminShell } from "@/components/admin/admin-shell"
import { BotonDarAcceso, BotonFuncionGlobal } from "@/components/admin/funciones"
import { fechaCorta } from "@/components/admin/piezas"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { excepciones, funcionesDe, interesados } from "@/engine/funciones"
import { supabaseAdmin } from "@/engine/supabase-admin"
import { exigirAdmin } from "@/lib/admin"

export const dynamic = "force-dynamic"

/**
 * Las funciones en beta: la bandera de todos, las empresas con excepcion y quienes pidieron acceso.
 */
export default async function AdminFuncionesPage() {
  await exigirAdmin()
  // Una cuenta cualquiera solo para leer las globales: funcionesDe devuelve las tres siempre.
  const [globales, excepcionesTodas, pedidos, nombres] = await Promise.all([
    funcionesDe("00000000-0000-0000-0000-000000000000"),
    excepciones(),
    interesados(),
    supabaseAdmin().from("accounts").select("id, name"),
  ])
  const nombreDe = new Map(((nombres.data ?? []) as { id: string; name: string }[]).map((a) => [a.id, a.name]))
  const conAcceso = new Set(excepcionesTodas.filter((e) => e.encendida).map((e) => `${e.accountId}:${e.clave}`))

  return (
    <AdminShell title="Funciones" descripcion="Lo que está en beta privada. Apagado por defecto; se abre por empresa.">
      <div className="grid items-start gap-4 lg:grid-cols-3">
        {globales.map((f) => {
          const conExcepcion = excepcionesTodas.filter((e) => e.clave === f.clave)
          return (
            <Card key={f.clave}>
              <CardHeader className="gap-2">
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="text-base">{f.nombre}</CardTitle>
                  <Badge variant={f.global ? "success" : "secondary"}>{f.global ? "Encendida para todos" : "Apagada"}</Badge>
                </div>
                <CardDescription>{f.descripcion}</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <BotonFuncionGlobal clave={f.clave} nombre={f.nombre} encendida={f.global} />
                <div className="text-sm">
                  <div className="text-muted-foreground mb-1 text-xs">Empresas con excepción</div>
                  {conExcepcion.length === 0 ? <p className="text-muted-foreground">Ninguna.</p> : null}
                  <ul className="flex flex-col gap-1">
                    {conExcepcion.map((e) => (
                      <li key={e.accountId} className="flex items-center justify-between gap-2">
                        <Link href={`/admin/empresas/${e.accountId}`} className="hover:text-brand-text truncate hover:underline">
                          {nombreDe.get(e.accountId) ?? e.accountId}
                        </Link>
                        <Badge variant={e.encendida ? "success" : "secondary"}>{e.encendida ? "Con acceso" : "Sin acceso"}</Badge>
                      </li>
                    ))}
                  </ul>
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Quienes pidieron acceso</CardTitle>
          <CardDescription>El botón &quot;Quiero acceso&quot; del paywall.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col divide-y">
          {pedidos.length === 0 ? <p className="text-muted-foreground text-sm">Nadie todavía.</p> : null}
          {pedidos.map((p) => {
            const funcion = globales.find((f) => f.clave === p.clave)
            return (
              <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm first:pt-0 last:pb-0">
                <div className="min-w-0">
                  <Link href={`/admin/empresas/${p.accountId}`} className="hover:text-brand-text font-medium hover:underline">
                    {nombreDe.get(p.accountId) ?? p.accountId}
                  </Link>
                  <div className="text-muted-foreground text-xs">
                    {funcion?.nombre ?? p.clave} · {p.correo ?? "sin correo"} · {fechaCorta(p.at)}
                  </div>
                </div>
                {conAcceso.has(`${p.accountId}:${p.clave}`) ? <Badge variant="success">Con acceso</Badge> : <BotonDarAcceso accountId={p.accountId} clave={p.clave} />}
              </div>
            )
          })}
        </CardContent>
      </Card>
    </AdminShell>
  )
}
