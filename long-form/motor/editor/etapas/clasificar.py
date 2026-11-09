"""Etapa 2 · Clasificar: que tipo de grabacion es (tipos.py), con la evidencia que lo sostiene.

1. Partes sucesivas. Los videos que no suenan a la vez (su audio no coincide en ningun momento) son partes de
   una misma grabacion: se unen en orden (fecha de grabacion o, si no la hay, el nombre: C0001, C0002...) y desde
   ahi cuentan como una sola pista. Si hay varias camaras grabadas por partes, se une cada camara por su lado.
2. Señales medibles por pista, en 16 cuadros repartidos por toda la grabacion:
   - caras (OpenCV) y cuantas a la vez;
   - el borde celeste con que Meet resalta a quien habla y el fondo gris de Meet;
   - cuanto del cuadro es plano (pantallas y laminas son planas; una camara siempre tiene grano);
   - si el PDF subido coincide con lo que se ve;
   - cambios de plano por minuto (un video ya editado corta cada pocos segundos).
3. Reglas, en orden. Claude con vision solo desempata cuando las reglas no dan una respuesta clara, y solo
   entre los tipos que las reglas dejaron en pie.

Si la persona corrigio el tipo en la revision (spec.tipo_forzado), se respeta; las señales igual se guardan.
"""
import re
import subprocess
from pathlib import Path

import numpy as np

from .. import config, ffm, ia, tipos

N_MUESTRAS = 16
ANCHO = 960
SOLAPE_MIN = 0.3          # fraccion de ventanas en que dos audios coinciden para decir que suenan a la vez


# ---------------------------------------------------------------- partes sucesivas
def solape(maestro, otro, sr=16000):
    """Que fraccion del tramo en comun de dos audios coincide (mismo momento grabado), y el desfase."""
    from .camaras import _env, _xcorr
    hop = 16
    rate = sr / hop
    ea, eb = _env(otro, hop), _env(maestro, hop)
    if len(ea) < rate * 15 or len(eb) < rate * 15:
        return 0.0, 0.0
    off0, _ = _xcorr(ea, eb, rate)
    win, paso, marg = 12.0, 12.0, 1.5
    total = buenas = 0
    tb = 0.0
    while tb + win <= len(eb) / rate:
        ta = tb + off0
        if ta - marg >= 0 and (ta + win + marg) * rate <= len(ea):
            w = eb[int(tb * rate):int((tb + win) * rate)]
            s0 = int((ta - marg) * rate)
            seg = ea[s0:s0 + len(w) + int(2 * marg * rate)]
            if w.std() > 0 and seg.std() > 0:
                total += 1
                w2 = (w - w.mean()) / w.std()
                s2 = (seg - seg.mean()) / seg.std()
                from scipy.signal import fftconvolve
                c = fftconvolve(s2, w2[::-1], mode='valid') / len(w)
                if c.max() > 0.4:
                    buenas += 1
        tb += paso
    return (buenas / total if total else 0.0), float(off0)


def _orden(f):
    """Orden de grabacion: la fecha del archivo si todas la tienen; si no, el nombre en orden natural."""
    return [int(x) if x.isdigit() else x.lower() for x in re.split(r'(\d+)', f.get('nombre') or '')]


def _firma(f):
    return (f['ancho'], f['alto'], round(f.get('fps') or 0))


