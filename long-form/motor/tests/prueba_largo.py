"""El video largo con lo que elige la persona en Studio: quien manda (persona > referente > defecto), subtitulos
quemados sobre lo que se conserva, gancho antes de la intro, duracion objetivo, ilustraciones a ritmo y lienzos
9:16 y 1:1.

    python tests/prueba_largo.py        (desde long-form/motor; las de render necesitan ffmpeg con libass)
"""
import json
import re
import shutil
import subprocess
import sys
import tempfile
import types
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import numpy as np  # noqa: E402

from editor import almacen, config, ffm, guion as G, subtitulos as S  # noqa: E402
from editor.contexto import Contexto, Mapa, desfase, elegir  # noqa: E402
from editor.etapas import clips, plan, publicar  # noqa: E402
from editor.etapas import render as R  # noqa: E402
from editor.lienzo import FRANJA_TOPE, HUECO, Lienzo, posiciones_subtitulos  # noqa: E402

SR = 48000


def _hay_ffmpeg():
    return shutil.which(config.FFMPEG) is not None or Path(config.FFMPEG).is_file()


def _proyecto(tmp, opciones=None, estado=None):
    marca = Path(tmp) / 'marca'
    marca.mkdir(exist_ok=True)
    (marca / 'marca.json').write_text(json.dumps({'nombre': 'Prueba', 'colores': {}, 'ctas': {}}), encoding='utf8')
    alm = almacen.AlmacenLocal(Path(tmp) / 'datos')
    d = alm.carpeta('p1')
    spec = {'id': 'p1', 'titulo': 'Prueba', 'marca': str(marca), 'esfuerzo': 'rapido',
            'opciones': {'silencio_k': 0.35, 'clips': 0, **(opciones or {})}, 'archivos': []}
    (d / 'proyecto.json').write_text(json.dumps(spec), encoding='utf8')
    for k, v in (estado or {}).items():
        alm.guardar('p1', k, v)
    return alm


# ---------------------------------------------------------------- quien manda
def prueba_precedencia_pura():
    ref = {'sugerido_subtitulos': True, 'sugerido_gancho': True, 'broll_cada_min': 1.5}
    # la persona eligio: manda, aunque el referente diga otra cosa (tambien un False explicito)
    assert elegir({'subtitulos': False}, ref, 'subtitulos', False) is False
    assert elegir({'gancho': True}, {'sugerido_gancho': False}, 'gancho', False) is True
    # automatico (ausente o null): sugiere el referente
    assert elegir({}, ref, 'subtitulos', False) is True
    assert elegir({'gancho': None}, ref, 'gancho', False) is True
    assert elegir({}, ref, 'broll_cada_min', None) == 1.5
    assert elegir({'broll_cada_min': 3}, ref, 'broll_cada_min', None) == 3
    # sin referente ni opcion: el defecto
    assert elegir({}, {}, 'subtitulos', False) is False and elegir(None, None, 'gancho', False) is False
    assert elegir({}, {}, 'capitulos', True) is True and elegir({'capitulos': False}, ref, 'capitulos', True) is False
    # formato y duracion no tienen sugerencia: el referente no los toca aunque traiga una clave con ese nombre
    assert elegir({}, {'formato': '9:16'}, 'formato', '16:9') == '16:9'
    assert elegir({'formato': '1:1'}, {}, 'formato', '16:9') == '1:1'
    assert elegir({'duracion_objetivo_min': 12}, {}, 'duracion_objetivo_min', None) == 12


