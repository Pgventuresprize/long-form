import { DashboardShell } from "@/components/dashboard-shell"
import { EditorCtas } from "@/components/marca/editor-ctas"
import { EditorLista } from "@/components/marca/editor-lista"
import { PestanaIdentidad } from "@/components/marca/identidad"
import { PestanaLongForm } from "@/components/marca/long-form/pestana"
import { MarcaTabs } from "@/components/marca/marca-tabs"
import { esPestana, type Pestana } from "@/components/marca/pestanas"
import { ConfigVideos } from "@/components/videos/config-videos"
import { cuentaActual } from "@/lib/accounts"
import { getVideoStudio } from "@/lib/videos-data"
import { PestanaEjemplos } from "@/components/marca/ejemplos"
import { PestanaImagenes } from "@/components/marca/imagenes"
import { PestanaKit } from "@/components/marca/kit"
import { PestanaSkills } from "@/components/marca/skills"
import { PestanaVisual } from "@/components/marca/visual"
import { PestanaVoz } from "@/components/marca/voz"
import { pexelsConfigurado } from "@/engine/render/pexels"
import { datosDeMarca } from "@/lib/marca-data"

export const dynamic = "force-dynamic"
// Importar ejemplos desde un archivo llama a Claude una vez por pieza.
export const maxDuration = 300

export const metadata = { title: "Marca · Plogy Studio" }

/**
 * Quien es la marca, como escribe, de que habla, que pide y como se ve.
 *
 * Todo lo de la marca en un solo sitio y en todos los planes: es lo que los
 * agentes leen antes de escribir. Una cuenta nueva lo encuentra vacio, y lo
 * vacio se llena con valores generales hasta que la marca decida.
 */
export default async function MarcaPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const [{ tab }, datos, cuenta] = await Promise.all([searchParams, datosDeMarca(), cuentaActual()])
  const inicial: Pestana = esPestana(tab) ? tab : "identidad"
  const { perfil, editorial, variables, estilo, paleta, skills, ejemplos, completitud } = datos
  const pilares = editorial.pilares.map((p) => ({ id: p.id, name: p.name }))
  // El short form es del plan Advance, como Video studio; su configuracion se mueve aqui tal cual.
  const advance = cuenta.plan === "advance"
  const video = advance ? await getVideoStudio() : null

  return (
    <DashboardShell title="Marca">
      <div className="max-w-3xl">
        <MarcaTabs
          inicial={inicial}
          completitud={completitud}
          ocultas={advance ? [] : ["short-form"]}
          paneles={{
            identidad: <PestanaIdentidad perfil={perfil} />,
            voz: <PestanaVoz perfil={perfil} tono={variables.tono} longitud={variables.longitud} />,
            editorial: (
              <div className="flex flex-col gap-8">
                <EditorLista
                  tabla="content_pillars"
                  filas={editorial.pilares}
                  conPregunta
                  titulo="Pilares"
                  descripcion="Los grandes territorios de la marca. Cada pieza tiene un pilar principal; el primero de la lista es el que más pesa."
                  ejemploNombre="Nombre del pilar"
                  ejemploDescripcion="Qué cabe en este pilar y qué no."
                  avisoAlBorrar="Borrar un pilar borra también sus temas y subtemas del Estudio."
                />
                <EditorLista
                  tabla="content_audiences"
                  filas={editorial.audiencias}
                  titulo="Audiencias"
                  descripcion="Para quién escribe la marca. El agente ajusta el nivel técnico y los ejemplos a cada una."
                  ejemploNombre="Nombre de la audiencia"
                  ejemploDescripcion="Quiénes son, qué les importa y qué saben ya."
                />
                <EditorLista
                  tabla="content_verticals"
                  filas={editorial.verticales}
                  titulo="Verticales"
                  descripcion="Los terrenos o líneas de negocio de los que habla la marca."
                  ejemploNombre="Nombre de la vertical"
                  ejemploDescripcion="Qué temas entran en esta vertical."
                />
              </div>
            ),
            cta: <EditorCtas ctas={editorial.ctas} />,
            visual: <PestanaVisual estilo={estilo} paleta={paleta} pexelsConfigurado={pexelsConfigurado()} />,
            kit: <PestanaKit />,
            imagenes: <PestanaImagenes />,
            skills: <PestanaSkills skills={skills} pilares={pilares} />,
            ejemplos: <PestanaEjemplos ejemplos={ejemplos} pilares={pilares} />,
            "short-form": video ? <ConfigVideos ajustes={video.ajustes} opciones={video.opciones} /> : null,
            "long-form": <PestanaLongForm accountId={cuenta.id} />,
          }}
        />
      </div>
    </DashboardShell>
  )
}
