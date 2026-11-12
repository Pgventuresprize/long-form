"use client"

import * as React from "react"
import { ArrowRightIcon, ChevronDownIcon, PlusIcon, SparklesIcon } from "lucide-react"

import { Opciones } from "@/components/marca/long-form/campos"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { NIVELES, NOMBRE_NIVEL, type Nivel } from "@/engine/long-form/estilo"
import { agregarIndicacion, FORMATOS_VIDEO, NOMBRE_TRIESTADO, TRIESTADOS, type OpcionesVideo } from "@/engine/long-form/nuevo"

import { ErrorCampo, Segmentado } from "./comun"
import { DuracionDeslizable } from "./duracion"

const SUGERENCIAS = [
  "Quita silencios y muletillas",
  "Abre con la frase más fuerte",
  "Usa el apoyo cuando se mencione un caso",
  "Música baja mientras hablan",
  "Zoom suave en las frases clave",
  "Corta la parte de precios",
]

const DETALLE: Record<Nivel, string> = {
  rapido: "Solo revisas la difusión. La IA decide nombres y guion.",
  normal: "Revisas el guion. Quién es quién solo si hay dudas.",
  detallado: "Revisas quién es quién, el guion y la difusión.",
}

const TRI = TRIESTADOS.map((t) => ({ valor: t, nombre: NOMBRE_TRIESTADO[t] }))

/**
 * Paso 6: lo que se le pide al editor y como se entrega. Va pegado abajo en pantallas grandes, como un
 * compositor: lo ultimo que se toca antes de "Editar video".
 */
