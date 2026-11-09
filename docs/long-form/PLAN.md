# Long-form: plan

Plan del 2026-11-08 para construir Long-form dentro de Plogy Studio, en la rama local `long-form`. Aprobado; las
fases 2 a 4 están construidas en local (ver Estado). Nada está desplegado.

Fuentes: los documentos de Studio (README, MOTOR, FLUJO, ONBOARDING, MARCAS, ITERACIONES, PANEL-ADMIN), su código
y el motor de `plogy-longform` (README, ARQUITECTURA, docs/PROCESO-ORIGINAL, `worker/editor`, `supabase/schema.sql`).
Cada afirmación sobre el código lleva su archivo.

---

## 0. Lo que hay que decidir antes de la fase 2

Son las cosas que cambian el trabajo o que cuestan dinero. Va mi recomendación en cada una.

| # | Decisión | Por qué importa | Recomiendo |
|---|---|---|---|
| D1 | **Base local.** `supabase/schema.sql` no construye la base desde cero: crea índices antes que sus columnas (`schema.sql:79`, `:91-95`), se quedó en el 24 de octubre y `scheduler.sql` necesita migraciones posteriores. No hay ningún script de base local | Sin base local no hay build, ni pruebas, ni la prueba de que con las banderas apagadas nada responde | Sacar el esquema de producción en modo solo lectura (`pg_dump --schema-only`, sin datos) y usarlo como base local, más las migraciones nuevas encima. Lo corres tú con la cadena de conexión, o me la das para correrlo una vez. La alternativa es rehacer `schema.sql` a mano (ya está pendiente en ITERACIONES), que es más lenta y puede no coincidir con producción |
| D2 | **Supabase Storage en producción.** El plan gratis limita cada archivo a 50 MB y el total a 1 GB (PANEL-ADMIN). La grabación del taller pesa 8,7 GB | La subida de un video largo no entra en el plan actual | Plan Pro antes de abrir la beta, con el límite por archivo subido a 20 GB. En local no hace falta: el límite se configura |
| D3 | **Cuentas pagas: Modal y Groq.** | El motor corre en Modal; la transcripción rápida en Groq | Crear las dos cuando lleguemos a la fase 3. Mientras, todo corre en modo local |
| D4 | **Dónde se llama a Claude.** El motor hoy llama a Claude desde Python con su propia clave. Studio tiene la clave por cuenta, la clave de plataforma con tope, los modelos por agente y el registro de consumo en `llamarClaude` (`src/engine/claude/messages.ts`) | Duplicarlo en Python es copiar el manejo de secretos, el tope y las rarezas del token OAuth, y se desincronizan | Las etapas de Claude (nombres, guion, mapa de ideas, propuestas, captions) corren **en Studio**, por `llamarClaude`, como un trabajo más de `lf_trabajos`. El motor solo hace video y audio. Las reglas que hoy aplica el motor sobre la propuesta (verificar citas, piezas fijas) siguen en Python |
| D5 | **La tarjeta "Crear empresa" que ya existe.** El encargo dice que hoy nadie puede crear una segunda marca, pero `nuevaEmpresa` (`src/app/configuracion/empresa/actions.ts:102`) ya lo permite desde Configuración > Empresa, sin bandera | Si queda como está, "marcas múltiples" ya está abierto en producción | Dejarla igual (regla: lo que ya hace Studio sigue igual) y que Mis marcas, la copia de lo común y el nuevo recorrido vayan detrás de `marcas_multiples`. Si prefieres esconder también la tarjeta, es una línea |
| D6 | **El ítem con candado se verá en producción.** El encargo pide que quien no tenga la función vea Long-form con candado y un paywall | Al desplegar, todas las cuentas verán un ítem nuevo, aunque no puedan usarlo | Así, tal cual lo pide el encargo. Lo dejo dicho porque es lo único nuevo que se ve en producción |
| D7 | **Modo oscuro.** `globals.css` tiene un bloque `.dark`, pero nada lo enciende: Studio no tiene modo oscuro en uso | El encargo pide verificar en claro y en oscuro | Las pantallas nuevas usan solo los tokens, así que el modo oscuro sale gratis. Las capturas en oscuro se toman poniendo la clase `.dark` a mano, en Studio y en Long-form por igual. No agrego un interruptor de tema: cambiaría Studio |
| D8 | **Música y efectos: MP3 y WAV** (pedido 2026-11-08, cambia la regla del encargo). | Los efectos del preset de Plogy son WAV | Se aceptan los dos. Se valida igual en tres sitios: navegador (extensión y tipo), servidor (firma `ID3`/sincronía de cuadro MP3, o `RIFF....WAVE`) y motor (`ffprobe`: `mp3` o `wav`). La intro del preset, que es `.mp4`, se convierte a MP3 |
| D9 | **Publicar en YouTube.** El motor y su app provisional lo tienen | El encargo no lo menciona | Queda fuera. El código se conserva en el motor sin conectarlo |

### Estado

**Fase 2 hecha (2026-11-08), en local:**
- **Base local:** `long-form/local/armar-base.ps1`.
- **Banderas:** paywall, `/admin/funciones` y la tarjeta de cada empresa.
- **Mis marcas:** la primera marca es gratis; desde la segunda, paywall. Se puede copiar lo común y la conexión de
  Claude.
- **Marca:** dividida en dos grupos. Short form se movió a Marca.
- **Estilo long form:** con vista previa y onboarding. El preset de Plogy se importa con
  `scripts/longform-importar-preset.ts`.
- **Pruebas:** `funciones`, `longform-estilo`, `longform-banderas` y la prueba en vivo `longform-banderas-vivo`.