def grupos_de_partes(fuentes, pares):
    """Decide que unir. `pares`: {(i, j): fraccion de solape}. Devuelve (grupos, aviso): cada grupo es la
    lista de indices de una pista, en orden. Funcion pura: la prueba la llama con datos inventados."""
    n = len(fuentes)
    if n < 2:
        return [[0]] if n else [], None
    # Un video sin audio no se puede comparar: es una pista mas que corre a la vez (una pantalla grabada aparte).
    mudos = [i for i in range(n) if not fuentes[i].get('audio')]
    if mudos:
        con = [i for i in range(n) if i not in mudos]
        sub = [fuentes[i] for i in con]
        subpares = {(con.index(i), con.index(j)): v for (i, j), v in pares.items() if i in con and j in con}
        gs, aviso = grupos_de_partes(sub, subpares)
        return [[con[k] for k in g] for g in gs] + [[i] for i in mudos], aviso
    # componentes de "suenan a la vez"
    padre = list(range(n))

    def raiz(i):
        while padre[i] != i:
            padre[i] = padre[padre[i]]
            i = padre[i]
        return i
    for (i, j), fr in pares.items():
        if fr >= SOLAPE_MIN:
            padre[raiz(i)] = raiz(j)
    comps = {}
    for i in range(n):
        comps.setdefault(raiz(i), []).append(i)
    comps = list(comps.values())
    if len(comps) == 1:
        return [[i] for i in range(n)], None            # todo suena a la vez: camaras, nada que unir
    todas_con_fecha = all(f.get('creado') for f in fuentes)

    def clave_orden(i):
        return (fuentes[i]['creado'],) if todas_con_fecha else (_orden(fuentes[i]),)
    comps.sort(key=lambda c: min(clave_orden(i) for i in c))
    if all(len(c) == 1 for c in comps):
        return [[c[0] for c in comps]], None             # una sola camara grabada por partes
    # varias camaras por partes: cada tramo tiene las mismas camaras (misma resolucion y cuadros por segundo)
    tam = {len(c) for c in comps}
    firmas = [sorted(_firma(fuentes[i]) for i in c) for c in comps]
    unicas = all(len(set(fs)) == len(fs) for fs in firmas)
    if len(tam) == 1 and unicas and all(fs == firmas[0] for fs in firmas):
        pistas = []
        for fm in firmas[0]:
            pistas.append([next(i for i in c if _firma(fuentes[i]) == fm) for c in comps])
        return pistas, None
    return [[i] for i in range(n)], ('Hay videos que no suenan a la vez y no se pudo saber de qué cámara es cada parte: '
                                     'se tratan por separado. Si son partes de una misma grabación, súbelas con nombres en orden.')


def unir(ctx, partes, clave):
    """Una pista hecha de partes: el video unido (sin recodificar si las partes son iguales) y su audio, parte
    tras parte con la duracion exacta de cada video para que no se corra la sincronia."""
    import os
    out = ctx.tj(f'unido_{clave}.mp4')
    if not out.exists():
        iguales = len({(p['codec'], p['ancho'], p['alto'], round(p['fps'], 2), p.get('pix_fmt'), p['rotacion']) for p in partes}) == 1
        tmp = out.with_suffix('.tmp.mp4')
        if iguales:
            ffm.correr(['-f', 'concat', '-safe', '0', '-i', _lista(ctx, partes, clave), '-map', '0:v:0', '-c', 'copy', tmp])
        else:
            W, H = partes[0]['ancho'], partes[0]['alto']
            norm = []
            for k, p in enumerate(partes):
                q = ctx.tj(f'unido_{clave}_{k}.mp4')
                if not q.exists():
                    ffm.correr(['-i', p['archivo'], '-an', '-vf', f'scale={W}:{H}:force_original_aspect_ratio=decrease,'
                                f'pad={W}:{H}:(ow-iw)/2:(oh-ih)/2,fps=30', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '17', q])
                norm.append({'archivo': str(q)})
            ffm.correr(['-f', 'concat', '-safe', '0', '-i', _lista(ctx, norm, clave), '-c', 'copy', tmp])
        os.replace(tmp, out)
    for sr in (16, 48):
        trozos = []
        for p in partes:
            orig = ctx.tj(f'a{sr}_{p["clave"]}_parte.wav')
            plano = ctx.tj(f'a{sr}_{p["clave"]}.wav')
            # el audio de la primera parte se va a reemplazar por el unido: se guarda aparte una sola vez
            if p['clave'] == clave and plano.exists() and not orig.exists():
                os.replace(plano, orig)
            fuente = orig if orig.exists() else plano
            n = int(round(p['duracion'] * sr * 1000))
            if p.get('audio') and fuente.exists():
                _, x = ffm.leer_wav(fuente)
                x = np.asarray(x[:n], np.float32)
                trozos.append(np.pad(x, (0, n - len(x))))
            else:
                trozos.append(np.zeros(n, np.float32))
        ffm.escribir_wav(ctx.tj(f'a{sr}_{clave}.wav'), sr * 1000, np.concatenate(trozos))
    base = dict(partes[0])
    base.update({'archivo': str(out), 'duracion': round(sum(p['duracion'] for p in partes), 3),
                 'nombre': ' + '.join(p.get('nombre') or p['clave'] for p in partes),
                 'partes': [p.get('nombre') or p['clave'] for p in partes], 'audio': any(p.get('audio') for p in partes)})
    return base


