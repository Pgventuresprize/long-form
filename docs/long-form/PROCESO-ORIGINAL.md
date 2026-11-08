# Proceso de edición tipo talk show en Plogy

Este documento describe cómo se editaron dos grabaciones de Plogy hasta convertirlas en un programa tipo talk show:

1. **"IA en deportes", Open Talk de César y Juanfra** (30 de octubre a 2 de noviembre de 2026). Dos cámaras locales grabadas por separado durante una videollamada.
2. **"Automatiza tu contenido en Instagram", taller de Marco, Luciano y Juanfra** (6 y 7 de noviembre de 2026). Una sola grabación de pantalla de Google Meet.

Se documenta lo que se hizo de verdad: los scripts, los parámetros, las decisiones, lo que salió mal y cómo se corrigió. Al final hay una guía para repetir el proceso con una grabación nueva y el inventario de archivos.

---

## 0. Resumen

### Los dos casos lado a lado

| | César (IA en deportes) | Marco y Luciano (Plogy Studio) |
|---|---|---|
| Material de entrada | 2 videos: celular de César (A) e iPad de Juanfra (B), 1280x720, unos 57 a 60 min cada uno | 1 grabación de pantalla de Meet, 2880x1800, cuadros por segundo variables (unos 37,6 en promedio), 68:27, 8,7 GB, más el PDF de la clase (40 láminas) |
| Problema central | Sincronizar dos cámaras y decidir a quién mostrar | Reconstruir un estudio a partir de la cuadrícula de Meet y limpiar la interfaz |
| Cómo se sabe quién habla | Por el retraso con que la voz de cada uno se cuela en el micrófono del otro | Por el borde celeste con que Meet resalta a quien habla, más la transcripción para las voces sin cámara |
| Qué se ve | Planos abiertos, cerrados, pantalla dividida y reacciones | Panel grande con la lámina o la pantalla compartida, tarjeta de quien habla al lado e índice de capítulos |
| Gráficos | 13 preguntas, 39 citas, 19 piezas fijas (rótulos, barras con QR, pop-ups), 13 ilustraciones | 12 preguntas, 22 citas, 3 rótulos, 9 barras con QR, 3 pop-ups |
| Silencios | Se recortan al final, sobre el video ya montado | Se calculan antes y el render arma todo en un solo paso |
| Salida | 1280x720, 53:43 (versión 4) | 1920x1080, 58:33 |
| Versiones entregadas | v1, v2, v3 sin silencios, v3, v4 | Una versión final, con dos renders previos corregidos |

### Flujo general (común a los dos)

1. **Ingesta**: copiar audio y referencias a una carpeta de trabajo; nunca tocar el original.
2. **Transcripción** con marcas de tiempo, para elegir preguntas, citas y cortes.
3. **Quién habla**: una línea de tiempo con la persona que habla en cada momento.
4. **Lista de tomas**: qué plano va en cada tramo.
5. **Piezas gráficas** con el brand kit 02 (HTML y CSS, capturados con Edge y animados con ffmpeg).
6. **Guion de gráficos**: en qué segundo entra cada pregunta, cita, rótulo, barra o pop-up, con revisión de choques.
7. **Efectos de sonido** sintéticos y canción de intro y cierre.
8. **Silencios y cortes editoriales**.
9. **Render por trozos** con caché por contenido, de modo que una corrección solo vuelve a generar lo que cambió.
10. **Audio**: limpieza, normalización, mezcla con efectos y canción.
11. **Control de calidad** con hojas de cuadros, recortes ampliados y medición de volumen.
12. **Correcciones** que pides y una nueva versión, sin reemplazar la anterior.

---

## 1. Criterios editoriales que pediste y se mantuvieron

Son las reglas que se fueron fijando con tus mensajes. Valen para cualquier edición nueva de este tipo.

- **Talk show literal.** Siempre se ve a quien está hablando. Las reacciones del otro solo aparecen cuando aportan, no por relleno.
- **Lo proyectado es protagonista.** En una clase, la lámina o la pantalla compartida tiene que verse grande y nítida, y la persona que habla, al lado (pedido explícito del taller de Plogy Studio).
- **Nombres correctos.** Si alguien usa una cuenta que no es suya, el rótulo dice su nombre. Marco usaba la cuenta de Plogy, así que su tarjeta dice "MARCO".
- **Datos de marca:** Instagram, TikTok y web `@plogy.xyz` / `plogy.xyz`, LinkedIn y YouTube "Plogy". Juanfra: `@juanframartz`, Founder · Plogy. César: `@cesarmktdeportivo`, Fan Engagement · Inter de Bogotá FC.
- **Brand kit 02** (`C:\Users\juanf\Downloads\plogy-brand-kit-02\plogy-brand-kit`): fuente Plogy Display Bold, naranja `#FF5B00`, tinta `#171310`, esfera con degradado de coral `#F75946` a violeta `#9C5AA7`, cajas negras al 85 %.
- **Barras publicitarias con QR** abajo, como la publicidad de una transmisión de fútbol, que aparecen al menos dos veces cada una. Los QR se recortan intactos de las tarjetas originales y solo se escalan. El de consultoría lleva a la web, no a WhatsApp. Texto de consultoría: "Consultoría para tu empresa. Agenda una consulta gratis con nosotros y conoce nuestros servicios para hacer crecer tu negocio". Sin referencias a Instinct ni sus mockups.
- **Tarjetas tipo noticiero:** cada pregunta queda fija mientras dura el tema; cada cita que resume la conversación aparece debajo unos segundos.
- **Sonido para cada animación:** cada pop-up, tarjeta o ilustración entra con su efecto.
- **Canción de intro y cierre** ("intro song.mp4") con fundido de salida.
- **Más pantallas divididas** para dar dinamismo.
- **Sin silencios:** se recortan las pausas largas.
- **Ilustraciones:** las fotos entran a la derecha del invitado con un "pop" rápido y su sonido; los videos van a tamaño real, sin recortar, enderezados, con color corregido y sobre fondo naranja.
- **Cortes por contenido:** se quita lo que no debe publicarse (en César, el tramo sobre Once Caldas; en el taller, la logística y la foto grupal).
- **Privacidad:** se quita o se tapa todo lo personal de quien grabó (notificaciones del Mac, WhatsApp, escritorio).
- **Nunca se reemplaza el original.** Cada ronda de cambios es un archivo nuevo, y en cada corrección "no se cambia nada más" de lo que pediste.

---

## 2. Herramientas y entorno

| Herramienta | Ruta o detalle | Para qué |
|---|---|---|
| ffmpeg 6.1.1 | `C:\Users\juanf\tools\whisper\Faster-Whisper-XXL\ffmpeg.exe` (no trae ffprobe; la duración se lee del texto de `ffmpeg -i`) | Todo el corte, el filtrado, la codificación y la mezcla |
| Python 3.12 | `C:\Users\juanf\tools\pgsql\pgAdmin 4\python\python.exe` | Scripts de análisis y orquestación |
| Librerías | numpy, scipy, OpenCV (cv2), Pillow, Playwright y pymupdf, instaladas en carpetas `pylib` del scratchpad | Señales de audio, visión, capas, captura de HTML, PDF |
| Navegador | Microsoft Edge en modo headless (`channel='msedge'` en Playwright) | Renderizar las piezas gráficas en HTML con la fuente de marca |
| Transcripción | faster-whisper-xxl (CPU, int8), con marcas por palabra | Elegir preguntas, citas, cortes y voces |
| Máquina | Intel i5-7200U, sin GPU, 7,8 GB de RAM | Obliga a renderizar por trozos y en procesos separados |

