"""La intro y el cierre del video largo (extremos.py): quien manda (el video > la marca > la tarjeta de Studio),
la linea de tiempo sin intro ni cierre (capitulos, gancho, subtitulos, audio), un video propio de la marca llevado
de verdad a 16:9 y 9:16 con ffmpeg, y que la tarjeta de Studio en 16:9 sale con los mismos filtros de siempre.

    python tests/prueba_intro.py        (desde long-form/motor; las de render necesitan ffmpeg)
"""
import json
import shutil
import subprocess
import sys
import tempfile
import types
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import numpy as np  # noqa: E402

from editor import config, extremos, ffm  # noqa: E402
from editor import estilo as E  # noqa: E402
from editor import subtitulos as S  # noqa: E402
from editor.contexto import Mapa, desfase  # noqa: E402
from editor.etapas import publicar  # noqa: E402
from editor.etapas import render as R  # noqa: E402
from editor.lienzo import Lienzo, encajar_video  # noqa: E402
from editor.marca import Marca  # noqa: E402

SR = 48000


def _hay_ffmpeg():
    return shutil.which(config.FFMPEG) is not None or Path(config.FFMPEG).is_file()


def _ff(*args):
    subprocess.run([config.FFMPEG, '-hide_banner', '-loglevel', 'error', '-y', *[str(a) for a in args]], check=True)


