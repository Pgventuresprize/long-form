"""Etapa 3 (una cámara, y el pódcast ya editado) · Caras, quién habla y reencuadre.

Una sola cámara no trae planos que elegir: se crean recortando el cuadro.
- Caras en un cuadro cada 2 s (solo se decodifican los cuadros clave: rápido aun en 4K). Como la cámara no se
  mueve, las caras con la misma posición horizontal son la misma persona.
- Planos: abierto (todo el cuadro), cerrado de cada persona (la cara en el tercio superior, sin ampliar más de
  1,6 veces para que no se pixele) y, con dos o más personas, el plano de dos.
- Quién habla, si hay varias: cuánto se mueve la boca de cada una entre dos cuadros seguidos a mitad de cada
  frase. Si no se sabe, el plano no sigue a nadie: alterna abierto y cerrado.
- Los cambios de plano caen en los cambios de idea (pausas de 0,7 s o más), con tomas de 7 a 22 s.
- Un video vertical llena el 16:9 con un recorte alrededor de las caras, o con su propio fondo desenfocado si
  no se ve a nadie.

El pódcast o video ya editado usa el mismo análisis (para las miniaturas del reparto), pero una sola toma: el
video entero, respetando sus cortes.
"""
import numpy as np

from .. import ffm, tipos
from .render import GRADO

PASO = 2.0
ANCHO_KF = 640
TOMA_MIN, TOMA_MAX = 7.0, 22.0
PAUSA_IDEA = 0.7
AMPLIACION_MAX = 2.2      # el recorte nunca se amplia mas que esto sobre la salida (720p ya llega ampliado 1,5)
CERRADO = 3.4             # el plano cerrado mide 3,4 veces el ancho de la cara: de los hombros para arriba


def _fuente(ctx):
    an = ctx.estado.get('analisis') or {}
    pistas = tipos.fuentes(ctx)
    clave = an.get('maestra') or ((ctx.estado.get('clasificacion') or {}).get('roles') or {}).get('camara') or pistas[0]['clave']
    return next((p for p in pistas if p['clave'] == clave), pistas[0])


def caras_por_cuadro(ctx, f):
    import cv2
    kfs = ffm.cuadros(f['archivo'], ctx.tj(f'cuadros_{f["clave"]}'), PASO, ANCHO_KF, f['duracion'])
    frontal = cv2.CascadeClassifier(cv2.data.haarcascades + 'haarcascade_frontalface_default.xml')
    perfil = cv2.CascadeClassifier(cv2.data.haarcascades + 'haarcascade_profileface.xml')
    out = []
    for i, (t, ruta) in enumerate(kfs):
        if i % 60 == 0:
            ctx.avance(f'Buscando caras ({i} de {len(kfs)} cuadros)', .1 + .6 * i / max(len(kfs), 1))
        g = cv2.imread(str(ruta), 0)
        if g is None:
            continue
        k = f['ancho'] / g.shape[1]
        m = g.shape[1] // 30
        fs = [list(c) for c in frontal.detectMultiScale(g, 1.1, 5, minSize=(m, m))]
        if not fs:
            fs = [list(c) for c in perfil.detectMultiScale(g, 1.1, 5, minSize=(m, m))]
            espejo = perfil.detectMultiScale(cv2.flip(g, 1), 1.1, 5, minSize=(m, m))
            fs += [[g.shape[1] - x - w, y, w, h] for x, y, w, h in espejo]
        out.append({'t': float(t), 'kf': str(ruta), 'caras': [[round(float(v) * k, 1) for v in c] for c in fs]})
    return out


def agrupar(det, W):
    """Personas: caras a la misma altura del cuadro a lo largo del video (la cámara no se mueve)."""
    puntos = sorted((c[0] + c[2] / 2) / W for d in det for c in d['caras'])
    grupos = []
    for x in puntos:
        if grupos and x - grupos[-1][-1] <= 0.06:
            grupos[-1].append(x)
        else:
            grupos.append([x])
    con_caras = sum(1 for d in det if d['caras'])
    cand = []
    for g in [g for g in grupos if len(g) >= max(3, 0.15 * con_caras)]:
        cx = float(np.median(g))
        cajas = [c for d in det for c in d['caras'] if abs((c[0] + c[2] / 2) / W - cx) <= 0.08]
        cand.append({'cx': round(cx, 3), 'caja': [round(float(v), 1) for v in np.median(np.array(cajas), 0)], 'vistas': len(cajas)})
    # una cara chica que se ve a ratos casi siempre es un cuadro o un reflejo, no una persona: cuenta si se ve
    # en al menos el 30 % de los cuadros o si es de un tamaño parecido a la principal
    grande = max((c['caja'][2] for c in cand), default=0)
    personas = []
    for c in cand:
        if c['vistas'] >= 0.3 * con_caras or c['caja'][2] >= 0.6 * grande:
            personas.append({'id': f'p{len(personas) + 1}', **c})
    return personas


