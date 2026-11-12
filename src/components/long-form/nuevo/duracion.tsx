"use client"

import * as React from "react"

import { DURACIONES, NOMBRE_DURACION, type Duracion } from "@/engine/long-form/nuevo"

/**
 * Cuanto hay que girar la rueda (en pixeles de deltaY) para pasar de un rango al siguiente: un "clic" de la
 * rueda de un mouse son ~100 px, asi cada clic es un rango; un trackpad manda pasos chicos que se suman.
 */
const PASO_RUEDA = 100

/**
 * La duracion del video, con un control deslizable: a la izquierda "lo que de el material" y despues rangos
 * que se duplican (30 s a 1 min, 1 a 2, 2 a 4... hasta 2 h). Se mueve arrastrando, con las flechas o con la
 * rueda del mouse encima: arriba alarga, abajo acorta. La rueda acumula, asi un trackpad no salta de golpe.
 */
export function DuracionDeslizable({ valor, onCambio, deshabilitado }: { valor: Duracion; onCambio: (d: Duracion) => void; deshabilitado?: boolean }) {
  const caja = React.useRef<HTMLDivElement>(null)
  const indice = Math.max(0, DURACIONES.indexOf(valor))
  // la rueda lee siempre lo ultimo sin volver a registrar el oyente en cada cambio
  const ultimo = React.useRef({ indice, onCambio, deshabilitado })
  React.useEffect(() => {
    ultimo.current = { indice, onCambio, deshabilitado }
  })

  React.useEffect(() => {
    const el = caja.current
    if (!el) return
    let acumulado = 0
    const rueda = (e: WheelEvent) => {
      const { indice: i, onCambio: cambiar, deshabilitado: quieto } = ultimo.current
      if (quieto) return
      // Encima del control la rueda lo mueve a el, no a la pagina.
      e.preventDefault()
      // en pixeles; en "lineas" (Firefox con algunos mouse) cada linea vale ~1/3 de paso
      const delta = e.deltaMode === 1 ? e.deltaY * 20 : e.deltaY
      // al cambiar de sentido no se arrastra lo que sobro del sentido anterior
      if (acumulado && Math.sign(delta) !== Math.sign(acumulado)) acumulado = 0
      acumulado += delta
      // un giro largo puede llegar en un solo evento: avanza tantos pasos como alcance, y guarda el resto
      const pasos = Math.trunc(acumulado / PASO_RUEDA)
      if (!pasos) return
      acumulado -= pasos * PASO_RUEDA
      const j = Math.min(DURACIONES.length - 1, Math.max(0, i - pasos))
      if (j !== i) {
        // el siguiente giro parte de aqui aunque React todavia no haya pintado el cambio
        ultimo.current.indice = j
        cambiar(DURACIONES[j])
      }
      // en un extremo, lo que se siga girando no cuenta para despues
      if (j === 0 || j === DURACIONES.length - 1) acumulado = 0
    }
    el.addEventListener("wheel", rueda, { passive: false })
    return () => el.removeEventListener("wheel", rueda)
  }, [])

  const id = React.useId()
  return (
    <div ref={caja} className="flex w-full min-w-0 flex-col gap-1 sm:w-64" title="Arrastra, usa las flechas o gira la rueda del mouse">
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <label htmlFor={id} className="text-muted-foreground">
          Duración
        </label>
        <span className="truncate font-medium tabular-nums" aria-hidden>
          {NOMBRE_DURACION[valor]}
        </span>
      </div>
      <input
        id={id}
        type="range"
        min={0}
        max={DURACIONES.length - 1}
        step={1}
        value={indice}
        disabled={deshabilitado}
        onChange={(e) => onCambio(DURACIONES[Number(e.target.value)])}
        aria-valuetext={NOMBRE_DURACION[valor]}
        className="accent-brand h-1.5 w-full cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
      />
      <div className="text-muted-foreground flex justify-between text-[10px]" aria-hidden>
        <span>Lo que dé</span>
        <span>30 s</span>
        <span>8 min</span>
        <span>2 h</span>
      </div>
    </div>
  )
}