**Fase 3 (2026-11-08), en local:**
- **Dónde quedó el motor:** en `long-form/motor`, con la migración `2026-11-08-long-form.sql` (proyectos,
  archivos, cola, eventos, avisos, ideas, piezas y envíos).
- **Claude:** el puente pasa por `/api/long-form/ia`.
- **Plantillas compartidas:** Python y TypeScript dan el mismo HTML, con prueba.
- **Paralelo:** gráficos en varios Chromium y transcripción por Groq cuando haya clave.
- **Niveles de esfuerzo y costo por etapa:** funcionando.
- **Servidor local:** `/despertar` local listo. `modal_app.py` está listo, sin probar.
- **Medido en esta máquina** (2 núcleos), 6 minutos de dos cámaras en Rápido, sin Claude ni Groq:

  | Etapa | Tiempo |
  |---|---|
  | Ingesta | 34 s |
  | Análisis | 64 s |
  | Transcripción (faster-whisper) | 454 s |
  | Plan | 24 s |
  | Gráficos | 93 s |
  | Render | 602 s |
  | Control de calidad | 115 s |
  | **Total** | **23 min** |

  El control de calidad salió limpio.

**Lo que cambió respecto al plan al construir:**
- **Paralelo en Modal:** cada etapa corre en un contenedor grande y reparte su trabajo en hilos (trozos del
  render, Chromium por hilo, partes de transcripción), en vez de repartir entre contenedores con `.map`. Es más
  simple y los trozos del render no se mueven entre máquinas. Si con 32 núcleos no se llega a la meta, el siguiente
  paso es repartir el render entre contenedores.
- **Clips:** no se renderizan con el largo (`opciones.clips = 0`); salen de Difusión.
- **Personas recurrentes:** viven dentro de `lf_estilos.config`, no en una tabla `lf_personas`.
- **Plantillas de los gráficos:** quedaron en `long-form/plantillas` como HTML y CSS con huecos. Studio y el motor
  las usan.

**Fase 4 hecha (2026-11-09), en local:**
- **Pantallas:** inicio (tablero), nuevo video, proyecto con su paso a paso, quién es quién, guion, video listo
  (control de calidad, versiones, Corregir, título, descripción y capítulos para copiar) y la campana de avisos.
  El ítem Long-form del menú del chat lleva un punto cuando hay avisos sin leer.
- **Subidas:** por TUS directo a Storage, reanudables, vivas mientras la pestaña esté abierta.
- **Errores:** el paso que falló se marca en la barra, el mensaje es para la persona (el detalle técnico va plegado)
  y Reintentar retoma desde ese paso. Un reporte de avance que falla ya no tumba la etapa.
- **Probado en el navegador** (`scripts/longform-e2e.ts`, con capturas a 1440 y 390 px), cortes de 2 minutos de
  dos cámaras, sin Claude ni Groq:

  | Nivel | Paradas | Resultado |
  |---|---|---|
  | Detallado | quién es quién y guion | video listo en 14 min, control de calidad limpio |
  | Normal | quién es quién (nombres sin confirmar) y guion | el render falló por un tiempo de espera de la base local con la máquina cargada; Reintentar lo terminó |
  | Rápido | ninguna | video listo en 7,5 min, control de calidad limpio |

- **Pendiente para la fase 6:** la pestaña Difusión es un espacio reservado.

### Decisiones tomadas (2026-11-08)

- **D1.** Se saca el esquema de producción en solo lectura y es la base local. Antes de desplegar, las migraciones
  nuevas se prueban contra ese esquema recién sacado, para que lo que funciona en local funcione en producción.
- **D2.** Plan Pro de Supabase para la beta. En local no hace falta.
- **D3.** Por ahora todo en local: sin Modal ni Groq. El código queda listo para los dos. Cómo lo prueba la gente:
  sección 12, por decidir.
- **D4.** Aprobado: Claude corre en Studio, por `llamarClaude`, con las claves, el tope y el registro de cada cuenta.
  No es el CLI: es la misma llamada a la API que Studio ya hace.
- **D5.** Cambia: "Crear empresa" pasa a llamarse "Crear marca". La primera marca de cada persona es gratis. Al crear
  otra marca aparece el paywall de `marcas_multiples`, también en la tarjeta que ya existe en Configuración.
- **D6.** Aprobado: "Usar la misma conexión de Claude que <marca>" al crear una marca.
- **D8.** MP3 y WAV.
- **Después:** conectar otros modelos además de Claude (Gemini, ChatGPT). Fase 8.

---

## 1. Lo que hay y lo que se respeta

**Studio**
- Cada cuenta es una marca. `cuentaActual()` (`src/lib/accounts.ts:56`) no recibe nada: lee la cookie `hancel_cuenta`,
  la cruza con las membresías y decide. La cookie solo propone. Todo filtra por `account_id`.
- Las cuentas se crean con `crearEmpresa(nombre, plan, creadorId)` (`src/engine/empresas.ts:179`): cuenta, membresía de
  owner, `account_secrets` y `asegurarConfiguracion`. Con `ONBOARDING_ACTIVO` nace con `onboarding = pendiente`, y
  `DashboardShell` la manda a `/empezar`.
- No hay banderas de funciones. Lo de plan está escrito a mano en tres sitios (`SOLO_ADVANCE` en `app-sidebar.tsx:177`,
  `advance: true` en `chat/menu-funciones.tsx:14-33`, `exigirAdvance` e `idDeCuentaAdvance` en páginas y acciones). El
  único ajuste de plataforma es `platform_ajustes.registro_abierto`.
- Hay dos menús: el sidebar (`app-sidebar.tsx`) y el del chat de la portada (`chat/menu-funciones.tsx`). Long-form va
  en los dos.
