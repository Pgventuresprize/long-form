"""Etapa 6 · Render: tomas + silencios + gráficos en un solo paso, por trozos reutilizables.

Portado de render.py (taller) y de render.py + montaje.py (César), unificados:
1. Cada tramo conservado se parte en cada cambio de toma y en cada entrada o salida de una pieza.
2. Cada trozo se arma completo (plano o escenario + piezas activas por capa) y se guarda con un nombre que
   es el hash de su contenido: una correccion solo regenera los trozos que cambian.
3. Busqueda exacta (-ss antes de -i) y numero exacto de cuadros: el corte no depende de los keyframes.
4. Misma base de tiempo en todos los trozos: intro + trozos + cierre se unen sin recodificar.
5. Audio aparte, cortado en las mismas muestras con fundidos de 10 ms, mas cancion y efectos.

Nunca se reemplaza una salida anterior: cada render es una version nueva (v1, v2...).
"""
import hashlib
import json
import re
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np

from .. import config, ffm
from ..contexto import Mapa
from .. import tipos

GRADO = 'eq=contrast=1.04:saturation=1.06'


# ---------------------------------------------------------------- camaras separadas
class CompositorCamaras:
    def __init__(self, ctx):
        self.ctx = ctx
        an = ctx.estado['analisis']
        self.an = an
        self.fuentes = {f['clave']: f for f in tipos.fuentes(ctx)}
        self.claves = an['claves']

    def firma(self, toma):
        return [toma['plano'], self.an['offsets'], self.an['encuadres'], self.an.get('color'), 'r1']

    def centro(self, toma):
        """Donde esta la cara en el cuadro compuesto (fraccion del ancho), para reencuadrar a 9:16 o 1:1."""
        pl = toma['plano']
        if pl == 'TWO' or len(pl) < 2:
            return 0.5
        k = self.claves[0] if pl[0] == 'X' else pl[0]
        enc = self.an['encuadres'].get(k) or {}
        f = self.fuentes.get(k) or {}
        cx = (enc.get('cara') or [None])[0]
        if cx is None or not f.get('ancho'):
            return 0.5
        if pl[1] == 'C' and enc.get('cerrado'):
            cw, _, x0, _ = enc['cerrado']
            return min(max((cx - x0) / cw, 0.0), 1.0)
        # abierto: la fuente entera, escalada sin recortar y centrada
        W, H = self.ctx.W, self.ctx.H
        sw = min(W, f['ancho'] * H / f['alto'])
        return min(max(((W - sw) / 2 + cx / f['ancho'] * sw) / W, 0.0), 1.0)

    def _arreglo(self, k):
        """Color igualado a la maestra y ruido suave, antes de recortar."""
        from .. import tipos
        return f'{tipos.filtro_color((self.an.get("color") or {}).get(k))}{tipos.RUIDO}'

    def entradas(self, toma, t, n):
        """(args de entrada, grafo, etiqueta de salida). t: segundo del programa."""
        W, H, FPS = self.ctx.W, self.ctx.H, self.ctx.FPS
        pl = toma['plano']
        dur = n / FPS + 0.3

        def src(k):
            return self.an['inicio'] + t + self.an['offsets'][k]
        if pl == 'TWO':
            A, B = self.claves[0], self.claves[1]
            hw = (W - 4) // 2 & ~1
            ea, eb = self.an['encuadres'][A]['mitad'], self.an['encuadres'][B]['mitad']
            args = ['-ss', f'{src(A):.4f}', '-t', f'{dur:.3f}', '-i', self.fuentes[A]['archivo'],
                    '-ss', f'{src(B):.4f}', '-t', f'{dur:.3f}', '-i', self.fuentes[B]['archivo']]
            g = (f'[0:v]setpts=PTS-STARTPTS,fps={FPS},{self._arreglo(A)}crop={ea[0]}:{ea[1]}:{ea[2]}:{ea[3]},scale={hw}:{H}:flags=lanczos,setsar=1[ha];'
                 f'[1:v]setpts=PTS-STARTPTS,fps={FPS},{self._arreglo(B)}crop={eb[0]}:{eb[1]}:{eb[2]}:{eb[3]},scale={hw}:{H}:flags=lanczos,setsar=1[hb];'
                 f'color=c=black:s={W}x{H}:r={FPS}[neg];[neg][ha]overlay=0:0:shortest=1[n1];[n1][hb]overlay={W - hw}:0:shortest=1,{GRADO}[base]')
            return args, g, '[base]', 2
        k, tipo = pl[0], pl[1]
        if k == 'X':
            k = self.claves[0]
        args = ['-ss', f'{src(k):.4f}', '-t', f'{dur:.3f}', '-i', self.fuentes[k]['archivo']]
        if tipo == 'C':
            cw, ch, x, y = self.an['encuadres'][k]['cerrado']
            v = f'crop={cw}:{ch}:{x}:{y},scale={W}:{H}:flags=lanczos'
        else:
            v = f'scale={W}:{H}:force_original_aspect_ratio=decrease:flags=lanczos,pad={W}:{H}:(ow-iw)/2:(oh-ih)/2'
        return args, f'[0:v]setpts=PTS-STARTPTS,fps={FPS},{self._arreglo(k)}{v},{GRADO},setsar=1[base]', '[base]', 1


