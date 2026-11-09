"""Etapa 3 (charla con diapositivas y grabación de pantalla) · Contenido protagonista, persona en recuadro.

Las dos tienen un video de contenido (las láminas proyectadas o la pantalla) y, a veces, una cámara de la persona.
Pueden ser dos videos que suenan a la vez (se sincronizan como las cámaras) o uno solo que muestra las dos cosas.

Charla: en cada cuadro se busca qué lámina del PDF se ve (el mismo emparejado de Meet) y en pantalla va la lámina
ORIGINAL, perfecta, en el escenario de la marca; la persona en su recuadro de la columna. Sin PDF, o mientras lo
que se ve no es una lámina, va el video de contenido en el panel.

Pantalla: el cuadro entero, y un acercamiento a la zona donde pasa algo (lo que cambia entre un cuadro y el
siguiente: escribir, hacer clic, abrir un menú). Con cámara, la persona va en una esquina.
"""
import numpy as np

from .. import ffm, tipos
from .render import GRADO

PASO = 2.0
TOMA_MIN = 4.0
QUIETO = 6.0          # sin actividad este tiempo, el acercamiento vuelve al cuadro entero
ZOOM_MAX = 2.0


def _pistas(ctx):
    return {p['clave']: p for p in tipos.fuentes(ctx)}


def _roles(ctx):
    an = ctx.estado.get('analisis') or {}
    if an.get('roles'):
        return an['roles']
    roles = (ctx.estado.get('clasificacion') or {}).get('roles') or {}
    pistas = list(_pistas(ctx))
    return {'contenido': roles.get('contenido') or pistas[0], 'camara': roles.get('camara')}


def recuadro(f):
    """El recuadro de la persona: un cuadrado alrededor de su cara (la cara en el tercio superior)."""
    from .camaras import encuadres
    e = encuadres(f['archivo'], f['duracion'], f, n=12)
    cx, cy, cw = e['cara']
    W0, H0 = f['ancho'], f['alto']
    lado = min(cw * 3.2, H0, W0) if e['caras_vistas'] >= 3 else min(H0, W0)
    x = float(np.clip(cx - lado / 2, 0, W0 - lado))
    y = float(np.clip(cy - lado * 0.4, 0, H0 - lado))
    return [int(lado) & ~1, int(lado) & ~1, int(x) & ~1, int(y) & ~1], e['caras_vistas']


def zonas_de_actividad(kfs, W0):
    """Donde cambia la imagen entre cada cuadro y el siguiente, en pixeles de la fuente. None: nada cambio;
    'todo': cambio casi todo (se desplazo la pagina o cambio de ventana)."""
    import cv2
    out = []
    prev = None
    for t, ruta in kfs:
        g = cv2.imread(str(ruta), 0)
        if g is None:
            continue
        g = cv2.resize(g, (480, int(480 * g.shape[0] / g.shape[1])), interpolation=cv2.INTER_AREA)
        if prev is not None and prev.shape == g.shape:
            m = (cv2.absdiff(prev, g) > 24).astype(np.uint8)
            m = cv2.dilate(m, np.ones((9, 9), np.uint8))
            fr = float(m.mean())
            if fr < 0.002:
                caja = None
            elif fr > 0.35:
                caja = 'todo'
            else:
                ys, xs = np.nonzero(m)
                k = W0 / 480
                x0, x1 = np.percentile(xs, 2), np.percentile(xs, 98)
                y0, y1 = np.percentile(ys, 2), np.percentile(ys, 98)
                caja = [round(float(x0 * k)), round(float(y0 * k)), round(float((x1 - x0) * k)), round(float((y1 - y0) * k))]
            out.append({'t': float(t), 'caja': caja})
        prev = g
    return out


