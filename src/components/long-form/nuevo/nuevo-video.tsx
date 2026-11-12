"use client"

import * as React from "react"
import { useRouter } from "next/navigation"

import { crearProyecto } from "@/app/long-form/actions"
import type { EstiloLongForm, Nivel } from "@/engine/long-form/estilo"
import { OPCIONES_BASE, tituloDeArchivo, type OpcionesVideo, type UsoMusica } from "@/engine/long-form/nuevo"
import type { ClipPrevio, MarcaNuevo } from "@/engine/long-form/nuevo-datos"
import { esRutaReferente, validarUrlReferente } from "@/engine/long-form/referente"

import { useSubidas } from "../subidas"
import { PasoApoyo } from "./apoyo"
import { AsiSeVera } from "./asi-se-vera"
import { PasoClips } from "./clips"
import { PasoEstilo } from "./estilo-edicion"
import { Indicaciones } from "./indicaciones"
import { PasoMarca, SinEstilo } from "./marca"
import { PasoMusica } from "./musica"
import { nombreClip, type Apoyo, type Clip, type MusicaBib, type Pista, type Referente } from "./tipos"

type Errores = Partial<Record<"clips" | "musica" | "referente" | "titulo" | "general", string>>

type Props = {
  marcas: MarcaNuevo[]
  marcaId: string
  /** Null si la marca no tiene su estilo de long form confirmado: entonces solo se ve el paso 1 y el aviso. */
  estilo: EstiloLongForm | null
  puedeEstilo: boolean
  conVistaPrevia: boolean
  ctas: { clave: string; nombre: string }[]
  nivelDefecto: Nivel
  ctaDefecto: string | null
  biblioteca: MusicaBib[]
  deLaMarca: Record<UsoMusica, string | null>
  previos: ClipPrevio[]
}

/**
 * Nuevo video, en orden: marca, clips, apoyo, musica, estilo de edicion e indicaciones, con "Asi se vera" al
 * lado. "Editar video" crea el proyecto y las subidas arrancan en el gestor global: se puede ir a otra pantalla
 * y siguen.
 */
export function NuevoVideo(props: Props) {
  const { marcas, marcaId, estilo } = props
  const marca = marcas.find((m) => m.id === marcaId) ?? marcas[0]
  return (
    <div className="flex w-full max-w-6xl flex-col gap-4">
      <p className="text-muted-foreground -mt-3 max-w-2xl text-sm">Elige la marca, junta el material y cuéntale al editor qué quieres. Studio corta, monta el apoyo, mezcla el audio y le pone tu marca.</p>
      {estilo && marca ? (
        <Formulario {...props} estilo={estilo} marca={marca} />
      ) : (
        <div className="lg:max-w-[calc(100%-22rem)]">
          <PasoMarca marcas={marcas} marcaId={marcaId}>
            <SinEstilo puedeEstilo={props.puedeEstilo} />
          </PasoMarca>
        </div>
      )}
    </div>
  )
}

