"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"

import { cambiarCuenta } from "@/app/cuenta/actions"
import { cerrarSesion } from "@/app/(acceso)/actions"
import { AGENTES } from "@/lib/agentes-catalogo"

import s from "./chat.module.css"
import { cx, I, Ico, Logo, useFuera } from "./comun"

const NAV: { nombre: string; url: string; d: React.ReactNode; sub?: boolean; advance?: boolean; funcion?: string }[] = [
  { nombre: "Chat", url: "/", d: <path d="M4 5h16v11H9l-5 4z" /> },
  { nombre: "Estudio", url: "/estudio", d: <path d="M5 4v16M10 4v16M15 4l4 16" /> },
  { nombre: "Calendario", url: "/calendario", d: <path d="M5 6h14v14H5zM5 10h14M9 3v5M15 3v5" />, advance: true },
  { nombre: "Marca", url: "/marca", d: (<><circle cx="12" cy="12" r="8" /><path d="M12 8v8M9 10v4M15 10v4" /></>) },
  { nombre: "Capas", url: "/capas", d: <path d="M12 4l8 4-8 4-8-4zM4 12l8 4 8-4M4 16l8 4 8-4" />, advance: true },
  { nombre: "Ideas", url: "/ideas", d: <path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.5V16h8v-2.5A6 6 0 0 0 12 3z" />, advance: true },
  { nombre: "Estudio de pilares", url: "/estudio/pilares", d: <path d="M5 4h4v16H5zM14 4h5v16h-5z" />, advance: true },
  { nombre: "Recetas", url: "/recetas", d: <path d="M4 11l8-7 8 7v9H4z" />, advance: true },
  { nombre: "Publicación", url: "/publicacion", d: <path d="M21 3L3 10l7 3 3 7z" />, advance: true },
  { nombre: "Recursos", url: "/recursos", d: <path d="M6 3h9l4 4v14H6zM9 12h7M9 16h7" /> },
  { nombre: "Video studio", url: "/videos", d: <path d="M3 6h14v12H3zM17 10l4-2v8l-4-2" />, advance: true },
  // En beta: sin la funcion se ve con candado y abre el paywall.
  { nombre: "Long-form", url: "/long-form", d: <path d="M4 11h16v9H4zM4 11l2-6 14 2-1.5 4M8.5 5.6l2.5 4.4M13.5 6.3l2.5 4.4" />, funcion: "long_form" },
  { nombre: "Agentes", url: `/agentes/${AGENTES[0].clave}`, d: <path d="M5 9h14v10H5zM12 5v4M9 14h.01M15 14h.01" />, sub: true },
  {
    nombre: "Configuración",
    url: "/configuracion/general",
    d: (<><circle cx="12" cy="12" r="3" /><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1" /></>),
    sub: true,
  },
]

/**
 * El menu de funciones que se abre desde la izquierda: el resto de Plogy Studio y, al
 * pie, la cuenta con el cambio de marca y la salida. Las secciones del plan
 * advance solo se ven en las marcas advance, como en la barra del dashboard.
 */
export function MenuFunciones(props: {
  onCerrar: () => void
  usuario: { nombre: string; email: string }
  cuenta: { nombre: string; slug: string; plan: string; funciones?: string[] }
  cuentas: { nombre: string; slug: string }[]
}) {
  const router = useRouter()
  const [cuentaAbierta, setCuentaAbierta] = React.useState(false)
  const [ocupado, startTransition] = React.useTransition()
  const pie = React.useRef<HTMLDivElement>(null)
  const cerrarCuenta = React.useCallback(() => setCuentaAbierta(false), [])
  useFuera(pie, cuentaAbierta, cerrarCuenta)
  const cerrarBtn = React.useRef<HTMLButtonElement>(null)

  const { onCerrar } = props
  React.useEffect(() => {
    cerrarBtn.current?.focus()
  }, [])
  React.useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCerrar()
    }
    document.addEventListener("keydown", tecla)
    return () => document.removeEventListener("keydown", tecla)
  }, [onCerrar])

  const advance = props.cuenta.plan === "advance"
  const inicial = props.cuenta.nombre.trim().charAt(0).toUpperCase() || "?"

  return (
    <>
      <div className={s.scrim} onClick={props.onCerrar} />
      <aside className={s.drawer} aria-label="Funciones de la plataforma">
        <div className={s.dhead}>
          <Logo grande />
          <button ref={cerrarBtn} type="button" className={s.iconbtn} aria-label="Ocultar funciones" style={{ marginLeft: "auto" }} onClick={props.onCerrar}>
            <Ico d={I.cerrar} />
          </button>
        </div>
        <div className={s.dlabel}>Plataforma</div>
        <nav aria-label="Plataforma" className={s.navlist}>
          {NAV.filter((n) => advance || !n.advance).map((n) =>
            n.url === "/" ? (
              <button key={n.nombre} type="button" className={cx(s.nav, s.on)} aria-current="page" onClick={props.onCerrar}>
                <Ico d={n.d} />
                {n.nombre}
              </button>
            ) : (
              <Link key={n.nombre} href={n.url} className={s.nav}>
                <Ico d={n.d} />
                {n.nombre}
                {n.funcion && !(props.cuenta.funciones ?? []).includes(n.funcion) ? (
                  <span className={s.chev} title="Beta privada">
                    <Ico d={<path d="M7 11V8a5 5 0 0 1 10 0v3M5 11h14v10H5z" />} />
                    <span className="sr-only">(beta privada)</span>
                  </span>
                ) : null}
                {n.sub ? (
                  <span className={s.chev}>
                    <Ico d={I.derecha} />
                  </span>
                ) : null}
              </Link>
            )
          )}
        </nav>
        <div className={s.dfoot} ref={pie}>
          <button type="button" className={s.dfootBtn} aria-expanded={cuentaAbierta} onClick={() => setCuentaAbierta(!cuentaAbierta)} disabled={ocupado}>
            <div className={s.me} style={{ width: 32, height: 32 }}>
              {inicial}
            </div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 13.5, fontWeight: 600 }}>{props.cuenta.nombre}</div>
              <div style={{ fontSize: 12, color: "var(--muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{props.usuario.email}</div>
            </div>
            <Ico d={I.abajo} style={{ transform: "rotate(180deg)" }} />
          </button>
          {cuentaAbierta ? (
            <div className={s.menu} role="menu" style={{ bottom: 56, left: 0, width: "100%" }}>
              {props.cuentas.length > 1 ? (
                <>
                  {props.cuentas.map((c) => (
                    <button
                      key={c.slug}
                      type="button"
                      className={s.mi}
                      role="menuitem"
                      onClick={() =>
                        startTransition(async () => {
                          if (c.slug !== props.cuenta.slug) await cambiarCuenta(c.slug)
                          // Otra marca es otro chat entero: se vuelve al inicio.
                          router.replace("/")
                          router.refresh()
                        })
                      }
                    >
                      {c.nombre}
                      {c.slug === props.cuenta.slug ? (
                        <span className={s.chk}>
                          <Ico d={I.check} />
                        </span>
                      ) : null}
                    </button>
                  ))}
                  <div className={s.msep} />
                </>
              ) : null}
              <Link href="/marcas" className={s.mi} role="menuitem">
                <Ico d={<path d="M12 4l8 4-8 4-8-4zM4 12l8 4 8-4M4 16l8 4 8-4" />} />
                Mis marcas
              </Link>
              <Link href="/contrasena-nueva" className={s.mi} role="menuitem">
                <Ico d={(<><path d="M2.6 17.4A2 2 0 0 0 2 18.8V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.2a2 2 0 0 0 1.4-.6l.8-.8a6.5 6.5 0 1 0-4-4z" /><circle cx="16.5" cy="7.5" r=".5" /></>)} />
                Cambiar contraseña
              </Link>
              <button type="button" className={s.mi} role="menuitem" onClick={() => startTransition(() => cerrarSesion())}>
                <Ico d={I.salir} />
                Cerrar sesión
              </button>
            </div>
          ) : null}
        </div>
      </aside>
    </>
  )
}
