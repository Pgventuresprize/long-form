"""Silencios y cortes: que tramos de la linea maestra se conservan (keep).

Mismo criterio de los dos videos: nivel RMS cada 20 ms suavizado a 100 ms; umbral = piso + 0,35 x (voz - piso),
con el piso en el percentil 5 y la voz en el 90. Se cortan las pausas de 0,6 s o mas dejando 0,18 s de aire a
cada lado; las mas cortas dan el ritmo natural y se respetan.

Los graficos se colocan despues, en tiempo de salida, asi un corte nunca rompe una animacion.
"""
import numpy as np

from . import ffm


PASO = 0.02


def niveles(sr, x):
    """Nivel en dB cada 20 ms, suavizado a 100 ms. Lo usan las pausas y el referente (musica entre frases)."""
    f = int(sr * PASO)
    n = len(x) // f
    rms = np.sqrt((np.asarray(x[:n * f], np.float32).reshape(n, f) ** 2).mean(1))
    db = 20 * np.log10(rms + 1e-5)
    return np.convolve(db, np.ones(5) / 5, 'same')


def pausas(wav, k=0.35, minimo=0.6, aire=0.18):
    sr, x = ffm.leer_wav(wav)
    h = PASO
    db = niveles(sr, x)
    voz, piso = np.percentile(db, 90), np.percentile(db, 5)
    thr = piso + k * (voz - piso)
    q = db < thr
    cortes, s = [], None
    for i, v in enumerate(list(q) + [False]):
        if v and s is None:
            s = i
        elif not v and s is not None:
            if (i - s) * h >= minimo:
                cortes.append((s * h + aire, i * h - aire))
            s = None
    info = {'voz_db': round(float(voz), 1), 'piso_db': round(float(piso), 1), 'umbral_db': round(float(thr), 1),
            'pausas': len(cortes), 'segundos': round(sum(b - a for a, b in cortes), 1)}
    return cortes, info


def conservar(fin, cortes, fps=30, inicio=0.0):
    """Tramos conservados en [inicio, fin] quitando los cortes (silencios y editoriales), a cuadros exactos."""
    keep, pos = [], inicio
    for a, b in sorted(cortes):
        if b <= pos:
            continue
        if a > pos:
            keep.append((pos, a))
        pos = max(pos, b)
    if pos < fin:
        keep.append((pos, fin))
    return [(round(a * fps) / fps, round(b * fps) / fps) for a, b in keep if b - a > 0.08]
