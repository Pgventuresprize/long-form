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

`ingesta → clasificar → analisis → transcripcion → plan → graficos → render → qa`. Los clips no salen con el
largo: se renderizan desde Difusión, solo los aprobados (fase 6).

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
- **`tests/prueba_hora.py`:** una hora por tipo, de punta a punta en Rápido. Deja el tiempo por etapa y la memoria
  máxima en `medida.json`.
- **`scripts/longform-cola.test.ts`:** prueba la cola contra el Supabase local.
- **De punta a punta:** con `scripts/longform-proyecto-prueba.ts` y el motor corriendo.
