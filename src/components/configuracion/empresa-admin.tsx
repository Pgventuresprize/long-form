"use client"

import * as React from "react"
import Link from "next/link"
import { Trash2Icon } from "lucide-react"

import {
  cambiarRolMiembro,
  guardarEmpresa,
  invitarMiembro,
  nuevaEmpresa,
  quitarMiembroDeEmpresa,
  reenviarInvitacionMiembro,
  type Resultado,
} from "@/app/configuracion/empresa/actions"
import type { Plan } from "@/engine/accounts"
import type { Miembro, Rol } from "@/engine/empresas"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

const PLANES: Record<Plan, { nombre: string; detalle: string }> = {
  basic: { nombre: "Basic", detalle: "Noticias y sus agentes (extracción, análisis, ángulo, LinkedIn, Instagram, Facebook)." },
  advance: { nombre: "Advance", detalle: "Todo lo de Basic más capas, ideas, recetas, carruseles, publicación y Video studio." },
}

/**
 * La empresa abierta (nombre, plan, miembros) y la creacion de empresas
 * nuevas. Solo un owner cambia la empresa o sus miembros.
 */
export function EmpresaAdmin({
  empresa,
  esOwner,
  miembros,
  yo,
  empresas,
  puedeCrear = true,
}: {
  empresa: { name: string; plan: Plan; slug: string }
  esOwner: boolean
  miembros: Miembro[]
  yo: string
  empresas: { name: string; plan: Plan; rol: Rol }[]
  /** La primera marca es gratis; desde la segunda hace falta marcas_multiples. */
  puedeCrear?: boolean
}) {
  const [pending, startTransition] = React.useTransition()
  const [aviso, setAviso] = React.useState<{ ok: boolean; texto: string } | null>(null)
  const [nombre, setNombre] = React.useState(empresa.name)
  const [correo, setCorreo] = React.useState("")
  const [rol, setRol] = React.useState<Rol>("member")
  const [nuevaNombre, setNuevaNombre] = React.useState("")

  const correr = (fn: () => Promise<Resultado>, despues?: () => void) => {
    setAviso(null)
    startTransition(async () => {
      const r = await fn()
      if (r.ok) {
        if (r.aviso) setAviso({ ok: true, texto: r.aviso })
        despues?.()
      } else setAviso({ ok: false, texto: r.error })
    })
  }

  const chip = (activo: boolean) =>
    `rounded-md border px-3 py-1.5 text-left text-sm transition-colors ${
      activo ? "border-primary bg-primary text-primary-foreground" : "border-input text-muted-foreground hover:bg-accent"
    }`

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      {aviso ? <p className={`text-sm ${aviso.ok ? "text-success" : "text-destructive"}`}>{aviso.texto}</p> : null}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Esta empresa</CardTitle>
          <p className="text-muted-foreground mt-1 text-sm">
            Cada empresa es independiente: sus datos, sus miembros y sus conexiones no se ven desde otra.
            {esOwner ? "" : " Solo un owner puede cambiarla."}
          </p>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5 sm:w-80">
            <Label htmlFor="emp-nombre">Nombre</Label>
            <Input id="emp-nombre" value={nombre} disabled={pending || !esOwner} onChange={(e) => setNombre(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Plan</Label>
            <p className="text-sm">
              <span className="font-medium">{PLANES[empresa.plan].nombre}.</span>{" "}
              <span className="text-muted-foreground">{PLANES[empresa.plan].detalle} Para cambiarlo, escríbenos.</span>
            </p>
          </div>
          {esOwner ? (
            <div>
              <Button disabled={pending} onClick={() => correr(() => guardarEmpresa({ name: nombre }))}>
                Guardar
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Miembros</CardTitle>
          <p className="text-muted-foreground mt-1 text-sm">
            Owner gestiona la empresa, sus miembros y sus conexiones; member trabaja en ella.
          </p>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col divide-y rounded-md border">
            {miembros.map((m) => (
              <div key={m.userId} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                <span className="flex flex-wrap items-center gap-2 text-sm">
                  {m.email}
                  {m.userId === yo ? <span className="text-muted-foreground"> (tú)</span> : null}
                  {m.pendiente ? <Badge variant="outline">Invitación pendiente</Badge> : null}
                </span>
                <span className="flex items-center gap-2">
                  {esOwner && m.pendiente ? (
                    <Button variant="ghost" size="sm" disabled={pending} onClick={() => correr(() => reenviarInvitacionMiembro(m.userId))}>
                      Reenviar
                    </Button>
                  ) : null}
                  {esOwner ? (
                    <div className="flex gap-1">
                      {(["owner", "member"] as Rol[]).map((r) => (
                        <button
                          key={r}
                          type="button"
                          disabled={pending || m.rol === r}
                          onClick={() => correr(() => cambiarRolMiembro(m.userId, r))}
                          className={`rounded border px-2 py-0.5 text-xs ${m.rol === r ? "border-primary bg-primary text-primary-foreground" : "border-input text-muted-foreground hover:bg-accent"}`}
                        >
                          {r}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <Badge variant="outline">{m.rol}</Badge>
                  )}
                  {esOwner && m.userId !== yo ? (
                    <Button
                      variant="ghost"
                      size="icon"
                      disabled={pending}
                      aria-label={`Quitar a ${m.email}`}
                      className="text-muted-foreground hover:text-destructive size-7"
                      onClick={() => correr(() => quitarMiembroDeEmpresa(m.userId))}
                    >
                      <Trash2Icon className="size-3.5" />
                    </Button>
                  ) : null}
                </span>
              </div>
            ))}
          </div>

          {esOwner ? (
            <div className="flex flex-col gap-3 rounded-md border border-dashed p-3">
              <p className="text-sm font-medium">Invitar a alguien</p>
              <p className="text-muted-foreground -mt-2 text-xs">
                Si no tiene cuenta, le llega un correo para elegir su contraseña. Si ya la tiene, entra a esta empresa con la suya.
              </p>
              <div className="flex flex-col gap-1.5 sm:w-80">
                <Label htmlFor="m-correo">Correo</Label>
                <Input id="m-correo" type="email" value={correo} disabled={pending} onChange={(e) => setCorreo(e.target.value)} placeholder="persona@empresa.com" />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {(["member", "owner"] as Rol[]).map((r) => (
                  <button key={r} type="button" disabled={pending} onClick={() => setRol(r)} className={chip(rol === r)}>
                    {r}
                  </button>
                ))}
                <Button
                  disabled={pending || !correo.trim()}
                  onClick={() =>
                    correr(
                      () => invitarMiembro(correo, rol),
                      () => setCorreo("")
                    )
                  }
                >
                  Invitar
                </Button>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Crear marca</CardTitle>
          <p className="text-muted-foreground mt-1 text-sm">
            Empieza vacía, sin conexiones y en Basic; quedas como owner y se abre al crearla. Tus marcas:{" "}
            {empresas.map((e) => `${e.name} (${e.plan}, ${e.rol})`).join(" · ")}.
          </p>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {puedeCrear ? (
            <>
              <div className="flex flex-col gap-1.5 sm:w-80">
                <Label htmlFor="n-nombre">Nombre</Label>
                <Input id="n-nombre" value={nuevaNombre} disabled={pending} onChange={(e) => setNuevaNombre(e.target.value)} placeholder="Nombre de la marca" />
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <Button disabled={pending || nuevaNombre.trim().length < 2} onClick={() => correr(() => nuevaEmpresa(nuevaNombre), () => setNuevaNombre(""))}>
                  Crear marca
                </Button>
                <Link href="/marcas" className="text-muted-foreground text-sm underline-offset-4 hover:underline">
                  Copiar lo común de otra marca desde Mis marcas
                </Link>
              </div>
            </>
          ) : (
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <span className="text-muted-foreground">Crear otra marca está en beta privada.</span>
              <Button nativeButton={false} variant="outline" size="sm" render={<Link href="/marcas" />}>
                Ver Mis marcas
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