function Formulario({ marcas, marcaId, marca, estilo, conVistaPrevia, ctas, nivelDefecto, ctaDefecto, biblioteca, deLaMarca, previos }: Props & { estilo: EstiloLongForm; marca: MarcaNuevo }) {
  const router = useRouter()
  const { iniciar } = useSubidas()
  const [clips, setClips] = React.useState<Clip[]>([])
  const [audio, setAudio] = React.useState<File | null>(null)
  const [apoyo, setApoyo] = React.useState<Apoyo[]>([])
  const [pistas, setPistas] = React.useState<Pista[]>([])
  const [imitar, setImitar] = React.useState(false)
  const [referente, setReferente] = React.useState<Referente>({ modo: "archivo", archivo: null, url: "" })
  const [notas, setNotas] = React.useState("")
  const [opciones, setOpciones] = React.useState<OpcionesVideo>(OPCIONES_BASE)
  // El titulo sale del primer clip hasta que la persona lo escribe.
  const [tituloPropio, setTituloPropio] = React.useState<string | null>(null)
  const [nivel, setNivel] = React.useState<Nivel>(nivelDefecto)
  const [cta, setCta] = React.useState<string>(ctaDefecto ?? "")
  const [errores, setErrores] = React.useState<Errores>({})
  const [ocupado, start] = React.useTransition()

  const titulo = tituloPropio ?? (clips[0] ? tituloDeArchivo(nombreClip(clips[0])) : "")
  const listo = clips.length > 0 && titulo.trim().length > 0
  const falta = !clips.length ? "Falta al menos un clip." : !titulo.trim() ? "Falta el título, en Más opciones." : null
  const audios = pistas.length + (audio ? 1 : 0)
  const cuenta = `${clips.length} ${clips.length === 1 ? "clip" : "clips"} · ${apoyo.length} de apoyo · ${audios} ${audios === 1 ? "audio" : "audios"}`

  // Al tocar un paso, su aviso se va.
  const limpiar = (k: keyof Errores) => setErrores((e) => (e[k] || e.general ? { ...e, [k]: undefined, general: undefined } : e))

  const revisar = (): Errores => {
    const e: Errores = {}
    if (!clips.length) e.clips = "Agrega al menos un video para editar."
    if (!titulo.trim()) e.titulo = "Ponle un título al video."
    if (pistas.some((p) => !p.uso)) e.musica = "Elige para qué es cada pista (inicio, fondo o cierre), o quítala."
    if (imitar) {
      if (referente.modo === "archivo" && !referente.archivo) e.referente = "Elige el video de referencia, o usa el estilo de tu marca."
      if (referente.modo === "enlace") {
        const v = validarUrlReferente(referente.url)
        if (!v.ok) e.referente = v.error
      }
    }
    return e
  }

  const editar = () =>
    start(async () => {
      const e = revisar()
      setErrores(e)
      if (Object.keys(e).length) {
        document.querySelector<HTMLElement>(e.clips ? "#paso-clips-titulo" : e.musica ? "#paso-musica-titulo" : e.referente ? "#paso-estilo-titulo" : "#lf-titulo")?.scrollIntoView({ behavior: "smooth", block: "center" })
        return
      }
      // Lo que se sube, en un orden: la posicion de cada archivo va en su ruta y asi vuelve a su firma.
      const subir: { entrada: Parameters<typeof crearProyecto>[0]["archivos"][number]; archivo: File }[] = []
      const reutilizar: { archivoId: string; orden: number }[] = []
      clips.forEach((c, orden) => {
        if (c.origen === "subida") subir.push({ entrada: { nombre: c.archivo.name, bytes: c.archivo.size, tipo: "fuente", orden }, archivo: c.archivo })
        else reutilizar.push({ archivoId: c.previo.id, orden })
      })
      if (audio) subir.push({ entrada: { nombre: audio.name, bytes: audio.size, tipo: "audio" }, archivo: audio })
      for (const a of apoyo) subir.push({ entrada: { nombre: a.archivo.name, bytes: a.archivo.size, tipo: a.tipo }, archivo: a.archivo })
      const musicaBiblioteca: Partial<Record<UsoMusica, string>> = {}
      for (const p of pistas) {
        if (!p.uso) continue
        if (p.origen === "subida") subir.push({ entrada: { nombre: p.archivo.name, bytes: p.archivo.size, uso: p.uso }, archivo: p.archivo })
        else musicaBiblioteca[p.uso] = p.audio.id
      }
      const ref = !imitar ? null : referente.modo === "archivo" && referente.archivo ? { nombre: referente.archivo.name, bytes: referente.archivo.size } : { url: referente.url.trim() }

      const r = await crearProyecto({
        titulo,
        esfuerzo: nivel,
        notas,
        ctaDefecto: cta || null,
        archivos: subir.map((s) => s.entrada),
        reutilizar,
        musicaBiblioteca,
        referente: ref,
        opciones,
      })
      if (!r.ok) return setErrores({ general: r.error })
      // Cada firma con su archivo: la ruta lleva su posicion en `archivos` ("entrada/3-nombre.mp4"); la del
      // referente, su prefijo ("entrada/referente-nombre.mp4"). Los reusados no traen firma: ya estan.
      if (r.subidas.length) {
        iniciar(
          r.id,
          r.destino,
          r.subidas,
          r.subidas.map((s) => (esRutaReferente(s.ruta) && referente.archivo ? referente.archivo : subir[Number(/\/entrada\/(\d+)-/.exec(s.ruta)?.[1] ?? 1) - 1].archivo))
        )
      }
      router.push(`/long-form/${r.id}`)
    })

  return (
    <>
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_20rem] xl:grid-cols-[minmax(0,1fr)_23rem]">
        <div className="flex min-w-0 flex-col gap-4">
          <PasoMarca marcas={marcas} marcaId={marcaId} />
          <PasoClips
            clips={clips}
            onClips={(f) => {
              setClips(f)
              limpiar("clips")
            }}
            audio={audio}
            onAudio={setAudio}
            previos={previos}
            error={errores.clips ?? null}
            deshabilitado={ocupado}
          />
          <PasoApoyo apoyo={apoyo} onApoyo={setApoyo} deshabilitado={ocupado} />
          <PasoMusica
            pistas={pistas}
            onPistas={(f) => {
              setPistas(f)
              limpiar("musica")
            }}
            biblioteca={biblioteca}
            deLaMarca={deLaMarca}
            error={errores.musica ?? null}
            deshabilitado={ocupado}
          />
          <PasoEstilo
            imitar={imitar}
            onImitar={(v) => {
              setImitar(v)
              limpiar("referente")
            }}
            referente={referente}
            onReferente={(r) => {
              setReferente(r)
              limpiar("referente")
            }}
            error={errores.referente ?? null}
            deshabilitado={ocupado}
          />
        </div>
        <AsiSeVera
          marca={marca}
          estilo={estilo}
          conVistaPrevia={conVistaPrevia}
          opciones={opciones}
          clips={clips}
          apoyo={apoyo}
          audio={audio}
          pistas={pistas}
          deLaMarca={deLaMarca}
          referente={imitar ? (referente.modo === "archivo" ? referente.archivo?.name : referente.url.trim()) || "falta el referente" : null}
        />
      </div>
      <Indicaciones
        notas={notas}
        onNotas={setNotas}
        opciones={opciones}
        onOpciones={setOpciones}
        titulo={titulo}
        onTitulo={(v) => {
          setTituloPropio(v)
          limpiar("titulo")
        }}
        nivel={nivel}
        onNivel={setNivel}
        cta={cta}
        onCta={setCta}
        ctas={ctas}
        cuenta={cuenta}
        listo={listo}
        falta={falta}
        ocupado={ocupado}
        errorTitulo={errores.titulo ?? null}
        error={errores.general ?? null}
        onEnviar={editar}
      />
    </>
  )
}
