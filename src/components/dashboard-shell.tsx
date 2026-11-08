import { debeHacerOnboarding } from "@/lib/onboarding"
import * as React from "react"
import Link from "next/link"
import { redirect } from "next/navigation"

import { AppSidebar } from "@/components/app-sidebar"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { Separator } from "@/components/ui/separator"
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar"
import { cuentaActual, cuentasDelUsuario } from "@/lib/accounts"
import { adminActual } from "@/lib/admin"
import { funcionesEncendidas } from "@/lib/funciones"
import { usuarioActual } from "@/lib/supabase/auth"

/**
 * Marco comun del dashboard: sidebar (plantilla sidebar-08) + cabecera con
 * breadcrumb. Es un Server Component, asi que los conteos de nichos se
 * resuelven en el servidor y nunca viaja la credencial de Supabase al cliente.
 */
export async function DashboardShell({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  // El proxy ya desvio a quien no tenia sesion; esto es la segunda comprobacion,
  // la que de verdad decide, porque corre donde se renderizan los datos.
  const usuario = await usuarioActual()
  if (!usuario) redirect("/login")

  // La cuenta primero: los conteos de nichos ya salen acotados a ella.
  const [cuenta, cuentas, admin] = await Promise.all([cuentaActual(), cuentasDelUsuario(), adminActual()])
  if (await debeHacerOnboarding(cuenta)) redirect("/empezar")
  const funciones = await funcionesEncendidas(cuenta.id)

  return (
    <SidebarProvider>
      <AppSidebar
        email={usuario.email ?? ""}
        cuentas={cuentas}
        cuenta={cuenta}
        esAdmin={admin !== null}
        funciones={funciones}
      />
      <SidebarInset>
        <header className="bg-background/85 sticky top-0 z-10 flex h-14 shrink-0 items-center gap-2 border-b px-4 backdrop-blur md:px-6">
          <div className="flex items-center gap-2">
            <SidebarTrigger className="-ml-1.5" />
            <Separator
              orientation="vertical"
              className="mr-2 data-vertical:h-4 data-vertical:self-auto"
            />
            <Breadcrumb>
              <BreadcrumbList>
                <BreadcrumbItem className="hidden md:block">
                  <BreadcrumbLink render={<Link href="/" />}>
                    Plogy Studio
                  </BreadcrumbLink>
                </BreadcrumbItem>
                <BreadcrumbSeparator className="hidden md:block" />
                <BreadcrumbItem>
                  <BreadcrumbPage>{title}</BreadcrumbPage>
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>
          </div>
        </header>
        <div className="flex min-w-0 flex-1 flex-col gap-6 p-4 pt-6 md:p-6 md:pt-8">
          <h1 className="font-display text-3xl leading-tight">{title}</h1>
          {children}
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
