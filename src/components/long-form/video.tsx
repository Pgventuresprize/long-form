"use client"

import * as React from "react"
import { CheckIcon, CopyIcon, DownloadIcon, PencilIcon } from "lucide-react"

import { corregir } from "@/app/long-form/actions"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import type { Proyecto } from "@/engine/long-form/datos"
import { mmss, tiempoDeSalida } from "@/engine/long-form/datos"

type Render = { version: number; archivo: string; duracion?: number; versiones?: { version: number; archivo: string }[] }
type Qa = { lufs?: number; pico_dbtp?: number; problemas?: string[]; avisos?: string[]; sensibles?: unknown[]; hoja?: string; resolucion?: string }

/**
 * El video listo: reproductor, control de calidad, versiones, descarga y "Corregir" (vuelve al guion desde lo
 * aprobado y sale una version nueva; las anteriores se conservan). Titulo, descripcion y capitulos para copiar.
 */
export function VistaVideo({ p, urls, alCorregir }: { p: Proyecto; urls: Record<string, string>; alCorregir: () => void }) {
  const render = p.estado.render as Render
  const qa = (p.estado.qa ?? {}) as Qa
  const [ocupado, start] = React.useTransition()
  const [error, setError] = React.useState<string | null>(null)
  const url = (nombre: string) => {
    const a = p.archivos.find((x) => x.nombre === nombre && x.tipo === "salida")
    return a ? urls[a.ruta] : undefined
  }
  const actual = url(render.archivo)
  const hoja = qa.hoja ? url(qa.hoja) : undefined

  const g = (p.estado.guion_aprobado ?? p.estado.guion ?? {}) as { capitulos?: { inicio: number; titulo: string }[]; youtube?: { titulo?: string; descripcion?: string } }
  const keep = (p.estado.keep ?? []) as [number, number][]
  const intro = Number((p.estado.graficos as { intro_s?: number } | undefined)?.intro_s ?? 0)
  // Los capitulos van en el tiempo del video editado: sin silencios ni cortes, y con la intro.
  const capitulos = (g.capitulos ?? []).map((c, i) => `${mmss(i === 0 ? 0 : tiempoDeSalida(keep, 30, intro, c.inicio))} ${c.titulo}`)
  const problemas = qa.problemas ?? []

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="flex flex-col gap-2">
          {/* La portada es la miniatura del tablero: el primer cuadro del video es la intro, casi siempre oscura. */}
          {actual ? <video src={actual} poster={p.miniatura ? urls[p.miniatura] : undefined} controls preload="metadata" className="aspect-video w-full rounded-xl bg-black" /> : null}
          <div className="flex flex-wrap items-center gap-2">
            {actual ? (
              <Button nativeButton={false} variant="brand" render={<a href={actual} download={render.archivo} />}>
                <DownloadIcon />
                Descargar
              </Button>
            ) : null}
            <Button
              variant="outline"
              disabled={ocupado}
              onClick={() =>
                start(async () => {
                  const r = await corregir(p.id)
                  if (!r.ok) setError(r.error)
                  else alCorregir()
                })
              }
            >
              <PencilIcon />
              Corregir
            </Button>
            <span className="text-muted-foreground text-xs">Corregir abre el guion otra vez; sale una versión nueva y esta se conserva.</span>
          </div>
          {error ? (
            <p className="text-destructive text-sm" role="alert">
              {error}
            </p>
          ) : null}
        </div>

        <div className="flex min-w-0 flex-col gap-3">
          <div className="flex flex-col gap-2 rounded-xl border p-4">
            <div className="flex items-center justify-between">
              <span className="font-medium">Control de calidad</span>
              <Badge variant={problemas.length ? "destructive" : "success"}>{problemas.length ? `${problemas.length} problemas` : "Sin problemas"}</Badge>
            </div>
            <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
              <dt className="text-muted-foreground">Sonido</dt>
              <dd className="tabular-nums">{qa.lufs !== undefined ? `${qa.lufs} LUFS` : "—"}</dd>
              <dt className="text-muted-foreground">Pico</dt>
              <dd className="tabular-nums">{qa.pico_dbtp !== undefined ? `${qa.pico_dbtp} dBTP` : "—"}</dd>
              <dt className="text-muted-foreground">Resolución</dt>
              <dd>{qa.resolucion ?? "—"}</dd>
              <dt className="text-muted-foreground">Duración</dt>
              <dd className="tabular-nums">{render.duracion ? mmss(render.duracion) : "—"}</dd>
            </dl>
            {[...problemas, ...(qa.avisos ?? [])].length ? (
              <ul className="list-disc pl-5 text-xs">
                {[...problemas, ...(qa.avisos ?? [])].map((a) => (
                  <li key={a}>{a}</li>
                ))}
              </ul>
            ) : null}
            {hoja ? (
              <a href={hoja} target="_blank" rel="noreferrer" className="text-sm underline-offset-4 hover:underline">
                Ver hoja de cuadros
              </a>
            ) : null}
          </div>

          <div className="flex flex-col gap-2 rounded-xl border p-4">
            <span className="font-medium">Versiones</span>
            <ul className="flex flex-col gap-1 text-sm">
              {[...(render.versiones ?? [{ version: render.version, archivo: render.archivo }])].reverse().map((v) => {
                const u = url(v.archivo)
                return (
                  <li key={v.version} className="flex items-center justify-between gap-2">
                    <span className="truncate">
                      v{v.version}
                      {v.version === render.version ? <span className="text-muted-foreground"> · la última</span> : null}
                    </span>
                    {u ? (
                      <a href={u} download={v.archivo} className="text-sm underline-offset-4 hover:underline">
                        Descargar
                      </a>
                    ) : null}
                  </li>
                )
              })}
            </ul>
          </div>
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        <Copiable titulo="Título" texto={g.youtube?.titulo || p.titulo} />
        <Copiable titulo="Descripción" texto={g.youtube?.descripcion ?? ""} />
        <Copiable titulo="Capítulos" texto={capitulos.join("\n")} />
      </div>
    </div>
  )
}

function Copiable({ titulo, texto }: { titulo: string; texto: string }) {
  const [copiado, setCopiado] = React.useState(false)
  return (
    <div className="flex min-w-0 flex-col gap-2 rounded-xl border p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium">{titulo}</span>
        <Button
          size="sm"
          variant="ghost"
          disabled={!texto}
          onClick={async () => {
            await navigator.clipboard.writeText(texto)
            setCopiado(true)
            setTimeout(() => setCopiado(false), 1500)
          }}
        >
          {copiado ? <CheckIcon /> : <CopyIcon />}
          {copiado ? "Copiado" : "Copiar"}
        </Button>
      </div>
      <pre className="text-muted-foreground max-h-48 overflow-auto font-sans text-sm whitespace-pre-wrap">{texto || "Sin texto todavía."}</pre>
    </div>
  )
}
