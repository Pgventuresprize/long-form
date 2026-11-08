"use client"

import * as React from "react"
import { PauseIcon, PlayIcon, UploadIcon } from "lucide-react"

import { prepararSubidaAudio, registrarAudio, urlDeAudio } from "@/app/marca/long-form-actions"
import { Button } from "@/components/ui/button"
import { ACEPTA_AUDIO, formatoPorFirma, formatoPorNombre, MAX_AUDIO_BYTES, MENSAJE_FORMATO } from "@/engine/long-form/audio"
import type { Audio } from "@/engine/long-form/estilo-datos"

/** La duracion la lee el navegador; el motor la vuelve a medir con ffprobe. */
function duracionDe(archivo: File): Promise<number | null> {
  return new Promise((resolver) => {
    const url = URL.createObjectURL(archivo)
    const a = new window.Audio()
    a.preload = "metadata"
    a.onloadedmetadata = () => {
      URL.revokeObjectURL(url)
      resolver(Number.isFinite(a.duration) ? a.duration : null)
    }
    a.onerror = () => {
      URL.revokeObjectURL(url)
      resolver(null)
    }
    a.src = url
  })
}

/** Sube un MP3 o WAV: valida en el navegador, sube directo a Storage y el servidor confirma la firma. */
export async function subirAudio(archivo: File, tipo: "musica" | "sfx", momento: string | null): Promise<{ ok: true; audio: Audio } | { ok: false; error: string }> {
  const formato = formatoPorNombre(archivo.name, archivo.type)
  if (!formato) return { ok: false, error: MENSAJE_FORMATO }
  if (archivo.size > MAX_AUDIO_BYTES) return { ok: false, error: "El archivo no puede pasar de 50 MB." }
  // La firma tambien en el navegador: asi un MP4 renombrado se rechaza antes de subirlo.
  const cabeza = new Uint8Array(await archivo.slice(0, 16).arrayBuffer())
  if (formatoPorFirma(cabeza) !== formato) return { ok: false, error: `${MENSAJE_FORMATO} Este archivo no lo es por dentro.` }

  const p = await prepararSubidaAudio({ nombre: archivo.name, mime: archivo.type, bytes: archivo.size })
  if (!p.ok) return p
  const r = await fetch(p.url, { method: "PUT", body: archivo, headers: { "content-type": archivo.type || (formato === "mp3" ? "audio/mpeg" : "audio/wav"), "x-upsert": "false" } })
  if (!r.ok) return { ok: false, error: `No se pudo subir (HTTP ${r.status}). Intenta otra vez.` }
  const duracion = await duracionDe(archivo)
  const g = await registrarAudio({ ruta: p.ruta, nombre: archivo.name, tipo, momento, duracion })
  if (!g.ok) return g
  return { ok: true, audio: { id: g.id, tipo, momento, nombre: archivo.name, formato, bytes: archivo.size, duracion } }
}

/**
 * Elegir un audio de la biblioteca para un momento, escucharlo o subir uno nuevo. Sin audio es una
 * opcion valida.
 */
export function SelectorAudio({
  etiqueta,
  tipo,
  momento,
  valor,
  biblioteca,
  onCambio,
  onSubido,
}: {
  etiqueta: string
  tipo: "musica" | "sfx"
  momento: string
  valor: string | null | undefined
  biblioteca: Audio[]
  onCambio: (id: string | null) => void
  onSubido: (a: Audio) => void
}) {
  const id = React.useId()
  const entrada = React.useRef<HTMLInputElement>(null)
  const [subiendo, setSubiendo] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [sonando, setSonando] = React.useState<HTMLAudioElement | null>(null)
  const opciones = biblioteca.filter((a) => a.tipo === tipo)

  const elegir = async (f: File | undefined) => {
    if (!f) return
    setError(null)
    setSubiendo(true)
    const r = await subirAudio(f, tipo, momento)
    setSubiendo(false)
    if (entrada.current) entrada.current.value = ""
    if (!r.ok) return setError(r.error)
    onSubido(r.audio)
    onCambio(r.audio.id)
  }

  const escuchar = async () => {
    if (sonando) {
      sonando.pause()
      setSonando(null)
      return
    }
    if (!valor) return
    const r = await urlDeAudio(valor)
    if (!r.ok) return setError(r.error)
    const a = new window.Audio(r.url)
    a.onended = () => setSonando(null)
    await a.play().catch(() => setError("El navegador no dejó reproducirlo."))
    setSonando(a)
  }

  React.useEffect(() => () => sonando?.pause(), [sonando])

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {etiqueta}
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <select
          id={id}
          value={valor ?? ""}
          onChange={(e) => onCambio(e.target.value || null)}
          className="border-input bg-background h-8 min-w-0 flex-1 rounded-md border px-2 text-sm sm:max-w-72"
        >
          <option value="">Sin {tipo === "musica" ? "música" : "efecto"}</option>
          {opciones.map((a) => (
            <option key={a.id} value={a.id}>
              {a.nombre}
              {a.duracion ? ` · ${Math.round(a.duracion)} s` : ""}
            </option>
          ))}
        </select>
        <Button type="button" size="icon" variant="outline" disabled={!valor} onClick={escuchar} aria-label={sonando ? "Detener" : "Escuchar"}>
          {sonando ? <PauseIcon /> : <PlayIcon />}
        </Button>
        <Button type="button" size="sm" variant="outline" disabled={subiendo} onClick={() => entrada.current?.click()}>
          <UploadIcon />
          {subiendo ? "Subiendo..." : "Subir MP3 o WAV"}
        </Button>
        <input ref={entrada} type="file" accept={ACEPTA_AUDIO} className="sr-only" tabIndex={-1} aria-hidden onChange={(e) => elegir(e.target.files?.[0])} />
      </div>
      {error ? (
        <p className="text-destructive text-xs" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}