- No hay Realtime ni cliente de Supabase en el navegador, a propósito. Las pantallas que esperan trabajo sondean
  (`chat-app.tsx:150`, `calendario.tsx:84`). Long-form hace lo mismo.
- No hay centro de avisos, toast general, popover ni barra de progreso en `src/components/ui`. Se agregan con shadcn
  base-nova.
- Las rutas que llaman crons usan `authorizeEngineRequest` (`src/lib/api-auth.ts`) y van en `ABIERTAS` de `src/proxy.ts`.
- En local el chat no debe despachar a producción: `CHAT_SIN_DESPACHO=1` y `scripts/pasada-chat.ts` (MOTOR.md).

**Motor** (`plogy-longform`)
- Etapas: ingesta, análisis (Meet o cámaras), transcripción, plan, gráficos, render, control de calidad y clips, con
  dos paradas (reparto y guion). Ya tiene caché por contenido en los trozos del render y unión sin recodificar.
- Lo lento hoy: Whisper en secuencia, la limpieza de la píldora de Meet cuadro a cuadro, las piezas gráficas
  capturadas una por una en un solo Chromium, y la ingesta que decodifica el archivo entero dos o tres veces.
- No hay ningún tiempo medido por etapa. La meta de 10 minutos se mide desde cero.
- Su esquema no tiene cuentas (`lf_usuarios`, `lf_marcas` por slug global, `lf_conexiones` global). Se rehace.
- `config.py:34` usa `os.uname()`, que falla en Windows.

---

## 2. Banderas de funciones y paywall

**Tablas** (migración `2026-11-08-funciones.sql`)
- `platform_funciones (clave text pk, nombre, descripcion, encendida boolean default false, updated_at)`. Filas:
  `long_form`, `marcas_multiples`, `estilo_long_form`.
- `cuenta_funciones (account_id, clave, encendida boolean, motivo, por uuid, created_at)`, pk `(account_id, clave)`:
  la excepción por cuenta, que manda sobre la global.
- `funcion_interes (id, account_id, user_id, clave, created_at)`, único por `(account_id, clave)`: el "Quiero acceso".
- RLS activo y sin políticas, como el resto.

**Local encendido, producción apagado.** Las filas nacen apagadas. En local, `FUNCIONES_BETA=todas` en `.env.local`
las enciende todas desde el servidor. En producción esa variable no existe.

**Código** (`src/lib/funciones.ts`)
- `tieneFuncion(accountId, clave)`: excepción de la cuenta, si no la global, si no la variable local. Con caché por
  petición.
- `exigirFuncion(clave)`: para páginas, devuelve la cuenta o pinta el paywall.
- `idDeCuentaCon(clave)`: para acciones, lanza si no la tiene.
- `rutaConFuncion(request, clave)`: para rutas de API, responde 404 sin datos.
- El endpoint que llama al motor comprueba la bandera de la cuenta del proyecto antes de encolar.
- `estilo_long_form` gobierna la pestaña nueva de Marca y la biblioteca de audio. `long_form` gobierna la sección.
  Long-form necesita las dos; si falta el estilo, el onboarding de long form no se puede hacer y se ve el paywall.

**Paywall**: un solo componente, `paywall-funcion.tsx`. Qué hace la función en tres líneas, "Beta privada",
y el botón "Quiero acceso" que registra el interés y cambia a "Te avisamos". Sin precios.

**Sidebar**: el ítem lleva un candado cuando la cuenta no tiene la función. `nav-main.tsx` gana soporte para el
candado sin cambiar los demás ítems.

**Panel de administración**
- `/admin/funciones`: las tres banderas globales y la lista de cuentas que pidieron acceso, con botón "Dar acceso".
- En `/admin/empresas/[id]`: una tarjeta "Funciones beta" con las tres excepciones. Cada cambio se anota en
  `admin_actividad` (se suma el tipo `funcion` a su check).

**Prueba** (`scripts/longform-banderas.test.ts`): con las banderas apagadas, pide cada página nueva, cada ruta de API
y cada acción, y comprueba que no devuelve datos (paywall o 404). La lista de rutas sale del sistema de archivos, para
que una ruta nueva sin bandera haga fallar la prueba.

---

## 3. Brand manager

**Mis marcas** (`/marcas`, detrás de `marcas_multiples`)
- Se entra desde el menú de usuario (`nav-user.tsx`), que gana "Mis marcas" arriba de la lista de cuentas.
- Lista de las marcas del usuario con su rol, la activa marcada, "Cambiar" (usa `cambiarCuenta`) y "Crear marca".
- **Una marca gratis.** Mis marcas se ve siempre; lo que pide la bandera es crear la segunda. Cuenta las marcas donde la
  persona es owner. La primera se crea sin bandera (el registro no cambia). Desde la segunda, sin `marcas_multiples`,
  aparece el paywall. La tarjeta de Configuración > Empresa pasa a decir "Crear marca" y sigue la misma regla, en la
  acción (`nuevaEmpresa`), no solo en el botón. Crear una marca desde el panel de administración no tiene límite.
- **Crear marca**: nombre y, opcional, "Copiar lo común de" una marca donde el usuario es owner. Llama a
  `crearEmpresa` (sin duplicar el registro), copia lo común si se pidió, cambia a la marca nueva y la manda a
  `/empezar`.
- **Qué copia "lo común"**: `brand_profile` (identidad, voz, do's & don'ts), `content_pillars`, `content_audiences`,
  `content_verticals`, `content_ctas`, `generation_config.carousel` (colores, fuentes) y los logos, copiados a la
  ruta de la marca nueva en Storage. Las imágenes de la biblioteca se copian como filas nuevas apuntando a copias
  de los archivos. No se copian secretos, conexiones, kits, piezas ni conversaciones.
