"use client"

import * as React from "react"
import { AlertTriangleIcon, PlusIcon } from "lucide-react"

import { aprobarGuion } from "@/app/long-form/actions"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import type { Proyecto } from "@/engine/long-form/datos"
import { mmss } from "@/engine/long-form/datos"

type Pregunta = { id?: string; inicio: number; fin: number; encabezado: string; texto: string; omitir?: boolean }
type Cita = { id?: string; t: number; quien: string; rol?: string; texto: string; original?: string; revisar?: string; omitir?: boolean }
type Capitulo = { inicio: number; titulo: string }
type Corte = { inicio: number; fin: number; motivo: string; tipo: string; aplicar?: boolean }
type Sensible = { inicio: number; fin: number; motivo: string }
type Fija = { tipo: "rotulo" | "barra" | "popup"; salida: number; persona?: string; cta?: string; omitir?: boolean }
/** Un archivo de la carpeta de apoyo (o una foto suelta). Sin `t`, todavia no tiene momento. */
type Ilustracion = { archivo: string; t: number | null; modo?: string; porque?: string; revisar?: string; omitir?: boolean }
/** La frase que abre el video antes de la intro. Tiempos de la grabacion, como el resto del guion. */
type Gancho = { inicio: number; fin: number; por_que?: string; texto?: string; revisar?: string; omitir?: boolean }
type Guion = {
  capitulos: Capitulo[]
  preguntas: Pregunta[]
  citas: Cita[]
  cortes: Corte[]
  sensibles: Sensible[]
  fijas: Fija[]
  ilustraciones: Ilustracion[]
  gancho?: Gancho
  duracion_estimada?: number
  duracion_objetivo?: number
  youtube?: { titulo: string; descripcion: string; etiquetas?: string[] }
  titulo?: string
  [k: string]: unknown
}

type Pista = "capitulos" | "preguntas" | "citas" | "fijas" | "ilustraciones" | "cortes" | "sensibles"
type Elegido = { pista: Pista; i: number } | null

const PISTAS: { valor: Pista; nombre: string; color: string }[] = [
  { valor: "capitulos", nombre: "Capítulos", color: "bg-foreground/70" },
  { valor: "preguntas", nombre: "Preguntas", color: "bg-info" },
  { valor: "citas", nombre: "Citas", color: "bg-success" },
  { valor: "fijas", nombre: "Rótulos, barras y pop-ups", color: "bg-brand" },
  { valor: "ilustraciones", nombre: "Ilustraciones", color: "bg-foreground/40" },
  { valor: "cortes", nombre: "Cortes", color: "bg-destructive" },
  { valor: "sensibles", nombre: "Para mirar", color: "bg-warning" },
]

const inicioDe = (pista: Pista, x: Record<string, unknown>): number =>
  Number(pista === "citas" || pista === "ilustraciones" ? x.t : pista === "fijas" ? x.salida : x.inicio) || 0
const finDe = (pista: Pista, x: Record<string, unknown>): number =>
  pista === "citas"
    ? Number(x.t) + 7
    : pista === "ilustraciones"
      ? Number(x.t) + (x.modo === "recorrido" ? 16 : 6)
      : pista === "fijas"
        ? Number(x.salida) + (x.tipo === "barra" ? 12 : 5)
        : pista === "capitulos"
          ? Number(x.inicio) + 4
          : Number(x.fin)
/** Las ilustraciones sin momento no van en la linea de tiempo: se listan aparte. */
const ubicado = (pista: Pista, x: Record<string, unknown>) => pista !== "ilustraciones" || typeof x.t === "number"