def encuadres(f, personas, W, H):
    """Recortes 16:9 sobre la fuente: [ancho, alto, x, y]. 'W' None = el cuadro entero."""
    W0, H0 = f['ancho'], f['alto']
    ar = W / H
    ancho_min = max(W / AMPLIACION_MAX, W0 * 0.35)       # y nunca mas de ~3 veces sobre el cuadro original
    cys = [p['caja'][1] + p['caja'][3] / 2 for p in personas]

    def recorte(cx, cy, ancho):
        cw = min(ancho, W0)
        ch = cw / ar
        if ch > H0:
            ch = H0
            cw = ch * ar
        x = float(np.clip(cx - cw / 2, 0, W0 - cw))
        y = float(np.clip(cy - ch * 0.38, 0, H0 - ch))
        return [int(cw) & ~1, int(ch) & ~1, int(x) & ~1, int(y) & ~1]
    out = {}
    vertical = W0 / H0 < 1.2
    out['W'] = recorte(W0 / 2, float(np.median(cys)), W0) if (vertical and personas) else None
    for i, p in enumerate(personas):
        x, y, w, h = p['caja']
        c = recorte(x + w / 2, y + h / 2, max(w * CERRADO, ancho_min))
        # si el cerrado es casi todo el cuadro, no es un plano distinto: se omite
        if c[0] < W0 * 0.85 or vertical:
            out[f'C{i}'] = c
    if len(personas) >= 2:
        a = min(p['caja'][0] for p in personas)
        b = max(p['caja'][0] + p['caja'][2] for p in personas)
        ancho = (b - a) * 1.7
        if ancho < W0 * 0.85:
            out['D'] = recorte((a + b) / 2, float(np.median(cys)), max(ancho, ancho_min))
    return out


def analizar(ctx):
    pistas = tipos.fuentes(ctx)
    f = _fuente(ctx)
    if len(pistas) > 1:
        ctx.aviso(f'Este tipo de grabación usa un solo video: se usa {f.get("nombre") or f["clave"]}.')
    det = caras_por_cuadro(ctx, f)
    ctx.json_trabajo('caras.json', det)
    personas = agrupar(det, f['ancho'])
    enc = encuadres(f, personas, ctx.W, ctx.H)
    con = sum(1 for d in det if d['caras'])
    ctx.log(f'caras en {con} de {len(det)} cuadros; {len(personas)} personas; planos: {", ".join(enc)}')
    if not personas:
        ctx.aviso('No se ve bien a nadie: el video va completo, sin acercamientos.')
    ctx.avance('Preparando el audio', .9)
    tipos.escribir_programa(ctx, f['clave'], 0.0, f['duracion'])
    ctx.guardar('analisis', {'maestra': f['clave'], 'inicio': 0.0, 'fin': f['duracion'], 'personas': personas,
                             'encuadres': enc, 'vertical': f['ancho'] / f['alto'] < 1.2, 'cuadros': len(det),
                             'con_caras': con})