- **Onboarding para la marca nueva.** Corre aunque `ONBOARDING_ACTIVO` esté apagado (la marca nace `pendiente`). Lo
  copiado cuenta como evidencia ya confirmada, así que el Estratega solo pregunta lo que falta.
- **Clave de Claude** (D6): el owner puede marcar "Usar la misma conexión de Claude que <marca>", que copia el token
  de su `account_secrets`. Sin eso, la marca nueva no tiene Claude hasta conectarlo, igual que hoy.

**Marca reorganizada** (`/marca`)

Dos grupos de pestañas; todo lo que existe sigue en su sitio, con otro orden.

| Grupo | Pestaña | Qué es hoy |
|---|---|---|
| Lo común | Identidad, Voz (do's & don'ts), Pilares y temas (Editorial), CTA, Visual (colores, fuentes, logos), Assets (Imágenes) | Sin cambios de contenido |
| Estilo editorial | Carruseles: Kit, Skills, Ejemplos | Sin cambios de contenido |
| Estilo editorial | Short form | La configuración de `config-videos.tsx`, movida tal cual, con las mismas tablas (`video_settings`) y acciones. Solo para Advance, como hoy |
| Estilo editorial | Long form | Nuevo, detrás de `estilo_long_form` |

- Los `?tab=` de hoy siguen funcionando: los viejos se traducen a los nuevos, así no se rompe ningún enlace.
- Video studio deja la pestaña Configuración y enlaza a Marca > Estilo editorial > Short form.

**Estilo editorial · Long form**
- Música de intro y de cierre, con su volumen. MP3 o WAV.
- Biblioteca de efectos por momento: entrada de rótulo, barra, pop-up, transición, cita.
- Estilo de rótulos, citas, barras con CTA, pop-ups y tarjetas de intro y cierre. Parte del kit de la marca (colores,
  fuentes, logo) y tiene vista previa en vivo.
- Subtítulos de los clips: tipografía, tamaño, colores y resaltado, con vista previa.
- Silencios (suave, normal, fuerte) y densidad de gráficos (pocos, normal, muchos). Se traducen a los parámetros del
  motor (`silencio_k`, `silencio_min`, `silencio_aire`, `barra_cada_min`, `popup_cada_min`).
- Personas recurrentes: nombre, cargo, @ y foto.
- Formatos de clip (tamaño real, dividida), duración de los clips y CTA de video.
- Nivel de esfuerzo por defecto.

**Vista previa con el mismo HTML que el motor.** Hoy las plantillas están escritas dentro de Python
(`graficos.py:34-148`). Se sacan a `long-form/plantillas/` como archivos HTML y CSS con huecos. El motor las llena en
Python y Studio las llena en TypeScript y las muestra en un iframe aislado. Una prueba compara las dos salidas con el
mismo estilo de entrada.

**Subtítulos con cualquier fuente.** Hoy salen de los contornos de Plogy Display (`plogy_subtitulos.py`). Para otra
marca se usa la fuente de su kit con libass. Plogy conserva sus contornos.

**Onboarding de long form.** La primera vez que una marca sin estilo entra a Long-form:
1. Propone todo a partir del kit y de lo común.
2. Muestra un rótulo y una barra de muestra.
3. Pide la música, o deja seguir sin ella.
4. La persona confirma o cambia.

**El preset de Plogy** se convierte en el estilo de la cuenta de Plogy con un script
(`long-form/motor/scripts/importar_preset.py`). La intro pasa de `.mp4` a MP3; los efectos quedan en WAV.

---

## 4. El esquema nuevo

Migración `2026-11-08-long-form.sql`, aditiva e idempotente. Todas las tablas `lf_` llevan `account_id`, RLS activo
sin políticas, y las funciones son `security definer` con `revoke execute ... from public, anon, authenticated`.

| Tabla | Qué guarda |
|---|---|
| `lf_estilos` | Estilo long form por cuenta: `account_id` pk, `config jsonb` (lo de la sección 3), `esfuerzo_defecto`, `version`, `listo` (pasó el onboarding) |
| `lf_biblioteca` | Audio por cuenta: `tipo` (`musica`, `sfx`), `momento` (`intro`, `cierre`, `rotulo`, `barra`, `popup`, `transicion`, `cita`), `ruta`, `formato` (`mp3`, `wav`), `duracion_s`, `volumen` |
| `lf_proyectos` | `titulo`, `esfuerzo` (`rapido`, `normal`, `detallado`), `estado` (`subiendo`, `procesando`, `revision`, `listo`, `difusion`, `enviado`, `error`), `fase` y `detalle`, `progreso`, `tipo_grabacion` y `evidencia`, `notas`, `cta_defecto`, `duracion_s`, `miniatura`, `spec jsonb` y `datos jsonb` (estado de etapas, como hoy), `creado_por uuid` |
| `lf_archivos` | Entradas y salidas: `tipo` (`fuente`, `audio`, `pdf`, `foto`, `salida`, `proxy`, `clip`, `zip`), `ruta`, `bytes`, `mime`, `version`, `subida` (`pendiente`, `lista`). Único por `ruta`: se arregla que el motor inserte una fila en cada subida |
| `lf_trabajos` | La cola: `etapa`, `quien` (`motor`, `studio`), `estado`, `intentos`, `worker`, `lease_hasta`, `error`, `inicio`, `fin`, `costo jsonb` |
| `lf_eventos` | La línea de tiempo: `etapa`, `nivel`, `mensaje`, `inicio`, `fin`, `duracion_ms`, `costo jsonb` (segundos de Modal, minutos de Groq, tokens de Claude) |
| `lf_avisos` | Centro de avisos: `account_id`, `proyecto_id`, `tipo`, `titulo`, `cuerpo`, `accion` (enlace), `leido_por uuid[]`, `created_at`. Los ve toda la marca |
| `lf_ideas` | Mapa de ideas: `tipo` (tesis, dato, historia, consejo, frase, pregunta y respuesta), `inicio`, `fin`, `quien`, `cita`, `cita_verificada`, `porque` |
| `lf_piezas` | Propuestas de difusión: `tipo` (`clip`, `carrusel`), `idea_id`, `estado` (`propuesta`, `aprobada`, `descartada`, `renderizando`, `lista`, `enviada`, `error`), `inicio`, `fin`, `datos jsonb` (título, gancho, captions, CTA, citas con minuto, estructura, fotos) |
| `lf_envios` | Lo enviado a la parrilla: `pieza_id` único, `raw_news_id`, `content_piece_id`, `chat_trabajo_id`, `conversacion_id`. Es lo que hace idempotente el envío |

