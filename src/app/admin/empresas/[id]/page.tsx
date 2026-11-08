import Link from "next/link"
import { notFound } from "next/navigation"
import { ArrowLeftIcon } from "lucide-react"

import { AdminShell } from "@/components/admin/admin-shell"
import { BotonCambiarPlan, BotonSuspension } from "@/components/admin/empresa-acciones"
import { EmpresaMiembros } from "@/components/admin/empresa-miembros"
import { SelectorFuncionEmpresa } from "@/components/admin/funciones"
import { funcionesDe } from "@/engine/funciones"
import { Cifra, EstadoClaude, EstadoEmpresa, PlanBadge, fechaCorta, fechaDia } from "@/components/admin/piezas"
import { ConsumoGrafico } from "@/components/configuracion/consumo-grafico"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { estadoConexion } from "@/engine/composio/conexiones"
import { cargarPanel, formatBytes } from "@/lib/admin-data"
import { GRUPOS } from "@/lib/consumo-data"
import { formatTokens } from "@/lib/format"
import { formatUsd } from "@/lib/precios-claude"

export const dynamic = "force-dynamic"

/** Canva solo se sabe preguntandole a Composio; si no responde, no se afirma nada. */
async function canvaConectado(accountId: string): Promise<boolean | null> {
  try {
    return (await estadoConexion(accountId, "canva")).conectado
  } catch {
    return null
  }
}

export default async function AdminEmpresaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const p = await cargarPanel()
  const e = p.empresas.find((x) => x.id === id)
  if (!e) notFound()

  const miembros = p.usuarios.flatMap((u) => {
    const fila = u.empresas.find((x) => x.accountId === id)
    return fila ? [{ id: u.id, email: u.email, rol: fila.rol, ultimoIngreso: u.ultimoIngreso, estado: u.estado }] : []
  })
  const actividad = p.actividad.filter((a) => a.accountId === id).slice(0, 12)
  const [canva, funciones] = await Promise.all([canvaConectado(id), funcionesDe(id)])
  const conexiones: [string, boolean | null][] = [
    ["Serper", e.serper],
    ["Instagram", e.instagram],
    ["Facebook", e.facebook],
    ["LinkedIn", e.linkedin],
    ["Canva", canva],
  ]

  return (
    <AdminShell
      title={e.name}
      descripcion={`${e.slug} · creada el ${fechaDia(e.creada)}`}
      acciones={
        <div className="flex flex-wrap gap-2">
          <BotonCambiarPlan empresa={{ id: e.id, name: e.name, plan: e.plan, programadas: e.programadas }} />
          <BotonSuspension empresa={{ id: e.id, name: e.name, suspendida: Boolean(e.suspendidaEn), miembros: e.miembros, programadas: e.programadas }} />
        </div>
      }
    >
      <div className="flex flex-wrap items-center gap-2">
        <Button nativeButton={false} variant="ghost" size="sm" className="-ml-2" render={<Link href="/admin/empresas" />}>
          <ArrowLeftIcon />
          Empresas
        </Button>
        <PlanBadge plan={e.plan} />
        <EstadoEmpresa suspendida={Boolean(e.suspendidaEn)} />
      </div>

      {e.suspendidaEn ? (
        <div className="bg-destructive/10 rounded-xl p-4 text-sm">
          <span className="font-medium">Empresa suspendida</span> desde el {fechaDia(e.suspendidaEn)}. Motivo: {e.suspensionMotivo}
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Cifra titulo="Tokens, 30 días" valor={formatTokens(e.tokens)} nota={`≈ ${formatUsd(e.usd)} · ${e.llamadas.toLocaleString("es-CO")} llamadas`} />
        <Cifra titulo="Piezas, 30 días" valor={String(e.piezas)} nota={`${e.publicadas} publicadas`} />
        <Cifra titulo="Programadas" valor={String(e.programadas)} nota="posts por salir" />
        <Cifra titulo="Archivos" valor={formatBytes(e.bytes)} nota="fotos, kits y carruseles" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Miembros</CardTitle>
          <CardDescription>Quién entra a esta empresa y con qué rol.</CardDescription>
        </CardHeader>
        <CardContent>
          <EmpresaMiembros accountId={e.id} miembros={miembros} />
        </CardContent>
      </Card>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Consumo</CardTitle>
            <CardDescription>Tokens por día, últimos 30 días.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {e.llamadas === 0 ? <p className="text-muted-foreground text-sm">Todavía no hay llamadas registradas.</p> : <ConsumoGrafico dias={e.dias} />}
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Grupo</TableHead>
                    <TableHead className="text-right">Tokens</TableHead>
                    <TableHead className="text-right">Parte</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {GRUPOS.map((g) => (
                    <TableRow key={g.clave}>
                      <TableCell>{g.etiqueta}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatTokens(e.grupos[g.clave])}</TableCell>
                      <TableCell className="text-right tabular-nums">{e.tokens ? Math.round((e.grupos[g.clave] / e.tokens) * 100) : 0} %</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Conexiones</CardTitle>
            <CardDescription>Solo el estado. Las claves nunca se muestran aquí.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col divide-y">
            <div className="flex items-center justify-between gap-2 py-2 text-sm first:pt-0">
              Claude <EstadoClaude empresa={e} />
            </div>
            {conexiones.map(([nombre, conectado]) => (
              <div key={nombre} className="flex items-center justify-between gap-2 py-2 text-sm last:pb-0">
                {nombre}
                <Badge variant={conectado ? "success" : "secondary"}>{conectado === null ? "No se pudo saber" : conectado ? "Conectado" : "Sin conectar"}</Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Funciones en beta</CardTitle>
          <CardDescription>La excepción de esta empresa manda sobre lo que está encendido para todos.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col divide-y">
          {funciones.map((f) => (
            <SelectorFuncionEmpresa key={f.clave} accountId={e.id} empresa={e.name} clave={f.clave} nombre={f.nombre} cuenta={f.cuenta} global={f.global} />
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Actividad de esta empresa</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col divide-y">
          {actividad.length === 0 ? <p className="text-muted-foreground text-sm">Sin movimientos todavía.</p> : null}
          {actividad.map((a) => (
            <div key={a.id} className="py-2 text-sm first:pt-0 last:pb-0">
              <div className="font-medium">{a.accion}</div>
              <div className="text-muted-foreground">{[a.detalle, a.motivo ? `Motivo: ${a.motivo}` : null].filter(Boolean).join(". ")}</div>
              <div className="text-muted-foreground text-xs">
                {a.actor} · {fechaCorta(a.at)}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </AdminShell>
  )
}
