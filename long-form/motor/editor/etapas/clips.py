"""Etapa 8 · Clips verticales 9:16 sacados del talk show ya editado.

Portado de clips916.py (taller) y clips.py (César). Dos formatos por clip:
  real  el cuadro 16:9 completo, sin recortar, sobre el color de acento con el logo arriba
  div   pantalla dividida: Meet -> arriba el panel (lamina o pantalla) y abajo quien habla;
        camaras -> las dos camaras una sobre otra, con sus nombres
Subtitulos con las reglas del brand kit (una linea, mayusculas, caja negra al 85 %, texto en curvas).

La IA elige los momentos (30-75 s, autocontenidos, que empiecen con un gancho) y escribe los captions;
sin IA se usan las citas del guion. Nada sale de tramos cortados o marcados como sensibles.
"""
import difflib
import json
import re
import subprocess
import sys
import unicodedata

import numpy as np

from .. import ffm, ia
from ..contexto import Mapa
from .. import tipos

ESQUEMA = {'type': 'object', 'required': ['clips'], 'properties': {'clips': {'type': 'array', 'items': {
    'type': 'object', 'required': ['inicio', 'fin', 'titulo', 'instagram', 'tiktok'], 'properties': {
        'inicio': {'type': 'number'}, 'fin': {'type': 'number'},
        'titulo': {'type': 'string', 'description': 'titulo corto del clip, maximo 60 caracteres'},
        'porque': {'type': 'string', 'description': 'por que funciona como clip (gancho, idea completa)'},
        'instagram': {'type': 'string', 'description': 'caption para Reels: gancho, 1-2 frases, CTA suave y 3 hashtags'},
        'tiktok': {'type': 'string', 'description': 'caption para TikTok con palabras que la gente busca y 3-4 hashtags'},
        'antes_de_publicar': {'type': 'string', 'description': 'cifras o terceros que conviene verificar; vacio si nada'}}}}}}


def slug(t):
    t = unicodedata.normalize('NFKD', t.lower()).encode('ascii', 'ignore').decode()
    return re.sub(r'[^a-z0-9]+', '-', t).strip('-')[:40] or 'clip'


def proponer(ctx, segs, n, prohibidos):
    texto = ia.texto_transcripcion(segs)
    r = ia.pedir_json(
        f'Eres editor de clips verticales para {ctx.marca.cfg["nombre"]}. Elige los {n} mejores momentos de la '
        'transcripción para Reels y TikTok. Cada clip: 30 a 75 s, una idea completa que se entiende sin contexto, '
        'empieza en una frase que engancha y termina en el cierre de la idea. Tiempos en segundos tomados de las '
        'marcas. No uses tramos prohibidos. No inventes cifras ni nombres; si el clip trae cifras o terceros, '
        'dilo en antes_de_publicar.',
        f'Tramos prohibidos (cortados o sensibles): {prohibidos}\n\nTranscripción:\n{texto}', ESQUEMA, 'clips',
        max_tokens=8000)
    return r['clips']


def respaldo(ctx, segs, g, n):
    """Sin IA: un clip alrededor de cada cita del guion, de frase completa a frase completa."""
    out = []
    for c in (g.get('citas') or [])[:n]:
        a = max((s['inicio'] for s in segs if s['inicio'] <= c['t'] - 8), default=0)
        b = min((s['fin'] for s in segs if s['fin'] >= c['t'] + 30), default=segs[-1]['fin'])
        out.append({'inicio': a, 'fin': min(b, a + 75), 'titulo': c['texto'], 'instagram': '', 'tiktok': '',
                    'antes_de_publicar': 'Clip elegido sin IA: revisa que se entienda solo y escribe los captions.'})
    return out


def corrector(ctx):
    """Corrige la marca y el vocabulario mal transcritos (Plogi, Plógui -> Plogy). Los nombres de personas
    solo si Whisper los escribio con mayuscula: «marca» no debe volverse «Marco»."""
    marca = [ctx.marca.cfg['nombre']] + list(ctx.spec.get('vocabulario', []))
    marca = [n for n in marca if n and len(n) >= 4 and ' ' not in n]
    personas = [p['nombre'] for p in ctx.aprobado('reparto')['personas'] if p.get('nombre') and ' ' not in p['nombre'] and len(p['nombre']) >= 4]

    def fix(w):
        base = re.sub(r'[^\wáéíóúñü]', '', w, flags=re.I)
        if len(base) < 4:
            return w
        llano = unicodedata.normalize('NFKD', base.lower()).encode('ascii', 'ignore').decode()
        for n, umbral in [(m, 0.7) for m in marca] + ([(p, 0.86) for p in personas] if base[:1].isupper() else []):
            nl = unicodedata.normalize('NFKD', n.lower()).encode('ascii', 'ignore').decode()
            if llano != nl and difflib.SequenceMatcher(None, llano, nl).ratio() >= umbral:
                return w.replace(base, n)
        return w
    return fix


