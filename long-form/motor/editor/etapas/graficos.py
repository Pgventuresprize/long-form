"""Etapa 5 · Gráficos: del guion aprobado a piezas con alfa listas para superponer.

Portado de build.py, noticiero.py, ilustraciones.py (César) y assets.py (taller). Cada pieza es una pagina
HTML con la fuente y los colores de la marca; Chromium la abre DESDE ARCHIVO (una pagina en memoria no puede
leer la fuente local), se comprueba que la fuente cargo, se congelan las animaciones CSS y se avanzan cuadro a
cuadro. La salida es la entrada al reves y acelerada; en medio se sostiene el ultimo cuadro el tiempo exacto.
QuickTime Animation (qtrle) con alfa: pesa poco porque casi todo el tiempo la imagen esta quieta.

Aqui tambien se fija lo que se conserva (silencios + cortes aprobados) y cada pieza recibe su cuadro de
entrada y salida en el video final. Las piezas que ocupan la franja inferior solas (rotulo, barra) parten la
pregunta en dos: se oculta mientras pasa la barra y vuelve despues, como en una transmision.
"""
import hashlib
import json
import shutil
import subprocess

from .. import config, ffm, plantillas, silencios
from .. import guion as G
from ..contexto import Mapa

T_IN, T_OUT = 1.0, 0.6
W, HH = 1920, 1080           # las piezas se dibujan a 1920x1080 y se escalan a la salida
INTRO, OUTRO = 5.4, 6.0

SFX = {'pregunta': ('pregunta-entra', 'pregunta-sale'), 'cita': ('cita-entra', None), 'rotulo': ('rotulo-entra', None),
       'barra': ('barra-entra', 'barra-sale'), 'popup': ('popup-entra', None), 'foto': ('popup-entra', None),
       'video': ('rotulo-entra', None), 'recorrido': ('popup-entra', None), 'etiquetas': ('etiquetas-entra', None)}
CAPA = {'video': 0.5, 'recorrido': 0.5, 'pregunta': 1, 'cita': 2, 'foto': 2.5, 'etiquetas': 3, 'rotulo': 3, 'barra': 4, 'popup': 5}


# ---------------------------------------------------------------- estilos
# El HTML y el CSS de cada pieza viven en long-form/plantillas, compartidos con la vista previa de Studio
# (editor/plantillas.py los llena con la marca).


# ---------------------------------------------------------------- captura
class Pintor:
    """Un Chromium para todas las piezas; cuadros por firma de contenido (sin la duracion)."""

    def __init__(self, ctx, disposicion):
        self.ctx = ctx
        self.disp = disposicion
        self.dir = ctx.tj('piezas')
        self.dir.mkdir(exist_ok=True)
        self.pw = self.br = self.page = None

    def __enter__(self):
        from playwright.sync_api import sync_playwright
        self.pw = sync_playwright().start()
        self.br = self.pw.chromium.launch(args=['--font-render-hinting=none'])
        self.page = self.br.new_page(viewport={'width': W, 'height': HH}, device_scale_factor=1)
        return self

    def __exit__(self, *a):
        if self.br:
            self.br.close()
        if self.pw:
            self.pw.stop()

    def cuadros(self, p, t_in=T_IN):
        html = plantillas.pagina(self.ctx.marca, p['tipo'], p, self.disp)
        firma = hashlib.md5(json.dumps([html, t_in], ensure_ascii=False).encode()).hexdigest()[:14]
        fd = self.dir / f'_f_{firma}'
        n = int(round(t_in * self.ctx.FPS)) + 1
        hechos = sorted(fd.glob('in_*.png')) if fd.exists() else []
        if len(hechos) == n:
            return hechos, firma
        shutil.rmtree(fd, ignore_errors=True)
        fd.mkdir(parents=True)
        hp = fd / 'pieza.html'
        hp.write_text(html, encoding='utf8')
        pg = self.page
        pg.goto(hp.resolve().as_uri())
        pg.evaluate('document.fonts.ready')
        fam = self.ctx.marca.familia
        if not pg.evaluate(f"document.fonts.check(\"700 40px '{fam}'\")"):
            raise RuntimeError(f'No cargó la fuente {fam} de la marca: revisa el preset')
        pg.wait_for_function('Array.from(document.images).every(i => i.complete)')
        pg.evaluate('document.getAnimations().forEach(a => a.pause())')
        out = []
        for f in range(n):
            pg.evaluate(f'document.getAnimations().forEach(a => a.currentTime = {f / self.ctx.FPS * 1000})')
            q = fd / f'in_{f:03d}.png'
            pg.screenshot(path=str(q), omit_background=True)
            out.append(q)
        return out, firma

    def mov(self, p, dur, t_in=T_IN, t_out=T_OUT):
        fps = self.ctx.FPS
        fr, firma = self.cuadros(p, t_in)
        nombre = f'{p["tipo"]}-{firma}-{int(round(dur * fps))}.mov'
        dest = self.dir / nombre
        if dest.exists():
            return dest
        dur = max(dur, t_in + t_out + 0.2)
        n_out = max(int(t_out * fps), 2)
        sal = [fr[round(i * (len(fr) - 1) / (n_out - 1))] for i in range(n_out)][::-1]
        hold = dur - t_in - t_out
        lst = self.dir / f'_{firma}.txt'
        with open(lst, 'w', encoding='utf8') as f:
            for q in fr[:-1]:
                f.write(f"file '{q.resolve().as_posix()}'\nduration {1 / fps:.6f}\n")
            f.write(f"file '{fr[-1].resolve().as_posix()}'\nduration {hold:.6f}\n")
            for q in sal:
                f.write(f"file '{q.resolve().as_posix()}'\nduration {1 / fps:.6f}\n")
            f.write(f"file '{sal[-1].resolve().as_posix()}'\n")
        tmp = dest.with_suffix('.tmp.mov')
        ffm.correr(['-f', 'concat', '-safe', '0', '-i', lst, '-vf', f'fps={fps}', '-t', f'{dur:.3f}',
                    '-c:v', 'qtrle', '-pix_fmt', 'argb', tmp])
        tmp.replace(dest)
        lst.unlink(missing_ok=True)
        return dest

    def pagina(self, tipo, datos, png):
        hp = self.dir / (png.stem + '.html')
        hp.write_text(plantillas.pagina(self.ctx.marca, tipo, datos), encoding='utf8')
        self.page.goto(hp.resolve().as_uri())
        self.page.evaluate('document.fonts.ready')
        self.page.wait_for_timeout(200)
        self.page.screenshot(path=str(png))
        return png


