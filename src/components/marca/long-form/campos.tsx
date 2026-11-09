"use client"

import * as React from "react"
import { UploadIcon } from "lucide-react"

import { subirArchivoEstilo } from "@/app/marca/long-form-actions"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { Archivo } from "@/engine/long-form/estilo"

export function Campo({ etiqueta, valor, onCambio, ayuda, max, placeholder }: { etiqueta: string; valor: string; onCambio: (v: string) => void; ayuda?: string; max?: number; placeholder?: string }) {
  const id = React.useId()
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <Label htmlFor={id}>{etiqueta}</Label>
      <Input id={id} value={valor} maxLength={max} placeholder={placeholder} onChange={(e) => onCambio(e.target.value)} />
      {ayuda ? <p className="text-muted-foreground text-xs">{ayuda}</p> : null}
    </div>
  )
}

export function ColorCampo({ etiqueta, valor, onCambio }: { etiqueta: string; valor: string; onCambio: (v: string) => void }) {
  const id = React.useId()
  // Solo guarda lo escrito mientras no es un color valido; valido, manda el valor del estilo.
  const [texto, setTexto] = React.useState<string | null>(null)
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <Label htmlFor={id}>{etiqueta}</Label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          aria-label={`${etiqueta}, selector`}
          value={/^#[0-9a-f]{6}$/i.test(valor) ? valor : "#000000"}
          onChange={(e) => onCambio(e.target.value)}
          className="border-input h-8 w-10 shrink-0 cursor-pointer rounded-md border bg-transparent p-0.5"
        />
        <Input
          id={id}
          value={texto ?? valor}
          maxLength={7}
          className="font-mono"
          onChange={(e) => {
            if (/^#[0-9a-f]{6}$/i.test(e.target.value)) {
              setTexto(null)
              onCambio(e.target.value.toLowerCase())
            } else setTexto(e.target.value)
          }}
        />
      </div>
    </div>
  )
}

/** Unas pocas opciones excluyentes, como botones. */
export function Opciones<T extends string>({ etiqueta, valor, opciones, onCambio, ayuda }: { etiqueta: string; valor: T; opciones: { valor: T; nombre: string; detalle?: string }[]; onCambio: (v: T) => void; ayuda?: string }) {
  return (
    <fieldset className="flex min-w-0 flex-col gap-1.5">
      <legend className="mb-1.5 text-sm font-medium">{etiqueta}</legend>
      {/* Con descripcion, columnas iguales en una fila; sin ella, botones que se acomodan. */}
      <div className={opciones.some((o) => o.detalle) ? "grid gap-2 sm:auto-cols-fr sm:grid-flow-col" : "flex flex-wrap gap-2"}>
        {opciones.map((o) => (
          <button
            key={o.valor}
            type="button"
            aria-pressed={valor === o.valor}
            onClick={() => onCambio(o.valor)}
            className={`rounded-md border px-3 py-1.5 text-left text-sm transition-colors ${
              valor === o.valor ? "border-primary bg-primary text-primary-foreground" : "border-input text-muted-foreground hover:bg-accent"
            }`}
          >
            <span className="font-medium">{o.nombre}</span>
            {o.detalle ? <span className="block text-xs opacity-80">{o.detalle}</span> : null}
          </button>
        ))}
      </div>
      {ayuda ? <p className="text-muted-foreground text-xs">{ayuda}</p> : null}
    </fieldset>
  )
}

/** Sube un logo, un QR, una foto o una fuente y devuelve el archivo. */
export function SubirArchivo({
  clase,
  etiqueta,
  acepta,
  onSubido,
}: {
  clase: "logo" | "qr" | "foto" | "fuente"
  etiqueta: string
  acepta: string
  onSubido: (a: Archivo, familia?: string) => void
}) {
  const entrada = React.useRef<HTMLInputElement>(null)
  const [ocupado, setOcupado] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  return (
    <div className="flex flex-col gap-1">
      <Button type="button" size="sm" variant="outline" disabled={ocupado} onClick={() => entrada.current?.click()}>
        <UploadIcon />
        {ocupado ? "Subiendo..." : etiqueta}
      </Button>
      <input
        ref={entrada}
        type="file"
        accept={acepta}
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={async (e) => {
          const f = e.target.files?.[0]
          if (!f) return
          setError(null)
          setOcupado(true)
          const form = new FormData()
          form.set("clase", clase)
          form.set("archivo", f)
          const r = await subirArchivoEstilo(form)
          setOcupado(false)
          e.target.value = ""
          if (r.ok) onSubido(r.archivo, r.familia)
          else setError(r.error)
        }}
      />
      {error ? (
        <p className="text-destructive text-xs" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}

export function Seccion({ titulo, descripcion, children }: { titulo: string; descripcion?: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-4 rounded-xl border p-4 md:p-5">
      <div>
        <h3 className="font-medium">{titulo}</h3>
        {descripcion ? <p className="text-muted-foreground mt-0.5 text-sm">{descripcion}</p> : null}
      </div>
      {children}
    </section>
  )
}
