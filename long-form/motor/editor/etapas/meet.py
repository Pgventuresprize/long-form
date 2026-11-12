"""Etapa 2 (grabación de Meet) · Quién habla, qué se proyecta y propuesta de reparto.

Portado de scan.py, tramos.py, slides.py, share.py, tomas.py y layers.py del taller de Plogy Studio.

En una grabacion de pantalla de Meet no hay camaras separadas: todo esta dentro de la interfaz. El talk show
se reconstruye recortando y recomponiendo:
- Quién habla: el borde celeste (#A8C7FA aprox.) con que Meet resalta a quien habla. Las detecciones
  seguidas del mismo recuadro forman tramos; los nombres se leen de la etiqueta de Meet (Claude con vision)
  y una persona los confirma en la aprobacion 1, junto con las voces que hablan sin camara.
- Qué se proyecta: la lamina del PDF (se reconoce por comparacion de plantillas a varias escalas y en
  pantalla va la imagen ORIGINAL del PDF, no la captura) o la pantalla compartida (el rectangulo que no es
  fondo de Meet), o nada (galeria). Las fases se proponen solas y se confirman en la aprobacion 1.
"""
import json

import numpy as np

from .. import ia
from .. import tipos

AZUL_MAX_ANCHO = 0.40      # un recuadro de persona nunca es mas ancho que esto (fraccion del cuadro clave)
UMBRAL_LAMINA = 0.7       # coincidencias reales: 0,78 a 0,98; la galeria da falsos de hasta 0,67


# ---------------------------------------------------------------- escaneo de cuadros clave
def caja_azul(im):
    """Borde celeste de quien habla en un cuadro clave BGR. Devuelve (x, y, w, h) o None."""
    import cv2
    H, W = im.shape[:2]
    k = W / 1440
    b, g, r = [im[:, :, i].astype(np.int16) for i in range(3)]
    m = ((b > 185) & (r > 120) & (g > 150) & (b - g >= 8) & (b - r >= 8)).astype(np.uint8)
    m[int(H * 0.922):, :] = 0                      # la barra inferior de Meet no cuenta
    nl, _, st, _ = cv2.connectedComponentsWithStats(m, connectivity=8)
    mejor = None
    for i in range(1, nl):
        x, y, w, h, a = st[i]
        if (w > 80 * k and h > 90 * k and (w + h) * 1.2 < a < (w + h) * 16 and 0.5 < w / h < 2.4
                and y + h < H * 0.906 and w < W * AZUL_MAX_ANCHO * 2):
            if mejor is None or w * h > mejor[2] * mejor[3]:
                mejor = (int(x), int(y), int(w), int(h))
    return mejor


def rect_compartido(im_gris, caja):
    """Rectangulo de contenido compartido: el bloque mas grande que no es fondo de Meet y no contiene el
    recuadro resaltado (si lo contiene, es la galeria)."""
    import cv2
    H, W = im_gris.shape
    y0, y1 = int(H * 0.095), int(H * 0.9)
    bg = int(np.median(im_gris[y1 - 4:y1, 5:int(W * 0.2)]))
    m = (np.abs(im_gris.astype(np.int16) - bg) > 6).astype(np.uint8)
    m[:y0] = 0
    m[y1:] = 0
    m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))
    nl, _, st, _ = cv2.connectedComponentsWithStats(m, connectivity=4)
    escenario = (y1 - y0) * W
    mejor = None
    for i in range(1, nl):
        x, y, w, h, a = st[i]
        if w * h < 0.22 * escenario or a < 0.8 * w * h:
            continue
        if caja:
            cx, cy = caja[0] + caja[2] / 2, caja[1] + caja[3] / 2
            if x <= cx <= x + w and y <= cy <= y + h:
                continue
            if caja[2] * caja[3] * 2.5 > w * h:
                continue                           # no es mucho mayor que un recuadro: es otro recuadro
        if mejor is None or w * h > mejor[2] * mejor[3]:
            mejor = (int(x), int(y), int(w), int(h))
    return mejor