def tarjetas(ctx, pintor, g):
    t = g.get('titulo') or ctx.spec.get('titulo', '')
    d = ctx.tj('piezas')
    pi = pintor.pagina('tarjeta-intro', {'titulo': t, 'subtitulo': g.get('subtitulo_intro', ''), 'pie': g.get('pie_intro')},
                       d / 'tarjeta-intro.png')
    pc = pintor.pagina('tarjeta-cierre', {}, d / 'tarjeta-cierre.png')
    return pi, pc

# ---------------------------------------------------------------- ilustraciones
def _foto_src(ctx, ruta):
    """Copia a PNG (jfif, heic...) para que el navegador la lea."""
    src = ctx.local({'ruta': ruta})
    png = ctx.tj('piezas') / f'ilus-{hashlib.md5(str(src).encode()).hexdigest()[:10]}.png'
    if not png.exists():
        ffm.correr(['-i', src, '-frames:v', '1', png])
    return png


def video_ilustrativo(ctx, il, dur):
    src = ctx.local({'ruta': il['ruta']})
    desde = float(il.get('desde', 0))
    vel = float(il.get('velocidad', 1.0))
    # color: si el clip es oscuro se sube gamma; cada ilustracion puede traer su propio filtro
    filtro = il.get('filtro')
    if not filtro:
        r = subprocess.run([config.FFMPEG, '-v', 'error', '-ss', f'{desde + 1:.2f}', '-i', str(src), '-frames:v', '5',
                            '-vf', 'scale=64:-2,format=gray', '-f', 'rawvideo', '-'], capture_output=True)
        media = sum(r.stdout) / max(len(r.stdout), 1)
        filtro = 'eq=gamma=1.35:brightness=0.03:saturation=1.12' if media < 80 else 'eq=contrast=1.04:saturation=1.08'
    firma = hashlib.md5(json.dumps([str(src), desde, vel, filtro, dur, ctx.marca.c['acento']]).encode()).hexdigest()[:12]
    dest = ctx.tj('piezas') / f'video-{firma}.mov'
    if dest.exists():
        return dest
    acento = ctx.marca.c['acento'].lstrip('#')
    fc = (f'color=c=0x{acento}:s={W}x{HH}:r={ctx.FPS}:d={dur:.3f}[bg];'
          f'[0:v]{filtro},setpts=(PTS-STARTPTS)/{vel},fps={ctx.FPS},scale=-2:{int(HH * 0.9)}:flags=lanczos,setsar=1[v];'
          f'[bg][v]overlay=(W-w)/2:(H-h)/2:shortest=1,format=rgba,'
          f'fade=t=in:st=0:d=0.2:alpha=1,fade=t=out:st={dur - 0.2:.3f}:d=0.2:alpha=1,format=yuva444p10le[o]')
    ffm.correr(['-ss', f'{desde:.3f}', '-t', f'{dur * vel + 0.5:.3f}', '-i', src, '-filter_complex', fc, '-map', '[o]', '-an',
                '-t', f'{dur:.3f}', '-c:v', 'prores_ks', '-profile:v', '4444', '-pix_fmt', 'yuva444p10le', dest])
    return dest


