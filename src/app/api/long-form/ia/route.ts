import { NextResponse } from "next/server"

import { llamarClaude, parsearJSONDeClaude } from "@/engine/claude/messages"
import { tieneFuncion } from "@/engine/funciones"
import { armarPedido, type BloqueMotor } from "@/engine/long-form/ia-pedido"
import { cuentaDelProyecto, esElMotor } from "@/engine/long-form/motor"

export const dynamic = "force-dynamic"
// El guion de un video de una hora es una respuesta larga.
export const maxDuration = 300

const MODELO = "claude-sonnet-5-5"

type Pedido = {
  proyecto_id: string
  paso?: string
  sistema: string
  contenido: BloqueMotor[]
  esquema: { required?: string[] } & Record<string, unknown>
  max_tokens?: number
  modelo?: string | null
}

/**
 * Los pasos de Claude del motor de long form (nombres, guion, ideas, clips). El motor arma el pedido y
 * aqui se corre con `llamarClaude`: la clave de la cuenta del proyecto, su tope y su registro de consumo,
 * como cualquier agente de Studio. Responde el JSON que cumple el esquema.
 *
 * Solo la llama el motor (secreto compartido) y solo para cuentas con `long_form`.
 */
export async function POST(request: Request) {
  if (!esElMotor(request)) return NextResponse.json({ ok: false }, { status: 404 })
  let p: Pedido
  try {
    p = (await request.json()) as Pedido
  } catch {
    return NextResponse.json({ ok: false, error: "Pedido ilegible" }, { status: 400 })
  }
  const accountId = await cuentaDelProyecto(p.proyecto_id)
  if (!accountId || !(await tieneFuncion(accountId, "long_form"))) return NextResponse.json({ ok: false }, { status: 404 })

  const { prompt: base, bloques } = armarPedido(p.contenido)
  const sistema =
    `${p.sistema}\n\nResponde SOLO con un objeto JSON, sin texto antes ni despues y sin bloque de codigo, ` +
    `que cumpla este esquema JSON:\n${JSON.stringify(p.esquema)}`
  const requeridos = p.esquema.required ?? []

  let prompt = base
  const uso = { entrada: 0, salida: 0 }
  for (let intento = 0; intento < 2; intento++) {
    const r = await llamarClaude({
      accountId,
      model: p.modelo || MODELO,
      system: sistema,
      prompt,
      bloques,
      maxTokens: Math.min(Math.max(p.max_tokens ?? 8000, 1000), 32000),
      timeoutMs: 280_000,
      paso: p.paso ?? "longform",
    })
    if (!r.ok) {
      // Sin clave o sin saldo: el motor usa su respaldo sin IA.
      const sinIA = /token de Claude|saldo/i.test(r.error)
      return NextResponse.json({ ok: false, sinIA, error: r.error }, { status: sinIA ? 409 : 502 })
    }
    uso.entrada += r.uso.entrada
    uso.salida += r.uso.salida
    try {
      const datos = parsearJSONDeClaude(r.texto) as Record<string, unknown>
      const faltan = requeridos.filter((k) => !(k in (datos ?? {})))
      if (!datos || typeof datos !== "object" || faltan.length) throw new Error(`faltan campos: ${faltan.join(", ")}`)
      return NextResponse.json({ ok: true, datos, uso })
    } catch (e) {
      prompt = `${base}\n\nTu respuesta anterior no se pudo usar (${e instanceof Error ? e.message : String(e)}). Devuelve solo el JSON completo.`
    }
  }
  return NextResponse.json({ ok: false, error: "Claude no devolvió el JSON pedido." }, { status: 502 })
}
