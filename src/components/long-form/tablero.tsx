"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { AlertCircleIcon, ClapperboardIcon, PlusIcon } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import type { ProyectoResumen } from "@/engine/long-form/datos"

import { BadgeNivel, COLUMNAS, duracionLegible, nombreEtapa, quienActua } from "./comun"
import { useSubidas } from "./subidas"

/**
 * El inicio de Long-form: un tablero por estado. En el telefono, las columnas van una debajo de otra con su
 * contador. Mientras algo se procesa, se refresca solo.
 */
export function TableroLongForm({ proyectos }: { proyectos: ProyectoResumen[] }) {
  const router = useRouter()
  const { subidas } = useSubidas()
  const vivo = proyectos.some((p) => p.tablero === "procesando" || p.tablero === "subiendo")

  React.useEffect(() => {
    if (!vivo) return
    const t = setInterval(() => document.visibilityState === "visible" && router.refresh(), 5000)
    return () => clearInterval(t)
  }, [vivo, router])

  const porColumna = (c: string) => proyectos.filter((p) => (c === "procesando" ? p.tablero === "procesando" || p.tablero === "error" : p.tablero === c))

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-muted-foreground max-w-xl text-sm">Sube una grabación larga y recibe el video editado, clips y carruseles para seguir publicando.</p>
        <Button variant="brand" nativeButton={false} render={<Link href="/long-form/nuevo" />}>
          <PlusIcon />
          Nuevo video
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
        {COLUMNAS.map((c) => {
          const lista = porColumna(c.valor)
          return (
            <section key={c.valor} aria-label={c.nombre} className="bg-muted/40 flex min-w-0 flex-col gap-2 rounded-xl border p-2.5">
              <header className="flex items-center justify-between px-1">
                <h2 className="text-sm font-medium">{c.nombre}</h2>
                <Badge variant="secondary" className="tabular-nums">
                  {lista.length}
                </Badge>
              </header>
              {lista.length === 0 ? <p className="text-muted-foreground px-1 pb-1 text-xs">{c.vacio}</p> : null}
              {lista.map((p) => (
                <Tarjeta key={p.id} p={p} subiendo={subidas.filter((s) => s.proyectoId === p.id)} />
              ))}
            </section>
          )
        })}
      </div>
    </div>
  )
}

function Tarjeta({ p, subiendo }: { p: ProyectoResumen; subiendo: { bytes: number; subido: number }[] }) {
  const actua = quienActua(p)
  const total = subiendo.reduce((s, x) => s + x.bytes, 0)
  const avance = p.tablero === "subiendo" && total ? subiendo.reduce((s, x) => s + x.subido, 0) / total : p.progreso
  return (
    <Link
      href={`/long-form/${p.id}`}
      className="bg-card hover:border-foreground/30 focus-visible:ring-ring flex flex-col gap-2 rounded-lg border p-3 transition-colors outline-none focus-visible:ring-2"
    >
      <div className="bg-muted flex aspect-video items-center justify-center overflow-hidden rounded-md">
        {p.miniatura ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={p.miniatura} alt="" className="h-full w-full object-cover" />
        ) : (
          <ClapperboardIcon className="text-muted-foreground size-6" aria-hidden />
        )}
      </div>
      <div className="min-w-0">
        <div className="line-clamp-2 text-sm font-medium">{p.titulo}</div>
        <div className="text-muted-foreground mt-0.5 flex flex-wrap items-center gap-x-2 text-xs">
          {duracionLegible(p.duracion) ? <span>{duracionLegible(p.duracion)}</span> : null}
          <BadgeNivel nivel={p.esfuerzo} />
        </div>
      </div>
      <div className={`flex items-center gap-1.5 text-xs ${actua.tuyo ? "text-brand-text font-medium" : "text-muted-foreground"}`}>
        {p.tablero === "error" ? <AlertCircleIcon className="text-destructive size-3.5" aria-hidden /> : null}
        {actua.texto}
      </div>
      {(p.tablero === "procesando" || p.tablero === "subiendo") && avance !== null && avance !== undefined ? (
        <div className="flex flex-col gap-1">
          <div className="bg-muted h-1 overflow-hidden rounded-full" role="progressbar" aria-valuenow={Math.round(avance * 100)} aria-valuemin={0} aria-valuemax={100}>
            <div className="bg-primary h-full rounded-full transition-all" style={{ width: `${Math.round(avance * 100)}%` }} />
          </div>
          <span className="text-muted-foreground text-[11px]">{p.tablero === "subiendo" ? `${Math.round(avance * 100)} % subido` : nombreEtapa(p.fase)}</span>
        </div>
      ) : null}
    </Link>
  )
}
