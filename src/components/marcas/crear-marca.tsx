"use client"

import * as React from "react"
import { useRouter } from "next/navigation"

import { crearMarca } from "@/app/marcas/actions"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

type Origen = { id: string; nombre: string; claude: boolean }

const SIN_COPIA = "ninguna"

/**
 * Nombre de la marca y, opcional, de cual copiar lo comun (identidad, voz, pilares y temas, CTA,
 * colores, fuentes, logos e imagenes) y si usar su misma conexion de Claude.
 */
export function CrearMarca({ origenes }: { origenes: Origen[] }) {
  const router = useRouter()
  const [nombre, setNombre] = React.useState("")
  const [origen, setOrigen] = React.useState<string>(SIN_COPIA)
  const [claude, setClaude] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [ocupado, start] = React.useTransition()

  const elegido = origenes.find((o) => o.id === origen) ?? null
  const valido = nombre.trim().length >= 2

  const enviar = (e: React.FormEvent) => {
    e.preventDefault()
    if (!valido) return
    start(async () => {
      setError(null)
      const r = await crearMarca({ nombre, copiarDe: elegido?.id ?? null, claude: Boolean(elegido?.claude && claude) })
      if (!r.ok) {
        setError(r.error)
        if (r.paywall) router.refresh()
        return
      }
      router.push(r.destino)
    })
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={enviar}>
      <div className="flex flex-col gap-1.5 sm:w-80">
        <Label htmlFor="marca-nombre">Nombre de la marca</Label>
        <Input id="marca-nombre" value={nombre} disabled={ocupado} onChange={(e) => setNombre(e.target.value)} placeholder="Por ejemplo, Juan Francisco" autoComplete="off" />
      </div>

      {origenes.length ? (
        <fieldset className="flex flex-col gap-2" disabled={ocupado}>
          <legend className="mb-1 text-sm font-medium">¿Copiar lo común de otra marca?</legend>
          <p className="text-muted-foreground text-xs">Identidad, voz, pilares y temas, CTA, colores, fuentes, logos e imágenes. No se copian conexiones, kits ni piezas.</p>
          <div className="flex flex-wrap gap-2">
            {[{ id: SIN_COPIA, nombre: "Empezar vacía" }, ...origenes].map((o) => (
              <button
                key={o.id}
                type="button"
                aria-pressed={origen === o.id}
                onClick={() => setOrigen(o.id)}
                className={`rounded-md border px-3 py-1.5 text-sm transition-colors ${
                  origen === o.id ? "border-primary bg-primary text-primary-foreground" : "border-input text-muted-foreground hover:bg-accent"
                }`}
              >
                {o.nombre}
              </button>
            ))}
          </div>
          {elegido?.claude ? (
            <label className="mt-1 flex items-center gap-2 text-sm">
              <input type="checkbox" className="accent-[var(--brand)] size-4" checked={claude} onChange={(e) => setClaude(e.target.checked)} />
              Usar la misma conexión de Claude que {elegido.nombre}
            </label>
          ) : elegido ? (
            <p className="text-muted-foreground text-xs">{elegido.nombre} no tiene Claude conectado: la marca nueva lo conecta en Conexiones.</p>
          ) : null}
        </fieldset>
      ) : null}

      {error ? (
        <p className="text-destructive text-sm" role="alert">
          {error}
        </p>
      ) : null}
      <div>
        <Button type="submit" variant="brand" disabled={ocupado || !valido}>
          {ocupado ? "Creando..." : "Crear marca"}
        </Button>
      </div>
    </form>
  )
}