def analizar(ctx, tipo):
    pistas = _pistas(ctx)
    roles = _roles(ctx)
    kc, kp = roles['contenido'], roles.get('camara')
    fc, fp = pistas[kc], pistas.get(kp) if kp else None
    # linea comun: la camara manda si tiene audio (ahi se habla), si no el contenido
    maestra = kp if (fp and fp.get('audio')) else (kc if fc.get('audio') else None)
    offs = {kc: 0.0}
    if kp:
        offs[kp] = 0.0
    if kp and kp != kc:
        otra = kc if maestra == kp else kp
        if maestra and pistas[otra].get('audio'):
            from .camaras import sincronizar
            ctx.avance('Sincronizando la cámara con el contenido', .05)
            _, a = ffm.leer_wav(ctx.tj(f'a16_{maestra}.wav'))
            _, b = ffm.leer_wav(ctx.tj(f'a16_{otra}.wav'))
            off, sc, _, _ = sincronizar(np.asarray(a, np.float32), np.asarray(b, np.float32))
            offs[otra] = off
            ctx.log(f'{otra} = {maestra} + {off:.3f} s (confianza {sc:.2f})')
            if sc < 0.1:
                ctx.aviso(f'La sincronía entre la cámara y el contenido es dudosa (confianza {sc:.2f}).')
        else:
            ctx.aviso('Uno de los videos no tiene audio: la cámara y el contenido se alinean por el comienzo.')
    inicio = max(0.0, max(-o for o in offs.values()))
    fin = min(pistas[k]['duracion'] - o for k, o in offs.items())
    tipos.escribir_programa(ctx, maestra, inicio, fin)

    ctx.avance('Sacando cuadros del contenido', .15)
    kfs = ffm.cuadros(fc['archivo'], ctx.tj(f'cuadros_{kc}'), PASO, 1440 if tipo == 'charla' else 960, fc['duracion'])
    prog = lambda t: round(t - offs[kc] - inicio, 3)  # noqa: E731  tiempo del contenido -> tiempo del programa
    laminas, actividad = [], []
    if tipo == 'charla' and ctx.estado['ingesta'].get('laminas'):
        import cv2

        from .meet import Laminas
        L = Laminas(sorted(ctx.tj('pdf').glob('p*.png')))
        for i, (t, ruta) in enumerate(kfs):
            if i % 50 == 0:
                ctx.avance(f'Reconociendo láminas ({i} de {len(kfs)})', .2 + .6 * i / max(len(kfs), 1))
            g = cv2.imread(str(ruta), 0)
            pag, v = L.buscar(g) if g is not None else (None, 0)
            laminas.append({'t': prog(t), 'pag': pag})
        vistas = sum(1 for x in laminas if x['pag'])
        ctx.log(f'láminas reconocidas en {vistas} de {len(laminas)} cuadros')
        if vistas < 0.2 * max(len(laminas), 1):
            ctx.aviso('El PDF casi no coincide con lo que se ve: va el video del contenido en vez de las láminas originales.')
    if tipo == 'pantalla':
        ctx.avance('Buscando dónde pasa algo en la pantalla', .3)
        actividad = [dict(a, t=prog(a['t'])) for a in zonas_de_actividad(kfs, fc['ancho'])]
    tile = None
    if fp:
        ctx.avance('Buscando a la persona', .85)
        tile, vistas = recuadro(fp)
        if vistas < 3:
            ctx.aviso('Casi no se ve la cara de la persona: su recuadro va centrado. Revísalo.')
    ctx.guardar('analisis', {'roles': {'contenido': kc, 'camara': kp}, 'maestra': maestra, 'offsets': offs,
                             'inicio': inicio, 'fin': fin, 'paso': PASO, 'contenido': [fc['ancho'], fc['alto']],
                             'laminas': laminas, 'actividad': actividad, 'tile': tile})


