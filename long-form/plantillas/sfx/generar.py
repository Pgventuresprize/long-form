"""Biblioteca de efectos de Studio: sonidos genericos para los graficos de long form.

Se generan con codigo (ruido filtrado, senos y envolventes), no se descargan: son nuestros, sin
licencia que cuidar (dominio publico, CC0), y cualquier marca los puede usar. Studio los ofrece en
Marca > Long form como "Biblioteca de Studio" y el motor los copia a la carpeta de la marca.

    python long-form/plantillas/sfx/generar.py      (con el venv del motor: necesita numpy)

Escribe WAV mono de 48 kHz y 16 bits en esta carpeta. El catalogo que lee Studio esta en
src/engine/long-form/sfx-studio.ts: si se agrega un sonido aqui, se agrega alla.
"""
import wave
from pathlib import Path

import numpy as np

SR = 48000
AQUI = Path(__file__).resolve().parent
rng = np.random.default_rng(7)


def t(seg):
    return np.arange(int(SR * seg)) / SR


def env(n, ataque, caida, forma=2.0):
    """Envolvente de subida lineal y caida exponencial, en muestras."""
    a = max(1, int(SR * ataque))
    e = np.ones(n)
    e[:a] = np.linspace(0, 1, a)
    resto = n - a
    if resto > 0:
        e[a:] = np.exp(-forma * np.linspace(0, 1, resto) * (1 / max(caida, 1e-3)))
    return e


def filtro_barrido(x, f0, f1, q=1.2):
    """Paso banda de estado variable cuyo centro va de f0 a f1 (Hz): el 'whoosh'."""
    n = len(x)
    fc = np.geomspace(f0, f1, n) if f0 > 0 and f1 > 0 else np.linspace(f0, f1, n)
    low = band = 0.0
    out = np.empty(n)
    amort = 1.0 / q
    for i in range(n):
        f = 2 * np.sin(np.pi * min(fc[i], SR / 6) / SR)
        high = x[i] - low - amort * band
        band += f * high
        low += f * band
        out[i] = band
    return out


def norm(x, pico_db=-3.0):
    p = np.max(np.abs(x)) or 1.0
    return x / p * 10 ** (pico_db / 20)


def fundidos(x, ent=0.004, sal=0.02):
    a, b = int(SR * ent), int(SR * sal)
    x = x.copy()
    x[:a] *= np.linspace(0, 1, a)
    x[-b:] *= np.linspace(1, 0, b)
    return x


def whoosh(seg, f0, f1, ataque):
    n = int(SR * seg)
    ruido = rng.standard_normal(n)
    x = filtro_barrido(ruido, f0, f1, q=1.6)
    pos = np.linspace(0, 1, n)
    forma = np.where(pos < ataque, pos / ataque, (1 - pos) / (1 - ataque)) ** 1.6
    return x * forma


def campana(f, seg, caida=1.0):
    x = t(seg)
    parciales = [(1.0, 1.0), (2.76, 0.45), (5.40, 0.25), (8.93, 0.12)]
    s = sum(a * np.sin(2 * np.pi * f * k * x) * np.exp(-x * (3 + k) / caida) for k, a in parciales)
    return s * env(len(x), 0.002, 1.0, 0.5)


def sonidos():
    out = {}
    out['whoosh-corto'] = whoosh(0.55, 300, 4000, 0.55)
    out['whoosh-largo'] = whoosh(1.1, 200, 3000, 0.6)
    out['swoosh-salida'] = whoosh(0.5, 3500, 250, 0.25)

    x = t(0.14)
    f = 950 * np.exp(-x * 18) + 260
    out['pop'] = np.sin(2 * np.pi * np.cumsum(f) / SR) * env(len(x), 0.001, 0.35, 3)

    x = t(0.22)
    f = 320 + (1250 - 320) * (x / x[-1]) ** 1.5
    out['burbuja'] = np.sin(2 * np.pi * np.cumsum(f) / SR) * env(len(x), 0.004, 0.5, 2.5)

    n = int(SR * 0.05)
    clic = filtro_barrido(rng.standard_normal(n), 3000, 2200, q=4) * env(n, 0.0005, 0.12, 4)
    clic += 0.4 * np.sin(2 * np.pi * 2800 * t(0.05)) * env(n, 0.0005, 0.08, 5)
    out['clic'] = clic

    n = int(SR * 0.09)
    out['tecla'] = filtro_barrido(rng.standard_normal(n), 1800, 1200, q=3) * env(n, 0.0005, 0.1, 5)

    out['ding'] = campana(880, 1.3)
    a, b = campana(784, 0.9, 0.6), campana(1175, 0.9, 0.6)
    doble = np.zeros(int(SR * 1.1))
    doble[:len(a)] += a
    doble[int(SR * 0.16):int(SR * 0.16) + len(b)] += b
    out['campanita-doble'] = doble

    x = t(2.0)
    sube = (x / x[-1]) ** 2.2
    tono = np.sin(2 * np.pi * np.cumsum(180 + 900 * sube) / SR) * 0.35
    soplo = filtro_barrido(rng.standard_normal(len(x)), 400, 6000, q=1.0)
    out['riser'] = (tono + soplo / (np.max(np.abs(soplo)) or 1)) * sube

    x = t(0.9)
    f = 95 * np.exp(-x * 6) + 42
    golpe = np.sin(2 * np.pi * np.cumsum(f) / SR) * env(len(x), 0.002, 0.45, 2.5)
    n = int(SR * 0.03)
    golpe[:n] += filtro_barrido(rng.standard_normal(n), 2500, 600, q=1) * np.linspace(1, 0, n) * 0.6
    out['golpe-grave'] = golpe

    x = t(0.9)
    suave = whoosh(0.9, 150, 1800, 0.5) * 0.7 + 0.25 * np.sin(2 * np.pi * 523 * x) * np.sin(np.pi * x / x[-1]) ** 2
    out['transicion-suave'] = suave
    return out


def escribir(nombre, x):
    x = fundidos(norm(x))
    datos = (np.clip(x, -1, 1) * 32767).astype('<i2').tobytes()
    with wave.open(str(AQUI / f'{nombre}.wav'), 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(datos)


if __name__ == '__main__':
    for nombre, x in sonidos().items():
        escribir(nombre, x)
        print(f'{nombre}.wav  {len(x) / SR:.2f} s')