# ---------------------------------------------------------------- quien habla (fin de la transcripcion)
def hablantes(ctx, segs, maximo=240):
    """Con una persona, es ella. Con varias, la boca que mas se mueve a mitad de cada frase."""
    an = ctx.estado['analisis']
    ps = an['personas']
    if len(ps) < 2:
        for s in segs:
            s['hablante'] = ps[0]['id'] if ps else None
        return
    f = _fuente(ctx)
    k = 480 / f['ancho']
    cand = [i for i, s in enumerate(segs) if s['fin'] - s['inicio'] >= 1.2]
    if len(cand) > maximo:
        cand = [cand[int(j)] for j in np.linspace(0, len(cand) - 1, maximo)]
    vistos = {}
    for n, i in enumerate(cand):
        if n % 40 == 0:
            ctx.avance(f'Viendo quién habla ({n} de {len(cand)} frases)', .9)
        s = segs[i]
        t = an['inicio'] + (s['inicio'] + s['fin']) / 2
        a, b = ffm.cuadro(f['archivo'], t, 480, gris=True), ffm.cuadro(f['archivo'], t + 0.2, 480, gris=True)
        if a is None or b is None or a.shape != b.shape:
            continue
        d = np.abs(a.astype(np.int16) - b.astype(np.int16))
        mov = []
        for p in ps:
            x, y, w, h = [v * k for v in p['caja']]
            boca = d[int(y + h * 0.62):int(y + h * 1.05), int(x + w * 0.2):int(x + w * 0.8)]
            frente = d[int(y):int(y + h * 0.4), int(x + w * 0.2):int(x + w * 0.8)]
            # lo que se mueve la boca mas alla de lo que se mueve la cabeza entera
            mov.append(float(boca.mean() - 0.6 * frente.mean()) if boca.size and frente.size else 0.0)
        orden = np.argsort(mov)[::-1]
        if mov[orden[0]] >= 1.0 and mov[orden[0]] >= 1.3 * max(mov[orden[1]], 0.3):
            vistos[i] = ps[int(orden[0])]['id']
    claves = sorted(vistos)
    for i, s in enumerate(segs):
        if i in vistos:
            s['hablante'] = vistos[i]
            continue
        # sin medida: el de la frase medida mas cercana, si esta a menos de 20 s
        j = min(claves, key=lambda c: abs(segs[c]['inicio'] - s['inicio']), default=None)
        s['hablante'] = vistos[j] if j is not None and abs(segs[j]['inicio'] - s['inicio']) < 20 else None
    ctx.log(f'quién habla: medido en {len(vistos)} de {len(cand)} frases; ' +
            ', '.join(f'{p["id"]} {sum(1 for s in segs if s.get("hablante") == p["id"])}' for p in ps))


def reparto(ctx, segs, tipo):
    import cv2
    an = ctx.estado['analisis']
    ps = an['personas']
    det = ctx.json_trabajo('caras.json')
    W = _fuente(ctx)['ancho']
    out = []
    medido = any(s.get('hablante') for s in segs)
    for p in ps:
        mias = [s for s in segs if s.get('hablante') == p['id']]
        voz = round(sum(s['fin'] - s['inicio'] for s in mias) / max(sum(s['fin'] - s['inicio'] for s in segs), 1), 3) if medido else None
        base = mias if mias else (segs if len(ps) == 1 else [])
        # miniatura: el cuadro donde su cara se ve mas grande
        mejor = max(((d, c) for d in det for c in d['caras'] if abs((c[0] + c[2] / 2) / W - p['cx']) <= 0.08),
                    key=lambda dc: dc[1][2], default=None)
        mini = None
        if mejor:
            im = cv2.imread(mejor[0]['kf'])
            if im is not None:
                kk = im.shape[1] / W
                x, y, w, h = [v * kk for v in mejor[1]]
                m = 0.6
                recorte = im[max(0, int(y - h * m)):int(y + h * (1 + m)), max(0, int(x - w * m)):int(x + w * (1 + m))]
                if recorte.size:
                    mini = f'persona_{p["id"]}.jpg'
                    ctx.salida.mkdir(exist_ok=True)
                    cv2.imwrite(str(ctx.salida / mini), cv2.resize(recorte, (240, int(240 * recorte.shape[0] / recorte.shape[1]))),
                                [cv2.IMWRITE_JPEG_QUALITY, 85])
        out.append({'id': p['id'], 'tipo': 'persona', 'nombre': '', 'rol': '', 'handle': '', 'voz': voz,
                    'muestras': [s['texto'] for s in base if len(s['texto']) > 40][:4], 'miniatura': mini, 'origen': 'pendiente'})
    if not out:
        out.append({'id': 'p1', 'tipo': 'voz', 'nombre': '', 'rol': '', 'handle': '', 'voz': 1.0,
                    'muestras': [s['texto'] for s in segs if len(s['texto']) > 40][:4], 'origen': 'pendiente',
                    'nota': 'No se ve a nadie con claridad: es la voz principal del video.'})
    _nombres_del_proyecto(ctx, out)
    nota = None
    if len(ps) > 1 and not medido:
        nota = 'No se pudo ver quién habla en cada frase: los rótulos y las citas usan el nombre que pongas solo si hay una persona.'
    return {'tipo': tipo, 'personas': out, **({'nota': nota} if nota else {})}


def _nombres_del_proyecto(ctx, personas):
    """Si el proyecto ya trae los nombres y coinciden en cantidad, se proponen en orden (de izquierda a derecha)."""
    dados = ctx.spec.get('personas') or []
    if dados and len(dados) == len(personas):
        for p, d in zip(personas, dados):
            p.update({'nombre': d.get('nombre', ''), 'rol': d.get('rol', ''), 'handle': d.get('handle', ''), 'origen': 'proyecto'})


