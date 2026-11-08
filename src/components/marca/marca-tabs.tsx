"use client"

import * as React from "react"

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import type { Completitud, Pendiente } from "@/lib/marca-data"

import { GRUPOS, PESTANAS, SECCIONES_ESTILO, pestana as datosDe, type Grupo, type Pestana, type SeccionEstilo } from "./pestanas"

/**
 * Las pestanas de Marca, con el indicador de lo que falta encima.
 *
 * Dos niveles: lo comun y el estilo editorial (Carruseles, Short form, Long form). Carruseles
 * agrupa el kit, las skills y los ejemplos. La pestana abierta va en la URL (?tab=voz) para que
 * recargar, o volver de otra pantalla, no devuelva a la primera.
 */
export function MarcaTabs({
  inicial,
  completitud,
  paneles,
  ocultas = [],
}: {
  inicial: Pestana
  completitud: Completitud
  paneles: Record<Pestana, React.ReactNode>
  /** Las que no aplican a esta cuenta (Short form fuera de Advance). */
  ocultas?: Pestana[]
}) {
  const [pestana, setPestana] = React.useState<Pestana>(ocultas.includes(inicial) ? "identidad" : inicial)
  const visibles = PESTANAS.filter((p) => !ocultas.includes(p.valor))
  const actual = datosDe(pestana)

  const abrir = (valor: Pestana) => {
    setPestana(valor)
    const url = new URL(window.location.href)
    url.searchParams.set("tab", valor)
    window.history.replaceState(null, "", url)
  }
  const primeraDe = (filtro: (p: (typeof PESTANAS)[number]) => boolean) => visibles.find(filtro)?.valor
  const abrirGrupo = (g: Grupo) => {
    if (g === actual.grupo) return
    const v = primeraDe((p) => p.grupo === g)
    if (v) abrir(v)
  }
  const abrirSeccion = (s: SeccionEstilo) => {
    const v = primeraDe((p) => p.seccion === s)
    if (v) abrir(v)
  }
  const secciones = SECCIONES_ESTILO.filter((s) => visibles.some((p) => p.seccion === s.valor))
  const deCarrusel = visibles.filter((p) => p.seccion === "carruseles")

  return (
    <div className="flex flex-col gap-5">
      <Indicador completitud={completitud} onAbrir={abrir} />
      <Tabs value={actual.grupo} onValueChange={(v) => abrirGrupo(v as Grupo)} className="flex flex-col gap-4">
        <TabsList aria-label="Partes de la marca">
          {GRUPOS.map((g) => (
            <TabsTrigger key={g.valor} value={g.valor}>
              {g.etiqueta}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {actual.grupo === "comun" ? (
        <Tabs value={pestana} onValueChange={(v) => abrir(v as Pestana)} className="flex flex-col gap-5">
          <TabsList className="h-auto flex-wrap" aria-label="Lo común">
            {visibles
              .filter((p) => p.grupo === "comun")
              .map((p) => (
                <TabsTrigger key={p.valor} value={p.valor}>
                  {p.etiqueta}
                </TabsTrigger>
              ))}
          </TabsList>
          {visibles
            .filter((p) => p.grupo === "comun")
            .map((p) => (
              <TabsContent key={p.valor} value={p.valor}>
                {paneles[p.valor]}
              </TabsContent>
            ))}
        </Tabs>
      ) : (
        <Tabs value={actual.seccion} onValueChange={(v) => abrirSeccion(v as SeccionEstilo)} className="flex flex-col gap-5">
          <TabsList className="h-auto flex-wrap" aria-label="Estilo editorial">
            {secciones.map((s) => (
              <TabsTrigger key={s.valor} value={s.valor}>
                {s.etiqueta}
              </TabsTrigger>
            ))}
          </TabsList>
          <TabsContent value="carruseles">
            <Tabs value={pestana} onValueChange={(v) => abrir(v as Pestana)} className="flex flex-col gap-5">
              <TabsList variant="line" className="h-auto flex-wrap" aria-label="Carruseles">
                {deCarrusel.map((p) => (
                  <TabsTrigger key={p.valor} value={p.valor}>
                    {p.etiqueta}
                  </TabsTrigger>
                ))}
              </TabsList>
              {deCarrusel.map((p) => (
                <TabsContent key={p.valor} value={p.valor}>
                  {paneles[p.valor]}
                </TabsContent>
              ))}
            </Tabs>
          </TabsContent>
          {secciones
            .filter((s) => s.valor !== "carruseles")
            .map((s) => (
              <TabsContent key={s.valor} value={s.valor}>
                {paneles[s.valor as Pestana]}
              </TabsContent>
            ))}
        </Tabs>
      )}
    </div>
  )
}

function Indicador({ completitud, onAbrir }: { completitud: Completitud; onAbrir: (p: Pestana) => void }) {
  const { listos, total, faltan } = completitud
  const porcentaje = Math.round((listos / total) * 100)
  const [abierto, setAbierto] = React.useState(false)
  const visibles = abierto ? faltan : faltan.slice(0, 4)

  return (
    <div className="flex flex-col gap-2 rounded-lg border p-4">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium">
          {listos === total ? "Marca completa" : "Tu marca"}
        </span>
        <span className="text-muted-foreground text-sm tabular-nums">
          {listos} de {total} listo
        </span>
      </div>
      <div className="bg-muted h-1.5 overflow-hidden rounded-full" role="progressbar" aria-valuenow={porcentaje} aria-valuemin={0} aria-valuemax={100}>
        <div className="bg-primary h-full rounded-full transition-all" style={{ width: `${porcentaje}%` }} />
      </div>
      {faltan.length > 0 ? (
        <p className="text-muted-foreground text-xs leading-relaxed">
          Falta:{" "}
          {visibles.map((p: Pendiente, i) => (
            <React.Fragment key={p.campo}>
              {i > 0 ? " · " : null}
              <button type="button" onClick={() => onAbrir(p.pestana)} className="hover:text-foreground underline-offset-2 hover:underline">
                {p.campo}
              </button>
            </React.Fragment>
          ))}
          {faltan.length > 4 ? (
            <>
              {" "}
              <button type="button" onClick={() => setAbierto(!abierto)} className="text-foreground underline-offset-2 hover:underline">
                {abierto ? "ver menos" : `y ${faltan.length - 4} más`}
              </button>
            </>
          ) : null}
          . Lo vacío se llena con valores generales.
        </p>
      ) : null}
    </div>
  )
}
