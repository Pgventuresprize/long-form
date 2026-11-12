"""Subtitulos quemados en el video largo (opcion `subtitulos`, ver ctx.eleccion).

Las mismas reglas y el mismo programa que los clips (subtitulos/plogy_subtitulos.py, o el de la marca si trae
uno, como en clips.ass): una linea, mayusculas, caja negra al 85 %, texto en curvas.

Tiempos: cada palabra de la transcripcion (linea maestra) pasa por el Mapa de lo que se conserva, asi que los
silencios y los cortes quitados nunca dejan una tarjeta desfasada; las palabras que caen en un corte se pierden con
el. Los tiempos son del programa (sin intro ni gancho): cada trozo del render recibe solo sus tarjetas, corridas a
su comienzo, y el gancho las suyas. Choque con los graficos: ver lienzo.py (la tarjeta sube por encima de la franja).

Se queman sobre el trozo ya hecho, en una pasada aparte por trozo (en paralelo): el trozo limpio queda en la cache
y el video sin subtitulos sirve para los clips, que ponen los suyos.
"""
import hashlib
import re

from . import ffm
from .lienzo import FRANJA

MARGEN = 0.3          # una tarjeta que pasa a menos de esto de una pieza de la franja tambien sube
PAUSA = 0.8           # un silencio mas largo cierra la tarjeta (no se queda en pantalla mientras nadie habla)


def palabras(segs, mapa, fix=lambda w: w, desde=None, hasta=None):
    """(inicio, fin, palabra) en segundos de salida del mapa (sin su intro), solo lo que se conserva."""
    out = []
    for s in segs:
        for w in s.get('palabras', []):
            if desde is not None and w['f'] <= desde:
                continue
            if hasta is not None and w['i'] >= hasta:
                continue
            ti, tf = mapa.cuadro(w['i']) / mapa.fps, mapa.cuadro(w['f']) / mapa.fps
            if tf - ti < 0.02:
                continue
            out.append((ti, tf, fix(w['p'])))
    out.sort(key=lambda w: w[0])
    return out


def ventanas_franja(piezas, fps):
    """Cuando hay una pieza en la franja inferior, en segundos del programa."""
    return sorted((p['o0'] / fps, p['o1'] / fps) for p in piezas if p.get('tipo') in FRANJA)


def repartir(cues, ventanas, margen=MARGEN):
    """(normales, altas): las tarjetas que se cruzan con una pieza de la franja van arriba, enteras."""
    normales, altas = [], []
    for c in cues:
        s, e = c[0], c[1]
        (altas if any(a - margen < e and b + margen > s for a, b in ventanas) else normales).append(c)
    return normales, altas


# ---------------------------------------------------------------- ASS por trozo
_T = re.compile(r'^(\d+):(\d\d):(\d\d)\.(\d\d)$')


def _seg(t):
    m = _T.match(t.strip())
    h, mi, s, cs = (int(x) for x in m.groups())
    return h * 3600 + mi * 60 + s + cs / 100


def _ass_t(s):
    cs = int(round(max(s, 0) * 100))
    return f'{cs // 360000}:{cs // 6000 % 60:02d}:{cs // 100 % 60:02d}.{cs % 100:02d}'


def leer_ass(texto):
    """(cabecera, eventos): la cabecera hasta el Format de [Events]; cada evento (clase, capa, ini, fin, resto)."""
    lineas = texto.splitlines()
    i = next(k for k, l in enumerate(lineas) if l.strip() == '[Events]')
    j = next(k for k in range(i, len(lineas)) if lineas[k].startswith('Format:'))
    eventos = []
    for l in lineas[j + 1:]:
        clase, _, cuerpo = l.partition(': ')
        if clase not in ('Dialogue', 'Comment'):
            continue
        capa, ini, fin, resto = cuerpo.split(',', 3)
        eventos.append((clase, capa, _seg(ini), _seg(fin), resto))
    return '\n'.join(lineas[:j + 1]) + '\n', eventos


def unir_ass(textos):
    """Varios .ass del mismo lienzo (la altura normal y la alta) en uno: la cabecera del primero."""
    cab, ev = None, []
    for t in textos:
        c, e = leer_ass(t)
        cab = cab or c
        ev += e
    return cab, sorted(ev, key=lambda x: (x[2], x[1]))


def ass_de_tramo(cabecera, eventos, t0, t1):
    """El .ass de un trozo [t0, t1) del programa, con los tiempos corridos a su comienzo; None si no tiene nada."""
    dentro = [e for e in eventos if e[2] < t1 and e[3] > t0]
    if not any(e[0] == 'Dialogue' for e in dentro):
        return None
    return cabecera + ''.join(f'{c}: {capa},{_ass_t(a - t0)},{_ass_t(min(b, t1 + 1) - t0)},{resto}\n'
                              for c, capa, a, b, resto in dentro)


# ---------------------------------------------------------------- armar y quemar
def armar(ctx, ws, ventanas, formato, y_normal, y_alta, carpeta, nombre):
    """El .ass (cabecera, eventos) de unas palabras: tarjetas normales y, las que chocan, altas."""
    from .etapas import clips
    from .lienzo import tamano_letra
    cues = clips.tarjetas(ws, PAUSA)
    normales, altas = repartir(cues, ventanas) if y_alta < y_normal else (cues, [])
    tam = tamano_letra(formato, ctx.W, ctx.H)
    textos = []
    for lista, y, suf in ((normales, y_normal, 'n'), (altas, y_alta, 'a')):
        if not lista:
            continue
        s = clips.escribir_srt(lista, carpeta / f'{nombre}_{suf}.srt')
        a = clips.ass(ctx, s, carpeta / f'{nombre}_{suf}.ass', formato, tam, y)
        textos.append(a.read_text(encoding='utf8'))
    if not textos:
        return None, [], cues
    cab, ev = unir_ass(textos)
    return cab, ev, cues


def quemar(trozo, ass_texto, n, carpeta):
    """El trozo con sus subtitulos (cache por contenido: el trozo limpio y su .ass)."""
    firma = hashlib.md5((trozo.name + ass_texto).encode('utf8')).hexdigest()[:16]
    out = carpeta / f's_{firma}.mp4'
    if out.exists() and out.stat().st_size > 1000:
        return out
    a = carpeta / f's_{firma}.ass'
    a.write_text(ass_texto, encoding='utf8')
    tmp = out.with_suffix('.tmp.mp4')
    ffm.correr(['-i', trozo, '-vf', f"ass='{ffm.ruta_filtro(a)}'", '-frames:v', str(n)] + ffm.ENC + [tmp])
    hechos = ffm.cuadros_de(tmp)
    if hechos != n:
        tmp.unlink(missing_ok=True)
        raise RuntimeError(f'Un trozo con subtítulos salió con {hechos} de {n} cuadros')
    tmp.replace(out)
    return out


def srt_publico(cues, ruta, desplazamiento=0.0):
    """El .srt del video final (con el desfase del gancho y la intro), para subirlo a YouTube si se quiere."""
    from .etapas import clips
    return clips.escribir_srt([(s + desplazamiento, e + desplazamiento, t) for s, e, t in cues], ruta)