Columnas nuevas en tablas de Studio, todas nulas por defecto, así lo existente no cambia:
- `raw_news.origen` y `content_pieces.origen` (`longform` o nulo). El carril sigue siendo `chat`: el código pregunta por
  `carril = 'chat'` en muchos sitios (`chat_despachar`, índices, `trabajos.ts`, `tick.ts:509`) y un carril nuevo
  rompería esas reglas.
- `brand_imagenes.origen` y `brand_imagenes.origen_ref` (el proyecto).

Funciones: `lf_encolar`, `lf_reclamar` (un proyecto nunca corre dos etapas a la vez, lease de 15 minutos, tres
intentos), `lf_latido`, `lf_terminar` y `lf_guardar_estado`, portadas del motor con `account_id`. `lf_reclamar`
excluye las cuentas suspendidas, como `chat_despachar`.

Bucket privado `longform`, con rutas `<cuenta>/<proyecto>/entrada/...`, `.../salida/...` y `<cuenta>/estilo/...`. Las
rutas las arma el servidor.

---

## 5. El motor en Modal

Vive en `long-form/motor/` (Python 3.12). Vercel lo ignora (`.vercelignore`), y ESLint y TypeScript también.

```
Studio (Vercel)                         Motor (Modal, o local)
  acción "Empezar" o "Aprobar"
    -> lf_encolar(etapa)
    -> POST /despertar (secreto) ------>  reclama el trabajo, corre la etapa,
                                          escribe progreso y avisos en Supabase,
                                          encola la siguiente o se detiene
  /api/long-form/ia (secreto)   <------  etapa de Claude: la corre Studio (D4)
  la interfaz sondea cada 3 s
```

**Modal**
- Una app `plogy-longform` con una imagen (ffmpeg, OpenCV, Chromium de Playwright y faster-whisper de respaldo).
- `despertar`, que es el endpoint web con el secreto compartido, y una función por etapa.
- Las pesadas se reparten con `.map`:
  - `normalizar_tramo`: la fuente partida en tramos de unos 3 minutos, cada uno a 1080p y cuadros constantes.
  - `analizar_tramo`: cuadros clave y caras.
  - `transcribir_parte`: Groq.
  - `limpiar_grupo`: la píldora de Meet.
  - `dibujar_pieza`: un Chromium por contenedor.
  - `render_trozo`.
  - `render_clip`.
- Trabajo temporal en un `modal.Volume`. Lo que se guarda va a Supabase Storage.
- La fuente se baja una sola vez al volumen. Los tramos la leen de ahí.

**Local**: `LF_MOTOR=local`
- `python -m editor servir` levanta el mismo `/despertar` en `localhost:8787`.
- Las funciones son las mismas; `.map` pasa a ser un `ProcessPoolExecutor`. Un solo módulo `ejecutor.py` decide.
- `LF_MOTOR=modal` llama a Modal; `modal serve` también sirve para probar.

**Transcripción**
- Groq `whisper-large-v3-turbo`, por partes de 10 minutos en paralelo.
- El contexto lleva los nombres de la marca, las personas recurrentes y las notas.
- Las palabras de Groq llegan en lista plana y se vuelven a agrupar en segmentos.
- Sin `GROQ_API_KEY`, faster-whisper local.

**Claude**: ver D4. El motor deja un trabajo `quien = 'studio'` y llama a `/api/long-form/ia`. Studio corre el paso
con `llamarClaude` (clave y modelos de la cuenta, tope de la clave de plataforma, consumo en `pipeline_events`) y
encola la siguiente etapa del motor. Sin clave quedan los respaldos que ya tiene el motor: capítulos cada 8 minutos,
clips alrededor de las citas, sin captions.

**Orden para la meta de 10 minutos**

```
bajar fuente -> normalizar (paralelo) -> transcripcion (paralelo) -> ideas y propuestas de difusion (Claude)
                                      -> analisis (paralelo) --------> plan -> graficos (paralelo) -> render (paralelo)
                                      -> proxy de vista previa                 -> unir -> control de calidad
```

La transcripción y el análisis corren a la vez. Las propuestas de difusión salen con la transcripción y la vista
previa usa el proxy de 720p, así que aparecen antes de que termine el render. Los clips se renderizan al aprobarse.

**Estimado** (sin medir, para una hora en Rápido con unos 30 contenedores):

| Paso | Estimado |
|---|---|
| Bajar la fuente al volumen | 1 a 2 min |
| Normalizar en tramos | 1 a 2 min |
| Transcripción con Groq | 0,5 a 1 min |
| Análisis | 1 min, en paralelo con la transcripción |
| Guion con Claude | 1 a 2 min |
| Gráficos en paralelo | 1 min |
| Render en trozos y unión | 2 a 3 min |
| Control de calidad | 0,5 min |
| **Total** | **8 a 12 min** |

