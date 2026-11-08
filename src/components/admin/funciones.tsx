"use client"

import * as React from "react"

import { cambiarFuncionEmpresa, cambiarFuncionGlobal } from "@/app/admin/actions"
import { avisar } from "@/components/admin/avisos"
import { BotonConMotivo } from "@/components/admin/boton-con-motivo"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"

/** Encender o apagar una funcion para todas las empresas. */
export function BotonFuncionGlobal({ clave, nombre, encendida }: { clave: string; nombre: string; encendida: boolean }) {
  return (
    <BotonConMotivo
      etiqueta={encendida ? "Apagar para todos" : "Encender para todos"}
      variante={encendida ? "destructive" : "outline"}
      titulo={`${encendida ? "Apagar" : "Encender"} ${nombre} para todas las empresas`}
      descripcion="Las excepciones por empresa siguen mandando."
      efectos={
        encendida
          ? ["Quien no tenga una excepción vuelve a ver el paywall.", "Nada se borra."]
          : ["Toda empresa sin excepción la ve en la próxima página que cargue."]
      }
      confirmar={encendida ? "Apagar" : "Encender"}
      accion={(motivo) => cambiarFuncionGlobal(clave, !encendida, motivo)}
    />
  )
}

/**
 * La excepcion de una empresa en tres posiciones: con acceso, sin acceso o lo que diga la bandera
 * global. Quitar el acceso pide motivo; darlo no.
 */
export function SelectorFuncionEmpresa({
  accountId,
  empresa,
  clave,
  nombre,
  cuenta,
  global,
}: {
  accountId: string
  empresa: string
  clave: string
  nombre: string
  cuenta: boolean | null
  global: boolean
}) {
  const [ocupado, start] = React.useTransition()
  const correr = (valor: "si" | "global") =>
    start(async () => {
      const r = await cambiarFuncionEmpresa(accountId, clave, valor)
      avisar(r.ok, r.ok ? r.aviso : r.error)
    })
  const efectiva = cuenta ?? global
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 py-2 first:pt-0 last:pb-0">
      <div className="flex min-w-0 flex-col">
        <span className="text-sm font-medium">{nombre}</span>
        <span className="text-muted-foreground text-xs">
          {cuenta === null ? `Sigue lo de todos (${global ? "encendida" : "apagada"})` : "Excepción de esta empresa"}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <Badge variant={efectiva ? "success" : "secondary"}>{efectiva ? "Con acceso" : "Sin acceso"}</Badge>
        {cuenta !== true ? (
          <Button size="sm" variant="outline" disabled={ocupado} onClick={() => correr("si")}>
            Dar acceso
          </Button>
        ) : null}
        {cuenta !== false ? (
          <BotonConMotivo
            etiqueta="Quitar acceso"
            titulo={`Quitar ${nombre} a ${empresa}`}
            descripcion="Vuelve a ver el paywall. Nada se borra."
            confirmar="Quitar acceso"
            disabled={ocupado}
            accion={(motivo) => cambiarFuncionEmpresa(accountId, clave, "no", motivo)}
          />
        ) : null}
        {cuenta !== null ? (
          <Button size="sm" variant="ghost" disabled={ocupado} onClick={() => correr("global")}>
            Como todos
          </Button>
        ) : null}
      </div>
    </div>
  )
}

/** "Dar acceso" desde la lista de quienes lo pidieron. */
export function BotonDarAcceso({ accountId, clave }: { accountId: string; clave: string }) {
  const [ocupado, start] = React.useTransition()
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={ocupado}
      onClick={() =>
        start(async () => {
          const r = await cambiarFuncionEmpresa(accountId, clave, "si")
          avisar(r.ok, r.ok ? r.aviso : r.error)
        })
      }
    >
      Dar acceso
    </Button>
  )
}
