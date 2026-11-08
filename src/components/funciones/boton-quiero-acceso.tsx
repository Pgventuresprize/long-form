"use client"

import * as React from "react"
import { CheckIcon } from "lucide-react"

import { quieroAcceso } from "@/app/funciones/actions"
import { Button } from "@/components/ui/button"

export function BotonQuieroAcceso({ clave, pedido }: { clave: string; pedido: boolean }) {
  const [listo, setListo] = React.useState(pedido)
  const [error, setError] = React.useState<string | null>(null)
  const [ocupado, start] = React.useTransition()

  if (listo) {
    return (
      <p className="text-success flex items-center gap-2 text-sm font-medium" role="status">
        <CheckIcon className="size-4" aria-hidden />
        Te avisamos cuando tengas acceso.
      </p>
    )
  }
  return (
    <div className="flex flex-col gap-2">
      <Button
        variant="brand"
        className="self-start"
        disabled={ocupado}
        onClick={() =>
          start(async () => {
            setError(null)
            const r = await quieroAcceso(clave)
            if (r.ok) setListo(true)
            else setError(r.error)
          })
        }
      >
        {ocupado ? "Anotando..." : "Quiero acceso"}
      </Button>
      {error ? (
        <p className="text-destructive text-sm" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}