def _lista(ctx, partes, clave):
    lst = ctx.tj(f'unido_{clave}.txt')
    lst.write_text(''.join(f"file '{Path(p['archivo']).resolve().as_posix()}'\n" for p in partes), encoding='utf8')
    return lst


# ---------------------------------------------------------------- señales
def cortes_por_minuto(ruta, dur):
    """Cambios de plano por minuto en tres ventanas de un minuto (o todo el video si es corto)."""
    if dur <= 200:
        ventanas = [(0.0, dur)]
    else:
        ventanas = [(dur * f - 30, 60.0) for f in (0.25, 0.5, 0.75)]
    total = cortes = 0.0
    for a, w in ventanas:
        r = subprocess.run([config.FFMPEG, '-hide_banner', '-nostdin', '-loglevel', 'info', '-ss', f'{max(a, 0):.2f}', '-t', f'{w:.2f}',
                            '-i', str(ruta), '-an', '-vf', "scale=160:-2,select='gt(scene\\,0.4)',showinfo", '-f', 'null', '-'],
                           capture_output=True, text=True)
        cortes += len(re.findall(r'pts_time:', r.stderr))
        total += w
    return cortes / max(total / 60, 1e-6)


def fondo_meet(im):
    """Fraccion del cuadro con el gris oscuro de la interfaz de Meet (#202124)."""
    ref = np.array([36, 33, 32], np.int16)          # BGR
    return float((np.abs(im.astype(np.int16) - ref).max(2) <= 8).mean())


def planitud(gris):
    """Fraccion del cuadro sin textura: una pantalla o una lamina tienen grandes zonas lisas; una camara, grano."""
    import cv2
    g = gris.astype(np.float32)
    m = cv2.blur(g, (5, 5))
    var = cv2.blur((g - m) ** 2, (5, 5))
    return float((var < 2.0).mean())