# ---------------------------------------------------------------- trozos
# Ningun trozo pasa de 20 s: se reparten mejor entre los hilos y, si una fuente tiene un punto dañado, se pierde
# poco al rehacer.
MAX_TROZO = 600


def trozos(keep, mapa, tomas, piezas, bordes_extra=()):
    return [x for c in _trozos(keep, mapa, tomas, piezas, bordes_extra) for x in _partir(c, mapa.fps)]


def _partir(c, fps):
    ox, oy, t = c
    if oy - ox <= MAX_TROZO:
        return [c]
    n = -(-(oy - ox) // MAX_TROZO)
    cortes = [ox + round((oy - ox) * i / n) for i in range(n + 1)]
    return [(u, v, t + (u - ox) / fps) for u, v in zip(cortes, cortes[1:])]


def _trozos(keep, mapa, tomas, piezas, bordes_extra=()):
    bordes = sorted({t['a'] for t in tomas} | set(bordes_extra))
    lista = []
    for k, (a, b) in enumerate(keep):
        pts = [a] + [t for t in bordes if a < t < b] + [b]
        for x, y in zip(pts, pts[1:]):
            ox = int(mapa.acc[k] + round((x - a) * mapa.fps))
            oy = int(mapa.acc[k] + round((y - a) * mapa.fps))
            if oy > ox:
                lista.append((ox, oy, x))
    extra = sorted({p['o0'] for p in piezas} | {p['o1'] for p in piezas})
    final = []
    for ox, oy, x in lista:
        pts = [ox] + [e for e in extra if ox < e < oy] + [oy]
        for u, v in zip(pts, pts[1:]):
            final.append((u, v, x + (u - ox) / mapa.fps))
    return final


def toma_de(tomas, t):
    for s in tomas:
        if s['a'] <= t < s['b']:
            return s
    return tomas[-1]


def render_trozo(ctx, comp, c, piezas, tomas, carpeta, extra_firma=None, lienzo=None):
    """Un trozo del video. Con `lienzo` (9:16 o 1:1, ver lienzo.py) se compone igual en 16:9 y se lleva al
    lienzo; sin el, es exactamente el trozo de siempre."""
    ox, oy, t = c
    n = oy - ox
    W, H, FPS = ctx.W, ctx.H, ctx.FPS
    s = toma_de(tomas, t + 0.01)
    act = sorted([p for p in piezas if p['o0'] < oy and p['o1'] > ox], key=lambda p: p['capa'])
    # 't4': trozos hechos sin reiniciar filtros y con el final rellenado (ver abajo); cambia la firma para no
    # reusar los de antes
    partes = ['t4', round(t, 3), n, W, H, s, comp.firma(s), [(p['pieza'], p['o0']) for p in act], extra_firma]
    reencuadre = lienzo is not None and lienzo.modo == 'reencuadre'
    if lienzo is not None:
        cx = comp.centro(s) if hasattr(comp, 'centro') else 0.5
        partes.append(lienzo.firma(cx))
    firma = json.dumps(partes, sort_keys=True, ensure_ascii=False, default=str)
    out = carpeta / (hashlib.md5(firma.encode()).hexdigest()[:16] + '.mp4')
    if out.exists() and out.stat().st_size > 1000:
        return out
    args, g, base, idx = comp.entradas(s, t, n)
    fc = [g]
    if reencuadre:
        f, base = lienzo.reencuadrar(base, s.get('plano'), cx)
        fc.append(f)
    for k, p in enumerate(act):
        args += ['-ss', f'{max(ox - p["o0"], 0) / FPS:.4f}', '-i', p['pieza']]
        pw, ph, px, py = lienzo.pieza(p) if reencuadre else (W, H, p.get('dx', 0), p.get('dy', 0))
        fc.append(f'[{idx}:v]scale={pw}:{ph}:flags=lanczos,format=rgba,setpts=PTS-STARTPTS+{max(p["o0"] - ox, 0) / FPS:.4f}/TB[o{k}]')
        fc.append(f'{base}[o{k}]overlay={px}:{py}:eof_action=pass:format=auto[v{k}]')
        base = f'[v{k}]'
        idx += 1
    if lienzo is not None and not reencuadre:
        f, base = lienzo.encajar(base)
        fc.append(f)
    # al final de una fuente puede faltar un cuadro o dos (el archivo termina una fraccion antes): se repite el
    # ultimo, hasta medio segundo. Mas que eso es una falta de verdad y la detecta la cuenta de abajo.
    fc.append(f'{base}tpad=stop_mode=clone:stop=15,scale=out_color_matrix=bt709:out_range=tv,format=yuv420p[fin]')
    tmp = out.with_suffix('.tmp.mp4')
    # Un video exportado de un editor puede cambiar de formato a mitad (tamaño, color): ffmpeg reiniciaria los
    # filtros ahi, los tiempos volverian a cero y se perderian cuadros. Se le pide que no los reinicie.
    args = [y for x in args for y in ((['-reinit_filter', '0', x]) if x == '-i' else [x])]
    ffm.correr(args + ['-filter_complex', ';'.join(fc), '-map', '[fin]', '-frames:v', str(n)] + ffm.ENC + [tmp])
    # un trozo corto descuadra todo lo que viene despues (graficos y audio): se detiene aqui con el motivo
    hechos = ffm.cuadros_de(tmp)
    if hechos != n:
        tmp.unlink(missing_ok=True)
        raise RuntimeError(f'Un trozo del video salió con {hechos} de {n} cuadros (segundo {t:.1f} de la grabación): '
                           'la fuente puede tener los tiempos dañados en ese punto')
    tmp.replace(out)
    return out


def tarjeta_clip(ctx, png, dur, out, fo, tamano=None):
    W, H = tamano or (ctx.W, ctx.H)
    if not out.exists():
        ffm.correr(['-loop', '1', '-framerate', str(ctx.FPS), '-i', png, '-vf',
                    f'scale={W}:{H}:flags=lanczos,fade=t=in:st=0:d=0.4,fade=t=out:st={dur - fo}:d={fo},format=yuv420p',
                    '-frames:v', str(int(round(dur * ctx.FPS)))] + ffm.ENC + [out])
    return out


def video_propio(ctx, ruta, dur, out, tamano=None):
    """La intro o el cierre propios de la marca (extremos.py), llevados al lienzo del video con los mismos
    parametros que los trozos (cuadros por segundo, color, codificador): asi se unen sin recodificar. Dura
    exactamente `dur` (ya en cuadros): si al clip le falta un cuadro al final se repite el ultimo."""
    from ..lienzo import encajar_video
    W, H = tamano or (ctx.W, ctx.H)
    n = int(round(dur * ctx.FPS))
    info = ffm.sondear(ruta)
    p = Path(ruta)
    firma = json.dumps(['vp1', str(p.resolve()), p.stat().st_size, n, W, H, ctx.FPS])
    out = out.with_name(f'{out.stem}_{hashlib.md5(firma.encode()).hexdigest()[:12]}.mp4')
    if out.exists() and out.stat().st_size > 1000:
        return out
    fc = (encajar_video(info['ancho'], info['alto'], W, H, ctx.FPS) +
          ';[vp]tpad=stop_mode=clone:stop=15,scale=out_color_matrix=bt709:out_range=tv,format=yuv420p[fin]')
    tmp = out.with_suffix('.tmp.mp4')
    ffm.correr(['-t', f'{dur + 0.5:.3f}', '-i', ruta, '-filter_complex', fc, '-map', '[fin]', '-frames:v', str(n)]
               + ffm.ENC + [tmp])
    hechos = ffm.cuadros_de(tmp)
    if hechos != n:
        tmp.unlink(missing_ok=True)
        raise RuntimeError(f'El video propio de la marca salió con {hechos} de {n} cuadros: revisa el archivo')
    tmp.replace(out)
    return out


def extremo_clip(ctx, ext, parte, png, carpeta, lz):
    """El clip de la intro o del cierre segun su modo, en el lienzo del video; None si no hay. La tarjeta de
    Studio es la de siempre (mismos filtros y mismos nombres)."""
    e = ext[parte]
    tam = (lz.LW, lz.LH) if lz else None
    if e['modo'] == 'ninguna' or e['s'] <= 0:
        return None
    if e['modo'] == 'video':
        ruta = e['video'] if e['video'] and Path(e['video']).exists() else ctx.marca.video(parte)
        if not ruta:
            raise RuntimeError(f'No está el video propio de la marca para {"la intro" if parte == "intro" else "el cierre"}: '
                               'vuelve a correr los gráficos')
        return video_propio(ctx, ruta, e['s'], carpeta / f'{parte}_propio.mp4', tam)
    fo = 0.4 if parte == 'intro' else 0.8
    if lz:
        return tarjeta_clip(ctx, png, e['s'], carpeta / f'{parte}_{lz.LW}x{lz.LH}.mp4', fo, tam)
    return tarjeta_clip(ctx, png, e['s'], carpeta / f'{parte}_{ctx.W}.mp4', fo)


def linea_final(gancho_s, intro, programa_s, outro):
    """Donde empieza cada parte del video final, en segundos: gancho, intro, programa y cierre. Sin gancho es la
    linea de siempre (intro en 0); sin intro o sin cierre (0 s), el programa va pegado a lo que tenga al lado."""
    a = float(gancho_s or 0)
    return {'gancho': 0.0, 'intro': a, 'programa': a + intro, 'cierre': a + intro + programa_s,
            'total': a + intro + programa_s + outro}


def tramos_gancho(keep, inicio, fin, fps=30):
    """Lo que se conserva (sin silencios ni cortes) dentro del gancho [inicio, fin] de la linea maestra, a
    cuadros exactos como el keep."""
    out = []
    for a, b in keep:
        x, y = round(max(a, inicio) * fps) / fps, round(min(b, fin) * fps) / fps
        if y - x > 0.08:
            out.append((x, y))
    return out


# ---------------------------------------------------------------- audio
def lufs_fondo(volumen):
    """Volumen del fondo (0 a 1, del estilo) a sonoridad: 0,35 queda cerca de -30 LUFS, muy por debajo de la
    voz (-16). Al maximo llega a -20: sigue siendo fondo."""
    return -36.0 + 16.0 * max(0.0, min(1.0, volumen))


def bucle(y, n, sr, cruce=1.0):
    """Repite una cancion hasta n muestras, con un cruce de `cruce` s en cada vuelta para que no se note el
    empalme. Si ya alcanza, se corta."""
    if len(y) >= n:
        return y[:n].copy()
    c = min(int(cruce * sr), len(y) // 4)
    paso = len(y) - c
    out = np.zeros((n, y.shape[1]), np.float32)
    r = np.linspace(0, 1, c, dtype=np.float32)[:, None] if c else None
    pos = 0
    while pos < n:
        seg = y.copy()
        if c:
            if pos:
                seg[:c] *= r
            seg[-c:] *= r[::-1]
        e = min(n, pos + len(seg))
        out[pos:e] += seg[:e - pos]
        pos += paso
    return out


def ganancia_ducking(voz, sr, baja_db=10.0, ventana=0.05, ataque=0.12, suelta=0.7, sosten=0.3):
    """Cuanto bajar el fondo en cada muestra segun la voz (mono). Con voz baja `baja_db`; sin voz vuelve a 0 dB.
    Baja rapido (`ataque`), sube lento (`suelta`) y aguanta `sosten` s entre palabras: asi no "bombea"."""
    n = len(voz)
    h = max(1, int(sr * ventana))
    m = -(-n // h)
    marco = np.zeros(m * h, np.float32)
    marco[:n] = voz
    db = 10 * np.log10((marco.reshape(m, h).astype(np.float64) ** 2).mean(axis=1) + 1e-12)
    activos = db[db > -70]
    if not len(activos):
        return np.ones(n, np.float32)
    # La voz es lo fuerte del programa: su nivel tipico menos 18 dB separa voz de respiraciones y sala.
    hay = db > np.percentile(activos, 60) - 18
    k = max(1, int(sosten / ventana))
    hay = np.convolve(hay.astype(float), np.ones(2 * k + 1), 'same') > 0
    objetivo = np.where(hay, -float(baja_db), 0.0)
    ca, cs = np.exp(-ventana / ataque), np.exp(-ventana / suelta)
    g = np.empty(m)
    x = 0.0
    for i in range(m):
        c = ca if objetivo[i] < x else cs
        x = c * x + (1 - c) * objetivo[i]
        g[i] = x
    return np.repeat(10 ** (g / 20), h)[:n].astype(np.float32)


def audio(ctx, keep, mapa, piezas, wav_programa, intro, outro, reducir_ruido=True, gancho=None, extremos=None):
    """La mezcla del video final. `gancho`: (keep, mapa) del gancho, que suena antes de la intro; todo lo demas
    se corre lo que dura. `extremos`: la intro y el cierre resueltos (extremos.de_graficos); sin ellos, las
    tarjetas de Studio con la musica de inicio y de cierre, como siempre. Un video propio suena con su audio
    (si no trae, con la musica de la marca); sin intro o sin cierre no suena nada en su lugar."""
    sr = 48000
    tmp = ctx.tj('render') / 'programa_tratado.wav'
    # Ruido suave (afftdn a 8 dB): baja el zumbido de sala sin el sonido "bajo el agua". Un video ya editado
    # trae su propia mezcla y no se toca.
    ruido = 'afftdn=nr=8:nf=-40,' if reducir_ruido else ''
    ffm.extraer_audio(wav_programa, tmp, sr, 2, f'highpass=f=80,{ruido}acompressor=threshold=-20dB:ratio=3:attack=10:release=200:makeup=2,'
                                               'loudnorm=I=-16:TP=-1.5:LRA=11')
    _, prog = ffm.leer_wav(tmp)
    prog = np.asarray(prog)
    tot = mapa.total
    L = linea_final(gancho[1].total / ctx.FPS if gancho else 0, intro, tot / ctx.FPS, outro)
    total = L['total']
    mix = np.zeros((int(total * sr) + sr, 2), np.float32)
    xf = int(0.01 * sr)
    r = np.linspace(0, 1, xf)[:, None].astype(np.float32)

    def tramos(kp, mp, desde):
        for i, (a, b) in enumerate(kp):
            n = int(round((mp.acc[i + 1] - mp.acc[i]) / ctx.FPS * sr))
            seg = prog[int(a * sr):int(a * sr) + n].copy()
            if len(seg) > 2 * xf:
                seg[:xf] *= r
                seg[-xf:] *= r[::-1]
            s = int(round((desde + mp.acc[i] / ctx.FPS) * sr))
            mix[s:s + len(seg)] += seg
    tramos(keep, mapa, L['programa'])
    if gancho:
        tramos(gancho[0], gancho[1], L['gancho'])
        # el gancho se apaga en un cuarto de segundo antes de la tarjeta (y su musica)
        e = int(L['intro'] * sr)
        n = min(int(0.25 * sr), e)
        mix[e - n:e] *= np.linspace(1, 0, n, dtype=np.float32)[:, None]

    def carga(ruta, filtro=None):
        p = ctx.tj('render') / 'tmp_carga.wav'
        ffm.extraer_audio(ruta, p, sr, 2, filtro)
        _, y = ffm.leer_wav(p)
        return np.asarray(y)

    def fo(y, secs):
        y = y.copy()
        n = min(int(secs * sr), len(y))
        y[-n:] *= np.linspace(1, 0, n)[:, None]
        return y

    def put(y, at, g=1.0):
        s = int(at * sr)
        e = min(len(mix), s + len(y))
        if e > s:
            mix[s:e] += y[:e - s] * g
    m = ctx.marca
    lufs = m.cfg.get('musica', {}).get('loudness_lufs', -17)

    def con_audio(ruta, nombre):
        # De un video (MP4, MOV) se usa su audio; si no trae pista de audio, se avisa y se sigue sin ella.
        if ruta and not ffm.sondear(ruta)['audio']:
            ctx.aviso(f'{nombre} no tiene sonido: el video sale sin esa música.')
            return None
        return ruta

    def cancion(clave):
        # La que se subio con el video (lf_archivos tipo musica, rol = intro/fondo/cierre), la que se eligio
        # de la biblioteca para este video (spec.musica_<clave>, en Storage) o la del estilo de la marca.
        from pathlib import Path
        subida = next((a for a in ctx.archivos('musica') if a.get('rol') == clave), None)
        if subida:
            return con_audio(str(ctx.local(subida)), subida.get('nombre') or 'La música')
        ruta = ctx.spec.get(f'musica_{clave}')
        if ruta:
            return con_audio(str(ctx.local({'ruta': ruta, 'nombre_local': f'musica_{clave}_{Path(ruta).name}'})), 'La música elegida')
        return con_audio(m.musica(clave), 'La música de la marca')
    ext = extremos or {}

    def propio(parte, dur):
        # El sonido del video propio de la marca, si lo trae: reemplaza la musica de ese momento.
        e = ext.get(parte) or {}
        if e.get('modo') != 'video' or not e.get('audio') or not e.get('video') or dur <= 0:
            return None
        p = ctx.tj('render') / f'tmp_{parte}_propio.wav'
        # se corta antes de normalizar: loudnorm mide solo lo que de verdad suena en el video
        ffm.extraer_audio(e['video'], p, sr, 2, f'atrim=0:{dur:.4f},asetpts=PTS-STARTPTS,loudnorm=I={lufs}:TP=-1.5')
        _, y = ffm.leer_wav(p)
        y = np.asarray(y)[:int(dur * sr)].copy()
        if len(y) > 2 * xf:
            y[:xf] *= r
            y[-xf:] *= r[::-1]
        return y

    def con_musica(parte, dur):
        # La tarjeta de Studio, o un video propio sin sonido, llevan la musica de la marca; sin intro, nada.
        # Sin `extremos` se busca como siempre.
        if not ext:
            return True
        e = ext.get(parte) or {}
        return dur > 0 and e.get('modo', 'studio') != 'ninguna' and propio_de[parte] is None
    propio_de = {'intro': propio('intro', intro), 'cierre': propio('cierre', outro)}
    musica_intro = cancion('intro') if con_musica('intro', intro) else None
    musica_cierre = cancion('cierre') if con_musica('cierre', outro) else None
    musica_fondo = cancion('fondo')
    if musica_fondo:
        # Fondo: bajo toda la conversacion, en bucle si es corta, y baja sola cuando alguien habla (ducking).
        vol = float(ctx.opcion('volumen_fondo', m.cfg.get('musica', {}).get('volumen_fondo', 0.35)))
        a0, n = int(L['programa'] * sr), int(tot / ctx.FPS * sr)
        y = bucle(carga(musica_fondo, f'loudnorm=I={lufs_fondo(vol):.1f}:TP=-3'), n, sr)
        y *= ganancia_ducking(mix[a0:a0 + n].mean(axis=1), sr, float(ctx.opcion('fondo_baja_db', 10)))[:, None]
        y[:int(1.5 * sr)] *= np.linspace(0, 1, min(int(1.5 * sr), len(y)))[:, None]
        put(fo(y, 2.5), L['programa'])
    if musica_intro:
        put(fo(carga(musica_intro, f'loudnorm=I={lufs}:TP=-1.5')[:int(intro * sr)], 1.6), L['intro'])
    if musica_cierre:
        put(fo(carga(musica_cierre, f'loudnorm=I={lufs}:TP=-1.5')[:int(outro * sr)], 2.0), L['cierre'])
    for parte, at in (('intro', L['intro']), ('cierre', L['cierre'])):
        if propio_de[parte] is not None:
            put(propio_de[parte], at)
    cache = {}
    g_sfx = ctx.opcion('volumen_efectos', 0.7)
    for p in piezas:
        for key, fr in (('sfx', p['o0']), ('sfx_fin', p['o1'] - 18)):
            nombre = p.get(key)
            if not nombre:
                continue
            ruta = m.sfx(nombre)
            if not ruta:
                continue
            if nombre not in cache:
                cache[nombre] = carga(ruta)
            put(cache[nombre], L['programa'] + fr / ctx.FPS, g_sfx)
    if np.abs(mix).max() > 0.97:
        mix = np.tanh(mix / 0.97) * 0.97
    wav = ctx.tj('render') / 'audio.wav'
    ffm.escribir_wav(wav, sr, mix[:int(total * sr)])
    return wav


def nombre_salida(ctx, version):
    t = re.sub(r'[\\/:*?"<>|]+', '', ctx.spec.get('titulo') or 'video').strip()[:80]
    return f'{t} (v{version}).mp4'


def compositor(ctx):
    from .. import tipos
    return tipos.de(ctx).compositor(ctx)


def correr(ctx):
    gr = ctx.estado.get('graficos')
    from pathlib import Path
    if not gr or not all(Path(p['pieza']).exists() for p in gr['piezas']) or not Path(gr['intro']).exists():
        # la carpeta de trabajo es cache: si otro worker hizo los graficos, se rehacen aqui
        from . import graficos
        ctx.log('Las piezas no están en este worker: se vuelven a generar')
        graficos.correr(ctx)
        gr = ctx.estado['graficos']
    keep = [tuple(k) for k in ctx.estado['keep']]
    # la intro y el cierre que fijo la etapa de graficos (extremos.py): tarjeta, video de la marca o nada
    from .. import extremos
    ext = extremos.de_graficos(gr)
    intro, outro = ext['intro']['s'], ext['cierre']['s']
    mapa = Mapa(keep, ctx.FPS, intro)
    tomas = ctx.estado.get('tomas_render') or ctx.estado['tomas']
    piezas = gr['piezas']
    comp = compositor(ctx)
    carpeta = ctx.tj('render')
    (carpeta / 'trozos').mkdir(parents=True, exist_ok=True)
    extra = getattr(comp, 'bordes', lambda: [])()
    # 9:16 o 1:1: cada trozo se compone en 16:9 y se lleva al lienzo (lienzo.py); en 16:9 no cambia nada
    from ..lienzo import lienzo_de
    lz = lienzo_de(ctx)
    cs = trozos(keep, mapa, tomas, piezas, extra)
    # el gancho: lo que se conserva de su tramo, sin graficos, antes de la tarjeta de intro
    keep_g = [tuple(k) for k in gr.get('gancho_keep') or []]
    mapa_g = Mapa(keep_g, ctx.FPS, 0.0) if keep_g else None
    cs_g = trozos(keep_g, mapa_g, tomas, [], extra) if keep_g else []
    ctx.log(f'{len(cs)} trozos, {mapa.total / ctx.FPS / 60:.1f} min, {config.HILOS} hilos'
            + (f'; gancho de {mapa_g.total / ctx.FPS:.1f} s en {len(cs_g)} trozos' if keep_g else '')
            + (f'; lienzo {ctx.formato} ({lz.modo})' if lz else ''))
    if hasattr(comp, 'preparar'):
        comp.preparar(cs + cs_g, tomas)   # capas del escenario en serie, antes de los hilos
    trabajos = [(c, piezas) for c in cs] + [(c, []) for c in cs_g]
    hechas = [None] * len(trabajos)
    hechos = 0

    def uno(i):
        c, ps = trabajos[i]
        return i, render_trozo(ctx, comp, c, ps, tomas, carpeta / 'trozos', lienzo=lz)
    with ThreadPoolExecutor(config.HILOS) as ex:
        for i, ruta in ex.map(uno, range(len(trabajos))):
            hechas[i] = ruta
            hechos += 1
            if hechos % 10 == 0 or hechos == len(trabajos):
                ctx.avance(f'Trozo {hechos} de {len(trabajos)}', .85 * hechos / len(trabajos))
    salidas, salidas_g = hechas[:len(cs)], hechas[len(cs):]
    ini = extremo_clip(ctx, ext, 'intro', gr['intro'], carpeta, lz)
    fin = extremo_clip(ctx, ext, 'cierre', gr['cierre'], carpeta, lz)
    ini_l, fin_l = ([ini] if ini else []), ([fin] if fin else [])
    vid = carpeta / 'video.mp4'
    ffm.concatenar(salidas_g + ini_l + salidas + fin_l, vid)
    final = vid
    subt = bool(ctx.eleccion('subtitulos', False))
    if subt:
        ctx.avance('Poniendo los subtítulos', .88)
        con_s, con_s_g = subtitular(ctx, lz, gr.get('disposicion', 'pantalla'), mapa, mapa_g, keep_g, piezas,
                                    cs, cs_g, salidas, salidas_g, carpeta / 'subtitulos')
        final = carpeta / 'video_subtitulado.mp4'
        ffm.concatenar(con_s_g + ini_l + con_s + fin_l, final)
    ctx.avance('Mezclando audio', .93)
    from .. import tipos
    wav = audio(ctx, keep, mapa, piezas, tipos.programa(ctx, 48000), intro, outro, tipos.de(ctx).reduce_ruido_audio,
                gancho=(keep_g, mapa_g) if keep_g else None, extremos=ext)
    version = int(ctx.estado.get('render', {}).get('version', 0)) + 1
    nombre = nombre_salida(ctx, version)
    salida = ctx.salida / nombre
    ffm.correr(['-i', final, '-i', wav, '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k',
                '-movflags', '+faststart', '-shortest', salida])
    ctx.avance('Subiendo el video', .97)
    remoto = ctx.alm.subir(ctx.pid, salida, nombre, 'video/mp4', clase='salida', version=version)
    anteriores = ctx.estado.get('render', {}).get('versiones', [])
    L = linea_final(mapa_g.total / ctx.FPS if keep_g else 0, intro, mapa.total / ctx.FPS, outro)
    info = {'version': version, 'archivo': nombre, 'remoto': remoto, 'local': str(salida),
            'duracion': round(L['total'], 2), 'trozos': len(cs),
            'versiones': anteriores + [{'version': version, 'archivo': nombre, 'remoto': remoto}]}
    if lz or subt or keep_g:
        # lo nuevo solo se anota cuando se usa: un video 16:9 sin gancho ni subtitulos deja el estado de siempre
        info.update(formato=ctx.formato, resolucion=f'{lz.LW}x{lz.LH}' if lz else f'{ctx.W}x{ctx.H}',
                    subtitulos=subt, gancho_s=round(L['intro'], 2))
        if subt:
            info['limpio'] = str(vid)     # sin subtitulos, en la cache: de ahi salen los clips
    if any(ext[p]['modo'] != 'studio' for p in extremos.PARTES):
        info.update(intro=ext['intro']['modo'], cierre=ext['cierre']['modo'], intro_s=intro, cierre_s=outro)
    ctx.guardar('render', info)
    ctx.log(f'listo {nombre}')


def subtitular(ctx, lz, disposicion, mapa, mapa_g, keep_g, piezas, cs, cs_g, salidas, salidas_g, carpeta):
    """Los trozos con sus subtitulos quemados (subtitulos.py). Devuelve (programa, gancho)."""
    from .. import subtitulos as S
    from ..lienzo import posiciones_subtitulos
    from .clips import corrector
    carpeta.mkdir(parents=True, exist_ok=True)
    FPS = ctx.FPS
    segs = ctx.json_trabajo('transcripcion.json')
    fix = corrector(ctx)
    yn, ya = posiciones_subtitulos(ctx.formato, disposicion, lz, ctx.W, ctx.H)
    ventanas = S.ventanas_franja(piezas, FPS)
    cab, ev, cues = S.armar(ctx, S.palabras(segs, mapa, fix), ventanas, ctx.formato, yn, ya, carpeta, 'programa')
    altas = len(S.repartir(cues, ventanas)[1]) if ya < yn else 0
    ctx.log(f'subtítulos: {len(cues)} tarjetas a {yn} del alto; {altas} suben a {ya} porque hay una pieza en la franja inferior')
    trabajos = []
    for i, (ox, oy, _) in enumerate(cs):
        txt = S.ass_de_tramo(cab, ev, ox / FPS, oy / FPS) if cab else None
        if txt:
            trabajos.append(('p', i, salidas[i], txt, oy - ox))
    if keep_g:
        a, b = keep_g[0][0], keep_g[-1][1]
        cab_g, ev_g, _ = S.armar(ctx, S.palabras(segs, mapa_g, fix, a, b), [], ctx.formato, yn, yn, carpeta, 'gancho')
        for i, (ox, oy, _) in enumerate(cs_g):
            txt = S.ass_de_tramo(cab_g, ev_g, ox / FPS, oy / FPS) if cab_g else None
            if txt:
                trabajos.append(('g', i, salidas_g[i], txt, oy - ox))
    con, con_g = list(salidas), list(salidas_g)

    def uno(tr):
        return tr, S.quemar(tr[2], tr[3], tr[4], carpeta)
    hechos = 0
    with ThreadPoolExecutor(config.HILOS) as ex:
        for (cual, i, *_), ruta in ex.map(uno, trabajos):
            (con if cual == 'p' else con_g)[i] = ruta
            hechos += 1
            if hechos % 10 == 0 or hechos == len(trabajos):
                ctx.avance(f'Subtítulos {hechos} de {len(trabajos)}', .88 + .05 * hechos / max(len(trabajos), 1))
    return con, con_g
