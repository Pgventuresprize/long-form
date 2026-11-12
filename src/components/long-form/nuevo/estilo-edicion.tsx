"use client"

import * as React from "react"
import { FileVideoIcon, XIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ACEPTA_ENTRADA } from "@/engine/long-form/nuevo"
import { VIDEO_REFERENTE } from "@/engine/long-form/referente"
import { cn } from "@/lib/utils"

import { ErrorCampo, FilaArchivo, Paso, Segmentado, tamano, ZonaArchivos } from "./comun"
import type { Referente } from "./tipos"

/**
 * Paso 5: como se edita. Con el estilo de la marca (lo normal) o imitando un referente: un video cuya edicion
 * gusta. Del referente se mide la forma; nada suyo llega al video.
 */
export function PasoEstilo({
  imitar,
  onImitar,
  referente,
  onReferente,
  error,
  deshabilitado,
}: {
  imitar: boolean
  onImitar: (v: boolean) => void
  referente: Referente
  onReferente: (r: Referente) => void
  error: string | null
  deshabilitado: boolean
}) {
  const [aviso, setAviso] = React.useState<string | null>(null)
  const nombre = React.useId()
  const opciones = [
    { valor: false, titulo: "El de tu marca", detalle: "Ritmo, gráficos y música como los dejaste en Marca." },
    { valor: true, titulo: "Imitar un referente", detalle: "Un video cuya edición te gusta." },
  ]
  return (
    <Paso n={5} id="paso-estilo" titulo="Estilo de edición" descripcion="Cómo se corta y se arma el video.">
      <div role="radiogroup" aria-label="Estilo de edición" className="grid gap-2 sm:grid-cols-2">
        {opciones.map((o) => (
          <label
            key={String(o.valor)}
            className={cn(
              "has-focus-visible:ring-ring/50 flex cursor-pointer gap-3 rounded-xl p-3 ring-1 transition-colors has-focus-visible:ring-3",
              imitar === o.valor ? "ring-foreground bg-muted/40" : "ring-foreground/10 hover:bg-muted/40"
            )}
          >
            <input type="radio" name={nombre} className="accent-foreground mt-0.5 size-4 shrink-0" checked={imitar === o.valor} disabled={deshabilitado} onChange={() => onImitar(o.valor)} />
            <span className="flex flex-col">
              <span className="text-sm font-medium">{o.titulo}</span>
              <span className="text-muted-foreground text-xs">{o.detalle}</span>
            </span>
          </label>
        ))}
      </div>

      {imitar ? (
        <div className="flex flex-col gap-3">
          <p className="text-muted-foreground text-sm">Medimos su ritmo, sus planos, sus pausas, sus gráficos y su música, y editamos el tuyo así. Nada del referente aparece en tu video.</p>
          <Segmentado
            etiqueta="Cómo das el referente"
            valor={referente.modo}
            opciones={[
              { valor: "archivo", nombre: "Subir un video" },
              { valor: "enlace", nombre: "Pegar un enlace" },
            ]}
            onCambio={(modo) => onReferente({ ...referente, modo })}
            deshabilitado={deshabilitado}
            className="self-start"
          />
          {referente.modo === "archivo" ? (
            referente.archivo ? (
              <ul className="ring-foreground/10 rounded-xl ring-1">
                <FilaArchivo icono={<FileVideoIcon />} nombre={referente.archivo.name} detalle={tamano(referente.archivo.size)}>
                  <Button type="button" size="icon-sm" variant="ghost" aria-label={`Quitar ${referente.archivo.name}`} disabled={deshabilitado} onClick={() => onReferente({ ...referente, archivo: null })}>
                    <XIcon />
                  </Button>
                </FilaArchivo>
              </ul>
            ) : (
              <ZonaArchivos
                compacta
                multiple={false}
                acepta={ACEPTA_ENTRADA.fuente}
                boton="Elegir el video"
                ayuda="MP4, MOV, M4V, MKV o WebM. Se analizan los primeros 30 minutos."
                deshabilitado={deshabilitado}
                onArchivos={(fs) => {
                  const f = fs[0]
                  if (!VIDEO_REFERENTE.test(f.name)) return setAviso(`${f.name} no es un video (mp4, mov, m4v, mkv o webm).`)
                  setAviso(null)
                  onReferente({ ...referente, archivo: f })
                }}
              />
            )
          ) : (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="lf-referente-url">Enlace del video</Label>
              <Input
                id="lf-referente-url"
                type="url"
                inputMode="url"
                value={referente.url}
                maxLength={500}
                disabled={deshabilitado}
                aria-invalid={Boolean(error) || undefined}
                aria-describedby="lf-referente-ayuda"
                onChange={(e) => onReferente({ ...referente, url: e.target.value })}
                placeholder="https://..."
              />
              <p id="lf-referente-ayuda" className="text-muted-foreground text-xs">
                Si no lo podemos bajar, te pediremos el archivo. Subir el video es lo más seguro.
              </p>
            </div>
          )}
          <ErrorCampo>{aviso ?? error}</ErrorCampo>
        </div>
      ) : null}
    </Paso>
  )
}
