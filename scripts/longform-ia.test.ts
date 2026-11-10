import assert from "node:assert/strict"
import { test } from "node:test"

import { armarPedido } from "../src/engine/long-form/ia-pedido"

const img = (d: string, media_type = "image/jpeg") => ({
  type: "image" as const,
  source: { type: "base64" as const, media_type, data: Buffer.from(d).toString("base64") },
})

test("ia: cada texto queda pegado a su imagen, en orden", () => {
  const r = armarPedido([
    { type: "text", text: "Elige entre: una_camara, pantalla." },
    { type: "text", text: "Minuto 0.2:" },
    img("uno"),
    { type: "text", text: "Minuto 1.4:" },
    img("dos", "image/png"),
    img("raro", "image/bmp"),
  ])
  assert.equal(r.prompt, "Responde con el JSON pedido.")
  assert.deepEqual(
    r.bloques!.map((b) => (b.tipo === "texto" ? b.texto : b.tipo === "imagen" ? `${b.mime}:${b.datos.toString()}` : b.tipo)),
    ["Elige entre: una_camara, pantalla.", "Minuto 0.2:", "image/jpeg:uno", "Minuto 1.4:", "image/png:dos"]
  )
})

test("ia: sin imagenes, todo el texto va en el prompt", () => {
  const t = armarPedido([{ type: "text", text: "a" }, { type: "text", text: "b" }])
  assert.equal(t.prompt, "a\n\nb")
  assert.equal(t.bloques, undefined)
  // Una imagen de un tipo que la API no acepta no cuenta como imagen.
  assert.equal(armarPedido([{ type: "text", text: "a" }, img("x", "image/bmp")]).bloques, undefined)
})