def palabras(segs, a, b, mapa, fix, o0):
    """Palabras del tramo [a, b) (fuente) en segundos del clip, solo las que caen en lo conservado."""
    out = []
    for s in segs:
        for w in s.get('palabras', []):
            if w['f'] <= a + 0.2 or w['i'] >= b - 0.1:
                continue
            ti, tf = mapa.cuadro(w['i']) / mapa.fps - o0, mapa.cuadro(w['f']) / mapa.fps - o0
            if tf - ti < 0.02:
                continue
            out.append((max(ti, 0), tf, fix(w['p'])))
    return out


def srt(ws, ruta):
    def ts(t):
        ms = int(round(t * 1000))
        return f'{ms // 3600000:02d}:{ms // 60000 % 60:02d}:{ms // 1000 % 60:02d},{ms % 1000:03d}'
    cues, cur = [], []
    for w in ws:
        cur.append(w)
        txt = ' '.join(x[2] for x in cur)
        if len(cur) >= 4 or re.search(r'[.?!,;:]$', w[2]) or len(txt) > 24:
            cues.append(cur)
            cur = []
    if cur:
        cues.append(cur)
    with open(ruta, 'w', encoding='utf8') as f:
        for i, c in enumerate(cues, 1):
            s, e = c[0][0], c[-1][1]
            if i < len(cues):
                e = max(e, min(cues[i][0][0], e + 0.4))
            txt = re.sub(r'[.,;:]+(?=\s|$)', '', ' '.join(x[2] for x in c)).strip()
            f.write(f'{i}\n{ts(s)} --> {ts(max(e, s + 0.3))}\n{txt}\n\n')
    return ruta


