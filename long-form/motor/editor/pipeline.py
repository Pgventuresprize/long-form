"""El recorrido de un proyecto: etapas, revisiones y que sigue despues de cada una.

    ingesta -> clasificar -> analisis -> transcripcion ─┐
                                          ▼
                              [revision 1: quien es quien]   segun el nivel
                                          │
                                         plan ─┐
                                               ▼
                              [revision 2: guion]            segun el nivel
                                               │
                     graficos -> render -> qa -> clips -> listo

El nivel de esfuerzo decide donde se detiene:
  - rapido: en ninguna. Quien es quien y el guion los decide la IA; si duda de un nombre, no pone rotulo.
  - normal: en el guion; en quien es quien solo si algun nombre no esta confirmado.
  - detallado: en las dos.

Cada etapa es idempotente: si el motor se cae a mitad, la cola la devuelve y vuelve a empezar; lo que ya
estaba hecho (cache por contenido) no se repite. Cada etapa deja su duracion y su costo en la linea de tiempo.
"""
import os
import time
import traceback

from . import config, ia
from .contexto import Contexto

ORDEN = ['ingesta', 'clasificar', 'analisis', 'transcripcion', 'plan', 'graficos', 'render', 'qa', 'clips']
COMPUERTAS = {'transcripcion': ('revision_reparto', 'reparto'), 'plan': ('revision_guion', 'guion')}
# Los mismos nombres que muestra Studio (src/components/long-form/comun.tsx).
NOMBRES = {'ingesta': 'Leyendo los archivos', 'analisis': 'Analizando quién habla', 'clasificar': 'Reconociendo el tipo de grabación',
           'transcripcion': 'Transcribiendo', 'plan': 'Armando el guion', 'graficos': 'Dibujando los gráficos',
           'render': 'Editando el video', 'qa': 'Revisando la calidad', 'clips': 'Haciendo los clips'}

# Los avisos de la campana de Studio al terminar cada etapa.
AVISOS = {
    'transcripcion': ('transcripcion', 'Transcripción lista', 'Ya está la transcripción del video.'),
    'render': ('video', 'Video listo', 'El video editado ya se puede ver y descargar.'),
    'clips': ('clips', 'Clips listos', 'Los clips aprobados ya se pueden descargar.'),
}


def _correr(etapa, ctx):
    """El analisis depende del tipo de grabacion (tipos.py); las demas etapas son las mismas para todos."""
    if etapa == 'analisis':
        from . import tipos
        return tipos.de(ctx).analizar(ctx)
    import importlib
    return importlib.import_module(f'.etapas.{etapa}', __package__).correr(ctx)


def siguiente(etapa, ctx):
    if etapa == 'clips' or (etapa == 'qa' and not ctx.opcion('clips', 8)):
        return None
    if etapa in ORDEN:
        i = ORDEN.index(etapa)
        return ORDEN[i + 1] if i + 1 < len(ORDEN) else None
    return None


def debe_parar(ctx, etapa):
    """Si el nivel pide que una persona revise lo que propuso esta etapa."""
    nivel = ctx.esfuerzo
    if nivel == 'detallado':
        return True
    if nivel == 'rapido':
        return False
    if etapa == 'plan':
        return True
    # normal: quien es quien solo si hay algun nombre que la IA no pudo confirmar
    reparto = ctx.estado.get('reparto') or {}
    return any(not p.get('nombre') or p.get('origen') == 'ia' for p in reparto.get('personas', []))


def aprobar_solo(ctx, clave):
    """Sin revision: lo propuesto pasa a aprobado. En quien es quien, quien no tiene nombre confirmado no
    lleva rotulo (mejor sin rotulo que con un nombre equivocado)."""
    valor = ctx.estado.get(clave)
    if valor is None:
        return
    if clave == 'reparto':
        valor = dict(valor)
        valor['personas'] = [dict(p, sin_rotulo=True) if (not p.get('nombre') or p.get('origen') == 'ia') else p
                             for p in valor.get('personas', [])]
    ctx.guardar(f'{clave}_aprobado', valor)
    ctx.log(f'{clave} aprobado sin revisión (nivel {ctx.esfuerzo})')


