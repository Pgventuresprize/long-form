"""Las reglas de los tipos de grabacion, sin video: señales y fuentes inventadas.

    python tests/prueba_tipos.py        (desde long-form/motor)

Las pruebas con video real (una por tipo) estan en tests/prueba_tipos_video.py.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from editor import tipos  # noqa: E402
from editor.etapas import clasificar as C  # noqa: E402
from editor.etapas import contenido, una_camara  # noqa: E402


def s(**kw):
    base = {'cuadros': 16, 'caras': 0.0, 'personas': 0, 'borde_meet': 0.0, 'fondo_meet': 0.0, 'plano': 0.1,
            'laminas': None, 'cortes_min': 0.0, 'audio': True}
    base.update(kw)
    return base


def prueba_decidir_una_pista():
    assert C.decidir([('A', s(borde_meet=0.6, fondo_meet=0.4))], False)[0] == 'meet'
    assert C.decidir([('A', s(fondo_meet=0.45, caras=0.5))], False)[0] == 'meet'
    t, conf, _, _, roles = C.decidir([('A', s(laminas=0.6, plano=0.6, caras=0.5))], True)
    assert (t, conf, roles['camara']) == ('charla', 'alta', 'A')
    assert C.decidir([('A', s(caras=0.9, cortes_min=4.2))], False)[0] == 'podcast'
    t, conf, *_ = C.decidir([('A', s(caras=0.9, cortes_min=0.2))], False)
    assert (t, conf) == ('una_camara', 'alta')
    assert C.decidir([('A', s(caras=0.05, plano=0.7))], False)[0] == 'pantalla'
    t, conf, _, cands, _ = C.decidir([('A', s(caras=0.2, plano=0.3, cortes_min=1.0))], False)
    assert conf == 'baja' and set(cands) == {'una_camara', 'pantalla', 'podcast'}
    # con PDF pero sin laminas visibles, una camara sigue siendo una camara
    assert C.decidir([('A', s(caras=0.8, laminas=0.0))], True)[0] == 'una_camara'


def prueba_decidir_varias_pistas():
    t, _, _, _, roles = C.decidir([('A', s(caras=0.9)), ('B', s(caras=0.8))], False)
    assert t == 'camaras' and roles == {}
    t, _, _, _, roles = C.decidir([('A', s(caras=0.9)), ('B', s(caras=0.0, plano=0.7))], True)
    assert t == 'charla' and roles == {'contenido': 'B', 'camara': 'A'}
    t, _, _, _, roles = C.decidir([('A', s(caras=0.0, plano=0.8)), ('B', s(caras=0.7))], False)
    assert t == 'pantalla' and roles == {'contenido': 'A', 'camara': 'B'}


def f(clave, nombre, ancho=1920, alto=1080, fps=30, creado=None, audio=True):
    return {'clave': clave, 'nombre': nombre, 'ancho': ancho, 'alto': alto, 'fps': fps, 'creado': creado, 'audio': audio}


def prueba_partes():
    # todo suena a la vez: nada que unir
    assert C.grupos_de_partes([f('A', 'a'), f('B', 'b')], {(0, 1): 0.9})[0] == [[0], [1]]
    # una camara en dos partes: se unen en orden de nombre (natural: 2 antes que 10)
    g, av = C.grupos_de_partes([f('A', 'C0010.MP4'), f('B', 'C0002.MP4')], {(0, 1): 0.0})
    assert g == [[1, 0]] and av is None
    # con fecha en todas, manda la fecha
    g, _ = C.grupos_de_partes([f('A', 'b.mp4', creado='2026-11-05T10:00:00Z'), f('B', 'a.mp4', creado='2026-11-05T11:00:00Z')], {(0, 1): 0.0})
    assert g == [[0, 1]]
    # dos camaras grabadas en dos partes cada una: se une cada camara con la suya
    fs = [f('A', 'cam1_1', 3840, 2160), f('B', 'cam2_1', 1920, 1080), f('C', 'cam1_2', 3840, 2160), f('D', 'cam2_2', 1920, 1080)]
    pares = {(0, 1): 0.9, (2, 3): 0.8, (0, 2): 0.0, (0, 3): 0.0, (1, 2): 0.0, (1, 3): 0.0}
    g, av = C.grupos_de_partes(fs, pares)
    assert sorted(g) == [[0, 2], [1, 3]] and av is None
    # sin forma de saber de que camara es cada parte: no se une nada y se avisa
    fs = [f('A', 'x1'), f('B', 'x2'), f('C', 'x3', 1280, 720)]
    g, av = C.grupos_de_partes(fs, {(0, 1): 0.9, (0, 2): 0.0, (1, 2): 0.0})
    assert g == [[0], [1], [2]] and av
    # un video mudo (la pantalla) nunca es "la parte siguiente": corre a la vez
    g, _ = C.grupos_de_partes([f('A', 'camara'), f('B', 'pantalla', audio=False)], {})
    assert g == [[0], [1]]


def prueba_corte_j():
    t = tipos.corte_j([{'a': 0, 'b': 10, 'plano': 'AW'}, {'a': 10, 'b': 20, 'plano': 'BC'}, {'a': 20, 'b': 20.5, 'plano': 'AW'}], 30, 4)
    assert abs(t[0]['b'] - (10 + 4 / 30)) < 1e-3 and abs(t[1]['a'] - t[0]['b']) < 1e-9
    assert t[2]['a'] == 20      # un plano de medio segundo no se toca
    # mismo plano seguido: no hay corte que correr
    t = tipos.corte_j([{'a': 0, 'b': 5, 'plano': 'W'}, {'a': 5, 'b': 9, 'plano': 'W'}])
    assert t[0]['b'] == 5


def prueba_color():
    fc = tipos.factores_color({'A': [100, 120, 140], 'B': [110, 120, 100]}, 'A')
    assert fc['A'] == [1.0, 1.0, 1.0]
    assert fc['B'][0] < 1 and fc['B'][2] == 1.12         # se limita a +12 %
    assert tipos.filtro_color([1.0, 1.0, 1.0]) == ''
    assert tipos.filtro_color(fc['B']).startswith('colorchannelmixer=rr=1.12')


def prueba_una_camara():
    det = [{'t': i * 2.0, 'caras': [[400, 300, 200, 200], [1400, 320, 190, 190]]} for i in range(20)]
    ps = una_camara.agrupar(det, 1920)
    assert [p['id'] for p in ps] == ['p1', 'p2'] and ps[0]['cx'] < ps[1]['cx']
    enc = una_camara.encuadres({'ancho': 1920, 'alto': 1080}, ps, 1920, 1080)
    assert enc['W'] is None and 'C0' in enc and 'C1' in enc
    for k in ('C0', 'C1'):
        cw, ch, x, y = enc[k]
        assert abs(cw / ch - 16 / 9) < 0.02 and cw >= 1920 / una_camara.AMPLIACION_MAX - 2 and x + cw <= 1920 and y + ch <= 1080
    # vertical: el abierto es un recorte 16:9 a todo lo ancho, alrededor de las caras
    ps = una_camara.agrupar([{'t': 0, 'caras': [[400, 700, 300, 300]]}] * 10, 1080)
    enc = una_camara.encuadres({'ancho': 1080, 'alto': 1920}, ps, 1920, 1080)
    assert enc['W'][0] == 1080 and abs(enc['W'][0] / enc['W'][1] - 16 / 9) < 0.02


def prueba_voz_a_persona():
    nan = float('nan')
    # p2 siempre mueve mas la boca (cara mas grande, se rie al escuchar): eso no la hace duena de todas las voces
    medidas = {}
    voz = {}
    for i in range(30):
        habla_p1 = i % 3 != 0
        medidas[i] = [5.0 + (i % 2), 6.0] if habla_p1 else [2.5, 11.0 + (i % 2)]
        voz[i] = 0 if habla_p1 else 1
    medidas[4] = [nan, 6.0]                   # a p1 no se le vio la cara en esa frase
    voz[30] = 2                               # una voz con una sola frase: sin persona
    medidas[30] = [9.0, 1.0]
    assert una_camara.voz_a_persona(voz, medidas, ['p1', 'p2']) == {0: 'p1', 1: 'p2'}
    # dos grupos que son la misma voz partida: los dos van a la misma persona
    voz2 = {i: (3 if (v == 0 and i % 2) else v) for i, v in voz.items()}
    r = una_camara.voz_a_persona(voz2, medidas, ['p1', 'p2'])
    assert r[0] == 'p1' and r[3] == 'p1' and r[1] == 'p2', r
    assert una_camara.voz_a_persona({}, {}, ['p1', 'p2']) == {}


def prueba_voces():
    import numpy as np
    from editor import voces
    rng = np.random.default_rng(1)
    t = np.arange(int(voces.SR * 2.0)) / voces.SR

    def voz(f0, brillo):
        # una "voz": armonicos de f0 con su propia envolvente espectral, y algo de ruido
        x = sum(np.sin(2 * np.pi * f0 * k * t) * brillo ** k for k in range(1, 15))
        return (x * (0.6 + 0.4 * np.sin(2 * np.pi * 3 * t)) + 0.05 * rng.standard_normal(len(t))).astype(np.float32)
    hs = [voces.huella(voz(110 * (1 + 0.03 * rng.standard_normal()), 0.85)) for _ in range(8)]
    hs += [voces.huella(voz(220 * (1 + 0.03 * rng.standard_normal()), 0.55)) for _ in range(6)]
    hs.append(voces.huella(np.zeros(1000, np.float32)))      # demasiado corto: sin huella
    e = voces.agrupar(hs, 2)
    assert e[-1] == -1 and len(set(e[:8])) == 1 and len(set(e[8:14])) == 1 and e[0] != e[8], e


def prueba_pantalla():
    c = contenido._caja_16x9([800, 500, 100, 40], 1920, 1080)
    cw, ch, x, y = c
    assert abs(cw / ch - 16 / 9) < 0.02 and cw >= 1920 / contenido.ZOOM_MAX - 2
    assert x <= 800 and x + cw >= 900 and y <= 500 and y + ch >= 540
    assert contenido._dentro([850, 510, 20, 10], c)


def prueba_charla_sigue_las_laminas():
    pasos = [{'a': t, 'b': t + 2, 'f': 'S', 'pag': 3 + int(t // 15)} for t in range(0, 60, 2)]
    pasos[10]['pag'] = 9                     # una lamina que se vio un instante (2 s)
    t = contenido._fundir(pasos, ('f', 'pag'), 3.0)
    assert [x['pag'] for x in t] == [3, 4, 5, 6], t
    assert t[0]['a'] == 0 and t[-1]['b'] == 60 and all(a['b'] == b['a'] for a, b in zip(t, t[1:]))


def prueba_trozos_cortos():
    from editor.contexto import Mapa
    from editor.etapas import render
    mapa = Mapa([(0.0, 120.0)], 30, 5.4)
    cs = render.trozos([(0.0, 120.0)], mapa, [{'a': 0.0, 'b': 120.0, 'plano': 'W'}], [{'o0': 1802, 'o1': 2162}])
    assert max(v - u for u, v, _ in cs) <= render.MAX_TROZO
    assert cs[0][0] == 0 and cs[-1][1] == 3600 and all(a[1] == b[0] for a, b in zip(cs, cs[1:]))
    assert any(u == 1802 for u, _, _ in cs) and any(u == 2162 for u, _, _ in cs)     # los bordes de las piezas siguen ahi
    for u, _, t in cs:
        assert abs(t - u / 30) < 1e-6                                                   # cada trozo sabe su segundo


def prueba_nombre_con_tildes():
    """ffmpeg escribe el nombre del archivo en UTF-8; leerlo con la codificacion de Windows tumbaba clasificar
    ("Grabación de pantalla..." de Mac)."""
    import os
    import shutil
    import tempfile
    from editor import ffm
    muestra = Path(os.environ.get('LF_MUESTRAS', r'C:\Users\juanf\lf-local\muestras')) / 'tipos' / 'C0001.MP4'
    if not muestra.exists():
        print('      (sin muestra C0001.MP4: se salta)')
        return
    with tempfile.TemporaryDirectory() as d:
        # la "Á" es 0xC3 0x81 en UTF-8, y 0x81 no existe en cp1252; macOS pone un espacio angosto antes de "p.m."
        ruta = Path(d) / 'Grabación de pantalla 2026-11-05 a la(s) 7.35.14 p.m. ÁREA ñandú.mp4'
        shutil.copy(muestra, ruta)
        import subprocess
        from editor import config
        crudo = subprocess.run([config.FFPROBE, '-hide_banner', str(ruta)], capture_output=True).stderr
        try:
            crudo.decode('cp1252')        # lo que hacia text=True en Windows
            assert False, 'el nombre de prueba ya no reproduce la falla'
        except UnicodeDecodeError:
            pass
        assert ffm.sondear(ruta)['duracion'] > 50
        assert C.cortes_por_minuto(str(ruta), 60.0) >= 0


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
