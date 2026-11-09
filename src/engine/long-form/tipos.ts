/**
 * Los tipos de grabacion que reconoce la etapa `clasificar` del motor (long-form/motor/editor/tipos.py). Los
 * nombres y la descripcion son los que ve la persona al revisar quien es quien.
 */
export const TIPOS_GRABACION = ["meet", "camaras", "una_camara", "podcast", "charla", "pantalla"] as const
export type TipoGrabacion = (typeof TIPOS_GRABACION)[number]

export const NOMBRE_TIPO: Record<TipoGrabacion, string> = {
  meet: "Videollamada en galería",
  camaras: "Varias cámaras a la vez",
  una_camara: "Una cámara",
  podcast: "Pódcast o video ya editado",
  charla: "Charla con diapositivas",
  pantalla: "Grabación de pantalla",
}

export const COMO_SE_EDITA: Record<TipoGrabacion, string> = {
  meet: "Quien habla en grande y lo que se proyecta en el panel, con la lámina original del PDF.",
  camaras: "Cambia de cámara según quién habla, con planos abiertos, cerrados y la pantalla dividida.",
  una_camara: "Reencuadra por caras: planos abiertos y cerrados que cambian con las ideas, y sigue a quien habla.",
  podcast: "Respeta sus cortes: solo quita silencios largos y agrega gráficos, audio y marca.",
  charla: "La lámina protagonista y la persona en un recuadro.",
  pantalla: "Se acerca a la zona de la pantalla donde pasa algo.",
}

/** Lo que deja la etapa clasificar en el estado del proyecto. */
export type Clasificacion = {
  tipo: TipoGrabacion
  confianza: "alta" | "media" | "baja"
  razones: string[]
  candidatos?: TipoGrabacion[]
  partes?: string[][]
  por_ia?: boolean
  forzado?: boolean
}
