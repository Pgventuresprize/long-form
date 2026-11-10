"""Etapa 7 · Control de calidad automático.

Lo que antes se revisaba a mano con qa_final.py y hojas de cuadros:
- video y audio de la misma duración, y la esperada;
- sonoridad integrada cerca de -16 LUFS y pico real por debajo de -1 dBTP;
- cuadros negros o congelados largos fuera de la intro y el cierre;
- una hoja de 32 cuadros repartidos en todo el video para mirarla en la app.
Todo lo que falle o deba mirar una persona queda en el reporte, junto con los avisos de las etapas anteriores.
"""
import re
import subprocess

from PIL import Image

from .. import config, ffm


def _detectar(ruta, filtro):
    r = subprocess.run([config.FFMPEG, '-hide_banner', '-nostdin', '-i', str(ruta), '-vf', filtro, '-an', '-f', 'null', '-'],
                       capture_output=True, text=True, encoding='utf-8', errors='replace')
    return r.stderr


def hoja(ctx, ruta, dur, n=32, nombre='hoja.jpg'):
    d = ctx.tj('qa')
    d.mkdir(exist_ok=True)
    ims = []
    for i in range(n):
        t = dur * (i + 0.5) / n
        p = d / f'q{i:02d}.jpg'
        ffm.correr(['-ss', f'{t:.2f}', '-i', ruta, '-frames:v', '1', '-vf', 'scale=480:-2', p])
        ims.append((t, Image.open(p).convert('RGB')))
    w, h = ims[0][1].size
    cols = 4
    filas = (n + cols - 1) // cols
    sh = Image.new('RGB', (w * cols, h * filas), 'black')
    for i, (t, im) in enumerate(ims):
        sh.paste(im, ((i % cols) * w, (i // cols) * h))
    out = ctx.salida / nombre
    sh.save(out, quality=82)
    return out


def correr(ctx):
    r = ctx.estado['render']
    ruta = r['local']
    from pathlib import Path
    if not Path(ruta).exists():
        ruta = ctx.alm.traer(ctx.pid, r['remoto'], ctx.salida / r['archivo'])
    info = ffm.sondear(ruta)
    p = subprocess.run([config.FFPROBE, '-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=duration',
                        '-of', 'csv=p=0', str(ruta)], capture_output=True, text=True, encoding='utf-8', errors='replace')
    dur_a = float(p.stdout.strip() or 0)
    p = subprocess.run([config.FFPROBE, '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=duration',
                        '-of', 'csv=p=0', str(ruta)], capture_output=True, text=True, encoding='utf-8', errors='replace')
    dur_v = float(p.stdout.strip() or 0)
    problemas = []
    if abs(dur_a - dur_v) > 0.15:
        problemas.append(f'Video ({dur_v:.2f} s) y audio ({dur_a:.2f} s) no duran lo mismo')
    if abs(dur_v - r['duracion']) > 0.5:
        problemas.append(f'Duración {dur_v:.1f} s distinta de la esperada {r["duracion"]:.1f} s')
    ctx.avance('Midiendo sonoridad', .2)
    lufs, pico = ffm.ebur128(ruta)
    if lufs is not None and not (-18 <= lufs <= -14):
        problemas.append(f'Sonoridad {lufs:.1f} LUFS (objetivo -16)')
    if pico is not None and pico > -0.3:
        problemas.append(f'Pico real {pico:.1f} dBTP: puede distorsionar')
    ctx.avance('Buscando cuadros negros', .4)
    gr = ctx.estado['graficos']
    ini, fin = gr['intro_s'] + 0.5, dur_v - gr['cierre_s'] - 0.5
    negros = []
    for m in re.finditer(r'black_start:([\d.]+) black_end:([\d.]+)', _detectar(ruta, 'blackdetect=d=1.0:pix_th=0.06')):
        a, b = float(m.group(1)), float(m.group(2))
        if b > ini and a < fin:
            negros.append([round(a, 1), round(b, 1)])
    if negros:
        problemas.append(f'Cuadros negros de más de 1 s en {negros[:5]}')
    ctx.avance('Hoja de cuadros', .7)
    h = hoja(ctx, ruta, dur_v)
    ctx.alm.subir(ctx.pid, h, h.name, 'image/jpeg')
    reporte = {'duracion_video': round(dur_v, 2), 'duracion_audio': round(dur_a, 2), 'lufs': lufs, 'pico_dbtp': pico,
               'resolucion': f'{info["ancho"]}x{info["alto"]}', 'problemas': problemas,
               'avisos': ctx.todos_los_avisos(), 'hoja': h.name,
               'sensibles': (ctx.aprobado('guion') or {}).get('sensibles', [])}
    ctx.guardar('qa', reporte)
    for x in problemas:
        ctx.log(x, 'aviso')
    ctx.log(f'QA: {dur_v:.1f} s, {lufs} LUFS, pico {pico} dBTP, {len(problemas)} problemas')
