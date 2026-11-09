"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { FileVideoIcon, UploadCloudIcon, XIcon } from "lucide-react"

import { crearProyecto } from "@/app/long-form/actions"
import { Opciones } from "@/components/marca/long-form/campos"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { NIVELES, NOMBRE_NIVEL, type Nivel } from "@/engine/long-form/estilo"

import { useSubidas } from "./subidas"

const ACEPTA = ".mp4,.mov,.m4v,.mkv,.webm,.mp3,.wav,.m4a,.pdf,.png,.jpg,.jpeg,.webp,video/*,audio/*,application/pdf,image/*"

const DETALLE: Record<Nivel, string> = {
  rapido: "Solo revisas la difusión. La IA decide nombres y guion.",
  normal: "Revisas el guion. Quién es quién solo si hay dudas.",
  detallado: "Revisas quién es quién, el guion y la difusión.",
}

function tamano(b: number): string {
  return b >= 1e9 ? `${(b / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(b / 1e6))} MB`
}

/**
 * Nuevo video: archivos, titulo, nivel, notas y CTA por defecto. "Empezar" crea el proyecto y las subidas
 * arrancan en el gestor global: se puede ir a otra pantalla y siguen.
 */
export function NuevoVideo({ ctas, nivelDefecto, ctaDefecto }: { ctas: { clave: string; nombre: string }[]; nivelDefecto: Nivel; ctaDefecto: string | null }) {
  const router = useRouter()
  const { iniciar } = useSubidas()
  const [archivos, setArchivos] = React.useState<File[]>([])
  const [titulo, setTitulo] = React.useState("")
  const [nivel, setNivel] = React.useState<Nivel>(nivelDefecto)
  const [notas, setNotas] = React.useState("")
  const [cta, setCta] = React.useState<string>(ctaDefecto ?? "")
  const [encima, setEncima] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [ocupado, start] = React.useTransition()
  const entrada = React.useRef<HTMLInputElement>(null)

  const agregar = (lista: FileList | null) => {
    if (!lista) return
    const nuevos = [...lista]
    setArchivos((xs) => [...xs, ...nuevos.filter((n) => !xs.some((x) => x.name === n.name && x.size === n.size))].slice(0, 12))
    if (!titulo && nuevos[0]) setTitulo(nuevos[0].name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").slice(0, 120))
  }

  const empezar = () =>
    start(async () => {
      setError(null)
      const r = await crearProyecto({ titulo, esfuerzo: nivel, notas, ctaDefecto: cta || null, archivos: archivos.map((a) => ({ nombre: a.name, bytes: a.size })) })
      if (!r.ok) return setError(r.error)
      // Cada firma con su archivo: la ruta lleva su posicion en la lista ("entrada/3-nombre.mp4").
      iniciar(
        r.id,
        r.destino,
        r.subidas,
        r.subidas.map((s) => archivos[Number(/\/entrada\/(\d+)-/.exec(s.ruta)?.[1] ?? 1) - 1])
      )
      router.push(`/long-form/${r.id}`)
    })

  const videos = archivos.filter((a) => /^video\//.test(a.type) || /\.(mp4|mov|m4v|mkv|webm)$/i.test(a.name)).length
  const valido = videos > 0 && titulo.trim().length > 0

  return (
    <div className="flex max-w-3xl flex-col gap-5">
      <div
        role="button"
        tabIndex={0}
        aria-label="Agregar archivos: suelta aquí los videos o elige desde tu equipo"
        onClick={() => entrada.current?.click()}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && entrada.current?.click()}
        onDragOver={(e) => {
          e.preventDefault()
          setEncima(true)
        }}
        onDragLeave={() => setEncima(false)}
        onDrop={(e) => {
          e.preventDefault()
          setEncima(false)
          agregar(e.dataTransfer.files)
        }}
        className={`flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed px-4 py-10 text-center transition-colors ${
          encima ? "border-primary bg-muted" : "border-input hover:bg-muted/50"
        }`}
      >
        <UploadCloudIcon className="text-muted-foreground size-8" aria-hidden />
        <p className="font-medium">Suelta aquí los videos de la grabación</p>
        <p className="text-muted-foreground text-sm">Uno o varios: cada cámara, las partes de una grabación, un audio aparte, el PDF de la charla o fotos.</p>
        <input ref={entrada} type="file" multiple accept={ACEPTA} className="sr-only" tabIndex={-1} aria-hidden onChange={(e) => agregar(e.target.files)} />
      </div>

      {archivos.length ? (
        <ul className="flex flex-col divide-y rounded-xl border">
          {archivos.map((a) => (
            <li key={`${a.name}-${a.size}`} className="flex items-center gap-3 px-3 py-2 text-sm">
              <FileVideoIcon className="text-muted-foreground size-4 shrink-0" aria-hidden />
              <span className="min-w-0 flex-1 truncate">{a.name}</span>
              <span className="text-muted-foreground shrink-0 tabular-nums">{tamano(a.size)}</span>
              <Button type="button" size="icon" variant="ghost" aria-label={`Quitar ${a.name}`} disabled={ocupado} onClick={() => setArchivos((xs) => xs.filter((x) => x !== a))}>
                <XIcon />
              </Button>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="lf-titulo">Título</Label>
        <Input id="lf-titulo" value={titulo} maxLength={160} onChange={(e) => setTitulo(e.target.value)} placeholder="Por ejemplo: IA en deportes, con César" />
      </div>

      <Opciones etiqueta="Nivel de esfuerzo" valor={nivel} opciones={NIVELES.map((n) => ({ valor: n, nombre: NOMBRE_NIVEL[n], detalle: DETALLE[n] }))} onCambio={setNivel} />

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="lf-notas">Notas (opcional)</Label>
        <Textarea id="lf-notas" value={notas} maxLength={4000} rows={3} onChange={(e) => setNotas(e.target.value)} placeholder="De qué trata, quiénes hablan, qué cortar. Por ejemplo: quita la parte donde hablamos de precios." />
      </div>

      {ctas.length ? (
        <Opciones etiqueta="CTA por defecto" valor={cta} opciones={[...ctas.map((c) => ({ valor: c.clave, nombre: c.nombre })), { valor: "", nombre: "Sin preferencia" }]} onCambio={setCta} ayuda="Es el que más sale en las barras del video y en los clips." />
      ) : null}

      {error ? (
        <p className="text-destructive text-sm" role="alert">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="brand" disabled={!valido || ocupado} onClick={empezar}>
          {ocupado ? "Preparando..." : "Empezar"}
        </Button>
        {!videos && archivos.length ? <span className="text-muted-foreground text-sm">Falta al menos un video.</span> : null}
      </div>
    </div>
  )
}
