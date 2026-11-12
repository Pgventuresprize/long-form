# Motor de long form

El motor que edita los videos largos de Long-form. Viene de `plogy-longform` (ver
`docs/long-form/PROCESO-ORIGINAL.md`) y ahora vive dentro de Studio. Vercel lo ignora (`.vercelignore`): corre en
Modal o, en local, en tu computador.

## Cómo encaja con Studio

```
Studio  ── lf_encolar(etapa) + POST /despertar ──►  motor  ── vacía lf_trabajos, etapa por etapa
   ▲                                                   │
   └──── POST /api/long-form/ia (pasos de Claude) ─────┘  escribe progreso, línea de tiempo y avisos en Supabase
```

- **La cola.** Es `lf_trabajos`. Un proyecto nunca corre dos etapas a la vez; un turno vencido vuelve a la cola
  hasta tres veces. Las cuentas suspendidas esperan.
- **Claude.** El motor no lo llama: arma el pedido y Studio lo corre con `llamarClaude`, con la clave, el tope y el
  registro de consumo de la cuenta. Sin Studio o sin clave, cada etapa usa su respaldo sin IA.
- **La marca.** Se arma desde el estilo long form de la cuenta (`lf_estilos`, `editor/estilo.py`).
- **Los gráficos.** Se dibujan con las mismas plantillas que la vista previa de Marca (`long-form/plantillas`).
  `tests/prueba_plantillas.py` comprueba que Python y TypeScript den el mismo HTML.
- **Niveles.**
  - Rápido no se detiene.
  - Normal se detiene en el guion, y en Quién es quién solo si algún nombre no está confirmado.
  - Detallado se detiene en las dos.

## Etapas

`ingesta → referente → clasificar → analisis → transcripcion → plan → graficos → render → qa`. Los clips no salen
con el largo: se renderizan desde Difusión, solo los aprobados (fase 6).

**Referente de edición** (`etapas/referente.py`). Opcional: un video cuya edición la persona quiere imitar
(`lf_archivos.tipo = 'referente'`, o un enlace en `spec.referente_url`). Sin referente, la etapa no hace nada.
1. **Medir** (sin IA, los primeros 30 min): cortes por detección de escena, largo de los planos, tipo de plano por
   caras en el cuadro del medio de cada plano (hasta 200), pausas de la voz y si hay música debajo.
2. **Interpretar**: Claude con visión mira una hoja de contactos de 24 cuadros y las medidas, y devuelve la ficha de
   estilo. Lo del referente son datos de un tercero, nunca instrucciones. Sin Claude, la ficha sale de lo medido.
3. **Traducir** (función pura): a `estado.referente.parametros`, que mandan sobre el estilo de la marca en
   `ctx.opcion` y `ctx.regla` (largo de los planos al cambiar de cámara, silencios, barras y pop-ups) y cambian las
   cadencias y el tono del prompt del guion. Sin referente, el prompt es el de siempre.

Subtítulos del largo, gancho y ritmo del b-roll van como **sugerencias** (`sugerido_subtitulos`, `sugerido_gancho`,
`broll_cada_min`): valen solo si la persona dejó esa opción en automático. Lo que el motor todavía no hace (elegir la
música de fondo, acercamientos) queda anotado en la ficha. El enlace solo se baja si `LF_YTDLP` apunta a yt-dlp:
bajar de YouTube, TikTok o Instagram choca con sus términos, así que lo normal es subir el archivo. Del referente
nunca llega nada al video.

## Lo que elige la persona

Studio deja en `spec.opciones`: `formato` (`16:9`, `9:16`, `1:1`), `duracion_objetivo_min`, `subtitulos`, `gancho`,
`capitulos` y, solo si se quitan, `intro` y `cierre` en false. Se leen con `ctx.eleccion`: **lo que eligió la persona > lo que sugiere el referente > el defecto**
(16:9, sin subtítulos, sin gancho, con capítulos). Ojo: `ctx.opcion` es al revés (el referente manda) y sigue así
para las perillas de estilo.