def prueba_eleccion_en_el_contexto():
    with tempfile.TemporaryDirectory() as tmp:
        ref = {'parametros': {'silencio_k': 0.4, 'sugerido_subtitulos': True, 'sugerido_gancho': True}}
        ctx = Contexto(_proyecto(tmp, {'subtitulos': False, 'formato': '9:16'}, {'referente': ref}), 'p1', 'plan')
        assert ctx.eleccion('subtitulos', False) is False          # la persona dijo que no
        assert ctx.eleccion('gancho', False) is True               # automatico: el referente abre con gancho
        assert ctx.opcion('silencio_k', 0.3) == 0.4                 # las perillas de R2 siguen mandando el referente
        assert ctx.formato == '9:16'
        ctx.spec['opciones']['formato'] = '4:3'
        assert ctx.formato == '16:9'                                # un formato raro no rompe: el de siempre
        ctx.spec['opciones'].pop('formato')
        assert ctx.formato == '16:9'


# ---------------------------------------------------------------- subtitulos
def _seg(i, f, texto):
    ps = texto.split()
    paso = (f - i) / len(ps)
    return {'inicio': i, 'fin': f, 'texto': texto,
            'palabras': [{'i': i + k * paso, 'f': i + (k + 1) * paso - 0.02, 'p': p} for k, p in enumerate(ps)]}


def prueba_subtitulos_siguen_lo_que_se_conserva():
    # se conserva 0-10 y 20-30: lo dicho en 22 s sale en 12 s; lo de 14 s (cortado) no sale
    mapa = Mapa([(0.0, 10.0), (20.0, 30.0)], 30, 5.4)
    segs = [_seg(1.0, 3.0, 'hola a todos'), _seg(14.0, 16.0, 'esto se corta'), _seg(22.0, 24.0, 'vuelve la idea')]
    ws = S.palabras(segs, mapa)
    assert [w[2] for w in ws] == ['hola', 'a', 'todos', 'vuelve', 'la', 'idea'], ws
    assert abs(ws[0][0] - 1.0) < 0.04 and abs(ws[3][0] - 12.0) < 0.04, ws   # tiempo del programa (sin la intro)
    cues = clips.tarjetas(ws, S.PAUSA)
    assert cues[0][2] == 'hola a todos' and abs(cues[1][0] - 12.0) < 0.04, cues
    assert cues[0][1] < 3.5, cues                                  # la tarjeta no se queda en la pausa
    assert clips.tarjetas(ws)[0][2] == 'hola a todos vuelve'      # los clips agrupan como siempre
    # una palabra a caballo de un corte queda con lo que se ve de ella
    medio = S.palabras([_seg(9.5, 10.5, 'partida')], mapa)
    assert len(medio) == 1 and medio[0][1] <= 10.0 + 1e-9, medio
    # los clips escriben el mismo .srt de siempre
    with tempfile.TemporaryDirectory() as tmp:
        txt = clips.srt([(0.0, 0.5, 'Hola,'), (0.6, 1.0, 'mundo.')], Path(tmp) / 'a.srt').read_text(encoding='utf8')
        assert txt == '1\n00:00:00,000 --> 00:00:00,600\nHola\n\n2\n00:00:00,600 --> 00:00:01,000\nmundo\n\n', repr(txt)


