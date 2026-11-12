"""La intro y el cierre del video largo: la unica fuente de lo que dura cada uno y de como se hace.

Cada marca elige en su estilo (src/engine/long-form/estilo.ts, `intro` y `cierre`):
- 'studio': la tarjeta de siempre (tarjeta-intro.html y tarjeta-cierre.html con la marca), 5,4 y 6 s, con la
  musica de inicio y de cierre de la marca;
- 'video': un clip ya hecho por la marca (MP4 o MOV). Se lleva al lienzo del video y suena con su propio audio
  (si no trae, con la musica de inicio o de cierre de la marca, si hay). Su duracion es la de la intro o el
  cierre, hasta 30 s;
- 'ninguna': no hay intro (o cierre): el video empieza en el gancho o en el programa, y termina con el.

En cada video la persona solo puede apagarlos (`spec.opciones.intro` / `cierre` en false); ausente, vale lo de la
marca. Lo resuelto queda en estado.graficos (`intro_s`, `cierre_s`, `intro_modo`, `cierre_modo`, `intro_video`,
`cierre_video`) y de ahi lo leen render, qa, clips y publicar.
"""
from pathlib import Path

PARTES = ('intro', 'cierre')
MODOS = ('studio', 'video', 'ninguna')
# Lo que dura la tarjeta de Studio. Son los segundos de siempre: el render de 'studio' no cambia.
DURACION_STUDIO = {'intro': 5.4, 'cierre': 6.0}
# Un video propio de mas de esto ya no es una intro: se corta y se avisa.
MAX_VIDEO_S = 30.0
NOMBRE = {'intro': 'La intro', 'cierre': 'El cierre'}


def modo_pedido(opciones, cfg_marca, parte):
    """Funcion pura. Lo que eligio la persona para este video (solo puede apagarla: False) > el estilo de la
    marca > 'studio'. Un valor raro en la marca vale como 'studio', lo de siempre."""
    if (opciones or {}).get(parte) is False:
        return 'ninguna'
    m = ((cfg_marca or {}).get(parte) or {}).get('modo')
    return m if m in MODOS else 'studio'


def a_cuadros(segundos, fps):
    """Segundos exactos a cuadros: la intro y el cierre se unen a los trozos sin recodificar."""
    return round(segundos * fps) / fps


def resolver(ctx, avisar=False, sondear=None):
    """{'intro': {...}, 'cierre': {...}}, cada uno con `modo`, `s` (segundos), `video` (ruta local o None) y
    `audio` (si el video trae sonido). Con `avisar`, lo que no se pudo usar queda en los avisos (solo en la
    etapa que lo fija, graficos, para no repetirlos). Un video de la marca que no esta o no se lee pasa a la
    tarjeta de Studio."""
    if sondear is None:
        from .ffm import sondear
    aviso = ctx.aviso if avisar else (lambda m: None)
    out = {}
    for parte in PARTES:
        modo = modo_pedido(ctx.spec.get('opciones'), ctx.marca.cfg, parte)
        r = {'modo': modo, 's': 0.0, 'video': None, 'audio': False}
        if modo == 'video':
            ruta = ctx.marca.video(parte) if hasattr(ctx.marca, 'video') else None
            info = None
            if ruta:
                try:
                    info = sondear(ruta)
                except Exception:
                    info = None
            if not info or not info.get('video') or info.get('duracion', 0) < 0.5:
                aviso(f'{NOMBRE[parte]} de la marca es un video que no se pudo leer: se usó la tarjeta de Studio.')
                modo = r['modo'] = 'studio'
            else:
                dur = float(info['duracion'])
                if dur > MAX_VIDEO_S:
                    aviso(f'{NOMBRE[parte]} de la marca dura {dur:.0f} s: se usan los primeros {MAX_VIDEO_S:.0f} s.')
                    dur = MAX_VIDEO_S
                r.update(s=a_cuadros(dur, ctx.FPS), video=str(Path(ruta)), audio=bool(info.get('audio')))
        if modo == 'studio':
            r['s'] = DURACION_STUDIO[parte]
        out[parte] = r
    return out


def segundos(ctx):
    """(intro_s, cierre_s) para estimar la duracion antes de los graficos (etapa plan), sin avisos."""
    e = resolver(ctx)
    return e['intro']['s'], e['cierre']['s']


def de_graficos(gr):
    """Lo resuelto, leido de estado.graficos. Un estado de antes (sin modo) es la tarjeta de Studio."""
    return {p: {'modo': gr.get(f'{p}_modo', 'studio'), 's': float(gr.get(f'{p}_s', DURACION_STUDIO[p])),
                'video': gr.get(f'{p}_video'), 'audio': bool(gr.get(f'{p}_audio'))} for p in PARTES}


def a_graficos(e):
    """Lo que se guarda en estado.graficos. Con las dos tarjetas de Studio, solo los segundos de siempre: un
    video como los de antes deja el mismo estado."""
    info = {'intro_s': e['intro']['s'], 'cierre_s': e['cierre']['s']}
    if any(e[p]['modo'] != 'studio' for p in PARTES):
        for p in PARTES:
            info[f'{p}_modo'] = e[p]['modo']
            if e[p]['video']:
                info[f'{p}_video'] = e[p]['video']
                info[f'{p}_audio'] = e[p]['audio']
    return info
