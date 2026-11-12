"use client"

import * as React from "react"
import { PlusIcon, QrCodeIcon, Trash2Icon } from "lucide-react"

import { guardarEstiloLongForm, qrDeEnlace } from "@/app/marca/long-form-actions"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import {
  MOMENTOS_SFX,
  NIVELES,
  NOMBRE_MOMENTO,
  NOMBRE_NIVEL,
  type CtaVideo,
  type EstiloLongForm,
  type FormatoClip,
  type Fuente,
  type Persona,
} from "@/engine/long-form/estilo"
import type { Audio } from "@/engine/long-form/estilo-datos"

import { SelectorAudio, sfxDeStudio } from "./audio"
import { Campo, ColorCampo, Opciones, Seccion, SubirArchivo } from "./campos"
import { VistaPrevia } from "./vista-previa"

export type FuenteDisponible = { clave: string; nombre: string; fuente: Fuente }

const ACEPTA_IMAGEN = "image/png,image/jpeg,image/webp"

/**
 * El estilo editorial de long form: lo que el motor usa para editar los videos largos de la marca.
 * La vista previa se dibuja con el mismo HTML que el motor y cambia con cada ajuste.
 */
export function EditorEstilo({
  inicial,
  biblioteca: bibliotecaInicial,
  fuentes,
  onCambio,
  sinGuardar = false,
}: {
  inicial: EstiloLongForm
  biblioteca: Audio[]
  fuentes: FuenteDisponible[]
  /** Dentro del onboarding: quien lo monta guarda y confirma. */
  onCambio?: (e: EstiloLongForm) => void
  sinGuardar?: boolean
}) {
  const [e, setE] = React.useState<EstiloLongForm>(inicial)
  React.useEffect(() => {
    onCambio?.(e)
  }, [e, onCambio])
  const [biblioteca, setBiblioteca] = React.useState(bibliotecaInicial)
  const [estado, setEstado] = React.useState<{ ok: boolean; texto: string } | null>(null)
  const [guardando, start] = React.useTransition()
  const cambiado = JSON.stringify(e) !== JSON.stringify(inicial)

  const set = <K extends keyof EstiloLongForm>(k: K, v: EstiloLongForm[K]) => setE((x) => ({ ...x, [k]: v }))
  const color = (k: keyof EstiloLongForm["colores"]) => (v: string) => setE((x) => ({ ...x, colores: { ...x.colores, [k]: v } }))
  const subido = (a: Audio) => setBiblioteca((b) => [a, ...b])

  const guardar = () =>
    start(async () => {
      setEstado(null)
      const r = await guardarEstiloLongForm(e)
      setEstado(r.ok ? { ok: true, texto: "Estilo guardado." } : { ok: false, texto: r.error })
    })

  const fuenteActual = fuentes.find((f) => JSON.stringify(f.fuente) === JSON.stringify(e.fuente))?.clave ?? "propia"

  return (
    <div className="flex flex-col gap-5 pb-20">
      <Seccion titulo="Vista previa" descripcion="Así salen los gráficos en tus videos. Cambia con cada ajuste.">
        <VistaPrevia estilo={e} piezas={["rotulo", "barra", "cita", "pregunta", "popup", "tarjeta-intro", "tarjeta-cierre", "subtitulo"]} />
      </Seccion>

      <Seccion titulo="Colores y fuente" descripcion="Parten de tu kit y de lo visual de la marca.">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <ColorCampo etiqueta="Acento" valor={e.colores.acento} onCambio={color("acento")} />
          <ColorCampo etiqueta="Texto sobre el acento" valor={e.colores.tinta} onCambio={color("tinta")} />
          <ColorCampo etiqueta="Acento para texto" valor={e.colores.acento_texto} onCambio={color("acento_texto")} />
          <ColorCampo etiqueta="Texto secundario" valor={e.colores.apagado} onCambio={color("apagado")} />
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Degradado</span>
          <div className="flex flex-wrap items-center gap-2">
            {e.colores.degradado.map((c, i) => (
              <div key={i} className="flex items-center gap-1">
                <input
                  type="color"
                  aria-label={`Color ${i + 1} del degradado`}
                  value={c}
                  onChange={(ev) => setE((x) => ({ ...x, colores: { ...x.colores, degradado: x.colores.degradado.map((y, j) => (j === i ? ev.target.value : y)) } }))}
                  className="border-input h-8 w-10 cursor-pointer rounded-md border bg-transparent p-0.5"
                />
                <Button type="button" size="icon" variant="ghost" aria-label={`Quitar color ${i + 1}`} onClick={() => setE((x) => ({ ...x, colores: { ...x.colores, degradado: x.colores.degradado.filter((_, j) => j !== i) } }))}>
                  <Trash2Icon />
                </Button>
              </div>
            ))}
            {e.colores.degradado.length < 5 ? (
              <Button type="button" size="sm" variant="outline" onClick={() => setE((x) => ({ ...x, colores: { ...x.colores, degradado: [...x.colores.degradado, x.colores.acento] } }))}>
                <PlusIcon />
                Color
              </Button>
            ) : null}
          </div>
          <p className="text-muted-foreground text-xs">Sin degradado, se usan dos tonos del acento.</p>
        </div>
        <div className="flex flex-col gap-2">
          <Opciones
            etiqueta="Fuente de los gráficos"
            valor={fuenteActual}
            opciones={[...fuentes.map((f) => ({ valor: f.clave, nombre: f.nombre })), ...(fuenteActual === "propia" && e.fuente.origen === "subida" ? [{ valor: "propia", nombre: e.fuente.familia }] : [])]}
            onCambio={(v) => {
              const f = fuentes.find((x) => x.clave === v)
              if (f) set("fuente", f.fuente)
            }}
          />
          <div className="self-start">
            <SubirArchivo clase="fuente" etiqueta="Subir una fuente" acepta=".woff2,.woff,.ttf,.otf" onSubido={(a, familia) => set("fuente", { origen: "subida", familia: familia || "Marca", archivo: a })} />
          </div>
        </div>
      </Seccion>

      <Seccion titulo="Logo y datos de cierre" descripcion="El logo va en las tarjetas de intro y cierre, sobre el color de acento.">
        <div className="flex flex-wrap items-center gap-3">
          <SubirArchivo clase="logo" etiqueta={e.logo.sobre_acento ? "Cambiar logo" : "Subir logo"} acepta={`${ACEPTA_IMAGEN},image/svg+xml`} onSubido={(a) => set("logo", { ...e.logo, sobre_acento: a })} />
          {e.logo.sobre_acento ? (
            <Button type="button" size="sm" variant="ghost" onClick={() => set("logo", { ...e.logo, sobre_acento: null })}>
              Quitar logo
            </Button>
          ) : (
            <span className="text-muted-foreground text-sm">Sin logo, las tarjetas solo llevan texto.</span>
          )}
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Campo etiqueta="Usuario en redes" valor={e.handle} max={40} placeholder="@tumarca" onCambio={(v) => set("handle", v)} />
          <Campo etiqueta="Web" valor={e.web} max={80} placeholder="tumarca.com" onCambio={(v) => set("web", v)} />
          <Campo etiqueta="Pie de la intro" valor={e.textos.pie_intro} max={60} onCambio={(v) => set("textos", { ...e.textos, pie_intro: v })} />
          <Campo etiqueta="Título del cierre" valor={e.textos.cierre_titulo} max={40} onCambio={(v) => set("textos", { ...e.textos, cierre_titulo: v })} />
          <Campo etiqueta="Texto del pop-up" valor={e.textos.popup} max={30} onCambio={(v) => set("textos", { ...e.textos, popup: v })} />
          <Campo etiqueta="Etiqueta de las preguntas" valor={e.textos.pregunta} max={20} onCambio={(v) => set("textos", { ...e.textos, pregunta: v })} />
        </div>
      </Seccion>

      <Seccion titulo="CTA de video" descripcion="Las barras que aparecen durante el video, con su QR. Lo que pongas entre *asteriscos* se resalta.">
        {e.ctas.length === 0 ? <p className="text-muted-foreground text-sm">Todavía no hay CTA. Agrega uno para que el video invite a algo.</p> : null}
        {e.ctas.map((c, i) => (
          <EditorCta
            key={c.clave}
            cta={c}
            onCambio={(nuevo) => set("ctas", e.ctas.map((x, j) => (j === i ? nuevo : x)))}
            onQuitar={() => setE((x) => ({ ...x, ctas: x.ctas.filter((_, j) => j !== i), clips: { ...x.clips, cta: x.clips.cta === c.clave ? null : x.clips.cta } }))}
          />
        ))}
        {e.ctas.length < 8 ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="self-start"
            onClick={() => set("ctas", [...e.ctas, { clave: `cta-${Date.now().toString(36)}`, kick: "", titular: "", apoyo: "", boton: "Escanea", pie: e.handle, url: "", qr: null }])}
          >
            <PlusIcon />
            Agregar CTA
          </Button>
        ) : null}
      </Seccion>

      <Seccion
        titulo="Música y efectos"
        descripcion="Audio (MP3, WAV, M4A) o un video MP4 o MOV, del que se usa el sonido. Sin música, el video empieza y termina en silencio. La de fondo suena bajo toda la conversación y baja sola cuando alguien habla."
      >
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <SelectorAudio etiqueta="Música de inicio" tipo="musica" momento="intro" valor={e.musica.intro} biblioteca={biblioteca} onSubido={subido} onCambio={(id) => set("musica", { ...e.musica, intro: id })} />
          <SelectorAudio etiqueta="Música de fondo" tipo="musica" momento="fondo" valor={e.musica.fondo} biblioteca={biblioteca} onSubido={subido} onCambio={(id) => set("musica", { ...e.musica, fondo: id })} />
          <SelectorAudio etiqueta="Música de cierre" tipo="musica" momento="cierre" valor={e.musica.cierre} biblioteca={biblioteca} onSubido={subido} onCambio={(id) => set("musica", { ...e.musica, cierre: id })} />
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Volumen etiqueta="Volumen de inicio y cierre" valor={e.musica.volumen} onCambio={(v) => set("musica", { ...e.musica, volumen: v })} />
          <Volumen etiqueta="Volumen del fondo" valor={e.musica.volumen_fondo} onCambio={(v) => set("musica", { ...e.musica, volumen_fondo: v })} />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" size="sm" variant="outline" onClick={() => set("sfx", sfxDeStudio(e.sfx))}>
            Usar los sonidos de Studio
          </Button>
          <span className="text-muted-foreground text-xs">Gratis y genéricos. Llena los momentos que no tienen efecto; luego puedes cambiar cualquiera.</span>
        </div>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {MOMENTOS_SFX.map((m) => (
            <SelectorAudio key={m} etiqueta={NOMBRE_MOMENTO[m]} tipo="sfx" momento={m} valor={e.sfx[m]} biblioteca={biblioteca} onSubido={subido} onCambio={(id) => set("sfx", { ...e.sfx, [m]: id })} />
          ))}
        </div>
        <Volumen etiqueta="Volumen de los efectos" valor={e.sfx.volumen} onCambio={(v) => set("sfx", { ...e.sfx, volumen: v })} />
      </Seccion>

      <Seccion titulo="Subtítulos de los clips" descripcion="Para los clips verticales. Míralos en la pestaña Subtítulos de la vista previa.">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Opciones etiqueta="Tipografía" valor={e.subtitulos.fuente} opciones={[{ valor: "marca", nombre: "La de la marca" }, { valor: "studio", nombre: "HeroFont" }]} onCambio={(v) => set("subtitulos", { ...e.subtitulos, fuente: v })} />
          <Opciones
            etiqueta="Tamaño"
            valor={e.subtitulos.tamano}
            opciones={[{ valor: "chico", nombre: "Chico" }, { valor: "mediano", nombre: "Mediano" }, { valor: "grande", nombre: "Grande" }]}
            onCambio={(v) => set("subtitulos", { ...e.subtitulos, tamano: v })}
          />
          <ColorCampo etiqueta="Color del texto" valor={e.subtitulos.color} onCambio={(v) => set("subtitulos", { ...e.subtitulos, color: v })} />
          <ColorCampo etiqueta="Color de la caja" valor={e.subtitulos.fondo} onCambio={(v) => set("subtitulos", { ...e.subtitulos, fondo: v })} />
        </div>
        <Volumen etiqueta="Opacidad de la caja" valor={e.subtitulos.fondo_alfa} onCambio={(v) => set("subtitulos", { ...e.subtitulos, fondo_alfa: v })} />
        <div className="flex flex-wrap items-end gap-4">
          <Interruptor etiqueta="Resaltar la palabra que se dice" valor={Boolean(e.subtitulos.resaltado)} onCambio={(v) => set("subtitulos", { ...e.subtitulos, resaltado: v ? e.colores.acento : "" })} />
          {e.subtitulos.resaltado ? <ColorCampo etiqueta="Color del resaltado" valor={e.subtitulos.resaltado} onCambio={(v) => set("subtitulos", { ...e.subtitulos, resaltado: v })} /> : null}
          <Interruptor etiqueta="En mayúsculas" valor={e.subtitulos.mayusculas} onCambio={(v) => set("subtitulos", { ...e.subtitulos, mayusculas: v })} />
        </div>
      </Seccion>

      <Seccion titulo="Edición" descripcion="Cuánto corta y cuántos gráficos pone. Cada video puede cambiar el nivel al crearlo.">
        <Opciones
          etiqueta="Silencios"
          valor={e.silencios}
          opciones={[
            { valor: "suave", nombre: "Suave", detalle: "Solo las pausas largas" },
            { valor: "normal", nombre: "Normal", detalle: "Pausas de más de medio segundo" },
            { valor: "fuerte", nombre: "Fuerte", detalle: "Ritmo rápido" },
          ]}
          onCambio={(v) => set("silencios", v)}
        />
        <Opciones
          etiqueta="Gráficos"
          valor={e.graficos}
          opciones={[
            { valor: "pocos", nombre: "Pocos", detalle: "Una barra cada 12 min" },
            { valor: "normal", nombre: "Normal", detalle: "Una barra cada 7 min" },
            { valor: "muchos", nombre: "Muchos", detalle: "Una barra cada 5 min" },
          ]}
          onCambio={(v) => set("graficos", v)}
        />
        <Opciones
          etiqueta="Nivel de esfuerzo por defecto"
          valor={e.esfuerzo}
          opciones={NIVELES.map((n) => ({
            valor: n,
            nombre: NOMBRE_NIVEL[n],
            detalle: n === "rapido" ? "Solo revisas la difusión" : n === "normal" ? "Revisas el guion" : "Revisas todo",
          }))}
          onCambio={(v) => set("esfuerzo", v)}
        />
      </Seccion>

      <Seccion titulo="Clips" descripcion="Los clips verticales que salen de cada video.">
        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1.5 text-sm font-medium">Formatos</legend>
          <div className="flex flex-wrap gap-4">
            {(
              [
                ["real", "Tamaño real", "El cuadro completo sobre el color de la marca"],
                ["dividida", "Dividida", "Arriba lo que se muestra, abajo quien habla"],
              ] as [FormatoClip, string, string][]
            ).map(([f, nombre, detalle]) => (
              <label key={f} className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-0.5 size-4 accent-[var(--brand)]"
                  checked={e.clips.formatos.includes(f)}
                  onChange={(ev) => {
                    const formatos = ev.target.checked ? [...e.clips.formatos, f] : e.clips.formatos.filter((x) => x !== f)
                    if (formatos.length) set("clips", { ...e.clips, formatos })
                  }}
                />
                <span>
                  <span className="font-medium">{nombre}</span>
                  <span className="text-muted-foreground block text-xs">{detalle}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <div className="grid grid-cols-2 gap-3 sm:max-w-sm">
          <Numero etiqueta="Duración mínima (s)" valor={e.clips.duracion_min} min={15} max={120} onCambio={(v) => set("clips", { ...e.clips, duracion_min: v })} />
          <Numero etiqueta="Duración máxima (s)" valor={e.clips.duracion_max} min={20} max={180} onCambio={(v) => set("clips", { ...e.clips, duracion_max: v })} />
        </div>
        <Opciones
          etiqueta="CTA de los clips"
          valor={e.clips.cta ?? ""}
          opciones={[{ valor: "", nombre: "Sin CTA" }, ...e.ctas.map((c) => ({ valor: c.clave, nombre: c.titular.replace(/\*/g, "") || c.clave }))]}
          onCambio={(v) => set("clips", { ...e.clips, cta: v || null })}
          ayuda="Va como tarjeta final de unos segundos y como una línea en el caption."
        />
      </Seccion>

      <Seccion titulo="Personas recurrentes" descripcion="Quienes salen seguido en tus videos. Así sus rótulos salen solos.">
        {e.personas.map((p, i) => (
          <EditorPersona key={p.id} persona={p} onCambio={(nueva) => set("personas", e.personas.map((x, j) => (j === i ? nueva : x)))} onQuitar={() => set("personas", e.personas.filter((_, j) => j !== i))} />
        ))}
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="self-start"
          onClick={() => set("personas", [...e.personas, { id: crypto.randomUUID(), nombre: "", cargo: "", handle: "", red: "Instagram", foto: null }])}
        >
          <PlusIcon />
          Agregar persona
        </Button>
      </Seccion>

      <div
        className={`bg-background/90 sticky bottom-0 z-10 -mx-4 flex-wrap items-center gap-3 border-t px-4 py-3 backdrop-blur md:mx-0 md:rounded-xl md:border ${sinGuardar ? "hidden" : "flex"}`}
      >
        <Button type="button" variant="brand" disabled={guardando || !cambiado} onClick={guardar}>
          {guardando ? "Guardando..." : "Guardar estilo"}
        </Button>
        {cambiado ? (
          <Button type="button" variant="ghost" disabled={guardando} onClick={() => setE(inicial)}>
            Descartar cambios
          </Button>
        ) : null}
        {estado ? (
          <p className={`text-sm ${estado.ok ? "text-success" : "text-destructive"}`} role="status">
            {estado.texto}
          </p>
        ) : cambiado ? (
          <p className="text-muted-foreground text-sm">Hay cambios sin guardar.</p>
        ) : null}
      </div>
    </div>
  )
}

function EditorCta({ cta, onCambio, onQuitar }: { cta: CtaVideo; onCambio: (c: CtaVideo) => void; onQuitar: () => void }) {
  const [ocupado, setOcupado] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const set = <K extends keyof CtaVideo>(k: K, v: CtaVideo[K]) => onCambio({ ...cta, [k]: v })
  return (
    <div className="flex flex-col gap-3 rounded-lg border p-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Campo etiqueta="Titular" valor={cta.titular} max={60} placeholder="Únete a la *comunidad*" onCambio={(v) => set("titular", v)} />
        <Campo etiqueta="Línea pequeña de arriba" valor={cta.kick} max={60} onCambio={(v) => set("kick", v)} />
        <Campo etiqueta="Línea de apoyo" valor={cta.apoyo} max={160} onCambio={(v) => set("apoyo", v)} />
        <Campo etiqueta="Botón" valor={cta.boton} max={30} onCambio={(v) => set("boton", v)} />
        <Campo etiqueta="Enlace del QR" valor={cta.url} max={300} placeholder="https://" onCambio={(v) => set("url", v)} />
        <Campo etiqueta="Debajo del QR" valor={cta.pie} max={40} onCambio={(v) => set("pie", v)} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={ocupado || !cta.url}
          onClick={async () => {
            setError(null)
            setOcupado(true)
            const r = await qrDeEnlace(cta.url)
            setOcupado(false)
            if (r.ok) set("qr", r.archivo)
            else setError(r.error)
          }}
        >
          <QrCodeIcon />
          {ocupado ? "Creando..." : cta.qr ? "Rehacer QR del enlace" : "Crear QR del enlace"}
        </Button>
        <SubirArchivo clase="qr" etiqueta="Subir un QR" acepta={ACEPTA_IMAGEN} onSubido={(a) => set("qr", a)} />
        <span className="text-muted-foreground text-xs">{cta.qr ? "Con QR." : "Sin QR todavía."}</span>
        <Button type="button" size="sm" variant="ghost" className="ml-auto" onClick={onQuitar}>
          <Trash2Icon />
          Quitar
        </Button>
      </div>
      {error ? (
        <p className="text-destructive text-xs" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}

function EditorPersona({ persona, onCambio, onQuitar }: { persona: Persona; onCambio: (p: Persona) => void; onQuitar: () => void }) {
  const set = <K extends keyof Persona>(k: K, v: Persona[K]) => onCambio({ ...persona, [k]: v })
  return (
    <div className="flex flex-col gap-3 rounded-lg border p-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Campo etiqueta="Nombre" valor={persona.nombre} max={60} onCambio={(v) => set("nombre", v)} />
        <Campo etiqueta="Cargo" valor={persona.cargo} max={80} onCambio={(v) => set("cargo", v)} />
        <Campo etiqueta="Usuario" valor={persona.handle} max={40} placeholder="@usuario" onCambio={(v) => set("handle", v)} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <SubirArchivo clase="foto" etiqueta={persona.foto ? "Cambiar foto" : "Subir foto"} acepta={ACEPTA_IMAGEN} onSubido={(a) => set("foto", a)} />
        <span className="text-muted-foreground text-xs">La foto ayuda a reconocerla en el video.</span>
        <Button type="button" size="sm" variant="ghost" className="ml-auto" onClick={onQuitar}>
          <Trash2Icon />
          Quitar
        </Button>
      </div>
    </div>
  )
}

function Volumen({ etiqueta, valor, onCambio }: { etiqueta: string; valor: number; onCambio: (v: number) => void }) {
  const id = React.useId()
  return (
    <div className="flex flex-col gap-1.5 sm:max-w-sm">
      <div className="flex items-center justify-between">
        <Label htmlFor={id}>{etiqueta}</Label>
        <span className="text-muted-foreground text-sm tabular-nums">{Math.round(valor * 100)} %</span>
      </div>
      <input id={id} type="range" min={0} max={100} value={Math.round(valor * 100)} onChange={(ev) => onCambio(Number(ev.target.value) / 100)} className="accent-[var(--brand)]" />
    </div>
  )
}

function Numero({ etiqueta, valor, min, max, onCambio }: { etiqueta: string; valor: number; min: number; max: number; onCambio: (v: number) => void }) {
  const id = React.useId()
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{etiqueta}</Label>
      <input
        id={id}
        type="number"
        min={min}
        max={max}
        value={valor}
        onChange={(ev) => onCambio(Math.min(max, Math.max(min, Number(ev.target.value) || min)))}
        className="border-input bg-background h-8 rounded-md border px-2 text-sm"
      />
    </div>
  )
}

function Interruptor({ etiqueta, valor, onCambio }: { etiqueta: string; valor: boolean; onCambio: (v: boolean) => void }) {
  const id = React.useId()
  return (
    <div className="flex items-center gap-2">
      <Switch id={id} checked={valor} onCheckedChange={(v) => onCambio(Boolean(v))} />
      <Label htmlFor={id}>{etiqueta}</Label>
    </div>
  )
}
