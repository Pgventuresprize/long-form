"""Configuracion del motor: todo sale del entorno, con valores por defecto que funcionan en local y en Modal."""
import os
import platform
from pathlib import Path

MOTOR = Path(__file__).resolve().parent.parent          # long-form/motor/
LONG_FORM = MOTOR.parent                               # long-form/
PLANTILLAS = LONG_FORM / 'plantillas'                  # el HTML de los graficos, compartido con Studio
FUENTES_STUDIO = PLANTILLAS / 'fuentes'
SUBTITULOS = MOTOR / 'subtitulos'

FFMPEG = os.environ.get('FFMPEG', 'ffmpeg')
FFPROBE = os.environ.get('FFPROBE', 'ffprobe')

# yt-dlp, solo para el referente por enlace. Vacio por defecto: bajar de YouTube, TikTok o Instagram choca
# con sus terminos, asi que el camino normal es subir el archivo. Quien opere el motor lo enciende a proposito.
YTDLP = os.environ.get('LF_YTDLP', '')

# carpeta de trabajo: es una cache. La verdad vive en la base y el almacenamiento.
DATOS = Path(os.environ.get('LF_DATOS', '/data' if Path('/data').exists() else str(MOTOR / '.datos')))

# Transcripcion: Groq (whisper-large-v3-turbo, por partes en paralelo) si hay clave; si no, faster-whisper local.
GROQ_API_KEY = os.environ.get('GROQ_API_KEY', '')
GROQ_MODELO = os.environ.get('GROQ_MODELO', 'whisper-large-v3-turbo')
WHISPER_MODELO = os.environ.get('WHISPER_MODELO', 'small')
WHISPER_DISPOSITIVO = os.environ.get('WHISPER_DISPOSITIVO', 'cpu')
WHISPER_COMPUTO = os.environ.get('WHISPER_COMPUTO', 'int8')

# Claude no se llama desde aqui: lo llama Studio (/api/long-form/ia) con la clave, el tope y el registro
# de consumo de cada cuenta. El motor solo necesita saber donde esta Studio y el secreto compartido.
STUDIO_URL = os.environ.get('LF_STUDIO_URL', '').rstrip('/')
SECRETO = os.environ.get('LF_MOTOR_SECRETO', '')

# Supabase (vacio = modo local de carpetas, para pruebas sin base)
SUPABASE_URL = os.environ.get('SUPABASE_URL', '').rstrip('/')
SUPABASE_KEY = os.environ.get('SUPABASE_SERVICE_ROLE_KEY', '')
BUCKET = os.environ.get('LF_BUCKET', 'longform')

# Render
HILOS = int(os.environ.get('LF_HILOS', str(max(1, (os.cpu_count() or 2) - 1))))
PRESET_X264 = os.environ.get('LF_PRESET_X264', 'veryfast')

# Donde corren las tareas en paralelo: 'local' (procesos de esta maquina) o 'modal' (contenedores).
EJECUTOR = os.environ.get('LF_MOTOR', 'local')

# Nucleos fisicos del contenedor (Modal cobra por nucleo reservado). En local, los de la maquina.
NUCLEOS = float(os.environ.get('LF_NUCLEOS', str(max(1, (os.cpu_count() or 2) // 2))))

# Tarifas para el informe de costos (por segundo de nucleo y por minuto de audio).
TARIFA_CPU_S = float(os.environ.get('LF_TARIFA_MODAL_CPU_S', '0.0000131'))
TARIFA_GROQ_MIN = float(os.environ.get('LF_TARIFA_GROQ_MIN', str(0.04 / 60)))

WORKER_ID = os.environ.get('LF_WORKER_ID', os.environ.get('MODAL_TASK_ID', platform.node() or 'motor'))