def prueba_subtitulos_no_chocan_con_la_franja():
    # rotulo de 10 a 15 s del programa (cuadros 300 a 450) y barra de 40 a 52: las tarjetas que se cruzan suben
    piezas = [{'tipo': 'rotulo', 'o0': 300, 'o1': 450}, {'tipo': 'popup', 'o0': 600, 'o1': 750},
              {'tipo': 'barra', 'o0': 1200, 'o1': 1560}]
    v = S.ventanas_franja(piezas, 30)
    assert v == [(10.0, 15.0), (40.0, 52.0)], v               # el pop-up va arriba a la derecha: no cuenta
    cues = [(2.0, 3.0, 'A'), (9.8, 10.5, 'B'), (14.9, 16.0, 'C'), (20.0, 21.0, 'D'), (52.2, 53.0, 'E'), (60, 61, 'F')]
    normales, altas = S.repartir(cues, v)
    assert [c[2] for c in altas] == ['B', 'C', 'E'] and [c[2] for c in normales] == ['A', 'D', 'F']
    # 16:9: la alta queda por encima de lo mas alto de la franja (el rotulo), con aire
    yn, ya = posiciones_subtitulos('16:9', 'pantalla')
    em = 70
    assert yn == 0.80 and ya * 1080 + em + HUECO <= FRANJA_TOPE['pantalla'] + 0.5, (yn, ya)
    yn, ya = posiciones_subtitulos('16:9', 'escenario')
    assert ya * 1080 + em + HUECO <= FRANJA_TOPE['escenario'] + 0.5 and ya > posiciones_subtitulos('16:9')[1]
    # 9:16 reencuadrado: la banda de graficos va muy abajo, la altura del brand kit no choca
    lz = Lienzo('9:16', 'camaras')
    assert posiciones_subtitulos('9:16', 'pantalla', lz) == (0.60, 0.60)
    # 1:1 reencuadrado: si choca, y sube
    lz = Lienzo('1:1', 'una_camara')
    yn, ya = posiciones_subtitulos('1:1', 'pantalla', lz)
    tope = lz.banda_y + FRANJA_TOPE['pantalla'] * lz.bh / 1080
    assert yn == 0.75 and ya < yn and ya * 1080 + em + HUECO <= tope + 0.5, (yn, ya, tope)
    # encajado (Meet): debajo del cuadro 16:9, sin cambiar
    lz = Lienzo('9:16', 'meet')
    yn, ya = posiciones_subtitulos('9:16', 'escenario', lz)
    assert yn == ya and yn * 1920 - em >= lz.banda_y + lz.bh, (yn, lz.banda_y, lz.bh)


ASS = """[Script Info]
PlayResX: 1920
PlayResY: 1080

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Comment: 1,0:00:01.00,0:00:02.00,PlogyTexto,,0,0,0,,HOLA
Dialogue: 0,0:00:01.00,0:00:02.00,PlogyCaja,,0,0,0,,{\\an7\\pos(0,0)\\p3}m 0 0 l 4 0
Dialogue: 1,0:00:19.50,0:00:20.50,PlogyTexto,,0,0,0,,{\\an7}m 1 1, 2 2
Dialogue: 0,0:01:05.00,0:01:06.00,PlogyCaja,,0,0,0,,x
"""


def prueba_ass_por_trozo():
    cab, ev = S.leer_ass(ASS)
    assert cab.endswith('Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n')
    assert len(ev) == 4 and ev[2][2] == 19.5 and ev[2][4].endswith('m 1 1, 2 2'), ev   # las comas del dibujo quedan
    # el trozo de 10 a 20 s solo lleva la tarjeta de 19,5 s, corrida a su comienzo
    t = S.ass_de_tramo(cab, ev, 10.0, 20.0)
    assert t.count('Dialogue') == 1 and 'Dialogue: 1,0:00:09.50,0:00:10.50,PlogyTexto' in t, t
    assert S.ass_de_tramo(cab, ev, 30.0, 40.0) is None             # sin tarjetas: el trozo queda limpio
    t = S.ass_de_tramo(cab, ev, 60.0, 70.0)
    assert '0:00:05.00,0:00:06.00' in t
    # dos .ass (normal y alto) en uno, en orden
    cab2, ev2 = S.unir_ass([ASS, ASS.replace('0:00:01.00', '0:00:03.00')])
    assert len(ev2) == 8 and [e[2] for e in ev2] == sorted(e[2] for e in ev2)


def _y_de_las_cajas(texto):
    """El centro vertical de cada caja (PlogyCaja) de un .ass de plogy_subtitulos, en px."""
    ys = []
    for linea in texto.splitlines():
        if linea.startswith('Dialogue: 0,') and 'PlogyCaja' in linea:
            nums = [int(x) for x in re.findall(r'-?\d+', linea.split('\\p3}')[1])]
            y = [nums[k] for k in range(1, len(nums), 2)]
            ys.append((min(y) + max(y)) / 2 / 4)
    return ys


