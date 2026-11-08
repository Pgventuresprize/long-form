import assert from "node:assert/strict"
import { test } from "node:test"

import { formatoPorFirma, formatoPorNombre } from "../src/engine/long-form/audio"
import { ESTILO_BASE, marcado, normalizarEstilo } from "../src/engine/long-form/estilo"
import { paginaDePieza, rellenar, type Recursos } from "../src/engine/long-form/plantillas"

const bytes = (...x: (number | string)[]) => new Uint8Array(x.flatMap((v) => (typeof v === "string" ? [...v].map((c) => c.charCodeAt(0)) : [v])))

test("audio: solo MP3 o WAV, por nombre y tipo", () => {
  assert.equal(formatoPorNombre("intro.mp3", "audio/mpeg"), "mp3")
  assert.equal(formatoPorNombre("efecto.WAV", "audio/wav"), "wav")
  assert.equal(formatoPorNombre("efecto.wav", ""), "wav")
  assert.equal(formatoPorNombre("intro.mp4", "video/mp4"), null)
  assert.equal(formatoPorNombre("intro.m4a", "audio/mp4"), null)
  // Extension y tipo que no coinciden.
  assert.equal(formatoPorNombre("intro.mp3", "audio/wav"), null)
})

test("audio: la firma del archivo manda", () => {
  assert.equal(formatoPorFirma(bytes("RIFF", 0, 0, 0, 0, "WAVE")), "wav")
  assert.equal(formatoPorFirma(bytes("ID3", 4, 0)), "mp3")
  assert.equal(formatoPorFirma(bytes(0xff, 0xfb, 0x90)), "mp3")
  // Un MP4 renombrado a .mp3.
  assert.equal(formatoPorFirma(bytes(0, 0, 0, 0x20, "ftypisom")), null)
  // Capa II no es MP3.
  assert.equal(formatoPorFirma(bytes(0xff, 0xfd, 0x90)), null)
})

test("estilo: lo guardado se normaliza y queda dentro de sus limites", () => {
  const e = normalizarEstilo({ colores: { acento: "#FF5B00", tinta: "rojo" }, caja_alfa: 4, clips: { duracion_min: 100, duracion_max: 40 }, esfuerzo: "maximo" })
  assert.equal(e.colores.acento, "#ff5b00")
  assert.equal(e.colores.tinta, ESTILO_BASE.colores.tinta)
  assert.equal(e.caja_alfa, 1)
  assert.ok(e.clips.duracion_min < e.clips.duracion_max)
  assert.equal(e.esfuerzo, "normal")
  assert.deepEqual(normalizarEstilo(null), normalizarEstilo({}))
})

test("plantillas: huecos, condiciones y escape", () => {
  assert.equal(rellenar("<b>{{a}}</b>", { a: "<x>" }), "<b>&lt;x&gt;</b>")
  assert.equal(rellenar("{{{a}}}", { a: "<i>y</i>" }), "<i>y</i>")
  assert.equal(rellenar("[{{#a}}si{{/a}}]", { a: "" }), "[]")
  assert.equal(rellenar("[{{#a}}{{a}}{{/a}}]", { a: "z" }), "[z]")
  assert.equal(marcado("Únete a la *comunidad*", "span"), "Únete a la <span>comunidad</span>")
})

test("plantillas: un rotulo con la marca", () => {
  const e = normalizarEstilo({ colores: { acento: "#123456" }, handle: "@marca" })
  const r: Recursos = { fuentesCss: "", url: () => null }
  const html = paginaDePieza(e, "rotulo", { nombre: "Ana <Gómez>", rol: "Directora", handle: "@ana" }, r, "escenario")
  assert.ok(html.includes('class="d-escenario"'))
  assert.ok(html.includes("Ana &lt;Gómez&gt;"))
  assert.ok(html.includes("--acento:#123456"))
  assert.ok(!html.includes("{{"), "no quedan huecos sin llenar")
})
