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

import numpy as np

from .. import config, ffm
from ..contexto import Mapa

GRADO = 'eq=contrast=1.04:saturation=1.06'


# ---------------------------------------------------------------- camaras separadas
class CompositorCamaras:
    def __init__(self, ctx):
        self.ctx = ctx
        an = ctx.estado['analisis']
        self.an = an
        self.fuentes = {f['clave']: f for f in ctx.estado['ingesta']['fuentes']}
        self.claves = an['claves']

    def firma(self, toma):
        return [toma['plano'], self.an['offsets'], self.an['encuadres']]

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
            g = (f'[0:v]fps={FPS},setpts=PTS-STARTPTS,crop={ea[0]}:{ea[1]}:{ea[2]}:{ea[3]},scale={hw}:{H}:flags=lanczos,setsar=1[ha];'
                 f'[1:v]fps={FPS},setpts=PTS-STARTPTS,crop={eb[0]}:{eb[1]}:{eb[2]}:{eb[3]},scale={hw}:{H}:flags=lanczos,setsar=1[hb];'
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
        return args, f'[0:v]fps={FPS},setpts=PTS-STARTPTS,{v},{GRADO},setsar=1[base]', '[base]', 1


# ---------------------------------------------------------------- trozos
def trozos(keep, mapa, tomas, piezas, bordes_extra=()):
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


def render_trozo(ctx, comp, c, piezas, tomas, carpeta, extra_firma=None):
    ox, oy, t = c
    n = oy - ox
    W, H, FPS = ctx.W, ctx.H, ctx.FPS
    s = toma_de(tomas, t + 0.01)
    act = sorted([p for p in piezas if p['o0'] < oy and p['o1'] > ox], key=lambda p: p['capa'])
    firma = json.dumps([round(t, 3), n, W, H, s, comp.firma(s), [(p['pieza'], p['o0']) for p in act], extra_firma],
                       sort_keys=True, ensure_ascii=False, default=str)
    out = carpeta / (hashlib.md5(firma.encode()).hexdigest()[:16] + '.mp4')
    if out.exists() and out.stat().st_size > 1000:
        return out
    args, g, base, idx = comp.entradas(s, t, n)
    fc = [g]
    for k, p in enumerate(act):
        args += ['-ss', f'{max(ox - p["o0"], 0) / FPS:.4f}', '-i', p['pieza']]
        fc.append(f'[{idx}:v]scale={W}:{H}:flags=lanczos,format=rgba,setpts=PTS-STARTPTS+{max(p["o0"] - ox, 0) / FPS:.4f}/TB[o{k}]')
        fc.append(f'{base}[o{k}]overlay={p.get("dx", 0)}:{p.get("dy", 0)}:eof_action=pass:format=auto[v{k}]')
        base = f'[v{k}]'
        idx += 1
    fc.append(f'{base}scale=out_color_matrix=bt709:out_range=tv,format=yuv420p[fin]')
    tmp = out.with_suffix('.tmp.mp4')
    ffm.correr(args + ['-filter_complex', ';'.join(fc), '-map', '[fin]', '-frames:v', str(n)] + ffm.ENC + [tmp])
    tmp.replace(out)
    return out


def tarjeta_clip(ctx, png, dur, out, fo):
    if not out.exists():
        ffm.correr(['-loop', '1', '-framerate', str(ctx.FPS), '-i', png, '-vf',
                    f'scale={ctx.W}:{ctx.H}:flags=lanczos,fade=t=in:st=0:d=0.4,fade=t=out:st={dur - fo}:d={fo},format=yuv420p',
                    '-frames:v', str(int(round(dur * ctx.FPS)))] + ffm.ENC + [out])
    return out


# ---------------------------------------------------------------- audio
def audio(ctx, keep, mapa, piezas, wav_programa, intro, outro):
    sr = 48000
    tmp = ctx.tj('render') / 'programa_tratado.wav'
    ffm.extraer_audio(wav_programa, tmp, sr, 2, 'highpass=f=80,acompressor=threshold=-20dB:ratio=3:attack=10:release=200:makeup=2,'
                                               'loudnorm=I=-16:TP=-1.5:LRA=11')
    _, prog = ffm.leer_wav(tmp)
    prog = np.asarray(prog)
    tot = mapa.total
    total = intro + tot / ctx.FPS + outro
    mix = np.zeros((int(total * sr) + sr, 2), np.float32)
    xf = int(0.01 * sr)
    r = np.linspace(0, 1, xf)[:, None].astype(np.float32)
    for i, (a, b) in enumerate(keep):
        n = int(round((mapa.acc[i + 1] - mapa.acc[i]) / ctx.FPS * sr))
        seg = prog[int(a * sr):int(a * sr) + n].copy()
        if len(seg) > 2 * xf:
            seg[:xf] *= r
            seg[-xf:] *= r[::-1]
        s = int(round((intro + mapa.acc[i] / ctx.FPS) * sr))
        mix[s:s + len(seg)] += seg

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
    def cancion(clave):
        # la del proyecto (biblioteca, en Storage) o la de la marca
        ruta = ctx.spec.get(f'musica_{clave}')
        if ruta:
            from pathlib import Path
            return str(ctx.local({'ruta': ruta, 'nombre_local': f'musica_{clave}_{Path(ruta).name}'}))
        return m.musica(clave)
    musica_intro = cancion('intro')
    musica_cierre = cancion('cierre')
    if musica_intro:
        put(fo(carga(musica_intro, f'loudnorm=I={lufs}:TP=-1.5')[:int(intro * sr)], 1.6), 0)
    if musica_cierre:
        put(fo(carga(musica_cierre, f'loudnorm=I={lufs}:TP=-1.5')[:int(outro * sr)], 2.0), intro + tot / ctx.FPS)
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
            put(cache[nombre], intro + fr / ctx.FPS, g_sfx)
    if np.abs(mix).max() > 0.97:
        mix = np.tanh(mix / 0.97) * 0.97
    wav = ctx.tj('render') / 'audio.wav'
    ffm.escribir_wav(wav, sr, mix[:int(total * sr)])
    return wav


def nombre_salida(ctx, version):
    t = re.sub(r'[\\/:*?"<>|]+', '', ctx.spec.get('titulo') or 'video').strip()[:80]
    return f'{t} (v{version}).mp4'


def compositor(ctx):
    if ctx.tipo == 'camaras':
        return CompositorCamaras(ctx)
    from .meet import CompositorMeet
    return CompositorMeet(ctx)


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
    intro, outro = gr['intro_s'], gr['cierre_s']
    mapa = Mapa(keep, ctx.FPS, intro)
    tomas = ctx.estado.get('tomas_render') or ctx.estado['tomas']
    piezas = gr['piezas']
    comp = compositor(ctx)
    carpeta = ctx.tj('render')
    (carpeta / 'trozos').mkdir(parents=True, exist_ok=True)
    extra = getattr(comp, 'bordes', lambda: [])()
    cs = trozos(keep, mapa, tomas, piezas, extra)
    ctx.log(f'{len(cs)} trozos, {mapa.total / ctx.FPS / 60:.1f} min, {config.HILOS} hilos')
    if hasattr(comp, 'preparar'):
        comp.preparar(cs, tomas)          # capas del escenario en serie, antes de los hilos
    salidas = [None] * len(cs)
    hechos = 0

    def uno(i):
        return i, render_trozo(ctx, comp, cs[i], piezas, tomas, carpeta / 'trozos')
    with ThreadPoolExecutor(config.HILOS) as ex:
        for i, ruta in ex.map(uno, range(len(cs))):
            salidas[i] = ruta
            hechos += 1
            if hechos % 10 == 0 or hechos == len(cs):
                ctx.avance(f'Trozo {hechos} de {len(cs)}', .9 * hechos / len(cs))
    ini = tarjeta_clip(ctx, gr['intro'], intro, carpeta / f'intro_{ctx.W}.mp4', 0.4)
    fin = tarjeta_clip(ctx, gr['cierre'], outro, carpeta / f'cierre_{ctx.W}.mp4', 0.8)
    vid = carpeta / 'video.mp4'
    ffm.concatenar([ini] + salidas + [fin], vid)
    ctx.avance('Mezclando audio', .93)
    wav_prog = ctx.tj('programa48.wav') if ctx.tipo == 'camaras' else ctx.tj('a48_A.wav')
    wav = audio(ctx, keep, mapa, piezas, wav_prog, intro, outro)
    version = int(ctx.estado.get('render', {}).get('version', 0)) + 1
    nombre = nombre_salida(ctx, version)
    salida = ctx.salida / nombre
    ffm.correr(['-i', vid, '-i', wav, '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k',
                '-movflags', '+faststart', '-shortest', salida])
    ctx.avance('Subiendo el video', .97)
    remoto = ctx.alm.subir(ctx.pid, salida, nombre, 'video/mp4', clase='salida', version=version)
    anteriores = ctx.estado.get('render', {}).get('versiones', [])
    ctx.guardar('render', {'version': version, 'archivo': nombre, 'remoto': remoto, 'local': str(salida),
                           'duracion': round(intro + mapa.total / ctx.FPS + outro, 2), 'trozos': len(cs),
                           'versiones': anteriores + [{'version': version, 'archivo': nombre, 'remoto': remoto}]})
    ctx.log(f'listo {nombre}')
