import assert from "node:assert/strict"
import { test } from "node:test"

import { decidir, esFuncion, funcionesDelEntorno } from "../src/engine/funciones"

test("la excepcion de la cuenta manda sobre todo", () => {
  assert.equal(decidir(true, false, true), false)
  assert.equal(decidir(false, true, false), true)
  assert.equal(decidir(null, true, false), true)
})

test("sin excepcion, manda la global encendida", () => {
  assert.equal(decidir(true, null, false), true)
})

test("con la global apagada o ausente, solo el entorno la enciende", () => {
  assert.equal(decidir(false, null, false), false)
  assert.equal(decidir(null, null, false), false)
  assert.equal(decidir(false, null, true), true)
  assert.equal(decidir(null, null, true), true)
})

test("FUNCIONES_BETA: vacio, todas o una lista", () => {
  assert.equal(funcionesDelEntorno(undefined).size, 0)
  assert.equal(funcionesDelEntorno("").size, 0)
  assert.deepEqual([...funcionesDelEntorno("todas")].sort(), ["estilo_long_form", "long_form", "marcas_multiples"])
  assert.deepEqual([...funcionesDelEntorno(" long_form , inventada ")], ["long_form"])
  assert.equal(funcionesDelEntorno("TODAS").size, 3)
})

test("solo las tres claves existen", () => {
  assert.ok(esFuncion("long_form"))
  assert.ok(!esFuncion("todo"))
})