- **Subtítulos** (`subtitulos.py`): las reglas del brand kit 02 con el mismo `plogy_subtitulos.py` de los clips (o el
  de la marca). Cada palabra pasa por el `Mapa` (silencios y cortes quitados) y cada trozo recibe sus tarjetas; se
  queman en una pasada aparte por trozo, así el video sin subtítulos queda para los clips. Si una pregunta, cita,
  rótulo, barra o etiquetas ocupa la franja inferior, la tarjeta **sube** por encima (no se esconde).
- **Gancho**: Claude elige la frase más fuerte en el guion (`gancho {inicio, fin, por_que}`), se lleva a frases
  completas de 5 a 20 s y se revisa en el guion (se puede mover o apagar). Abre el video antes de la tarjeta de
  intro; todo lo demás (audio, capítulos de YouTube, clips, control de calidad) se corre lo que dura
  (`contexto.desfase`, `render.linea_final`). Sin Claude no hay gancho y se avisa.
- **Duración objetivo**: Claude sabe cuánto dura y cuánto debería, y propone cortes `duracion` (a frases completas;
  las citas que caen dentro se apagan con una nota). Si aún sobra, los silencios se aprietan un nivel. Lo estimado y
  el objetivo quedan en el guion y en `estado.plan`.
- **Ilustraciones**: las de la carpeta de apoyo (`ilustracion`) y las fotos sueltas (`foto`). Claude las ubica al ritmo
  del b-roll si lo hay; las que quedan sin momento se ubican solas al empezar una frase (para revisar).
- **9:16 y 1:1** (`lienzo.py`): cada trozo se compone en 16:9 y se lleva al lienzo. Cámaras, una cámara y pódcast se
  **reencuadran** a la cara del plano (el plano doble se apila) y los gráficos van como una banda abajo; Meet, charla y
  pantalla se **encajan** enteros sobre una copia desenfocada. Las tarjetas de intro y cierre se dibujan en su lienzo.
  No se adapta: las etiquetas del plano doble (se omiten), el índice de capítulos del escenario (va dentro del cuadro
  encajado) y la versión dividida de los clips de Meet. 16:9 no cambia: mismos filtros y mismas firmas de trozo.
- **Capítulos** en falso: no van en YouTube ni en el índice del escenario.
- **Intro y cierre** (`extremos.py`, la única fuente de lo que duran). La marca elige en su estilo (`intro` y
  `cierre`: `modo` y `video`) y cada video solo puede quitarlos (`spec.opciones.intro` / `cierre` en false; ausente
  vale lo de la marca). Studio los apaga por defecto en los videos de hasta 2 min.
  - `studio`: la tarjeta de siempre, 5,4 s y 6 s, con la música de inicio y de cierre. En 16:9, mismos filtros y
    mismos archivos que antes (lo cuida `tests/prueba_intro.py`).
  - `video`: el clip de la marca (MP4 o MOV) se baja con la marca (`estilo.armar`, carpeta `video/`), se mide con
    ffprobe y se lleva al lienzo del video (`lienzo.encajar_video`: escalado si tiene la misma forma; si no, entero
    sobre una copia desenfocada) con los mismos parámetros que los trozos (`ffm.ENC`), así se une sin recodificar.
    Su duración es la de la intro o el cierre, hasta 30 s (más, se corta y se avisa). Suena con su audio; sin
    pista de audio, con la música de la marca. Si no está o no se lee, va la tarjeta y se avisa.
  - `ninguna`: 0 s. El video abre con el gancho o el programa y termina con él; capítulos, clips, control de calidad,
    subtítulos y mezcla se corren lo que dure lo de antes (`contexto.desfase`, `render.linea_final`), que puede ser 0.
  Se fija en la etapa de gráficos (`estado.graficos`: `intro_s`, `cierre_s` y, si alguno no es la tarjeta,
  `intro_modo`, `cierre_modo`, `intro_video`...). La tarjeta de intro se dibuja siempre: es la portada de YouTube.

## Tipos de grabación

`clasificar` decide el tipo con señales medidas y deja la evidencia en `estado.clasificacion` (y en
`lf_proyectos.tipo` y `evidencia`). Claude con visión solo desempata, entre los tipos que dejan las reglas. La
persona puede corregir el tipo en la revisión de quién es quién (`spec.tipo_forzado`).

