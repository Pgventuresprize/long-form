#!/usr/bin/env python3
"""Plogy · subtítulos — convierte un .srt en un .ass con el estilo de la marca.

Fijo: una sola línea, caja negra al 85 % y la proporción letra/caja (relleno 0,5 em, alto 2 em).
Libre: lienzo, tamaño y posición, según el formato del video.

El texto y la caja se escriben como curvas (dibujos ASS), así que el resultado es idéntico
en cualquier equipo con FFmpeg + libass, sin instalar la fuente.

Uso:
    python3 plogy_subtitulos.py entrada.srt salida.ass                       # lienzo 9:16
    python3 plogy_subtitulos.py entrada.srt salida.ass --formato 16:9 --y 0.85
    python3 plogy_subtitulos.py entrada.srt salida.ass --tamano 64 --y 0.7
    ffmpeg -i video.mp4 -vf "ass=salida.ass" -c:a copy video-subtitulado.mp4

--x / --y: centro de la caja en fracción del ancho / alto (0 a 1).

Solo usa la biblioteca estándar de Python 3.
"""
import argparse
import json
import os
import re
import sys

AQUI = os.path.dirname(os.path.abspath(__file__))

# Fijo (ver index.html, sección Subtítulos)
RELLENO_EM = 0.5                # relleno de la caja = 0,5 em por los cuatro lados -> alto de la caja = 2 em
TRACKING = -10                  # espaciado entre letras: -0,01 em (unidades de 1/1000 em)
CAJA_ALFA = 0.85                # negro al 85 %: transparencia sutil
MAX_ANCHO = 0.86                # la caja no pasa del 86 % del ancho del lienzo: siempre una línea

# Libre: puntos de partida que se cambian con --tamano, --x y --y
TAMANO_REL = 70 / 1080          # tamaño por defecto = 6,48 % del lado corto (70 px en 1080)
LIENZOS = {
    # nombre: (ancho, alto, centro vertical por defecto en fracción del alto)
    '9:16': (1080, 1920, 0.60),
    '4:5': (1080, 1350, 0.75),
    '1:1': (1080, 1080, 0.75),
    '16:9': (1920, 1080, 0.80),
}


def cargar_fuente():
    with open(os.path.join(AQUI, 'plogy-display-contornos.json'), encoding='utf-8') as fh:
        return json.load(fh)


def leer_srt(ruta):
    texto = open(ruta, encoding='utf-8-sig').read().replace('\r\n', '\n')
    patron = re.compile(r'(\d+):(\d+):(\d+)[,.](\d+)\s*-->\s*(\d+):(\d+):(\d+)[,.](\d+)')
    cues = []
    for bloque in re.split(r'\n\s*\n', texto.strip()):
        lineas = bloque.strip().split('\n')
        for i, linea in enumerate(lineas):
            m = patron.search(linea)
            if m:
                g = [int(x) for x in m.groups()]
                ini = g[0] * 3600 + g[1] * 60 + g[2] + g[3] / 1000
                fin = g[4] * 3600 + g[5] * 60 + g[6] + g[7] / 1000
                cuerpo = ' '.join(lineas[i + 1:])
                cues.append((ini, fin, re.sub(r'<[^>]+>|\{[^}]*\}', '', cuerpo)))
                break
    return cues


def normalizar(texto, fuente, avisos):
    t = re.sub(r'\s+', ' ', texto).strip().upper()
    t = re.sub(r'[.,;:]+$', '', t)            # sin punto final
    limpio = ''.join(c for c in t if c in fuente['chars'])
    faltan = sorted(set(t) - set(limpio))
    if faltan:
        avisos.append(f'caracteres sin glifo omitidos: {"".join(faltan)!r} en {t!r}')
    return limpio


def ancho(texto, fuente):
    ch, kern = fuente['chars'], fuente['kern']
    total = sum(ch[c]['adv'] for c in texto)
    total += sum(kern.get(a + b, 0) + TRACKING for a, b in zip(texto, texto[1:]))
    return total


def partir(texto, fuente, max_unidades):
    """Reparte en el mínimo de tarjetas de una sola línea y equilibra su ancho."""
    palabras = texto.split(' ')
    n = len(palabras)
    w = {(i, j): ancho(' '.join(palabras[i:j]), fuente) for i in range(n) for j in range(i + 1, n + 1)}
    for k in range(1, n + 1):
        # mejor[j] = (ancho máximo, cortes) para las primeras j palabras en k tarjetas
        mejor = {0: (0, [])}
        for _ in range(k):
            sig = {}
            for i, (m, cortes) in mejor.items():
                for j in range(i + 1, n + 1):
                    if w[(i, j)] > max_unidades and j - i > 1:
                        break
                    cand = (max(m, w[(i, j)]), cortes + [j])
                    if j not in sig or cand[0] < sig[j][0]:
                        sig[j] = cand
            mejor = sig
        if n in mejor and (mejor[n][0] <= max_unidades or k == n):
            cortes = [0] + mejor[n][1]
            return [' '.join(palabras[a:b]) for a, b in zip(cortes, cortes[1:])]
    return [texto]


