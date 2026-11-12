import assert from "node:assert/strict"
import { test } from "node:test"

import { agregarIndicacion, conDuracion, conUso, DURACIONES, esDuracionCorta, NOMBRE_DURACION, RANGO_DURACION, encajaEnTipo, mover, opcionesDelSpec, opcionesValidas, OPCIONES_BASE, ordenDeFuentes, tipoDeApoyo, tituloDeArchivo, usoLibre } from "../src/engine/long-form/nuevo"

test("nuevo: spec.opciones lleva formato y capitulos siempre; lo demas solo si se eligio", () => {
  assert.deepEqual(opcionesDelSpec(OPCIONES_BASE), { formato: "16:9", capitulos: true })
  assert.deepEqual(opcionesDelSpec({ formato: "9:16", duracion: "15-30", subtitulos: "no", gancho: "si", capitulos: false, intro: true, cierre: true }), {
    formato: "9:16",
    capitulos: false,
    duracion_rango_min: [15, 30],
    duracion_objetivo_min: 30,
    subtitulos: false,
    gancho: true,
  })
  assert.deepEqual(opcionesDelSpec({ ...OPCIONES_BASE, duracion: "0.5-1" }).duracion_rango_min, [0.5, 1])
  assert.equal(opcionesDelSpec({ ...OPCIONES_BASE, duracion: "60-120" }).duracion_objetivo_min, 120)
  assert.equal("duracion_rango_min" in opcionesDelSpec(OPCIONES_BASE), false)
  assert.equal("subtitulos" in opcionesDelSpec({ ...OPCIONES_BASE, subtitulos: "auto" }), false)
})

test("nuevo: la intro y el cierre solo van al spec cuando se quitan", () => {
  // con los de la marca no va nada: el motor usa lo que diga el estilo
  assert.equal("intro" in opcionesDelSpec(OPCIONES_BASE), false)
  assert.equal("cierre" in opcionesDelSpec(OPCIONES_BASE), false)
  assert.deepEqual(opcionesDelSpec({ ...OPCIONES_BASE, intro: false }), { formato: "16:9", capitulos: true, intro: false })
  assert.deepEqual(opcionesDelSpec({ ...OPCIONES_BASE, intro: false, cierre: false }), { formato: "16:9", capitulos: true, intro: false, cierre: false })
  // del navegador: booleanos o nada (nada es "la de mi marca")
  const r = opcionesValidas({ cierre: false })
  assert.ok(r.ok && r.opciones.intro === true && r.opciones.cierre === false)
  assert.equal(opcionesValidas({ intro: "no" }).ok, false)
})

test("nuevo: en un video corto la intro y el cierre arrancan apagados, salvo que la persona los toque", () => {
  const nada = { intro: false, cierre: false }
  assert.equal(esDuracionCorta("0.5-1"), true)
  assert.equal(esDuracionCorta("1-2"), true)
  assert.equal(esDuracionCorta("2-4"), false)
  assert.equal(esDuracionCorta("auto"), false)
  const corto = conDuracion(OPCIONES_BASE, "0.5-1", nada)
  assert.deepEqual([corto.duracion, corto.intro, corto.cierre], ["0.5-1", false, false])
  assert.deepEqual(opcionesDelSpec(corto), { formato: "16:9", capitulos: true, duracion_rango_min: [0.5, 1], duracion_objetivo_min: 1, intro: false, cierre: false })
  // al volver a un video largo, vuelven
  const largo = conDuracion(corto, "8-15", nada)
  assert.deepEqual([largo.intro, largo.cierre], [true, true])
  // la que la persona encendio a mano se queda encendida; la otra sigue a la duracion
  const aMano = conDuracion({ ...OPCIONES_BASE, intro: true }, "1-2", { intro: true, cierre: false })
  assert.deepEqual([aMano.intro, aMano.cierre], [true, false])
  // y la que apago a mano se queda apagada en un video largo
  assert.equal(conDuracion({ ...OPCIONES_BASE, cierre: false }, "15-30", { intro: false, cierre: true }).cierre, false)
})

test("nuevo: los rangos de duracion crecen en escala logaritmica, sin huecos", () => {
  const rangos = DURACIONES.filter((d) => d !== "auto").map((d) => RANGO_DURACION[d as Exclude<typeof d, "auto">])
  assert.deepEqual(rangos[0], [0.5, 1])
  for (let i = 1; i < rangos.length; i++) {
    // cada rango empieza donde termina el anterior y es entre 1,5 y 2 veces mas largo
    assert.equal(rangos[i][0], rangos[i - 1][1])
    const r = rangos[i][1] / rangos[i][0]
    assert.ok(r >= 1.5 && r <= 2, `${rangos[i]}`)
  }
  assert.equal(NOMBRE_DURACION["0.5-1"], "30 s – 1 min")
  assert.equal(NOMBRE_DURACION["8-15"], "8–15 min")
  assert.equal(NOMBRE_DURACION["60-120"], "1–2 h")
  assert.equal(NOMBRE_DURACION.auto, "Lo que dé el material")
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
