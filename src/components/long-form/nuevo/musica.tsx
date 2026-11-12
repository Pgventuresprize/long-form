"use client"

import * as React from "react"
import Link from "next/link"
import { MusicIcon, XIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ACEPTA_AUDIO, formatoPorNombre, maxBytesDe, MENSAJE_FORMATO, mensajeTamano } from "@/engine/long-form/audio"
import { conUso, NOMBRE_USO, USOS_MUSICA, usoLibre, type UsoMusica } from "@/engine/long-form/nuevo"

import { duracionTexto, ErrorCampo, FilaArchivo, nuevoId, Paso, Segmentado, tamano, ZonaArchivos } from "./comun"
import { nombrePista, type MusicaBib, type Pista } from "./tipos"

const USOS = USOS_MUSICA.map((u) => ({ valor: u, nombre: NOMBRE_USO[u] }))

/**
 * Paso 4: la musica de este video. Cada pista es para un momento (inicio, fondo o cierre) y cada momento tiene
 * una sola: elegir uno que ya tiene otra pista se lo quita a esa. Lo que no se elige sale del estilo de la marca.
 */
export function PasoMusica({
  pistas,
  onPistas,
  biblioteca,
  deLaMarca,
  error,
  deshabilitado,
}: {
  pistas: Pista[]
  onPistas: (f: (xs: Pista[]) => Pista[]) => void
  biblioteca: MusicaBib[]
  /** El nombre de la musica del estilo de la marca para cada momento (null: la marca no tiene). */
  deLaMarca: Record<UsoMusica, string | null>
  error: string | null
  deshabilitado: boolean
}) {
  const [aviso, setAviso] = React.useState<string | null>(null)
  const llenas = pistas.length >= USOS_MUSICA.length

  const subir = (fs: File[]) => {
    const nuevas: Pista[] = []
    let problema: string | null = null
    for (const f of fs) {
      const formato = formatoPorNombre(f.name, f.type)
      if (!formato) problema ??= `${f.name}: ${MENSAJE_FORMATO}`
      else if (f.size > maxBytesDe(formato)) problema ??= `${f.name}: ${mensajeTamano(formato)}`
      else nuevas.push({ id: nuevoId(), uso: null, origen: "subida", archivo: f })
    }
    const libres = USOS_MUSICA.length - pistas.length
    if (nuevas.length > libres) problema ??= "Van tres pistas como mucho: una de inicio, una de fondo y una de cierre."
    setAviso(problema)
    agregar(nuevas.slice(0, Math.max(0, libres)))
  }

  const agregar = (nuevas: Pista[]) =>
    onPistas((xs) => {
      let out = [...xs]
      for (const p of nuevas) {
        const preferido = p.origen === "biblioteca" && USOS_MUSICA.includes(p.audio.momento as UsoMusica) ? (p.audio.momento as UsoMusica) : null
        out = [...out, { ...p, uso: usoLibre(out, preferido) }]
      }
      return out
    })

  const usadas = new Set(pistas.flatMap((p) => (p.origen === "biblioteca" ? [p.audio.id] : [])))
  const disponibles = biblioteca.filter((b) => !usadas.has(b.id))
  const libres = USOS_MUSICA.filter((u) => !pistas.some((p) => p.uso === u))

  return (
    <Paso n={4} id="paso-musica" titulo="Música y sonidos" descripcion="Para este video. Elige para qué es cada pista." meta={pistas.length ? `${pistas.length} ${pistas.length === 1 ? "pista" : "pistas"}` : "Opcional"}>
      <ZonaArchivos acepta={ACEPTA_AUDIO} boton="Subir música" ayuda="MP3, WAV, M4A o AAC, o un video MP4 o MOV (se usa su audio)." onArchivos={subir} deshabilitado={deshabilitado || llenas}>
        {disponibles.length ? (
          <Select
            value=""
            disabled={deshabilitado || llenas}
            onValueChange={(v) => {
              const audio = biblioteca.find((b) => b.id === v)
              if (audio) agregar([{ id: nuevoId(), uso: null, origen: "biblioteca", audio }])
            }}
          >
            <SelectTrigger aria-label="Elegir música de la biblioteca de tu marca">
              <SelectValue>{() => "Elegir de la biblioteca"}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {disponibles.map((b) => (
                <SelectItem key={b.id} value={b.id}>
                  <span className="truncate">{b.nombre}</span>
                  {b.duracion ? <span className="text-muted-foreground text-xs tabular-nums">{duracionTexto(b.duracion)}</span> : null}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
      </ZonaArchivos>
      <ErrorCampo>{aviso ?? error}</ErrorCampo>

      {pistas.length ? (
        <ul className="ring-foreground/10 flex flex-col divide-y rounded-xl ring-1" aria-label="Música del video">
          {pistas.map((p) => (
            <FilaArchivo
              key={p.id}
              icono={<MusicIcon />}
              nombre={nombrePista(p)}
              detalle={[p.origen === "biblioteca" ? "Biblioteca" : tamano(p.archivo.size), p.origen === "biblioteca" ? duracionTexto(p.audio.duracion) : "", p.uso ? "" : "Elige para qué es"].filter(Boolean).join(" · ")}
              className="flex-wrap sm:flex-nowrap"
            >
              <Segmentado etiqueta={`Para qué es ${nombrePista(p)}`} valor={p.uso} opciones={USOS} onCambio={(u) => onPistas((xs) => conUso(xs, p.id, u))} deshabilitado={deshabilitado} />
              <Button type="button" size="icon-sm" variant="ghost" aria-label={`Quitar ${nombrePista(p)}`} disabled={deshabilitado} onClick={() => onPistas((xs) => xs.filter((x) => x.id !== p.id))}>
                <XIcon />
              </Button>
            </FilaArchivo>
          ))}
        </ul>
      ) : null}

      {libres.length ? (
        <ul className="text-muted-foreground flex flex-col gap-1 text-sm">
          {libres.map((u) => (
            <li key={u}>
              <span className="text-foreground font-medium">{NOMBRE_USO[u]}:</span> {deLaMarca[u] ? `si no eliges, se usa la de tu marca: ${deLaMarca[u]}.` : "si no eliges, va sin música."}
            </li>
          ))}
        </ul>
      ) : null}

      <p className="text-muted-foreground border-t pt-3 text-sm">
        <span className="text-foreground font-medium">Efectos:</span> los de tu marca.{" "}
        <Link href="/marca?tab=long-form" className="text-brand-text underline-offset-4 hover:underline focus-visible:underline">
          Cambiarlos en Marca
        </Link>
      </p>
    </Paso>
  )
}
