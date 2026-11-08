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
    r = subprocess.run(cmd, capture_output=True, text=True, **kw)
    if r.returncode != 0:
        raise ErrorFfmpeg(f'ffmpeg fallo ({r.returncode}): {r.stderr[-2000:]}\n{" ".join(cmd)[:1500]}')
    return r


def sondear(ruta):
    r = subprocess.run([config.FFPROBE, '-v', 'error', '-show_entries',
                        'format=duration:stream=index,codec_type,codec_name,width,height,avg_frame_rate,r_frame_rate,sample_rate,channels:stream_side_data=rotation',
                        '-of', 'json', str(ruta)], capture_output=True, text=True)
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
        'rotacion': rot,
    }


def duracion(ruta):
    return sondear(ruta)['duracion']


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
    r = subprocess.run(cmd, capture_output=True, text=True)
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