def reparto(ctx, segs, tipo):
    import cv2
    an = ctx.estado['analisis']
    kp = an['roles'].get('camara')
    p = {'id': 'p1', 'tipo': 'ponente' if kp else 'voz', 'nombre': '', 'rol': '', 'handle': '', 'voz': 1.0,
         'muestras': [s['texto'] for s in segs if len(s['texto']) > 40][:4], 'origen': 'pendiente'}
    if kp and an.get('tile'):
        f = _pistas(ctx)[kp]
        im = ffm.cuadro(f['archivo'], an['inicio'] + an['offsets'][kp] + (an['fin'] - an['inicio']) * 0.3, f['ancho'])
        if im is not None:
            w, h, x, y = an['tile']
            c = im[y:y + h, x:x + w]
            if c.size:
                ctx.salida.mkdir(exist_ok=True)
                cv2.imwrite(str(ctx.salida / 'persona_p1.jpg'), cv2.resize(c, (240, 240)), [cv2.IMWRITE_JPEG_QUALITY, 85])
                p['miniatura'] = 'persona_p1.jpg'
    else:
        p['nota'] = 'No hay cámara de la persona: es la voz que se oye. Ponle nombre para los rótulos y las citas.'
    dados = ctx.spec.get('personas') or []
    if len(dados) == 1:
        p.update({'nombre': dados[0].get('nombre', ''), 'rol': dados[0].get('rol', ''), 'handle': dados[0].get('handle', ''),
                  'origen': 'proyecto'})
    return {'tipo': tipo, 'personas': [p]}


def _nombre(rep):
    return next((p['nombre'] for p in rep['personas'] if p.get('nombre')), '')


def _fundir(out, claves, minimo):
    """Primero junta las tomas vecinas iguales; despues absorbe en la anterior las que quedan de menos de
    `minimo` segundos (una lamina que se vio un instante). En ese orden: los pasos de 2 s sueltos son todos
    "cortos" y se comerian todo."""
    def iguales(a, b):
        return all(a.get(k) == b.get(k) for k in claves)
    juntas = []
    for s in out:
        if juntas and iguales(juntas[-1], s):
            juntas[-1]['b'] = s['b']
        else:
            juntas.append(dict(s))
    limpio = []
    for s in juntas:
        if limpio and s['b'] - s['a'] < minimo:
            limpio[-1]['b'] = s['b']
        elif limpio and iguales(limpio[-1], s):
            limpio[-1]['b'] = s['b']
        else:
            limpio.append(s)
    return limpio


def tomas_charla(ctx, rep):
    an = ctx.estado['analisis']
    fin = an['fin'] - an['inicio']
    W0, H0 = an['contenido']
    nombre = _nombre(rep)
    lam = [x for x in an['laminas'] if 0 <= x['t'] < fin]
    usar_laminas = sum(1 for x in lam if x['pag']) >= 0.2 * max(len(lam), 1)
    out = []
    ultima, desde = None, -1e9
    t = 0.0
    while t < fin:
        x = next((x for x in reversed(lam) if x['t'] <= t), None)
        if x and x['pag']:
            ultima, desde = x['pag'], t
        it = {'n': nombre}
        if an.get('tile'):
            it['tile'] = an['tile']
        # una lamina se sostiene hasta 10 s sin verse (una animacion o la persona tapandola un momento)
        if usar_laminas and ultima and t - desde <= 10:
            it.update(f='S', pag=ultima)
        else:
            it.update(f='C', share=[0, 0, W0, H0])
        it['a'], it['b'] = t, min(t + PASO, fin)
        out.append(it)
        t += PASO
    return _fundir(out, ('f', 'pag', 'share', 'tile', 'n'), 3.0)


def _caja_16x9(b, W0, H0, ar=16 / 9):
    x, y, w, h = b
    mx, my = w * 0.25 + 40, h * 0.25 + 40
    x, y, w, h = x - mx, y - my, w + 2 * mx, h + 2 * my
    w = max(w, h * ar, W0 / ZOOM_MAX)
    h = w / ar
    if h > H0:
        h = H0
        w = h * ar
    cx, cy = x + (b[2] + 2 * mx) / 2, y + (b[3] + 2 * my) / 2
    x0 = float(np.clip(cx - w / 2, 0, W0 - w))
    y0 = float(np.clip(cy - h / 2, 0, H0 - h))
    return [int(w) & ~1, int(h) & ~1, int(x0) & ~1, int(y0) & ~1]