def ass(ctx, srt_ruta, salida, formato, tamano, y):
    script = ctx.marca.dir / 'subtitulos' / 'plogy_subtitulos.py'
    if not script.exists():
        from .. import config
        script = config.SUBTITULOS / 'plogy_subtitulos.py'
    r = subprocess.run([sys.executable, str(script), str(srt_ruta), str(salida), '--formato', formato, '--tamano', str(tamano),
                        '--y', str(y)], capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError(f'subtítulos: {r.stderr[-500:]}')
    return salida


def png_nombre(ctx, nombre, rol, ancho=1080):
    from PIL import Image, ImageDraw, ImageFont
    import hashlib
    p = ctx.tj('clips') / f'n_{hashlib.md5(json.dumps([nombre, rol, ancho]).encode()).hexdigest()[:10]}.png'
    if p.exists():
        return p
    H = 300
    g = (np.linspace(0, 1, H) ** 1.6 * 200).astype(np.uint8)
    im = Image.new('RGBA', (ancho, H), (8, 6, 6, 0))
    im.putalpha(Image.fromarray(np.repeat(g[:, None], ancho, 1)))
    d = ImageDraw.Draw(im)
    f1, f2 = ImageFont.truetype(ctx.marca.fuente_ttf, 64), ImageFont.truetype(ctx.marca.fuente_ttf, 32)
    y = H - (150 if rol else 110)
    d.text((48, y), nombre.upper(), font=f1, fill=(255, 255, 255, 255))
    if rol:
        d.text((50, y + 78), rol.upper(), font=f2, fill=ctx.marca.rgb(ctx.marca.c['acento']) + (255,))
    im.save(p)
    return p


def png_logo(ctx, h=64):
    from PIL import Image
    p = ctx.tj('clips') / f'logo{h}.png'
    if not p.exists():
        lg = Image.open(ctx.marca.logo_blanco_png).convert('RGBA')
        lg = lg.crop(lg.getbbox())
        lg.resize((round(lg.width * h / lg.height), h), Image.LANCZOS).save(p)
    return p


ENC = ['-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-maxrate', '10M', '-bufsize', '20M', '-pix_fmt', 'yuv420p']


def render_real(ctx, video, o0, dur, audio, subs, salida):
    FPS = ctx.FPS
    ac = ctx.marca.c['acento'].lstrip('#')
    fc = (f'color=c=0x{ac}:s=1080x1920:r={FPS}:d={dur:.3f}[bg];[0:v]scale=1080:608:flags=lanczos[v];'
          f'[bg][v]overlay=0:656:shortest=1[c1];[c1][1:v]overlay=(W-w)/2:470[c2]')
    fc += f";[c2]ass='{ffm.ruta_filtro(subs)}'[o]" if subs else ';[c2]null[o]'
    ffm.correr(['-ss', f'{o0:.3f}', '-t', f'{dur + 0.2:.3f}', '-i', video, '-loop', '1', '-i', png_logo(ctx), '-i', audio,
                '-filter_complex', fc, '-map', '[o]', '-map', '2:a', '-t', f'{dur:.3f}', '-r', str(FPS)] + ENC +
               ['-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', salida])


def render_div_meet(ctx, video, o0, dur, mapa, intro, tomas, audio, subs, salida):
    """Por tramos de una sola toma: panel arriba (1080x608) y la tarjeta de quien habla abajo."""
    from .meet import Escenario
    from .render import toma_de
    esc = Escenario(ctx, [])
    FPS = ctx.FPS
    n0, n1 = int(round(o0 * FPS)), int(round((o0 + dur) * FPS))
    partes, cur, ini = [], None, n0
    for n in range(n0, n1):
        s = toma_de(tomas, mapa.fuente(n))
        if cur is None:
            cur = s
        elif s is not cur:
            partes.append((ini, n, cur))
            ini, cur = n, s
    partes.append((ini, n1, cur))
    d = ctx.tj('clips') / 'div'
    d.mkdir(parents=True, exist_ok=True)
    trozos = []
    logo = png_logo(ctx)
    for i, (a, b, s) in enumerate(partes):
        tw, th = (1280, 720) if s.get('voz') else s['tile'][2:]
        modo = 'F' if s['f'] == 'F' else 'P'
        x, y, w, h = esc.tarjeta_para(tw, th, modo)
        alto = max(58, int(h * 0.17) if h > 300 else 0)        # la franja del nombre no se recorta
        h -= alto
        if w / h > 1.6:
            nw = int(h * 1.6) & ~1
            x += (w - nw) // 2
            w = nw
        nombre = png_nombre(ctx, s.get('n', ''), '')
        px, py, pw, ph = esc.PANEL
        if modo == 'P':
            BH = min(960, int(round(1080 * h / w / 2) * 2))
            PY = max(200, 200 + (1700 - (608 + 24 + BH)) // 2)
            BY = PY + 632
            k = max(1080 / w, BH / h)
            sw, sh = int(round(w * k / 2) * 2), int(round(h * k / 2) * 2)
            fc = (f'[0:v]setpts=PTS-STARTPTS,fps={FPS},split[a][b];[a]crop={pw}:{ph}:{px}:{py},scale=1080:608:flags=lanczos[p];'
                  f'[b]crop={w}:{h}:{x}:{y},scale={sw}:{sh}:flags=lanczos,crop=1080:{BH}:{(sw - 1080) // 2}:{(sh - BH) // 2}[q];'
                  f'color=c=0x0B0908:s=1080x1920:r={FPS}[bg];[bg][p]overlay=0:{PY}:shortest=1[c1];[c1][q]overlay=0:{BY}[c2];'
                  f'[c2][1:v]overlay=(W-w)/2:110[c3];[c3][2:v]overlay=0:{BY + BH - 300}[o]')
        else:
            fh = min(1500, int(round(1080 * h / w / 2) * 2))
            k = max(1080 / w, fh / h)
            sw, sh = int(round(w * k / 2) * 2), int(round(h * k / 2) * 2)
            kb = max(1080 / w, 1920 / h)
            bw, bh = int(round(w * kb / 2) * 2), int(round(h * kb / 2) * 2)
            yy = (1920 - fh) // 2
            fc = (f'[0:v]setpts=PTS-STARTPTS,fps={FPS},crop={w}:{h}:{x}:{y},split[a][b];'
                  f'[a]scale={bw // 4 * 2}:{bh // 4 * 2},boxblur=20:2,scale={bw}:{bh},crop=1080:1920:{(bw - 1080) // 2}:{(bh - 1920) // 2},'
                  f'eq=brightness=-0.18:saturation=0.8[bg];[b]scale={sw}:{sh}:flags=lanczos,crop=1080:{fh}:{(sw - 1080) // 2}:{(sh - fh) // 2}[v];'
                  f'[bg][v]overlay=0:{yy}[c1];[c1][1:v]overlay=(W-w)/2:110[c2];[c2][2:v]overlay=0:{yy + fh - 300}[o]')
        t = d / f'{salida.stem}_{i:03d}.mp4'
        ffm.correr(['-ss', f'{intro + a / FPS:.4f}', '-i', video, '-loop', '1', '-i', logo, '-loop', '1', '-i', nombre,
                    '-filter_complex', fc, '-map', '[o]', '-frames:v', str(b - a), '-an', '-r', str(FPS)] + ENC + [t])
        trozos.append(t)
    _unir(ctx, trozos, audio, subs, dur, salida)


def render_div_camaras(ctx, mapa, o0, dur, audio, subs, salida):
    """Las dos camaras una sobre otra (1080x960 cada una), desde las fuentes y con lo mismo que se conserva."""
    an = ctx.estado['analisis']
    fuentes = {f['clave']: f for f in tipos.fuentes(ctx)}
    rep = {p['id']: p for p in ctx.aprobado('reparto')['personas']}
    A, B = an['claves'][:2]
    FPS = ctx.FPS
    n0, n1 = int(round(o0 * FPS)), int(round((o0 + dur) * FPS))
    # tramos contiguos de la fuente dentro del clip
    tramos, ini = [], n0
    for n in range(n0 + 1, n1 + 1):
        if n == n1 or abs(mapa.fuente(n) - mapa.fuente(n - 1) - 1 / FPS) > 0.5 / FPS:
            tramos.append((ini, n))
            ini = n
    d = ctx.tj('clips') / 'div'
    d.mkdir(parents=True, exist_ok=True)
    trozos = []
    nombres = [png_nombre(ctx, rep.get(k, {}).get('nombre', ''), rep.get(k, {}).get('rol', '')) for k in (A, B)]
    for i, (a, b) in enumerate(tramos):
        t = mapa.fuente(a)
        args = []
        for k in (A, B):
            args += ['-ss', f'{an["inicio"] + t + an["offsets"][k]:.4f}', '-t', f'{(b - a) / FPS + 0.3:.3f}', '-i', fuentes[k]['archivo']]
        cara_a, cara_b = an['encuadres'][A]['cara'], an['encuadres'][B]['cara']
        def cubrir(idx, cara, f):
            W0, H0 = f['ancho'], f['alto']
            cw = int(min(W0, H0 * 1080 / 960)) & ~1
            cx = int(np.clip(cara[0] - cw / 2, 0, W0 - cw)) & ~1
            return f'[{idx}:v]setpts=PTS-STARTPTS,fps={FPS},crop={cw}:{H0}:{cx}:0,scale=1080:960:flags=lanczos,eq=contrast=1.04:saturation=1.06[v{idx}]'
        fc = (cubrir(0, cara_a, fuentes[A]) + ';' + cubrir(1, cara_b, fuentes[B]) + ';'
              '[v0][v1]vstack[s];[s][2:v]overlay=0:660[c1];[c1][3:v]overlay=0:1620[o]')
        tt = d / f'{salida.stem}_{i:03d}.mp4'
        ffm.correr(args + ['-loop', '1', '-i', nombres[0], '-loop', '1', '-i', nombres[1], '-filter_complex', fc,
                           '-map', '[o]', '-frames:v', str(b - a), '-an', '-r', str(FPS)] + ENC + [tt])
        trozos.append(tt)
    _unir(ctx, trozos, audio, subs, dur, salida)


def _unir(ctx, trozos, audio, subs, dur, salida):
    base = salida.with_suffix('.base.mp4')
    ffm.concatenar(trozos, base)
    vf = f"ass='{ffm.ruta_filtro(subs)}'" if subs else 'null'
    ffm.correr(['-i', base, '-i', audio, '-vf', vf, '-map', '0:v', '-map', '1:a', '-t', f'{dur:.3f}'] + ENC +
               ['-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', salida])
    base.unlink(missing_ok=True)
    for t in trozos:
        t.unlink(missing_ok=True)


def correr(ctx):
    n = int(ctx.opcion('clips', 8))
    if n <= 0:
        return
    r = ctx.estado['render']
    from pathlib import Path
    video = Path(r['local'])
    if not video.exists():
        video = ctx.alm.traer(ctx.pid, r['remoto'], ctx.salida / r['archivo'])
    gr = ctx.estado['graficos']
    keep = [tuple(k) for k in ctx.estado['keep']]
    mapa = Mapa(keep, ctx.FPS, gr['intro_s'])
    segs = ctx.json_trabajo('transcripcion.json')
    g = ctx.aprobado('guion') or {}
    prohibidos = [(c['inicio'], c['fin']) for c in g.get('cortes', []) if c.get('aplicar')]
    prohibidos += [(s['inicio'], s['fin']) for s in g.get('sensibles', [])]
    d = ctx.tj('clips')
    d.mkdir(exist_ok=True)
    ctx.avance('Eligiendo los mejores momentos', .02)
    try:
        props = proponer(ctx, segs, n, [(round(a), round(b)) for a, b in prohibidos])
    except ia.SinIA:
        props = respaldo(ctx, segs, g, n)
        ctx.aviso('Sin clave de Claude: los clips salen de las citas del guion y sin captions.')
    props = [p for p in props if not any(a < p['fin'] and b > p['inicio'] for a, b in prohibidos)]
    fix = corrector(ctx)
    subt = ctx.opcion('subtitulos_clips', True)
    hechos = []
    for i, p in enumerate(props[:n], 1):
        ctx.avance(f'Clip {i} de {min(n, len(props))}', .05 + .9 * (i - 1) / max(min(n, len(props)), 1))
        o0 = mapa.cuadro(p['inicio']) / ctx.FPS
        o1 = mapa.cuadro(p['fin']) / ctx.FPS
        dur = o1 - o0
        if dur < 8:
            continue
        base = f'{i:02d}_{slug(p["titulo"])}'
        audio = d / f'{base}.wav'
        ffm.correr(['-ss', f'{mapa.intro + o0:.3f}', '-t', f'{dur:.3f}', '-i', video, '-vn', '-af',
                    f'loudnorm=I=-14:TP=-1.5:LRA=11,afade=t=in:d=0.06,afade=t=out:st={max(dur - 0.25, 0):.3f}:d=0.25',
                    '-ar', '48000', '-ac', '2', audio])
        ws = palabras(segs, p['inicio'], p['fin'], mapa, fix, o0)
        s_srt = srt(ws, ctx.salida / f'{base}.srt')
        subs_real = ass(ctx, s_srt, d / f'{base}_real.ass', '9:16', 64, 0.80) if subt else None
        archivos = []
        sal = ctx.salida / f'{base}_real.mp4'
        render_real(ctx, video, mapa.intro + o0, dur, audio, subs_real, sal)
        archivos.append(sal)
        # La version dividida (dos personas, una arriba y otra abajo) solo existe donde hay dos encuadres.
        if tipos.de(ctx).clip_dividido():
            subs_div = ass(ctx, s_srt, d / f'{base}_div.ass', '9:16', 64, 0.5 if ctx.tipo == 'camaras' else 0.47) if subt else None
            sal = ctx.salida / f'{base}_div.mp4'
            tomas = ctx.estado.get('tomas_render') or ctx.estado['tomas']
            if ctx.tipo == 'meet':
                render_div_meet(ctx, video, o0, dur, mapa, mapa.intro, tomas, audio, subs_div, sal)
            else:
                render_div_camaras(ctx, mapa, o0, dur, audio, subs_div, sal)
            archivos.append(sal)
        md = (f'# {i:02d} · {p["titulo"]}\n\n- Tramo del video: {int(o0 // 60)}:{int(o0 % 60):02d} ({dur:.0f} s)\n'
              f'- Archivos: {", ".join(a.name for a in archivos)}\n\n## Instagram Reels\n\n```\n{p.get("instagram", "")}\n```\n\n'
              f'## TikTok\n\n```\n{p.get("tiktok", "")}\n```\n')
        if p.get('antes_de_publicar'):
            md += f'\n## Antes de publicar\n\n{p["antes_de_publicar"]}\n'
        (ctx.salida / f'{base}.md').write_text(md, encoding='utf8')
        remotos = [ctx.alm.subir(ctx.pid, a, a.name, 'video/mp4') for a in archivos]
        ctx.alm.subir(ctx.pid, ctx.salida / f'{base}.md', f'{base}.md', 'text/markdown')
        ctx.alm.subir(ctx.pid, s_srt, s_srt.name)
        hechos.append({**p, 'n': i, 'duracion': round(dur, 1), 'archivos': [a.name for a in archivos], 'remotos': remotos,
                       'md': f'{base}.md', 'srt': s_srt.name})
        ctx.log(f'clip {i}: {p["titulo"]} ({dur:.0f} s)')
    ctx.guardar('clips', hechos)