export function Indicaciones({
  notas,
  onNotas,
  opciones,
  onOpciones,
  titulo,
  onTitulo,
  nivel,
  onNivel,
  cta,
  onCta,
  ctas,
  cuenta,
  listo,
  falta,
  ocupado,
  errorTitulo,
  error,
  onEnviar,
}: {
  notas: string
  onNotas: (v: string) => void
  opciones: OpcionesVideo
  onOpciones: (o: OpcionesVideo) => void
  titulo: string
  onTitulo: (v: string) => void
  nivel: Nivel
  onNivel: (n: Nivel) => void
  cta: string
  onCta: (v: string) => void
  ctas: { clave: string; nombre: string }[]
  cuenta: string
  listo: boolean
  falta: string | null
  ocupado: boolean
  errorTitulo: string | null
  error: string | null
  onEnviar: () => void
}) {
  const [mas, setMas] = React.useState(false)
  const caja = React.useRef<HTMLTextAreaElement>(null)
  const cambiar = <K extends keyof OpcionesVideo>(k: K, v: OpcionesVideo[K]) => onOpciones({ ...opciones, [k]: v })
  // Si falta el titulo, se abre "Mas opciones" para que se vea el campo y su aviso.
  const abierto = mas || Boolean(errorTitulo)

  return (
    <section aria-labelledby="paso-indicaciones-titulo" className="bg-card ring-foreground/10 z-20 rounded-xl p-3 shadow-lg ring-1 md:sticky md:bottom-4 md:max-h-[calc(100svh-6rem)] md:overflow-y-auto md:p-4">
      <h2 id="paso-indicaciones-titulo" className="sr-only">
        Paso 6: Indicaciones
      </h2>
      <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-2.5" role="group" aria-label="Indicaciones rápidas">
        {SUGERENCIAS.map((s) => (
          <button
            key={s}
            type="button"
            disabled={ocupado}
            onClick={() => {
              onNotas(agregarIndicacion(notas, s))
              caja.current?.focus()
            }}
            className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 ring-foreground/10 inline-flex h-7 shrink-0 items-center gap-1 rounded-full px-2.5 text-xs whitespace-nowrap ring-1 transition-colors outline-none hover:ring-foreground/25 focus-visible:ring-3"
          >
            <PlusIcon className="size-3" aria-hidden />
            {s}
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="relative min-w-0 flex-1">
          <SparklesIcon className="text-muted-foreground pointer-events-none absolute top-2.5 left-2.5 size-4" aria-hidden />
          <label htmlFor="lf-notas" className="sr-only">
            Indicaciones para el editor
          </label>
          <textarea
            ref={caja}
            id="lf-notas"
            value={notas}
            maxLength={4000}
            rows={2}
            disabled={ocupado}
            onChange={(e) => onNotas(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && listo && !ocupado) {
                e.preventDefault()
                onEnviar()
              }
            }}
            placeholder="Cuéntale al editor qué quieres: de qué trata, quiénes hablan, qué cortar, dónde meter el apoyo…"
            className="border-input focus-visible:border-ring focus-visible:ring-ring/50 placeholder:text-muted-foreground field-sizing-content max-h-44 min-h-16 w-full resize-none rounded-lg border bg-transparent py-2 pr-2.5 pl-8 text-base outline-none focus-visible:ring-3 md:text-sm"
          />
        </div>
        <Button variant="brand" size="lg" className="w-full min-w-36 px-4 sm:w-auto" disabled={!listo || ocupado} onClick={onEnviar} aria-describedby={falta ? "lf-falta" : undefined}>
          {ocupado ? "Preparando..." : "Editar video"}
          {!ocupado ? <ArrowRightIcon data-icon="inline-end" /> : null}
        </Button>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
        <Segmentado etiqueta="Formato" valor={opciones.formato} opciones={FORMATOS_VIDEO.map((f) => ({ valor: f, nombre: f }))} onCambio={(v) => cambiar("formato", v)} deshabilitado={ocupado} />
        <DuracionDeslizable valor={opciones.duracion} onCambio={(v) => cambiar("duracion", v)} deshabilitado={ocupado} />
        <span className="flex items-center gap-1.5 text-xs">
          <span className="text-muted-foreground" aria-hidden>
            Subtítulos
          </span>
          <Segmentado etiqueta="Subtítulos" valor={opciones.subtitulos} opciones={TRI} onCambio={(v) => cambiar("subtitulos", v)} deshabilitado={ocupado} />
        </span>
        <span className="flex items-center gap-1.5 text-xs">
          <span className="text-muted-foreground" aria-hidden>
            Abrir con gancho
          </span>
          <Segmentado etiqueta="Abrir con gancho" valor={opciones.gancho} opciones={TRI} onCambio={(v) => cambiar("gancho", v)} deshabilitado={ocupado} />
        </span>
        <label className="flex items-center gap-2 text-xs">
          <Switch checked={opciones.capitulos} onCheckedChange={(v) => cambiar("capitulos", v)} disabled={ocupado} aria-label="Capítulos" />
          <span className="text-muted-foreground">Capítulos</span>
        </label>
        <span className="text-muted-foreground ml-auto text-xs tabular-nums" aria-live="polite">
          {cuenta}
        </span>
      </div>

      {falta || error ? (
        <div className="mt-2 flex flex-col gap-1">
          {falta ? (
            <p id="lf-falta" className="text-muted-foreground text-xs">
              {falta}
            </p>
          ) : null}
          <ErrorCampo>{error}</ErrorCampo>
        </div>
      ) : null}

      <Collapsible open={abierto} onOpenChange={setMas} className="mt-2 border-t pt-2">
        <CollapsibleTrigger render={<Button type="button" variant="ghost" size="sm" className="-ml-2" />}>
          Más opciones
          <ChevronDownIcon className={`transition-transform ${abierto ? "rotate-180" : ""}`} aria-hidden />
        </CollapsibleTrigger>
        <CollapsibleContent className="flex flex-col gap-4 pt-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="lf-titulo">Título</Label>
            <Input
              id="lf-titulo"
              value={titulo}
              maxLength={160}
              disabled={ocupado}
              aria-invalid={Boolean(errorTitulo) || undefined}
              aria-describedby={errorTitulo ? "lf-titulo-error" : undefined}
              onChange={(e) => onTitulo(e.target.value)}
              placeholder="Por ejemplo: IA en deportes, con César"
            />
            <ErrorCampo id="lf-titulo-error">{errorTitulo}</ErrorCampo>
          </div>
          <Opciones etiqueta="¿Cuánto quieres revisar?" valor={nivel} opciones={NIVELES.map((n) => ({ valor: n, nombre: NOMBRE_NIVEL[n], detalle: DETALLE[n] }))} onCambio={onNivel} />
          {ctas.length ? (
            <Opciones etiqueta="CTA por defecto" valor={cta} opciones={[...ctas.map((c) => ({ valor: c.clave, nombre: c.nombre })), { valor: "", nombre: "Sin preferencia" }]} onCambio={onCta} ayuda="Es el que más sale en las barras del video y en los clips." />
          ) : null}
        </CollapsibleContent>
      </Collapsible>
    </section>
  )
}
