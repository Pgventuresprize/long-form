import { CheckIcon, ClapperboardIcon, LayersIcon, LockIcon, PaletteIcon } from "lucide-react"

import { BotonQuieroAcceso } from "@/components/funciones/boton-quiero-acceso"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { yaPidioAcceso, type Funcion } from "@/engine/funciones"

const TEXTOS: Record<Funcion, { titulo: string; resumen: string; puntos: string[]; icono: React.ReactNode }> = {
  long_form: {
    titulo: "Long-form",
    resumen: "Sube una grabación larga y recibe el video editado, listo para publicar, y contenido para seguir publicando durante semanas.",
    puntos: [
      "El video con el estilo de tu marca: rótulos, citas, música, capítulos y sin silencios.",
      "Clips verticales con su gancho y su CTA, para aprobar uno por uno.",
      "Carruseles con citas reales del video, que llegan a tu calendario para revisar.",
    ],
    icono: <ClapperboardIcon />,
  },
  marcas_multiples: {
    titulo: "Más de una marca",
    resumen: "Lleva varias marcas desde la misma cuenta y cambia entre ellas en un clic.",
    puntos: [
      "Cada marca con su voz, sus pilares, su kit y sus redes.",
      "Copia lo común de una marca que ya tienes para empezar más rápido.",
      "Usa la misma conexión de Claude en todas, si quieres.",
    ],
    icono: <LayersIcon />,
  },
  estilo_long_form: {
    titulo: "Estilo de videos largos",
    resumen: "Define cómo se ven y suenan los videos largos de tu marca.",
    puntos: [
      "Música de intro y de cierre, y efectos para cada momento.",
      "Rótulos, citas, barras con CTA y subtítulos con tu kit.",
      "Las personas que salen seguido, para no escribirlas cada vez.",
    ],
    icono: <PaletteIcon />,
  },
}

/**
 * Lo que ve quien no tiene una funcion en beta: que hace, que esta en beta privada y "Quiero
 * acceso". Sin precios ni cobros.
 */
export async function Paywall({ clave, accountId }: { clave: Funcion; accountId: string }) {
  const t = TEXTOS[clave]
  const pedido = await yaPidioAcceso(accountId, clave)
  return (
    <Card className="mx-auto w-full max-w-xl">
      <CardHeader className="gap-3">
        <div className="flex items-center gap-2">
          <span className="bg-muted text-foreground flex size-9 items-center justify-center rounded-lg [&_svg]:size-5" aria-hidden>
            {t.icono}
          </span>
          <Badge variant="secondary" className="gap-1">
            <LockIcon className="size-3" aria-hidden />
            Beta privada
          </Badge>
        </div>
        <CardTitle className="font-display text-2xl">{t.titulo}</CardTitle>
        <CardDescription className="text-base">{t.resumen}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <ul className="flex flex-col gap-2 text-sm">
          {t.puntos.map((p) => (
            <li key={p} className="flex gap-2">
              <CheckIcon className="text-muted-foreground mt-0.5 size-4 shrink-0" aria-hidden />
              <span>{p}</span>
            </li>
          ))}
        </ul>
        <p className="text-muted-foreground text-sm">Estamos abriendo el acceso de a pocas marcas. Déjanos saber que te interesa y te avisamos.</p>
        <BotonQuieroAcceso clave={clave} pedido={pedido} />
      </CardContent>
    </Card>
  )
}
