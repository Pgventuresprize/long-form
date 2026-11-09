"use client"

import * as React from "react"
import { SparklesIcon, UserIcon } from "lucide-react"

import { aprobarReparto } from "@/app/long-form/actions"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { Proyecto } from "@/engine/long-form/datos"

import { TipoDeGrabacion } from "./tipo-grabacion"

type Persona = {
  id: string
  tipo?: string
  nombre?: string
  rol?: string
  handle?: string
  voz?: number
  muestras?: string[]
  miniatura?: string
  origen?: string
  evidencia?: string
  nota?: string
}

/** Como se llama cada tarjeta segun de donde salio la persona. */
function etiqueta(x: Persona, i: number): string {
  if (x.tipo === "tercero") return "Otra voz"
  if (x.tipo === "camara") return `Cámara ${x.id}`
  if (x.tipo === "ponente") return "Ponente"
  if (x.tipo === "voz") return "Voz principal"
  return `Persona ${i + 1}`
}

/**
 * Revision 1: quien es quien. Cada persona con su miniatura, el nombre que se propone (y de donde salio) y
 * frases de ejemplo. Lo que se confirma aqui es lo que sale en los rotulos y las citas.
 */
export function RevisionReparto({ p, urls, alAprobar }: { p: Proyecto; urls: Record<string, string>; alAprobar: () => void }) {
  const reparto = (p.estado.reparto ?? { personas: [] }) as { personas: Persona[] } & Record<string, unknown>
  const [personas, setPersonas] = React.useState<Persona[]>(reparto.personas)
  const [error, setError] = React.useState<string | null>(null)
  const [ocupado, start] = React.useTransition()
  const url = (nombre?: string) => {
    const a = nombre ? p.archivos.find((x) => x.nombre === nombre) : null
    return a ? urls[a.ruta] : undefined
  }
  const set = (i: number, cambio: Partial<Persona>) => setPersonas((xs) => xs.map((x, j) => (j === i ? { ...x, ...cambio, origen: "persona" } : x)))
  const sinNombre = personas.filter((x) => x.tipo !== "tercero" && !x.nombre?.trim()).length

  return (
    <div className="flex flex-col gap-4">
      <TipoDeGrabacion p={p} alCambiar={alAprobar} />
      {typeof reparto.nota === "string" ? <p className="text-muted-foreground text-sm">{reparto.nota}</p> : null}

      <ul className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {personas.map((x, i) => {
          const foto = url(x.miniatura)
          return (
            <li key={x.id} className="flex flex-col gap-3 rounded-xl border p-4">
              <div className="flex items-start gap-3">
                <div className="bg-muted flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-lg">
                  {foto ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={foto} alt={etiqueta(x, i)} className="h-full w-full object-cover" />
                  ) : (
                    <UserIcon className="text-muted-foreground size-6" aria-hidden />
                  )}
                </div>
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-sm font-medium">{etiqueta(x, i)}</span>
                    {typeof x.voz === "number" ? <span className="text-muted-foreground text-xs">habla {Math.round(x.voz * 100)} %</span> : null}
                    {x.origen === "ia" ? (
                      <Badge variant="warning" className="gap-1">
                        <SparklesIcon className="size-3" aria-hidden />
                        Propuesto por la IA
                      </Badge>
                    ) : x.origen === "pendiente" && !x.nombre ? (
                      <Badge variant="secondary">Sin nombre</Badge>
                    ) : null}
                  </div>
                  {x.evidencia ? <p className="text-muted-foreground text-xs">“{x.evidencia}”</p> : null}
                  {x.nota ? <p className="text-muted-foreground text-xs">{x.nota}</p> : null}
                </div>
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                <Campo id={`n-${x.id}`} etiqueta="Nombre" valor={x.nombre ?? ""} onCambio={(v) => set(i, { nombre: v })} />
                <Campo id={`r-${x.id}`} etiqueta="Cargo" valor={x.rol ?? ""} onCambio={(v) => set(i, { rol: v })} />
                <Campo id={`h-${x.id}`} etiqueta="Usuario" valor={x.handle ?? ""} onCambio={(v) => set(i, { handle: v })} />
              </div>
              {x.muestras?.length ? (
                <ul className="text-muted-foreground flex flex-col gap-1 border-l-2 pl-3 text-xs">
                  {x.muestras.slice(0, 3).map((m) => (
                    <li key={m}>“{m}”</li>
                  ))}
                </ul>
              ) : null}
            </li>
          )
        })}
      </ul>

      {error ? (
        <p className="text-destructive text-sm" role="alert">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="brand"
          disabled={ocupado}
          onClick={() =>
            start(async () => {
              setError(null)
              const r = await aprobarReparto(p.id, { ...reparto, personas: personas.map((x) => ({ ...x })) })
              if (!r.ok) setError(r.error)
              else alAprobar()
            })
          }
        >
          {ocupado ? "Guardando..." : "Aprobar y seguir"}
        </Button>
        {sinNombre ? <span className="text-muted-foreground text-sm">{sinNombre === 1 ? "Una persona queda" : `${sinNombre} personas quedan`} sin rótulo si no le pones nombre.</span> : null}
      </div>
    </div>
  )
}

function Campo({ id, etiqueta, valor, onCambio }: { id: string; etiqueta: string; valor: string; onCambio: (v: string) => void }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <Label htmlFor={id} className="text-xs">
        {etiqueta}
      </Label>
      <Input id={id} value={valor} maxLength={80} onChange={(e) => onCambio(e.target.value)} />
    </div>
  )
}