def recorrido(ctx, il, dur):
    """Imagen alta a pantalla completa sobre el acento: arriba 1 s, baja despacio, abajo 1 s."""
    src = _foto_src(ctx, il['ruta'])
    firma = hashlib.md5(json.dumps([str(src), dur, ctx.marca.c['acento']]).encode()).hexdigest()[:12]
    dest = ctx.tj('piezas') / f'recorrido-{firma}.mov'
    if dest.exists():
        return dest
    acento = ctx.marca.c['acento'].lstrip('#')
    ancho, marg = 1100, 50
    y = f"'{marg}-(h-{HH - 2 * marg})*min(max((t-1)/{dur - 2},0),1)'"
    fc = (f'color=c=0x{acento}:s={W}x{HH}:r={ctx.FPS}:d={dur}[bg];'
          f'[0:v]scale={ancho}:-2:flags=lanczos,pad=iw+24:ih+24:12:12:white,format=rgba[img];'
          f'[bg][img]overlay=x=(W-w)/2:y={y}:shortest=1,format=rgba,'
          f'fade=t=in:st=0:d=0.2:alpha=1,fade=t=out:st={dur - 0.2}:d=0.2:alpha=1,format=yuva444p10le[o]')
    ffm.correr(['-loop', '1', '-framerate', str(ctx.FPS), '-t', str(dur), '-i', src, '-filter_complex', fc, '-map', '[o]',
                '-t', str(dur), '-c:v', 'prores_ks', '-profile:v', '4444', '-pix_fmt', 'yuva444p10le', dest])
    return dest


# ---------------------------------------------------------------- plan de piezas en tiempo de salida
def _restar(intervalo, huecos, margen=0.3):
    """Parte [a,b) quitando los huecos (con margen): la pregunta se oculta mientras pasa una barra."""
    partes = [intervalo]
    for x, y in huecos:
        nuevo = []
        for a, b in partes:
            if y + margen <= a or x - margen >= b:
                nuevo.append((a, b))
            else:
                if x - margen - a >= 2.5:
                    nuevo.append((a, x - margen))
                if b - (y + margen) >= 2.5:
                    nuevo.append((y + margen, b))
        partes = nuevo
    return partes


