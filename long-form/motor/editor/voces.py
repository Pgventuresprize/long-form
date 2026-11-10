"""Quién suena en cada frase, sin saber quién es: las frases se agrupan por voz.

Cada frase se resume en su timbre (MFCC: 20 coeficientes cepstrales en escala mel, su media y su dispersión en
las partes con voz) y las frases se agrupan por cercanía (agrupamiento jerárquico, distancia coseno). No dice
nombres: dice "estas frases son de la misma voz". Una cámara con varias personas usa eso para que la boca no
tenga que decidir frase por frase (quien escucha también mueve la boca: asiente, se ríe): a cada voz se le
asigna la cara cuya boca más se mueve en el conjunto de sus frases.
"""
import numpy as np

SR = 16000


def _mel(n_filtros, n_fft, sr):
    def hz2mel(f):
        return 2595 * np.log10(1 + f / 700)

    def mel2hz(m):
        return 700 * (10 ** (m / 2595) - 1)
    puntos = mel2hz(np.linspace(hz2mel(60), hz2mel(sr / 2 - 200), n_filtros + 2))
    bins = np.floor((n_fft + 1) * puntos / sr).astype(int)
    fb = np.zeros((n_filtros, n_fft // 2 + 1))
    for i in range(1, n_filtros + 1):
        a, c, b = bins[i - 1], bins[i], bins[i + 1]
        if c > a:
            fb[i - 1, a:c] = (np.arange(a, c) - a) / (c - a)
        if b > c:
            fb[i - 1, c:b] = (b - np.arange(c, b)) / (b - c)
    return fb


_FB = _mel(40, 512, SR)


def huella(x):
    """Timbre de un tramo de audio mono a 16 kHz (float). None si casi no hay voz."""
    from scipy.fft import dct
    x = np.asarray(x, np.float32)
    if len(x) < SR * 0.5:
        return None
    x = np.append(x[0], x[1:] - 0.97 * x[:-1])
    paso, ancho = 160, 400
    n = 1 + (len(x) - ancho) // paso
    idx = np.arange(ancho)[None, :] + paso * np.arange(n)[:, None]
    cuadros = x[idx] * np.hamming(ancho)
    pot = np.abs(np.fft.rfft(cuadros, 512)) ** 2
    energia = pot.sum(1)
    # solo los cuadros con voz: el 60 % mas fuerte
    voz = energia >= np.percentile(energia, 40)
    if voz.sum() < 20:
        return None
    mel = np.log(pot[voz] @ _FB.T + 1e-8)
    # sin restar la media de la frase: el timbre medio es justo lo que distingue una voz de otra
    c = dct(mel, type=2, axis=1, norm='ortho')[:, 1:21]
    return np.concatenate([c.mean(0), c.std(0)])


def agrupar(huellas, maximo, umbral=0.35):
    """huellas: lista de vectores (o None). Devuelve una etiqueta por frase (0..k-1, o -1 si no hay huella), con
    k <= maximo. Se corta el árbol a la distancia `umbral`; si quedan más grupos que `maximo`, a `maximo`."""
    from scipy.cluster.hierarchy import fcluster, linkage
    validas = [i for i, h in enumerate(huellas) if h is not None]
    out = [-1] * len(huellas)
    if len(validas) < 4 or maximo < 2:
        for i in validas:
            out[i] = 0
        return out
    X = np.array([huellas[i] for i in validas])
    X = (X - X.mean(0)) / (X.std(0) + 1e-6)
    Z = linkage(X, 'average', metric='cosine')
    eti = fcluster(Z, umbral, 'distance')
    if len(set(eti)) > maximo:
        eti = fcluster(Z, maximo, 'maxclust')
    # los grupos de una o dos frases son ruido: se pegan al grupo mas cercano
    from collections import Counter
    cuenta = Counter(eti)
    grandes = [g for g, n in cuenta.items() if n >= max(3, 0.05 * len(validas))] or [cuenta.most_common(1)[0][0]]
    centros = {g: X[eti == g].mean(0) for g in grandes}
    for j, g in enumerate(eti):
        if g not in centros:
            eti[j] = min(centros, key=lambda c: 1 - np.dot(X[j], centros[c]) / (np.linalg.norm(X[j]) * np.linalg.norm(centros[c]) + 1e-9))
    orden = {g: k for k, g in enumerate(sorted(set(eti), key=lambda g: -np.sum(eti == g)))}
    for j, i in enumerate(validas):
        out[i] = orden[eti[j]]
    return out
