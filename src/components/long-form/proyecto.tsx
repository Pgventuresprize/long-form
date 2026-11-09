"use client"

import * as React from "react"
import Link from "next/link"
import { AlertCircleIcon, ArrowLeftIcon, CheckIcon, ChevronDownIcon, RotateCcwIcon } from "lucide-react"

import { estadoProyecto, reintentar } from "@/app/long-form/actions"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import type { Proyecto } from "@/engine/long-form/datos"

import { BadgeNivel, nombreEtapa, PASOS, pasoDe, quienActua } from "./comun"
import { RevisionGuion } from "./revision-guion"
import { RevisionReparto } from "./revision-reparto"
import { useSubidas } from "./subidas"
import { VistaVideo } from "./video"

/**
 * Un video de Long-form: donde va, que le toca hacer a la persona y sus pestañas. Mientras Studio trabaja,
 * se pide el estado cada 3 segundos (Studio no usa Realtime).
 */
export function ProyectoLongForm({ inicial, urlsIniciales }: { inicial: Proyecto; urlsIniciales: Record<string, string> }) {
  const [p, setP] = React.useState(inicial)
  const [urls, setUrls] = React.useState(urlsIniciales)
  const [error, setError] = React.useState<string | null>(null)
  const [ocupado, start] = React.useTransition()
  const trabajando = p.tablero === "procesando" || p.tablero === "subiendo"

  const refrescar = React.useCallback(async () => {
    const r = await estadoProyecto(p.id)
    if (r.ok) {
      setP(r.p)
      // Las URLs firmadas que ya tenia siguen valiendo: solo se suman las nuevas (no se recarga el reproductor).
      setUrls((u) => ({ ...r.urls, ...u }))
    }
  }, [p.id])

  React.useEffect(() => {
    if (!trabajando) return
    const t = setInterval(() => document.visibilityState === "visible" && refrescar(), 3000)
    return () => clearInterval(t)
  }, [trabajando, refrescar])

  const actua = quienActua(p)
  const paso = pasoDe(p)
  const enRevision = p.fase === "revision_reparto" || p.fase === "revision_guion"
  const hayVideo = Boolean((p.estado.render as { archivo?: string } | undefined)?.archivo)
  const pestanaInicial = enRevision ? "revision" : hayVideo ? "video" : "revision"

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-2">
        <Button nativeButton={false} variant="ghost" size="sm" className="-ml-2" render={<Link href="/long-form" />}>
          <ArrowLeftIcon />
          Long-form
        </Button>
        <BadgeNivel nivel={p.esfuerzo} />
        <Badge variant={p.tablero === "error" ? "destructive" : actua.tuyo ? "warning" : "secondary"}>{actua.texto}</Badge>
      </div>

      <Pasos actual={paso} error={p.tablero === "error"} />

      {p.tablero === "error" ? (
        <div className="bg-destructive/10 flex flex-wrap items-center gap-3 rounded-xl p-4" role="alert">
          <AlertCircleIcon className="text-destructive size-5 shrink-0" aria-hidden />
          <div className="min-w-0 flex-1 text-sm">
            <div className="font-medium">Algo falló en {nombreEtapa(p.trabajos.find((t) => t.estado === "error")?.etapa ?? p.fase).toLowerCase()}</div>
            <div className="text-muted-foreground break-words">{p.detalle}</div>
          </div>
          <Button
            variant="outline"
            disabled={ocupado}
            onClick={() =>
              start(async () => {
                const r = await reintentar(p.id)
                if (!r.ok) setError(r.error)
                else await refrescar()
              })
            }
          >
            <RotateCcwIcon />
            Reintentar
          </Button>
        </div>
      ) : actua.tuyo && enRevision ? (
        <div className="bg-warning-soft flex items-center gap-3 rounded-xl p-4 text-sm" role="status">
          <span className="font-medium">{p.fase === "revision_reparto" ? "Te toca: confirma quién es quién." : "Te toca: revisa el guion y apruébalo."}</span>
          <span className="text-muted-foreground">El render sigue solo al aprobar.</span>
        </div>
      ) : null}
      {error ? (
        <p className="text-destructive text-sm" role="alert">
          {error}
        </p>
      ) : null}

      {trabajando ? <Progreso p={p} /> : null}
      <LineaDeTiempo p={p} />

      <Tabs defaultValue={pestanaInicial} className="flex flex-col gap-4">
        <TabsList>
          <TabsTrigger value="revision">Revisión</TabsTrigger>
          <TabsTrigger value="video" disabled={!hayVideo}>
            Video
          </TabsTrigger>
          <TabsTrigger value="difusion">Difusión</TabsTrigger>
        </TabsList>
        <TabsContent value="revision">
          {p.fase === "revision_reparto" ? (
            <RevisionReparto p={p} urls={urls} alAprobar={refrescar} />
          ) : p.fase === "revision_guion" ? (
            <RevisionGuion p={p} urls={urls} alAprobar={refrescar} />
          ) : (
            <Vacio texto={p.estado.guion_aprobado ? "El guion ya está aprobado. Para cambiarlo, usa Corregir en la pestaña Video." : p.esfuerzo === "rapido" ? "En Rápido la IA decide quién es quién y el guion: no hay revisión." : "La revisión aparece aquí cuando Studio termine de analizar el video."} />
          )}
        </TabsContent>
        <TabsContent value="video">{hayVideo ? <VistaVideo p={p} urls={urls} alCorregir={refrescar} /> : null}</TabsContent>
        <TabsContent value="difusion">
          <Vacio texto="Las ideas, los clips y los carruseles aparecen aquí apenas esté la transcripción." />
        </TabsContent>
      </Tabs>
    </div>
  )
}

