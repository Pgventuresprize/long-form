"""Etapa 2 (cámaras separadas) · Sincronía, quién habla y encuadres.

Portado de sync.py, lat.py, vad.py, dir.py y edl.py del video de César.

Sincronía: envolvente de cada audio a 1 kHz correlacionada por FFT contra la cámara maestra; despues se
revisa en cinco ventanas de 60 s que ningun reloj se adelante (deriva).

Quién habla, dos métodos:
  - Videollamada (fuga entre micrófonos): la voz de A entra directo a su micro y, con el retraso de la
    llamada, sale por el parlante de B y entra al micro de B. El signo del retraso dice quien es la fuente.
    Sin retraso pero con correlacion alta = un tercero en la llamada (llega igual a los dos parlantes).
  - Misma sala (sin retraso de llamada): gana el micro con mas nivel relativo a su propio maximo.
  Se usa el primero si la correlacion es buena en suficientes ventanas; si no, el segundo.

Encuadres: en vez de recortes fijos medidos a mano, se detectan las caras (OpenCV) en 24 cuadros de
cada cámara y se calcula el plano cerrado (1,25x sobre la cara) y la mitad para la pantalla dividida.
"""
import numpy as np
from scipy.signal import butter, fftconvolve, sosfilt

from .. import ffm
from .. import tipos

PASO = 0.25          # grilla de etiquetas (s)


def _env(x, hop):
    n = len(x) // hop
    return np.abs(x[:n * hop]).reshape(n, hop).mean(1)


def _xcorr(x, y, rate):
    x = (x - x.mean()) / (x.std() + 1e-9)
    y = (y - y.mean()) / (y.std() + 1e-9)
    c = fftconvolve(x, y[::-1], mode='full')
    k = int(np.argmax(c))
    return (k - (len(y) - 1)) / rate, float(c[k] / min(len(x), len(y)))


def sincronizar(maestro, otro, sr=16000):
    """Desfase de `otro` respecto al maestro: tiempo_otro = tiempo_maestro + off.

    En una videollamada cada camara tiene la voz directa de su dueño y la fuga de la otra, que llega con
    el retraso de la llamada. Por eso, segun quien hable en cada tramo, la correlacion cae en
    off + latencia o en off - latencia. Se mide el pico en ventanas de 12 s por toda la grabacion y se
    agrupan: con dos grupos, el reloj real esta en el medio y la mitad de la separacion es la latencia;
    con uno (misma sala, sin llamada), es ese. Una pendiente en los residuos por tiempo es deriva.
    """
    hop = 16
    rate = sr / hop
    ea, eb = _env(otro, hop), _env(maestro, hop)
    off0, sc = _xcorr(ea, eb, rate)
    win, paso, marg = 12.0, 6.0, 1.5
    dur_m = len(maestro) / sr
    medidas = []
    tb = 0.0
    while tb + win <= dur_m:
        ta = tb + off0
        if ta - marg >= 0 and (ta + win + marg) * rate <= len(ea):
            w = eb[int(tb * rate):int((tb + win) * rate)]
            s0 = int((ta - marg) * rate)
            seg = ea[s0:s0 + len(w) + int(2 * marg * rate)]
            if w.std() > 0 and seg.std() > 0:
                w2 = (w - w.mean()) / w.std()
                s2 = (seg - seg.mean()) / seg.std()
                c = fftconvolve(s2, w2[::-1], mode='valid') / len(w)
                k = int(np.argmax(c))
                if c[k] > 0.25:
                    medidas.append((tb + win / 2, s0 / rate + k / rate - tb, float(c[k])))
        tb += paso
    if len(medidas) < 3:
        return off0, sc, [], 0.0
    M = np.array(medidas)
    lags = M[:, 1]
    # modos del histograma (bins de 10 ms, suavizado)
    lo, hi = lags.min() - 0.05, lags.max() + 0.05
    nb = max(int((hi - lo) / 0.01), 1)
    h, e = np.histogram(lags, bins=nb, range=(lo, hi))
    hs = np.convolve(h, np.ones(3), 'same')
    centros = (e[:-1] + e[1:]) / 2
    orden = np.argsort(hs)[::-1]
    m1 = centros[orden[0]]
    m2 = None
    for j in orden[1:]:
        sep = abs(centros[j] - m1)
        if 0.08 <= sep <= 1.0 and hs[j] >= 0.15 * hs[orden[0]]:
            m2 = centros[j]
            break
    def centro_de(valor, m):
        cerca = lags[np.abs(lags - m) < 0.04]
        return float(np.median(cerca)) if len(cerca) else float(m)
    if m2 is not None:
        c1, c2 = centro_de(None, m1), centro_de(None, m2)
        off, lat = (c1 + c2) / 2, abs(c1 - c2) / 2
        resid = np.where(np.abs(lags - c1) < np.abs(lags - c2), lags - c1, lags - c2)
    else:
        off, lat = centro_de(None, m1), 0.0
        resid = lags - off
    ok = np.abs(resid) < 0.05
    deriva = []
    if ok.sum() >= 4:
        pend = np.polyfit(M[ok, 0], resid[ok], 1)[0]
        deriva = [round(float(pend * dur_m), 3)]      # desplazamiento acumulado de punta a punta
    return float(off), sc, deriva, float(lat)