Decisiones que vienen de la máquina:

- **Render por trozos con caché.** Cada trozo se guarda con un nombre que depende de su contenido. Si una corrección no lo afecta, no se vuelve a generar. Así un cambio puntual tarda minutos y no horas.
- **Procesos desacoplados.** Los renders largos se lanzan con `Start-Process` (por ejemplo `lanzar.ps1`), escriben un log y sobreviven si se cierra la sesión. Un vigilante revisa el log y avisa al terminar o ante un error real.
- **Codificación** `libx264 -preset veryfast`, CRF 18 a 20, `yuv420p`, 30 fps y la misma base de tiempo en todos los trozos (`-video_track_timescale 15360`), para poder unirlos sin recodificar (`concat`).

---

## 3. Caso 1: César, "IA en deportes"

Carpeta: `C:\Users\juanf\Downloads\Ia en deportes plogycesar`

### 3.1 Material de entrada

- **A, celular de César:** `IMG_1437.MP4`, 59:33, 1280x720.
- **B, iPad de Juanfra:** `IMG_0849.MP4`, 56:59, 1280x720.
- Los dos estaban en la misma videollamada, cada uno grabando su lado para tener mejor audio.
- **Referencias:** carpeta `imagenes ilustrativas` (7 fotos, 5 videos y la imagen del Fan ID), `intro song.mp4` (5,4 s), tarjetas de referencia con QR (comunidad, redes, consultoría) y el brand kit 02.

### 3.2 Paso 1: Sincronizar las dos cámaras

Se extrajo el audio de cada cámara a 16 kHz mono (`cesar.wav`, `juan.wav`).

- **`sync.py`**: calcula la envolvente de cada audio (valor absoluto promediado cada 1 ms) y las correlaciona con FFT. El pico da el desfase global. Después revisa ventanas de 60 s en cinco puntos (minuto 2, 15, 30, 45 y 55) para descartar que un reloj se adelante respecto al otro.
- **`lat.py`**: afina con ventanas de 120 s cada 240 s y muestra los tres mejores picos. También mide los niveles de cada micrófono (percentiles 10, 50, 90 y 99).
- **Resultado:** `OFF = 144.92 s`, es decir, tiempo de A = tiempo de B + 144,92 s. No hubo deriva apreciable. La línea de tiempo maestra es la del iPad (B).

### 3.3 Paso 2: Saber quién habla por la fuga entre micrófonos

**Idea clave.** Como estaban en videollamada, la voz de César llega directo a su micrófono y, con el retraso de la llamada, también sale por el parlante de Juanfra y entra a su micrófono. Con Juanfra pasa lo mismo al revés. **El signo del retraso indica quién es la fuente.** Este método no necesita transcripción ni reconocimiento de caras.

- **`vad.py`**: filtra la voz (pasa banda de 150 a 3.500 Hz), alinea A sobre B, calcula el nivel cada 100 ms (`LA.npy`, `LB.npy`) y hace un histograma de la diferencia de niveles para ver si separa a los dos.
- **`dir.py`**: envolventes logarítmicas cada 5 ms, filtro de 200 a 3.000 Hz. En ventanas de 1,5 s cada 0,25 s busca el retraso entre las dos señales dentro de ±0,45 s. Un retraso negativo significa que habla César (A); uno positivo, que habla Juanfra (B). La correlación sirve como confianza. Guarda `dir.npy`.
- **`explore.py`**: inspección manual de un minuto cualquiera, con la etiqueta, el retraso, la correlación y los niveles.

**Etiquetas** (en `edl.py`, sobre una grilla de 0,25 s):

- **A** si el retraso es menor que -0,1 s y la correlación mayor que 0,45; **B** si el retraso es mayor que 0,1 s.
- **Silencio** si los dos micrófonos están por debajo de su piso (A < 47 dB y B < 34 dB en esa escala).
- **Tercero (X)**: hay sonido con buena correlación pero casi sin retraso (|retraso| < 0,08 s). Es una tercera persona en la llamada, que llega igual a los dos parlantes. Se muestra en pantalla dividida.
- Los huecos se rellenan con la última etiqueta válida. Para el audio solo cuentan A y B (`labels.npy`).

### 3.4 Paso 3: Lista de decisiones de edición (EDL)

`edl.py T0 T1` construye la lista de planos. En el programa final, `T0 = 16.5 s` y `T1 = 3415 s` en el reloj del iPad, es decir 56:38 de programa.

**Reglas:**

1. **Turnos.** Las corridas de un mismo hablante de 2 s o más son un turno. Dos turnos seguidos de la misma persona se funden. El corte se pone donde de verdad empieza a hablar el siguiente.
2. **Reacciones.** Una intervención corta del otro (de 0,5 a 2 s) dentro de un turno ajeno, con al menos 1,5 s de margen a cada lado, es candidata a reacción. Se muestra un plano abierto de quien escucha durante 2 a 3,2 s, empezando 0,25 s antes, y nunca más de una cada 12 s.
3. **Intercambios rápidos.** Si hay 4 o más cambios de hablante en 8 s, ese tramo va en pantalla dividida (mínimo 3 s; tramos a menos de 1 s se unen).
4. **Turnos largos.** Rotan entre plano abierto, plano cerrado y pantalla dividida, unos 13 s, 13 s y 8 s. Cada cambio se pone en la pausa más silenciosa de los dos micrófonos dentro de ±1,5 s (`pause_near`), para que el corte no se note. El plano con que arranca cada persona se alterna entre turnos.
5. **Intro y cierre:** 6 s en pantalla dividida.
6. **Pintado por cuadro** (30 fps): las reglas posteriores mandan sobre las anteriores. Al final, los planos de menos de 1,2 s se funden con el anterior para evitar parpadeos.

**Tipos de plano** (`render.py` de esa etapa):

| Plano | Código | Encuadre |
|---|---|---|
| César abierto | AW | Cuadro completo escalado a 1280x720 |
| César cerrado | AC | Recorte de 1024x576 (acercamiento de 1,25x sobre la cara), escalado a 1280x720 |
| Juanfra abierto | BW | Cuadro completo |
| Juanfra cerrado | BC | Recorte de 1024x576 desplazado a su cara |
| Pantalla dividida | TWO | Dos mitades de 636x720 lado a lado: César a la izquierda, Juanfra a la derecha, con 4 px de separación |

A todo se le aplica una corrección suave: `eq=contrast=1.04:saturation=1.06`.

**Resultado final:** 373 planos: 94 en pantalla dividida, 87 de César abierto, 82 de César cerrado, 67 de Juanfra abierto y 43 de Juanfra cerrado.

