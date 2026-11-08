# Plantillas de los gráficos de long form

Las dibujan dos sitios con el mismo HTML: el motor (Python, `long-form/motor`) al renderizar el video, y Studio
(TypeScript, `src/engine/long-form/plantillas.ts`) en la vista previa del estilo editorial. Si se cambia una
plantilla aquí, cambia en los dos. La prueba `scripts/longform-plantillas.test.ts` compara las dos salidas.

## Archivos

| Archivo | Qué es |
|---|---|
| `base.css` | Fuentes, reinicio y variables de color de la marca |
| `piezas.css` | Pregunta, cita, rótulo, barra con CTA, pop-up, etiquetas y foto, en las dos disposiciones |
| `tarjetas.css` | Tarjetas de intro y cierre |
| `*.html` | El cuerpo de cada pieza |

Lienzo de 1920x1080. La pieza va dentro de `<body class="d-pantalla">` o `<body class="d-escenario">`.

## Huecos

- `{{campo}}`: texto, se escapa.
- `{{{campo}}}`: HTML tal cual (la esfera, el logo, el `head` de una barra con su `<span>`).
- `{{#campo}}...{{/campo}}`: el bloque sale solo si el campo tiene valor.

En los CSS los huecos son valores del estilo (`{{acento}}`, `{{familia}}`, `{{fuentes}}`...), siempre como texto.
