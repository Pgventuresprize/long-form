import { DashboardShell } from "@/components/dashboard-shell"
import { Paywall } from "@/components/funciones/paywall"
import { NuevoVideo } from "@/components/long-form/nuevo/nuevo-video"
import { tieneFuncion } from "@/engine/funciones"
import { USOS_MUSICA, type UsoMusica } from "@/engine/long-form/nuevo"
import { clipsPrevios, marcasParaNuevo } from "@/engine/long-form/nuevo-datos"
import { bibliotecaDe, estiloDe } from "@/engine/long-form/estilo-datos"
import { cuentasDelUsuario } from "@/lib/accounts"
import { accesoA } from "@/lib/funciones"

export const dynamic = "force-dynamic"

export const metadata = { title: "Nuevo video · Long-form · Plogy Studio" }

/**
 * Nuevo video. Todo lo que la pantalla necesita sale de aqui: las marcas de la persona, el estilo de la marca
 * abierta, su musica y los videos que ya subio. Sin estilo confirmado, solo se ve la marca y el aviso para
 * configurarlo (se puede cambiar a otra marca que si lo tenga).
 */
export default async function NuevoVideoPage() {
  const { cuenta, tiene } = await accesoA("long_form")
  if (!tiene) {
    return (
      <DashboardShell title="Nuevo video">
        <Paywall clave="long_form" accountId={cuenta.id} />
      </DashboardShell>
    )
  }
  const [estilo, cuentas, puedeEstilo] = await Promise.all([estiloDe(cuenta.id), cuentasDelUsuario(), tieneFuncion(cuenta.id, "estilo_long_form")])
  const listo = Boolean(estilo?.listo)
  const [marcas, audios, previos] = await Promise.all([marcasParaNuevo(cuentas), listo ? bibliotecaDe(cuenta.id) : [], listo ? clipsPrevios(cuenta.id) : []])

  const musica = audios.filter((a) => a.tipo === "musica")
  const deLaMarca = Object.fromEntries(USOS_MUSICA.map((u) => [u, musica.find((a) => a.id === estilo?.config.musica[u])?.nombre ?? null])) as Record<UsoMusica, string | null>
  const ctas = (estilo?.config.ctas ?? []).map((c) => ({ clave: c.clave, nombre: c.titular.replace(/\*/g, "") || c.clave }))

  return (
    <DashboardShell title="Nuevo video">
      <NuevoVideo
        // Otra marca es otro formulario: lo elegido de la anterior (su biblioteca, su musica) no sirve aqui.
        key={cuenta.id}
        marcas={marcas}
        marcaId={cuenta.id}
        estilo={listo && estilo ? estilo.config : null}
        puedeEstilo={puedeEstilo}
        conVistaPrevia={puedeEstilo}
        ctas={ctas}
        nivelDefecto={estilo?.config.esfuerzo ?? "normal"}
        ctaDefecto={estilo?.config.clips.cta ?? null}
        biblioteca={musica.map((a) => ({ id: a.id, nombre: a.nombre, duracion: a.duracion, momento: a.momento }))}
        deLaMarca={deLaMarca}
        previos={previos}
      />
    </DashboardShell>
  )
}
