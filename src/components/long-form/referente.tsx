import { Badge } from "@/components/ui/badge"
import type { EstadoReferente } from "@/engine/long-form/referente"

/**
 * Lo que Studio entendio del referente de edicion: lo que se ve en el (medido), su resumen, lo que se aplica a
 * este video y lo que queda anotado para cuando el motor lo sepa hacer. Solo lectura: lo deja la etapa
 * `referente` del motor.
 */
export function TarjetaReferente({ r, modo }: { r: EstadoReferente; modo: "revision" | "video" }) {
  const { ve, aplica, pendiente } = r.resumen
  const minutos = Math.round(r.metricas.analizado_s / 60)
  return (
    <section className="flex flex-col gap-3 rounded-xl border p-4" aria-label="Referente de edición">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium">{modo === "video" ? "Editado al estilo del referente" : "Así edita este referente"}</span>
        <Badge variant="secondary">{r.ficha.por_ia ? "Medido y visto por la IA" : "Solo medido"}</Badge>
      </div>

      {ve.length ? (
        <ul className="flex flex-wrap gap-1.5" aria-label="Lo que se ve en el referente">
          {ve.map((x) => (
            <li key={x}>
              <Badge variant="outline">{x}</Badge>
            </li>
          ))}
        </ul>
      ) : null}

      {r.ficha.resumen ? <p className="text-sm">{r.ficha.resumen}</p> : null}

      {modo === "revision" || aplica.length ? (
        <div className="flex flex-col gap-1">
          <span className="text-sm font-medium">{modo === "video" ? "Lo que se aplicó" : "Lo que se aplica a tu video"}</span>
          {aplica.length ? (
            <ul className="text-muted-foreground list-disc pl-5 text-sm">
              {aplica.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground text-sm">Nada cambia: el referente se parece al estilo de tu marca.</p>
          )}
        </div>
      ) : null}

      {pendiente.length ? (
        <p className="text-muted-foreground text-xs">
          También usa {pendiente.join(", ")}. Studio todavía no lo hace: quedó anotado para más adelante.
        </p>
      ) : null}
      {r.metricas.recortado ? <p className="text-muted-foreground text-xs">El referente es largo: se analizaron sus primeros {minutos} minutos.</p> : null}
      <p className="text-muted-foreground text-xs">Del referente solo se toma el estilo: nada suyo aparece en tu video.</p>
    </section>
  )
}
