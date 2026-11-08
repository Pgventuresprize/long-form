"use client"

import * as React from "react"
import Link from "next/link"
import { CheckIcon, ChevronsUpDownIcon, KeyRoundIcon, LayersIcon, LogOutIcon } from "lucide-react"

import { cambiarCuenta } from "@/app/cuenta/actions"
import { cerrarSesion } from "@/app/(acceso)/actions"
import type { Cuenta } from "@/engine/accounts"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar"

/**
 * Quien entro, con que cuenta trabaja y la salida.
 *
 * El selector de cuenta vivia arriba, en su propio bloque con su icono y el
 * rotulo "cuenta" debajo del nombre. Ocupaba dos lineas de la sidebar para
 * decir algo que casi nunca cambia, asi que se pliega aqui: sigue a un clic,
 * pero deja de gritar.
 *
 * El menu tenia antes entradas de plantilla —Upgrade, Billing, Notifications—
 * que no llevaban a ningun sitio. Con una sesion real detras, dejarlas seria
 * enseñar cuatro botones rotos alrededor del unico que hace algo.
 */
export function NavUser({
  email,
  cuentas,
  cuenta,
}: {
  email: string
  cuentas: Cuenta[]
  cuenta: Cuenta
}) {
  const { isMobile } = useSidebar()
  const [ocupado, startTransition] = React.useTransition()

  // La inicial del correo: no hay nombre ni foto que mostrar, y dos letras
  // inventadas se leerian como si los hubiera.
  const inicial = email.trim().charAt(0).toUpperCase() || "?"

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={<SidebarMenuButton size="lg" className="aria-expanded:bg-muted" />}
          >
            <Avatar>
              <AvatarFallback>{inicial}</AvatarFallback>
            </Avatar>
            <div className="grid flex-1 text-left text-sm leading-tight">
              <span className="truncate font-medium">{cuenta.name}</span>
              <span className="truncate text-xs">{email}</span>
            </div>
            <ChevronsUpDownIcon className="ml-auto size-4" />
          </DropdownMenuTrigger>

          <DropdownMenuContent
            className="min-w-56 rounded-lg"
            side={isMobile ? "bottom" : "right"}
            align="end"
            sideOffset={4}
          >
            <DropdownMenuGroup>
              <DropdownMenuLabel className="p-0 font-normal">
                <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                  <Avatar>
                    <AvatarFallback>{inicial}</AvatarFallback>
                  </Avatar>
                  <div className="grid flex-1 text-left text-sm leading-tight">
                    <span className="truncate font-medium">{cuenta.name}</span>
                    <span className="truncate text-xs">{email}</span>
                  </div>
                </div>
              </DropdownMenuLabel>
            </DropdownMenuGroup>

            {/* Con una sola cuenta no se ofrece cambiar: un selector de un
                elemento solo puede llevar a donde ya estas. */}
            {cuentas.length > 1 ? (
              <>
                <DropdownMenuSeparator />
                {/* La etiqueta de Base UI solo existe dentro de un grupo. */}
                <DropdownMenuGroup>
                  <DropdownMenuLabel className="text-muted-foreground text-xs">
                    Marca
                  </DropdownMenuLabel>
                  {cuentas.map((c) => (
                    <DropdownMenuItem
                      key={c.id}
                      disabled={ocupado || c.id === cuenta.id}
                      onClick={() =>
                        startTransition(async () => void (await cambiarCuenta(c.slug)))
                      }
                    >
                      <span className="flex-1 truncate">{c.name}</span>
                      {c.id === cuenta.id ? <CheckIcon className="size-4" /> : null}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuGroup>
              </>
            ) : null}

            <DropdownMenuSeparator />

            <DropdownMenuItem render={<Link href="/marcas" />}>
              <LayersIcon />
              Mis marcas
            </DropdownMenuItem>
            <DropdownMenuItem render={<Link href="/contrasena-nueva" />}>
              <KeyRoundIcon />
              Cambiar contraseña
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={ocupado}
              onClick={() => startTransition(async () => void (await cerrarSesion()))}
            >
              <LogOutIcon />
              {ocupado ? "Saliendo…" : "Cerrar sesion"}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
