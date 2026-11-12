"use client"

import * as React from "react"
import { UploadIcon } from "lucide-react"

import { prepararSubidaVideoMarca, registrarVideoMarca, urlDeVideoMarca } from "@/app/marca/long-form-actions"
import { Segmentado } from "@/components/long-form/nuevo/comun"
import { Button } from "@/components/ui/button"
import { ACEPTA_VIDEO_MARCA, contenedorDe, formatoPorFirma, formatoVideoMarca, MAX_VIDEO_AUDIO_BYTES, MENSAJE_TAMANO_VIDEO_MARCA, MENSAJE_VIDEO_MARCA, mimeDe } from "@/engine/long-form/audio"
import type { Archivo, EstiloLongForm, Extremo, ModoExtremo, ParteExtremo } from "@/engine/long-form/estilo"

import { Campo } from "./campos"
import { VistaPrevia } from "./vista-previa"

/** Lo que el motor usa de un video propio: mas que esto ya no es una intro (editor/extremos.py). */
const MAX_S = 30

const TEXTO: Record<ParteExtremo, { titulo: string; sin: string; studio: string; video: string; ninguna: string }> = {
  intro: {
    titulo: "Intro",
    sin: "Sin intro",
    studio: "Lleva el título del video, quienes hablan y tu logo, con tus colores y tu fuente. Dura 5 s.",
    video: "MP4 o MOV, hasta 200 MB. Suena con su audio y dura lo que dure, hasta 30 s. Si no trae sonido, va tu música de inicio.",
    ninguna: "Los videos empiezan directo con la conversación, o con el gancho si lo hay.",
  },
  cierre: {
    titulo: "Cierre",
    sin: "Sin cierre",
    studio: "Lleva tu logo, el título del cierre, tu usuario y tu web. Dura 6 s.",
    video: "MP4 o MOV, hasta 200 MB. Suena con su audio y dura lo que dure, hasta 30 s. Si no trae sonido, va tu música de cierre.",
    ninguna: "Los videos terminan cuando termina la conversación.",
  },
}

/**
 * Marca > Long form > Intro y cierre: para cada uno, la tarjeta de Studio (con los textos que la arman y su
 * vista previa), un video que la marca ya tiene hecho, o nada. Cada video puede quitarlos al crearlo.
 */
export function IntroYCierre({ estilo, onCambio }: { estilo: EstiloLongForm; onCambio: (e: EstiloLongForm) => void }) {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      {(["intro", "cierre"] as const).map((parte) => (
        <Parte
          key={parte}
          parte={parte}
          estilo={estilo}
          onExtremo={(x) => onCambio({ ...estilo, [parte]: x })}
          onTexto={(clave, v) => onCambio({ ...estilo, textos: { ...estilo.textos, [clave]: v } })}
        />
      ))}
    </div>
  )
}

function Parte({
  parte,
  estilo,
  onExtremo,
  onTexto,
}: {
  parte: ParteExtremo
  estilo: EstiloLongForm
  onExtremo: (x: Extremo) => void
  onTexto: (clave: "pie_intro" | "cierre_titulo", v: string) => void
}) {
  const x = estilo[parte]
  const t = TEXTO[parte]
  return (
    <div className="flex min-w-0 flex-col gap-3 rounded-lg border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-medium">{t.titulo}</span>
        <Segmentado<ModoExtremo>
          etiqueta={t.titulo}
          valor={x.modo}
          opciones={[
            { valor: "studio", nombre: "Tarjeta de Studio" },
            { valor: "video", nombre: "Mi propio video" },
            { valor: "ninguna", nombre: t.sin },
          ]}
          onCambio={(modo) => onExtremo({ ...x, modo })}
        />
      </div>
      <p className="text-muted-foreground text-xs">{t[x.modo]}</p>
      {x.modo === "studio" ? (
        <>
          <VistaPrevia estilo={estilo} piezas={[parte === "intro" ? "tarjeta-intro" : "tarjeta-cierre"]} />
          {parte === "intro" ? (
            <Campo etiqueta="Pie de la intro" valor={estilo.textos.pie_intro} max={60} placeholder="El nombre de tu marca o del programa" onCambio={(v) => onTexto("pie_intro", v)} />
          ) : (
            <Campo etiqueta="Título del cierre" valor={estilo.textos.cierre_titulo} max={40} onCambio={(v) => onTexto("cierre_titulo", v)} />
          )}
          <p className="text-muted-foreground text-xs">El logo, los colores y la fuente se cambian más arriba{parte === "cierre" ? "; el usuario y la web, en Logo y redes" : ""}.</p>
        </>
      ) : null}
      {x.modo === "video" ? <VideoPropio parte={parte} video={x.video} onVideo={(video) => onExtremo({ modo: "video", video })} /> : null}
    </div>
  )
}