def prueba_armar_con_el_programa_de_la_marca():
    """Con el plogy_subtitulos.py de verdad: las tarjetas que chocan con un rotulo salen mas arriba."""
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        ctx = types.SimpleNamespace(W=1920, H=1080, marca=types.SimpleNamespace(dir=tmp))
        ws = [(1.0, 1.4, 'uno'), (1.5, 1.9, 'dos.'), (11.0, 11.4, 'tres'), (11.5, 11.9, 'cuatro.')]
        yn, ya = posiciones_subtitulos('16:9', 'pantalla')
        cab, ev, cues = S.armar(ctx, ws, [(10.0, 15.0)], '16:9', yn, ya, tmp, 'prog')
        assert len(cues) == 2
        texto = cab + ''.join(f'{c}: {capa},{S._ass_t(a)},{S._ass_t(b)},{r}\n' for c, capa, a, b, r in ev)
        ys = _y_de_las_cajas(texto)
        assert len(ys) == 2 and abs(ys[0] - yn * 1080) < 1 and abs(ys[1] - ya * 1080) < 1, (ys, yn, ya)


# ---------------------------------------------------------------- gancho
def prueba_gancho_a_frases_completas():
    segs = [_seg(100.0, 103.0, 'esto es lo que nadie'), _seg(103.2, 108.0, 'te cuenta sobre vender'),
            _seg(108.1, 135.0, 'una frase muy larga que sigue y sigue'), _seg(140.0, 141.0, 'corta')]
    # empieza a mitad de la primera frase y termina a mitad de la segunda: se corre a las frases enteras
    g = G.ajustar_gancho({'inicio': 101.0, 'fin': 107.0, 'por_que': 'intriga'}, segs, [], 600)
    assert (g['inicio'], g['fin']) == (100.0, 108.0) and g['texto'].startswith('esto es'), g
    # muy corto: se suma la frase que sigue si viene seguida
    g = G.ajustar_gancho({'inicio': 100.0, 'fin': 102.5, 'por_que': ''}, segs, [], 600)
    assert g['fin'] == 108.0, g
    # muy largo: se quitan frases del final
    g = G.ajustar_gancho({'inicio': 100.0, 'fin': 125.0, 'por_que': ''}, segs, [], 600)
    assert g['fin'] == 108.0 and g['fin'] - g['inicio'] <= G.GANCHO_MAX, g
    # una sola frase de mas de 20 s: se corta en 20 y se avisa
    g = G.ajustar_gancho({'inicio': 109.0, 'fin': 134.0, 'por_que': ''}, segs, [], 600)
    assert g['inicio'] == 108.1 and abs(g['fin'] - g['inicio'] - 20.0) < 1e-6 and 'revisar' in g, g
    # en un tramo cortado o sensible, o sin datos: no hay gancho
    assert G.ajustar_gancho({'inicio': 101.0, 'fin': 107.0}, segs, [(104.0, 106.0)], 600) is None
    assert G.ajustar_gancho(None, segs, [], 600) is None and G.ajustar_gancho({'inicio': 'x'}, segs, [], 600) is None