def _niveles(x, sr, paso=0.1):
    f = int(sr * paso)
    m = len(x) // f
    return 20 * np.log10(np.sqrt((x[:m * f].reshape(m, f) ** 2).mean(1)) + 1e-5)


def direccion(a, b, sr=16000):
    """Retraso de fuga entre dos micros alineados (ventanas de 1,5 s cada 0,25 s, +-0,45 s)."""
    sos = butter(4, [200, 3000], btype='band', fs=sr, output='sos')
    a = sosfilt(sos, a)
    b = sosfilt(sos, b)
    hop = sr // 200                       # 5 ms
    R = sr / hop

    def env(x):
        k = len(x) // hop
        return np.log(np.sqrt((x[:k * hop].reshape(k, hop) ** 2).mean(1)) * 32768 + 1.0)
    ea, eb = env(a), env(b)
    W, S, ML = int(1.5 * R), int(PASO * R), int(0.45 * R)
    lags = np.arange(-ML, ML + 1)
    out = []
    for s in range(ML, len(ea) - W - ML, S):
        wb = eb[s:s + W] - eb[s:s + W].mean()
        sb = np.sqrt((wb ** 2).sum()) + 1e-9
        seg = ea[s - ML:s + W + ML]
        # todas las ventanas desplazadas de una vez
        idx = ML + lags[:, None] + np.arange(W)[None, :]
        wa = seg[idx]
        wa = wa - wa.mean(1, keepdims=True)
        cs = (wa * wb).sum(1) / (np.sqrt((wa ** 2).sum(1)) * sb + 1e-9)
        k = int(cs.argmax())
        out.append((s / R + W / R / 2, lags[k] / R, cs[k]))
    return np.array(out)


def etiquetas(ctx, auds, offs, dur):
    """Etiqueta por cada 0,25 s de la linea maestra: indice de camara, -1 silencio, -2 tercero."""
    claves = list(auds.keys())
    sr = 16000
    al = {}
    for k in claves:
        x = auds[k]
        o = int(round(offs[k] * sr))
        y = x[o:] if o >= 0 else np.concatenate([np.zeros(-o, np.float32), x])
        n = int(dur * sr)
        al[k] = np.pad(y[:n], (0, max(0, n - len(y[:n]))))
    sos = butter(4, [150, 3500], btype='band', fs=sr, output='sos')
    L = {k: _niveles(sosfilt(sos, al[k]), sr) for k in claves}
    m = min(len(v) for v in L.values())
    L = {k: v[:m] for k, v in L.items()}
    grid = np.arange(0, dur, PASO)
    li = np.clip((grid * 10).astype(int), 0, m - 1)
    # piso de cada micro: entre el silencio (p10) y la voz (p90); silencio si todos estan por debajo
    piso = {k: np.percentile(v, 10) + 0.3 * (np.percentile(v, 90) - np.percentile(v, 10)) for k, v in L.items()}
    quieto = np.all([L[k][li] < piso[k] for k in claves], axis=0)

    metodo = 'nivel'
    lab = np.full(len(grid), -1, np.int8)
    if len(claves) == 2:
        D = direccion(al[claves[0]], al[claves[1]], sr)
        t, lag, c = D.T
        buenas = (c > 0.45) & (np.abs(lag) > 0.1)
        if buenas.mean() > 0.15:
            metodo = 'fuga'
            idx = np.clip(np.searchsorted(t, grid), 0, len(t) - 1)
            lg, cc = lag[idx], c[idx]
            # A[t] contra B[t-lag]: retraso negativo = la copia de A llega antes -> habla A
            lab = np.where((lg < -0.1) & (cc > 0.45), 0, np.where((lg > 0.1) & (cc > 0.45), 1, -1)).astype(np.int8)
            tercero = (lab == -1) & ~quieto & (cc > 0.45) & (np.abs(lg) < 0.08)
            lab[tercero] = -2
        ctx.log(f'fuga entre micros en {buenas.mean():.0%} de las ventanas -> método «{metodo}»')
    if metodo == 'nivel':
        rel = np.stack([L[k][li] - np.percentile(L[k], 95) for k in claves])
        gana = rel.argmax(0)
        orden = np.sort(rel, 0)
        claro = (orden[-1] - orden[-2]) > 4 if len(claves) > 1 else np.ones(len(grid), bool)
        lab = np.where(claro, gana, -1).astype(np.int8)
    lab[quieto] = -1
    return lab, L, quieto, metodo