def _dentro(b, caja):
    x, y, w, h = b
    cw, ch, cx, cy = caja
    return x >= cx and y >= cy and x + w <= cx + cw and y + h <= cy + ch


def tomas_pantalla(ctx, rep):
    an = ctx.estado['analisis']
    fin = an['fin'] - an['inicio']
    W0, H0 = an['contenido']
    pip = bool(an.get('tile')) and an['roles'].get('camara') != an['roles']['contenido']
    out = []
    s0, caja, ultima_act = 0.0, None, 0.0
    for e in sorted(an['actividad'], key=lambda e: e['t']):
        t = e['t']
        if not 0 < t < fin - 2:
            continue
        deseo = caja
        if e['caja'] == 'todo':
            deseo = None
            ultima_act = t
        elif e['caja']:
            ultima_act = t
            if caja is None or not _dentro(e['caja'], caja):
                c = _caja_16x9(e['caja'], W0, H0)
                deseo = None if c[0] >= W0 * 0.85 else c
        elif caja is not None and t - ultima_act >= QUIETO:
            deseo = None
        if deseo != caja and t - s0 >= TOMA_MIN:
            out.append({'a': s0, 'b': t, 'plano': 'Z' if caja else 'W', 'caja': caja, 'pip': pip})
            s0, caja = t, deseo
    out.append({'a': s0, 'b': fin, 'plano': 'Z' if caja else 'W', 'caja': caja, 'pip': pip})
    from collections import Counter
    ctx.log(f'{len(out)} planos de pantalla: {dict(Counter(t["plano"] for t in out))}')
    return out


# ---------------------------------------------------------------- render
class _Base:
    def __init__(self, ctx):
        self.ctx = ctx
        self.an = ctx.estado['analisis']
        self.pistas = _pistas(ctx)
        self.kc = self.an['roles']['contenido']
        self.kp = self.an['roles'].get('camara')

    def src(self, k, t):
        return self.an['inicio'] + t + self.an['offsets'].get(k, 0.0)


