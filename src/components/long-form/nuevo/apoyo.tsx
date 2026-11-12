"use client"

import * as React from "react"
import { FileTextIcon, FileVideoIcon, ImageIcon, XIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { ACEPTA_ENTRADA, tipoDeApoyo } from "@/engine/long-form/nuevo"

import { ErrorCampo, FilaArchivo, nuevoId, Paso, sinRepetir, tamano, ZonaArchivos } from "./comun"
import type { Apoyo } from "./tipos"

const MAX_APOYO = 15
const ACEPTA = `${ACEPTA_ENTRADA.ilustracion},${ACEPTA_ENTRADA.pdf}`

/**
 * Paso 3 (opcional): lo que el editor puede poner encima de la grabación. Videos e imagenes van como
 * ilustracion; un PDF (la presentacion de la charla), como pdf: se muestra lamina por lamina.
 */
export function PasoApoyo({ apoyo, onApoyo, deshabilitado }: { apoyo: Apoyo[]; onApoyo: (f: (xs: Apoyo[]) => Apoyo[]) => void; deshabilitado: boolean }) {
  const [aviso, setAviso] = React.useState<string | null>(null)

  const agregar = (fs: File[]) => {
    const malo = fs.find((f) => !tipoDeApoyo(f.name))
    const buenos = sinRepetir(apoyo, fs.filter((f) => tipoDeApoyo(f.name)), (a) => a.archivo)
    const yaPdf = apoyo.some((a) => a.tipo === "pdf")
    let pdfs = 0
    const nuevos: Apoyo[] = []
    let otroPdf = false
    for (const f of buenos) {
      const tipo = tipoDeApoyo(f.name)!
      if (tipo === "pdf" && (yaPdf || pdfs++ > 0)) {
        otroPdf = true
        continue
      }
      nuevos.push({ id: nuevoId(), archivo: f, tipo })
    }
    const libres = MAX_APOYO - apoyo.length
    setAviso(malo ? `${malo.name} no es un video, una imagen ni un PDF.` : otroPdf ? "Va un solo PDF por video." : nuevos.length > libres ? `Como mucho ${MAX_APOYO} archivos de apoyo.` : null)
    if (nuevos.length) onApoyo((xs) => [...xs, ...nuevos.slice(0, Math.max(0, libres))])
  }

  return (
    <Paso
      n={3}
      id="paso-apoyo"
      titulo="Carpeta de apoyo"
      descripcion="B-roll, fotos, capturas y el PDF de la charla. El editor los pone donde encajan."
      meta={apoyo.length ? `${apoyo.length} ${apoyo.length === 1 ? "archivo" : "archivos"}` : "Opcional"}
    >
      <ZonaArchivos acepta={ACEPTA} boton="Subir archivos" ayuda="Videos, imágenes (PNG, JPG, WebP) o un PDF." onArchivos={agregar} deshabilitado={deshabilitado} />
      <ErrorCampo>{aviso}</ErrorCampo>
      {apoyo.length ? (
        <ul className="ring-foreground/10 flex flex-col divide-y rounded-xl ring-1" aria-label="Archivos de apoyo">
          {apoyo.map((a) => (
            <FilaArchivo
              key={a.id}
              icono={a.tipo === "pdf" ? <FileTextIcon /> : /^image\//.test(a.archivo.type) || /\.(png|jpe?g|webp)$/i.test(a.archivo.name) ? <ImageIcon /> : <FileVideoIcon />}
              nombre={a.archivo.name}
              detalle={[a.tipo === "pdf" ? "PDF" : null, tamano(a.archivo.size)].filter(Boolean).join(" · ")}
            >
              <Button type="button" size="icon-sm" variant="ghost" aria-label={`Quitar ${a.archivo.name}`} disabled={deshabilitado} onClick={() => onApoyo((xs) => xs.filter((x) => x.id !== a.id))}>
                <XIcon />
              </Button>
            </FilaArchivo>
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground text-sm">Es opcional. Sin apoyo, el video sale solo con la grabación y los gráficos de tu marca.</p>
      )}
    </Paso>
  )
}
