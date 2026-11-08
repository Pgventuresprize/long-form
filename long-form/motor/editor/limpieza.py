"""Quita la píldora de hover de Meet (pin, micrófono, menú) de los recuadros de persona.

Portado de limpia.py del taller. La pildora es una capa oscura semitransparente: I' = g*I + (1-g)*c.
- Se calibra en el propio video: el promedio de muchos cuadros deja ver la pildora quieta; sus bordes son
  los saltos de luz mas fuertes, y (g, c) salen de casar por cuantiles los pixeles justo adentro y justo
  afuera del borde (en el taller: g = 0,35, es decir 65 % de opacidad).
- Los iconos se rastrean cuadro a cuadro con una plantilla de alto contraste (correlacion normalizada),
  descartando las zonas planas, donde la correlacion da 1,0 sin significar nada.
- Se invierte la formula adentro, se invierte la sombra que la pildora proyecta 3 px hacia abajo, y el
  anillo del borde y los iconos se rellenan desde sus vecinos (inpainting Telea).
- Todo en YUV 4:4:4 para no meter errores de color; la pista limpia sale casi sin perdida (CRF 13).
El resultado no es perfecto (residuo cercano al 1 %): queda marcado para revisar a tamaño real.
"""
import subprocess

import numpy as np

from . import config

# sube VERSION cuando cambie el algoritmo: la firma de los trozos del render depende de ella
VERSION = 'limpieza-v2'
G_MEET = 0.35
CAPA_MEET = np.array([45.0, 129.0, 127.5])
PERFIL_SOMBRA = np.array([.25, .22, .17, .13, .09, .065, .045, .03, .027, .023, .018, .007, 0]) * 0.85


def cuadros(video, zona, t0, dur, fps):
    x, y, w, h = zona
    p = subprocess.Popen([config.FFMPEG, '-loglevel', 'error', '-ss', f'{t0:.4f}', '-t', f'{dur:.3f}', '-i', str(video),
                          '-map', '0:v:0', '-vf', f'fps={fps},crop={w}:{h}:{x}:{y},format=yuv444p', '-f', 'rawvideo', '-'],
                         stdout=subprocess.PIPE, bufsize=10 ** 7)
    n = w * h * 3
    while True:
        b = p.stdout.read(n)
        if len(b) < n:
            break
        yield np.frombuffer(b, np.uint8).reshape(3, h, w).transpose(1, 2, 0)
    p.wait()


def forma(pw, ph):
    import cv2
    s = 4
    m = np.zeros((ph * s, pw * s), np.uint8)
    r = ph * s // 2
    cv2.rectangle(m, (r, 0), (pw * s - r, ph * s - 1), 255, -1)
    cv2.circle(m, (r, r), r, 255, -1)
    cv2.circle(m, (pw * s - r, r), r, 255, -1)
    return cv2.resize(m, (pw, ph), interpolation=cv2.INTER_AREA)


def hp(y, s=6.0):
    import cv2
    y = y.astype(np.float32)
    return y - cv2.GaussianBlur(y, (0, 0), s)


