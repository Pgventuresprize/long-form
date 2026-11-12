"use client"

import * as React from "react"
import { UploadCloudIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

/** Piezas que comparten los pasos de "Nuevo video". */

export function tamano(b: number | null): string {
  if (!b) return ""
  return b >= 1e9 ? `${(b / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(b / 1e6))} MB`
}

/** 75 -> "1:15"; 3725 -> "1:02:05". */
export function duracionTexto(s: number | null | undefined): string {
  if (!s || !Number.isFinite(s)) return ""
  const t = Math.round(s)
  const h = Math.floor(t / 3600)
  const m = Math.floor((t % 3600) / 60)
  const ss = String(t % 60).padStart(2, "0")
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`
}

/** La duracion de un video o audio local, leida por el navegador. Null si no la sabe. */
export function medirDuracion(f: File): Promise<number | null> {
  return new Promise((resolver) => {
    const url = URL.createObjectURL(f)
    const el = document.createElement(f.type.startsWith("audio/") ? "audio" : "video")
    const fin = (v: number | null) => {
      URL.revokeObjectURL(url)
      el.removeAttribute("src")
      resolver(v)
    }
    const t = setTimeout(() => fin(null), 8000)
    el.preload = "metadata"
    el.onloadedmetadata = () => {
      clearTimeout(t)
      fin(Number.isFinite(el.duration) ? el.duration : null)
    }
    el.onerror = () => {
      clearTimeout(t)
      fin(null)
    }
    el.src = url
  })
}

let n = 0
export const nuevoId = () => `x${++n}-${Math.random().toString(36).slice(2, 7)}`

/** Un paso numerado del flujo. */
export function Paso({ n, titulo, descripcion, meta, children, id }: { n: number; titulo: string; descripcion: string; meta?: React.ReactNode; children: React.ReactNode; id: string }) {
  return (
    <section aria-labelledby={`${id}-titulo`} className="bg-card ring-foreground/10 flex flex-col gap-4 rounded-xl p-4 ring-1 md:p-5">
      <div className="flex items-start gap-3">
        <span className="bg-foreground text-background font-display flex size-7 shrink-0 items-center justify-center rounded-full text-sm" aria-hidden>
          {n}
        </span>
        <div className="min-w-0 flex-1">
          <h2 id={`${id}-titulo`} className="font-medium">
            <span className="sr-only">Paso {n}: </span>
            {titulo}
          </h2>
          <p className="text-muted-foreground text-sm">{descripcion}</p>
        </div>
        {meta ? <div className="text-muted-foreground shrink-0 text-xs tabular-nums">{meta}</div> : null}
      </div>
      {children}
    </section>
  )
}

/**
 * Soltar archivos o elegirlos con el boton. La zona no es un boton (el boton esta dentro): asi el teclado llega
 * a una sola cosa y el lector de pantalla no lee dos veces lo mismo.
 */
export function ZonaArchivos({
  acepta,
  multiple = true,
  boton,
  ayuda,
  onArchivos,
  deshabilitado,
  compacta,
  children,
}: {
  acepta: string
  multiple?: boolean
  boton: string
  ayuda?: string
  onArchivos: (fs: File[]) => void
  deshabilitado?: boolean
  compacta?: boolean
  children?: React.ReactNode
}) {
  const entrada = React.useRef<HTMLInputElement>(null)
  const [encima, setEncima] = React.useState(false)
  return (
    <div
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes("Files")) return
        e.preventDefault()
        setEncima(true)
      }}
      onDragLeave={() => setEncima(false)}
      onDrop={(e) => {
        if (!e.dataTransfer.files.length) return
        e.preventDefault()
        setEncima(false)
        if (!deshabilitado) onArchivos([...e.dataTransfer.files])
      }}
      className={cn(
        "flex flex-wrap items-center gap-3 rounded-xl border border-dashed transition-colors",
        compacta ? "px-3 py-2.5" : "flex-col justify-center px-4 py-6 text-center sm:flex-row sm:justify-start sm:text-left",
        encima ? "border-foreground bg-muted" : "border-border"
      )}
    >
      {!compacta ? <UploadCloudIcon className="text-muted-foreground size-6 shrink-0" aria-hidden /> : null}
      <div className="min-w-0 flex-1">
        {ayuda ? <p className="text-muted-foreground text-sm">{ayuda}</p> : null}
      </div>
      <div className={cn("flex flex-wrap items-center gap-2", !compacta && "justify-center sm:justify-end")}>
        {children}
        <Button type="button" variant="outline" disabled={deshabilitado} onClick={() => entrada.current?.click()}>
          <UploadCloudIcon />
          {boton}
        </Button>
      </div>
      <input
        ref={entrada}
        type="file"
        multiple={multiple}
        accept={acepta}
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => {
          const fs = e.target.files ? [...e.target.files] : []
          e.target.value = ""
          if (fs.length) onArchivos(fs)
        }}
      />
    </div>
  )
}

/** Pocas opciones excluyentes en una pastilla: Inicio / Fondo / Cierre, 16:9 / 9:16 / 1:1. */
export function Segmentado<T extends string>({
  etiqueta,
  valor,
  opciones,
  onCambio,
  deshabilitado,
  className,
}: {
  etiqueta: string
  valor: T | null
  opciones: { valor: T; nombre: string }[]
  onCambio: (v: T) => void
  deshabilitado?: boolean
  className?: string
}) {
  return (
    <div role="group" aria-label={etiqueta} className={cn("bg-muted inline-flex shrink-0 items-center gap-0.5 rounded-full p-0.5", className)}>
      {opciones.map((o) => (
        <button
          key={o.valor}
          type="button"
          aria-pressed={valor === o.valor}
          disabled={deshabilitado}
          onClick={() => onCambio(o.valor)}
          className={cn(
            "focus-visible:ring-ring/50 h-7 rounded-full px-3 text-xs font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-3 disabled:opacity-50",
            valor === o.valor ? "bg-background text-foreground ring-foreground/10 shadow-xs ring-1" : "text-muted-foreground hover:text-foreground"
          )}
        >
          {o.nombre}
        </button>
      ))}
    </div>
  )
}

/** Un archivo en una lista: icono, nombre, detalle y sus botones. */
export function FilaArchivo({ icono, nombre, detalle, children, className, ...resto }: { icono: React.ReactNode; nombre: string; detalle?: React.ReactNode; children?: React.ReactNode } & React.ComponentProps<"li">) {
  return (
    <li className={cn("flex min-h-12 items-center gap-3 px-3 py-2 text-sm", className)} {...resto}>
      <span className="text-muted-foreground shrink-0 [&_svg]:size-4" aria-hidden>
        {icono}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium" title={nombre}>
          {nombre}
        </p>
        {detalle ? <p className="text-muted-foreground truncate text-xs tabular-nums">{detalle}</p> : null}
      </div>
      <div className="flex shrink-0 items-center gap-1">{children}</div>
    </li>
  )
}

export function ErrorCampo({ id, children }: { id?: string; children: React.ReactNode }) {
  if (!children) return null
  return (
    <p id={id} className="text-destructive text-sm" role="alert">
      {children}
    </p>
  )
}

/** Lo que vale para varios pasos: archivos repetidos fuera. */
export function sinRepetir<T>(previos: T[], nuevos: File[], archivoDe: (x: T) => File | null): File[] {
  return nuevos.filter((n, i) => !previos.some((p) => {
    const f = archivoDe(p)
    return f && f.name === n.name && f.size === n.size
  }) && nuevos.findIndex((m) => m.name === n.name && m.size === n.size) === i)
}
