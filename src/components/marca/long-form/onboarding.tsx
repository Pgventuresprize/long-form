"use client"

import * as React from "react"
import { CheckIcon } from "lucide-react"

import { guardarEstiloLongForm } from "@/app/marca/long-form-actions"
import { Button } from "@/components/ui/button"
import type { EstiloLongForm } from "@/engine/long-form/estilo"
import type { Audio } from "@/engine/long-form/estilo-datos"

import { SelectorAudio } from "./audio"
import { EditorEstilo, type FuenteDisponible } from "./editor"
import { VistaPrevia } from "./vista-previa"

/**
 * La primera vez que una marca entra a long form: una propuesta armada con su kit y lo comun, un
 * rotulo y una barra de muestra, la musica (o seguir sin ella) y confirmar. Un minuto.
 */
export function OnboardingEstilo({
  propuesta,
  origen,
  biblioteca: bibliotecaInicial,
  fuentes,
}: {
  propuesta: EstiloLongForm
  /** De donde salio cada cosa, en una linea. */
  origen: string[]
  biblioteca: Audio[]
  fuentes: FuenteDisponible[]
}) {
  const [e, setE] = React.useState(propuesta)
  const [biblioteca, setBiblioteca] = React.useState(bibliotecaInicial)
  const [cambiar, setCambiar] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [ocupado, start] = React.useTransition()

  const confirmar = () =>
    start(async () => {
      setError(null)
      const r = await guardarEstiloLongForm(e, { confirmar: true })
      if (!r.ok) setError(r.error)
    })

  if (cambiar) {
    return (
      <div className="flex flex-col gap-4">
        <div className="bg-muted/50 flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4">
          <p className="text-sm">Ajusta lo que quieras y confirma cuando esté listo.</p>
          <Button type="button" variant="brand" disabled={ocupado} onClick={confirmar}>
            {ocupado ? "Guardando..." : "Confirmar estilo"}
          </Button>
        </div>
        {error ? (
          <p className="text-destructive text-sm" role="alert">
            {error}
          </p>
        ) : null}
        <EditorEstiloControlado valor={e} onCambio={setE} biblioteca={biblioteca} fuentes={fuentes} />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h2 className="font-display text-2xl">Tu estilo para videos largos</h2>
        <p className="text-muted-foreground text-sm">Lo armamos con lo que ya tiene tu marca. Revísalo, agrega música si quieres y confirma.</p>
      </div>

      <ul className="flex flex-col gap-1.5 text-sm">
        {origen.map((o) => (
          <li key={o} className="flex gap-2">
            <CheckIcon className="text-muted-foreground mt-0.5 size-4 shrink-0" aria-hidden />
            <span>{o}</span>
          </li>
        ))}
      </ul>

      <VistaPrevia estilo={e} piezas={["rotulo", "barra"]} />

      <div className="flex flex-col gap-4 rounded-xl border p-4">
        <div>
          <h3 className="font-medium">Música</h3>
          <p className="text-muted-foreground text-sm">MP3 o WAV para la intro y el cierre. Puedes seguir sin ella y ponerla después.</p>
        </div>
        <SelectorAudio
          etiqueta="Música de intro"
          tipo="musica"
          momento="intro"
          valor={e.musica.intro}
          biblioteca={biblioteca}
          onSubido={(a) => setBiblioteca((b) => [a, ...b])}
          // Sin cierre propio, la misma cancion abre y cierra.
          onCambio={(id) => setE((x) => ({ ...x, musica: { ...x.musica, intro: id, cierre: x.musica.cierre ?? id } }))}
        />
      </div>

      {error ? (
        <p className="text-destructive text-sm" role="alert">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="brand" disabled={ocupado} onClick={confirmar}>
          {ocupado ? "Guardando..." : e.musica.intro ? "Confirmar" : "Confirmar sin música"}
        </Button>
        <Button type="button" variant="outline" disabled={ocupado} onClick={() => setCambiar(true)}>
          Cambiar algo
        </Button>
      </div>
    </div>
  )
}

/**
 * El editor sin su boton de guardar, para usarlo dentro del onboarding: el estado lo lleva quien lo
 * monta. Reutiliza el editor completo montandolo con la clave del valor confirmado.
 */
function EditorEstiloControlado({ valor, onCambio, biblioteca, fuentes }: { valor: EstiloLongForm; onCambio: (e: EstiloLongForm) => void; biblioteca: Audio[]; fuentes: FuenteDisponible[] }) {
  return <EditorEstilo inicial={valor} biblioteca={biblioteca} fuentes={fuentes} onCambio={onCambio} sinGuardar />
}
