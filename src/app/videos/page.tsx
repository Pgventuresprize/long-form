import Link from "next/link"
import { Settings2Icon } from "lucide-react"

import { DashboardShell } from "@/components/dashboard-shell"
import { Button } from "@/components/ui/button"
import { exigirAdvance } from "@/lib/accounts"
import { TableroVideos } from "@/components/videos/tablero-videos"
import { getVideoStudio } from "@/lib/videos-data"

export const dynamic = "force-dynamic"
// Las acciones de esta pagina escriben guiones y exportan videos de Canva:
// minutos, no segundos.
export const maxDuration = 300

export const metadata = { title: "Video studio · Plogy Studio" }

/**
 * Video studio: el pipeline de videos, a medias entre el agente y una persona.
 * El agente toma la idea y escribe el guion por escenas; una persona genera los
 * clips en Flow y monta el video en Canva; el sistema lo exporta y lo publica.
 */
export default async function VideosPage() {
  await exigirAdvance()
  const vista = await getVideoStudio()
  return (
    <DashboardShell title="Video studio">
      <div className="flex flex-col gap-4">
        {/* La configuracion del short form vive en Marca > Estilo editorial, con las mismas
            tablas y acciones. */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-muted-foreground text-sm">Los ajustes de los videos están en el estilo editorial de la marca.</p>
          <Button nativeButton={false} variant="outline" size="sm" render={<Link href="/marca?tab=short-form" />}>
            <Settings2Icon />
            Configuración
          </Button>
        </div>
        <TableroVideos videos={vista.videos} ajustes={vista.ajustes} />
      </div>
    </DashboardShell>
  )
}
