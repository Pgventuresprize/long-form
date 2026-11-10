import type { Bloque } from "@/engine/claude/messages"

/** Un bloque del pedido del motor, con la forma de la API de Claude. */
export type BloqueMotor =
  | { type: "text"; text: string }
  | { type: "image"; source: { type: "base64"; media_type: string; data: string } }

const IMAGENES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const
type Imagen = (typeof IMAGENES)[number]

/**
 * El contenido que manda el motor, listo para `llamarClaude`. Sin imagenes, todo el texto va en el prompt.
 * Con imagenes, cada texto queda pegado a la imagen que describe ("Minuto 3,2:" delante de su cuadro), en el
 * mismo orden en que llego, y el prompt es solo la instruccion final. Una imagen de un tipo que la API no
 * acepta se descarta.
 */
export function armarPedido(contenido: BloqueMotor[]): { prompt: string; bloques?: Bloque[] } {
  const hayImagenes = contenido.some((b) => b.type === "image" && (IMAGENES as readonly string[]).includes(b.source.media_type))
  if (!hayImagenes) {
    return { prompt: contenido.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("\n\n") }
  }
  const bloques: Bloque[] = contenido.flatMap((b): Bloque[] => {
    if (b.type === "text") return b.text.trim() ? [{ tipo: "texto", texto: b.text }] : []
    if (!(IMAGENES as readonly string[]).includes(b.source.media_type)) return []
    return [{ tipo: "imagen", mime: b.source.media_type as Imagen, datos: Buffer.from(b.source.data, "base64") }]
  })
  return { prompt: "Responde con el JSON pedido.", bloques }
}
