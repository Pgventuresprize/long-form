import { redirect } from "next/navigation"

import { ChatApp } from "@/components/chat/chat-app"
import { cuentaActual, cuentasDelUsuario } from "@/lib/accounts"
import { estadoChat, noticiasConAngulo } from "@/lib/chat-data"
import { nombreDe } from "@/lib/chat-nombre"
import { funcionesEncendidas } from "@/lib/funciones"
import { debeHacerOnboarding } from "@/lib/onboarding"
import { usuarioActual } from "@/lib/supabase/auth"

export const dynamic = "force-dynamic"

/**
 * El inicio de Plogy Studio: el chat con el equipo de agentes (chat.html). Va a
 * pantalla completa, sin el marco del dashboard: el resto de funciones se abre
 * desde su propio menu. La conversacion abierta va en `?c=`.
 */
export default async function InicioPage({ searchParams }: { searchParams: Promise<{ c?: string }> }) {
  const usuario = await usuarioActual()
  if (!usuario) redirect("/login")

  const [cuenta, cuentas, { c }] = await Promise.all([cuentaActual(), cuentasDelUsuario(), searchParams])
  if (await debeHacerOnboarding(cuenta)) redirect("/empezar")
  const abierta = c && /^[0-9a-f-]{36}$/i.test(c) ? c : null
  const [estado, noticias, funciones] = await Promise.all([estadoChat(cuenta.id, abierta), noticiasConAngulo(cuenta.id), funcionesEncendidas(cuenta.id)])

  return (
    <ChatApp
      // Al cambiar de marca todo el chat es otro: se monta de nuevo.
      key={cuenta.id}
      inicial={estado}
      noticiasIniciales={noticias}
      usuario={{ nombre: nombreDe(usuario), email: usuario.email ?? "" }}
      cuenta={{ nombre: cuenta.name, slug: cuenta.slug, plan: cuenta.plan, funciones }}
      cuentas={cuentas.map((x) => ({ nombre: x.name, slug: x.slug }))}
    />
  )
}
