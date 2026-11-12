"use client"

import * as React from "react"
import { ArrowDownIcon, ArrowUpIcon, FileAudioIcon, FileVideoIcon, GripVerticalIcon, LibraryIcon, XIcon } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { ACEPTA_ENTRADA, encajaEnTipo, MENSAJE_ENTRADA, mover } from "@/engine/long-form/nuevo"
import type { ClipPrevio } from "@/engine/long-form/nuevo-datos"

import { duracionTexto, ErrorCampo, FilaArchivo, medirDuracion, nuevoId, Paso, sinRepetir, tamano, ZonaArchivos } from "./comun"
import { duracionClip, nombreClip, type Clip } from "./tipos"

const MAX_CLIPS = 12

/**
 * Paso 2: los videos que se editan, en el orden en que el motor los lee. Se suben o se eligen de lo que la marca
 * ya subio (eso no se vuelve a subir). El audio grabado aparte es opcional y se pide aparte: nunca se adivina.
 */
export function PasoClips({
  clips,
  onClips,
  audio,
  onAudio,
  previos,
  error,
  deshabilitado,
}: {
  clips: Clip[]
  onClips: (f: (xs: Clip[]) => Clip[]) => void
  audio: File | null
  onAudio: (f: File | null) => void
  previos: ClipPrevio[]
  error: string | null
  deshabilitado: boolean
}) {
  const [aviso, setAviso] = React.useState<string | null>(null)
  const [avisoAudio, setAvisoAudio] = React.useState<string | null>(null)
  const [biblioteca, setBiblioteca] = React.useState(false)
  const arrastrado = React.useRef<number | null>(null)

  const agregar = (fs: File[]) => {
    const malos = fs.filter((f) => !encajaEnTipo(f.name, "fuente"))
    const buenos = sinRepetir(clips, fs.filter((f) => encajaEnTipo(f.name, "fuente")), (c) => (c.origen === "subida" ? c.archivo : null))
    const libres = MAX_CLIPS - clips.length
    setAviso(malos.length ? `${malos[0].name} ${MENSAJE_ENTRADA.fuente}` : buenos.length > libres ? `Como mucho ${MAX_CLIPS} videos para editar.` : null)
    const nuevos: Clip[] = buenos.slice(0, Math.max(0, libres)).map((archivo) => ({ id: nuevoId(), origen: "subida", archivo, duracion: null }))
    if (!nuevos.length) return
    onClips((xs) => [...xs, ...nuevos])
    // La duracion la lee el navegador; mientras tanto la fila ya ocupa su sitio.
    for (const c of nuevos) {
      if (c.origen !== "subida") continue
      medirDuracion(c.archivo).then((d) => d && onClips((xs) => xs.map((x) => (x.id === c.id && x.origen === "subida" ? { ...x, duracion: d } : x))))
    }
  }

  const total = clips.reduce((s, c) => s + (duracionClip(c) ?? 0), 0)
  const elegidos = new Set(clips.flatMap((c) => (c.origen === "biblioteca" ? [c.previo.id] : [])))

  return (
    <Paso
      n={2}
      id="paso-clips"
      titulo="Clips para editar"
      descripcion="La grabación en bruto. Ordénala como quieres que se lea: cada cámara o cada parte."
      meta={clips.length ? `${clips.length} ${clips.length === 1 ? "clip" : "clips"}${total ? ` · ${duracionTexto(total)}` : ""}` : null}
    >
      <ZonaArchivos acepta={ACEPTA_ENTRADA.fuente} boton="Subir videos" ayuda="Suelta aquí los videos. MP4, MOV, M4V, MKV o WebM." onArchivos={agregar} deshabilitado={deshabilitado}>
        {previos.length ? (
          <Button type="button" variant="ghost" disabled={deshabilitado} onClick={() => setBiblioteca(true)}>
            <LibraryIcon />
            Elegir de la biblioteca
          </Button>
        ) : null}
      </ZonaArchivos>
      <ErrorCampo>{aviso ?? error}</ErrorCampo>

      {clips.length ? (
        <ol className="ring-foreground/10 flex flex-col divide-y rounded-xl ring-1" aria-label="Orden de los clips">
          {clips.map((c, i) => (
            <FilaArchivo
              key={c.id}
              draggable={!deshabilitado}
              onDragStart={(e) => {
                arrastrado.current = i
                e.dataTransfer.effectAllowed = "move"
              }}
              onDragOver={(e) => {
                if (arrastrado.current === null) return
                e.preventDefault()
              }}
              onDrop={(e) => {
                const desde = arrastrado.current
                arrastrado.current = null
                if (desde === null || desde === i) return
                e.preventDefault()
                e.stopPropagation()
                onClips((xs) => {
                  const out = [...xs]
                  const [x] = out.splice(desde, 1)
                  out.splice(i, 0, x)
                  return out
                })
              }}
              onDragEnd={() => (arrastrado.current = null)}
              icono={
                <span className="flex items-center gap-1">
                  <GripVerticalIcon className="hidden cursor-grab sm:block" />
                  <span className="bg-muted text-foreground flex size-6 items-center justify-center rounded-md text-xs font-medium tabular-nums">{i + 1}</span>
                </span>
              }
              nombre={nombreClip(c)}
              detalle={
                <span className="flex items-center gap-1.5">
                  {c.origen === "biblioteca" ? (
                    <Badge variant="secondary" className="h-4 px-1.5 text-[0.65rem]">
                      Biblioteca
                    </Badge>
                  ) : null}
                  <span className="truncate">
                    {[c.origen === "subida" ? tamano(c.archivo.size) : tamano(c.previo.bytes), duracionTexto(duracionClip(c)) || (c.origen === "subida" ? "midiendo…" : ""), c.origen === "biblioteca" ? c.previo.proyecto : ""].filter(Boolean).join(" · ")}
                  </span>
                </span>
              }
            >
              <Button type="button" size="icon-sm" variant="ghost" aria-label={`Subir ${nombreClip(c)} en el orden`} disabled={deshabilitado || i === 0} onClick={() => onClips((xs) => mover(xs, i, -1))}>
                <ArrowUpIcon />
              </Button>
              <Button type="button" size="icon-sm" variant="ghost" aria-label={`Bajar ${nombreClip(c)} en el orden`} disabled={deshabilitado || i === clips.length - 1} onClick={() => onClips((xs) => mover(xs, i, 1))}>
                <ArrowDownIcon />
              </Button>
              <Button type="button" size="icon-sm" variant="ghost" aria-label={`Quitar ${nombreClip(c)}`} disabled={deshabilitado} onClick={() => onClips((xs) => xs.filter((x) => x.id !== c.id))}>
                <XIcon />
              </Button>
            </FilaArchivo>
          ))}
        </ol>
      ) : (
        <p className="text-muted-foreground text-sm">Todavía no hay clips. Sube al menos un video para empezar.</p>
      )}

      <div className="flex flex-col gap-2 border-t pt-4">
        <p className="text-sm font-medium">¿Grabaste el audio aparte?</p>
        {audio ? (
          <ul className="ring-foreground/10 rounded-xl ring-1">
            <FilaArchivo icono={<FileAudioIcon />} nombre={audio.name} detalle={`${tamano(audio.size)} · reemplaza el audio de las cámaras`}>
              <Button type="button" size="icon-sm" variant="ghost" aria-label={`Quitar ${audio.name}`} disabled={deshabilitado} onClick={() => onAudio(null)}>
                <XIcon />
              </Button>
            </FilaArchivo>
          </ul>
        ) : (
          <ZonaArchivos
            compacta
            multiple={false}
            acepta={ACEPTA_ENTRADA.audio}
            boton="Subir el audio"
            ayuda="Opcional. Si lo grabaste con otro micrófono, se usa en lugar del de las cámaras."
            deshabilitado={deshabilitado}
            onArchivos={(fs) => {
              const f = fs[0]
              if (!encajaEnTipo(f.name, "audio")) return setAvisoAudio(`${f.name} ${MENSAJE_ENTRADA.audio}`)
              setAvisoAudio(null)
              onAudio(f)
            }}
          />
        )}
        <ErrorCampo>{avisoAudio}</ErrorCampo>
      </div>

      <DialogoBiblioteca
        abierto={biblioteca}
        onAbierto={setBiblioteca}
        previos={previos}
        elegidos={elegidos}
        libres={MAX_CLIPS - clips.length}
        onElegir={(ps) => onClips((xs) => [...xs, ...ps.map((previo): Clip => ({ id: nuevoId(), origen: "biblioteca", previo }))])}
      />
    </Paso>
  )
}