def armar(ctx, g, mapa, personas):
    """Lista de piezas con su cuadro de entrada y salida en el video final (sin contar la intro)."""
    m = ctx.marca
    fps = mapa.fps
    total = mapa.total / fps

    def o(t):
        return mapa.cuadro(t) / fps
    por_nombre = {p['nombre']: p for p in personas}
    items = []
    # exclusivas primero: fijan la franja (las etiquetas del plano doble abren el programa)
    excl = []
    if ctx.tipo == 'camaras' and len(personas) >= 2 and ctx.opcion('etiquetas_plano_doble', True):
        ids = ctx.estado['analisis']['claves']
        nombres = {p['id']: p['nombre'] for p in ctx.aprobado('reparto')['personas']}
        items.append({'tipo': 'etiquetas', 'a': 0.3, 'dur': 5.0, 'izquierda': nombres.get(ids[0], ''), 'derecha': nombres.get(ids[1], '')})
        excl.append((0.3, 5.3))
    for f in sorted(g.get('fijas', []), key=lambda f: f['salida']):
        if f.get('omitir'):
            continue
        a = float(f['salida'])
        dur = {'rotulo': 5.0, 'barra': 12.0, 'popup': 5.0}[f['tipo']]
        if f['tipo'] in G.EXCLUSIVAS:
            while any(not (a + dur <= x or a >= y) for x, y in excl):
                a = max(y for x, y in excl if not (a + dur <= x or a >= y)) + 0.6
            excl.append((a, a + dur))
        if a + dur > total - 0.5:
            ctx.aviso(f'Una pieza {f["tipo"]} no cabe al final del video y se omitió.')
            continue
        it = {'tipo': f['tipo'], 'a': a, 'dur': dur}
        if f['tipo'] == 'rotulo':
            p = por_nombre.get(f['persona'], {'nombre': f['persona']})
            it.update(nombre=p['nombre'], rol=p.get('rol', ''), handle=p.get('handle', ''), red=p.get('red', 'Instagram'))
        if f['tipo'] == 'barra':
            it['cta'] = f['cta']
        items.append(it)
    # preguntas: persisten todo el tema, partidas por las exclusivas
    nq = 0
    for q in g.get('preguntas', []):
        if q.get('omitir'):
            continue
        nq += 1
        a, b = o(q['inicio']), o(q['fin'])
        partes = _restar((a, b), excl)
        for j, (x, y) in enumerate(partes):
            items.append({'tipo': 'pregunta', 'a': x, 'dur': y - x, 'encabezado': q['encabezado'], 'texto': q['texto'],
                          'num': f'{nq:02d}', 'entra_sfx': j == 0, 'sale_sfx': j == len(partes) - 1})
    # citas: si chocan con una exclusiva se corren hasta despues; si ya no tienen sentido ahi, se omiten
    for c in g.get('citas', []):
        if c.get('omitir'):
            continue
        a = o(c['t'])
        dur = G.dur_cita(c['texto'], m)
        a0 = a
        for x, y in sorted(excl):
            if not (a + dur <= x - .3 or a >= y + .3):
                a = y + 0.5
        if a - a0 > 25:
            ctx.aviso(f'La cita «{c["texto"][:40]}…» quedaba muy lejos de cuando se dijo por una barra o rótulo: se omitió.')
            continue
        items.append({'tipo': 'cita', 'a': a, 'dur': dur, 'texto': c['texto'], 'quien': c['quien'], 'rol': c.get('rol', '')})
    # ilustraciones
    for il in g.get('ilustraciones', []):
        if il.get('t') is None or il.get('omitir'):
            continue
        modo = il.get('modo', 'foto')
        dur = float(il.get('dur') or {'foto': 6.0, 'video': 6.0, 'recorrido': 16.0}[modo])
        items.append({'tipo': modo, 'a': o(il['t']), 'dur': dur, 'il': il})
    # pop-ups: no encima de una foto ilustrativa
    fotos = [(i['a'], i['a'] + i['dur']) for i in items if i['tipo'] in ('foto', 'video', 'recorrido')]
    items = [i for i in items if not (i['tipo'] == 'popup' and any(not (i['a'] + i['dur'] <= x or i['a'] >= y) for x, y in fotos))]
    items = [i for i in items if i['a'] < total - 1]
    for i in items:
        i['dur'] = min(i['dur'], total - i['a'])
    return sorted(items, key=lambda i: (i['a'], CAPA[i['tipo']]))


def planos_para_fotos(ctx, items, mapa):
    """Una foto ilustrativa va a la derecha del invitado: mientras dura, el plano es abierto y de quien
    habla solo (nunca la pantalla dividida, donde taparia a la otra persona)."""
    import numpy as np
    tomas = [dict(t) for t in ctx.estado['tomas']]
    an = ctx.estado['analisis']
    lab = np.load(ctx.tj('etiquetas.npy'))
    for it in items:
        if it['tipo'] != 'foto':
            continue
        o0 = int(round(it['a'] * ctx.FPS))
        a = mapa.fuente(o0)
        b = mapa.fuente(o0 + int(round(it['dur'] * ctx.FPS)))
        g = lab[int((a + an['inicio']) / an['paso']):int((b + an['inicio']) / an['paso']) + 1]
        g = g[g >= 0]
        k = an['claves'][int(np.bincount(g).argmax())] if len(g) else an['claves'][0]
        nuevas = []
        for t in tomas:
            if t['b'] <= a - 0.4 or t['a'] >= b + 0.4:
                nuevas.append(t)
                continue
            if t['a'] < a - 0.4:
                nuevas.append({**t, 'b': a - 0.4})
            if t['b'] > b + 0.4:
                nuevas.append({**t, 'a': b + 0.4})
        nuevas.append({'a': a - 0.4, 'b': b + 0.4, 'plano': k + 'W'})
        tomas = sorted(nuevas, key=lambda t: t['a'])
    # fundir vecinas iguales
    out = []
    for t in tomas:
        if out and out[-1]['plano'] == t['plano'] and abs(out[-1]['b'] - t['a']) < 1e-6:
            out[-1]['b'] = t['b']
        else:
            out.append(t)
    return out