def senales(ctx, f, laminas=None):
    """Lo que se mide de una pista. Devuelve el resumen y los cuadros (para el desempate)."""
    import cv2

    from .meet import caja_azul
    det = cv2.CascadeClassifier(cv2.data.haarcascades + 'haarcascade_frontalface_default.xml')
    dur = f['duracion']
    caras, maxc, borde, fondo, plano, lam = [], [], [], [], [], []
    vistos = []
    for t in np.linspace(dur * 0.06, dur * 0.94, N_MUESTRAS):
        im = ffm.cuadro(f['archivo'], t, ANCHO)
        if im is None:
            continue
        vistos.append((t, im))
        gris = cv2.cvtColor(im, cv2.COLOR_BGR2GRAY)
        fs = det.detectMultiScale(gris, 1.1, 5, minSize=(ANCHO // 28, ANCHO // 28))
        caras.append(len(fs) > 0)
        maxc.append(len(fs))
        borde.append(caja_azul(im) is not None)
        fondo.append(fondo_meet(im))
        plano.append(planitud(gris))
        # buscar laminas es lo caro (todas las paginas a varios tamaños): en la mitad de los cuadros, y con cinco
        # coincidencias ya hay evidencia de sobra
        if laminas is not None and len(vistos) % 2 == 1 and sum(lam) < 5:
            pag, _ = laminas.buscar(gris)
            lam.append(pag is not None)
    n = max(len(vistos), 1)
    s = {
        'cuadros': len(vistos),
        'caras': round(sum(caras) / n, 2),
        'personas': int(np.percentile(maxc, 75)) if maxc else 0,
        'borde_meet': round(sum(borde) / n, 2),
        'fondo_meet': round(float(np.mean(fondo)) if fondo else 0.0, 2),
        'plano': round(float(np.mean(plano)) if plano else 0.0, 2),
        # fraccion de los cuadros mirados; si se paro en cinco, la de los mirados hasta ahi
        'laminas': round(sum(lam) / max(len(lam), 1), 2) if laminas is not None else None,
        'cortes_min': round(cortes_por_minuto(f['archivo'], dur), 2),
        'audio': bool(f.get('audio')),
    }
    return s, vistos


# ---------------------------------------------------------------- decision
def es_contenido(s):
    return (s['caras'] < 0.3 and s['plano'] >= 0.45) or (s.get('laminas') or 0) >= 0.25


def es_meet(s):
    return s['borde_meet'] >= 0.15 or s['fondo_meet'] >= 0.3


def decidir(pistas, hay_pdf):
    """Reglas en orden. `pistas`: [(clave, señales)] de las pistas que suenan a la vez. Devuelve tipo, confianza
    ('alta' | 'media' | 'baja'), razones (en palabras), candidatos (para el desempate) y roles."""
    r = []
    if len(pistas) == 1:
        k, s = pistas[0]
        n = s['cuadros'] or 1
        if es_meet(s):
            vistas = []
            if s['borde_meet'] >= 0.15:
                vistas.append(f'el borde con que Meet marca a quien habla en {round(s["borde_meet"] * n)} de {n} cuadros')
            if s['fondo_meet'] >= 0.3:
                vistas.append(f'su fondo gris en el {s["fondo_meet"]:.0%} de la imagen')
            r.append(f'Se ve la interfaz de Meet: {" y ".join(vistas)}.')
            alta = s['borde_meet'] >= 0.3 or (s['borde_meet'] >= 0.15 and s['fondo_meet'] >= 0.3)
            return 'meet', 'alta' if alta else 'media', r, ['meet'], {'contenido': k}
        if hay_pdf and (s.get('laminas') or 0) >= 0.25:
            r.append(f'El PDF coincide con lo que se ve en el {s["laminas"]:.0%} de los cuadros revisados.')
            cam = k if s['caras'] >= 0.3 else None
            if cam:
                r.append('También se ve a la persona: va en un recuadro junto a la lámina.')
            return 'charla', 'alta' if s['laminas'] >= 0.5 else 'media', r, ['charla'], {'contenido': k, 'camara': cam}
        if s['cortes_min'] >= 2.0:
            r.append(f'{s["cortes_min"]:.1f} cambios de plano por minuto: ya viene editado, se respetan sus cortes.')
            return 'podcast', 'alta' if s['cortes_min'] >= 3.5 else 'media', r, ['podcast', 'una_camara'], {'contenido': k}
        if s['caras'] >= 0.4:
            r.append(f'Hay caras en {round(s["caras"] * n)} de {n} cuadros, sin cortes de edición: una sola cámara'
                     + (f' con {s["personas"]} personas.' if s['personas'] > 1 else '.'))
            conf = 'alta' if s['caras'] >= 0.6 and s['cortes_min'] < 1.0 else 'media'
            return 'una_camara', conf, r, ['una_camara', 'podcast'], {'camara': k}
        if s['plano'] >= 0.45 and s['caras'] < 0.3:
            r.append(f'El {s["plano"]:.0%} de la imagen es plano y casi no hay caras: es una pantalla.')
            return 'pantalla', 'alta' if s['plano'] >= 0.6 else 'media', r, ['pantalla'], {'contenido': k}
        r.append(f'Señales poco claras: caras en el {s["caras"]:.0%} de los cuadros, imagen plana en el {s["plano"]:.0%}, '
                 f'{s["cortes_min"]:.1f} cortes por minuto.')
        return 'una_camara', 'baja', r, ['una_camara', 'pantalla', 'podcast'], {'camara': k}

    contenido = [(k, s) for k, s in pistas if es_contenido(s)]
    camaras = sorted([(k, s) for k, s in pistas if not es_contenido(s)], key=lambda x: -x[1]['caras'])
    r.append(f'{len(pistas)} videos suenan a la vez: son la misma grabación desde varios lados.')
    if contenido and camaras:
        kc, sc = contenido[0]
        cam = camaras[0][0]
        lam = (sc.get('laminas') or 0) >= 0.25
        tipo = 'charla' if (hay_pdf or lam) else 'pantalla'
        r.append(f'El video {kc} muestra {"las láminas" if tipo == "charla" else "una pantalla"} '
                 f'(imagen plana en el {sc["plano"]:.0%}, caras en el {sc["caras"]:.0%}) y el {cam} a la persona.')
        if len(contenido) > 1 or len(camaras) > 1:
            r.append(f'Hay más videos de los que este tipo usa: se toman {kc} y {cam}.')
        return tipo, 'alta' if (lam or not hay_pdf) else 'media', r, [tipo, 'camaras'], {'contenido': kc, 'camara': cam}
    if contenido and not camaras:
        kc = contenido[0][0]
        r.append(f'Ningún video muestra caras: se usa la pantalla del video {kc}.')
        return 'pantalla', 'media', r, ['pantalla'], {'contenido': kc}
    caras = [s['caras'] for _, s in pistas]
    r.append('Cada video muestra a una persona: se edita como un talk show, cambiando de cámara según quién habla.')
    return 'camaras', 'alta' if min(caras) >= 0.4 else 'media', r, ['camaras'], {}


def desempatar(ctx, candidatos, vistos, s):
    """Claude con vision elige entre los candidatos que dejaron las reglas. Si no hay clave, queda la regla."""
    import cv2
    bloques = [{'type': 'text', 'text': 'Cuadros de una grabación (repartidos de principio a fin). Elige qué tipo de '
                                        f'grabación es entre: {", ".join(f"{c} ({tipos.NOMBRES[c]})" for c in candidatos)}. '
                                        f'Señales medidas: {s}.'}]
    for i, (t, im) in enumerate(vistos[::max(1, len(vistos) // 4)][:4]):
        p = ctx.tj(f'_clasificar_{i}.jpg')
        cv2.imwrite(str(p), cv2.resize(im, (640, int(im.shape[0] * 640 / im.shape[1]))), [cv2.IMWRITE_JPEG_QUALITY, 80])
        bloques += [{'type': 'text', 'text': f'Minuto {t / 60:.1f}:'}, ia.imagen(p)]
    esquema = {'type': 'object', 'required': ['tipo', 'porque'], 'properties': {
        'tipo': {'type': 'string', 'enum': list(candidatos)}, 'porque': {'type': 'string'}}}
    r = ia.pedir_json('Clasificas grabaciones de video para editarlas. Responde solo con lo que se ve en los cuadros.',
                      bloques, esquema, 'clasificar', max_tokens=400)
    return r['tipo'], r['porque']


# ---------------------------------------------------------------- etapa
def correr(ctx):
    ing, = ctx.necesita('ingesta')
    fuentes = ing['fuentes']
    ctx.avance('Viendo si los videos suenan a la vez', .05)
    auds = {}
    for f in fuentes:
        if f.get('audio'):
            orig = ctx.tj(f'a16_{f["clave"]}_parte.wav')
            _, x = ffm.leer_wav(orig if orig.exists() else ctx.tj(f'a16_{f["clave"]}.wav'))
            auds[f['clave']] = np.asarray(x, np.float32)
    pares = {}
    for i in range(len(fuentes)):
        for j in range(i + 1, len(fuentes)):
            a, b = fuentes[i]['clave'], fuentes[j]['clave']
            if a in auds and b in auds:
                pares[(i, j)] = solape(auds[a], auds[b])[0]
    if pares:
        ctx.log('solape de audio: ' + ', '.join(f'{fuentes[i]["clave"]}-{fuentes[j]["clave"]} {v:.0%}' for (i, j), v in pares.items()))
    grupos, aviso = grupos_de_partes(fuentes, pares)
    if aviso:
        ctx.aviso(aviso)
    pistas, partes = [], []
    for g in grupos:
        if len(g) == 1:
            pistas.append(dict(fuentes[g[0]]))
            continue
        ctx.avance(f'Uniendo {len(g)} partes', .15)
        p = unir(ctx, [fuentes[i] for i in g], fuentes[g[0]]['clave'])
        pistas.append(p)
        partes.append(p['partes'])
        ctx.log(f'partes sucesivas unidas en orden: {" → ".join(p["partes"])}')

    lam = None
    if ing.get('laminas'):
        from .meet import Laminas
        lam_rutas = sorted(ctx.tj('pdf').glob('p*.png'))
        lam = Laminas(lam_rutas) if lam_rutas else None
    sen, vistos = {}, {}
    for i, f in enumerate(pistas):
        ctx.avance(f'Mirando el video {f["clave"]}', .3 + .55 * i / len(pistas))
        if lam is not None:
            lam.cur = None
        sen[f['clave']], vistos[f['clave']] = senales(ctx, f, lam)
        ctx.log(f'{f["clave"]}: {sen[f["clave"]]}')

    tipo, confianza, razones, candidatos, roles = decidir([(f['clave'], sen[f['clave']]) for f in pistas], bool(ing.get('laminas')))
    if partes:
        razones.insert(0, 'Hay videos que no suenan a la vez: son partes de una misma grabación y se unieron en orden ('
                       + '; '.join(' → '.join(p) for p in partes) + ').')
    por_ia = False
    forzado = ctx.spec.get('tipo_forzado')
    if forzado:
        razones.append(f'Elegiste «{tipos.NOMBRES.get(forzado, forzado)}» al revisar: se usa ese tipo.')
        tipo, confianza = forzado, 'alta'
    elif confianza == 'baja' and len(candidatos) > 1 and not ctx.reconstruyendo:
        try:
            k = pistas[0]['clave']
            elegido, porque = desempatar(ctx, candidatos, vistos[k], sen[k])
            if elegido in candidatos:
                tipo, por_ia = elegido, True
                razones.append(f'La IA miró los cuadros y eligió «{tipos.NOMBRES[elegido]}»: {porque}')
        except ia.SinIA:
            razones.append('Sin clave de Claude para desempatar: se usa la regla. Si no es este tipo, cámbialo al revisar.')
    if tipo in ('charla', 'pantalla') and not roles.get('contenido'):
        roles['contenido'] = pistas[0]['clave']
    if tipo in ('charla', 'pantalla') and 'camara' not in roles:
        otra = next((f['clave'] for f in pistas if f['clave'] != roles['contenido']), None)
        roles['camara'] = otra or (roles['contenido'] if sen[roles['contenido']]['caras'] >= 0.3 else None)

    cl = {'tipo': tipo, 'nombre': tipos.NOMBRES[tipo], 'confianza': confianza, 'razones': razones, 'candidatos': candidatos,
          'senales': sen, 'roles': roles, 'partes': partes, 'por_ia': por_ia, 'forzado': bool(forzado), 'pistas': pistas}
    ctx.guardar('clasificacion', cl)
    ctx.log(f'tipo: {tipo} (confianza {confianza}{", desempate de la IA" if por_ia else ""})')
    if not ctx.reconstruyendo:
        ctx.alm.actualizar_proyecto(ctx.pid, {'tipo': tipo, 'evidencia': {k: v for k, v in cl.items() if k != 'pistas'},
                                              'duracion_s': round(max(p['duracion'] for p in pistas), 1)})