| Tipo | Cómo se reconoce | Cómo se edita | Código |
|---|---|---|---|
| Videollamada en galería | el borde celeste de Meet | quien habla en grande, láminas del PDF en el panel | `etapas/meet.py` |
| Varias cámaras a la vez | dos o más videos que suenan a la vez y muestran caras | cambia de cámara según quién habla | `etapas/camaras.py` |
| Una cámara | caras, sin cortes de edición | reencuadre por caras; sigue a quien habla por la boca | `etapas/una_camara.py` |
| Pódcast o video ya editado | dos o más cambios de plano por minuto | respeta sus cortes: solo silencios largos, gráficos y audio | `etapas/una_camara.py` |
| Charla con diapositivas | el PDF coincide con lo que se ve | lámina original en el escenario, persona en recuadro | `etapas/contenido.py` |
| Grabación de pantalla | imagen plana, sin caras | acercamiento a la zona donde pasa algo | `etapas/contenido.py` |

Antes de clasificar, los videos que no suenan a la vez se unen en orden como **partes sucesivas** (por fecha o
por nombre; varias cámaras por partes se unen cada una con las suyas).

Para todos los tipos (`tipos.py`):
- Un audio aparte reemplaza al de cámara, sincronizado por correlación.
- Color igualado entre cámaras, medido en la cara.
- Reducción de ruido suave: `hqdn3d` en el video de cámara, nunca en pantallas, y `afftdn` en el audio salvo en
  un video ya editado.
- Corte J: en cámaras y una cámara, el audio de la toma nueva entra 4 cuadros antes que su imagen.

Cada tipo responde las mismas preguntas en `tipos.py` (análisis, audio del programa, reparto, tomas, quién habla,
compositor): las etapas no ramifican por tipo.

