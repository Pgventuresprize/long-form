import assert from "node:assert/strict"
import { test } from "node:test"

import { existsSync } from "node:fs"
import path from "node:path"

import { contenedorDe, formatoPorFirma, formatoPorNombre, formatoVideoMarca, maxBytesDe } from "../src/engine/long-form/audio"
import { idStudio, SFX_STUDIO, SFX_SUGERIDOS, sfxStudioDe } from "../src/engine/long-form/sfx-studio"
import { ESTILO_BASE, marcado, normalizarEstilo, normalizarExtremo, VERSION_ESTILO } from "../src/engine/long-form/estilo"
import { paginaDePieza, rellenar, type Recursos } from "../src/engine/long-form/plantillas"

const bytes = (...x: (number | string)[]) => new Uint8Array(x.flatMap((v) => (typeof v === "string" ? [...v].map((c) => c.charCodeAt(0)) : [v])))

test("audio: audios y videos (de los que se usa el sonido), por nombre y tipo", () => {
  assert.equal(formatoPorNombre("intro.mp3", "audio/mpeg"), "mp3")
  assert.equal(formatoPorNombre("efecto.WAV", "audio/wav"), "wav")
  assert.equal(formatoPorNombre("efecto.wav", ""), "wav")
  assert.equal(formatoPorNombre("cancion.m4a", "audio/mp4"), "m4a")
  assert.equal(formatoPorNombre("cancion.aac", "audio/aac"), "aac")
  assert.equal(formatoPorNombre("videoclip.mp4", "video/mp4"), "mp4")
  assert.equal(formatoPorNombre("videoclip.MOV", "video/quicktime"), "mov")
  assert.equal(formatoPorNombre("guion.pdf", "application/pdf"), null)
  assert.equal(formatoPorNombre("clip.mkv", "video/x-matroska"), null)
  // Extension y tipo que no coinciden.
  assert.equal(formatoPorNombre("intro.mp3", "audio/wav"), null)
  assert.equal(formatoPorNombre("intro.mp4", "audio/mpeg"), null)
})

test("audio: la firma del archivo manda", () => {
  assert.equal(formatoPorFirma(bytes("RIFF", 0, 0, 0, 0, "WAVE")), "wav")
  assert.equal(formatoPorFirma(bytes("ID3", 4, 0)), "mp3")
  assert.equal(formatoPorFirma(bytes(0xff, 0xfb, 0x90)), "mp3")
  // M4A, MP4 y MOV son cajas ISO: la misma familia.
  assert.equal(formatoPorFirma(bytes(0, 0, 0, 0x20, "ftypisom")), "mp4")
  assert.equal(formatoPorFirma(bytes(0, 0, 0, 0x20, "ftypM4A ")), "mp4")
  assert.equal(formatoPorFirma(bytes(0, 0, 0, 0x08, "wide")), "mp4")
  assert.equal(contenedorDe("mov"), "mp4")
  // AAC suelto (cabecera ADTS).
  assert.equal(formatoPorFirma(bytes(0xff, 0xf1, 0x50)), "aac")
  // Capa II no es MP3; un PDF renombrado no es nada.
  assert.equal(formatoPorFirma(bytes(0xff, 0xfd, 0x90)), null)
  assert.equal(formatoPorFirma(bytes("%PDF-1.7")), null)
})

test("audio: un video puede pesar mas que un audio", () => {
  assert.equal(maxBytesDe("mp3"), 50 * 1024 * 1024)
  assert.equal(maxBytesDe("mp4"), 200 * 1024 * 1024)
})

test("estilo: musica de fondo y efectos de la biblioteca de Studio", () => {
  const uuid = "0b6f2a0e-6a1d-4c5b-9a6e-1f2d3c4b5a69"
  const e = normalizarEstilo({ musica: { fondo: uuid, volumen_fondo: 7 }, sfx: { rotulo: "studio:whoosh-corto", barra: "studio:../../etc", cita: uuid } })
  assert.equal(e.musica.fondo, uuid)
  assert.equal(e.musica.volumen_fondo, 1)
  assert.equal(normalizarEstilo({}).musica.volumen_fondo, ESTILO_BASE.musica.volumen_fondo)
  assert.equal(e.sfx.rotulo, "studio:whoosh-corto")
  assert.equal(e.sfx.barra, null)
  assert.equal(e.sfx.cita, uuid)
  // Cada sonido sugerido existe en el catalogo y en disco.
  for (const slug of Object.values(SFX_SUGERIDOS)) assert.ok(sfxStudioDe(idStudio(slug)), slug)
  for (const s of SFX_STUDIO) assert.ok(existsSync(path.join("long-form", "plantillas", "sfx", `${s.slug}.wav`)), s.slug)
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

test("estilo: intro y cierre, de la tarjeta de Studio a un video propio o ninguno", () => {
  // un estilo guardado antes de que existieran: la tarjeta de Studio, como siempre
  const viejo = normalizarEstilo({ colores: { acento: "#123456" } })
  assert.deepEqual(viejo.intro, { modo: "studio", video: null })
  assert.deepEqual(viejo.cierre, { modo: "studio", video: null })
  assert.equal(VERSION_ESTILO, 1)
  const video = { bucket: "longform", ruta: "cuenta/estilo/intro/intro-1.mp4" }
  const e = normalizarEstilo({ intro: { modo: "video", video }, cierre: { modo: "ninguna" } })
  assert.deepEqual(e.intro, { modo: "video", video })
  assert.deepEqual(e.cierre, { modo: "ninguna", video: null })
  // "video" sin archivo vale como la tarjeta; un modo raro tambien
  assert.equal(normalizarExtremo({ modo: "video" }).modo, "studio")
  assert.equal(normalizarExtremo({ modo: "otro", video }).modo, "studio")
  assert.equal(normalizarExtremo({ modo: "video", video: { bucket: "longform", ruta: "" } }).modo, "studio")
  // el video se conserva aunque se elija otro modo: se puede volver a el sin subirlo otra vez
  assert.deepEqual(normalizarExtremo({ modo: "studio", video }), { modo: "studio", video })
  // ida y vuelta: lo normalizado no cambia al normalizarlo otra vez
  assert.deepEqual(normalizarEstilo(JSON.parse(JSON.stringify(e))), e)
  assert.equal(formatoVideoMarca("intro.MOV", "video/quicktime"), "mov")
  assert.equal(formatoVideoMarca("intro.mp4", ""), "mp4")
  assert.equal(formatoVideoMarca("intro.mp3", "audio/mpeg"), null)
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
