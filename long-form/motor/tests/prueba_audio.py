"""Musica de fondo (bucle y ducking), audio tomado de un video y efectos de la biblioteca de Studio.

    python tests/prueba_audio.py        (desde long-form/motor; la prueba de mezcla necesita ffmpeg)
"""
import json
import shutil
import subprocess
import sys
import tempfile
import types
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import numpy as np  # noqa: E402

from editor import config, ffm  # noqa: E402
from editor import estilo as E  # noqa: E402
from editor.contexto import Mapa  # noqa: E402
from editor.etapas import render as R  # noqa: E402

SR = 48000


def prueba_lufs_fondo():
    assert R.lufs_fondo(0) == -36 and R.lufs_fondo(1) == -20
    assert abs(R.lufs_fondo(0.35) - -30.4) < 1e-9
    assert R.lufs_fondo(5) == -20          # fuera de rango se limita: el fondo nunca tapa la voz (-16)


def prueba_bucle():
    y = np.ones((SR * 2, 2), np.float32)
    out = R.bucle(y, SR * 7, SR)
    assert out.shape == (SR * 7, 2)
    # en el cruce las dos vueltas suman ~1: el empalme no se oye como un hueco ni como un golpe
    medio = out[SR // 2:-SR // 2, 0]
    assert medio.min() > 0.95 and medio.max() < 1.05, (medio.min(), medio.max())
    # si la cancion alcanza, solo se corta
    assert R.bucle(y, SR, SR).shape == (SR, 2)


def _voz(segundos, hablando):
    t = np.arange(int(SR * segundos)) / SR
    v = 0.3 * np.sin(2 * np.pi * 220 * t) * (0.6 + 0.4 * np.sin(2 * np.pi * 4 * t))
    return (v * hablando(t)).astype(np.float32)


def prueba_ducking():
    # habla de 0 a 4 s, calla de 4 a 8, y vuelve; con micro pausas de 0,15 s mientras habla
    voz = _voz(12, lambda t: ((t < 4) | (t > 8)) & ((t % 1.0) > 0.15))
    g = R.ganancia_ducking(voz, SR, baja_db=10)
    db = 20 * np.log10(g)
    assert len(g) == len(voz)
    assert abs(db[int(SR * 2):int(SR * 3.5)].mean() + 10) < 0.6       # con voz: -10 dB
    assert db[int(SR * 6.5):int(SR * 7.5)].mean() > -1.0              # en la pausa larga vuelve a 0 dB
    # entre palabras (0,15 s) no sube: no "bombea"
    assert db[int(SR * 1.0):int(SR * 3.9)].max() < -9
    # sin voz no se toca
    assert np.allclose(R.ganancia_ducking(np.zeros(SR, np.float32), SR), 1)


def prueba_estilo_con_sfx_de_studio():
    with tempfile.TemporaryDirectory() as d:
        cfg = {'colores': {'acento': '#ff5b00', 'acento_texto': '#b43d00', 'tinta': '#171310'},
               'fuente': {'origen': 'studio', 'nombre': 'Space Grotesk'},
               'musica': {'fondo': 'studio:no-es-musica', 'volumen_fondo': 0.5},
               'sfx': {'rotulo': 'studio:whoosh-corto', 'barra': 'studio:no-existe', 'volumen': 0.6}}
        bajados = []
        carpeta = E.armar(cfg, lambda *a: bajados.append(a), Path(d) / 'marca', {})
        m = json.loads((carpeta / 'marca.json').read_text(encoding='utf8'))
        assert m['sfx'] == {'rotulo-entra': 'audio/whoosh-corto.wav'}, m['sfx']
        assert (carpeta / 'audio' / 'whoosh-corto.wav').exists() and not bajados
        assert m['musica']['volumen_fondo'] == 0.5 and m['musica']['fondo'] is None


def prueba_mezcla_con_fondo_de_un_video():
    """De punta a punta: la musica de fondo llega como MP4 (se usa su audio), se repite y baja con la voz."""
    if not shutil.which(config.FFMPEG):
        print('      (sin ffmpeg: se salta)')
        return
    with tempfile.TemporaryDirectory() as d:
        d = Path(d)
        (d / 'render').mkdir()
        prog = d / 'programa.wav'
        voz = _voz(20, lambda t: (t < 8) | (t > 12))
        ffm.escribir_wav(prog, SR, voz)
        cancion = d / 'videoclip.mp4'
        # 1430 Hz: no es armonico de la "voz" (220 Hz; 1320 y 1540 si lo son), asi el compresor del programa no ensucia la medida
        subprocess.run([config.FFMPEG, '-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=1430:duration=6',
                        '-f', 'lavfi', '-i', 'color=c=black:s=160x90:d=6', '-shortest', '-c:v', 'libx264', '-c:a', 'aac', str(cancion)], check=True)
        mudo = d / 'mudo.mp4'
        subprocess.run([config.FFMPEG, '-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=black:s=160x90:d=2',
                        '-c:v', 'libx264', str(mudo)], check=True)
        avisos = []
        archivos = {'musica': [{'tipo': 'musica', 'rol': 'fondo', 'nombre': 'videoclip.mp4', 'ruta': str(cancion)},
                               {'tipo': 'musica', 'rol': 'intro', 'nombre': 'mudo.mp4', 'ruta': str(mudo)}]}
        marca = types.SimpleNamespace(cfg={'musica': {'volumen_fondo': 0.6, 'loudness_lufs': -17}},
                                      musica=lambda clave: None, sfx=lambda nombre: None)
        ctx = types.SimpleNamespace(FPS=30, spec={}, marca=marca, opcion=lambda k, v: v, aviso=avisos.append,
                                    archivos=lambda tipo: archivos.get(tipo, []), local=lambda a: Path(a['ruta']),
                                    tj=lambda n: d / n)
        keep = [(0.0, 20.0)]
        R.audio(ctx, keep, Mapa(keep, 30, 0.0), [], str(prog), 0.0, 0.0)
        _, mix = ffm.leer_wav(d / 'render' / 'audio.wav')
        mix = np.asarray(mix, np.float64)
        mix = mix.mean(axis=1) if mix.ndim == 2 else mix

        def nivel(a, b, f0):
            # amplitud del tono en dBFS: el pico de la FFT dividido por la suma de la ventana (no depende del largo)
            x = mix[int(a * SR):int(b * SR)]
            w = np.hanning(len(x))
            f = 2 * np.abs(np.fft.rfft(x * w)) / w.sum()
            hz = np.fft.rfftfreq(len(x), 1 / SR)
            return 20 * np.log10(f[(hz > f0 - 20) & (hz < f0 + 20)].max() + 1e-12)
        # Ventanas lejos de los empalmes del bucle (5-6, 10-11, 15-16 s): ahi dos copias de un tono puro se
        # cruzan desfasadas (el AAC agrega un retardo) y la medida no dice nada del ducking.
        hablando, callado = nivel(2.5, 4.8, 1430), nivel(11.0, 11.6, 1430)
        # el fondo suena (vino de un MP4) despues de los 6 s que dura la cancion (bucle): muy por encima del piso
        assert callado - nivel(11.0, 11.6, 1700) > 30, (callado, nivel(11.0, 11.6, 1700))
        # y baja con la voz (~10 dB pedidos)
        assert 8 < callado - hablando < 12, (hablando, callado)
        # un video sin sonido no rompe la mezcla: se avisa
        assert any('mudo.mp4' in a for a in avisos), avisos


if __name__ == '__main__':
    fallas = 0
    for nombre, fn in list(globals().items()):
        if nombre.startswith('prueba_') and callable(fn):
            try:
                fn()
                print('ok   ', nombre)
            except AssertionError as e:
                fallas += 1
                import traceback
                print('FALLA', nombre, e)
                traceback.print_exc()
    print(f'{fallas} fallas')
    sys.exit(1 if fallas else 0)