/** Valida en el navegador, sube directo a Storage y el servidor confirma la firma (como la musica). */
async function subirVideo(parte: ParteExtremo, f: File): Promise<{ ok: true; archivo: Archivo } | { ok: false; error: string }> {
  const formato = formatoVideoMarca(f.name, f.type)
  if (!formato) return { ok: false, error: MENSAJE_VIDEO_MARCA }
  if (f.size > MAX_VIDEO_AUDIO_BYTES) return { ok: false, error: MENSAJE_TAMANO_VIDEO_MARCA }
  const cabeza = new Uint8Array(await f.slice(0, 16).arrayBuffer())
  if (formatoPorFirma(cabeza) !== contenedorDe(formato)) return { ok: false, error: `${MENSAJE_VIDEO_MARCA} Este archivo no lo es por dentro.` }
  const p = await prepararSubidaVideoMarca({ parte, nombre: f.name, mime: f.type, bytes: f.size })
  if (!p.ok) return p
  const r = await fetch(p.url, { method: "PUT", body: f, headers: { "content-type": f.type || mimeDe(formato), "x-upsert": "false" } })
  if (!r.ok) return { ok: false, error: `No se pudo subir (HTTP ${r.status}). Intenta otra vez.` }
  return registrarVideoMarca({ ruta: p.ruta })
}

function VideoPropio({ parte, video, onVideo }: { parte: ParteExtremo; video: Archivo | null; onVideo: (a: Archivo) => void }) {
  const entrada = React.useRef<HTMLInputElement>(null)
  const [subiendo, setSubiendo] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [url, setUrl] = React.useState<string | null>(null)
  const [duracion, setDuracion] = React.useState<number | null>(null)
  // Solo cuando cambia el archivo (no cada vez que cambia el estilo): bucket y ruta lo identifican.
  const bucket = video?.bucket ?? null
  const ruta = video?.ruta ?? null

  React.useEffect(() => {
    if (!bucket || !ruta) return
    let vigente = true
    urlDeVideoMarca({ bucket, ruta }).then((r) => {
      if (!vigente) return
      if (r.ok) setUrl(r.url)
      else setError(r.error)
    })
    return () => {
      vigente = false
    }
  }, [bucket, ruta])

  const elegir = async (f: File | undefined) => {
    if (!f) return
    setError(null)
    setSubiendo(true)
    const r = await subirVideo(parte, f)
    setSubiendo(false)
    if (entrada.current) entrada.current.value = ""
    if (!r.ok) return setError(r.error)
    setUrl(null)
    setDuracion(null)
    onVideo(r.archivo)
  }

  return (
    <div className="flex flex-col gap-2">
      {video && url ? (
        <video
          key={url}
          src={url}
          controls
          preload="metadata"
          onLoadedMetadata={(ev) => setDuracion(Number.isFinite(ev.currentTarget.duration) ? ev.currentTarget.duration : null)}
          className="aspect-video w-full rounded-lg border bg-black object-contain"
        />
      ) : null}
      {!video ? <p className="text-muted-foreground text-xs">Sube tu video. Mientras no haya uno, va la tarjeta de Studio.</p> : null}
      {duracion && duracion > MAX_S ? <p className="text-muted-foreground text-xs">Dura {Math.round(duracion)} s: en los videos van los primeros {MAX_S} s.</p> : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" variant="outline" disabled={subiendo} onClick={() => entrada.current?.click()}>
          <UploadIcon />
          {subiendo ? "Subiendo..." : video ? "Cambiar video" : "Subir video"}
        </Button>
        <input ref={entrada} type="file" accept={ACEPTA_VIDEO_MARCA} className="sr-only" tabIndex={-1} aria-hidden onChange={(e) => elegir(e.target.files?.[0])} />
      </div>
      {error ? (
        <p className="text-destructive text-xs" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}
