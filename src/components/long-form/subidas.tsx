"use client"

import * as React from "react"
import * as tus from "tus-js-client"

import { renovarSubida, subidaTerminada, type DestinoSubida, type Subida } from "@/app/long-form/actions"

/**
 * Las subidas de Long-form, vivas mientras la pestaña este abierta: el proveedor esta en el layout raiz,
 * asi que cambiar de pantalla dentro de Studio no corta nada. Cada archivo va directo a Storage por TUS
 * (reanudable: si se cae la red, sigue donde iba) con una firma de un solo uso. Antes de cerrar la
 * pestaña con subidas en curso, el navegador pregunta.
 */

export type EstadoSubida = {
  archivoId: string
  proyectoId: string
  nombre: string
  bytes: number
  subido: number
  estado: "subiendo" | "lista" | "error"
  error?: string
}

type Ctx = {
  subidas: EstadoSubida[]
  iniciar: (proyectoId: string, destino: DestinoSubida, subidas: Subida[], archivos: File[]) => void
  reintentar: (archivoId: string) => void
}

const Contexto = React.createContext<Ctx | null>(null)

export function useSubidas(): Ctx {
  const c = React.useContext(Contexto)
  if (!c) throw new Error("useSubidas fuera de ProveedorSubidas")
  return c
}

const TROZO = 6 * 1024 * 1024 // Supabase exige trozos de 6 MB

export function ProveedorSubidas({ children }: { children: React.ReactNode }) {
  const [subidas, setSubidas] = React.useState<EstadoSubida[]>([])
  // Lo que hace falta para reintentar: el archivo y su firma. No va al estado: no se pinta.
  const arrancadas = React.useRef(new Set<string>())
  const pendientes = React.useRef(new Map<string, { archivo: File; subida: Subida; destino: DestinoSubida; proyectoId: string }>())

  const actualizar = React.useCallback((archivoId: string, cambio: Partial<EstadoSubida>) => {
    setSubidas((xs) => xs.map((x) => (x.archivoId === archivoId ? { ...x, ...cambio } : x)))
  }, [])

  const correr = React.useCallback(
    (archivoId: string) => {
      const p = pendientes.current.get(archivoId)
      if (!p) return
      const { archivo, subida, destino, proyectoId } = p
      const up = new tus.Upload(archivo, {
        endpoint: destino.endpoint,
        retryDelays: [0, 2000, 5000, 10000, 20000, 30000],
        headers: { "x-signature": subida.token, apikey: destino.apikey, "x-upsert": "true" },
        uploadDataDuringCreation: true,
        removeFingerprintOnSuccess: true,
        chunkSize: TROZO,
        metadata: { bucketName: destino.bucket, objectName: subida.ruta, contentType: archivo.type || "application/octet-stream", cacheControl: "3600" },
        onProgress: (subido) => actualizar(archivoId, { subido }),
        onError: async (e) => {
          // Una firma vencida se renueva una vez y se sigue donde iba.
          if (/403|401|signature/i.test(String(e)) && proyectoId) {
            const r = await renovarSubida(proyectoId, archivoId)
            if (r.ok) {
              pendientes.current.set(archivoId, { archivo, subida: { ...subida, token: r.token }, destino: r.destino, proyectoId })
              // Vuelve a arrancar por el efecto, con la firma nueva.
              arrancadas.current.delete(archivoId)
              return actualizar(archivoId, { estado: "subiendo" })
            }
          }
          actualizar(archivoId, { estado: "error", error: "Se cortó la subida. Reintenta: sigue donde iba." })
        },
        onSuccess: async () => {
          const r = await subidaTerminada(proyectoId, archivoId)
          if (r.ok) {
            pendientes.current.delete(archivoId)
            actualizar(archivoId, { estado: "lista", subido: archivo.size })
          } else actualizar(archivoId, { estado: "error", error: r.error })
        },
      })
      up.findPreviousUploads().then((previas) => {
        if (previas.length) up.resumeFromPreviousUpload(previas[0])
        up.start()
      })
    },
    [actualizar]
  )

  const iniciar = React.useCallback<Ctx["iniciar"]>((proyectoId, destino, nuevas, archivos) => {
    const filas: EstadoSubida[] = []
    nuevas.forEach((s, i) => {
      const archivo = archivos[i]
      pendientes.current.set(s.archivoId, { archivo, subida: s, destino, proyectoId })
      filas.push({ archivoId: s.archivoId, proyectoId, nombre: s.nombre, bytes: archivo.size, subido: 0, estado: "subiendo" })
    })
    setSubidas((xs) => [...xs.filter((x) => x.estado !== "lista"), ...filas])
  }, [])

  // Cada subida arranca cuando ya esta en el estado.
  React.useEffect(() => {
    for (const s of subidas) {
      if (s.estado === "subiendo" && !arrancadas.current.has(s.archivoId)) {
        arrancadas.current.add(s.archivoId)
        correr(s.archivoId)
      }
    }
  }, [subidas, correr])

  const reintentar = React.useCallback(
    (archivoId: string) => {
      actualizar(archivoId, { estado: "subiendo", error: undefined })
      arrancadas.current.delete(archivoId)
    },
    [actualizar]
  )

  const enCurso = subidas.some((s) => s.estado === "subiendo")
  React.useEffect(() => {
    if (!enCurso) return
    const avisar = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ""
    }
    window.addEventListener("beforeunload", avisar)
    return () => window.removeEventListener("beforeunload", avisar)
  }, [enCurso])

  const valor = React.useMemo(() => ({ subidas, iniciar, reintentar }), [subidas, iniciar, reintentar])
  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>
}
