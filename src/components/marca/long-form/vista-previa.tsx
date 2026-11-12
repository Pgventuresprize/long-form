"use client"

import * as React from "react"

import { vistaPreviaLongForm } from "@/app/marca/long-form-actions"
import { Skeleton } from "@/components/ui/skeleton"
import type { EstiloLongForm } from "@/engine/long-form/estilo"

export type PiezaPrevia = "rotulo" | "barra" | "cita" | "pregunta" | "popup" | "tarjeta-intro" | "tarjeta-cierre" | "subtitulo"

const NOMBRES: Record<PiezaPrevia, string> = {
  rotulo: "Rótulo",
  barra: "Barra con CTA",
  cita: "Cita",
  pregunta: "Pregunta",
  popup: "Pop-up",
  "tarjeta-intro": "Intro",
  "tarjeta-cierre": "Cierre",
  subtitulo: "Subtítulos",
}

/**
 * La vista previa en vivo: el mismo HTML que dibuja el motor, con el estilo que se esta editando.
 * Se pide al servidor medio segundo despues del ultimo cambio.
 */
export function VistaPrevia({ estilo, piezas, inicial }: { estilo: EstiloLongForm; piezas: PiezaPrevia[]; inicial?: PiezaPrevia }) {
  const [paginas, setPaginas] = React.useState<Partial<Record<PiezaPrevia, string>> | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [activa, setActiva] = React.useState<PiezaPrevia>(inicial ?? piezas[0])
  const clave = JSON.stringify(estilo)

  React.useEffect(() => {
    let vigente = true
    const t = setTimeout(async () => {
      const r = await vistaPreviaLongForm(JSON.parse(clave))
      if (!vigente) return
      if (r.ok) {
        setPaginas(r.paginas)
        setError(null)
      } else setError(r.error)
    }, 500)
    return () => {
      vigente = false
      clearTimeout(t)
    }
  }, [clave])

  return (
    <div className="flex flex-col gap-3">
      {/* Con una sola pieza (la tarjeta de intro o de cierre) no hay nada que elegir. */}
      <div className={`flex-wrap gap-1.5 ${piezas.length > 1 ? "flex" : "hidden"}`} role="tablist" aria-label="Pieza de la vista previa">
        {piezas.map((p) => (
          <button
            key={p}
            type="button"
            role="tab"
            aria-selected={activa === p}
            onClick={() => setActiva(p)}
            className={`rounded-md border px-2.5 py-1 text-xs transition-colors ${
              activa === p ? "border-primary bg-primary text-primary-foreground" : "border-input text-muted-foreground hover:bg-accent"
            }`}
          >
            {NOMBRES[p]}
          </button>
        ))}
      </div>
      <Marco vertical={activa === "subtitulo"} html={paginas?.[activa] ?? null} titulo={NOMBRES[activa]} />
      {error ? (
        <p className="text-destructive text-sm" role="alert">
          No se pudo dibujar la vista previa: {error}
        </p>
      ) : null}
    </div>
  )
}

/** Un cuadro de video con la pieza encima, escalado al ancho que haya. */
function Marco({ html, vertical, titulo }: { html: string | null; vertical: boolean; titulo: string }) {
  const caja = React.useRef<HTMLDivElement>(null)
  const [ancho, setAncho] = React.useState(0)
  const [w, h] = vertical ? [1080, 1920] : [1920, 1080]

  React.useEffect(() => {
    const el = caja.current
    if (!el) return
    const medir = () => setAncho(el.clientWidth)
    medir()
    const ro = new ResizeObserver(medir)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const escala = ancho / w
  return (
    <div
      ref={caja}
      className={`relative w-full overflow-hidden rounded-lg border ${vertical ? "mx-auto max-w-[240px]" : ""}`}
      style={{
        aspectRatio: `${w} / ${h}`,
        // Un cuadro neutro, como un plano de video, para ver la pieza encima.
        background: "linear-gradient(135deg, #3a3532 0%, #1f1b19 55%, #2c2724 100%)",
      }}
    >
      {html && ancho > 0 ? (
        <iframe
          title={`Vista previa: ${titulo}`}
          srcDoc={html}
          sandbox=""
          tabIndex={-1}
          className="pointer-events-none absolute top-0 left-0 origin-top-left border-0"
          style={{ width: w, height: h, transform: `scale(${escala})` }}
        />
      ) : (
        <Skeleton className="absolute inset-0 rounded-none" />
      )}
    </div>
  )
}