def encuadres(ruta, dur, info, n=24):
    """Cara media de la camara -> plano cerrado (1,25x) y media pantalla para el plano doble."""
    import subprocess

    import cv2

    from .. import config
    from ..caras import Detector
    det = Detector()
    W, H = info['ancho'], info['alto']
    caras = []
    color = []
    for t in np.linspace(dur * 0.05, dur * 0.95, n):
        p = subprocess.run([config.FFMPEG, '-v', 'error', '-ss', f'{t:.2f}', '-i', str(ruta), '-frames:v', '1',
                            '-f', 'rawvideo', '-pix_fmt', 'bgr24', '-'], capture_output=True)
        if len(p.stdout) < W * H * 3:
            continue
        bgr = np.frombuffer(p.stdout[:W * H * 3], np.uint8).reshape(H, W, 3)
        # se busca a 960 px (YuNet a 4K es lento y no ve mas) y se vuelve a la escala de la fuente
        k = min(1.0, 960 / W)
        chico = cv2.resize(bgr, (int(W * k), int(H * k)), interpolation=cv2.INTER_AREA) if k < 1 else bgr
        fs = [[int(v / k) for v in c['caja']] for c in det.caras(chico, 1 / 16)]
        if len(fs):
            x, y, w, h = max(fs, key=lambda f: f[2] * f[3])
            caras.append((x + w / 2, y + h / 2, w))
            # el color se mide en la cara y su entorno: es lo que el ojo compara al cambiar de camara
            zona = bgr[max(0, y - h // 2):y + h * 2, max(0, x - w // 2):x + w + w // 2]
        else:
            zona = bgr[H // 4:H * 3 // 4, W // 4:W * 3 // 4]
        color.append(zona.reshape(-1, 3).mean(0))
    if caras:
        cx, cy, cw = np.median(np.array(caras), 0)
    else:
        cx, cy, cw = W / 2, H * 0.4, W / 6
    # cerrado: 80 % del cuadro, cara en el tercio superior
    cw_, ch_ = int(W * 0.8) & ~1, int(H * 0.8) & ~1
    x0 = int(np.clip(cx - cw_ / 2, 0, W - cw_)) & ~1
    y0 = int(np.clip(cy - ch_ * 0.4, 0, H - ch_)) & ~1
    # mitad para el plano doble: ancho = la mitad del lienzo en la proporcion del cuadro
    hw = int(W * 0.497) & ~1
    hx = int(np.clip(cx - hw / 2, 0, W - hw)) & ~1
    return {'cara': [float(cx), float(cy), float(cw)], 'caras_vistas': len(caras),
            'cerrado': [cw_, ch_, x0, y0], 'mitad': [hw, H, hx, 0],
            'color': [round(float(v), 1) for v in np.median(np.array(color), 0)] if color else None}



def mezcla(ctx, lab, offs, claves, inicio, fin, sr=48000):
    """Audio que sigue a quien habla (audio.py): cada micro a su nivel, el inactivo a -24 dB, no a cero,
    para no perder risas ni ambiente. 0,25 s de anticipacion y fundido de 80 ms."""
    n = int((fin - inicio) * sr)
    pistas = []
    for k in claves:
        _, x = ffm.leer_wav(ctx.tj(f'a48_{k}.wav'))
        o = int(round((inicio + offs[k]) * sr))
        y = np.asarray(x[max(o, 0):max(o, 0) + n], np.float32)
        if o < 0:
            y = np.concatenate([np.zeros(-o, np.float32), y])[:n]
        pistas.append(np.pad(y, (0, n - len(y))))
    # nivel de voz de cada micro mientras habla su dueño (mediana en tramos de 0,1 s)
    f = sr // 10
    m = n // f
    g0 = np.clip(((inicio + np.arange(m) / 10) / PASO).astype(int), 0, len(lab) - 1)
    ganancia = []
    for i, y in enumerate(pistas):
        r = np.sqrt((y[:m * f].reshape(m, f) ** 2).mean(1))
        sel = r[lab[g0] == i]
        ganancia.append(np.median(sel) if len(sel) > 20 else np.median(r))
    ref = ganancia[0]
    ganancia = [ref / max(gk, 1e-6) for gk in ganancia]
    # etiquetas para el audio: solo camaras, rellenando huecos con la ultima
    al = lab.copy()
    cur = 0
    for i in range(len(al)):
        if al[i] < 0:
            al[i] = cur
        else:
            cur = al[i]
    OFFG = 10 ** (-24 / 20)
    kk = np.arange(int(n / sr * 100) + 2)
    g = np.clip(((inicio + kk / 100 + 0.25) / PASO).astype(int), 0, len(al) - 1)
    rampa = np.ones(8, np.float32) / 8
    sobres = []
    for i in range(len(claves)):
        act = np.convolve((al[g] == i).astype(np.float32), rampa, 'same')
        sobres.append(OFFG + (1 - OFFG) * act)
    rejilla = np.arange(len(kk)) * (sr / 100)
    out = np.zeros(n, np.float32)
    CH = sr * 60
    for s in range(0, n, CH):
        e = min(n, s + CH)
        x = np.arange(s, e)
        for i, y in enumerate(pistas):
            out[s:e] += y[s:e] * np.interp(x, rejilla, sobres[i]) * ganancia[i]
    out *= 0.7 / max(np.percentile(np.abs(out), 99.9), 1e-6) * 0.5
    ffm.escribir_wav(ctx.tj('programa48.wav'), sr, out)
    ffm.extraer_audio(ctx.tj('programa48.wav'), ctx.tj('programa16.wav'), 16000, 1)
    return [round(float(gk), 3) for gk in ganancia]

def correr(ctx):
    from .. import tipos
    ctx.necesita('ingesta')
    fuentes = tipos.fuentes(ctx)
    if len(fuentes) < 2:
        raise RuntimeError('Varias cámaras necesita al menos dos videos (uno por cámara)')
    sin_audio = [f['clave'] for f in fuentes if not f.get('audio')]
    if sin_audio:
        raise RuntimeError(f'La cámara {", ".join(sin_audio)} no tiene audio: sin él no se puede sincronizar ni saber quién habla')
    maestra = ctx.opcion('camara_maestra', fuentes[0]['clave'])
    claves = [f['clave'] for f in fuentes]
    auds = {}
    for k in claves:
        _, x = ffm.leer_wav(ctx.tj(f'a16_{k}.wav'))
        auds[k] = np.asarray(x, np.float32)
    offs = {maestra: 0.0}
    sinc = {}
    for k in claves:
        if k == maestra:
            continue
        ctx.avance(f'Sincronizando {k} con {maestra}', .1)
        off, sc, deriva, lat = sincronizar(auds[maestra], auds[k])
        offs[k] = off
        der = deriva
        sinc[k] = {'off': round(off, 3), 'confianza': round(sc, 3), 'deriva': der, 'latencia_llamada': round(lat, 3)}
        ctx.log(f'{k} = {maestra} + {off:.3f} s (confianza {sc:.2f}, latencia de llamada {lat:.2f} s); deriva: {der}')
        if sc < 0.1:
            ctx.aviso(f'La sincronía de {k} es dudosa (confianza {sc:.2f}): revisa que sean la misma conversación.')
        if der and max(abs(d) for d in der) > 0.08:
            ctx.aviso(f'El reloj de {k} se desplaza hasta {max(abs(d) for d in der):.2f} s: puede notarse desfase en labios.')
    # tramo comun a todas las camaras, en la linea maestra
    inicio = max(0.0, max(-offs[k] for k in claves))
    fin = min(next(f['duracion'] for f in fuentes if f['clave'] == k) - offs[k] for k in claves)
    dur = fin
    ctx.avance('Detectando quién habla', .4)
    lab, L, quieto, metodo = etiquetas(ctx, auds, offs, dur)
    np.save(ctx.tj('etiquetas.npy'), lab)
    np.savez(ctx.tj('niveles.npz'), **{k: v for k, v in L.items()})
    enc = {}
    for i, f in enumerate(fuentes):
        ctx.avance(f'Buscando caras en {f["clave"]}', .6 + .3 * i / len(fuentes))
        enc[f['clave']] = encuadres(f['archivo'], f['duracion'], f)
        if enc[f['clave']]['caras_vistas'] < 4:
            ctx.aviso(f'Casi no se ven caras en la cámara {f["clave"]}: el plano cerrado va al centro; revisa el encuadre.')
    reparto = {k: float((lab == i).mean()) for i, k in enumerate(claves)}
    ctx.log('tiempo de voz: ' + ', '.join(f'{k} {v:.0%}' for k, v in reparto.items()) +
            f', tercero {(lab == -2).mean():.0%}, silencio {(lab == -1).mean():.0%}')
    medias = {k: e['color'] for k, e in enc.items() if e.get('color')}
    color = tipos.factores_color(medias, maestra) if maestra in medias and len(medias) > 1 else {}
    if color:
        ctx.log('color igualado a la cámara maestra: ' + ', '.join(f'{k} {v}' for k, v in color.items() if k != maestra))
    ctx.avance('Mezclando el audio que sigue a quien habla', .92)
    aparte = tipos.escribir_programa(ctx, maestra, inicio, fin, solo_aparte=True)
    if aparte is None:
        gan = mezcla(ctx, lab, offs, claves, inicio, fin)
        ctx.log(f'ganancias de los micros: {dict(zip(claves, gan))}')
    ctx.guardar('analisis', {'maestra': maestra, 'offsets': offs, 'sincronia': sinc, 'inicio': inicio, 'fin': fin,
                             'metodo': metodo, 'paso': PASO, 'claves': claves, 'voz': reparto, 'encuadres': enc,
                             'color': color, 'audio_aparte': aparte})


# ---------------------------------------------------------------- lista de planos (edl.py)
def edl(ctx, rep):
    """Planos sobre la linea del programa (s). Reglas del talk show de César:

    1. Turnos: corridas de un hablante de 2 s o mas; dos seguidos del mismo se funden.
    2. Reacciones: intervencion corta del otro (0,5-2 s) dentro de un turno ajeno con 1,5 s de margen:
       plano abierto de quien escucha 2-3,2 s, nunca mas de una cada 12 s.
    3. Intercambios rapidos (4+ cambios en 8 s): pantalla dividida.
    4. Turnos largos rotan abierto -> cerrado -> dividida (~13/13/8 s), cortando en la pausa mas silenciosa.
    5. Intro y cierre: 6 s de pantalla dividida.
    6. Planos de menos de 1,2 s se funden con el anterior.
    """
    an = ctx.estado['analisis']
    claves = an['claves']
    if len(claves) != 2:
        ctx.aviso('Con más de dos cámaras el plano doble usa las dos primeras.')
    A, B = claves[0], claves[1]
    lab = np.load(ctx.tj('etiquetas.npy'))
    niv = np.load(ctx.tj('niveles.npz'))
    LA, LB = niv[A], niv[B]
    T0 = an['inicio']
    T1 = an['fin']
    FPS = ctx.FPS
    nombre = {0: A, 1: B, -2: 'X'}
    filled = []
    cur = A
    for v in lab:
        if v in (0, 1, -2):
            cur = nombre[int(v)]
        filled.append(cur)
    runs, s = [], 0
    for i in range(1, len(filled) + 1):
        if i == len(filled) or filled[i] != filled[s]:
            runs.append([filled[s], s * PASO, i * PASO])
            s = i
    runs = [r for r in runs if r[2] > T0 and r[1] < T1]
    runs[0][1] = max(runs[0][1], T0)
    runs[-1][2] = min(runs[-1][2], T1)
    TURNO = 2.0
    turnos = []
    for r in runs:
        if r[2] - r[1] >= TURNO:
            if turnos and turnos[-1][0] == r[0]:
                turnos[-1][2] = r[2]
            else:
                if turnos:
                    turnos[-1][2] = r[1]
                turnos.append(list(r))
    if not turnos:
        turnos = [[A, T0, T1]]
    turnos[0][1] = T0
    turnos[-1][2] = T1
    for i in range(1, len(turnos)):
        turnos[i][1] = turnos[i - 1][2]
    reacciones = []
    for r in runs:
        d = r[2] - r[1]
        if 0.5 <= d < TURNO:
            h = next((t for t in turnos if t[1] <= r[1] < t[2]), None)
            if h and r[0] != 'X' and h[0] not in (r[0], 'X') and r[1] - h[1] > 1.5 and h[2] - r[2] > 1.5:
                reacciones.append((r[0], r[1], r[2]))
    alts = [r for r in runs if r[2] - r[1] >= 0.5]
    dos = []
    for i in range(len(alts)):
        j = i
        while j + 1 < len(alts) and alts[j + 1][1] - alts[i][1] <= 8.0:
            j += 1
        cambios = sum(1 for k in range(i + 1, j + 1) if alts[k][0] != alts[k - 1][0])
        if cambios >= 4:
            dos.append([alts[i][1], alts[j][2]])
    fund = []
    for a_, b_ in sorted(dos):
        if fund and a_ <= fund[-1][1] + 1.0:
            fund[-1][1] = max(fund[-1][1], b_)
        else:
            fund.append([a_, b_])
    dos = [m for m in fund if m[1] - m[0] >= 3.0]

    def en_dos(x):
        return any(a_ <= x < b_ for a_, b_ in dos)

    pA, pB = np.percentile(LA, 60), np.percentile(LB, 60)

    def pausa_cerca(x, span=1.5):
        lo, hi = max(int((x - span) * 10), 0), min(int((x + span) * 10), len(LA) - 1)
        if hi <= lo:
            return x
        lvl = np.maximum(LA[lo:hi] - pA, LB[lo:hi] - pB)
        return (lo + int(np.argmin(lvl))) / 10

    largo = {'W': ctx.opcion('plano_abierto_s', 13), 'C': ctx.opcion('plano_cerrado_s', 13), 'O': ctx.opcion('plano_doble_s', 8)}
    planos = []
    marco = {A: 0, B: 0}
    # el programa abre con 6 s de plano doble (no es la tarjeta de intro: esa va aparte, extremos.py)
    APERTURA = 6.0
    planos.append([T0, T0 + APERTURA, 'TWO'])
    for sp, a_, b_ in turnos:
        a_ = max(a_, T0 + APERTURA)
        if b_ <= a_:
            continue
        if sp == 'X':
            planos.append([a_, b_, 'TWO'])
            continue
        ciclo = [sp + 'W', sp + 'C', 'TWO']
        f = marco[sp] = (marco[sp] + 1) % 2
        x = a_
        while True:
            sh = ciclo[f % 3]
            L = largo['O' if sh == 'TWO' else sh[-1]]
            if b_ - x <= L + 6:
                break
            y = pausa_cerca(x + L)
            if y - x < L * 0.6:
                y = x + L
            planos.append([x, y, sh])
            f += 1
            x = y
        sh = ciclo[f % 3]
        planos.append([x, b_, sh if sh != 'TWO' or b_ - x < 12 else ciclo[0]])
        marco[sp] = f % 2
    ult = -1e9
    for sp, a_, b_ in reacciones:
        if a_ - ult < 12 or en_dos(a_) or a_ < T0 + APERTURA:
            continue
        ra = a_ - 0.25
        planos.append([ra, ra + min(max(b_ - a_ + 0.9, 2.0), 3.2), sp + 'W'])
        ult = a_
    for a_, b_ in dos:
        planos.append([a_, b_, 'TWO'])
    planos.append([T1 - 6.0, T1, 'TWO'])
    nf = int(round((T1 - T0) * FPS))
    pinta = np.full(nf, 'TWO', dtype=object)
    for a_, b_, sh in planos:
        fa, fb = max(int(round((a_ - T0) * FPS)), 0), min(int(round((b_ - T0) * FPS)), nf)
        pinta[fa:fb] = sh
    segs, s = [], 0
    for i in range(1, nf + 1):
        if i == nf or pinta[i] != pinta[s]:
            segs.append([s, i, pinta[s]])
            s = i
    MIN = int(1.2 * FPS)
    out = []
    for sg in segs:
        if out and (sg[1] - sg[0] < MIN or out[-1][2] == sg[2]):
            out[-1][1] = sg[1]
        else:
            out.append(sg)
    if len(out) > 1 and out[0][1] - out[0][0] < MIN:
        out[1][0] = 0
        out.pop(0)
    # tomas en segundos del programa (0 = inicio comun)
    tomas = [{'a': a_ / FPS, 'b': b_ / FPS, 'plano': sh} for a_, b_, sh in out]
    from collections import Counter
    cnt = Counter(t['plano'] for t in tomas)
    ctx.log(f'{len(turnos)} turnos, {len(reacciones)} reacciones candidatas, {len(dos)} tramos de intercambio; '
            f'{len(tomas)} planos: {dict(cnt)}')
    return tomas