Lo más riesgoso es la limpieza de la píldora de Meet y la bajada de 8,7 GB. Se mide en la fase 3 con las muestras
reales; si no llega, lo primero que se ajusta es el tamaño de los tramos y la cantidad de contenedores.

**Arreglos del motor que entran sin cambiar su resultado**
- `os.uname()`.
- La firma de caché de los trozos sin el preset de x264.
- `-r 30` fijo en `ffm.ENC`.
- Las subidas que duplican filas.
- La mezcla de audio entera en memoria, que pasa a ir por trozos.

**Medición**: cada trabajo guarda duración y costo en `lf_eventos`.
- Modal: segundos por CPU y memoria, con la tarifa en una constante.
- Groq: minutos de audio.
- Claude: lo de `pipeline_events`.
- `/admin/long-form` muestra tiempo y costo por proyecto y por etapa.

---

## 6. Cualquier grabación

**Entrada**
- Uno o varios videos (mp4, mov, mkv, webm; cuadros variables, rotación, 4K, verticales).
- Opcional: un audio aparte, un PDF o presentación y fotos.

**Etapa `clasificar`**, después de normalizar. Señales medibles:
- sondeo de cada archivo;
- solape de audio entre archivos (mismo momento o partes sucesivas);
- caras por cuadro;
- cortes de escena;
- rejillas de videollamada;
- el borde de quien habla.

Claude con visión solo desempata. La evidencia se guarda y se muestra en Quién es quién.

| Tipo | Cómo se edita | Base |
|---|---|---|
| Videollamada en galería | Lo que ya hace el motor | `meet.py` |
| Varias cámaras a la vez | Lo que ya hace el motor | `camaras.py` |
| Partes sucesivas | Se unen en orden y se tratan como una | nuevo, antes de clasificar el resto |
| Una cámara | Reencuadre por caras, plano de quien habla si hay varias, acercamientos suaves en los cambios de idea | nuevo |
| Pódcast o video ya editado | Respeta sus cortes: solo silencios, gráficos, audio y marca | nuevo, el más simple |
| Charla con diapositivas | La lámina protagonista y la persona en recuadro | reutiliza el emparejado de láminas de `meet.py` |
| Grabación de pantalla | Acercamiento a la zona donde pasa algo | nuevo: diferencia entre cuadros |

**Para todos**
- Igualar exposición y color entre fuentes.
- Reducción de ruido suave.
- En los cambios de plano, el audio entra unos cuadros antes.
- Un audio aparte reemplaza al de cámara, sincronizado por correlación, igual que la sincronía de cámaras.

**Pruebas**: una por tipo, con videos generados por ffmpeg (patrones, tonos y caras sintéticas) cuando no haya
muestra. Las de Meet y cámaras corren con las muestras reales:
- la grabación del taller del 2026-11-05;
- las dos cámaras de César (`IMG_1437.MP4`, `IMG_0849.MP4`).

---

## 7. Difusión y envío a la parrilla

**Mapa de ideas** (Claude en Studio, con la transcripción)
- Ideas que se sostienen solas, cada una con su tramo, quién la dice y por qué funciona.
- Cada cita se verifica contra la transcripción con el mismo emparejado de `guion.verificar_citas`. Una cita que no
  aparece no entra.

**Propuestas**
- **Clips de 30 a 90 s**: entrada y salida en límites de frase, gancho, título, captions y CTA.
- **Carruseles**: tema, enfoque, citas y datos textuales con su minuto, estructura sugerida y fotos candidatas. Las
  fotos son cuadros nítidos del video, elegidos por varianza del laplaciano y caras completas.

**Vista previa sin render**: `<video>` sobre el proxy con `#t=inicio,fin` y recorte vertical por CSS.

**Clips aprobados**: se renderizan en paralelo, con subtítulos de marca, tarjeta final de unos 2,5 s y una línea de
CTA en el caption.

**Zip**: lo arma el motor (clips, `.srt` y `captions.txt`) y Studio entrega un enlace firmado. Vercel no arma zips
de cientos de MB.

**Enviar a la parrilla**
- **Entrada al chat.** Los carruseles aprobados entran por `empezarLote`, en el carril `chat`, en tandas de hasta 6
  (`MAX_PIEZAS_POR_PEDIDO`). Se sigue el molde de `lanzarPrimerPost` (`src/engine/onboarding/brief.ts:369`): se crea
  la conversación "Long-form · <título>", el mensaje del Coordinador y el lote.
- **`PedidoPieza.longform`.** Lleva el título del video, las citas con su minuto, quién las dice, el extracto de la
  transcripción y el enlace al proyecto.
- **`prepararMaterial`** (`src/engine/chat/investigar.ts:74`). Con `longform` no busca en internet: arma el
  `full_content` con ese material. Guarda `raw_news` con `origen = 'longform'` y `news_sources` con su `contenido` ya
  lleno y el video como fuente.
- **Guardas contra la segunda búsqueda.** `investigarNoticia` (`src/engine/redaccion/fuentes.ts:336`) busca en la web
  si no hay fuentes de búsqueda, y también intentaría leer el enlace del video. Lleva una guarda explícita para
  `origen = 'longform'`; no se apoya en que existan filas.
- **Material propio.** El material es la propia marca hablando, así que va como el material de la marca
  (`ORIGEN_MARCA` en `criterio.ts:83` y `revisor-claude.ts:251`). El criterio no se obliga a decir algo distinto de
  lo que dijo la persona, y el escritor recibe "usa solo este material".
- **Fotos.** Entran a `brand_imagenes` con `origen` y el proyecto. Al diseñar esas piezas, `candidatas`
  (`src/engine/marca/imagenes.ts:595`) prefiere las del proyecto.