def _clip(ruta, segundos, tam='640x480', fps=25, audio=True):
    """Un clip sintetico como el que subiria una marca: otro tamaño, otros cuadros por segundo, con o sin sonido."""
    args = ['-f', 'lavfi', '-i', f'testsrc2=s={tam}:r={fps}:d={segundos}']
    if audio:
        args += ['-f', 'lavfi', '-i', f'sine=frequency=1430:duration={segundos}', '-c:a', 'aac']
    _ff(*args, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-shortest' if audio else '-an', ruta)
    return ruta


def _marca(d, intro=None, cierre=None):
    d = Path(d)
    d.mkdir(parents=True, exist_ok=True)
    cfg = {'nombre': 'Prueba', 'colores': {}, 'ctas': {}, 'musica': {}}
    if intro:
        cfg['intro'] = intro
    if cierre:
        cfg['cierre'] = cierre
    (d / 'marca.json').write_text(json.dumps(cfg), encoding='utf8')
    return Marca(d)


def _ctx(marca, opciones=None, fps=30):
    avisos = []
    return types.SimpleNamespace(spec={'opciones': opciones or {}}, marca=marca, FPS=fps, aviso=avisos.append), avisos


# ---------------------------------------------------------------- quien manda
def prueba_precedencia():
    marca_video = {'intro': {'modo': 'video', 'video': 'video/a.mp4'}, 'cierre': {'modo': 'ninguna'}}
    # sin nada: la tarjeta de Studio, lo de siempre
    assert extremos.modo_pedido({}, {}, 'intro') == 'studio'
    assert extremos.modo_pedido(None, None, 'cierre') == 'studio'
    # la marca decide si el video no dice nada (ausente o en true: "la de mi marca")
    assert extremos.modo_pedido({}, marca_video, 'intro') == 'video'
    assert extremos.modo_pedido({'intro': True}, marca_video, 'intro') == 'video'
    assert extremos.modo_pedido({}, marca_video, 'cierre') == 'ninguna'
    # el video solo puede apagarla, y eso manda sobre la marca
    assert extremos.modo_pedido({'intro': False}, marca_video, 'intro') == 'ninguna'
    assert extremos.modo_pedido({'cierre': False}, {}, 'cierre') == 'ninguna'
    assert extremos.modo_pedido({'intro': False}, {}, 'cierre') == 'studio'
    # null no es apagar, y un modo raro en la marca es la tarjeta
    assert extremos.modo_pedido({'intro': None}, {}, 'intro') == 'studio'
    assert extremos.modo_pedido({}, {'intro': {'modo': 'otro'}}, 'intro') == 'studio'


def prueba_resolver_sin_video():
    with tempfile.TemporaryDirectory() as d:
        ctx, avisos = _ctx(_marca(d))
        e = extremos.resolver(ctx, avisar=True)
        assert (e['intro']['modo'], e['intro']['s'], e['cierre']['s']) == ('studio', 5.4, 6.0), e
        assert extremos.segundos(ctx) == (5.4, 6.0) and not avisos
        # lo que se guarda en graficos es lo de siempre: un video de antes deja el mismo estado
        assert extremos.a_graficos(e) == {'intro_s': 5.4, 'cierre_s': 6.0}
        assert extremos.de_graficos({'intro_s': 5.4, 'cierre_s': 6.0})['intro']['modo'] == 'studio'
        # apagadas en el video: 0 s y modo ninguna, en graficos tambien
        ctx, avisos = _ctx(_marca(d), {'intro': False, 'cierre': False})
        e = extremos.resolver(ctx, avisar=True)
        assert extremos.a_graficos(e) == {'intro_s': 0.0, 'cierre_s': 0.0, 'intro_modo': 'ninguna', 'cierre_modo': 'ninguna'}
        # la marca pide su video pero no esta (o no se lee): la tarjeta, con aviso
        ctx, avisos = _ctx(_marca(d, intro={'modo': 'video', 'video': 'video/no-esta.mp4'}))
        e = extremos.resolver(ctx, avisar=True)
        assert e['intro']['modo'] == 'studio' and e['intro']['s'] == 5.4 and len(avisos) == 1, (e, avisos)
        # sin avisar (la etapa plan) no se repite el aviso
        ctx, avisos = _ctx(_marca(d, intro={'modo': 'video', 'video': 'video/no-esta.mp4'}))
        extremos.segundos(ctx)
        assert not avisos


def prueba_resolver_con_video():
    if not _hay_ffmpeg():
        print('      (sin ffmpeg: se salta)')
        return
    with tempfile.TemporaryDirectory() as d:
        d = Path(d)
        (d / 'marca' / 'video').mkdir(parents=True)
        _clip(d / 'marca' / 'video' / 'intro.mp4', 2.5)
        _clip(d / 'marca' / 'video' / 'cierre.mov', 1.5, audio=False)
        m = _marca(d / 'marca', intro={'modo': 'video', 'video': 'video/intro.mp4'}, cierre={'modo': 'video', 'video': 'video/cierre.mov'})
        ctx, avisos = _ctx(m)
        e = extremos.resolver(ctx, avisar=True)
        assert e['intro']['modo'] == 'video' and abs(e['intro']['s'] - 2.5) < 0.05 and e['intro']['audio'], e
        assert e['cierre']['modo'] == 'video' and abs(e['cierre']['s'] - 1.5) < 0.05 and not e['cierre']['audio'], e
        # siempre en cuadros exactos
        assert abs(e['intro']['s'] * 30 - round(e['intro']['s'] * 30)) < 1e-9 and not avisos
        g = extremos.a_graficos(e)
        assert g['intro_modo'] == 'video' and g['intro_video'].endswith('intro.mp4') and g['cierre_audio'] is False
        assert extremos.de_graficos(g) == e
        # el video manda sobre la marca: apagado, aunque la marca tenga su video
        ctx, _ = _ctx(m, {'intro': False})
        assert extremos.resolver(ctx)['intro'] == {'modo': 'ninguna', 's': 0.0, 'video': None, 'audio': False}
        # un video de mas de 30 s se corta a 30 y se avisa
        ctx, avisos = _ctx(m)
        e = extremos.resolver(ctx, avisar=True, sondear=lambda r: {'video': True, 'audio': True, 'duracion': 47.2})
        assert e['intro']['s'] == extremos.MAX_VIDEO_S and len(avisos) == 2 and '47 s' in avisos[0], avisos


def prueba_estilo_baja_el_video_solo_si_se_usa():
    with tempfile.TemporaryDirectory() as d:
        base = {'colores': {'acento': '#ff5b00', 'acento_texto': '#b43d00', 'tinta': '#171310'},
                'fuente': {'origen': 'studio', 'nombre': 'Space Grotesk'}}
        video = {'bucket': 'longform', 'ruta': 'cuenta/estilo/intro/intro-1.mp4'}
        bajados = []

        def bajar(bucket, ruta, destino):
            bajados.append((bucket, ruta))
            Path(destino).write_bytes(b'x')
        cfg = dict(base, intro={'modo': 'video', 'video': video}, cierre={'modo': 'studio', 'video': video})
        c = E.armar(cfg, bajar, Path(d) / 'm1', {})
        m = json.loads((c / 'marca.json').read_text(encoding='utf8'))
        assert m['intro'] == {'modo': 'video', 'video': 'video/intro-1.mp4'} and m['cierre'] == {'modo': 'studio', 'video': None}, m
        assert bajados == [('longform', video['ruta'])], bajados       # el del cierre no se usa: no se baja
        assert Marca(c).video('intro').endswith('intro-1.mp4') and Marca(c).video('cierre') is None
        # un estilo de antes (sin intro ni cierre): la tarjeta; "video" sin archivo, tambien
        c = E.armar(dict(base, cierre={'modo': 'video'}), bajar, Path(d) / 'm2', {})
        m = json.loads((c / 'marca.json').read_text(encoding='utf8'))
        assert m['intro'] == {'modo': 'studio', 'video': None} and m['cierre']['modo'] == 'studio'
        c = E.armar(dict(base, cierre={'modo': 'ninguna'}), bajar, Path(d) / 'm3', {})
        assert json.loads((c / 'marca.json').read_text(encoding='utf8'))['cierre']['modo'] == 'ninguna'


# ---------------------------------------------------------------- linea de tiempo sin intro ni cierre
def prueba_linea_sin_intro_ni_cierre():
    keep = [(0.0, 50.0), (52.0, 120.0)]
    L = R.linea_final(0, 0.0, 118.0, 0.0)
    assert L == {'gancho': 0.0, 'intro': 0.0, 'programa': 0.0, 'cierre': 118.0, 'total': 118.0}, L
    # con gancho: el programa va pegado al gancho
    L = R.linea_final(10.0, 0.0, 118.0, 0.0)
    assert L['programa'] == 10.0 and L['total'] == 128.0
    gr = extremos.a_graficos({'intro': {'modo': 'ninguna', 's': 0.0, 'video': None, 'audio': False},
                              'cierre': {'modo': 'ninguna', 's': 0.0, 'video': None, 'audio': False}})
    assert desfase(gr) == 0.0 and desfase(dict(gr, gancho_s=10.0)) == 10.0
    # capitulos de YouTube: el primero en 0:00, los demas en el tiempo del programa, sin correrse
    g = {'capitulos': [{'inicio': 0, 'titulo': 'Inicio'}, {'inicio': 60.0, 'titulo': 'Ventas'}, {'inicio': 100.0, 'titulo': 'Cierre'}]}
    ctx = types.SimpleNamespace(estado={'graficos': gr, 'keep': keep}, FPS=30, eleccion=lambda k, d: d)
    assert publicar.capitulos(ctx, g).splitlines() == ['0:00 Inicio', '0:58 Ventas', '1:38 Cierre']
    ctx.estado['graficos'] = dict(gr, gancho_s=10.0)
    assert publicar.capitulos(ctx, g).splitlines()[1] == '1:08 Ventas'
    # con un video propio de 2,5 s, se corren 2,5 s
    gv = {'intro_s': 2.5, 'cierre_s': 1.5, 'intro_modo': 'video', 'cierre_modo': 'video'}
    ctx.estado['graficos'] = gv
    assert publicar.capitulos(ctx, g).splitlines()[1] == '1:00 Ventas' and desfase(gv) == 2.5
    # los clips se cortan del video final en desfase + tiempo del programa
    assert Mapa(keep, 30, desfase(gr)).salida(60.0) == 58.0
    # los subtitulos van en tiempo del programa (por trozo): no dependen de la intro
    segs = [{'inicio': 60.0, 'fin': 61.0, 'texto': 'hola', 'palabras': [{'i': 60.0, 'f': 60.5, 'p': 'hola'}]}]
    assert S.palabras(segs, Mapa(keep, 30, 0.0)) == S.palabras(segs, Mapa(keep, 30, 5.4))
    with tempfile.TemporaryDirectory() as d:
        txt = S.srt_publico([(1.0, 2.0, 'Hola')], Path(d) / 'a.srt', desfase(gr)).read_text(encoding='utf8')
        assert txt.startswith('1\n00:00:01,000 --> 00:00:02,000'), repr(txt)


def _voz(segundos, hablando):
    t = np.arange(int(SR * segundos)) / SR
    return (0.3 * np.sin(2 * np.pi * 330 * t) * hablando(t)).astype(np.float32)


def _mezcla(d, extremos_, intro, outro, musica=None, gancho=None):
    d = Path(d)
    (d / 'render').mkdir(exist_ok=True)
    prog = d / 'programa.wav'
    ffm.escribir_wav(prog, SR, _voz(20, lambda t: (t >= 12) & (t < 14)))
    pedidas = []

    def de_la_marca(clave):
        pedidas.append(clave)
        return (musica or {}).get(clave)
    marca = types.SimpleNamespace(cfg={'musica': {}}, musica=de_la_marca, sfx=lambda nombre: None)
    ctx = types.SimpleNamespace(FPS=30, spec={}, marca=marca, opcion=lambda k, v: v, aviso=print,
                                archivos=lambda tipo: [], local=lambda a: Path(a['ruta']), tj=lambda n: d / n)
    keep = [(0.0, 20.0)]
    R.audio(ctx, keep, Mapa(keep, 30, intro), [], str(prog), intro, outro, extremos=extremos_,
            gancho=(gancho, Mapa(gancho, 30, 0.0)) if gancho else None)
    _, mix = ffm.leer_wav(d / 'render' / 'audio.wav')
    mix = np.asarray(mix, np.float64)
    return (mix.mean(axis=1) if mix.ndim == 2 else mix), pedidas


def _rms(mix, a, b):
    return float(np.sqrt((mix[int(a * SR):int(b * SR)] ** 2).mean()))


def prueba_audio_sin_intro_ni_cierre():
    if not _hay_ffmpeg():
        print('      (sin ffmpeg: se salta)')
        return
    with tempfile.TemporaryDirectory() as d:
        d = Path(d)
        cancion = d / 'cancion.wav'
        ffm.escribir_wav(cancion, SR, (0.3 * np.sin(2 * np.pi * 1430 * np.arange(SR * 8) / SR)).astype(np.float32))
        nada = {p: {'modo': 'ninguna', 's': 0.0, 'video': None, 'audio': False} for p in extremos.PARTES}
        mix, pedidas = _mezcla(d, nada, 0.0, 0.0, musica={'intro': str(cancion), 'cierre': str(cancion)})
        # el video dura lo que el programa, la frase en su lugar sin correrse, y la musica de inicio y cierre ni se pide
        assert abs(len(mix) / SR - 20.0) < 0.01, len(mix) / SR
        assert _rms(mix, 12.2, 13.8) > 0.05 and _rms(mix, 2.0, 10.0) < 1e-3
        assert pedidas == ['fondo'], pedidas
        # con gancho y sin intro: el gancho y despues el programa, corrido lo que dura el gancho
        mix, _ = _mezcla(d, nada, 0.0, 0.0, gancho=[(12.0, 14.0)])
        assert abs(len(mix) / SR - 22.0) < 0.01 and _rms(mix, 0.2, 1.6) > 0.05 and _rms(mix, 2.0 + 12.2, 2.0 + 13.8) > 0.05
        # con la tarjeta de Studio, la de siempre: la musica de inicio suena en la intro
        mix, pedidas = _mezcla(d, None, 1.0, 0.5, musica={'intro': str(cancion)})
        assert pedidas == ['intro', 'cierre', 'fondo'] and _rms(mix, 0.1, 0.5) > 0.05


def prueba_audio_de_un_video_propio():
    if not _hay_ffmpeg():
        print('      (sin ffmpeg: se salta)')
        return
    with tempfile.TemporaryDirectory() as d:
        d = Path(d)
        # ojo: "con" es un nombre reservado en Windows (la consola): ffmpeg se queda esperando
        con = _clip(d / 'clip_con_sonido.mp4', 1.5)
        sin = _clip(d / 'clip_sin_sonido.mp4', 1.0, audio=False)
        cancion = d / 'cancion.wav'
        ffm.escribir_wav(cancion, SR, (0.3 * np.sin(2 * np.pi * 700 * np.arange(SR * 8) / SR)).astype(np.float32))
        ext = {'intro': {'modo': 'video', 's': 1.5, 'video': str(con), 'audio': True},
               'cierre': {'modo': 'video', 's': 1.0, 'video': str(sin), 'audio': False}}
        mix, pedidas = _mezcla(d, ext, 1.5, 1.0, musica={'intro': str(cancion), 'cierre': str(cancion)})
        assert abs(len(mix) / SR - 22.5) < 0.01, len(mix) / SR
        # la intro suena con su audio (y no se pide la musica de inicio); el cierre, sin sonido, con la de cierre
        assert 'intro' not in pedidas and 'cierre' in pedidas, pedidas
        assert _rms(mix, 0.2, 1.3) > 0.03
        espectro = np.abs(np.fft.rfft(mix[int(0.2 * SR):int(1.2 * SR)]))
        assert abs(np.argmax(espectro) * SR / (1.0 * SR) - 1430) < 5        # es el tono del clip, no la cancion
        assert _rms(mix, 21.6, 22.3) > 0.03
        assert _rms(mix, 1.5 + 12.2, 1.5 + 13.8) > 0.05                      # el programa corrido lo que dura el clip


# ---------------------------------------------------------------- render de verdad
def prueba_filtro_encajar():
    f = encajar_video(1920, 1080, 1920, 1080, 30)
    assert 'split' not in f and 'scale=1920:1080' in f and f.endswith('[vp]'), f        # misma forma: solo escala
    f = encajar_video(640, 480, 1080, 1920, 30)
    assert 'split' in f and 'boxblur' in f and 'force_divisible_by=2' in f, f           # otra forma: sobre su copia desenfocada


def prueba_video_propio_a_16_9_y_9_16():
    if not _hay_ffmpeg():
        print('      (sin ffmpeg: se salta)')
        return
    with tempfile.TemporaryDirectory() as d:
        d = Path(d)
        clip = _clip(d / 'propio.mov', 1.6, tam='640x480', fps=25)
        ctx = types.SimpleNamespace(W=1920, H=1080, FPS=30, marca=types.SimpleNamespace(video=lambda p: None))
        ext = {'intro': {'modo': 'video', 's': extremos.a_cuadros(1.5, 30), 'video': str(clip), 'audio': True},
               'cierre': {'modo': 'ninguna', 's': 0.0, 'video': None, 'audio': False}}
        ini = R.extremo_clip(ctx, ext, 'intro', None, d, None)
        info = ffm.sondear(ini)
        assert (info['ancho'], info['alto'], info['pix_fmt']) == (1920, 1080, 'yuv420p') and abs(info['fps'] - 30) < 0.01, info
        assert ffm.cuadros_de(ini) == 45 and not info['audio']
        assert R.extremo_clip(ctx, ext, 'cierre', None, d, None) is None                  # sin cierre: no hay clip
        # 9:16: en su lienzo
        lz = Lienzo('9:16', 'camaras')
        v = R.extremo_clip(ctx, ext, 'intro', None, d, lz)
        info = ffm.sondear(v)
        assert (info['ancho'], info['alto']) == (1080, 1920) and ffm.cuadros_de(v) == 45, info
        # se une a un trozo de 16:9 sin recodificar y la cuenta de cuadros da
        trozo = d / 'trozo.mp4'
        _ff('-f', 'lavfi', '-i', 'testsrc2=s=1920x1080:r=30', '-frames:v', 30, *ffm.ENC, trozo)
        unido = ffm.concatenar([ini, trozo], d / 'unido.mp4')
        assert ffm.cuadros_de(unido) == 75 and abs(ffm.duracion(unido) - 2.5) < 0.05
        # un clip mas corto que lo que se pide (el archivo cambio) se completa con su ultimo cuadro
        ext['intro']['s'] = extremos.a_cuadros(1.8, 30)
        assert ffm.cuadros_de(R.extremo_clip(ctx, ext, 'intro', None, d, None)) == 54


def prueba_tarjeta_de_studio_igual_que_siempre():
    """Sin intro ni cierre propios, la intro y el cierre en 16:9 son la llamada de siempre a tarjeta_clip:
    mismo archivo y mismos filtros de ffmpeg, letra por letra."""
    with tempfile.TemporaryDirectory() as d:
        d = Path(d)
        llamadas = []
        antes = ffm.correr
        ffm.correr = lambda args, **kw: llamadas.append([str(a) for a in args])
        try:
            ctx = types.SimpleNamespace(W=1920, H=1080, FPS=30)
            ext = extremos.de_graficos({'intro_s': 5.4, 'cierre_s': 6.0})
            ini = R.extremo_clip(ctx, ext, 'intro', d / 'tarjeta-intro.png', d, None)
            fin = R.extremo_clip(ctx, ext, 'cierre', d / 'tarjeta-cierre.png', d, None)
        finally:
            ffm.correr = antes
        assert ini == d / 'intro_1920.mp4' and fin == d / 'cierre_1920.mp4'
        enc = [str(a) for a in ffm.ENC]
        assert llamadas[0] == ['-loop', '1', '-framerate', '30', '-i', str(d / 'tarjeta-intro.png'), '-vf',
                               'scale=1920:1080:flags=lanczos,fade=t=in:st=0:d=0.4,fade=t=out:st=5.0:d=0.4,format=yuv420p',
                               '-frames:v', '162'] + enc + [str(ini)], llamadas[0]
        assert llamadas[1] == ['-loop', '1', '-framerate', '30', '-i', str(d / 'tarjeta-cierre.png'), '-vf',
                               'scale=1920:1080:flags=lanczos,fade=t=in:st=0:d=0.4,fade=t=out:st=5.2:d=0.8,format=yuv420p',
                               '-frames:v', '180'] + enc + [str(fin)], llamadas[1]


if __name__ == '__main__':
    fallas = 0
    for nombre, fn in list(globals().items()):
        if nombre.startswith('prueba_') and callable(fn):
            try:
                fn()
                print('ok   ', nombre)
            except AssertionError as e:
                fallas += 1
                import traceback
                print('FALLA', nombre, e)
                traceback.print_exc()
    print(f'{fallas} fallas')
    sys.exit(1 if fallas else 0)
