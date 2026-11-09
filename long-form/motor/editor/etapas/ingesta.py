"""Etapa 1 · Ingesta: trae los archivos, los mide y saca lo que las demas etapas analizan.

Nunca se toca el original: todo sale a la carpeta de trabajo.
- Audio a 16 kHz mono (sincronia, quien habla, transcripcion) y a 48 kHz (la mezcla final).
- Meet: cuadros clave cada 2 s a 1440 de ancho (borde de quien habla, laminas, pantalla compartida).
- PDF: cada lamina a PNG; en pantalla se usa la lamina original, no la captura, para que se lea perfecta.
"""
from .. import ffm

KF_PASO = 2.0
KF_ANCHO = 1440


def correr(ctx):
    fuentes = ctx.archivos('fuente')
    if not fuentes:
        raise RuntimeError('El proyecto no tiene videos de entrada')
    if ctx.tipo == 'camaras' and len(fuentes) < 2:
        raise RuntimeError('Cámaras separadas necesita al menos dos videos (uno por cámara)')
    info = []
    for i, f in enumerate(fuentes):
        ctx.avance(f'Trayendo {f.get("nombre", "video")}', i / max(len(fuentes), 1) * .4)
        ruta = ctx.local(f)
        m = ffm.sondear(ruta)
        if not m['video']:
            raise RuntimeError(f'{f.get("nombre")} no tiene pista de video')
        if not m['audio']:
            raise RuntimeError(f'{f.get("nombre")} no tiene audio: sin audio no se puede saber quién habla')
        clave = f.get('rol') or 'ABCDEFGH'[i]
        ffm.extraer_audio(ruta, ctx.tj(f'a16_{clave}.wav'), 16000, 1)
        ffm.extraer_audio(ruta, ctx.tj(f'a48_{clave}.wav'), 48000, 1)
        vfr = abs(m['fps'] - m['fps_nominal']) > 0.5 if m['fps_nominal'] else False
        info.append({'clave': clave, 'archivo': str(ruta), 'nombre': f.get('nombre'), 'persona': f.get('persona'), **m, 'vfr': vfr})
        ctx.log(f'{clave}: {m["ancho"]}x{m["alto"]} · {m["fps"]:.2f} fps{" variables" if vfr else ""} · '
                f'{m["duracion"] / 60:.1f} min · rotación {m["rotacion"]}')
        if m['rotacion'] and abs(m['rotacion']) % 180 == 90:
            ctx.aviso(f'El video {clave} se grabó en vertical (rotado {m["rotacion"]}°): revisa el encuadre de sus planos.')

    if ctx.tipo == 'meet':
        f = info[0]
        kf = ctx.tj('kf')
        kf.mkdir(exist_ok=True)
        if not any(kf.glob('*.jpg')):
            ctx.avance('Sacando cuadros clave cada 2 s', .5)
            ancho = min(KF_ANCHO, f['ancho'])
            ffm.correr(['-i', f['archivo'], '-vf', f'fps={1 / KF_PASO},scale={ancho}:-2:flags=area', '-q:v', '3',
                        str(kf / '%05d.jpg')])
        n = len(list(kf.glob('*.jpg')))
        f['kf'] = {'paso': KF_PASO, 'n': n, 'escala': f['ancho'] / min(KF_ANCHO, f['ancho'])}
        ctx.log(f'{n} cuadros clave')

    pdfs = ctx.archivos('pdf')
    laminas = []
    if pdfs:
        import pymupdf
        d = ctx.tj('pdf')
        d.mkdir(exist_ok=True)
        doc = pymupdf.open(ctx.local(pdfs[0]))
        for i, pag in enumerate(doc, 1):
            p = d / f'p{i:03d}.png'
            if not p.exists():
                k = 1920 / pag.rect.width
                pag.get_pixmap(matrix=pymupdf.Matrix(k, k), alpha=False).save(str(p))
            laminas.append(str(p))
        ctx.log(f'PDF: {len(laminas)} láminas')

    for a in ctx.archivos('ilustracion') + ctx.archivos('foto') + ctx.archivos('musica'):
        ctx.local(a)

    ctx.guardar('ingesta', {'fuentes': info, 'laminas': len(laminas)})
    if not ctx.reconstruyendo:
        # La miniatura del tablero y la duracion: un cuadro de la primera fuente.
        f = info[0]
        mini = ctx.salida / 'miniatura.jpg'
        ctx.salida.mkdir(exist_ok=True)
        ffm.correr(['-ss', f'{f["duracion"] * 0.2:.1f}', '-i', f['archivo'], '-frames:v', '1', '-vf', 'scale=640:-2', '-q:v', '4', mini])
        ruta = ctx.alm.subir(ctx.pid, mini, 'miniatura.jpg', 'image/jpeg', clase='miniatura')
        ctx.alm.actualizar_proyecto(ctx.pid, {'miniatura': ruta, 'duracion_s': round(max(x['duracion'] for x in info), 1)})
    ctx.avance('Listo', 1)