- **Estudio y Calendario.** Etiqueta "Long-form" en la tarjeta (`tablero.tsx:461`, `tarjeta-post.tsx`,
  `bandeja.tsx`, `detalle-post.tsx`) y filtro por origen (`searchParams` en el Estudio, `Filtro` en el Calendario).
- **Idempotente y con estado.** `lf_envios` evita reenviar. Long-form lee el estado de cada pieza de
  `content_pieces`:
  - en el estudio: `generated` sin fecha;
  - aprobada: `approved`;
  - programada: `programada_para` sin `published_at`;
  - publicada: `published`.
- **Nada se publica solo.** El freno de carril chat (`FRENO_PIEZA`, `sinFreno`) ya exige aprobación.

---

## 8. Pantallas

Todas con `DashboardShell`, los tokens de `globals.css` y `src/components/ui`.
- El naranja `--brand` solo para la acción principal y el ítem activo.
- Estados con su color suave y siempre con texto.
- Cada pantalla tiene sus cuatro estados: vacío, cargando (skeleton), procesando (paso y tiempo estimado) y error
  ("Reintentar").
- Funcionan a 390 px sin desplazamiento horizontal.

| Ruta | Pantalla |
|---|---|
| `/long-form` | Tablero por estado (Subiendo, Procesando, Te toca revisar, Listo, En difusión, Enviado), con miniatura, título, duración, nivel y quién debe actuar. "Nuevo video". En el teléfono, columnas apiladas con contador |
| `/long-form/nuevo` | Zona para soltar varios archivos con progreso por archivo, título, nivel, notas y CTA por defecto. "Empezar" |
| `/long-form/[id]` | Encabezado con título, estado y paso a paso (Subida, Análisis, Revisión, Render, Difusión, Enviado). Aviso cuando te toca. Línea de tiempo plegable. Pestañas Revisión, Video y Difusión |
| `/marca?tab=long-form` | Estilo editorial · Long form y su onboarding |
| `/marcas` | Mis marcas |
| `/admin/funciones`, `/admin/long-form` | Banderas, interesados, tiempos y costos |

**Subida**
- `tus-js-client` directo a Supabase Storage con una firma de un solo uso que da el servidor. La app provisional ya
  lo hace en `web/src/lib/subir.ts`; se porta.
- La reanudación usa la huella de `tus-js-client`.
- El gestor vive en un proveedor de cliente montado en `src/app/layout.tsx`, así la subida sigue al cambiar de
  pantalla, incluido el chat de la portada.
- `beforeunload` avisa antes de cerrar la pestaña.

**Revisión**
- **Quién es quién**: miniatura de cada persona, nombre propuesto, frases de ejemplo, y el tipo de grabación con su
  evidencia.
- **Guion**:
  - línea de tiempo con una pista por tipo de gráfico y el reproductor sincronizado; clic en un elemento lleva a su
    momento;
  - edición en un `Sheet` lateral;
  - los choques se avisan antes de aprobar, con las reglas de `graficos.armar`.
- En el teléfono la línea de tiempo pasa a lista por minuto.

**Video**: reproductor, control de calidad (hoja de cuadros, sonoridad, avisos), versiones, descargar y corregir
(vuelve al guion desde lo aprobado). Título, descripción y capítulos para copiar.

**Difusión**
- Arriba: CTA por defecto, contador de aprobados y pendientes, y las acciones (descargar zip, enviar a la parrilla).
- **Clips**: vista vertical del tramo; aprobar, descartar, mover inicio y fin de a medio segundo con ajuste a la
  frase, cambiar gancho o título.
- **Carruseles**: citas con su minuto que reproducen ese momento al hacer clic, fotos candidatas y CTA.
- **Ideas**: todas, con su minuto, y "Crear clip" o "Crear carrusel" desde cualquiera.
- Las tarjetas se editan en un `Sheet`, como las piezas de Studio.

**Avisos**
- Campana con contador en el encabezado de `DashboardShell` (hoy no tiene espacio a la derecha; se agrega).
- En el chat de la portada, un punto en el ítem Long-form del menú.
- Se sondea cada 15 s con la pestaña visible.
- Tipos: subida terminada, transcripción lista, te toca revisar, sugerencias listas, video listo, clips listos,
  enviado a la parrilla, y error con motivo y "Reintentar".

**Componentes nuevos de shadcn**: popover, progress y sonner (para el toast). No se crean estilos propios donde Studio
ya tiene la pieza.

**Capturas**: Playwright con datos de ejemplo (`scripts/longform-semilla.ts`).
- Cada pantalla nueva junto a su equivalente de Studio: tablero frente a Estudio, proyecto frente a la ficha de una
  pieza, estilo frente a Marca > Visual.
- A 1440 y 390 px, en claro y en oscuro (D7).
- Comprobación de contraste AA con axe.

---

## 9. Orden de trabajo

