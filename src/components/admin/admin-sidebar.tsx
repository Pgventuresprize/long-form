"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { ArrowLeftIcon, BarChart3Icon, Building2Icon, FlaskConicalIcon, GemIcon, HistoryIcon, LayoutDashboardIcon, ShieldCheckIcon, UsersIcon } from "lucide-react"

import { PlogyStudioLogo } from "@/components/plogy-studio-logo"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"

const SECCIONES = [
  { titulo: "Resumen", url: "/admin", icono: LayoutDashboardIcon },
  { titulo: "Empresas", url: "/admin/empresas", icono: Building2Icon },
  { titulo: "Usuarios", url: "/admin/usuarios", icono: UsersIcon },
  { titulo: "Consumo", url: "/admin/consumo", icono: BarChart3Icon },
  { titulo: "Planes", url: "/admin/planes", icono: GemIcon },
  { titulo: "Funciones", url: "/admin/funciones", icono: FlaskConicalIcon },
  { titulo: "Actividad", url: "/admin/actividad", icono: HistoryIcon },
  { titulo: "Accesos", url: "/admin/accesos", icono: ShieldCheckIcon },
]

/** El menu del panel: el mismo marco del Studio, con las secciones de la plataforma. */
export function AdminSidebar({ email }: { email: string }) {
  const pathname = usePathname()
  return (
    <Sidebar variant="inset">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" render={<Link href="/admin" />}>
              <PlogyStudioLogo forma="compacto" className="text-xl group-data-[collapsible=icon]:hidden" />
              <PlogyStudioLogo forma="simbolo" className="hidden text-2xl group-data-[collapsible=icon]:block" />
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Administración</SidebarGroupLabel>
          <SidebarMenu>
            {SECCIONES.map((s) => (
              <SidebarMenuItem key={s.url}>
                <SidebarMenuButton
                  tooltip={s.titulo}
                  isActive={s.url === "/admin" ? pathname === s.url : pathname.startsWith(s.url)}
                  render={<Link href={s.url} />}
                >
                  <s.icono />
                  <span>{s.titulo}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton tooltip="Volver al Studio" render={<Link href="/" />}>
              <ArrowLeftIcon />
              <span>Volver al Studio</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <div className="flex items-center gap-2 p-2 group-data-[collapsible=icon]:hidden">
              <Avatar className="size-8 rounded-lg">
                <AvatarFallback className="rounded-lg">{email.charAt(0).toUpperCase() || "?"}</AvatarFallback>
              </Avatar>
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-sm font-medium">{email}</span>
                <span className="text-muted-foreground text-xs">Administrador</span>
              </span>
            </div>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  )
}
