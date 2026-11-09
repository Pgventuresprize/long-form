/**
 * Con las banderas apagadas, nada nuevo puede responder con datos. Esta prueba lee el codigo de las
 * paginas, acciones y rutas de long form, marcas multiples y estilo long form, y exige que cada
 * funcion exportada compruebe su bandera en el servidor antes de hacer nada. Una ruta nueva sin
 * bandera hace fallar la prueba: la lista de archivos sale del sistema de archivos, no se escribe a
 * mano.
 *
 * La comprobacion en vivo (paywall visible, acciones que responden "beta privada") esta en
 * scripts/longform-banderas-vivo.ts, que necesita la base local.
 */
import assert from "node:assert/strict"
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import path from "node:path"
import { test } from "node:test"

import { decidir, funcionesDelEntorno } from "../src/engine/funciones"

const RAIZ = path.join(__dirname, "..")

/** Carpetas y archivos que son solo de las funciones en beta. */
const PROTEGIDOS = ["src/app/long-form", "src/app/api/long-form", "src/app/marca/long-form-actions.ts", "src/app/marcas"]

/** Lo que cuenta como comprobar la bandera (o el paywall de crear marca). */
const GUARDAS = /\b(accesoA|idDeCuentaCon|cuentaDeRutaCon|puedeCrearMarca|tieneFuncion|proyectoPropio)\s*\(/

/** Los ayudantes que cuentan como guarda tienen que comprobar la bandera ellos mismos. */
const AYUDANTES: [string, string][] = [["src/app/long-form/actions.ts", "proyectoPropio"]]

function archivos(rel: string): string[] {
  const abs = path.join(RAIZ, rel)
  if (!existsSync(abs)) return []
  if (statSync(abs).isFile()) return [abs]
  return readdirSync(abs, { recursive: true, encoding: "utf8" })
    .map((f) => path.join(abs, f))
    .filter((f) => /\.(ts|tsx)$/.test(f) && statSync(f).isFile())
}

/** Cada funcion exportada que corre en el servidor, con su cuerpo hasta la siguiente. */
function exportadas(codigo: string): { nombre: string; cuerpo: string }[] {
  const re = /export\s+(?:default\s+)?async\s+function\s+(\w+)|export\s+const\s+(GET|POST|PUT|PATCH|DELETE)\s*=/g
  const marcas = [...codigo.matchAll(re)]
  return marcas.map((m, i) => ({ nombre: m[1] ?? m[2], cuerpo: codigo.slice(m.index, marcas[i + 1]?.index ?? codigo.length) }))
}

test("cada pagina, accion y ruta de las funciones en beta comprueba su bandera", () => {
  const sinGuarda: string[] = []
  let revisadas = 0
  for (const rel of PROTEGIDOS) {
    for (const f of archivos(rel)) {
      const codigo = readFileSync(f, "utf8")
      const esServidor = /["']use server["']/.test(codigo) || /[\\/](page|route|layout)\.tsx?$/.test(f)
      if (!esServidor) continue
      for (const fn of exportadas(codigo)) {
        revisadas++
        if (!GUARDAS.test(fn.cuerpo)) sinGuarda.push(`${path.relative(RAIZ, f)}: ${fn.nombre}`)
      }
    }
  }
  assert.ok(revisadas > 0, "no encontro nada que revisar")
  assert.deepEqual(sinGuarda, [], `Sin comprobar la bandera:\n${sinGuarda.join("\n")}`)
})

test("los ayudantes que hacen de guarda comprueban la bandera", () => {
  for (const [rel, nombre] of AYUDANTES) {
    const codigo = readFileSync(path.join(RAIZ, rel), "utf8")
    const m = new RegExp(`async function ${nombre}\\([^)]*\\)[^{]*\\{([\\s\\S]*?)\\n\\}`).exec(codigo)
    assert.ok(m, `no encontre ${nombre} en ${rel}`)
    assert.match(m[1], /idDeCuentaCon\(/, `${nombre} no comprueba la bandera`)
  }
})

test("la pestana de Marca y el sidebar solo muestran long form con la bandera", () => {
  const pestana = readFileSync(path.join(RAIZ, "src/components/marca/long-form/pestana.tsx"), "utf8")
  assert.match(pestana, /tieneFuncion\(accountId, "estilo_long_form"\)/)
  const sidebar = readFileSync(path.join(RAIZ, "src/components/app-sidebar.tsx"), "utf8")
  assert.match(sidebar, /bloqueado: !funciones\.includes\("long_form"\)/)
})

test("en produccion (sin FUNCIONES_BETA y sin filas) todo esta apagado", () => {
  assert.equal(funcionesDelEntorno(undefined).size, 0)
  assert.equal(decidir(null, null, false), false)
  assert.equal(decidir(false, null, false), false)
})