| Fase | Qué queda | Cómo se prueba |
|---|---|---|
| 1 | Este plan | Tu aprobación |
| 2 | Base local (D1). Banderas, paywall y panel. Mis marcas y crear marca. Marca reorganizada, short form movido, estilo long form con vistas previas y su onboarding. Preset de Plogy importado | Build, lint y pruebas de Studio; prueba de banderas apagadas; capturas de Marca |
| 3 | Motor en `long-form/motor/`: etapas como funciones, ejecutor local y Modal, Groq, cola y avisos en Supabase, puente con Studio para Claude | Pruebas del motor; una hora del taller medida en local, y en Modal si ya hay cuenta |
| 4 | Long-form en la interfaz: inicio, nuevo video con subida reanudable, proyecto, revisiones, video, avisos | De punta a punta en local en Normal y Detallado; capturas |
| 5 | `clasificar`, los tipos nuevos y las mejoras para todos | Una prueba por tipo; Meet y cámaras siguen pasando |
| 6 | Mapa de ideas, propuestas, render de clips, zip y envío a la parrilla con etiqueta y filtro | En Rápido: tres clips y dos carruseles aprobados, zip descargado, carruseles en el Estudio con la etiqueta; prueba del envío idempotente |
| 7 | `docs/long-form/`: cómo funciona, cómo probar, cómo desplegar Modal, variables nuevas, lo que no se pudo probar sin cuentas reales, informe de tiempos y costos | Revisión tuya |
| 8 | Otros modelos además de Claude: conectar Gemini o ChatGPT por cuenta, en Configuración > Conexiones. `llamarClaude` pasa a ser una puerta con proveedores, con la misma firma para los sitios que la llaman, el mismo tope y el mismo registro de consumo | Las mismas pruebas con cada proveedor; se planea en detalle al llegar |

Cada fase termina con las pruebas en verde, un commit y un resumen corto. Nada se une a main, se despliega ni se
aplica en producción sin preguntarte.

---

## 10. Variables de entorno nuevas

| Variable | Dónde | Para qué |
|---|---|---|
| `FUNCIONES_BETA` | Studio, solo local | `todas` enciende las banderas en local |
| `LF_MOTOR` | Studio | `local` o `modal` |
| `LF_MOTOR_URL` | Studio | `http://localhost:8787` o la URL del endpoint de Modal |
| `LF_MOTOR_SECRETO` | Studio y motor | El secreto compartido de `/despertar` y `/api/long-form/ia` |
| `LF_STUDIO_URL` | Motor | A dónde llama el motor para las etapas de Claude |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Motor | Los mismos de Studio, en un secreto de Modal |
| `GROQ_API_KEY` | Motor | Transcripción rápida. Sin ella, faster-whisper |
| `MODAL_TOKEN_ID`, `MODAL_TOKEN_SECRET` | Solo para desplegar | Nunca en el código |
| `LF_TARIFA_MODAL_CPU_S`, `LF_TARIFA_GROQ_MIN` | Motor | Para el informe de costos |

---

## 11. Riesgos

- **La meta de 10 minutos** está estimada, no medida. Depende de la bajada de la fuente y de la limpieza de la
  píldora de Meet.
- **El token OAuth de Claude** desde servidores tiene riesgo de revocación (MIGRACION-IA-CLAUDE.md). Con D4 el motor
  no lo usa; Studio lo usa como ya lo hace.
- **Storage**: los videos largos llenan el plan rápido. Hace falta una política de limpieza (proxies y trozos se
  borran a los N días; fuentes y finales quedan).
- **Fuga entre cuentas**: toda lectura `lf_` pasa por `cuentaActual`. Hay una prueba que intenta leer el proyecto de
  otra cuenta.
- **Plantillas compartidas** entre Python y TypeScript: si se desalinean, la vista previa miente. La prueba de
  comparación lo frena.

---

## 12. Cómo lo prueba la gente (por decidir)

Studio ya está en Vercel y la base va en Supabase Pro (D2). Lo único que falta es dónde corre el motor. En los cuatro
caminos el código es el mismo: el motor toma trabajos de `lf_trabajos` y solo cambia dónde vive.

| Camino | Qué es | Una hora de video | Costo | Contras |
|---|---|---|---|---|
| A. Tu computador | El motor corre en tu PC y toma trabajos de la cola. Solo conexiones de salida, sin túnel | Varias horas (2 núcleos, 7,9 GB) | 0 | Tu PC prendido; un video a la vez; no llega a la meta |
| B. Modal | Una función por etapa, en paralelo | La meta de 10 min | Plan Starter: 0 dólares fijos y 30 dólares de uso gratis al mes. CPU a unos 0,047 dólares por núcleo y hora. Estimado por video de una hora: menos de 1 dólar | Una cuenta más |
| C. Vercel Pro + Sandbox | Máquinas temporales de Vercel (hasta 24 h por máquina en Pro) que corren el motor | Cerca de la meta, repartiendo en varias máquinas | 20 dólares al mes por persona del equipo, con 20 de uso incluidos. CPU activa a 0,128 dólares la hora | Hay que instalar ffmpeg y Chromium en cada máquina; el paralelismo se arma a mano |
| D. Servidor fijo (Hetzner, Railway) | Un servidor siempre prendido con el Docker del motor | 30 a 60 min con 8 núcleos dedicados | Unos 140 euros al mes por 8 núcleos dedicados (Hetzner subió precios en junio de 2026) | No reparte en paralelo; paga aunque no se use |

**Pagar Vercel por sí solo no lo resuelve.** Sus funciones tienen tope de duración, el paquete no admite ffmpeg,
Chromium y OpenCV juntos, el disco no persiste y el cuerpo de una petición se corta a 4,5 MB. Lo que sí sirve de
Vercel Pro es Sandbox (camino C), que es otro producto.

**Transcripción.** Groq cuesta unos 0,04 dólares por hora de audio. Sin Groq, Whisper en un CPU tarda decenas de
minutos por hora de audio.

**Recomendación.** Construir y probar en local (A) mientras dura el desarrollo, y para la beta con gente de fuera
abrir Modal (B): con los 30 dólares gratis caben decenas de videos de una hora al mes y es el único camino que llega a
los 10 minutos sin armar el paralelismo a mano. Si se quiere un solo proveedor, C es la alternativa.

Precios consultados el 2026-11-08 en modal.com/pricing, groq.com/pricing, vercel.com/docs/vercel-sandbox/pricing y
en sitios que siguen los precios de Hetzner. Se confirman al crear las cuentas.
