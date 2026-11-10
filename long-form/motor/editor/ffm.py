"""Ayudas de ffmpeg: medir, correr y codificar con los mismos parametros en todos los trozos."""
import json
import os
import subprocess
from pathlib import Path

import numpy as np
from scipy.io import wavfile

from . import config

FPS = 30
# misma base de tiempo en todos los trozos: asi se unen con concat sin recodificar
ENC = ['-c:v', 'libx264', '-preset', config.PRESET_X264, '-crf', '19', '-pix_fmt', 'yuv420p', '-r', str(FPS),
       '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-color_range', 'tv',
       '-video_track_timescale', '15360', '-an']


class ErrorFfmpeg(RuntimeError):
    pass


def correr(args, **kw):
    """ffmpeg con salida de error legible; nunca se queda pidiendo confirmacion."""
    cmd = [config.FFMPEG, '-hide_banner', '-nostdin', '-y', '-loglevel', 'error'] + [str(a) for a in args]
    r = subprocess.run(cmd, capture_output=True, text=True, encoding='utf-8', errors='replace', **kw)
    if r.returncode != 0:
        raise ErrorFfmpeg(f'ffmpeg fallo ({r.returncode}): {r.stderr[-2000:]}\n{" ".join(cmd)[:1500]}')
    return r


def sondear(ruta):
    r = subprocess.run([config.FFPROBE, '-v', 'error', '-show_entries',
                        'format=duration:format_tags=creation_time:stream=index,codec_type,codec_name,width,height,avg_frame_rate,r_frame_rate,sample_rate,channels,pix_fmt:stream_side_data=rotation',
                        '-of', 'json', str(ruta)], capture_output=True, text=True, encoding='utf-8', errors='replace')
    if r.returncode != 0:
        raise ErrorFfmpeg(f'ffprobe no pudo leer {ruta}: {r.stderr[-500:]}')
    j = json.loads(r.stdout)
    v = next((s for s in j.get('streams', []) if s.get('codec_type') == 'video'), None)
    a = next((s for s in j.get('streams', []) if s.get('codec_type') == 'audio'), None)

    def fr(x):
        try:
            n, d = x.split('/')
            return float(n) / float(d) if float(d) else 0.0
        except Exception:
            return 0.0
    rot = 0
    if v:
        for sd in v.get('side_data_list', []) or []:
            if 'rotation' in sd:
                rot = int(sd['rotation'])
    ancho, alto = (int(v['width']), int(v['height'])) if v else (0, 0)
    if abs(rot) % 180 == 90:          # ffmpeg endereza al decodificar: el cuadro util va girado
        ancho, alto = alto, ancho
    return {
        'duracion': float(j.get('format', {}).get('duration', 0) or 0),
        'video': bool(v), 'audio': bool(a),
        'ancho': ancho, 'alto': alto,
        'fps': fr(v.get('avg_frame_rate', '0/1')) if v else 0.0,
        'fps_nominal': fr(v.get('r_frame_rate', '0/1')) if v else 0.0,
        'codec': v.get('codec_name') if v else None,
        'pix_fmt': v.get('pix_fmt') if v else None,
        'rotacion': rot,
        'creado': (j.get('format', {}).get('tags') or {}).get('creation_time'),
    }


def cuadro(ruta, t, ancho, gris=False):
    """Un cuadro en el segundo t, reducido a `ancho`, como arreglo (BGR o gris). None si no se pudo leer."""
    fmt, canales = ('gray', 1) if gris else ('bgr24', 3)
    p = subprocess.run([config.FFMPEG, '-v', 'error', '-ss', f'{max(t, 0):.3f}', '-i', str(ruta), '-frames:v', '1',
                        '-vf', f'scale={ancho}:-2', '-f', 'rawvideo', '-pix_fmt', fmt, '-'], capture_output=True)
    alto = len(p.stdout) // (ancho * canales)
    if alto < 2:
        return None
    im = np.frombuffer(p.stdout[:ancho * canales * alto], np.uint8)
    return im.reshape(alto, ancho) if gris else im.reshape(alto, ancho, canales)