class Laminas:
    """Reconoce que lamina del PDF hay en un cuadro (slides.py, a escala de 480 de ancho)."""

    def __init__(self, rutas):
        import cv2
        self.cv2 = cv2
        # cada pagina se reduce una vez a 480 de ancho y de ahi salen todos los tamaños (desde el PNG grande, 40
        # paginas a 35 tamaños tardaban casi un minuto)
        self.paginas = []
        for p in rutas:
            g = cv2.imread(str(p), 0)
            self.paginas.append(cv2.resize(g, (480, round(480 * g.shape[0] / g.shape[1])), interpolation=cv2.INTER_AREA)
                                if g.shape[1] > 480 else g)
        h0, w0 = self.paginas[0].shape
        self.ar = h0 / w0
        # ancho de la lamina en un cuadro reducido a 480: hasta el cuadro entero (una proyeccion grabada de frente
        # o una charla con la lamina a pantalla completa; en Meet nunca pasa de ~460)
        self.anchos = list(range(140, 490, 10))
        self.tpl = {w: [cv2.resize(p, (w, round(w * self.ar)), interpolation=cv2.INTER_AREA) for p in self.paginas]
                    for w in self.anchos}
        # la busqueda gruesa: a la mitad de resolucion, un tamaño de cada tres
        self.tpl2 = {w: [cv2.resize(t, (w // 2, max(1, round(w * self.ar / 2))), interpolation=cv2.INTER_AREA) for t in ts]
                     for w, ts in self.tpl.items() if w in self.anchos[::3]}
        self.cur = None
        self.prev = None

    @staticmethod
    def _match(cv2, fr, t):
        if t.std() < 2 or t.shape[0] > fr.shape[0] or t.shape[1] > fr.shape[1]:
            return -1, None
        r = cv2.matchTemplate(fr, t, cv2.TM_CCOEFF_NORMED)
        _, v, _, loc = cv2.minMaxLoc(r)
        return v, loc

    def _score(self, fr, pag, w):
        return self._match(self.cv2, fr, self.tpl[w][pag])

    def buscar(self, gris):
        cv2 = self.cv2
        fr = cv2.resize(gris, (480, round(480 * gris.shape[0] / gris.shape[1])), interpolation=cv2.INTER_AREA)
        # el mismo cuadro que el anterior (la lamina quieta mientras se habla): el mismo resultado
        if self.prev is not None and self.prev[0].shape == fr.shape and float(cv2.absdiff(fr, self.prev[0]).mean()) < 1.5:
            return self.prev[1]
        mejor = (-1, None, None, None)
        if self.cur:
            # la lamina de antes, la siguiente o la anterior (avanzan de a una), al mismo tamaño. Vale si supera 0,8
            # o si su puntaje no cayo de golpe (una lamina tapada en parte puntua parejo mas bajo, y buscar en todo
            # el PDF en cada cuadro es lo que hacia lento el analisis)
            p0, w0, v0 = self.cur
            for p in (p0, p0 + 1, p0 - 1):
                if 0 <= p < len(self.paginas):
                    v, loc = self._score(fr, p, w0)
                    if v > mejor[0]:
                        mejor = (v, p, w0, loc)
            vale = lambda m: m[0] > 0.8 or (m[0] > UMBRAL_LAMINA and m[0] >= v0 - 0.06)  # noqa: E731
            if not vale(mejor):
                # la misma lamina a otro tamaño (Meet cambia el diseño al entrar o salir alguien)
                for w in self.anchos:
                    v, loc = self._score(fr, p0, w)
                    if v > mejor[0]:
                        mejor = (v, p0, w, loc)
            if not vale(mejor):
                mejor = (-1, None, None, None)
        if mejor[1] is None:
            # gruesa a media resolucion para quedarse con tres paginas; esas tres, a resolucion completa
            fr2 = cv2.resize(fr, (fr.shape[1] // 2, fr.shape[0] // 2), interpolation=cv2.INTER_AREA)
            grueso = {}
            for w, ts in self.tpl2.items():
                for p, t in enumerate(ts):
                    v, _ = self._match(cv2, fr2, t)
                    grueso[p] = max(grueso.get(p, -1), v)
            for p in sorted(grueso, key=grueso.get, reverse=True)[:3]:
                for w in self.anchos[::3]:
                    v, loc = self._score(fr, p, w)
                    if v > mejor[0]:
                        mejor = (v, p, w, loc)
            if mejor[1] is not None:
                for w in self.anchos:
                    v, loc = self._score(fr, mejor[1], w)
                    if v > mejor[0]:
                        mejor = (v, mejor[1], w, loc)
        self.cur = (mejor[1], mejor[2], mejor[0]) if mejor[0] > UMBRAL_LAMINA else None
        res = (mejor[1] + 1, round(float(mejor[0]), 3)) if mejor[0] > UMBRAL_LAMINA else (None, round(float(mejor[0]), 3))
        self.prev = (fr, res)
        return res


def escanear(ctx, info):
    import cv2
    kf = sorted(ctx.tj('kf').glob('*.jpg'))
    paso = info['kf']['paso']
    lam = None
    if ctx.estado['ingesta'].get('laminas'):
        lam = Laminas(sorted(ctx.tj('pdf').glob('p*.png')))
    out = []
    fallos = 0
    for n, f in enumerate(kf):
        if n % 50 == 0:
            ctx.avance(f'Revisando cuadros {n} de {len(kf)}', .05 + .6 * n / len(kf))
        im = cv2.imread(str(f))
        if im is None:
            continue
        gris = cv2.cvtColor(im, cv2.COLOR_BGR2GRAY)
        caja = caja_azul(im)
        # sin lamina en los ultimos cuadros (pantalla compartida o galeria): se busca solo cada 8 s
        if lam and (fallos < 3 or n % 4 == 0):
            pag, v = lam.buscar(gris)
            fallos = 0 if pag else fallos + 1
        else:
            pag, v = None, 0
        sh = rect_compartido(gris, caja)
        out.append({'t': n * paso, 'caja': caja, 'pag': pag, 'v': v, 'share': sh})
    return out


# ---------------------------------------------------------------- tramos de quien habla
def _igual(a, b, tol):
    return a and b and all(abs(x - y) <= tol for x, y in zip(a, b))


def tramos(esc, tol=14, hueco=12):
    tr = []
    for o in esc:
        b = o['caja']
        if not b:
            continue
        if tr and _igual(tr[-1]['caja'], b, tol) and o['t'] - tr[-1]['t1'] <= hueco:
            tr[-1]['t1'] = o['t']
            tr[-1]['n'] += 1
        else:
            tr.append({'t0': o['t'], 't1': o['t'], 'caja': b, 'n': 1})
    return [t for t in tr if t['n'] >= 2]


def refina(im, b):
    """El borde se parte en la insignia de audio: el lado derecho real es la columna celeste de la mitad baja."""
    x, y, w, h = b
    I = im.astype(np.int16)
    B, G, R = I[:, :, 0], I[:, :, 1], I[:, :, 2]
    m = (B > 190) & (R > 130) & (R < 215) & (G >= R - 5) & (G < B + 5) & (B - R > 20)
    filas = m[y + h // 2:y + h - 8]
    if filas.size == 0:
        return b
    cuenta = filas.mean(0)
    ini, fin = max(x + w - 6, 0), min(x + w + 44, im.shape[1] - 1)
    if fin <= ini:
        return b
    k = int(np.argmax(cuenta[ini:fin])) + ini
    return (x, y, k - x + 1, h) if cuenta[k] > 0.5 else b


def fases(esc, paso):
    """F galeria · S lamina del PDF · C pantalla compartida; suavizado y tramos de al menos 6 s."""
    cod = []
    for o in esc:
        if o['pag']:
            cod.append('S')
        elif o['share']:
            cod.append('C')
        else:
            cod.append('F')
    # mediana movil de 5 cuadros clave (10 s)
    sua = list(cod)
    for i in range(len(cod)):
        v = cod[max(0, i - 2):i + 3]
        sua[i] = max(set(v), key=v.count)
    out = []
    for i, c in enumerate(sua):
        t = esc[i]['t']
        if out and out[-1]['fase'] == c:
            out[-1]['b'] = t + paso
        else:
            out.append({'a': t, 'b': t + paso, 'fase': c})
    # los tramos cortos se funden con el anterior
    limpio = []
    for f in out:
        if limpio and f['b'] - f['a'] < 6:
            limpio[-1]['b'] = f['b']
        elif limpio and limpio[-1]['fase'] == f['fase']:
            limpio[-1]['b'] = f['b']
        else:
            limpio.append(f)
    return limpio


def presets_compartido(esc, escala):
    """Los rectangulos de pantalla compartida se agrupan en pocos tamaños fijos: el encuadre no tiembla."""
    rs = [o['share'] for o in esc if o['share'] and not o['pag']]
    grupos = []
    for r in rs:
        for g in grupos:
            if _igual(g['r'], r, 12):
                g['n'] += 1
                break
        else:
            grupos.append({'r': r, 'n': 1})
    grupos = [g for g in grupos if g['n'] >= 2] or grupos
    return [[int(v * escala) & ~1 for v in g['r']] for g in sorted(grupos, key=lambda g: -g['n'])[:6]]


# ---------------------------------------------------------------- analisis (etapa 2)
KF_PASO = 2.0
KF_ANCHO = 1440


def cuadros_clave(ctx, info):
    """Un cuadro cada 2 s a 1440 de ancho (borde de quien habla, laminas, pantalla compartida). Aqui se decodifica
    todo, no solo los cuadros clave: el resto del analisis cuenta con un cuadro cada 2 s exactos."""
    from .. import ffm
    kf = ctx.tj('kf')
    kf.mkdir(exist_ok=True)
    if not any(kf.glob('*.jpg')):
        ctx.avance('Sacando cuadros clave cada 2 s', .02)
        ancho = min(KF_ANCHO, info['ancho'])
        ffm.correr(['-i', info['archivo'], '-vf', f'fps={1 / KF_PASO},scale={ancho}:-2:flags=area', '-q:v', '3',
                    str(kf / '%05d.jpg')])
    n = len(list(kf.glob('*.jpg')))
    info['kf'] = {'paso': KF_PASO, 'n': n, 'escala': info['ancho'] / min(KF_ANCHO, info['ancho'])}
    ctx.log(f'{n} cuadros clave')
    return info


def correr(ctx):
    import cv2

    from .. import tipos
    info = cuadros_clave(ctx, dict(tipos.fuentes(ctx)[0]))
    if not info.get('audio') and not tipos.audio_aparte(ctx):
        raise RuntimeError('La grabación de Meet no tiene audio')
    tipos.escribir_programa(ctx, info['clave'], 0.0, info['duracion'])
    esc = escanear(ctx, info)
    ctx.json_trabajo('escaneo.json', esc)
    paso = info['kf']['paso']
    ctx.avance('Agrupando a quien habla', .7)
    tr = tramos(esc)
    for t in tr:
        n = int((t['t0'] + t['t1']) / 2 / paso)
        im = cv2.imread(str(ctx.tj('kf') / f'{n + 1:05d}.jpg'))
        if im is not None:
            t['caja'] = list(refina(im, t['caja']))
    fz = fases(esc, paso)
    pres = presets_compartido(esc, info['kf']['escala'])
    from collections import Counter
    ctx.log(f"{len(tr)} tramos de quien habla; fases: " +
            ', '.join(f"{k} {v}" for k, v in Counter(f['fase'] for f in fz).items()) +
            f"; {len(pres)} encuadres de pantalla compartida")
    sin = sum(1 for o in esc if not o['caja']) / max(len(esc), 1)
    if sin > 0.4:
        ctx.aviso(f'En el {sin:.0%} de la grabación no se ve el borde de quien habla: puede que tenga la cámara '
                  'apagada o que la vista de Meet no lo muestre. Revisa las voces sin cámara.')
    ctx.guardar('analisis', {'tramos': tr, 'fases': fz, 'presets': pres, 'paso': paso,
                             'escala': info['kf']['escala'], 'ancho': info['ancho'], 'alto': info['alto'],
                             'inicio': 0.0, 'fin': info['duracion']})


# ---------------------------------------------------------------- propuesta de reparto (fin de la transcripcion)
def _miniatura(ctx, t, caja, nombre, ancho=320):
    import cv2
    an = ctx.estado['analisis']
    n = int(t / an['paso'])
    im = cv2.imread(str(ctx.tj('kf') / f'{n + 1:05d}.jpg'))
    x, y, w, h = caja
    c = im[y:y + h, x:x + w]
    k = ancho / max(w, 1)
    cv2.imwrite(str(ctx.salida / nombre), cv2.resize(c, None, fx=k, fy=k, interpolation=cv2.INTER_AREA), [cv2.IMWRITE_JPEG_QUALITY, 85])
    return nombre


def _grupos(tr):
    """Tramos con el mismo recuadro (posicion y tamaño parecidos) son, casi siempre, la misma persona."""
    grupos = []
    for i, t in enumerate(tr):
        for g in grupos:
            if _igual(g['caja'], t['caja'], 30):
                g['tramos'].append(i)
                break
        else:
            grupos.append({'caja': t['caja'], 'tramos': [i]})
    return grupos


def _nombres_por_vision(ctx, tr, grupos):
    """Claude lee la etiqueta de nombre que Meet pinta abajo a la izquierda de cada recuadro."""
    import cv2
    an = ctx.estado['analisis']
    bloques = [{'type': 'text', 'text': 'Cada imagen es el recuadro de una persona en Google Meet. Lee el nombre de la '
                                        'etiqueta (abajo a la izquierda). Si no se lee, deja el nombre vacío.'}]
    for gi, g in enumerate(grupos):
        t = tr[g['tramos'][0]]
        n = int((t['t0'] + t['t1']) / 2 / an['paso'])
        im = cv2.imread(str(ctx.tj('kf') / f'{n + 1:05d}.jpg'))
        x, y, w, h = t['caja']
        p = ctx.tj(f'_nom_{gi}.jpg')
        cv2.imwrite(str(p), im[y:y + h, x:x + w])
        bloques += [{'type': 'text', 'text': f'Recuadro {gi}:'}, ia.imagen(p)]
    esquema = {'type': 'object', 'required': ['recuadros'], 'properties': {'recuadros': {'type': 'array', 'items': {
        'type': 'object', 'required': ['indice', 'nombre'], 'properties': {
            'indice': {'type': 'integer'}, 'nombre': {'type': 'string'}}}}}}
    from .. import config
    r = ia.pedir_json('Lees nombres en capturas de videollamadas. Copia el texto tal cual se ve, sin inventar.',
                      bloques, esquema, 'nombres', max_tokens=2000)
    return {x['indice']: x['nombre'].strip() for x in r['recuadros']}


def propuesta_reparto(ctx, segs):
    an = ctx.estado['analisis']
    tr = an['tramos']
    grupos = _grupos(tr)
    try:
        leidos = _nombres_por_vision(ctx, tr, grupos)
    except ia.SinIA:
        leidos = {}
        ctx.aviso('Sin clave de Claude: los nombres de cada recuadro se escriben a mano en el reparto.')
    def norm(x):
        import unicodedata
        x = unicodedata.normalize('NFKD', x or '').encode('ascii', 'ignore').decode().lower()
        return ' '.join(x.replace('…', ' ').replace('...', ' ').split())
    candidatos = [(norm(n), p) for p in ctx.spec.get('personas', []) for n in [p['nombre']] + p.get('alias', [])]

    def buscar(etiqueta):
        e = norm(etiqueta)
        if not e:
            return None
        for n, p in candidatos:
            # Meet corta los nombres largos con «...»: basta con que coincida el principio
            if e == n or (len(e) >= 8 and n.startswith(e)) or (len(n) >= 8 and e.startswith(n)):
                return p
        return None
    # se juntan los grupos con el mismo nombre leido (la persona cambio de lugar en la cuadricula)
    personas = {}
    for gi, g in enumerate(grupos):
        etiqueta = leidos.get(gi, '')
        p = buscar(etiqueta)
        nombre = p['nombre'] if p else ''
        clave = nombre or etiqueta or f'Recuadro {gi + 1}'
        if clave not in personas:
            pid = f'p{len(personas) + 1}'
            t = tr[g['tramos'][0]]
            personas[clave] = {'id': pid, 'tipo': 'recuadro', 'nombre': nombre, 'etiqueta_meet': etiqueta,
                               'rol': p.get('rol', '') if p else '', 'handle': p.get('handle', '') if p else '',
                               'origen': 'proyecto' if p else ('ia' if etiqueta else 'pendiente'),
                               'tramos': [], 'miniatura': _miniatura(ctx, (t['t0'] + t['t1']) / 2, t['caja'], f'persona_{pid}.jpg')}
            if etiqueta and not p:
                personas[clave]['nota'] = (f'Meet dice «{etiqueta}». Si esa cuenta la usaba otra persona, '
                                           'escribe su nombre real: el rótulo dirá el nombre que pongas.')
        personas[clave]['tramos'] += g['tramos']
    total = sum(t['t1'] - t['t0'] + an['paso'] for t in tr) or 1
    for p in personas.values():
        p['voz'] = round(sum(tr[i]['t1'] - tr[i]['t0'] + an['paso'] for i in p['tramos']) / total, 3)
    # voces sin camara: hay voz y ningun recuadro resaltado durante 4 s o mas
    activos = [(t['t0'] - 1, t['t1'] + an['paso'] + 1) for t in tr]
    voces = []
    for s in segs:
        if s['fin'] - s['inicio'] < 4:
            continue
        cubierto = sum(max(0, min(b, s['fin']) - max(a, s['inicio'])) for a, b in activos)
        if cubierto < 0.3 * (s['fin'] - s['inicio']):
            if voces and s['inicio'] - voces[-1]['b'] < 3:
                voces[-1]['b'] = s['fin']
                voces[-1]['texto'] += ' ' + s['texto']
            else:
                voces.append({'a': s['inicio'], 'b': s['fin'], 'nombre': '', 'texto': s['texto']})
    for v in voces:
        v['texto'] = v['texto'][:240]
    return {'tipo': 'meet', 'personas': list(personas.values()), 'voces': voces, 'fases': an['fases'],
            'nota': 'Revisa nombres (quien usaba cada cuenta), las voces sin cámara y las fases (galería, lámina, pantalla).'}


# ---------------------------------------------------------------- tomas (tomas.py)
PASO_TOMA = 1.0


def _pildora(ctx, kfim, tile_kf, dpr):
    """La pildora de hover de Meet (pin, micro, menu) oscurece el centro del recuadro: se detecta por la
    caida de luz en su borde superior e inferior."""
    x, y, w, h = tile_kf
    ph = 44 * dpr / (ctx.estado['analisis']['escala'])          # alto de la pildora en px del cuadro clave
    cx, cy = x + w / 2, y + h / 2
    a, b = int(cx - w * 0.12), int(cx + w * 0.12)
    y0, y1 = int(cy - ph / 2), int(cy + ph / 2)
    if b <= a or y0 < 8 or y1 + 8 >= kfim.shape[0]:
        return False
    im = kfim.astype(np.float32)
    f1, d1 = im[y0 - 6:y0 - 2, a:b].mean(0), im[y0 + 3:y0 + 7, a:b].mean(0)
    f2, d2 = im[y1 + 3:y1 + 7, a:b].mean(0), im[y1 - 7:y1 - 3, a:b].mean(0)
    r1, r2 = np.median(d1 / (f1 + 8)), np.median(d2 / (f2 + 8))
    return bool(min(r1, r2) < 0.74)


def _vertical(kfim, tile_kf):
    """Camara vertical: Meet la rellena con franjas lisas a los lados. Devuelve la fraccion util o None."""
    x, y, w, h = tile_kf
    c = kfim[y + 6:y + h - 6, x + 6:x + w - 6].astype(np.float32)
    if c.size == 0 or w < h:
        return None
    sd = c.std(0)
    lado = int(c.shape[1] * 0.22)
    if sd[:lado].mean() < 4 and sd[-lado:].mean() < 4 and sd[lado:-lado].mean() > 12:
        util = np.where(sd > 6)[0]
        if len(util):
            return (util[0] / c.shape[1], (util[-1] + 1) / c.shape[1])
    return None


def tomas(ctx, rep):
    import cv2
    an = ctx.estado['analisis']
    info = tipos.fuentes(ctx)[0]
    esc = ctx.json_trabajo('escaneo.json')
    paso_kf = an['paso']
    escala = an['escala']
    dpr = 2 if info['ancho'] >= 2560 else 1
    fin = info['duracion']
    tr = an['tramos']
    asign = []
    for p in rep['personas']:
        if not p.get('nombre'):
            continue
        for i in p.get('tramos', []):
            asign.append({**tr[i], 'n': p['nombre']})
    asign.sort(key=lambda k: k['t0'])
    voces = [v for v in rep.get('voces', []) if v.get('nombre')]
    fases_ = rep.get('fases') or an['fases']
    fotos = {p['nombre']: p.get('foto') for p in rep['personas'] if p.get('foto')}

    def persona(t):
        prev = None
        for k in asign:
            if k['t0'] - 1 > t:
                break
            prev = k
        return prev or (asign[0] if asign else None)

    def voz(t):
        return next((v['nombre'] for v in voces if v['a'] <= t < v['b']), None)

    def fase(t):
        return next((f['fase'] for f in fases_ if f['a'] <= t < f['b']), fases_[-1]['fase'] if fases_ else 'F')

    pag_por_t = {o['t']: o['pag'] for o in esc if o['pag']}
    primera = next(iter(pag_por_t.values()), 1)

    def lamina(t):
        k = int(t // paso_kf) * paso_kf
        while k >= 0:
            if pag_por_t.get(float(k)) or pag_por_t.get(k):
                return pag_por_t.get(float(k)) or pag_por_t.get(k)
            k -= paso_kf
        return primera

    presets = an['presets']

    def compartido(t):
        k = min(int(t // paso_kf), len(esc) - 1)
        while k >= 0 and not esc[k]['share']:
            k -= 1
        if k < 0 or not presets:
            return presets[0] if presets else None
        r = [v * escala for v in esc[k]['share']]
        return min(presets, key=lambda p: sum(abs(a - b) for a, b in zip(p, r)))

    def tile_src(b):
        x, y, w, h = b
        m = int(4 * escala)
        X, Y, W, H = x * escala + m, y * escala + m, w * escala - 2 * m, h * escala - 2 * m
        return [int(X) & ~1, int(Y) & ~1, int(W) & ~1, int(H) & ~1]

    cache = {}

    def kf(t):
        n = min(int(t // paso_kf), len(esc) - 1)
        if n not in cache:
            cache.clear()
            cache[n] = cv2.imread(str(ctx.tj('kf') / f'{n + 1:05d}.jpg'), 0)
        return cache[n]

    pcache = {}

    def pill_kf(n, caja):
        clave = (n, tuple(caja))
        if clave not in pcache:
            im = cv2.imread(str(ctx.tj('kf') / f'{n + 1:05d}.jpg'), 0)
            pcache[clave] = bool(im is not None and _pildora(ctx, im, caja, dpr))
        return pcache[clave]

    def pildora_estable(t, caja):
        # solo cuenta si se ve en dos cuadros clave seguidos (4 s): un parpadeo de luz no es la pildora
        n = min(int(t // paso_kf), len(esc) - 1)
        if not pill_kf(n, caja):
            return False
        return (n > 0 and pill_kf(n - 1, caja)) or (n + 1 < len(esc) and pill_kf(n + 1, caja))

    out = []
    t = 0.0
    while t < fin:
        f = fase(t)
        v = voz(t)
        p = persona(t)
        if v:
            it = {'f': f, 'n': v, 'voz': True}
            if fotos.get(v):
                it['foto'] = fotos[v]
        elif p:
            it = {'f': f, 'n': p['n'], 'tile': tile_src(p['caja'])}
            im = kf(t)
            if im is not None:
                it['pill'] = pildora_estable(t, p['caja'])
                vert = _vertical(im, p['caja'])
                if vert:
                    x, y, w, h = it['tile']
                    it['tile'] = [(x + int(w * vert[0])) & ~1, y, int(w * (vert[1] - vert[0])) & ~1, h]
        else:
            it = {'f': f, 'n': '', 'voz': True}
        if f == 'S':
            it['pag'] = lamina(t)
        elif f == 'C':
            it['share'] = compartido(t)
        claves = ('f', 'n', 'tile', 'pag', 'share', 'voz', 'pill', 'foto')
        if out and all(out[-1].get(k) == it.get(k) for k in claves):
            out[-1]['b'] = min(t + PASO_TOMA, fin)
        else:
            it['a'] = t
            it['b'] = min(t + PASO_TOMA, fin)
            out.append(it)
        t += PASO_TOMA
    # al cambiar de fase el recuadro anterior ya no vale: se toma el de la toma siguiente
    for i, s in enumerate(out):
        if (i and s['f'] != out[i - 1]['f'] and 'tile' in s and i + 1 < len(out) and 'tile' in out[i + 1]
                and s['b'] - s['a'] < 12):
            s['tile'] = out[i + 1]['tile']
            s['n'] = out[i + 1]['n']
    # tomas de menos de 3 s de otra persona (interjeccion o ruido) se absorben: evita parpadeos
    limpio = []
    for s in out:
        if (limpio and not s.get('voz') and s['b'] - s['a'] < 3 and s['f'] == limpio[-1]['f']
                and s.get('pag') == limpio[-1].get('pag') and s.get('share') == limpio[-1].get('share')
                and s.get('n') != limpio[-1].get('n')):
            limpio[-1]['b'] = s['b']
        else:
            limpio.append(s)
    from collections import Counter
    ctx.log(f'{len(limpio)} tomas; ' + ', '.join(f'{k} {v}' for k, v in Counter(s['n'] for s in limpio).items()) +
            f"; con píldora de Meet: {sum(1 for s in limpio if s.get('pill'))}")
    if any(s.get('pill') for s in limpio):
        ctx.aviso('Hay tramos con la píldora de Meet (botones que aparecen al pasar el cursor) sobre un recuadro: '
                  'se limpia automáticamente; revisa esos momentos a tamaño real.')
    return limpio


# ---------------------------------------------------------------- escenario (layers.py)
class Escenario:
    """Fondo oscuro de marca, panel de contenido protagonista a la izquierda y columna con quien habla,
    el indice de capitulos y el logo. La capa es un PNG con huecos transparentes donde va el video."""

    def __init__(self, ctx, capitulos):
        self.ctx = ctx
        self.m = ctx.marca
        self.W, self.H = ctx.W, ctx.H
        k = self.W / 1920
        self.k = k
        self.PANEL = tuple(int(v * k) & ~1 for v in (30, 30, 1422, 800))
        self.COL_X, self.COL_W = int(1476 * k), int(414 * k)
        self.RAD_P, self.RAD_C = int(16 * k), int(18 * k)
        self.dir = ctx.tj('capas')
        self.dir.mkdir(exist_ok=True)
        self.caps = [c['titulo'] for c in capitulos] if capitulos else []
        self.caps_t = [c['inicio'] for c in capitulos] if capitulos else []

    def capitulo(self, t):
        cur = 0
        for i, a in enumerate(self.caps_t):
            if a <= t:
                cur = i
        return cur

    def fuente(self, px):
        from PIL import ImageFont
        return ImageFont.truetype(self.m.fuente_ttf, int(px * self.k))

    def fondo(self):
        from PIL import Image
        p = self.dir / f'fondo_{self.W}.png'
        if p.exists():
            return Image.open(p).convert('RGB')
        W, H = self.W, self.H
        y, x = np.mgrid[0:H, 0:W].astype(np.float32)
        im = np.ones((H, W, 3), np.float32) * np.array(self.m.rgb(self.m.c.get('fondo_escenario', '#100d0c')), np.float32)
        st = self.m.degradado
        for cx, cy, r, c, a in ((W * .94, H * 1.04, W * .32, st[0], .30), (W * 1.02, H * .7, W * .29, st[-1], .26),
                                (-W * .04, H * 1.07, W * .32, st[len(st) // 3], .16)):
            d = np.sqrt((x - cx) ** 2 + (y - cy) ** 2) / r
            kk = np.clip(1 - d, 0, 1) ** 2 * a
            col = self.m.rgb(c)
            for i in range(3):
                im[:, :, i] += (col[i] - im[:, :, i]) * kk
        im += np.random.default_rng(3).normal(0, 1.1, im.shape)      # grano fino: evita bandas
        Image.fromarray(np.clip(im, 0, 255).astype(np.uint8)).save(p)
        return Image.open(p).convert('RGB')

    @staticmethod
    def redondo(w, h, r, ss=3):
        from PIL import Image, ImageDraw
        m = Image.new('L', (w * ss, h * ss), 0)
        ImageDraw.Draw(m).rounded_rectangle((0, 0, w * ss - 1, h * ss - 1), radius=r * ss, fill=255)
        return m.resize((w, h), Image.LANCZOS)

    def sombra(self, img, caja, r, blur=26, alpha=120, dy=12):
        from PIL import Image, ImageDraw, ImageFilter
        x, y, w, h = caja
        s = Image.new('L', (self.W, self.H), 0)
        ImageDraw.Draw(s).rounded_rectangle((x, y + dy, x + w, y + h + dy), radius=r, fill=alpha)
        s = s.filter(ImageFilter.GaussianBlur(blur * self.k))
        img.paste(Image.new('RGB', (self.W, self.H), (0, 0, 0)), (0, 0), s)

    def logo(self, img):
        from PIL import Image
        lg = Image.open(self.m.logo_blanco_png).convert('RGBA')
        lg = lg.crop(lg.getbbox())
        h = int(40 * self.k)
        lg = lg.resize((round(lg.width * h / lg.height), h), Image.LANCZOS)
        img.paste(lg, (self.COL_X + self.COL_W - lg.width, self.H - int(66 * self.k)), lg)

    def franja(self, img, caja, nombre, rol):
        """Nombre sobre la parte baja del recuadro: tapa la etiqueta de Meet. SOLIDA: con cualquier
        transparencia se lee debajo el nombre original (asi 'Plogy' pasa a decir 'Marco')."""
        from PIL import Image, ImageDraw
        x, y, w, h = caja
        k = self.k
        grande = h > 300 * k and w > 500 * k
        alto = max(int((58 if rol else 44) * k), int(h * 0.17) if h > 300 * k else 0)
        ov = Image.new('RGBA', (w, alto), (10, 8, 8, 255))
        d = ImageDraw.Draw(ov)
        f1, f2 = self.fuente(42 if grande else 25), self.fuente(21 if grande else 14)
        y0 = (alto - int(((74 if grande else 46) if rol else (44 if grande else 26)) * k)) // 2
        x0 = int((22 if grande else 14) * k)
        tam = 42 if grande else 25
        while tam > 12 and d.textlength(nombre.upper(), font=f1) > w - 2 * x0:
            tam -= 1
            f1 = self.fuente(tam)
        d.text((x0, y0), nombre.upper(), font=f1, fill=(255, 255, 255, 255))
        if rol:
            d.text((x0, y0 + int((48 if grande else 28) * k)), rol.upper(), font=f2, fill=self.m.rgb(self.m.c['acento']) + (255,))
        ss = 3
        m = Image.new('L', (w * ss, (alto + 30) * ss), 0)
        ImageDraw.Draw(m).rounded_rectangle((0, -30 * ss, w * ss - 1, alto * ss - 1), radius=self.RAD_C * ss, fill=255)
        m = m.crop((0, 0, w * ss, alto * ss)).resize((w, alto), Image.LANCZOS)
        a = Image.fromarray((np.asarray(ov.split()[3], np.float32) * np.asarray(m, np.float32) / 255).astype(np.uint8))
        ov.putalpha(a)
        img.paste(ov, (x, y + h - alto), ov)

    def indice(self, img, y0, cur):
        from PIL import ImageDraw
        if not self.caps:
            return
        d = ImageDraw.Draw(img, 'RGBA')
        k = self.k
        f1, f0 = self.fuente(21), self.fuente(13)
        d.text((self.COL_X, y0), self.m.texto('en_esta_sesion', 'En esta sesión').upper(), font=f0, fill=(201, 191, 182, 200))
        y = y0 + int(32 * k)
        alto_disp = self.H - int(90 * k) - y
        paso = min(int(44 * k), max(int(26 * k), alto_disp // max(len(self.caps), 1)))
        for i, t in enumerate(self.caps):
            if y + paso > self.H - int(80 * k):
                break
            txt = f'{i + 1:02d}  {t.upper()}'
            if i == cur:
                d.rounded_rectangle((self.COL_X, y - int(7 * k), self.COL_X + self.COL_W, y + int(31 * k)), radius=int(8 * k),
                                    fill=self.m.rgb(self.m.c['acento']) + (255,))
                d.text((self.COL_X + int(14 * k), y), txt, font=f1, fill=self.m.rgb(self.m.c['tinta']) + (255,))
            else:
                d.text((self.COL_X + int(14 * k), y), txt, font=f1, fill=(255, 255, 255, 105 if i > cur else 150))
            y += paso

    def voz_card(self, img, caja, nombre, foto=None):
        from PIL import Image, ImageDraw
        x, y, w, h = caja
        if foto:
            ph = Image.open(foto).convert('RGB')
            k = max(w / ph.width, h / ph.height)
            ph = ph.resize((int(ph.width * k) + 1, int(ph.height * k) + 1), Image.LANCZOS)
            ph = ph.crop(((ph.width - w) // 2, (ph.height - h) // 2, (ph.width - w) // 2 + w, (ph.height - h) // 2 + h))
            img.paste(ph, (x, y), self.redondo(w, h, self.RAD_C))
            return
        st = self.m.degradado
        gx = np.linspace(0, 1, h)[:, None]
        a, b = np.array(self.m.rgb(st[0]), np.float32), np.array(self.m.rgb(st[-1]), np.float32)
        g = (a * (1 - gx) + b * gx)[:, None, :].repeat(w, 1).reshape(h, w, 3) * .35 + 18
        img.paste(Image.fromarray(g.astype(np.uint8)), (x, y), self.redondo(w, h, self.RAD_C))
        d = ImageDraw.Draw(img)
        r = min(w, h) // 4
        cx, cy = x + w // 2, y + (h - int(50 * self.k)) // 2
        d.ellipse((cx - r, cy - r, cx + r, cy + r), fill=self.m.rgb(self.m.c['acento']))
        ini = (nombre or '?')[:1].upper()
        f = self.fuente(int(r * 1.15 / self.k))
        bb = d.textbbox((0, 0), ini, font=f)
        d.text((cx - (bb[2] + bb[0]) / 2, cy - (bb[3] + bb[1]) / 2), ini, font=f, fill=self.m.rgb(self.m.c['tinta']))

    def tarjeta_para(self, tw, th, modo):
        ar = tw / th
        if modo == 'F':
            h = self.PANEL[3]
            w = min(round(h * ar), self.PANEL[2])
            h = round(w / ar)
            return ((self.W - w) // 2 & ~1, (self.PANEL[1] + (self.PANEL[3] - h) // 2) & ~1, w & ~1, h & ~1)
        w = self.COL_W
        h = round(w / ar)
        if h > 430 * self.k:
            h = int(430 * self.k)
            w = round(h * ar)
        return ((self.COL_X + (self.COL_W - w) // 2) & ~1, self.PANEL[1], w & ~1, h & ~1)

    def ventana(self, share):
        """Ajusta la pantalla compartida al panel sin recortar."""
        P = self.PANEL
        _, _, w, h = share
        k = min(P[2] / w, P[3] / h)
        vw, vh = int(w * k) & ~1, int(h * k) & ~1
        return (P[0] + (P[2] - vw) // 2, P[1] + (P[3] - vh) // 2, vw, vh)

    def capa(self, modo, ventana=None, tarjeta=None, nombre='', rol='', lamina=None, cap=0, voz=False, foto=None):
        """modo 'P' panel + persona · 'F' persona grande. PNG con huecos transparentes (escritura atomica)."""
        import hashlib
        import os

        from PIL import Image
        key = hashlib.md5(json.dumps(['v3', self.m.slug, self.W, modo, ventana, tarjeta, nombre, rol, lamina, cap,
                                      self.caps, voz, foto]).encode()).hexdigest()[:14]
        p = self.dir / f'{key}.png'
        if p.exists():
            return p
        img = self.fondo().copy()
        alpha = Image.new('L', (self.W, self.H), 255)
        if modo == 'P':
            px, py, pw, ph = self.PANEL
            self.sombra(img, self.PANEL, self.RAD_P, blur=30, alpha=150)
            if lamina:
                sl = Image.open(lamina).convert('RGB')
                kk = min(pw / sl.width, ph / sl.height)
                sl = sl.resize((int(sl.width * kk), int(sl.height * kk)), Image.LANCZOS)
                fondo = Image.new('RGB', (pw, ph), (6, 5, 5))
                fondo.paste(sl, ((pw - sl.width) // 2, (ph - sl.height) // 2))
                img.paste(fondo, (px, py), self.redondo(pw, ph, self.RAD_P))
            else:
                img.paste(Image.new('RGB', (pw, ph), (6, 5, 5)), (px, py), self.redondo(pw, ph, self.RAD_P))
                vx, vy, vw, vh = ventana
                r = self.redondo(vw, vh, int(10 * self.k) if (vw, vh) != (pw, ph) else self.RAD_P)
                alpha.paste(Image.fromarray(255 - np.asarray(r)), (vx, vy))
        if tarjeta:
            self.sombra(img, tarjeta, self.RAD_C, blur=22, alpha=140, dy=10)
            if voz:
                self.voz_card(img, tarjeta, nombre, foto)
            else:
                cx, cy, cw, ch = tarjeta
                alpha.paste(Image.fromarray(255 - np.asarray(self.redondo(cw, ch, self.RAD_C))), (cx, cy))
        if modo == 'P':
            self.indice(img, tarjeta[1] + tarjeta[3] + int(28 * self.k) if tarjeta else int(300 * self.k), cap)
        self.logo(img)
        out = img.convert('RGBA')
        out.putalpha(alpha)
        if tarjeta and nombre:
            self.franja(out, tarjeta, nombre, rol)
        tmp = p.with_suffix(f'.{os.getpid()}.tmp.png')
        out.save(tmp, format='PNG')
        os.replace(tmp, p)
        return p


# ---------------------------------------------------------------- compositor para el render
GRADO = 'eq=contrast=1.04:saturation=1.06'


class CompositorMeet:
    def __init__(self, ctx):
        self.ctx = ctx
        g = ctx.aprobado('guion') or {}
        from ..guion import capitulos_visibles
        self.esc = Escenario(ctx, capitulos_visibles(ctx, g))
        self.info = tipos.fuentes(ctx)[0]
        self.V = self.info['archivo']
        rep = ctx.aprobado('reparto')
        self.rol = {p['nombre']: p.get('rol', '') for p in rep['personas'] if p.get('nombre')}
        self.congelar = [(c['a'], c['b']) for c in g.get('congelar', [])]
        self.limpias = ctx.estado.get('limpieza', {}).get('pistas', [])
        self.dpr = 2 if self.info['ancho'] >= 2560 else 1

    def bordes(self):
        b = list(self.esc.caps_t)
        for a, c in self.congelar:
            b += [a, c]
        for L in self.limpias:
            b += [L['a'], L['b']]
        return b

    def _limpia(self, t):
        return next((L for L in self.limpias if L['a'] <= t < L['b']), None)

    def _capa(self, s, t):
        modo = 'F' if s['f'] == 'F' else 'P'
        kw = dict(nombre=s.get('n', ''), rol=self.rol.get(s.get('n', ''), ''), cap=self.esc.capitulo(t))
        if s.get('voz'):
            tw, th = (1280, 900) if s.get('foto') else (1280, 720)
            kw['voz'] = True
            if s.get('foto'):
                kw['foto'] = str(self.ctx.local({'ruta': s['foto']}))
        else:
            tw, th = s['tile'][2:]
        tar = self.esc.tarjeta_para(tw, th, modo)
        if s['f'] == 'S':
            lam = self.ctx.tj('pdf') / f"p{s['pag']:03d}.png"
            return self.esc.capa('P', tarjeta=tar, lamina=str(lam), **kw), tar, None
        if s['f'] == 'C' and s.get('share'):
            v = self.esc.ventana(s['share'])
            return self.esc.capa('P', ventana=v, tarjeta=tar, **kw), tar, v
        return self.esc.capa('F', tarjeta=tar, **kw), tar, None

    def preparar(self, trozos, tomas):
        from .render import toma_de
        for ox, oy, t in trozos:
            self._capa(toma_de(tomas, t + 0.01), t + 0.01)

    def firma(self, s):
        return ['m3', self.esc.capitulo(s['a']), self.congelar, [L['clave'] for L in self.limpias]]

    def entradas(self, s, t, n):
        FPS = self.ctx.FPS
        capa, tar, vent = self._capa(s, t + 0.01)
        cong = next((a for a, b in self.congelar if a <= t < b), None)
        lim = self._limpia(t + 0.01) if s.get('pill') else None
        usa_video = (s['f'] == 'C' and vent) or ('tile' in s and not lim)
        args, g, idx = [], [], 0
        fuente = None
        if usa_video:
            tt = cong if cong is not None else t
            args += ['-ss', f'{tt:.4f}', '-t', f'{(0.4 if cong is not None else n / FPS + 0.3):.3f}', '-i', self.V]
            fuente = f'[0:v]setpts=PTS-STARTPTS,fps={FPS}'
            if cong is not None:
                fuente += f',trim=end_frame=1,tpad=stop_mode=clone:stop={n + 2}'
            idx = 1
        if lim:
            tt = (cong if cong is not None else t) - lim['a']
            args += ['-ss', f'{max(tt, 0):.4f}', '-t', f'{n / FPS + 0.3:.3f}', '-i', lim['ruta']]
            lim_i = idx
            idx += 1
        args += ['-loop', '1', '-framerate', str(FPS), '-i', str(capa)]
        li = idx
        idx += 1
        g.append(f'color=c=0x{self.ctx.marca.c.get("fondo_escenario", "#100d0c").lstrip("#")}:s={self.ctx.W}x{self.ctx.H}:r={FPS}:d={n / FPS + 0.2:.3f}[bg]')
        base = '[bg]'
        ramas = (1 if ('tile' in s and not lim) else 0) + (1 if (s['f'] == 'C' and vent) else 0)
        e1 = e2 = None
        if ramas == 2:
            g.append(f'{fuente},split=2[s1][s2]')
            e1, e2 = '[s1]', '[s2]'
        elif ramas == 1:
            g.append(f'{fuente}[s1]')
            e1 = '[s1]'
        if s['f'] == 'C' and vent:
            x, y, w, h = s['share']
            g.append(f'{e1}crop={w}:{h}:{x}:{y},scale={vent[2]}:{vent[3]}:flags=lanczos[sh]')
            g.append(f'{base}[sh]overlay={vent[0]}:{vent[1]}:shortest=1[b1]')
            base = '[b1]'
            e1 = e2
        if 'tile' in s and not s.get('voz'):
            if lim:
                ent = f'[{lim_i}:v]setpts=PTS-STARTPTS,fps={FPS}'
                if cong is not None:
                    ent += f',trim=end_frame=1,tpad=stop_mode=clone:stop={n + 2}'
                g.append(f'{ent},{self.sin_interfaz(s)},{GRADO},scale={tar[2]}:{tar[3]}:flags=lanczos[tl]')
            else:
                g.append(self.filtro_tile(s, e1, tar))
            g.append(f'{base}[tl]overlay={tar[0]}:{tar[1]}:shortest=1[b2]')
            base = '[b2]'
        g.append(f'[{li}:v]format=rgba[cp]')
        g.append(f'{base}[cp]overlay=0:0:shortest=1[base]')
        return args, ';'.join(g), '[base]', idx

    def sin_interfaz(self, s):
        """Insignia de audio de Meet (arriba a la derecha) fuera, y recorte minimo con la misma proporcion
        para que el aro azul de "hablando" no asome por las esquinas redondeadas."""
        x, y, w, h = s['tile']
        d = self.dpr
        logo = f'delogo=x={w - 31 * d}:y={3 * d}:w={28 * d}:h={28 * d}'
        ins = int((4.5 if w / h > 1.5 else 3) * d)
        nw = (w - 2 * ins) & ~1
        nh = round(nw * h / w) & ~1
        return f'{logo},crop={nw}:{nh}:{ins}:{min(ins, h - nh)}'

    def filtro_tile(self, s, ent, tar):
        x, y, w, h = s['tile']
        d = self.dpr
        ins = int((4.5 if w / h > 1.5 else 3) * d)
        cad = f'crop={w}:{h}:{x}:{y},{self.sin_interfaz(s)}'
        if s.get('pill'):
            # respaldo si no hay pista limpia: se borran los iconos de la pildora (quedan bordes suaves)
            pw = 132 * d if w > 220 * d else 88 * d
            px, py = (w - pw) // 2, (h - 44 * d) // 2
            cad += f',delogo=x={max(px - ins, 1)}:y={max(py - ins, 1)}:w={pw}:h={44 * d}'
        return f'{ent}{cad},{GRADO},scale={tar[2]}:{tar[3]}:flags=lanczos[tl]'