/** Lo que conviene mirar antes de aprobar: choques y citas que no aparecen en la transcripcion. */
export function choques(g: Guion): string[] {
  const out: string[] = []
  const fijas = g.fijas.filter((f) => !f.omitir && f.tipo !== "popup").sort((a, b) => a.salida - b.salida)
  for (let i = 1; i < fijas.length; i++) {
    const prev = fijas[i - 1]
    if (fijas[i].salida < prev.salida + (prev.tipo === "barra" ? 12 : 5)) out.push(`Un ${fijas[i].tipo} en ${mmss(fijas[i].salida)} se cruza con el ${prev.tipo} de ${mmss(prev.salida)}: el segundo se corre.`)
  }
  const citas = g.citas.filter((c) => !c.omitir).sort((a, b) => a.t - b.t)
  for (let i = 1; i < citas.length; i++) if (citas[i].t - citas[i - 1].t < 8) out.push(`Dos citas casi juntas en ${mmss(citas[i].t)}: la segunda puede quedar fuera.`)
  for (const c of g.citas) if (!c.omitir && c.revisar) out.push(`Cita en ${mmss(c.t)}: ${c.revisar}`)
  for (const c of g.citas) if (!c.omitir && c.texto.length > 66) out.push(`Cita en ${mmss(c.t)}: tiene ${c.texto.length} caracteres (máximo 66).`)
  for (const q of g.preguntas) if (!q.omitir && q.texto.length > 60) out.push(`Pregunta en ${mmss(q.inicio)}: tiene ${q.texto.length} caracteres (máximo 60).`)
  const sueltas = g.ilustraciones.filter((il) => !il.omitir && typeof il.t !== "number").length
  if (sueltas) out.push(sueltas === 1 ? "Una ilustración no tiene momento: no entra en el video." : `${sueltas} ilustraciones no tienen momento: no entran en el video.`)
  if (g.gancho && !g.gancho.omitir && g.gancho.fin - g.gancho.inicio > 20) out.push("El gancho dura más de 20 s: acórtalo.")
  if (g.gancho && !g.gancho.omitir && g.gancho.revisar) out.push(`Gancho: ${g.gancho.revisar}`)
  return out
}

/**
 * Revision 2: el guion. Una pista por tipo de grafico sobre la duracion del video, el reproductor al lado y
 * la edicion en un panel lateral. Clic en un elemento lleva el video a ese momento. En el telefono la linea
 * de tiempo pasa a una lista por minuto.
 */
