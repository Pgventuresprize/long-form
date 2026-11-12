import assert from "node:assert/strict"
import { test } from "node:test"

import { agregarIndicacion, conUso, encajaEnTipo, mover, opcionesDelSpec, opcionesValidas, OPCIONES_BASE, ordenDeFuentes, tipoDeApoyo, tituloDeArchivo, usoLibre } from "../src/engine/long-form/nuevo"

test("nuevo: spec.opciones lleva formato y capitulos siempre; lo demas solo si se eligio", () => {
  assert.deepEqual(opcionesDelSpec(OPCIONES_BASE), { formato: "16:9", capitulos: true })
  assert.deepEqual(opcionesDelSpec({ formato: "9:16", duracion: "15-20", subtitulos: "no", gancho: "si", capitulos: false }), {
    formato: "9:16",
    capitulos: false,
    duracion_objetivo_min: 17.5,
    subtitulos: false,
    gancho: true,
  })
  assert.equal(opcionesDelSpec({ ...OPCIONES_BASE, duracion: "8-12" }).duracion_objetivo_min, 10)
  assert.equal(opcionesDelSpec({ ...OPCIONES_BASE, duracion: "30+" }).duracion_objetivo_min, 35)
  assert.equal("subtitulos" in opcionesDelSpec({ ...OPCIONES_BASE, subtitulos: "auto" }), false)
})

test("nuevo: las opciones del navegador se revisan", () => {
  assert.deepEqual(opcionesValidas(undefined), { ok: true, opciones: OPCIONES_BASE })
  assert.equal(opcionesValidas({ formato: "4:3" }).ok, false)
  assert.equal(opcionesValidas({ duracion: "60" }).ok, false)
  assert.equal(opcionesValidas({ gancho: "tal vez" }).ok, false)
  assert.equal(opcionesValidas({ capitulos: "si" }).ok, false)
  const r = opcionesValidas({ formato: "1:1", subtitulos: "si" })
  assert.ok(r.ok)
  assert.deepEqual(r.ok && r.opciones, { ...OPCIONES_BASE, formato: "1:1", subtitulos: "si" })
})

test("nuevo: cada uso de musica es de una sola pista; elegir uno tomado se lo quita a la otra", () => {
  const pistas = [
    { id: "a", uso: "fondo" as const },
    { id: "b", uso: "intro" as const },
    { id: "c", uso: null },
  ]
  assert.deepEqual(conUso(pistas, "c", "fondo"), [
    { id: "a", uso: null },
    { id: "b", uso: "intro" },
    { id: "c", uso: "fondo" },
  ])
  assert.deepEqual(conUso(pistas, "a", "fondo"), pistas)
  assert.equal(usoLibre([]), "fondo")
  assert.equal(usoLibre([], "cierre"), "cierre")
  assert.equal(usoLibre(pistas, "intro"), "cierre")
  assert.equal(usoLibre([{ uso: "fondo" }, { uso: "intro" }, { uso: "cierre" }]), null)
})

test("nuevo: los videos van en el orden de la lista, subidos y reusados mezclados", () => {
  assert.deepEqual(ordenDeFuentes([{ orden: 2 }, { orden: 0 }], [{ orden: 1 }]), [
    { de: "subida", i: 1 },
    { de: "reuso", i: 0 },
    { de: "subida", i: 0 },
  ])
  // Sin posicion (como antes): los subidos primero, en su orden, y los reusados al final.
  assert.deepEqual(ordenDeFuentes([{}, {}], [{}]), [
    { de: "subida", i: 0 },
    { de: "subida", i: 1 },
    { de: "reuso", i: 0 },
  ])
  assert.deepEqual(mover(["a", "b", "c"], 2, -1), ["a", "c", "b"])
  assert.deepEqual(mover(["a", "b"], 0, -1), ["a", "b"])
})

test("nuevo: el tipo lo da el paso, y la extension tiene que encajar", () => {
  assert.equal(encajaEnTipo("cam1.MOV", "fuente"), true)
  assert.equal(encajaEnTipo("voz.mp3", "fuente"), false)
  assert.equal(encajaEnTipo("voz.m4a", "audio"), true)
  assert.equal(tipoDeApoyo("charla.pdf"), "pdf")
  assert.equal(tipoDeApoyo("broll.mp4"), "ilustracion")
  assert.equal(tipoDeApoyo("captura.png"), "ilustracion")
  assert.equal(tipoDeApoyo("notas.docx"), null)
})

test("nuevo: indicaciones rapidas y titulo propuesto", () => {
  assert.equal(agregarIndicacion("", "Quita silencios"), "Quita silencios")
  assert.equal(agregarIndicacion("Corta precios  ", "Quita silencios"), "Corta precios\nQuita silencios")
  assert.equal(agregarIndicacion("quita silencios ya", "Quita silencios"), "quita silencios ya")
  assert.equal(tituloDeArchivo("IA_en-deportes__con César.mp4"), "IA en deportes con César")
})