class CompositorCharla(_Base):
    """El escenario de la marca (el mismo de Meet): lamina o contenido en el panel, persona en la columna."""

    def __init__(self, ctx):
        super().__init__(ctx)
        from .meet import Escenario
        g = ctx.aprobado('guion') or {}
        self.esc = Escenario(ctx, g.get('capitulos', []))
        rep = ctx.aprobado('reparto') or {'personas': []}
        self.rol = {p['nombre']: p.get('rol', '') for p in rep['personas'] if p.get('nombre')}

    def bordes(self):
        return list(self.esc.caps_t)

    def _capa(self, s, t):
        kw = dict(nombre=s.get('n', ''), rol=self.rol.get(s.get('n', ''), ''), cap=self.esc.capitulo(t))
        tar = self.esc.tarjeta_para(s['tile'][0], s['tile'][1], 'P') if s.get('tile') else None
        if s['f'] == 'S':
            lam = self.ctx.tj('pdf') / f"p{s['pag']:03d}.png"
            return self.esc.capa('P', tarjeta=tar, lamina=str(lam), **kw), tar, None
        v = self.esc.ventana(s['share'])
        return self.esc.capa('P', ventana=v, tarjeta=tar, **kw), tar, v

    def preparar(self, trozos, tomas):
        from .render import toma_de
        for _, _, t in trozos:
            self._capa(toma_de(tomas, t + 0.01), t + 0.01)

    def firma(self, s):
        return ['c1', self.esc.capitulo(s['a'])]

    def entradas(self, s, t, n):
        FPS, W, H = self.ctx.FPS, self.ctx.W, self.ctx.H
        capa, tar, vent = self._capa(s, t + 0.01)
        dur = f'{n / FPS + 0.3:.3f}'
        args, g, idx = [], [], 0
        fondo = self.ctx.marca.c.get('fondo_escenario', '#100d0c').lstrip('#')
        g.append(f'color=c=0x{fondo}:s={W}x{H}:r={FPS}:d={n / FPS + 0.2:.3f}[bg]')
        base = '[bg]'
        if vent:
            x, y, w, h = s['share']
            args += ['-ss', f'{self.src(self.kc, t):.4f}', '-t', dur, '-i', self.pistas[self.kc]['archivo']]
            g.append(f'[{idx}:v]setpts=PTS-STARTPTS,fps={FPS},crop={w}:{h}:{x}:{y},scale={vent[2]}:{vent[3]}:flags=lanczos[ct]')
            g.append(f'{base}[ct]overlay={vent[0]}:{vent[1]}:shortest=1[b1]')
            base = '[b1]'
            idx += 1
        if tar:
            w, h, x, y = s['tile']
            args += ['-ss', f'{self.src(self.kp, t):.4f}', '-t', dur, '-i', self.pistas[self.kp]['archivo']]
            g.append(f'[{idx}:v]setpts=PTS-STARTPTS,fps={FPS},{tipos.RUIDO}crop={w}:{h}:{x}:{y},{GRADO},'
                     f'scale={tar[2]}:{tar[3]}:flags=lanczos[tl]')
            g.append(f'{base}[tl]overlay={tar[0]}:{tar[1]}:shortest=1[b2]')
            base = '[b2]'
            idx += 1
        args += ['-loop', '1', '-framerate', str(FPS), '-i', str(capa)]
        g.append(f'[{idx}:v]format=rgba[cp]')
        g.append(f'{base}[cp]overlay=0:0:shortest=1[base]')
        return args, ';'.join(g), '[base]', idx + 1


class CompositorPantalla(_Base):
    """La pantalla entera o el acercamiento; con camara, la persona en la esquina inferior derecha."""

    def firma(self, s):
        return [s['plano'], s.get('caja'), s.get('pip'), self.an.get('tile'), 'p1']

    def entradas(self, s, t, n):
        FPS, W, H = self.ctx.FPS, self.ctx.W, self.ctx.H
        dur = f'{n / FPS + 0.3:.3f}'
        fondo = self.ctx.marca.c.get('fondo_escenario', '#100d0c').lstrip('#')
        args = ['-ss', f'{self.src(self.kc, t):.4f}', '-t', dur, '-i', self.pistas[self.kc]['archivo']]
        if s.get('caja'):
            cw, ch, x, y = s['caja']
            v = f'crop={cw}:{ch}:{x}:{y},scale={W}:{H}:flags=lanczos'
        else:
            v = f'scale={W}:{H}:force_original_aspect_ratio=decrease:flags=lanczos,pad={W}:{H}:(ow-iw)/2:(oh-ih)/2:color=0x{fondo}'
        # sin grano ni contraste extra: el texto de una pantalla tiene que quedar nitido
        g = f'[0:v]setpts=PTS-STARTPTS,fps={FPS},{v},setsar=1'
        if s.get('pip') and self.kp:
            w, h, x, y = self.an['tile']
            lado = int(H * 0.26) & ~1
            m = int(H * 0.04)
            args += ['-ss', f'{self.src(self.kp, t):.4f}', '-t', dur, '-i', self.pistas[self.kp]['archivo']]
            g += (f'[sc];[1:v]setpts=PTS-STARTPTS,fps={FPS},{tipos.RUIDO}crop={w}:{h}:{x}:{y},{GRADO},scale={lado}:{lado}:flags=lanczos[pp];'
                  f'[sc][pp]overlay={W - lado - m}:{H - lado - m}:shortest=1[base]')
            return args, g, '[base]', 2
        return args, g + '[base]', '[base]', 1