def _pintar_todo(ctx, disp, g, items):
    """Las tarjetas y cada pieza, repartidas en varios Chromium a la vez (uno por hilo: Playwright no se
    comparte entre hilos). Cada pieza tiene su cache por firma, asi que repetir no cuesta."""
    from concurrent.futures import ThreadPoolExecutor
    n_hilos = max(1, min(int(config.HILOS) // 2 or 1, 6, len(items) or 1))
    grupos = [list(range(len(items)))[i::n_hilos] for i in range(n_hilos)]
    rutas = {}
    hechos = [0]

    def uno(pin, it):
        t = it['tipo']
        if t == 'foto':
            it['src'] = _foto_src(ctx, it['il']['ruta']).resolve().as_uri()
            it['caja'] = caja_foto(ctx)
            return pin.mov(it, it['dur'], t_in=0.35, t_out=0.25)
        if t == 'video':
            return video_ilustrativo(ctx, it['il'], it['dur'])
        if t == 'recorrido':
            return recorrido(ctx, it['il'], it['dur'])
        return pin.mov(it, it['dur'])

    def grupo(k):
        with Pintor(ctx, disp) as pin:
            if k == 0:
                ctx.avance('Tarjetas de intro y cierre', .02)
                rutas['intro'], rutas['cierre'] = tarjetas(ctx, pin, g)
            for n in grupos[k]:
                rutas[n] = uno(pin, items[n])
                hechos[0] += 1
                ctx.avance(f'Pieza {hechos[0]} de {len(items)}', .05 + .9 * hechos[0] / max(len(items), 1))

    with ThreadPoolExecutor(n_hilos) as ex:
        list(ex.map(grupo, range(n_hilos)))
    return rutas


def caja_foto(ctx):
    if ctx.tipo == 'meet':
        return (60, 60, 1362, 740)          # dentro del panel de contenido
    return (1920 - 120 - 600, 120, 600, 640)  # a la derecha del invitado (César)


def correr(ctx):
    g = ctx.aprobado('guion')
    if not g:
        raise RuntimeError('Falta el guion aprobado')
    from .plan import personas_aprobadas
    _, personas = personas_aprobadas(ctx)
    tomas = ctx.estado['tomas']
    fin = tomas[-1]['b']
    cortes = ctx.json_trabajo('silencios.json')
    edit = [(c['inicio'], c['fin']) for c in g.get('cortes', []) if c.get('aplicar')]
    for c in g.get('cortes', []):
        if c.get('aplicar'):
            ctx.log(f'corte editorial {c["inicio"]:.1f}–{c["fin"]:.1f} s: {c.get("motivo", "")}')
    keep = silencios.conservar(fin, [tuple(c) for c in cortes] + edit, ctx.FPS)
    mapa = Mapa(keep, ctx.FPS, INTRO)
    ctx.guardar('keep', keep)
    ctx.log(f'queda {mapa.total / ctx.FPS / 60:.1f} min de programa ({len(edit)} cortes editoriales)')
    if ctx.tipo == 'meet' and any(t.get('pill') for t in tomas):
        from .. import limpieza
        pistas = limpieza.correr(ctx, tomas)
        # un tramo que la calibracion rechazo no tenia pildora: no se le borra nada
        ok = [(p['a'], p['b']) for p in pistas]
        tomas = [dict(t, pill=bool(t.get('pill') and any(a <= t['a'] < b for a, b in ok))) for t in tomas]
        ctx.guardar('tomas_render', tomas)
    items = armar(ctx, g, mapa, personas)
    disp = 'escenario' if ctx.tipo == 'meet' else 'pantalla'
    piezas = []
    rutas = _pintar_todo(ctx, disp, g, items)
    pi, pc = rutas.pop('intro'), rutas.pop('cierre')
    for n, it in enumerate(items):
        t = it['tipo']
        sfx_in, sfx_out = SFX[t]
        if t == 'pregunta':
            sfx_in = sfx_in if it['entra_sfx'] else None
            sfx_out = sfx_out if it['sale_sfx'] else None
        o0 = int(round(it['a'] * ctx.FPS))
        piezas.append({'tipo': t, 'pieza': str(rutas[n]), 'o0': o0, 'o1': o0 + int(round(it['dur'] * ctx.FPS)),
                       'capa': CAPA[t], 'sfx': sfx_in, 'sfx_fin': sfx_out,
                       'proteger': t in ('video', 'recorrido'),
                       'texto': it.get('texto') or it.get('nombre') or it.get('cta') or ''})
    if ctx.tipo == 'camaras':
        ctx.guardar('tomas_render', planos_para_fotos(ctx, items, mapa))
    ctx.guardar('graficos', {'piezas': piezas, 'intro': str(pi), 'cierre': str(pc), 'disposicion': disp,
                             'intro_s': INTRO, 'cierre_s': OUTRO})
    from collections import Counter
    ctx.log('piezas: ' + ', '.join(f'{k} {v}' for k, v in Counter(p['tipo'] for p in piezas).items()))
