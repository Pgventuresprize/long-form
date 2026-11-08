/**
 * Imprime, en JSON, las paginas de las piezas para un estilo dado. Lo usa la prueba del motor
 * (long-form/motor/tests/prueba_plantillas.py) para comparar con lo que dibuja Python.
 *
 *   npx tsx scripts/longform-plantillas-salida.ts <estilo.json> <datos.json>
 */
import { readFileSync } from "node:fs"

import { normalizarEstilo } from "../src/engine/long-form/estilo"
import { paginaDePieza, type Datos, type TipoPieza } from "../src/engine/long-form/plantillas"

const [estiloRuta, datosRuta] = process.argv.slice(2)
const e = normalizarEstilo(JSON.parse(readFileSync(estiloRuta, "utf8")))
const casos = JSON.parse(readFileSync(datosRuta, "utf8")) as { tipo: TipoPieza; disposicion: "pantalla" | "escenario"; datos: Datos }[]
const salida = casos.map((c) => paginaDePieza(e, c.tipo, c.datos, { fuentesCss: "", url: (a) => (a ? `archivo:${a.ruta}` : null) }, c.disposicion))
process.stdout.write(JSON.stringify(salida))