def cuadros(ruta, carpeta, paso, ancho, duracion):
    """Un cuadro cada `paso` s a JPG en `carpeta`, con su tiempo real. Decodifica solo los cuadros clave del
    video (una hora en 4K se lee en minutos, no en lo que dura); si el video tiene muy pocos, decodifica todo.
    Devuelve [(t, ruta_jpg)] y lo deja en carpeta/tiempos.json para no repetirlo."""
    import re
    carpeta = Path(carpeta)
    hecho = carpeta / 'tiempos.json'
    if hecho.exists():
        return [(t, carpeta / n) for t, n in json.loads(hecho.read_text(encoding='utf8'))]
    carpeta.mkdir(parents=True, exist_ok=True)
    for f in carpeta.glob('*.jpg'):
        f.unlink()

    def sacar(solo_clave):
        sel = f"select='isnan(prev_selected_t)+gte(t-prev_selected_t\\,{paso})',scale={ancho}:-2,showinfo"
        cmd = [config.FFMPEG, '-hide_banner', '-nostdin', '-y', '-loglevel', 'info']
        if solo_clave:
            cmd += ['-skip_frame', 'nokey']
        cmd += ['-i', str(ruta), '-vf', sel, '-fps_mode', 'vfr', '-q:v', '4', str(carpeta / '%05d.jpg')]
        r = subprocess.run(cmd, capture_output=True, text=True, encoding='utf-8', errors='replace')
        if r.returncode != 0:
            raise ErrorFfmpeg(f'ffmpeg no pudo sacar cuadros de {ruta}: {r.stderr[-800:]}')
        return [float(m) for m in re.findall(r'pts_time:\s*([\d.]+)', r.stderr)]
    ts = sacar(True)
    # si los cuadros clave quedan muy separados (x264 pone uno cada ~8 s), se decodifica todo
    huecos = np.diff(ts) if len(ts) > 2 else np.array([duracion])
    if len(ts) < duracion / (paso * 4) or float(np.median(huecos)) > paso * 2:
        for f in carpeta.glob('*.jpg'):
            f.unlink()
        ts = sacar(False)
    out = [(round(t, 3), f'{i + 1:05d}.jpg') for i, t in enumerate(ts) if (carpeta / f'{i + 1:05d}.jpg').exists()]
    hecho.write_text(json.dumps(out), encoding='utf8')
    return [(t, carpeta / n) for t, n in out]


def duracion(ruta):
    return sondear(ruta)['duracion']


def cuadros_de(ruta):
    """Cuantos cuadros de video tiene un archivo, contando paquetes (no decodifica: es rapido)."""
    r = subprocess.run([config.FFPROBE, '-v', 'error', '-select_streams', 'v:0', '-count_packets', '-show_entries',
                        'stream=nb_read_packets', '-of', 'csv=p=0', str(ruta)], capture_output=True, text=True, encoding='utf-8', errors='replace')
    try:
        return int(r.stdout.strip().split(',')[0])
    except ValueError:
        return -1


def extraer_audio(entrada, salida, sr=16000, canales=1, filtro=None, desde=None, dur=None):
    args = []
    if desde is not None:
        args += ['-ss', f'{desde:.4f}']
    args += ['-i', entrada]
    if dur is not None:
        args += ['-t', f'{dur:.4f}']
    args += ['-vn', '-ac', str(canales), '-ar', str(sr)]
    if filtro:
        args += ['-af', filtro]
    args += ['-c:a', 'pcm_s16le', salida]
    correr(args)
    return salida


def leer_wav(ruta, flotante=True):
    sr, x = wavfile.read(str(ruta), mmap=True)
    if flotante:
        x = x.astype(np.float32) / 32768.0
    return sr, x


def escribir_wav(ruta, sr, y):
    y = np.clip(y, -1, 1)
    wavfile.write(str(ruta), sr, (y * 32767).astype(np.int16))


def concatenar(partes, salida, copiar=True):
    lst = Path(salida).with_suffix('.lista.txt')
    with open(lst, 'w', encoding='utf8') as f:
        for p in partes:
            f.write(f"file '{Path(p).resolve().as_posix()}'\n")
    correr(['-f', 'concat', '-safe', '0', '-i', lst] + (['-c', 'copy'] if copiar else ENC) + [salida])
    lst.unlink(missing_ok=True)
    return salida


def reemplazo_atomico(tmp, final):
    os.replace(tmp, final)


def ruta_filtro(p):
    """Ruta escapada para usar dentro de un filtro (movie=, ass=)."""
    return str(Path(p).resolve().as_posix()).replace('\\', '/').replace(':', '\\:').replace("'", "\\'")


def ebur128(ruta):
    """Sonoridad integrada (LUFS) y pico real (dBTP)."""
    cmd = [config.FFMPEG, '-hide_banner', '-nostdin', '-i', str(ruta), '-vn', '-af', 'ebur128=peak=true', '-f', 'null', '-']
    r = subprocess.run(cmd, capture_output=True, text=True, encoding='utf-8', errors='replace')
    txt = r.stderr
    resumen = txt[txt.rfind('Summary:'):]
    i = tp = None
    for linea in resumen.splitlines():
        s = linea.strip()
        if s.startswith('I:'):
            i = float(s.split()[1])
        if s.startswith('Peak:'):
            tp = float(s.split()[1])
    return i, tp