Cuando pediste más pantallas divididas (versión 2), se ajustó esta regla de rotación para incluir el plano doble en los turnos largos. `rekey.py` renombró los planos ya renderizados a un nombre por contenido y `diffsegs.py` borró solo los que cambiaban, para reutilizar el resto.

### 3.5 Paso 4: Render del video base

`render.py A.mp4 B.mp4 [hilos]`:

- Cada plano se renderiza a su propio archivo. Se busca el punto exacto en la fuente (`-ss` antes de `-i`) y se pide un número exacto de cuadros (`-frames:v`), así el corte no depende de los keyframes.
- 2 hilos en paralelo. Nombre del archivo: `cuadroInicio_cuadroFin_plano.mp4`.
- Se unen con `concat` sin recodificar y queda `video.mp4` (programa sin gráficos, 1280x720).

### 3.6 Paso 5: Audio que sigue al que habla

`audio.py` mezcla los dos micrófonos:

- **Nivel:** se iguala el micrófono de Juanfra al de César usando la mediana de cada uno mientras habla su dueño.
- **Envolvente** en pasos de 10 ms, con 0,25 s de anticipación (para no comerse la primera sílaba) y fundido cruzado de 80 ms.
- **El micrófono inactivo baja a -24 dB, no a cero**, para no perder risas ni el ambiente de la conversación.
- Salida `mix.wav`. Con esto se entregó la **versión 1**: `IA en deportes - Plogy x Cesar.mp4` (56:38, 30 de octubre).

### 3.7 Paso 6: Piezas gráficas con el brand kit

`rotulos-y-popups\fuente\build.py` arma cada pieza como una página HTML con la fuente de marca, la captura con Edge headless a PNG de 1920x1080 con fondo transparente y la anima con ffmpeg a **ProRes 4444 con canal alfa**. Al principio solo pediste los assets y una descripción de cómo usarlos, sin editar el video.

| Pieza | Archivo | Duración y animación |
|---|---|---|
| Rótulo de Juanfra y de César (nombre, rol e Instagram), abajo a la izquierda | `rotulo-juanfra.mov`, `rotulo-cesar.mov` | 5 s, entra desde la izquierda con fundido |
| Etiquetas de la pantalla dividida (nombre en cada mitad) | `etiquetas-plano-doble.mov` | 5 s, entra desde abajo |
| Pop-up "Síguenos" (tarjeta blanca, botón naranja, redes) | `popup-siguenos.mov` | 7 s, desde la derecha |
| Pop-up compacto "Síguenos @plogy.xyz" | `popup-mini.mov` | 5 s, desde la derecha |
| Tarjeta de intro (fondo naranja, logo negro, "IA EN DEPORTES", "César × Juanfra", "Open Talk · Comunidad Plogy") | `tarjeta-intro.mp4/.png` | Pantalla completa con fundidos |
| Tarjeta de cierre ("Síguenos", handle, redes, web) | `tarjeta-cierre.mp4/.png` | Pantalla completa con fundidos |
| Barra "Únete a la comunidad" con QR (grupo de WhatsApp) | `barra-comunidad.mov` | 12 s, sube desde fuera de cuadro y baja al salir |
| Barra "Sigue a Plogy" con QR (linktr.ee/plogy) | `barra-redes.mov` | 12 s |
| Barra "Agenda una consulta gratis" con QR (plogy.xyz) | `barra-consultoria-web.mov` (la primera versión, `barra-consultoria.mov`, llevaba a WhatsApp) | 12 s |

**QR intactos.** `qr.py` localiza el QR dentro de cada tarjeta original, lo recorta con su zona de silencio, comprueba con OpenCV que se sigue leyendo (`detectAndDecode`) y lo guarda tal cual (`qr-*-original.png`). En la barra solo se escala.

Animación (`animate`): entrada de 0,4 s con curva cúbica y fundido de opacidad, salida de 0,4 s. Las barras entran y salen moviéndose 340 px en vertical con un fundido corto de 0,25 s.

### 3.8 Paso 7: Tarjetas de noticiero (preguntas y citas)

**Transcripción.** Se transcribió el audio del programa (`programa.wav`) con faster-whisper. Con esa transcripción se eligieron a mano las preguntas, las citas y sus tiempos.

**`guion.py`** contiene el guion de gráficos en tiempos del programa:

- **13 preguntas**, cada una con el tramo completo del tema (por ejemplo, de 163,5 a 349 s para "¿Qué estás haciendo hoy en día?"). Encabezado: "Juanfra pregunta", "Pregunta del público" o "Pregunta del chat".
- **39 citas** con quien las dice. Duración de lectura: la frase más 1,5 s, entre 6,5 y 9 s.
- **19 piezas fijas** con su segundo de entrada y su sonido: etiquetas a 0,3 s, rótulo de Juanfra a los 6 s, rótulo de César a los 158 s, barras de comunidad, redes y consultoría repartidas (cada una 3 o 4 veces), pop-up grande 2 veces y mini 4 veces.
- **Revisión de choques:** nada puede coincidir en la franja inferior con una barra, el pop-up grande o un rótulo. Pregunta y cita sí conviven, porque la cita va debajo por diseño.
- Escribe `tarjetas.json` (para el render de las tarjetas) y `plan.json` (para el montaje).

**`noticiero.py`** genera cada tarjeta:

- Abre la tarjeta en Edge con Playwright **cargándola desde archivo** (una página en memoria no puede leer la fuente local) y verifica que Plogy Display cargó; si no, se detiene.
- **Pregunta:** etiqueta naranja "PREGUNTA 01" que entra con barrido, cuerpo oscuro que crece desde la izquierda, línea degradada y texto que sube.
- **Cita:** franja blanca debajo, comillas en un círculo degradado que aparece con rebote, texto y quien lo dice.
- Las animaciones CSS se pausan y se avanzan **cuadro a cuadro** (30 cuadros de entrada en 1 s). Cada cuadro se captura con fondo transparente.
- La salida es la misma entrada al revés y acelerada (0,6 s). En medio se sostiene el último cuadro durante el tiempo exacto del tramo.
- Formato **QuickTime Animation (qtrle) con alfa**: pesa poco porque casi todo el tiempo la imagen está quieta.
- Deja `cronograma.csv` con archivo, pista, inicio, fin, quién y texto.

### 3.9 Paso 8: Efectos de sonido

