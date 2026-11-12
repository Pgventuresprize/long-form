"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { PaletteIcon } from "lucide-react"

import { cambiarCuenta } from "@/app/cuenta/actions"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import type { MarcaNuevo } from "@/engine/long-form/nuevo-datos"

import { Paso } from "./comun"

/** El logo de la marca sobre su color, o su inicial si no tiene logo. */
export function SelloMarca({ marca, className = "size-10" }: { marca: MarcaNuevo; className?: string }) {
  const fondo = marca.logo?.sobre === "tinta" ? marca.tinta : marca.acento
  return (
    <span className={`flex shrink-0 items-center justify-center overflow-hidden rounded-lg ${className}`} style={{ background: fondo }} aria-hidden>
      {marca.logo ? (
        // eslint-disable-next-line @next/next/no-img-element -- URL firmada de Storage, cambia cada hora
        <img src={marca.logo.url} alt="" className="size-full object-contain p-1.5" />
      ) : (
        <span className="font-display text-lg" style={{ color: marca.tinta }}>
          {marca.nombre.slice(0, 1).toUpperCase()}
        </span>
      )}
    </span>
  )
}

export function Muestras({ marca }: { marca: MarcaNuevo }) {
  const colores = [...new Set([marca.acento, marca.tinta, ...marca.degradado])].slice(0, 5)
  return (
    <span className="flex items-center gap-1" aria-hidden>
      {colores.map((c) => (
        <i key={c} className="ring-foreground/10 size-3.5 rounded-full ring-1" style={{ background: c }} />
      ))}
    </span>
  )
}

/**
 * Paso 1: la marca con la que se edita (en Studio, la cuenta abierta). Cambiarla es lo mismo que hacerlo en el
 * menu de la cuenta: la pagina vuelve a cargar con la otra marca.
 */
export function PasoMarca({ marcas, marcaId, children }: { marcas: MarcaNuevo[]; marcaId: string; children?: React.ReactNode }) {
  const router = useRouter()
  const [cambiando, start] = React.useTransition()
  const marca = marcas.find((m) => m.id === marcaId) ?? marcas[0]
  if (!marca) return null

  const cambiar = (id: string | null) => {
    const m = marcas.find((x) => x.id === id)
    if (!m || m.id === marcaId) return
    start(async () => {
      await cambiarCuenta(m.slug)
      router.refresh()
    })
  }

  return (
    <Paso n={1} id="paso-marca" titulo="Marca" descripcion="De ella salen el logo, los colores, la fuente, la música y los CTA del video.">
      <div className="flex flex-wrap items-center gap-3">
        <SelloMarca marca={marca} />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="truncate font-medium">{marca.nombre}</span>
          <Muestras marca={marca} />
        </div>
        {marcas.length > 1 ? (
          <Select value={marca.id} onValueChange={(v) => cambiar(v as string | null)} disabled={cambiando}>
            <SelectTrigger aria-label="Cambiar de marca" className="min-w-40">
              <SelectValue>{() => (cambiando ? "Cambiando..." : "Cambiar de marca")}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {marcas.map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  <span className="size-2.5 shrink-0 rounded-full" style={{ background: m.acento }} aria-hidden />
                  {m.nombre}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
      </div>
      {children}
    </Paso>
  )
}

/** En lugar del resto del formulario cuando la marca no tiene su estilo de long form confirmado. */
export function SinEstilo({ puedeEstilo }: { puedeEstilo: boolean }) {
  return (
    <div className="bg-muted flex flex-wrap items-center gap-3 rounded-lg p-3" role="status">
      <PaletteIcon className="text-muted-foreground size-5 shrink-0" aria-hidden />
      <p className="min-w-0 flex-1 text-sm">
        {puedeEstilo ? "Esta marca todavía no tiene su estilo de video largo. Arréglalo una vez y todos sus videos salen con él." : "El estilo de video largo todavía no está activo para esta marca."}
      </p>
      {puedeEstilo ? (
        <Button variant="outline" nativeButton={false} render={<Link href="/marca?tab=long-form" />}>
          Configurar el estilo
        </Button>
      ) : null}
    </div>
  )
}