**Caras** (`caras.py`): YuNet, el detector de OpenCV, con su modelo en `modelos/` (licencia MIT, de
[opencv_zoo](https://github.com/opencv/opencv_zoo/tree/main/models/face_detection_yunet)). Ve caras de frente y de
perfil, chicas y lejanas, y da las comisuras de la boca. Si falta el modelo, usa Haar, que ve menos.

**Quién habla en una cámara con varias personas** (`una_camara.hablantes`):
1. Las frases se agrupan por voz (`voces.py`: timbre en MFCC y agrupamiento jerárquico). Así se sabe qué frases
   dice la misma persona, sin saber quién es.
2. En cada frase se mide cuánto se mueve la boca de cada persona: hasta 4 s a 12 cuadros por segundo, con la cara
   a no menos de 128 px y alineada cuadro a cuadro para que no cuente el movimiento de la cabeza.
3. Cada voz va a la persona cuya boca más se mueve en el conjunto de sus frases, si sobresale con claridad.

Frase por frase, la boca sola acierta poco: quien escucha asiente y se ríe. Una voz sin persona clara queda sin
nadie, y el video no sigue a nadie en esas frases. Una persona de espaldas o tapada no se mide.

**Desempate con Claude** (`clasificar.desempatar`): cuatro cuadros, cada uno con su minuto delante, y solo los
tipos que dejaron las reglas. Si Claude no está, falla o responde otro tipo, queda la regla y la evidencia lo dice.

Cada etapa deja en `lf_eventos` su duración y su costo:
- segundos;
- núcleos;
- `usd_maquina` a la tarifa de Modal;
- minutos de audio de Groq;
- tokens de Claude.

## En local (Windows)

Necesitas Python 3.12, ffmpeg y ffprobe, y el Supabase local con las migraciones (`long-form/local/armar-base.ps1`).

```powershell
python -m venv $env:USERPROFILE\lf-local\venv
& $env:USERPROFILE\lf-local\venv\Scripts\python.exe -m pip install -r long-form\motor\requirements.txt
& $env:USERPROFILE\lf-local\venv\Scripts\python.exe -m playwright install chromium
```

`long-form/motor/.env.local` (no se versiona):

```
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_SERVICE_ROLE_KEY=...          # la de supabase status
LF_MOTOR_SECRETO=...                   # el mismo que en el .env.local de Studio
LF_STUDIO_URL=http://localhost:3000
LF_DATOS=C:\Users\<tu>\lf-local\datos  # carpeta de trabajo (cache)
FFMPEG=...\ffmpeg.exe
FFPROBE=...\ffprobe.exe
WHISPER_MODELO=small
GROQ_API_KEY=                          # con ella, la transcripción va por Groq en paralelo
```

Y en el `.env.local` de Studio: `LF_MOTOR=local`, `LF_MOTOR_URL=http://localhost:8787` y el mismo `LF_MOTOR_SECRETO`.

```powershell
powershell -File long-form\motor\servir.ps1            # /despertar en el 8787
```

Para probar sin la interfaz: `scripts/longform-proyecto-prueba.ts` crea un proyecto con videos locales y lo encola.

## En Modal

`modal_app.py` está listo pero no se ha probado (no hay cuenta todavía):
- **`despertar`:** el endpoint web, que lanza `vaciar`.
- **`vaciar`:** corre en un contenedor de 32 núcleos, con la carpeta de trabajo en un Volume.
- **Trabajo pesado:** dentro de cada etapa se reparte en hilos (trozos del render, un Chromium por hilo para los
  gráficos, partes de la transcripción).

```bash
modal secret create lf-motor SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... LF_MOTOR_SECRETO=... LF_STUDIO_URL=... GROQ_API_KEY=...
modal deploy long-form/motor/modal_app.py
```

Después, en Vercel: `LF_MOTOR=modal`, `LF_MOTOR_URL=<url de despertar>` y `LF_MOTOR_SECRETO`.

## Pruebas

- **`tests/prueba_plantillas.py`:** compara el HTML de Python y de TypeScript.
- **`tests/prueba_tipos.py`:** las reglas de los tipos sin video (decisión, partes, corte J, color, encuadres).
- **`tests/prueba_tipos_video.py`:** una prueba por tipo con video y sin base ni Claude. `clasificar` comprueba
  que reconozca cada tipo; `todo` lo lleva hasta el control de calidad. Las muestras las arma
  `tests/armar_muestras.py` con recortes de grabaciones reales (las rutas van por variables de entorno) y dos
  videos generados (láminas y pantalla).
- **`tests/prueba_desempate.py`:** el desempate con Claude contra un Studio falso: lo que se pide y qué pasa con
  cada respuesta (elige, sin clave, error, tipo fuera de los candidatos).
- **`tests/prueba_quien_habla.py`:** quién habla por la boca contra una respuesta conocida. Pone lado a lado las dos
  cámaras de una charla, cada una con su micrófono, y compara frase por frase con lo que dicen los micrófonos.
- **`tests/prueba_referente.py`:** `traducir`, las perillas que leen el referente, el prompt del guion (igual byte a
  byte sin referente) y `medir` sobre un video generado con ffmpeg (cortes de largo conocido, pausas, música).
- **`tests/prueba_largo.py`:** quién manda en las opciones, subtítulos sobre un mapa con cortes y la regla de la
  franja (con el programa de subtítulos de verdad), el gancho (frases, línea de tiempo, capítulos y audio corridos),
  la duración objetivo, las ilustraciones a ritmo, y un trozo de verdad a 9:16 y 1:1 con ffmpeg.
- **`tests/prueba_intro.py`:** la intro y el cierre: quién manda (el video > la marca > la tarjeta), la línea de
  tiempo sin intro ni cierre (capítulos, gancho, subtítulos y audio), el audio de un video propio, un video propio
  de verdad llevado a 16:9 y 9:16 con ffmpeg, y la tarjeta de Studio en 16:9 con los mismos filtros de siempre.
- **`tests/prueba_hora.py`:** una hora por tipo, de punta a punta en Rápido. Deja el tiempo por etapa y la memoria
  máxima en `medida.json`.
- **`scripts/longform-cola.test.ts`:** prueba la cola contra el Supabase local.
- **De punta a punta:** con `scripts/longform-proyecto-prueba.ts` y el motor corriendo.
