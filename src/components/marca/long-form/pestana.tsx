import { Paywall } from "@/components/funciones/paywall"
import { tieneFuncion } from "@/engine/funciones"
import type { Fuente } from "@/engine/long-form/estilo"
import { bibliotecaDe, estiloDe, proponerEstilo } from "@/engine/long-form/estilo-datos"
import { kitActivo } from "@/engine/marca/kit"

import { EditorEstilo, type FuenteDisponible } from "./editor"
import { OnboardingEstilo } from "./onboarding"

/**
 * Marca > Estilo editorial > Long form. Sin `estilo_long_form`, el paywall. Sin estilo confirmado,
 * el onboarding con la propuesta; con estilo, el editor.
 */
export async function PestanaLongForm({ accountId }: { accountId: string }) {
  if (!(await tieneFuncion(accountId, "estilo_long_form"))) return <Paywall clave="estilo_long_form" accountId={accountId} />

  const [guardado, biblioteca, kit] = await Promise.all([estiloDe(accountId), bibliotecaDe(accountId), kitActivo(accountId).catch(() => null)])
  const fuentes = fuentesDisponibles(kit)

  if (!guardado?.listo) {
    const propuesta = guardado?.config ?? (await proponerEstilo(accountId))
    return <OnboardingEstilo propuesta={propuesta} origen={origenDe(propuesta, Boolean(kit))} biblioteca={biblioteca} fuentes={incluir(fuentes, propuesta.fuente)} />
  }
  // La clave cambia al guardar: el editor vuelve a partir de lo guardado.
  return <EditorEstilo key={guardado.updatedAt ?? "nuevo"} inicial={guardado.config} biblioteca={biblioteca} fuentes={incluir(fuentes, guardado.config.fuente)} />
}

function fuentesDisponibles(kit: Awaited<ReturnType<typeof kitActivo>>): FuenteDisponible[] {
  const lista: FuenteDisponible[] = [
    { clave: "studio:HeroFont", nombre: "HeroFont", fuente: { origen: "studio", nombre: "HeroFont" } },
    { clave: "studio:Space Grotesk", nombre: "Space Grotesk", fuente: { origen: "studio", nombre: "Space Grotesk" } },
  ]
  const vistas = new Set<string>()
  for (const a of kit?.archivos ?? []) {
    if (a.tipo !== "fuente" || typeof a.meta.familia !== "string") continue
    const familia = String(a.meta.familia)
    if (vistas.has(familia)) continue
    vistas.add(familia)
    lista.unshift({ clave: `kit:${a.ruta}`, nombre: `${familia} (kit)`, fuente: { origen: "kit", familia, archivo: { bucket: "marca-kits", ruta: a.ruta } } })
  }
  return lista
}

/** La fuente elegida siempre aparece entre las opciones, aunque venga de una subida o del preset. */
function incluir(lista: FuenteDisponible[], f: Fuente): FuenteDisponible[] {
  if (lista.some((x) => JSON.stringify(x.fuente) === JSON.stringify(f))) return lista
  const nombre = f.origen === "studio" ? f.nombre : f.familia
  return [{ clave: `actual:${nombre}`, nombre, fuente: f }, ...lista]
}

function origenDe(e: Awaited<ReturnType<typeof proponerEstilo>>, conKit: boolean): string[] {
  const nombreFuente = e.fuente.origen === "studio" ? e.fuente.nombre : e.fuente.familia
  return [
    `Colores de ${conKit ? "tu kit y " : ""}lo visual de la marca: acento ${e.colores.acento}.`,
    `Fuente: ${nombreFuente}${e.fuente.origen === "kit" ? ", la de títulos de tu kit" : ""}.`,
    e.logo.sobre_acento ? "Tu logo en las tarjetas de intro y cierre." : "Sin logo: las tarjetas van solo con texto. Puedes subirlo después.",
    e.ctas.length ? `${e.ctas.length === 1 ? "Un CTA" : `${e.ctas.length} CTA`} de tu marca como barras del video. Falta poner el enlace de su QR.` : "Sin CTA todavía: agrégalos en Marca > CTA o aquí.",
  ]
}