def prueba_gancho_corre_todo_lo_demas():
    keep = [(0.0, 50.0), (52.0, 120.0)]
    # lo conservado del gancho: sin el silencio de 50 a 52
    kg = R.tramos_gancho(keep, 45.0, 57.0)
    assert kg == [(45.0, 50.0), (52.0, 57.0)], kg
    G_s = Mapa(kg, 30, 0.0).total / 30
    assert abs(G_s - 10.0) < 1e-9
    L = R.linea_final(G_s, 5.4, 118.0, 6.0)
    assert L == {'gancho': 0.0, 'intro': 10.0, 'programa': 15.4, 'cierre': 133.4, 'total': 139.4}, L
    # sin gancho, la linea de siempre (y con los mismos numeros, no solo parecidos)
    L0 = R.linea_final(0, 5.4, 118.0, 6.0)
    assert L0['intro'] == 0.0 and L0['programa'] == 5.4 and L0['total'] == 5.4 + 118.0 + 6.0
    gr = {'intro_s': 5.4, 'cierre_s': 6.0, 'gancho_s': G_s}
    assert desfase(gr) == 15.4 and desfase({'intro_s': 5.4}) == 5.4
    # los capitulos de YouTube: el primero en 0:00 y los demas corridos lo que dura el gancho
    est = {'graficos': gr, 'keep': keep}
    ctx = types.SimpleNamespace(estado=est, FPS=30, eleccion=lambda k, d: d)
    g = {'capitulos': [{'inicio': 0, 'titulo': 'Inicio'}, {'inicio': 60.0, 'titulo': 'Ventas'}, {'inicio': 100.0, 'titulo': 'Cierre'}]}
    caps = publicar.capitulos(ctx, g)
    # 60 s de la grabacion = 58 s del programa (se quito un silencio de 2 s) + 15,4 s de gancho e intro
    assert caps.splitlines() == ['0:00 Inicio', '1:13 Ventas', '1:53 Cierre'], caps
    sin = types.SimpleNamespace(estado={'graficos': {'intro_s': 5.4, 'cierre_s': 6.0}, 'keep': keep}, FPS=30, eleccion=lambda k, d: d)
    assert publicar.capitulos(sin, g).splitlines()[1] == '1:03 Ventas'
    # con capitulos en falso no se publican
    apagado = types.SimpleNamespace(estado=est, FPS=30, eleccion=lambda k, d: False if k == 'capitulos' else d)
    assert publicar.capitulos(apagado, g) == ''


def _voz(segundos, f0, hablando):
    t = np.arange(int(SR * segundos)) / SR
    return (0.3 * np.sin(2 * np.pi * f0 * t) * hablando(t)).astype(np.float32)


def prueba_audio_con_gancho():
    """La mezcla: el gancho suena primero, la tarjeta de intro despues y el programa entero corrido."""
    if not _hay_ffmpeg():
        print('      (sin ffmpeg: se salta)')
        return
    with tempfile.TemporaryDirectory() as d:
        d = Path(d)
        (d / 'render').mkdir()
        prog = d / 'programa.wav'
        # la voz solo suena de 12 a 14 s de la grabacion
        ffm.escribir_wav(prog, SR, _voz(20, 330, lambda t: (t >= 12) & (t < 14)))
        marca = types.SimpleNamespace(cfg={'musica': {}}, musica=lambda clave: None, sfx=lambda nombre: None)
        ctx = types.SimpleNamespace(FPS=30, spec={}, marca=marca, opcion=lambda k, v: v, aviso=print,
                                    archivos=lambda tipo: [], local=lambda a: Path(a['ruta']), tj=lambda n: d / n)
        keep = [(0.0, 20.0)]
        kg = [(12.0, 14.0)]
        R.audio(ctx, keep, Mapa(keep, 30, 1.0), [], str(prog), 1.0, 0.5, gancho=(kg, Mapa(kg, 30, 0.0)))
        _, mix = ffm.leer_wav(d / 'render' / 'audio.wav')
        mix = np.asarray(mix, np.float64)
        mix = mix.mean(axis=1) if mix.ndim == 2 else mix
        assert abs(len(mix) / SR - (2.0 + 1.0 + 20.0 + 0.5)) < 0.01, len(mix) / SR

        def rms(a, b):
            return float(np.sqrt((mix[int(a * SR):int(b * SR)] ** 2).mean()))
        assert rms(0.2, 1.6) > 0.05                     # el gancho
        assert rms(2.05, 2.95) < 1e-3                   # la tarjeta de intro (sin musica en esta marca)
        assert rms(3.0 + 12.2, 3.0 + 13.8) > 0.05       # la misma frase en su lugar del programa, corrida 2 + 1 s
        assert rms(3.0 + 2.0, 3.0 + 10.0) < 1e-3