/** Los videos que la marca ya subio en otros proyectos: se marcan y se agregan al final de la lista. */
function DialogoBiblioteca({
  abierto,
  onAbierto,
  previos,
  elegidos,
  libres,
  onElegir,
}: {
  abierto: boolean
  onAbierto: (v: boolean) => void
  previos: ClipPrevio[]
  elegidos: Set<string>
  libres: number
  onElegir: (ps: ClipPrevio[]) => void
}) {
  const [marcados, setMarcados] = React.useState<string[]>([])
  const cerrar = (v: boolean) => {
    if (!v) setMarcados([])
    onAbierto(v)
  }
  const disponibles = previos.filter((p) => !elegidos.has(p.id))
  return (
    <Dialog open={abierto} onOpenChange={cerrar}>
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Elegir de la biblioteca</DialogTitle>
          <DialogDescription>Lo que esta marca ya subió en otros videos. No se vuelve a subir.</DialogDescription>
        </DialogHeader>
        {disponibles.length ? (
          <ul className="-mx-1 flex min-h-0 flex-col overflow-y-auto px-1" aria-label="Videos de la biblioteca">
            {disponibles.map((p) => {
              const marcado = marcados.includes(p.id)
              const lleno = !marcado && marcados.length >= libres
              return (
                <li key={p.id}>
                  <label className={`hover:bg-muted flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2 text-sm ${lleno ? "opacity-50" : ""}`}>
                    <input
                      type="checkbox"
                      className="accent-foreground size-4 shrink-0"
                      checked={marcado}
                      disabled={lleno}
                      onChange={(e) => setMarcados((xs) => (e.target.checked ? [...xs, p.id] : xs.filter((x) => x !== p.id)))}
                    />
                    <FileVideoIcon className="text-muted-foreground size-4 shrink-0" aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{p.nombre}</span>
                      <span className="text-muted-foreground block truncate text-xs tabular-nums">{[tamano(p.bytes), duracionTexto(p.duracion), p.proyecto].filter(Boolean).join(" · ")}</span>
                    </span>
                  </label>
                </li>
              )
            })}
          </ul>
        ) : (
          <p className="text-muted-foreground text-sm">Ya agregaste todo lo de la biblioteca.</p>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => cerrar(false)}>
            Cancelar
          </Button>
          <Button
            type="button"
            disabled={!marcados.length}
            onClick={() => {
              // En el orden de la biblioteca (lo mas nuevo primero), como se ven en la lista.
              onElegir(disponibles.filter((p) => marcados.includes(p.id)))
              cerrar(false)
            }}
          >
            {marcados.length ? `Agregar ${marcados.length}` : "Agregar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
