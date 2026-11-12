"use client"

import * as React from "react"

import { vistaPreviaLongForm } from "@/app/marca/long-form-actions"
import type { EstiloLongForm } from "@/engine/long-form/estilo"
import { NOMBRE_DURACION, NOMBRE_TRIESTADO, NOMBRE_USO, USOS_MUSICA, type FormatoVideo, type OpcionesVideo, type UsoMusica } from "@/engine/long-form/nuevo"
import type { MarcaNuevo } from "@/engine/long-form/nuevo-datos"

import { duracionTexto, Segmentado } from "./comun"
import { duracionClip, nombreClip, nombrePista, type Apoyo, type Clip, type Pista } from "./tipos"

const PIXELES: Record<FormatoVideo, [number, number]> = { "16:9": [1920, 1080], "9:16": [1080, 1920], "1:1": [1080, 1080] }
// Las piezas se dibujan a 1920x1080. En vertical y cuadrado se agrandan y se anclan abajo a la izquierda, donde
// van el rotulo y la barra: es una vista aproximada, no el cuadro exacto.
const ZOOM: Record<FormatoVideo, number> = { "16:9": 1, "1:1": 1.5, "9:16": 2.2 }

type Pieza = "rotulo" | "barra"

/**
 * "Asi se vera": la marca encima de un cuadro con el formato elegido, una linea de tiempo del material y el
 * resumen de lo que se va a pedir. El rotulo y la barra son el mismo HTML que dibuja el motor
 * (vistaPreviaLongForm); sin permiso para pedirlo, una version simple con los colores de la marca.
 */
export function AsiSeVera({
  marca,
  estilo,
  conVistaPrevia,
  opciones,
  clips,
  apoyo,
  audio,
  pistas,
  deLaMarca,
  referente,
}: {
  marca: MarcaNuevo
  estilo: EstiloLongForm
  conVistaPrevia: boolean
  opciones: OpcionesVideo
  clips: Clip[]
  apoyo: Apoyo[]
  audio: File | null
  pistas: Pista[]
  deLaMarca: Record<UsoMusica, string | null>
  /** Null: el estilo de la marca. */
  referente: string | null
}) {
  const [pieza, setPieza] = React.useState<Pieza>("rotulo")
  const total = clips.reduce((s, c) => s + (duracionClip(c) ?? 0), 0)
  const musica = Object.fromEntries(USOS_MUSICA.map((u) => [u, pistas.find((p) => p.uso === u) ?? null])) as Record<UsoMusica, Pista | null>

  const audioTexto = [
    audio ? "Audio aparte" : null,
    USOS_MUSICA.map((u) => `${NOMBRE_USO[u]}: ${musica[u] ? "elegida" : deLaMarca[u] ? "de tu marca" : "sin música"}`).join(" · "),
  ]
    .filter(Boolean)
    .join(" · ")

  return (
    <aside aria-label="Así se verá" className="flex flex-col gap-4 lg:sticky lg:top-20">
      <div className="bg-card ring-foreground/10 flex flex-col gap-3 rounded-xl p-4 ring-1">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-medium">Así se verá</h2>
          <span className="text-muted-foreground text-xs tabular-nums">
            {opciones.formato} · {PIXELES[opciones.formato].join("×")}
          </span>
        </div>
        <Cuadro marca={marca} estilo={estilo} conVistaPrevia={conVistaPrevia} formato={opciones.formato} pieza={pieza} clip={clips.find((c) => c.origen === "subida") ?? null} />
        <Segmentado
          etiqueta="Pieza de la vista previa"
          valor={pieza}
          opciones={[
            { valor: "rotulo", nombre: "Rótulo" },
            { valor: "barra", nombre: "Barra con CTA" },
          ]}
          onCambio={setPieza}
          className="self-start"
        />
        <LineaDeTiempo marca={marca} clips={clips} apoyo={apoyo} audio={audio} musica={musica} deLaMarca={deLaMarca} total={total} />
      </div>

      <dl className="bg-card ring-foreground/10 flex flex-col divide-y rounded-xl px-4 text-sm ring-1">
        {[
          ["Marca", marca.nombre],
          ["Material", clips.length ? `${clips.length} ${clips.length === 1 ? "clip" : "clips"}${total ? ` · ${duracionTexto(total)}` : ""}` : <span key="f" className="text-destructive">Falta al menos un clip</span>],
          ["Apoyo", apoyo.length ? `${apoyo.length} ${apoyo.length === 1 ? "archivo" : "archivos"}` : "Ninguno"],
          ["Audio", audioTexto],
          ["Estilo de edición", referente ? `Imitar: ${referente}` : "El de tu marca"],
          [
            "Entrega",
            [
              opciones.formato,
              NOMBRE_DURACION[opciones.duracion],
              `Subtítulos ${NOMBRE_TRIESTADO[opciones.subtitulos].toLowerCase()}`,
              `Gancho ${NOMBRE_TRIESTADO[opciones.gancho].toLowerCase()}`,
              opciones.capitulos ? "Con capítulos" : "Sin capítulos",
              opciones.intro ? null : "Sin intro",
              opciones.cierre ? null : "Sin cierre",
            ]
              .filter(Boolean)
              .join(" · "),
          ],
        ].map(([k, v]) => (
          <div key={String(k)} className="flex gap-3 py-2.5">
            <dt className="text-muted-foreground w-28 shrink-0">{k}</dt>
            <dd className="min-w-0 flex-1 break-words">{v}</dd>
          </div>
        ))}
      </dl>
    </aside>
  )
}