def reconstruir(alm, pid, etapa):
    """La carpeta de trabajo es cache. Si este motor no tiene lo que dejaron las etapas anteriores
    (otro contenedor las corrio, o se reinicio sin volumen), se rehacen aqui en modo reconstruccion:
    mismos resultados, sin volver a llamar a la IA ni tocar lo que la persona aprobo."""
    if etapa not in ORDEN:
        return
    previas = ORDEN[:ORDEN.index(etapa)]
    for p in [x for x in previas if x in ('ingesta', 'clasificar', 'analisis', 'transcripcion', 'plan')]:
        ctx = Contexto(alm, pid, p)
        if (ctx.trabajo / f'.hecho_{p}').exists() or (p if p != 'clasificar' else 'clasificacion') not in ctx.estado:
            continue
        ctx.reconstruyendo = True
        ctx.log(f'reconstruyendo {p} en este motor (la carpeta de trabajo no lo tenía)')
        _correr(p, ctx)
        (ctx.trabajo / f'.hecho_{p}').touch()


def _cpu_s():
    t = os.times()
    return t.user + t.system + t.children_user + t.children_system


def correr_etapa(alm, pid, etapa, encadenar=True):
    """Corre una etapa y deja encolada la siguiente (o se detiene en la revision que toque).
    Devuelve (siguiente, costo)."""
    token = ia.proyecto_actual.set(pid)
    uso = ia.uso_etapa.set({})
    try:
        reconstruir(alm, pid, etapa)
        ctx = Contexto(alm, pid, etapa)
        t0, c0 = time.time(), _cpu_s()
        ctx.limpiar_avisos()
        ctx.avance('Empezando', 0)
        ctx.log(f'empieza {etapa}')
        try:
            _correr(etapa, ctx)
            (ctx.trabajo / f'.hecho_{etapa}').touch()
        except Exception as e:  # noqa: BLE001
            ctx.log(f'{type(e).__name__}: {e}\n{traceback.format_exc()[-3000:]}', 'error')
            alm.fase(pid, 'error', f'{etapa}: {e}'[:480])
            # El aviso es para la persona: sin el error tecnico, que queda en el detalle y en los eventos.
            alm.aviso(pid, 'error', f'No se pudo terminar: {NOMBRES.get(etapa, etapa)}',
                      'Entra al video y pulsa Reintentar: retoma desde ese paso y conserva lo anterior.')
            raise
        t1 = time.time()
        cpu = _cpu_s() - c0
        # En Modal se paga por nucleo reservado y segundo; en local se anota lo que costaria alla con los
        # nucleos del contenedor (LF_NUCLEOS). cpu_s es informativo: en Windows no cuenta a ffmpeg.
        costo = {**ctx.costo, **(ia.uso_etapa.get() or {}), 'segundos': round(t1 - t0, 1), 'cpu_s': round(cpu, 1),
                 'nucleos': config.NUCLEOS,
                 'usd_maquina': round((t1 - t0) * config.NUCLEOS * config.TARIFA_CPU_S, 4),
                 'usd_audio': round(ctx.costo.get('audio_min', 0) * config.TARIFA_GROQ_MIN, 4) if ctx.costo.get('transcripcion') == 'groq' else 0}
        alm.etapa_hecha(pid, etapa, t0, t1, costo)
        ctx.log(f'termina {etapa} en {t1 - t0:.0f} s')
        if etapa in AVISOS:
            alm.aviso(pid, *AVISOS[etapa])
        if etapa in COMPUERTAS:
            fase, clave = COMPUERTAS[etapa]
            if debe_parar(ctx, etapa):
                alm.fase(pid, fase, 'Te toca revisar', None)
                alm.aviso(pid, 'revision', 'Te toca revisar', 'Quién es quién' if clave == 'reparto' else 'El guion del video')
                return None, costo
            aprobar_solo(ctx, clave)
        nxt = siguiente(etapa, ctx)
        if nxt is None:
            alm.fase(pid, 'listo', 'Listo para publicar', 1)
            return None, costo
        if encadenar:
            alm.encolar(pid, nxt)
        return nxt, costo
    finally:
        ia.uso_etapa.reset(uso)
        ia.proyecto_actual.reset(token)