`sfx.py` sintetiza todos los efectos desde cero con numpy y scipy, así que no hay licencias de por medio. Quedan en `rotulos-y-popups\sfx\` a 48 kHz estéreo:

| Efecto | Cómo suena |
|---|---|
| `pregunta-entra` | Barrido de ruido de noticiero, golpe grave y dos campanas brillantes |
| `pregunta-sale` | Barrido descendente suave |
| `cita-entra` | Tick corto con una campana aguda |
| `rotulo-entra` | Swoosh lateral |
| `popup-entra` | Burbuja (barrido sinusoidal) con campanita |
| `barra-entra` | Subida y tres campanas de "anuncio" |
| `barra-sale` | Barrido descendente |
| `etiquetas-entra` | Doble tick |

### 3.10 Paso 9: Montaje con gráficos (versión 2)

`montaje.py BASE.mp4 PROGRAMA.wav plan.json SALIDA.mp4`:

- **Video:** se parte el programa en trozos en cada entrada o salida de una pieza. Cada trozo se renderiza con las piezas activas superpuestas en orden de capa (0,5 videos ilustrativos, 1 preguntas, 2 citas, 2,5 fotos, 3 piezas fijas).
- **Caché por contenido:** el nombre de cada trozo incluye un hash de qué piezas tiene y cuándo empiezan. Si el plan cambia, solo se rehacen los trozos afectados.
- Intro de 5,4 s y cierre de 6 s a partir de las tarjetas.
- **Audio:**
  - Programa: filtro pasa altos a 80 Hz, compresor 3:1 (umbral -20 dB) y loudnorm a -16 LUFS (pico -1,5).
  - Canción: loudnorm a -17 LUFS, con fundido de 1,6 s en la intro y 2 s en el cierre.
  - Efectos: al 80 % en el momento de entrada de cada pieza (y el de salida 0,6 s antes de que termine).
  - Limitador suave (tanh) si el pico pasa de 0,97.
- Salida AAC a 192 kbps con `faststart`. **Versión 2:** 56:49 (1 de noviembre), con gráficos, efectos, canción y más pantallas divididas.

### 3.11 Paso 10: Recorte de silencios (versión 3 sin silencios)

`silencios.py PROGRAMA.wav plan.json VIDEO.mp4 AUDIO.wav SALIDA.mp4`:

- **Detección:** nivel RMS cada 20 ms, suavizado a 100 ms. Umbral = piso + 0,35 × (voz − piso), con el piso en el percentil 5 y la voz en el percentil 90.
- **Qué se corta:** pausas de **0,6 s o más**, dejando **0,18 s de aire** a cada lado. Las pausas más cortas se respetan porque dan el ritmo natural.
- `--analizar` muestra cuánto se recortaría con distintos valores (de 0,25 a 0,45) antes de decidir.
- **Zonas protegidas:** la intro, el cierre, de 0,2 s antes a 2 s después de cada entrada animada y de 1 s antes a 0,2 s después de cada salida. Los videos ilustrativos se protegen completos, porque un corte adentro se vería como un salto.
- **Cortes editoriales** desde `cortes.json`: tramo de Once Caldas (528,62 a 549,3 s) y despedida logística del final (3.360,7 a 3.390,8 s).
- **Precisión:** los cortes se redondean a cuadros exactos. El audio se corta en las mismas muestras con fundidos de 10 ms para que no chasquee. El video se arma eligiendo cuadros por índice (`select` con `between(n, a, b)`) y renumerando.
- `--mapa` traduce cualquier tiempo del programa al tiempo del video recortado (útil para ubicar momentos después).

### 3.12 Paso 11: Ilustraciones (versión 3)

`ilustraciones.py` genera tres tipos de pieza y escribe `ilustraciones.json` para sumarlas al plan:

- **7 fotos** (las de Ryan Reynolds, "Rob Mc" y Eva Longoria con el Inter, César con el equipo del Effie, Mastercard, una campaña del Inter y la entrevista de radio, según los nombres de archivo). Van en una tarjeta a la derecha de César, siempre sobre un plano de César solo. Borde blanco, línea degradada, sombra y entrada en 0,35 s con rebote, escala desde 0,55 y giro de -4°. Sonido `popup-entra`.
- **5 videos a tamaño real:** el clip completo a 90 % del alto, centrado sobre naranja `#FF5B00`, sin recortar. Cada uno lleva su corrección de color: brillo y gamma para el clip oscuro, curvas para el de perfil plano, y `transpose` para el que venía girado. "Juanfra y César beginnings" va a media velocidad. ProRes 4444 con fundidos de 0,2 s y sonido `rotulo-entra`.
- **1 imagen recorrida:** el post del Fan ID, a pantalla completa sobre naranja. Queda quieta arriba 1 s, baja despacio y queda quieta abajo 1 s, en 16 s.

**Versión 3:** 54:31 (1 de noviembre).

### 3.13 Paso 12: Correcciones finales (versión 4)

Pediste cuatro cambios y "no cambies nada más":

1. El QR de consultoría lleva a la web: se cambió a `qr-consultoria-web-original.png` (plogy.xyz).
2. Se eliminó el tramo de Once Caldas (corte editorial).
3. La foto del Fan ID pasó a ser un recorrido lento de arriba a abajo, ajustado a la pantalla.
4. El video "César con el equipo 3" arranca en el segundo 22, donde aparece César.

`plan_final.json` quedó con 84 piezas: 52 tarjetas de noticiero, 13 ilustraciones y 19 piezas fijas.

**Versión 4 (final):** `IA en deportes - Plogy x Cesar (talk show v4).mp4`, 53:43, 1280x720 (2 de noviembre).

### 3.14 Lo que vino después

- **Descripción para YouTube.**
- **Clips** (`C:\clipwork\iadep\clips.py`): 7 clips (3 de César y 4 de Juanfra) en 16:9, 4:5 y 9:16, con subtítulos según las reglas del brand kit (`subtitulos\plogy_subtitulos.py`). Están en `...\Ia en deportes plogycesar\clips\`.

---

## 4. Caso 2: Taller "Automatiza tu contenido en Instagram"

Carpeta: `C:\Users\juanf\Downloads\plogy studio carruseles`. Scripts en `C:\clipwork\studio\`.

Pediste aplicar "la misma lógica de la de César", con dos prioridades: que se vea quién habla y que lo proyectado se vea "claro y protagónico".

### 4.1 Material de entrada

- `Grabación de pantalla 2026-11-05 a la(s) 7.35.14 p.m..mov`: grabación de la ventana de Meet, 2880x1800, cuadros por segundo variables (unos 37,6 en promedio), 68:27, 8,7 GB.
- `Copia de Masterclass-Plogy.pdf`: las 40 láminas de la clase.
- `Flyer Plogy_ Automatiza tu contenido.png`: de ahí sale el título.
- `Plogy Studio - reels.mp4`: no se usó.

**La diferencia de fondo con César:** aquí no hay cámaras separadas. Todo está dentro de la interfaz de Meet (cuadrícula de participantes, pantalla compartida, barras, botones, notificaciones del Mac). El talk show hay que reconstruirlo recortando y recomponiendo, y la interfaz hay que limpiarla.

### 4.2 Paso 1: Preparación del análisis

En el scratchpad de la sesión (variable `STUDIO_SCR`):

- **Cuadros clave** cada 2 s, reducidos a 1440x900: 2.053 imágenes en `kf\`.
- **Audio** a 16 kHz mono: `audio16.wav` (para silencios y transcripción).
- **Láminas del PDF** a PNG con pymupdf: `pdf\p001.png` a `p040.png`.
- **Transcripción** en 7 partes de 10 min (`tx\p00` a `p06`) con faster-whisper modelo small, int8, marcas por palabra, filtro de voz (VAD), haz de 1 y un texto inicial con los nombres propios ("Plogy, Plogy Studio, Claude, Marco, Luciano, Juanfra, Instagram, carruseles, reels, algoritmo") para que los escriba bien (`tx_rest.ps1`).

### 4.3 Paso 2: Quién habla, a partir del borde celeste de Meet

- **`scan.py`**: en cada cuadro clave busca el borde celeste (aproximadamente `#A8C7FA`) con que Meet resalta a quien habla. Agrupa los píxeles en componentes conectados, se queda con los que tienen forma de recuadro (proporción y tamaño razonables, por encima de la barra inferior) y toma el más grande. Guarda `scan.json`.
- **`tramos.py`**: une detecciones consecutivas del mismo recuadro (tolerancia de 14 px y huecos de hasta 12 s) en tramos de al menos 2 detecciones, y arma hojas de contacto con el recorte de cada tramo y su número.
- **Asignación de nombres a ojo:** con esas hojas se leyó quién estaba en cada tramo y se escribió la tabla índice→nombre (`NOM` en `tomas.py`): Juanfra, Marco, Luciano, José Luis Bedoya, Antonia Manrique, rafa rodríguez y Felipe Valenzuela.
- **`refina`** corrige el borde cuando la insignia de audio de Meet lo parte.
- **Casos medidos a mano:** entre 130 y 147 s Marco cambia de lugar dos veces y solo hay un recuadro resaltado.
- **Voces sin cámara** (`voces.json`, 22 tramos sacados de la transcripción): Pablo Bosch, Byron Ibrahim, Micaela Fernández, Kevin Marciales y Sofía Victoria aparecen con una **tarjeta de marca con su inicial**.
- **Juanfra hablando por el micrófono de Luciano:** Meet resaltaba a Luciano aunque hablaba Juanfra. En esos tramos se muestra una tarjeta con la foto de Juanfra.

