"use client"

import * as React from "react"
import { useRouter } from "next/navigation"

import { cambiarCuenta } from "@/app/cuenta/actions"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"

type Marca = { id: string; slug: string; nombre: string; rol: "owner" | "member"; plan: string; suspendida: boolean }

export function ListaMarcas({ actual, marcas }: { actual: string; marcas: Marca[] }) {
  const router = useRouter()
  const [ocupado, start] = React.useTransition()
  const [cambiando, setCambiando] = React.useState<string | null>(null)
  return (
    <ul className="flex flex-col divide-y">
      {marcas.map((m) => (
        <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 py-3 first:pt-0 last:pb-0">
          <div className="flex min-w-0 flex-col">
            <span className="truncate font-medium">{m.nombre}</span>
            <span className="text-muted-foreground text-xs">
              {m.rol === "owner" ? "Owner" : "Miembro"} · {m.plan === "advance" ? "Advance" : "Basic"}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {m.suspendida ? <Badge variant="destructive">Suspendida</Badge> : null}
            {m.id === actual ? (
              <Badge variant="success">Abierta</Badge>
            ) : (
              <Button
                size="sm"
                variant="outline"
                disabled={ocupado || m.suspendida}
                onClick={() =>
                  start(async () => {
                    setCambiando(m.id)
                    await cambiarCuenta(m.slug)
                    router.refresh()
                    setCambiando(null)
                  })
                }
              >
                {cambiando === m.id ? "Cambiando..." : "Cambiar"}
              </Button>
            )}
          </div>
        </li>
      ))}
    </ul>
  )
}