# ---------------------------------------------------------------- tomas (plan)
def tomas(ctx, rep):
    an = ctx.estado['analisis']
    fin = an['fin'] - an['inicio']
    enc = an['encuadres']
    ps = an['personas']
    cerrados = {p['id']: f'C{i}' for i, p in enumerate(ps) if enc.get(f'C{i}')}
    if not cerrados:
        return [{'a': 0.0, 'b': fin, 'plano': 'W'}]
    segs = ctx.json_trabajo('transcripcion.json')
    ideas = {s['inicio'] for a, s in zip(segs, segs[1:]) if s['inicio'] - a['fin'] >= PAUSA_IDEA}
    cambios = {s['inicio'] for a, s in zip(segs, segs[1:])
               if s.get('hablante') and a.get('hablante') and s['hablante'] != a['hablante']}
    # cualquier comienzo de frase sirve si la toma ya se alargo de mas (alguien que habla sin pausas)
    frases = {s['inicio'] for s in segs[1:]}
    habla = {round(s['inicio'], 3): s.get('hablante') for s in segs}
    voz = {pid: sum(s['fin'] - s['inicio'] for s in segs if s.get('hablante') == pid) for pid in cerrados}
    principal = cerrados[max(voz, key=voz.get)] if any(voz.values()) else next(iter(cerrados.values()))
    hay_dos = 'D' in enc and len(ps) >= 2
    out = []
    s0, plano = 0.0, 'W'
    abiertos = 0
    for c in sorted(ideas | cambios | frases):
        if c < 5.0 or c >= fin - 4.0:
            continue
        d = c - s0
        h = habla.get(round(c, 3))
        suyo = cerrados.get(h)
        destino = None
        if c in cambios and suyo and plano != suyo and d >= 3.0:
            destino = suyo                         # dialogo: el plano sigue a quien toma la palabra
        elif (c in ideas and d >= TOMA_MIN) or d >= TOMA_MAX:
            if plano == 'W' or plano == 'D':
                destino = suyo or principal
            else:
                abiertos += 1
                destino = 'D' if (hay_dos and abiertos % 2 == 0) else 'W'
        if destino and destino != plano:
            out.append({'a': s0, 'b': c, 'plano': plano})
            s0, plano = c, destino
    out.append({'a': s0, 'b': fin, 'plano': plano})
    # cierre en abierto
    if out[-1]['plano'] != 'W' and fin - out[-1]['a'] > 8:
        out[-1]['b'] = fin - 4.0
        out.append({'a': fin - 4.0, 'b': fin, 'plano': 'W'})
    from collections import Counter
    ctx.log(f'{len(out)} planos: {dict(Counter(t["plano"] for t in out))}')
    return out


# ---------------------------------------------------------------- render
class CompositorUnaCamara:
    def __init__(self, ctx):
        from .. import tipos as T
        self.ctx = ctx
        self.an = ctx.estado['analisis']
        self.f = _fuente(ctx)
        self.ruido = T.RUIDO if T.de(ctx).clave != 'podcast' else ''

    def firma(self, toma):
        return [toma['plano'], self.an['encuadres'].get(toma['plano']), self.ruido, 'u1']

    def entradas(self, toma, t, n):
        W, H, FPS = self.ctx.W, self.ctx.H, self.ctx.FPS
        src = self.an['inicio'] + t
        args = ['-ss', f'{src:.4f}', '-t', f'{n / FPS + 0.3:.3f}', '-i', self.f['archivo']]
        caja = self.an['encuadres'].get(toma['plano'])
        ini = f'[0:v]setpts=PTS-STARTPTS,fps={FPS},{self.ruido}'
        if caja:
            cw, ch, x, y = caja
            return args, f'{ini}crop={cw}:{ch}:{x}:{y},scale={W}:{H}:flags=lanczos,{GRADO},setsar=1[base]', '[base]', 1
        if abs(self.f['ancho'] / self.f['alto'] - W / H) > 0.05:
            # otra proporcion: el video entero sobre su propio fondo desenfocado
            g = (f'{ini}split=2[fa][fb];[fa]scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H},boxblur=24:2[fd];'
                 f'[fb]scale={W}:{H}:force_original_aspect_ratio=decrease:flags=lanczos[fc];'
                 f'[fd][fc]overlay=(W-w)/2:(H-h)/2,{GRADO},setsar=1[base]')
            return args, g, '[base]', 1
        return args, f'{ini}scale={W}:{H}:flags=lanczos,{GRADO},setsar=1[base]', '[base]', 1