### 4.4 Paso 3: Qué se está proyectando

Se definieron tres fases:

| Fase | Código | Tramos (tiempo de la fuente) | Qué se ve |
|---|---|---|---|
| Galería | F | 0 a 147 s, 1.914 a 1.952 s, 3.830 a 3.948 s | La persona grande en el centro |
| Lámina | S | Hasta 1.914 s | La lámina del PDF en el panel, la persona al lado |
| Pantalla compartida | C | Desde 1.914 s (demo de Plogy Studio) | La pantalla compartida en el panel, la persona al lado |

- **`slides.py`**: compara cada cuadro clave con las 40 láminas a 16 escalas (`matchTemplate`), primero en búsqueda gruesa y luego afinando. Si la lámina actual sigue coincidiendo por encima de 0,8, no busca de nuevo. Resultado: 37 de 40 láminas reconocidas con coincidencia de 0,85 a 0,98. Los huecos (menú de Control del Mac, transiciones) se resolvieron a mano (`FIJO` en `tomas.py`).
- **La lámina en pantalla es la imagen original del PDF**, no la captura de Meet. Por eso se lee perfecta.
- **`share.py`**: encuentra el rectángulo de la pantalla compartida comparando contra el color de fondo de Meet. Ese rectángulo se ajusta a uno de tres tamaños fijos (P1, P2, P3) para que el encuadre no tiemble con el ruido de la detección.

### 4.5 Paso 4: Lista de tomas (`tomas.py`)

- Por cada segundo se decide la fase, la persona y su recuadro, si es voz sin cámara, la lámina o el tamaño de la pantalla compartida, y si hay "píldora" de Meet encima (ver 4.8).
- Los segundos iguales se funden en una toma.
- Una toma de menos de 3 s de otra persona (una interjección o ruido) se absorbe en la anterior, para evitar parpadeos.
- Al cambiar de fase, la primera toma usa el recuadro de la siguiente, porque el anterior ya no vale.
- **Cámara vertical de Juanfra:** Meet la rellena con franjas grises, así que se recorta el centro.
- En tramos con cursor o tooltip sobre Luciano se usa su foto limpia.
- Salida: `tomas.json` con 166 tomas. Después de las correcciones de control de calidad (`aplica_trans.py`) quedaron 174.

### 4.6 Paso 5: El escenario (`layers.py`)

Lienzo de 1920x1080:

- **Fondo:** oscuro de marca (`#100D0C`) con dos resplandores suaves coral y violeta y un grano finísimo que evita bandas en el degradado.
- **Panel de contenido protagonista:** arriba a la izquierda, en (30, 30) y de 1422x800, con esquinas de radio 16 y sombra. Ahí va la lámina o la pantalla compartida, ajustada sin recortar.
- **Columna derecha:** desde x = 1476, 414 px de ancho.
  - **Tarjeta de quien habla:** respeta la proporción del recuadro de origen, con un máximo de 430 px de alto.
  - **Franja de nombre sólida** abajo de la tarjeta, con nombre en blanco y rol en naranja. **Tapa la etiqueta de Meet**: por eso "Plogy" pasa a decir "MARCO". Tiene que ser opaca; con cualquier transparencia se leía la etiqueta original debajo.
  - **Índice "EN ESTA CLASE"** con los 8 capítulos de `agenda.json` (Bienvenida, El algoritmo, Lo que premia, Constancia e IA, Plogy Studio, Por dentro, Video y campañas, Publicar en vivo). El capítulo actual va resaltado en naranja.
  - **Logo** blanco de Plogy abajo a la derecha.
- **Modo galería (F):** la persona grande y centrada, hasta 1422x800.
- **Tarjeta de voz:** degradado de marca con la inicial en un círculo naranja, o la foto de la persona (`luciano2.png`, `juanfra2.png`).
- **Cómo se compone:** la capa es un PNG con **huecos transparentes** donde va el video. El render pone el video debajo y la capa encima. Cada capa se guarda con un nombre por contenido (se reutiliza entre renders) y se escribe de forma atómica.

### 4.7 Paso 6: Gráficos (`guion.py` y `assets.py`)

Es el mismo sistema que en César, adaptado al escenario:

- **12 preguntas** (encabezados "Marco pregunta", "Juanfra pregunta", "Pregunta del público"), cada una durante todo su tema.
- **22 citas** de Marco, Luciano, Juanfra y Kevin. Duración: 3 s más 0,07 s por carácter, entre 6,5 y 8,5 s. El script avisa si una cita pasa de 66 caracteres.
- **3 rótulos:** Juanfra con `@juanframartz` a los 4 s, Marco a los 133 s y Luciano a los 1.928 s, los dos con rol "Plogy".
- **9 barras con QR:** comunidad, redes y consultoría, 3 veces cada una. Se usan los mismos QR originales recortados para César, con consultoría apuntando a plogy.xyz.
- **3 pop-ups mini**, reutilizados del video de César.
- **Ubicación:** preguntas y citas en la franja inferior, debajo del panel. En la barra, el QR sube por la columna derecha y nunca tapa el contenido.
- **Tiempos de salida:** como los silencios se recortan antes, la duración de cada pregunta se convierte a tiempo de salida con el mapa de `keep.json`.
- **Revisión de choques** en la franja inferior: 0 choques.
- `assets.py` captura cada pieza con Playwright y Edge, cuadro a cuadro como en el noticiero de César, y guarda una firma (`.sig`) para no regenerar piezas que no cambiaron. `assets.py fijas` hace la tarjeta de intro: "AUTOMATIZA TU CONTENIDO EN INSTAGRAM", "MARCO × LUCIANO × JUANFRA", "TALLER · COMUNIDAD PLOGY". El cierre es la tarjeta de marca del video de César.