function Cuadro({ marca, estilo, conVistaPrevia, formato, pieza, clip }: { marca: MarcaNuevo; estilo: EstiloLongForm; conVistaPrevia: boolean; formato: FormatoVideo; pieza: Pieza; clip: Clip | null }) {
  const caja = React.useRef<HTMLDivElement>(null)
  const [medida, setMedida] = React.useState({ w: 0, h: 0 })
  const [paginas, setPaginas] = React.useState<Partial<Record<string, string>> | null>(null)
  const [w, h] = PIXELES[formato]

  // El estilo no cambia en esta pantalla: se pide una vez.
  React.useEffect(() => {
    if (!conVistaPrevia) return
    let vigente = true
    vistaPreviaLongForm(estilo).then((r) => vigente && r.ok && setPaginas(r.paginas))
    return () => {
      vigente = false
    }
  }, [estilo, conVistaPrevia])

  React.useEffect(() => {
    const el = caja.current
    if (!el) return
    const medir = () => setMedida({ w: el.clientWidth, h: el.clientHeight })
    medir()
    const ro = new ResizeObserver(medir)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // El primer video subido, como fondo: el navegador muestra su primer cuadro.
  const archivo = clip?.origen === "subida" ? clip.archivo : null

  const html = paginas?.[pieza] ?? null
  const escala = (medida.w / 1920) * ZOOM[formato]
  return (
    <div
      ref={caja}
      className={`relative mx-auto w-full overflow-hidden rounded-lg ${formato === "9:16" ? "max-w-[220px]" : formato === "1:1" ? "max-w-[300px]" : ""}`}
      style={{ aspectRatio: `${w} / ${h}`, background: "linear-gradient(135deg, #3a3532 0%, #1f1b19 55%, #2c2724 100%)" }}
    >
      {archivo ? <FondoVideo archivo={archivo} /> : null}
      {html && medida.w > 0 ? (
        <iframe
          title={`Vista previa: ${pieza === "rotulo" ? "rótulo" : "barra con CTA"} de ${marca.nombre}`}
          srcDoc={html}
          sandbox=""
          tabIndex={-1}
          className="pointer-events-none absolute left-0 origin-top-left border-0"
          style={{ width: 1920, height: 1080, top: medida.h - 1080 * escala, transform: `scale(${escala})` }}
        />
      ) : (
        <PiezaSimple marca={marca} pieza={pieza} />
      )}
    </div>
  )
}

/** El primer video subido como fondo del cuadro: el navegador muestra su primer cuadro, sin subir nada. */
function FondoVideo({ archivo }: { archivo: File }) {
  const ref = React.useRef<HTMLVideoElement>(null)
  React.useEffect(() => {
    const el = ref.current
    if (!el) return
    const url = URL.createObjectURL(archivo)
    el.src = url
    return () => {
      el.removeAttribute("src")
      el.load()
      URL.revokeObjectURL(url)
    }
  }, [archivo])
  return <video ref={ref} muted playsInline preload="metadata" aria-hidden tabIndex={-1} className="absolute inset-0 size-full object-cover opacity-80" />
}

/** Sin la vista del motor: una barra con el color, el sello y el nombre de la marca. */
function PiezaSimple({ marca, pieza }: { marca: MarcaNuevo; pieza: Pieza }) {
  return (
    <div className="absolute inset-x-[5%] bottom-[8%] flex items-center gap-2 rounded-md p-1.5 pr-3" style={{ background: pieza === "barra" ? marca.acento : marca.tinta, color: pieza === "barra" ? marca.tinta : "#fff", maxWidth: pieza === "barra" ? "90%" : "60%" }}>
      <span className="size-4 shrink-0 rounded-full" style={{ background: `linear-gradient(180deg, ${(marca.degradado.length ? marca.degradado : [marca.acento, marca.acento]).join(", ")})` }} aria-hidden />
      <span className="truncate text-[0.65rem] font-medium">{pieza === "barra" ? `Sigue a ${marca.nombre}` : marca.nombre}</span>
    </div>
  )
}

function LineaDeTiempo({
  marca,
  clips,
  apoyo,
  audio,
  musica,
  deLaMarca,
  total,
}: {
  marca: MarcaNuevo
  clips: Clip[]
  apoyo: Apoyo[]
  audio: File | null
  musica: Record<UsoMusica, Pista | null>
  deLaMarca: Record<UsoMusica, string | null>
  total: number
}) {
  // Un clip sin duracion conocida pesa como el promedio de los que si la tienen.
  const conocidas = clips.map(duracionClip).filter((d): d is number => Boolean(d))
  const media = conocidas.length ? conocidas.reduce((a, b) => a + b, 0) / conocidas.length : 1
  const tramo = (u: UsoMusica) => {
    const p = musica[u]
    if (!p && !deLaMarca[u]) return null
    const titulo = `${NOMBRE_USO[u]}: ${p ? nombrePista(p) : `${deLaMarca[u]} (de tu marca)`}`
    const pos = u === "intro" ? { left: 0, width: "7%" } : u === "cierre" ? { right: 0, width: "7%" } : { left: "8%", right: "8%" }
    return <span key={u} title={titulo} className="absolute inset-y-0 rounded-sm" style={{ ...pos, background: marca.acento, opacity: p ? 1 : 0.35 }} />
  }
  const fila = (nombre: string, contenido: React.ReactNode) => (
    <div className="flex items-center gap-2">
      <span className="text-muted-foreground w-12 shrink-0 text-[0.65rem] font-medium tracking-wide uppercase">{nombre}</span>
      <div className="bg-muted relative h-3 min-w-0 flex-1 overflow-hidden rounded-sm">{contenido}</div>
    </div>
  )
  return (
    <div className="flex flex-col gap-1.5" role="img" aria-label={`Línea de tiempo: ${clips.length} clips${total ? `, ${duracionTexto(total)}` : ""}, ${apoyo.length} archivos de apoyo.`}>
      {fila(
        "Video",
        <div className="flex size-full gap-px">
          {clips.map((c, i) => (
            <span key={c.id} title={nombreClip(c)} className="h-full rounded-[2px]" style={{ flex: duracionClip(c) ?? media, background: i % 2 ? marca.tinta : marca.acento, opacity: i % 2 ? 0.85 : 1 }} />
          ))}
        </div>
      )}
      {fila(
        "Apoyo",
        clips.length
          ? apoyo.map((a, i) => <span key={a.id} title={a.archivo.name} className="bg-foreground/60 absolute inset-y-0 w-1 rounded-full" style={{ left: `calc(${(((i + 1) / (apoyo.length + 1)) * 100).toFixed(1)}% - 2px)` }} />)
          : null
      )}
      {fila("Música", USOS_MUSICA.map(tramo))}
      {audio ? fila("Voz", <span title={audio.name} className="bg-foreground/40 absolute inset-0 rounded-sm" />) : null}
      <div className="text-muted-foreground flex justify-between pl-14 text-[0.65rem] tabular-nums">
        {total ? (
          <>
            <span>0:00</span>
            <span>{duracionTexto(total / 2)}</span>
            <span>{duracionTexto(total)}</span>
          </>
        ) : (
          <span>{clips.length ? "Duración por medir" : "Sin material"}</span>
        )}
      </div>
    </div>
  )
}