class Limpiador:
    def __init__(self, video, tile, a, b, fps, dpr):
        self.video, self.tile, self.a, self.b, self.fps = video, tile, a, b, fps
        self.ph = 44 * dpr
        self.dpr = dpr
        self.pad = 7 * dpr

    def calibrar(self):
        """Posicion, tamaño, opacidad y color de la pildora a partir del promedio del tramo."""
        x, y, w, h = self.tile
        pila = []
        dur = min(self.b - self.a, 40)
        paso = max(1, int(dur * self.fps / 120))
        for i, f in enumerate(cuadros(self.video, self.tile, self.a, dur, self.fps)):
            if i % paso == 0:
                pila.append(f.astype(np.float32))
        if len(pila) < 5:
            raise RuntimeError('muy pocos cuadros para calibrar la píldora')
        pila = np.stack(pila)
        Y = pila[:, :, :, 0].mean(0)
        ph = self.ph
        cy = h / 2
        # borde superior e inferior: saltos de luz alrededor del centro
        banda = Y[:, int(w * .4):int(w * .6)].mean(1)
        d = np.diff(banda)
        lo = int(cy - ph / 2 - 12)
        top = lo + int(np.argmin(d[lo:lo + 24])) + 1
        bot = top + ph
        filas = Y[top + 8:bot - 8].mean(0)
        dx = np.diff(filas)
        mejor = None
        for pw in (88 * self.dpr, 132 * self.dpr):      # dos o tres iconos
            izq = int(w / 2 - pw / 2)
            if izq < 8 or izq + pw > w - 8:
                continue
            fuerza = -dx[izq - 3:izq + 3].min() + dx[izq + pw - 3:izq + pw + 3].max()
            if mejor is None or fuerza > mejor[0]:
                mejor = (fuerza, pw, izq)
        if mejor is None:
            raise RuntimeError('el recuadro es muy chico para la píldora')
        _, pw, izq = mejor
        self.pw, self.x0, self.y0 = pw, izq, top
        # (g, b) por plano: cuantiles adentro contra afuera del borde superior e inferior
        g_b = []
        for c in range(3):
            ins = np.concatenate([pila[:, top + 6, izq + 30:izq + pw - 30, c].ravel(), pila[:, bot - 7, izq + 30:izq + pw - 30, c].ravel()])
            ext = np.concatenate([pila[:, top - 6, izq + 30:izq + pw - 30, c].ravel(), pila[:, bot + 6, izq + 30:izq + pw - 30, c].ravel()])
            q = np.linspace(5, 95, 19)
            g, b = np.polyfit(np.percentile(ext, q), np.percentile(ins, q), 1)
            g_b.append((float(g), float(b)))
        # la medicion confirma que es la pildora (opacidad en la luz, Y); para invertir se usan las constantes
        # de Meet medidas a mano en el taller (g = 0,35 y gris YUV 45/129/127,5): dan menos residuo que la
        # medicion automatica de un tramo corto, que tiende a aclarar de mas.
        self.g_medido = float(g_b[0][0])
        self.g = G_MEET
        self.capa = CAPA_MEET.copy()
        T = hp(Y)[top:top + ph, izq:izq + pw]
        self._preparar(T)
        return {'pw': pw, 'x': izq, 'y': top, 'g': round(self.g_medido, 3)}

    def _preparar(self, T):
        import cv2
        ph, pw, p = self.ph, self.pw, self.pad
        fm0 = forma(pw, ph)
        hueco = cv2.erode(fm0, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7)))
        ico = ((T > 9) & (hueco > 200)).astype(np.uint8) * 255
        ico = cv2.morphologyEx(ico, cv2.MORPH_OPEN, np.ones((2, 2), np.uint8))
        ys, xs = np.nonzero(ico)
        if len(xs) < 20:
            raise RuntimeError('no se distinguen los iconos de la píldora')
        self.ox, self.oy = max(int(xs.min()) - 4, 0), max(int(ys.min()) - 4, 0)
        x1, y1 = min(int(xs.max()) + 5, pw), min(int(ys.max()) + 5, ph)
        self.tpl = T[self.oy:y1, self.ox:x1].astype(np.float32)
        base = np.zeros((ph + 2 * p, pw + 2 * p), np.uint8)
        fm = np.zeros_like(base)
        fm[p:p + ph, p:p + pw] = fm0
        k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
        ani = cv2.subtract(cv2.dilate(fm, k), cv2.erode(fm, k))
        ic = np.zeros_like(base)
        ic[p:p + ph, p:p + pw] = ico
        ic = cv2.dilate(ic, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7)))
        self.rell = cv2.bitwise_or((ani > 20).astype(np.uint8) * 255, ic)
        sf = np.zeros_like(fm)
        sf[3:] = fm[:-3]
        fuera = cv2.distanceTransform((sf < 128).astype(np.uint8), cv2.DIST_L2, 5)
        adentro = cv2.distanceTransform((sf >= 128).astype(np.uint8), cv2.DIST_L2, 5)
        self.sombra = (np.interp(fuera - adentro, np.arange(-3, 10), PERFIL_SOMBRA) * (fm < 128)).astype(np.float32)[:, :, None]
        self.dentro = (cv2.erode(fm, k).astype(np.float32) / 255)[:, :, None]

    def busca(self, Yf):
        import cv2
        ox = max(self.x0 + self.ox - 6, 0)
        oy = max(self.y0 + self.oy - 6, 0)
        th, tw = self.tpl.shape
        Y = Yf[oy:oy + th + 12, ox:ox + tw + 12]
        H = hp(Y)
        if H.shape[0] < th or H.shape[1] < tw:
            return 0, self.x0, self.y0, 0
        r = cv2.matchTemplate(H, self.tpl, cv2.TM_CCOEFF_NORMED)
        m1 = cv2.boxFilter(H, -1, (tw, th), anchor=(0, 0), borderType=cv2.BORDER_CONSTANT)
        m2 = cv2.boxFilter(H * H, -1, (tw, th), anchor=(0, 0), borderType=cv2.BORDER_CONSTANT)
        var = (m2 - m1 * m1)[:r.shape[0], :r.shape[1]]
        r = np.where(np.isfinite(r) & (var > 6), r, -1).astype(np.float32)
        _, v, _, loc = cv2.minMaxLoc(r)
        trozo = H[loc[1]:loc[1] + th, loc[0]:loc[0] + tw]
        k = float((trozo * self.tpl).sum() / max((self.tpl * self.tpl).sum(), 1))
        return v, loc[0] + ox - self.ox, loc[1] + oy - self.oy, k

    def quita(self, f, x, y, k=1.0):
        import cv2
        p, ph, pw = self.pad, self.ph, self.pw
        h, w = f.shape[:2]
        if x - p < 0 or y - p < 0 or x + pw + p > w or y + ph + p > h:
            return f
        o = f.copy()
        roi = o[y - p:y + ph + p, x - p:x + pw + p].astype(np.float32)
        g = 1 - k * (1 - self.g)
        inv = (roi - (1 - g) * self.capa[None, None, :]) / g
        inv[:, :, 0] = cv2.GaussianBlur(inv[:, :, 0], (0, 0), 0.6)
        inv[:, :, 1] = cv2.GaussianBlur(inv[:, :, 1], (0, 0), 1.6)
        inv[:, :, 2] = cv2.GaussianBlur(inv[:, :, 2], (0, 0), 1.6)
        negro = np.array([16.0, 128.0, 128.0])[None, None, :]
        roi = negro + (roi - negro) / (1 - self.sombra * k)
        mez = np.clip(roi * (1 - self.dentro) + inv * self.dentro, 0, 255).astype(np.uint8)
        o[y - p:y + ph + p, x - p:x + pw + p] = cv2.inpaint(mez, self.rell, 3, cv2.INPAINT_TELEA)
        return o