### 4.8 Paso 7: Limpieza de la interfaz de Meet

Es la parte más trabajosa del caso, porque hay que borrar todo lo que delata a Meet dentro de los recuadros recortados.

**Insignia de audio** (arriba a la derecha de cada recuadro): se borra con `delogo`. Donde el fondo era liso y había un logo pegado a la insignia (José Luis), se tapó con un rectángulo del color exacto del fondo, calibrado a mano (`0x1A362C`).

**Aro azul de "está hablando":** asomaba por las esquinas redondeadas. Se detectó con `qa_aro.py` y `qa_aro3.py` y se resolvió con un recorte mínimo que conserva la proporción (`ins`: 9 px en recuadros anchos, 6 px en los demás). `delogo` no sirve en esquinas porque interpola desde el borde del cuadro.

**Píldora de hover** (los botones pin, micrófono y menú que Meet dibuja cuando el cursor pasa sobre un recuadro). Apareció sobre Luciano durante casi toda su demo, sobre Juanfra al inicio, y en tramos de Marco y Antonia.

- **Primer intento:** asumir 50 % de opacidad, aclarar ×2, borrar los iconos y mezclar con una máscara. Dejó anillos visibles. Se descartó.
- **Solución (`limpia.py`):**
  1. **Modelo físico:** la píldora es una capa oscura semitransparente, I' = g·I + (1 − g)·c. Se midió en el propio video comparando por cuantiles los píxeles justo adentro y justo afuera del borde: **g = 0,35 (65 % de opacidad)** y color **c = YUV(45, 129, 127,5)**, iguales en los tres recuadros. Tamaños: 176x88 px (Luciano: pin y menú) y 264x88 px (Marco, Juanfra y Antonia: pin, micrófono y menú).
  2. **Rastreo cuadro a cuadro** con una plantilla de alto contraste de los iconos (correlación normalizada). Se descartan las zonas planas, donde la correlación da 1,0 sin significar nada (filtro por varianza).
  3. **Reconstrucción:** se invierte la fórmula en el interior, se invierte también la sombra que la píldora proyecta 3 px hacia abajo (perfil medido × 0,85), se suaviza un poco lo reconstruido y se rellenan el anillo del borde y los iconos desde sus vecinos (inpainting Telea).
  4. Se trabaja en planos YUV 4:4:4 para no introducir errores de conversión de color. Las pistas limpias se codifican casi sin pérdida (x264 CRF 13) en `C:\clipwork\studio\limpio\`.
  5. El tamaño del recorte nunca cambia (`np.clip`), porque un cuadro más corto desfasaba todo el video siguiente.
  6. Umbral de detección 0,8 cuando la píldora se mueve y 0,62 cuando el recuadro está fijo (posición conocida).
- **10 trabajos** de limpieza: `luciano`, `luciano0`, `luciano1`, `marco`, `marco2`, `marco3`, `juanfra`, `juanfra0`, `juanfra1` y `antonia`.
- **Resultado:** el residuo es de alrededor de 1 %. Casi no se ve, pero no es perfecto, porque los recuadros de origen son pequeños (unos 244x296 px).

**Cuadros fijos ("fijas").** Durante los reacomodos animados de la cuadrícula de Meet y cuando aparecían notificaciones del Mac sobre un recuadro (La República, Gmail, WhatsApp, el Centro de notificaciones), se mantiene el último cuadro bueno. Son 52 tramos que suman 45,9 s. El más largo dura 5,6 s, hacia el minuto 10:57 del video final, porque quien grabó abrió el Centro de notificaciones con su WhatsApp personal encima del recuadro de Juanfra. La lista está en `fijas.json`, generada por `aplica_trans.py`.

**Escritorio privado** (3.887,5 a 3.889,3 s): se congela el último cuadro de Meet. Además ese momento cae dentro del corte de la foto grupal.

### 4.9 Paso 8: Silencios y cortes editoriales

Se usa el mismo criterio que con César (pausas de 0,6 s o más, 0,18 s de aire, umbral al 35 %), pero **antes** del render: `render.py plan` escribe `keep.json` con los tramos que se conservan.

Cortes editoriales (`cortes.json`):

- 1.882 a 1.925 s: logística, Pablo cambia de dispositivo.
- 3.825 a 3.937 s: logística, foto grupal.

La grabación termina a los 67:43, cuando Felipe está en mitad de una frase, y empieza también a mitad de frase ("Francisco Martínez, fundé Plogy").

**Resultado:** de 67,7 min quedan 58,4 min de programa.

**Mapa de tiempos.** Cualquier momento de la fuente se traduce a tiempo de salida con la suma acumulada de los tramos conservados: salida = 5,4 s de intro + cuadro de salida / 30. Ese mismo mapa se usó después para cortar los clips.

### 4.10 Paso 9: Render en un solo paso (`render.py`)

`render.py todo` hace las tomas, los silencios, el escenario y los gráficos de una vez:

1. **Trozos.** Cada tramo conservado se parte en cada cambio de toma, de capítulo, de cuadro fijo o de privacidad, y en cada entrada o salida de una pieza gráfica. Quedaron unos 800 trozos.
2. **Cada trozo** se arma así:
   - fondo de color;
   - video de la fuente desde el punto exacto;
   - la pantalla compartida recortada y escalada a su ventana del panel;
   - el recuadro de la persona, recortado de la fuente o tomado de la pista limpia, sin insignia ni aro y escalado a la tarjeta;
   - encima, la capa PNG del escenario;
   - encima, las piezas gráficas activas en su orden de capa y con su desfase.
   - Salida con espacio de color BT.709 explícito.
3. **Caché:** el nombre de cada trozo es el hash de su firma (tiempo, duración, toma, capítulo, piezas, versión de limpieza, cuadro fijo). Una corrección solo regenera los trozos que cambian.
4. **Orden:** primero se generan todas las capas en serie y después se renderizan los trozos con 3 hilos. En paralelo, dos hilos llegaban a escribir el mismo PNG a la vez.
5. **Proceso desacoplado** con `lanzar.ps1`, log en `render.log` y vigilante que solo se detiene ante `listo`, `Traceback`, `CalledProcessError`, `chunk too big` o `PermissionError`.
6. **Audio:** el programa (pasa altos a 80 Hz, compresor 3:1, loudnorm a -16 LUFS) se corta en las mismas muestras que el video, con fundidos de 10 ms. Se suman la canción de intro y cierre con fundido y los efectos al 70 %, y un limitador suave.
7. Se unen intro, trozos y cierre (`concat` sin recodificar) y se mezcla con el audio en AAC a 192 kbps.

Salida: `Plogy Studio - Automatiza tu contenido en Instagram (talk show).mp4`, 58:33, 1920x1080, unos 470 MB.

### 4.11 Paso 10: Control de calidad

Hubo varios renders completos. Cada uno se revisó y se corrigió antes del siguiente; gracias a la caché, los últimos solo regeneraron los trozos afectados.

| Script | Qué revisa |
|---|---|
| `qa_final.py` | Duración de video y audio (esperado 3.513,47 s, iguales) y hoja de 32 cuadros repartidos en todo el video |
| `qa_zoom.py x,y,w,h t...` | Recortes a resolución completa de una zona en varios momentos (píldoras, franjas de nombre) |
| `qa_tiles.py`, `qa_tomas.py` | Hoja con un cuadro por toma, para ver encuadre y nombre de cada una |
| `qa_aro.py`, `qa_aro2.py`, `qa_aro3.py`, `qa_esquina.py`, `qa_azul.py` | Restos del aro azul de Meet en las esquinas |
| `qa_pill.py`, `qa_pill2.py`, `marca_limpio.py` | Píldoras sueltas en tomas que no pasaron por la limpieza |
| `qa_limpio.py`, `perfil.py` a `perfil3.py` | Huecos de rastreo de la píldora y perfil de la sombra residual |
| `qa_trans.py`, `qa_trans2.py`, `qa_salto.py`, `qa_salto2.py`, `qa_bordes.py` | Transiciones de Meet, saltos y bordes en los cambios de toma |
| `qa_fijas.py`, `qa_cerca.py`, `qa_ver.py`, `ver.py` | Revisión de cada cuadro fijo y de tarjetas a tamaño real |
| `render.py muestra T` | Un cuadro del resultado final en el momento T, sin renderizar todo |

**Resultado final:** duración 58:33 con video y audio iguales, -15,7 LUFS integrados, pico real -0,5 dBFS, sin aro azul. Quedan algunos falsos positivos conocidos en la búsqueda de píldoras (manos o contenido azul de participantes).

### 4.12 Problemas que aparecieron y cómo se resolvieron

| Problema | Causa | Solución |
|---|---|---|
| La franja de nombre dejaba leer "Plogy" o el nombre completo de Meet | Tenía 2 % de transparencia | Franja 100 % opaca |
| Nombre equivocado hacia los 136 s | Marco cambió de lugar y la galería termina a los 147 s | Tramos medidos a mano |
| Juanfra hablaba y aparecía Luciano | Usaba el micrófono de Luciano | Tramos de voz desde la transcripción, con la foto de Juanfra |
| Kevin y Pablo sin detectar | Bordes de otro color o cámara apagada | Regla de color más amplia y tarjetas de voz |
| Anillos donde estaba la píldora | Opacidad supuesta (50 %) incorrecta | Medición real (65 %) e inversión con sombra (`limpia.py`) |
| Línea en el borde inferior de la píldora | Sombra de la píldora | Inversión de la sombra con el perfil medido |
| Cientos de falsos positivos en el rastreo | Correlación de 1,0 en zonas planas | Filtro por varianza |
| Costura y desfase en una pista limpia | Un cuadro más corto durante una animación de Meet | Tamaño de recorte fijo |
| Aro azul en las esquinas | Esquinas redondeadas de Meet | Recorte mínimo proporcional |
| Notificaciones del Mac y reacomodos de Meet sobre los recuadros | Interfaz de quien grabó | Cuadros fijos |
| Error "chunk too big" en el render | Dos hilos escribiendo el mismo PNG | Escritura atómica y capas generadas en serie antes de los hilos |
| `PermissionError` al reemplazar un archivo | Windows no deja reemplazar un archivo abierto por ffmpeg | Lo mismo: capas pregeneradas |
| JSON que no se leía | BOM que agrega PowerShell al guardar en UTF-8 | Leer con `utf-8-sig` |
| Renders que morían al cerrarse la sesión | Procesos hijos de la sesión | Procesos desacoplados con `Start-Process` |

### 4.13 Lo que se te señaló antes de publicar

- Lo que se quitó: logística, foto grupal (con el escritorio privado), y que el video empieza y termina a mitad de frase.
- Datos visibles en la demo: correo de la cuenta, métricas del panel de administración (empresas, usuarios, tokens, costo) y prefijos enmascarados de llaves. Se ofreció difuminarlos.
- El tramo en que Luciano explica el uso de un setup-token de Claude Code en la app y sus costos (3.133 a 3.200 s de la fuente), para que lo revises.
- Supuestos: rol "Plogy" para Marco, Luciano y Antonia; "Kevin Marciales" acortado desde la etiqueta de Meet; atribución de voces según la transcripción; no se usa el apellido de Marco (solo aparecía en un WhatsApp privado).
- Imperfecciones: costura de la reconstrucción en Luciano, cuadros fijos (el más largo de 5,6 s) y el brazo de José Luis recortado por el parche durante unos 2,6 s cerca del minuto 56.

### 4.14 Lo que vino después: clips verticales

`C:\clipwork\clipper\clips916.py` sacó 12 clips del talk show, sin subtítulos, cada uno en tres versiones 9:16:

- **Dividida:** arriba el panel, abajo quien habla.
- **Tamaño real:** el cuadro 16:9 completo sobre naranja.
- **Cambiante:** alterna entre la persona a pantalla completa y la dividida, cortando en las pausas.

Están en `...\plogy studio carruseles\clips\`, con sus captions en `.md`.

---

## 5. Qué se reutilizó de César en el taller y qué cambió

**Se reutilizó tal cual:**

- El criterio de silencios (0,6 s / 0,18 s / 35 %).
- Los efectos de sonido (`rotulos-y-popups\sfx\`).
- La canción de intro y cierre.
- La tarjeta de cierre y el pop-up mini.
- Los QR originales recortados.
- El sistema de tarjetas de noticiero (HTML, captura cuadro a cuadro, entrada y salida invertida, qtrle con alfa) y su estilo.
- La idea de render por trozos con nombre por contenido.

**Cambió:**

| | César | Taller |
|---|---|---|
| Momento del recorte de silencios | Al final, sobre el video montado (re-codifica todo) | Al inicio: el plan de tiempos se calcula antes y el render arma todo en un paso |
| Duración de los gráficos | En tiempo del programa | En tiempo de salida, ya sin silencios |
| Resolución | 1280x720 (la de las cámaras) | 1920x1080 |
| Composición | Plano de cámara a pantalla completa con gráficos encima | Escenario de marca con panel, tarjeta, índice y gráficos en la franja inferior |
| Limpieza de imagen | No hizo falta | La mayor parte del trabajo (píldora, aro, insignia, notificaciones) |

---

## 6. Cómo repetir el proceso con una grabación nueva

### 6.1 Qué preguntar antes de empezar

1. ¿Son cámaras separadas (como César) o una grabación de Meet (como el taller)?
2. Nombres, roles y handles de cada persona, y si alguien usa una cuenta ajena.
3. Título del programa y texto de la intro.
4. Qué QR y CTA van en las barras, y a dónde lleva cada QR.
5. Qué tramos no se pueden publicar (temas sensibles, logística, datos privados).
6. Material de apoyo: PDF de la presentación, fotos y videos ilustrativos, canción.

### 6.2 Tipo A: dos o más cámaras locales

1. Extraer el audio de cada cámara a 16 kHz mono.
2. Sincronizar por correlación de envolventes (`sync.py`, `lat.py`) y revisar la deriva.
3. Etiquetar quién habla por el retraso de fuga entre micrófonos (`dir.py`); con cámaras en la misma sala, donde no hay retraso de llamada, usar el nivel relativo de cada micrófono (`vad.py`).
4. Construir la EDL (`edl.py T0 T1`) y revisar los porcentajes de cada plano.
5. Renderizar el video base (`render.py`) y mezclar el audio que sigue al que habla (`audio.py`).
6. Transcribir, escribir el guion de gráficos (`guion.py`), generar piezas (`build.py`, `noticiero.py`, `ilustraciones.py`) y efectos (`sfx.py`).
7. Montar (`montaje.py`), recortar silencios (`silencios.py`) y revisar.

### 6.3 Tipo B: grabación de Meet

1. Sacar cuadros clave cada 2 s, el audio a 16 kHz y las láminas del PDF.
2. Transcribir por partes con los nombres propios en el texto inicial.
3. Detectar el borde de quien habla (`scan.py`, `tramos.py`) y asignar nombres con las hojas de contacto.
4. Reconocer láminas (`slides.py`) y la pantalla compartida (`share.py`), y definir las fases.
5. Armar las tomas (`tomas.py`) y las voces sin cámara (`voces.json`).
6. Calcular silencios y cortes (`render.py plan`), escribir el guion de gráficos (`guion.py`) y generar las piezas (`assets.py`).
7. Revisar hojas de cuadros buscando píldoras, aros, notificaciones y nombres equivocados. Limpiar con `limpia.py` y registrar cuadros fijos.
8. Probar momentos sueltos con `render.py muestra T` y luego lanzar el render completo desacoplado.
9. Control de calidad (sección 4.11) y reporte con todo lo que necesita tu decisión.

### 6.4 Reglas prácticas

- Trabajar siempre sobre copias y en rutas sin espacios cuando ffmpeg tenga que leer subtítulos o listas.
- Cortar con `-ss` antes de `-i` y un número exacto de cuadros; nunca copiar el stream si importa la precisión.
- Cargar el HTML de las piezas desde archivo y verificar que la fuente de marca cargó.
- Guardar JSON en UTF-8 sin BOM, o leer con `utf-8-sig`.
- Ante cualquier cambio de plan, confiar en la caché: no borrar trozos a mano salvo que cambie su contenido sin cambiar su firma (en ese caso, subir la versión en la firma).
- Antes de entregar, revisar a tamaño real los momentos de riesgo, no solo la hoja general.

---

## 7. Inventario de archivos

### 7.1 César

| Ruta | Contenido |
|---|---|
| `Downloads\Ia en deportes plogycesar\` | Videos originales, versiones v1 a v4, `intro song.mp4`, `imagenes ilustrativas\`, `clips\` |
| `...\rotulos-y-popups\` | Piezas en MOV con alfa, tarjetas de intro y cierre, `noticiero\` (tarjetas y `cronograma.csv`), `ilustraciones\`, `sfx\` |
| `...\rotulos-y-popups\fuente\` | `build.py`, `qr-*-original.png`, `guion.py`, `noticiero.py`, `tarjetas.json`, `plan.json`, `plan_final.json`, `ilustraciones.py`, `ilustraciones.json`, `sfx.py`, `montaje.py`, `silencios.py`, `cortes.json` |
| `C:\Users\juanf\AppData\Local\Temp\claude\c--Users-juanf-Downloads-plogy-screenrecorder-\e6ecdb93-4a9c-4d3c-88f7-fcd7dec2ecf7\scratchpad\` | Sincronización y EDL: `sync.py`, `lat.py`, `vad.py`, `dir.py`, `explore.py`, `edl.py`, `rekey.py`, `diffsegs.py`, `render.py`, `audio.py`, `qr.py`; datos `edl.json`, `labels.npy`, `dir.npy`; video base `video.mp4`, audio `mix.wav`, transcripción en `tx\`, librerías en `pylib\` |
| `C:\clipwork\iadep\` | Clips: `clips.py`, `cortes.json` |

### 7.2 Taller Plogy Studio

| Ruta | Contenido |
|---|---|
| `Downloads\plogy studio carruseles\` | Grabación original, PDF, flyer, video final, `clips\` |
| `C:\clipwork\studio\` | `tomas.py`, `layers.py`, `guion.py`, `assets.py`, `limpia.py`, `render.py`, `aplica_trans.py`, `marca2.py`, scripts `qa_*.py`, `lanzar.ps1`, `lanzar_limpia.ps1`; datos `tomas.json`, `voces.json`, `cortes.json`, `agenda.json`, `cards.json`, `plan.json`, `keep.json`, `fijas.json`, `aro.json`, `aro3.json`; carpetas `piezas\`, `layers\`, `limpio\`, `trozos\` |
| `C:\Users\juanf\AppData\Local\Temp\claude\cefbcda08ec4871f\e6ecdb93-4a9c-4d3c-88f7-fcd7dec2ecf7\scratchpad\` | Análisis: `kf\` (cuadros clave), `pdf\` (láminas), `tx\` (transcripción), `audio16.wav`, `scan.py`, `tramos.py`, `slides.py`, `share.py`, `pilltrack.py`, `tx_rest.ps1`; datos `scan.json`, `tramos.json`, `slides.json`, `share2.json` |
| `C:\clipwork\clipper\` | Clips verticales: `clips916.py`, `cortes.json`, `textos.py`, transcripción en `tx\` |

### 7.3 Riesgo: dependencias en carpetas temporales

Parte del proceso vive en carpetas temporales de Claude Code (`AppData\Local\Temp\claude\...`):

- En César, la sincronización, la EDL, el video base y el audio mezclado.
- En el taller, los cuadros clave, las láminas, la transcripción y los datos de detección.
- Las librerías de Python (`pylib`) de las dos sesiones.

Los scripts de `C:\clipwork\studio` necesitan las variables `STUDIO_SCR` y `STUDIO_OLD` apuntando a esas carpetas. **Si Windows o Claude Code limpian los temporales, no se puede volver a renderizar sin rehacer el análisis.** Antes de borrar nada conviene mover esas carpetas a `C:\clipwork\` y actualizar las rutas.

---

## 8. Límites conocidos

- **Calidad de origen.** En el taller, los recuadros de las personas vienen de Meet en baja resolución (unos 244x296 px en la fuente), así que las caras se ven suaves cuando se agrandan. En César, la salida quedó en 1280x720 porque esa era la resolución de las cámaras.
- **Cuadros fijos.** Tapan notificaciones y transiciones, pero los más largos (5,6 s) pueden notarse.
- **Reconstrucción de la píldora.** Residuo cercano al 1 %. En pantalla grande puede verse una costura en el recuadro de Luciano entre los minutos 37 y 52.
- **Contenido sensible.** Las demos pueden mostrar correos, métricas internas o llaves. Hay que revisarlas antes de publicar, aunque el proceso ya marque lo que encuentra.
- **Asignación de nombres.** La lectura de nombres en las hojas de contacto y la atribución de voces sin cámara se hacen a ojo y con la transcripción. Conviene que alguien que estuvo en la sesión lo confirme.