def tiempo_ass(s):
    cs = int(round(s * 100))
    return f'{cs // 360000}:{cs // 6000 % 60:02d}:{cs // 100 % 60:02d}.{cs % 100:02d}'


def dibujo(contornos):
    # \p3 -> 1 unidad de dibujo = 1/4 px
    return ' '.join('m ' + ' '.join(f'{round(x * 4)} {round(y * 4)}' if j != 1 else f'l {round(x * 4)} {round(y * 4)}'
                                    for j, (x, y) in enumerate(c)) for c in contornos)


def tarjeta(texto, fuente, W, H, em, cx, cy):
    k = em / fuente['upm']
    pad = RELLENO_EM * em
    tw = ancho(texto, fuente) * k
    bw, bh = tw + 2 * pad, em + 2 * pad
    x0, y0 = W * cx - bw / 2, H * cy - bh / 2
    caja = [[(x0, y0), (x0 + bw, y0), (x0 + bw, y0 + bh), (x0, y0 + bh)]]
    base = y0 + pad + fuente['asc'] * k
    x = x0 + pad
    letras = []
    for i, c in enumerate(texto):
        g = fuente['chars'][c]
        for cont in g['c']:
            letras.append([(x + px * k, base - py * k) for px, py in cont])
        x += (g['adv'] + (fuente['kern'].get(c + texto[i + 1], 0) + TRACKING if i + 1 < len(texto) else 0)) * k
    return dibujo(caja), dibujo(letras)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('srt')
    ap.add_argument('ass')
    ap.add_argument('--formato', choices=sorted(LIENZOS), default='9:16', help='lienzo del video')
    ap.add_argument('--tamano', type=float, help='tamaño de la letra en px (por defecto 6,48 %% del lado corto)')
    ap.add_argument('--x', type=float, default=0.5, help='centro horizontal de la caja, fracción del ancho')
    ap.add_argument('--y', type=float, help='centro vertical de la caja, fracción del alto')
    a = ap.parse_args()

    fuente = cargar_fuente()
    W, H, y_def = LIENZOS[a.formato]
    em = a.tamano or min(W, H) * TAMANO_REL
    cy = a.y if a.y is not None else y_def
    max_unidades = (W * MAX_ANCHO - 2 * RELLENO_EM * em) / em * fuente['upm']
    alfa = round((1 - CAJA_ALFA) * 255)
    avisos, eventos = [], []
    for ini, fin, crudo in leer_srt(a.srt):
        texto = normalizar(crudo, fuente, avisos)
        if not texto:
            continue
        partes = partir(texto, fuente, max_unidades)
        if len(partes) > 1:
            avisos.append(f'{texto!r} no cabe en una línea: se reparte en {len(partes)} tarjetas')
        total = sum(len(p) for p in partes)
        t = ini
        for p in partes:
            d = (fin - ini) * len(p) / total
            caja, letras = tarjeta(p, fuente, W, H, em, a.x, cy)
            eventos.append(f'Comment: 1,{tiempo_ass(t)},{tiempo_ass(t + d)},PlogyTexto,,0,0,0,,{p}')
            eventos.append(f'Dialogue: 0,{tiempo_ass(t)},{tiempo_ass(t + d)},PlogyCaja,,0,0,0,,{{\\an7\\pos(0,0)\\p3}}{caja}')
            eventos.append(f'Dialogue: 1,{tiempo_ass(t)},{tiempo_ass(t + d)},PlogyTexto,,0,0,0,,{{\\an7\\pos(0,0)\\p3}}{letras}')
            t += d

    cabecera = f"""[Script Info]
; Plogy · subtítulos — generado con plogy_subtitulos.py ({fuente['font']}). Letra {round(em)} px, caja en x={a.x} y={cy}.
; Editar el .srt y volver a generar; no cambiar colores ni proporciones a mano.
ScriptType: v4.00+
PlayResX: {W}
PlayResY: {H}
WrapStyle: 2
ScaledBorderAndShadow: yes
YCbCr Matrix: None

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: PlogyCaja,Arial,20,&H{alfa:02X}000000,&H{alfa:02X}000000,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1
Style: PlogyTexto,Arial,20,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
    with open(a.ass, 'w', encoding='utf-8') as fh:
        fh.write(cabecera + '\n'.join(eventos) + '\n')
    for av in avisos:
        print('aviso:', av, file=sys.stderr)
    print(f'{len(eventos) // 3} tarjetas · {W}x{H} · letra {round(em)} px · caja en x={a.x} y={cy} · {a.ass}')


if __name__ == '__main__':
    main()