function Pasos({ actual, error }: { actual: number; error: boolean }) {
  return (
    <ol className="grid grid-cols-3 gap-2 sm:grid-cols-6" aria-label="Paso a paso">
      {PASOS.map((nombre, i) => {
        const hecho = i < actual
        const ahora = i === actual
        return (
          <li key={nombre} className="flex min-w-0 flex-col gap-1.5" aria-current={ahora ? "step" : undefined}>
            <div className={`h-1.5 rounded-full ${hecho ? "bg-primary" : ahora ? (error ? "bg-destructive" : "bg-brand") : "bg-muted"}`} />
            <span className={`flex items-center gap-1 truncate text-xs ${ahora ? "text-foreground font-medium" : "text-muted-foreground"}`}>
              {hecho ? <CheckIcon className="size-3 shrink-0" aria-hidden /> : null}
              {nombre}
            </span>
          </li>
        )
      })}
    </ol>
  )
}

function Progreso({ p }: { p: Proyecto }) {
  const { subidas } = useSubidas()
  const mias = subidas.filter((s) => s.proyectoId === p.id)
  if (p.tablero === "subiendo") {
    return (
      <div className="flex flex-col gap-2 rounded-xl border p-4">
        <div className="text-sm font-medium">Subiendo archivos</div>
        {mias.length === 0 ? <p className="text-muted-foreground text-sm">Esta pestaña no tiene las subidas: ábrelo desde la pestaña donde empezaste, o vuelve a crear el video.</p> : null}
        {mias.map((s) => (
          <div key={s.archivoId} className="flex flex-col gap-1">
            <div className="flex justify-between gap-2 text-xs">
              <span className="truncate">{s.nombre}</span>
              <span className={s.estado === "error" ? "text-destructive" : "text-muted-foreground"}>{s.estado === "error" ? s.error : s.estado === "lista" ? "Listo" : `${Math.round((s.subido / s.bytes) * 100)} %`}</span>
            </div>
            <div className="bg-muted h-1 overflow-hidden rounded-full">
              <div className="bg-primary h-full rounded-full transition-all" style={{ width: `${(s.subido / s.bytes) * 100}%` }} />
            </div>
          </div>
        ))}
        <p className="text-muted-foreground text-xs">Puedes ir a otra pantalla de Studio: la subida sigue. No cierres la pestaña.</p>
      </div>
    )
  }
  const desde = p.trabajos.find((t) => t.estado === "corriendo")?.creado
  return (
    <div className="flex flex-col gap-2 rounded-xl border p-4" role="status">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-sm font-medium">{nombreEtapa(p.fase === "en_cola" ? (p.detalle ?? "en_cola") : p.fase)}</span>
        <span className="text-muted-foreground text-xs">{p.detalle && p.fase !== "en_cola" ? p.detalle : desde ? "Trabajando" : "Esperando turno"}</span>
      </div>
      <div className="bg-muted h-1.5 overflow-hidden rounded-full" role="progressbar" aria-valuenow={Math.round((p.progreso ?? 0) * 100)} aria-valuemin={0} aria-valuemax={100}>
        <div className="bg-primary h-full rounded-full transition-all" style={{ width: `${Math.round((p.progreso ?? 0) * 100)}%` }} />
      </div>
      <p className="text-muted-foreground text-xs">Puedes cerrar el navegador: te avisamos en la campana cuando haya algo para ti.</p>
    </div>
  )
}

function LineaDeTiempo({ p }: { p: Proyecto }) {
  const etapas = p.eventos.filter((e) => e.nivel === "etapa").reverse()
  const avisos = p.eventos.filter((e) => e.nivel === "aviso" || e.nivel === "error").slice(0, 8)
  if (!etapas.length && !avisos.length) return null
  const total = etapas.reduce((s, e) => s + (e.duracion_ms ?? 0), 0)
  const usd = etapas.reduce((s, e) => s + Number(e.costo?.usd_maquina ?? 0) + Number(e.costo?.usd_audio ?? 0), 0)
  return (
    <Collapsible className="rounded-xl border">
      <CollapsibleTrigger className="hover:bg-muted/50 flex w-full items-center justify-between gap-2 rounded-xl px-4 py-3 text-left text-sm">
        <span className="font-medium">Línea de tiempo</span>
        <span className="text-muted-foreground flex items-center gap-2 text-xs">
          {etapas.length} pasos · {Math.round(total / 60000)} min
          <ChevronDownIcon className="size-4" aria-hidden />
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ol className="flex flex-col gap-1.5 border-t px-4 py-3 text-sm">
          {etapas.map((e) => (
            <li key={e.id} className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-2">
                <CheckIcon className="text-success size-3.5" aria-hidden />
                {nombreEtapa(e.etapa ?? "")}
              </span>
              <span className="text-muted-foreground tabular-nums">{Math.max(1, Math.round((e.duracion_ms ?? 0) / 1000))} s</span>
            </li>
          ))}
          {avisos.map((e) => (
            <li key={e.id} className={`text-xs ${e.nivel === "error" ? "text-destructive" : "text-muted-foreground"}`}>
              {e.mensaje.split("\n")[0]}
            </li>
          ))}
          {usd > 0 ? <li className="text-muted-foreground pt-1 text-xs">Costo estimado de máquina y audio: {usd.toFixed(3)} USD</li> : null}
        </ol>
      </CollapsibleContent>
    </Collapsible>
  )
}

export function Vacio({ texto }: { texto: string }) {
  return <p className="text-muted-foreground rounded-xl border border-dashed p-6 text-center text-sm">{texto}</p>
}