# ---------------------------------------------------------------- duracion objetivo
def prueba_duracion_objetivo():
    assert plan.pedido_duracion(900, None) is None
    assert plan.pedido_duracion(610, 600) is None                         # dentro del 3 %: ya esta
    assert plan.pedido_duracion(900, 600) == {'estimada_s': 900, 'objetivo_s': 600}
    # silencios: un nivel mas apretado cada vez, hasta 'fuerte'
    assert plan.apretar_silencios(0.3, 1.0, 0.3)[0] == 'normal'
    nivel, v = plan.apretar_silencios(0.35, 0.6, 0.18)
    assert nivel == 'fuerte' and v['silencio_k'] == 0.4
    assert plan.apretar_silencios(0.4, 0.4, 0.12) is None
    # lo que se le pide a Claude dice cuanto dura, cuanto deberia y que no corte a mitad de frase
    txt = G.pedidos_extra(duracion={'estimada_s': 900, 'objetivo_s': 600})[0]
    assert 'unos 15 min' in txt and 'unos 10 min' in txt and 'unos 5 min' in txt and 'nunca a mitad' in txt, txt
    e = G.esquema(duracion=True)
    assert 'duracion' in e['properties']['cortes']['items']['properties']['tipo']['enum']
    assert 'duracion' not in G.ESQUEMA['properties']['cortes']['items']['properties']['tipo']['enum']   # sin tocar el base
    assert G.esquema() is G.ESQUEMA and 'gancho' in G.esquema(gancho=True)['properties']


def prueba_cortes_por_duracion_a_frases_completas():
    segs = [_seg(0, 5, 'uno dos'), _seg(5.2, 9, 'tres cuatro'), _seg(9.5, 14, 'cinco seis'), _seg(14.2, 20, 'siete')]
    cortes = [{'inicio': 6.0, 'fin': 13.0, 'motivo': 'divaga', 'tipo': 'duracion'},
              {'inicio': 1.0, 'fin': 1.5, 'motivo': 'nada entero', 'tipo': 'duracion'},
              {'inicio': 2.0, 'fin': 3.0, 'motivo': 'privado', 'tipo': 'privado'}]
    out = G.ajustar_cortes_duracion(cortes, segs)
    assert out[0] == {'inicio': 5.2, 'fin': 14, 'motivo': 'divaga', 'tipo': 'duracion'}, out   # de frase entera a frase entera
    assert len(out) == 2 and out[1]['tipo'] == 'privado'                    # el que no cubre una frase se descarta
    g = {'cortes': [dict(out[0], aplicar=True)], 'citas': [{'t': 10.0, 'texto': 'x'}, {'t': 16.0, 'texto': 'y'}],
         'preguntas': [{'inicio': 6.0, 'fin': 30}], 'capitulos': [{'inicio': 0, 'titulo': 'a'}, {'inicio': 7.0, 'titulo': 'b'}]}
    G.respetar_cortes_duracion(g)
    assert g['citas'][0]['omitir'] and 'corte por duración' in g['citas'][0]['revisar'] and not g['citas'][1].get('omitir')
    assert g['preguntas'][0]['inicio'] == 14 and g['capitulos'][1]['inicio'] == 14 and g['capitulos'][0]['inicio'] == 0


