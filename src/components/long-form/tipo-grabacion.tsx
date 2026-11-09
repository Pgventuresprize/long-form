"use client"

import * as React from "react"
import { SparklesIcon } from "lucide-react"

import { cambiarTipo } from "@/app/long-form/actions"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import type { Proyecto } from "@/engine/long-form/datos"
import { COMO_SE_EDITA, NOMBRE_TIPO, TIPOS_GRABACION, type Clasificacion, type TipoGrabacion } from "@/engine/long-form/tipos"

const CONFIANZA: Record<Clasificacion["confianza"], { texto: string; variante: "success" | "secondary" | "warning" }> = {
  alta: { texto: "Seguro", variante: "success" },
  media: { texto: "Bastante seguro", variante: "secondary" },
  baja: { texto: "Revísalo", variante: "warning" },
}

/**
 * El tipo de grabacion que reconocio Studio, por que (la evidencia medida) y como se va a editar. Si no es ese,
 * la persona lo cambia y el video se vuelve a analizar con el tipo que eligio.
 */
export function TipoDeGrabacion({ p, alCambiar }: { p: Proyecto; alCambiar: () => void }) {
  const cl = p.estado.clasificacion as Clasificacion | undefined
  // Si la persona lo corrigio, manda lo que eligio; lo que habia reconocido Studio queda como antecedente.
  const forzado = typeof p.spec.tipo_forzado === "string" ? (p.spec.tipo_forzado as TipoGrabacion) : null
  const actual = (forzado ?? p.tipo ?? cl?.tipo) as TipoGrabacion | undefined
  const [otro, setOtro] = React.useState<TipoGrabacion | "">("")
  const [error, setError] = React.useState<string | null>(null)
  const [ocupado, start] = React.useTransition()
  if (!cl || !actual) {
    return (
      <div className="flex flex-col gap-1 rounded-xl border p-4">
        <span className="text-muted-foreground text-xs">Tipo de grabación</span>
        <span className="font-medium">Sin reconocer todavía</span>
      </div>
    )
  }
  const conf = CONFIANZA[cl.confianza] ?? CONFIANZA.media

  return (
    <div className="flex flex-col gap-3 rounded-xl border p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-muted-foreground text-xs">Tipo de grabación</span>
        {forzado || cl.forzado ? <Badge variant="secondary">Elegido por ti</Badge> : <Badge variant={conf.variante}>{conf.texto}</Badge>}
        {cl.por_ia && !forzado ? (
          <Badge variant="secondary" className="gap-1">
            <SparklesIcon className="size-3" aria-hidden />
            Desempató la IA
          </Badge>
        ) : null}
      </div>
      <div className="flex flex-col gap-0.5">
        <span className="font-medium">{NOMBRE_TIPO[actual]}</span>
        <span className="text-muted-foreground text-sm">{COMO_SE_EDITA[actual]}</span>
      </div>
      {forzado && forzado !== cl.tipo ? (
        <p className="text-muted-foreground text-xs">Studio había reconocido «{NOMBRE_TIPO[cl.tipo]}» por esto:</p>
      ) : null}
      {cl.razones?.length ? (
        <ul className="text-muted-foreground flex list-disc flex-col gap-1 pl-5 text-xs" aria-label="Por qué este tipo">
          {cl.razones.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      ) : null}
      <div className="flex flex-wrap items-center gap-2 border-t pt-3">
        <span className="text-sm">¿No es este?</span>
        <Select value={otro} onValueChange={(v) => setOtro((v as TipoGrabacion) ?? "")}>
          <SelectTrigger size="sm" className="w-full sm:w-64" aria-label="Elige el tipo de grabación">
            <SelectValue>{() => (otro ? NOMBRE_TIPO[otro] : "Elige el tipo correcto")}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {TIPOS_GRABACION.filter((t) => t !== actual).map((t) => (
              <SelectItem key={t} value={t}>
                {NOMBRE_TIPO[t]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          size="sm"
          variant="outline"
          disabled={!otro || ocupado}
          onClick={() =>
            start(async () => {
              if (!otro) return
              setError(null)
              const r = await cambiarTipo(p.id, otro)
              if (!r.ok) setError(r.error)
              else {
                setOtro("")
                alCambiar()
              }
            })
          }
        >
          {ocupado ? "Cambiando..." : "Cambiar y volver a analizar"}
        </Button>
      </div>
      {otro ? <p className="text-muted-foreground text-xs">Se vuelve a analizar el video con este tipo. Lo que subiste no se toca.</p> : null}
      {error ? (
        <p className="text-destructive text-sm" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}