def pista_limpia(ctx, video, tile, a, b, dpr, destino):
    """Genera la pista del recuadro sin pildora para el tramo [a, b) (segundos de la fuente)."""
    L = Limpiador(video, tile, a, b, ctx.FPS, dpr)
    cal = L.calibrar()
    if not 0.25 <= cal['g'] <= 0.55:
        # la pildora real tapa entre 45 y 85 %; fuera de eso es otra cosa (una mano, un cambio de luz)
        raise RuntimeError(f'la opacidad medida ({1 - cal["g"]:.0%}) no es la de una píldora')
    w, h = tile[2], tile[3]
    tmp = destino.with_suffix('.tmp.mp4')
    enc = subprocess.Popen([config.FFMPEG, '-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'yuv444p', '-s', f'{w}x{h}',
                            '-r', str(ctx.FPS), '-i', '-', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '13', '-g', '30',
                            '-pix_fmt', 'yuv420p', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709',
                            '-color_range', 'tv', str(tmp)], stdin=subprocess.PIPE)
    n = on = 0
    for f in cuadros(video, tile, a, b - a + 0.2, ctx.FPS):
        v, x, y, k = L.busca(f[:, :, 0])
        si = v >= 0.62 and k > 0.12
        k = 1.0 if k > 0.6 else k
        o = L.quita(f, x, y, k) if si else f
        enc.stdin.write(o.transpose(2, 0, 1).tobytes())
        n += 1
        on += int(si)
    enc.stdin.close()
    enc.wait()
    tmp.replace(destino)
    cal.update({'cuadros': n, 'con_pildora': on})
    return cal


def correr(ctx, tomas):
    """Una pista limpia por cada tramo continuo con pildora sobre el mismo recuadro."""
    import hashlib
    import json
    info = ctx.estado['ingesta']['fuentes'][0]
    dpr = 2 if info['ancho'] >= 2560 else 1
    grupos = []
    for s in tomas:
        if not s.get('pill') or 'tile' not in s:
            continue
        if grupos and grupos[-1]['tile'] == s['tile'] and abs(grupos[-1]['b'] - s['a']) < 1e-6:
            grupos[-1]['b'] = s['b']
        else:
            grupos.append({'tile': s['tile'], 'a': s['a'], 'b': s['b']})
    d = ctx.tj('limpio')
    d.mkdir(exist_ok=True)
    pistas = []
    for i, g in enumerate(grupos):
        clave = hashlib.md5(json.dumps([VERSION, info['archivo'], g]).encode()).hexdigest()[:12]
        destino = d / f'{clave}.mp4'
        ctx.avance(f'Limpiando la píldora de Meet ({i + 1} de {len(grupos)})', .02)
        try:
            if not destino.exists():
                cal = pista_limpia(ctx, info['archivo'], g['tile'], g['a'], g['b'], dpr, destino)
                ctx.log(f'píldora {g["a"]:.0f}–{g["b"]:.0f} s: opacidad {1 - cal["g"]:.0%}, '
                        f'{cal["con_pildora"]} de {cal["cuadros"]} cuadros limpiados')
            pistas.append({**g, 'ruta': str(destino), 'clave': clave})
        except Exception as e:  # noqa: BLE001
            ctx.log(f'{g["a"]:.0f}–{g["b"]:.0f} s: {e}; se deja el recuadro como está', 'aviso')
    ctx.guardar('limpieza', {'pistas': pistas})
    return pistas