def prueba_pedido_del_guion_igual_sin_opciones():
    """Sin gancho, duracion ni b-roll, el pedido a Claude es byte a byte el de antes."""
    pedidos = []
    antes = G.ia.pedir_json
    G.ia.pedir_json = lambda s, c, e, n, **kw: pedidos.append((s, c, e)) or {}
    try:
        ctx = types.SimpleNamespace(spec={'titulo': 'T', 'notas_editoriales': ''}, archivos=lambda t: [],
                                    marca=types.SimpleNamespace(cfg={'nombre': 'Plogy'}), estado={})
        segs = [{'inicio': 1.0, 'fin': 2.0, 'texto': 'hola'}]
        G.proponer(ctx, segs, 600, [{'nombre': 'Ana', 'rol': 'host'}])
        s, c, e = pedidos[-1]
        assert c == ('Título: T\nDuración: 10 min\nPersonas: Ana (host)\nNotas editoriales de quien pidió la edición: ninguna\n'
                     'Archivos ilustrativos disponibles: ninguno\n\nTranscripción:\n[00:01.0] hola'), repr(c)
        assert e is G.ESQUEMA
        # con fotos sueltas y cadencia: las fotos cuentan como ilustraciones y va el ritmo
        fotos = {'foto': [{'tipo': 'foto', 'ruta': 'p/x/a.jpg', 'nombre': 'a.jpg'}],
                 'ilustracion': [{'tipo': 'ilustracion', 'ruta': 'p/x/b.mp4', 'nombre': 'b.mp4'}]}
        ctx.archivos = lambda t: fotos.get(t, [])
        G.proponer(ctx, segs, 600, [], gancho=True, broll_min=1.5)
        s, c, e = pedidos[-1]
        assert 'disponibles: b.mp4, a.jpg\n' in c and 'GANCHO:' in c and 'uno cada 1,5 min' in c, c
        assert 'gancho' in e['properties']
    finally:
        G.ia.pedir_json = antes


def prueba_ilustraciones_a_ritmo():
    segs = [_seg(float(t), float(t) + 4, 'una frase') for t in range(0, 600, 5)]
    ilus = [{'archivo': 'a.jpg', 't': None, 'porque': 'Sin ubicar: elige el momento'},
            {'archivo': 'b.mp4', 't': 300.0, 'porque': 'se habla del local'},
            {'archivo': 'c.png', 't': None}, {'archivo': 'd.png', 't': None}]
    out = G.ubicar_ilustraciones([dict(x) for x in ilus], segs, 600, cada_s=90, prohibidos=[(100.0, 200.0)])
    ts = sorted(il['t'] for il in out)
    assert all(il['t'] is not None for il in out), out
    assert out[1]['t'] == 300.0 and out[1]['porque'] == 'se habla del local'       # la que ubico Claude no se mueve
    assert all(b - a >= 20 for a, b in zip(ts, ts[1:])), ts                        # separadas
    assert all(not (100 <= t < 200) for t in ts), ts                                 # fuera de lo cortado
    assert all(t % 5 == 0 for t in ts), ts                                           # al empezar una frase
    assert out[0]['porque'] == '' and 'revisar' in out[0]
    # sin cadencia tambien se reparten (antes quedaban fuera del video)
    sin = G.ubicar_ilustraciones([{'archivo': 'x', 't': None}, {'archivo': 'y', 't': None}], segs, 600)
    assert [il['t'] for il in sin] == [165.0, 435.0], sin


# ---------------------------------------------------------------- lienzos 9:16 y 1:1
def prueba_lienzos():
    lz = Lienzo('9:16', 'camaras')
    assert (lz.LW, lz.LH, lz.bh, lz.modo) == (1080, 1920, 608, 'reencuadre')
    f, et = lz.reencuadrar('[base]', 'AC', 0.5)
    assert 'crop=608:1080:656:0,scale=1080:1920' in f and et == '[lz]', f
    f, _ = lz.reencuadrar('[base]', 'AC', 0.95)
    assert 'crop=608:1080:1312:0' in f, f                     # la cara cerca del borde: la ventana no se sale
    f, _ = lz.reencuadrar('[base]', 'TWO', 0.5)
    assert 'vstack' in f and 'scale=1080:960' in f, f       # el plano doble se apila
    assert lz.pieza({'tipo': 'rotulo'}) == (1080, 608, 0, 1920 - 608 - 96)
    assert lz.pieza({'tipo': 'video', 'proteger': True})[3] == (1920 - 608) // 2
    uno = Lienzo('1:1', 'una_camara')
    assert 'crop=1080:1080:420:0' in uno.reencuadrar('[base]', 'C0', 0.5)[0]
    meet = Lienzo('1:1', 'meet')
    assert meet.modo == 'encajar' and 'overlay=0:236' in meet.encajar('[v3]')[0]
    try:
        Lienzo('16:9', 'camaras')
        assert False, 'debio fallar'
    except ValueError:
        pass


