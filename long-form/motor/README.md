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

`ingesta → analisis → transcripcion → plan → graficos → render → qa`. Los clips no salen con el largo: se
renderizan desde Difusión, solo los aprobados (fase 6).

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
- **`scripts/longform-cola.test.ts`:** prueba la cola contra el Supabase local.
- **De punta a punta:** con `scripts/longform-proyecto-prueba.ts` y el motor corriendo.
