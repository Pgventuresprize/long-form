"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { BellIcon } from "lucide-react"

import { leerAvisos, misAvisos } from "@/app/long-form/actions"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import type { Aviso } from "@/engine/long-form/datos"

const CADA_MS = 15_000

function hace(iso: string): string {
  const s = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 1000))
  if (s < 60) return "ahora"
  if (s < 3600) return `hace ${Math.round(s / 60)} min`
  if (s < 86400) return `hace ${Math.round(s / 3600)} h`
  return `hace ${Math.round(s / 86400)} d`
}

/**
 * Los avisos de Long-form: subida terminada, transcripcion lista, te toca revisar, sugerencias listas, video
 * listo, clips listos, enviado a la parrilla y errores. Se piden cada 15 s con la pestaña visible.
 */
export function Campana() {
  const router = useRouter()
  const [avisos, setAvisos] = React.useState<Aviso[]>([])
  const [sinLeer, setSinLeer] = React.useState(0)

  const cargar = React.useCallback(async () => {
    const r = await misAvisos()
    if (r.ok) {
      setAvisos(r.avisos)
      setSinLeer(r.sinLeer)
    }
  }, [])

  React.useEffect(() => {
    // La primera lectura va en el siguiente tick: el efecto no pinta, solo programa.
    const primera = setTimeout(cargar, 0)
    const t = setInterval(() => document.visibilityState === "visible" && cargar(), CADA_MS)
    return () => {
      clearTimeout(primera)
      clearInterval(t)
    }
  }, [cargar])

  return (
    <DropdownMenu
      onOpenChange={(abierto) => {
        if (abierto && sinLeer) {
          setSinLeer(0)
          void leerAvisos(avisos.filter((a) => !a.leido).map((a) => a.id))
        }
      }}
    >
      <DropdownMenuTrigger render={<Button variant="ghost" size="icon" className="relative" aria-label={sinLeer ? `Avisos: ${sinLeer} sin leer` : "Avisos"} />}>
        <BellIcon />
        {sinLeer ? (
          <span className="bg-brand text-brand-foreground absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold tabular-nums">
            {sinLeer > 9 ? "9+" : sinLeer}
          </span>
        ) : null}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[min(22rem,calc(100vw-2rem))]">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Avisos de Long-form</DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        {avisos.length === 0 ? <p className="text-muted-foreground px-2 py-3 text-sm">Sin avisos todavía.</p> : null}
        {avisos.slice(0, 12).map((a) => (
          <DropdownMenuItem key={a.id} onClick={() => a.accion && router.push(a.accion)} className="flex flex-col items-start gap-0.5 py-2">
            <span className="flex w-full items-center justify-between gap-2">
              <span className={`text-sm ${a.leido ? "" : "font-semibold"} ${a.tipo === "error" ? "text-destructive" : ""}`}>{a.titulo}</span>
              <span className="text-muted-foreground shrink-0 text-[11px]">{hace(a.creado)}</span>
            </span>
            {a.cuerpo ? <span className="text-muted-foreground line-clamp-2 text-xs">{a.cuerpo}</span> : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