export function RevisionGuion({ p, urls, alAprobar }: { p: Proyecto; urls: Record<string, string>; alAprobar: () => void }) {
  const [g, setG] = React.useState<Guion>(() => normalizar(p.estado.guion as Partial<Guion>))
  const [elegido, setElegido] = React.useState<Elegido>(null)
  const [confirmar, setConfirmar] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [ocupado, start] = React.useTransition()
  const video = React.useRef<HTMLVideoElement>(null)
  const [ahora, setAhora] = React.useState(0)
  const fuente = p.archivos.find((a) => a.tipo === "fuente" && (a.rol === "A" || !a.rol))
  const src = fuente ? urls[fuente.ruta] : undefined
  const tomas = (p.estado.tomas as { b: number }[] | undefined) ?? []
  const [duracion, setDuracion] = React.useState(() => tomas.at(-1)?.b ?? 0)
  const total = Math.max(duracion, 1)
  const avisos = choques(g)

  const ir = (t: number) => {
    if (video.current) {
      video.current.currentTime = Math.max(0, t)
      void video.current.play().catch(() => {})
    }
  }
  const editar = (pista: Pista, i: number, cambio: Record<string, unknown>) =>
    setG((x) => ({ ...x, [pista]: (x[pista] as Record<string, unknown>[]).map((it, j) => (j === i ? { ...it, ...cambio } : it)) }))
  const agregar = (pista: Pista) => {
    const t = Math.round(ahora)
    const nuevo: Record<Pista, Record<string, unknown>> = {
      capitulos: { inicio: t, titulo: "Nuevo capítulo" },
      preguntas: { inicio: t, fin: t + 120, encabezado: "En esta sesión", texto: "" },
      citas: { t, quien: "", texto: "", original: "" },
      fijas: { tipo: "popup", salida: t },
      ilustraciones: { archivo: "", t },
      cortes: { inicio: t, fin: t + 10, motivo: "", tipo: "nota_editorial", aplicar: true },
      sensibles: { inicio: t, fin: t + 10, motivo: "" },
    }
    setG((x) => ({ ...x, [pista]: [...(x[pista] as unknown[]), nuevo[pista]] }))
    setElegido({ pista, i: (g[pista] as unknown[]).length })
  }

  const aprobar = () =>
    start(async () => {
      setError(null)
      const r = await aprobarGuion(p.id, g)
      if (!r.ok) setError(r.error)
      else alAprobar()
    })

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="flex flex-col gap-2">
          {src ? (
            <video
              ref={video}
              src={src}
              controls
              preload="metadata"
              className="aspect-video w-full rounded-xl bg-black"
              onLoadedMetadata={(e) => setDuracion((d) => d || e.currentTarget.duration)}
              onTimeUpdate={(e) => setAhora(e.currentTarget.currentTime)}
            />
          ) : (
            <div className="bg-muted text-muted-foreground flex aspect-video items-center justify-center rounded-xl text-sm">Sin video para mostrar.</div>
          )}
          <p className="text-muted-foreground text-xs">Video de la cámara principal. Los rótulos y barras se ubican en el tiempo del video editado, que es casi el mismo.</p>
        </div>
        <div className="flex min-w-0 flex-col gap-3">
          <div className="rounded-xl border p-4">
            <div className="text-muted-foreground text-xs">Para YouTube</div>
            <Label htmlFor="yt-titulo" className="mt-2 text-xs">
              Título
            </Label>
            <Input id="yt-titulo" value={g.youtube?.titulo ?? ""} maxLength={100} onChange={(e) => setG((x) => ({ ...x, youtube: { ...(x.youtube ?? { descripcion: "" }), titulo: e.target.value } }))} />
            <Label htmlFor="yt-desc" className="mt-2 text-xs">
              Descripción
            </Label>
            <Textarea id="yt-desc" rows={4} value={g.youtube?.descripcion ?? ""} onChange={(e) => setG((x) => ({ ...x, youtube: { ...(x.youtube ?? { titulo: "" }), descripcion: e.target.value } }))} />
          </div>
          {g.duracion_estimada ? (
            <p className="text-muted-foreground text-xs tabular-nums">
              Duración estimada {mmss(g.duracion_estimada)}
              {g.duracion_objetivo ? ` · objetivo ${mmss(g.duracion_objetivo)}` : ""}
            </p>
          ) : null}
          {g.gancho ? <TarjetaGancho gancho={g.gancho} ir={ir} cambiar={(c) => setG((x) => ({ ...x, gancho: { ...(x.gancho as Gancho), ...c } }))} /> : null}
          {avisos.length ? (
            <div className="bg-warning-soft flex flex-col gap-1 rounded-xl p-3 text-sm" role="status">
              <span className="flex items-center gap-1.5 font-medium">
                <AlertTriangleIcon className="size-4" aria-hidden />
                {avisos.length === 1 ? "Una cosa para mirar" : `${avisos.length} cosas para mirar`}
              </span>
              <ul className="list-disc pl-5 text-xs">
                {avisos.slice(0, 6).map((a) => (
                  <li key={a}>{a}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </div>

      {/* Escritorio: pistas sobre la duracion. */}
      <div className="hidden flex-col gap-1.5 rounded-xl border p-3 md:flex" aria-label="Línea de tiempo del guion">
        <div className="relative ml-40 h-4 text-[10px]">
          {Array.from({ length: 7 }, (_, k) => (
            <span key={k} className="text-muted-foreground absolute -translate-x-1/2" style={{ left: `${(k / 6) * 100}%` }}>
              {mmss((total * k) / 6)}
            </span>
          ))}
          <span className="bg-foreground absolute top-4 h-[calc(var(--alto)*1px)] w-px" style={{ left: `${(ahora / total) * 100}%`, ["--alto" as string]: 34 * PISTAS.length }} aria-hidden />
        </div>
        {PISTAS.map((pista) => (
          <div key={pista.valor} className="flex items-center gap-2">
            <div className="flex w-38 shrink-0 items-center justify-between gap-1">
              <span className="truncate text-xs">{pista.nombre}</span>
              {pista.valor !== "ilustraciones" ? (
                <Button size="icon" variant="ghost" className="size-6" aria-label={`Agregar en ${pista.nombre} en ${mmss(ahora)}`} onClick={() => agregar(pista.valor)}>
                  <PlusIcon className="size-3.5" />
                </Button>
              ) : null}
            </div>
            <div className="bg-muted/60 relative h-7 flex-1 overflow-hidden rounded">
              {(g[pista.valor] as Record<string, unknown>[]).map((x, i) => {
                if (!ubicado(pista.valor, x)) return null
                const a = inicioDe(pista.valor, x)
                const b = Math.max(finDe(pista.valor, x), a + 1)
                const apagado = x.omitir === true || (pista.valor === "cortes" && x.aplicar === false)
                return (
                  <button
                    key={i}
                    type="button"
                    title={`${mmss(a)} · ${String(x.texto ?? x.titulo ?? x.motivo ?? x.persona ?? x.cta ?? x.archivo ?? x.tipo ?? "")}`}
                    aria-label={`${pista.nombre} en ${mmss(a)}`}
                    onClick={() => {
                      ir(a)
                      setElegido({ pista: pista.valor, i })
                    }}
                    className={`absolute top-1 bottom-1 min-w-1.5 rounded-sm ${pista.color} ${apagado ? "opacity-30" : ""} focus-visible:ring-ring outline-none hover:brightness-110 focus-visible:ring-2`}
                    style={{ left: `${(a / total) * 100}%`, width: `${((b - a) / total) * 100}%` }}
                  />
                )
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Ilustraciones sin momento: no estan en la linea de tiempo. */}
      {g.ilustraciones.some((il) => typeof il.t !== "number") ? (
        <div className="flex flex-col gap-1.5 rounded-xl border p-3">
          <span className="text-xs font-medium">Ilustraciones sin momento</span>
          <div className="flex flex-wrap gap-2">
            {g.ilustraciones.map((il, i) =>
              typeof il.t === "number" ? null : (
                <Button key={i} size="sm" variant="outline" onClick={() => setElegido({ pista: "ilustraciones", i })}>
                  {il.archivo}
                </Button>
              ),
            )}
          </div>
        </div>
      ) : null}

      {/* Telefono: lista por minuto. */}
      <ul className="flex flex-col divide-y rounded-xl border md:hidden">
        {PISTAS.flatMap((pista) =>
          (g[pista.valor] as Record<string, unknown>[]).map((x, i) => ({ pista, x, i, a: inicioDe(pista.valor, x) })).filter(({ x }) => ubicado(pista.valor, x)),
        )
          .sort((m, n) => m.a - n.a)
          .map(({ pista, x, i, a }) => (
            <li key={`${pista.valor}-${i}`}>
              <button type="button" className="flex w-full items-start gap-3 px-3 py-2.5 text-left" onClick={() => setElegido({ pista: pista.valor, i })}>
                <span className="text-muted-foreground w-11 shrink-0 text-xs tabular-nums">{mmss(a)}</span>
                <span className={`mt-1.5 size-2 shrink-0 rounded-full ${pista.color}`} aria-hidden />
                <span className={`min-w-0 text-sm ${x.omitir ? "line-through opacity-60" : ""}`}>
                  <span className="text-muted-foreground block text-xs">{pista.nombre}</span>
                  <span className="line-clamp-2">{String(x.texto || x.titulo || x.motivo || x.persona || x.cta || x.archivo || x.tipo || "")}</span>
                </span>
              </button>
            </li>
          ))}
      </ul>

      <Editor g={g} elegido={elegido} alCerrar={() => setElegido(null)} editar={editar} />

      {error ? (
        <p className="text-destructive text-sm" role="alert">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        {avisos.length && !confirmar ? (
          <Button variant="brand" onClick={() => setConfirmar(true)}>
            Aprobar guion
          </Button>
        ) : (
          <Button variant="brand" disabled={ocupado} onClick={aprobar}>
            {ocupado ? "Guardando..." : avisos.length ? "Aprobar de todas formas" : "Aprobar guion"}
          </Button>
        )}
        {confirmar && avisos.length ? <span className="text-muted-foreground text-sm">Hay cosas para mirar arriba. Si están bien, aprueba de todas formas.</span> : null}
      </div>
    </div>
  )
}

function normalizar(g: Partial<Guion> | undefined): Guion {
  return {
    ...(g ?? {}),
    capitulos: g?.capitulos ?? [],
    preguntas: g?.preguntas ?? [],
    citas: g?.citas ?? [],
    cortes: g?.cortes ?? [],
    sensibles: g?.sensibles ?? [],
    fijas: g?.fijas ?? [],
    ilustraciones: g?.ilustraciones ?? [],
  }
}

/** El gancho: la frase que abre el video antes de la intro. Se puede mover, acortar o quitar. */
function TarjetaGancho({ gancho, ir, cambiar }: { gancho: Gancho; ir: (t: number) => void; cambiar: (c: Partial<Gancho>) => void }) {
  const activo = gancho.omitir !== true
  return (
    <div className="flex flex-col gap-2 rounded-xl border p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="text-muted-foreground text-xs">Gancho al abrir</span>
        <Button size="sm" variant="ghost" onClick={() => ir(gancho.inicio)}>
          Ver {mmss(gancho.inicio)}
        </Button>
      </div>
      {gancho.texto ? <p className={`text-sm ${activo ? "" : "line-through opacity-60"}`}>“{gancho.texto}”</p> : null}
      {gancho.por_que ? <p className="text-muted-foreground text-xs">{gancho.por_que}</p> : null}
      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor="gancho-inicio" className="text-xs">
            Empieza en (segundos)
          </Label>
          <Input id="gancho-inicio" type="number" step="0.5" min={0} value={gancho.inicio} onChange={(e) => cambiar({ inicio: Number(e.target.value) })} />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="gancho-fin" className="text-xs">
            Termina en (segundos)
          </Label>
          <Input id="gancho-fin" type="number" step="0.5" min={0} value={gancho.fin} onChange={(e) => cambiar({ fin: Number(e.target.value) })} />
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Switch id="gancho-activo" checked={activo} onCheckedChange={(v) => cambiar({ omitir: !v })} />
        <Label htmlFor="gancho-activo">Abrir el video con esta frase, antes de la intro</Label>
      </div>
    </div>
  )
}

/** El panel lateral: los campos del elemento elegido. */
function Editor({ g, elegido, alCerrar, editar }: { g: Guion; elegido: Elegido; alCerrar: () => void; editar: (pista: Pista, i: number, c: Record<string, unknown>) => void }) {
  const x = elegido ? ((g[elegido.pista] as Record<string, unknown>[])[elegido.i] ?? null) : null
  const nombre = PISTAS.find((p) => p.valor === elegido?.pista)?.nombre ?? ""
  const set = (c: Record<string, unknown>) => elegido && editar(elegido.pista, elegido.i, c)
  const num = (k: string, etiqueta: string) => (
    <div className="flex flex-col gap-1">
      <Label htmlFor={`g-${k}`} className="text-xs">
        {etiqueta} (segundos)
      </Label>
      <Input id={`g-${k}`} type="number" step="0.5" min={0} value={Number(x?.[k] ?? 0)} onChange={(e) => set({ [k]: Number(e.target.value) })} />
    </div>
  )
  const txt = (k: string, etiqueta: string, max: number, largo = false) => (
    <div className="flex flex-col gap-1">
      <Label htmlFor={`g-${k}`} className="text-xs">
        {etiqueta}
      </Label>
      {largo ? (
        <Textarea id={`g-${k}`} rows={3} maxLength={max} value={String(x?.[k] ?? "")} onChange={(e) => set({ [k]: e.target.value })} />
      ) : (
        <Input id={`g-${k}`} maxLength={max} value={String(x?.[k] ?? "")} onChange={(e) => set({ [k]: e.target.value })} />
      )}
      <span className="text-muted-foreground self-end text-[11px] tabular-nums">
        {String(x?.[k] ?? "").length}/{max}
      </span>
    </div>
  )
  return (
    <Sheet open={x !== null} onOpenChange={(o) => !o && alCerrar()}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{nombre}</SheetTitle>
          <SheetDescription>Los cambios quedan en el guion al aprobarlo.</SheetDescription>
        </SheetHeader>
        {x && elegido ? (
          <div className="flex flex-col gap-3 px-4 pb-6">
            {elegido.pista === "capitulos" ? (
              <>
                {num("inicio", "Empieza en")}
                {txt("titulo", "Título", 22)}
              </>
            ) : null}
            {elegido.pista === "preguntas" ? (
              <>
                {num("inicio", "Empieza en")}
                {num("fin", "Termina en")}
                {txt("encabezado", "Encabezado", 40)}
                {txt("texto", "Pregunta", 60, true)}
              </>
            ) : null}
            {elegido.pista === "citas" ? (
              <>
                {num("t", "Se dice en")}
                {txt("quien", "Quién lo dice", 60)}
                {txt("texto", "Cita en pantalla", 66, true)}
                {x.original ? <p className="text-muted-foreground border-l-2 pl-3 text-xs">Lo que dijo: “{String(x.original)}”</p> : null}
                {x.revisar ? <p className="bg-warning-soft rounded-md p-2 text-xs">{String(x.revisar)}</p> : null}
              </>
            ) : null}
            {elegido.pista === "fijas" ? (
              <>
                <p className="text-sm">
                  {x.tipo === "rotulo" ? `Rótulo de ${String(x.persona ?? "")}` : x.tipo === "barra" ? `Barra con el CTA ${String(x.cta ?? "")}` : "Pop-up para seguir la cuenta"}
                </p>
                {num("salida", "Entra en el video editado")}
              </>
            ) : null}
            {elegido.pista === "ilustraciones" ? (
              <>
                <p className="text-sm">{String(x.archivo ?? "")}</p>
                {num("t", "Se ve en")}
                {x.porque ? <p className="text-muted-foreground text-xs">{String(x.porque)}</p> : null}
                {x.revisar ? <p className="bg-warning-soft rounded-md p-2 text-xs">{String(x.revisar)}</p> : null}
              </>
            ) : null}
            {elegido.pista === "cortes" ? (
              <>
                {num("inicio", "Desde")}
                {num("fin", "Hasta")}
                {txt("motivo", "Por qué se corta", 200, true)}
                <div className="flex items-center gap-2">
                  <Switch id="g-aplicar" checked={x.aplicar !== false} onCheckedChange={(v) => set({ aplicar: Boolean(v) })} />
                  <Label htmlFor="g-aplicar">Cortar este tramo</Label>
                </div>
              </>
            ) : null}
            {elegido.pista === "sensibles" ? (
              <>
                {num("inicio", "Desde")}
                {num("fin", "Hasta")}
                <p className="text-sm">{String(x.motivo ?? "")}</p>
                <p className="text-muted-foreground text-xs">No se corta solo: míralo y, si hace falta, agrega un corte.</p>
              </>
            ) : null}
            {elegido.pista !== "cortes" && elegido.pista !== "sensibles" ? (
              <div className="flex items-center gap-2 border-t pt-3">
                <Switch id="g-omitir" checked={x.omitir === true} onCheckedChange={(v) => set({ omitir: Boolean(v) })} />
                <Label htmlFor="g-omitir">No mostrar en el video</Label>
              </div>
            ) : null}
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  )
}