class _Comp:
    """Un compositor de mentira: barras de color de 1920x1080 con una 'cara' a la derecha."""

    def firma(self, toma):
        return ['prueba', toma['plano']]

    def centro(self, toma):
        return 0.8

    def entradas(self, toma, t, n):
        return (['-f', 'lavfi', '-t', f'{n / 30 + 0.3:.3f}', '-i', 'testsrc2=s=1920x1080:r=30'],
                '[0:v]setpts=PTS-STARTPTS,fps=30,setsar=1[base]', '[base]', 1)


def prueba_render_vertical():
    """Un trozo de verdad a 9:16 y a 1:1 con una pieza encima, sus subtitulos y la tarjeta de intro."""
    if not _hay_ffmpeg():
        print('      (sin ffmpeg: se salta)')
        return
    with tempfile.TemporaryDirectory() as d:
        d = Path(d)
        pieza = d / 'pieza.mov'
        subprocess.run([config.FFMPEG, '-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i',
                        'color=c=red@0.6:s=1920x1080:r=30:d=1,format=argb', '-c:v', 'qtrle', str(pieza)], check=True)
        ctx = types.SimpleNamespace(W=1920, H=1080, FPS=30)
        piezas = [{'tipo': 'rotulo', 'pieza': str(pieza), 'o0': 5, 'o1': 25, 'capa': 3}]
        tomas = [{'a': 0.0, 'b': 10.0, 'plano': 'AC'}]
        for formato, tipo, tam in (('9:16', 'camaras', (1080, 1920)), ('1:1', 'meet', (1080, 1080))):
            out = R.render_trozo(ctx, _Comp(), (0, 30, 0.0), piezas, tomas, d, lienzo=Lienzo(formato, tipo))
            info = ffm.sondear(out)
            assert (info['ancho'], info['alto']) == tam and ffm.cuadros_de(out) == 30, (formato, info)
        # el de 16:9 no cambia de nombre (misma firma de siempre) ni de tamaño
        a = R.render_trozo(ctx, _Comp(), (0, 30, 0.0), piezas, tomas, d)
        assert (ffm.sondear(a)['ancho'], ffm.sondear(a)['alto']) == (1920, 1080)
        # subtitulos quemados sobre el trozo vertical: mismos cuadros, mismo tamaño
        v = R.render_trozo(ctx, _Comp(), (0, 30, 0.0), piezas, tomas, d, lienzo=Lienzo('9:16', 'camaras'))
        sx = types.SimpleNamespace(W=1920, H=1080, marca=types.SimpleNamespace(dir=d))
        cab, ev, _ = S.armar(sx, [(0.1, 0.5, 'hola'), (0.5, 0.9, 'mundo')], [], '9:16', 0.6, 0.6, d, 'v')
        con = S.quemar(v, S.ass_de_tramo(cab, ev, 0.0, 1.0), 30, d)
        info = ffm.sondear(con)
        assert (info['ancho'], info['alto']) == (1080, 1920) and ffm.cuadros_de(con) == 30, info
        # la tarjeta de intro en su lienzo
        png = d / 't.png'
        subprocess.run([config.FFMPEG, '-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i',
                        'color=c=orange:s=1080x1920', '-frames:v', '1', str(png)], check=True)
        t = R.tarjeta_clip(types.SimpleNamespace(W=1920, H=1080, FPS=30), png, 1.0, d / 'intro.mp4', 0.4, (1080, 1920))
        info = ffm.sondear(t)
        assert (info['ancho'], info['alto']) == (1080, 1920), info


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
