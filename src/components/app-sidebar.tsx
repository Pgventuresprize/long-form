"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"

import type { Cuenta } from "@/engine/accounts"
import { NavMain } from "@/components/nav-main"
import { NavUser } from "@/components/nav-user"
import { PlogyStudioLogo } from "@/components/plogy-studio-logo"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import { BotIcon, CalendarDaysIcon, ChefHatIcon, MessageSquareIcon, ClapperboardIcon, FileTextIcon, FingerprintIcon, GalleryHorizontalEndIcon, KanbanIcon, LayersIcon, LightbulbIcon, SendIcon, SettingsIcon, ShieldCheckIcon } from "lucide-react"

import { AGENTES } from "@/lib/agentes-catalogo"

export function AppSidebar({
  email,
  cuentas,
  cuenta,
  esAdmin = false,
  funciones = [],
  ...props
}: {
  email: string
  cuentas: Cuenta[]
  cuenta: Cuenta
  /** Solo para quien esta en `platform_admins`; a los demas ni se les anuncia. */
  esAdmin?: boolean
  /** Las funciones en beta que la cuenta tiene encendidas (`engine/funciones.ts`). */
  funciones?: string[]
} & React.ComponentProps<typeof Sidebar>) {
  const pathname = usePathname()
  // El estudio, la publicacion y los videos son del plan advance; una empresa
  // basic solo ve las noticias, sus agentes y la configuracion.
  const advance = cuenta.plan === "advance"

  const todo = [
    {
      // El inicio: la conversacion con el equipo de agentes (chat.html).
      title: "Chat",
      url: "/",
      icon: <MessageSquareIcon />,
      isActive: pathname === "/" || pathname.startsWith("/chat"),
      items: [],
    },
    {
      // Sin subsecciones: el estudio es una sola pantalla, el tablero, y
      // colgarle hijos que no existen solo añadiria un desplegable vacio.
      title: "Estudio",
      url: "/estudio",
      icon: <KanbanIcon />,
      isActive: pathname === "/estudio",
      items: [],
    },
    {
      // Cuando sale cada post. El Estudio produce; aqui se decide la fecha.
      title: "Calendario",
      url: "/calendario",
      icon: <CalendarDaysIcon />,
      isActive: pathname.startsWith("/calendario"),
      items: [],
    },
    {
      // Seccion propia y no un ajuste: es lo que leen todos los agentes antes
      // de escribir y dibujar (identidad, voz, kit, imagenes, ejemplos).
      title: "Marca",
      url: "/marca",
      icon: <FingerprintIcon />,
      isActive: pathname.startsWith("/marca"),
      items: [],
    },
    {
      title: "Capas",
      url: "/capas",
      icon: <LayersIcon />,
      isActive: pathname.startsWith("/capas"),
      items: [],
    },
    {
      title: "Ideas",
      url: "/ideas",
      icon: <LightbulbIcon />,
      isActive: pathname.startsWith("/ideas"),
      items: [],
    },
    {
      // Lo que produce el pipeline nuevo, por pilar. El "Estudio" de arriba es
      // el tablero de las noticias, que sigue igual.
      title: "Estudio de pilares",
      url: "/estudio/pilares",
      icon: <GalleryHorizontalEndIcon />,
      isActive: pathname.startsWith("/estudio/pilares"),
      items: [],
    },
    {
      title: "Recetas",
      url: "/recetas",
      icon: <ChefHatIcon />,
      isActive: pathname.startsWith("/recetas"),
      items: [],
    },
    {
      // El agente de publicacion del estudio: publica lo que producen las
      // recetas. Es otro que el "Publicacion" de Agentes, que es el de noticias.
      title: "Publicación",
      url: "/publicacion",
      icon: <SendIcon />,
      isActive: pathname.startsWith("/publicacion"),
      items: [],
    },
    {
      // Los reportes y guias que prometen las piezas, todos juntos. Cada uno
      // vive tambien en la ficha de su noticia; aqui se revisan sin ir una por
      // una. No es del plan advance: sale del tablero de noticias.
      title: "Recursos",
      url: "/recursos",
      icon: <FileTextIcon />,
      isActive: pathname.startsWith("/recursos"),
      items: [],
    },
    {
      // Los videos: un pipeline aparte, a medias entre el agente (idea y guion)
      // y una persona (clips en Flow y montaje en Canva).
      title: "Video studio",
      url: "/videos",
      icon: <ClapperboardIcon />,
      isActive: pathname.startsWith("/videos"),
      items: [],
    },
    {
      // Grabaciones largas: el video editado y lo que sale de el. En beta: sin la funcion se ve
      // con candado y la pagina muestra el paywall.
      title: "Long-form",
      url: "/long-form",
      icon: <ClapperboardIcon />,
      isActive: pathname.startsWith("/long-form"),
      bloqueado: !funciones.includes("long_form"),
      items: [],
    },
    {
      title: "Agentes",
      url: `/agentes/${AGENTES[0].clave}`,
      icon: <BotIcon />,
      isActive: pathname.startsWith("/agentes"),
      // En el orden del pipeline, que es el recorrido de una noticia: quien
      // abre esto casi siempre viene siguiendo donde se atasco algo.
      items: AGENTES.map((a) => ({
        title: a.nombre,
        url: `/agentes/${a.clave}`,
        isActive: pathname === `/agentes/${a.clave}`,
      })),
    },
    {
      title: "Configuracion",
      url: "/configuracion/general",
      icon: <SettingsIcon />,
      isActive: pathname.startsWith("/configuracion"),
      items: [
        {
          title: "General",
          url: "/configuracion/general",
          isActive: pathname === "/configuracion/general",
        },
        {
          title: "Conexiones",
          url: "/configuracion/conexiones",
          isActive: pathname === "/configuracion/conexiones",
        },
        {
          title: "Empresa",
          url: "/configuracion/empresa",
          isActive: pathname === "/configuracion/empresa",
        },
        {
          title: "Consumo",
          url: "/configuracion/consumo",
          isActive: pathname === "/configuracion/consumo",
        },
      ],
    },
  ]
  const SOLO_ADVANCE = ["/calendario", "/capas", "/ideas", "/estudio/pilares", "/recetas", "/publicacion", "/videos"]
  const navMain = todo.filter((item) => advance || !SOLO_ADVANCE.includes(item.url))
  if (esAdmin) navMain.push({ title: "Administración", url: "/admin", icon: <ShieldCheckIcon />, isActive: false, items: [] })

  return (
    <Sidebar variant="inset" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" render={<Link href="/" />}>
              {/* La esfera con "Studio" con la sidebar abierta; al colapsarla
                  a ancho de icono queda solo la esfera. La que esta oculta no
                  se anuncia. */}
              <PlogyStudioLogo forma="compacto" className="text-xl group-data-[collapsible=icon]:hidden" />
              <PlogyStudioLogo forma="simbolo" className="hidden text-2xl group-data-[collapsible=icon]:block" />
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <NavMain items={navMain} />
      </SidebarContent>
      <SidebarFooter>
        <NavUser email={email} cuentas={cuentas} cuenta={cuenta} />
      </SidebarFooter>
    </Sidebar>
  )
}
