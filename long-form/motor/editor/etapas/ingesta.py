"""Etapa 1 · Ingesta: trae los archivos, los mide y saca lo que las demas etapas analizan.

Nunca se toca el original: todo sale a la carpeta de trabajo. Todavia no se sabe el tipo de grabacion (lo
decide `clasificar`), asi que aqui no se hace nada que dependa de el.
- Audio a 16 kHz mono (sincronia, quien habla, transcripcion) y a 48 kHz (la mezcla final), por fuente.
- Audio aparte (si se subio): igual, con la clave 'S'. Reemplaza al de camara en el programa.
- PDF: cada lamina a PNG; en pantalla se usa la lamina original, no la captura, para que se lea perfecta.
"""
from .. import ffm

# Una letra por video de entrada. Sin 'S' (audio aparte) ni 'X' (tercera voz): son claves reservadas.
# Studio usa la misma lista en src/app/long-form/actions.ts (CLAVES_FUENTE).
CLAVES = 'ABCDEFGHIJKLMNOPQRTUVWYZ'


def claves_de(fuentes):
    """La clave de cada video: la que trae de Studio (`rol`) o la primera letra libre, sin repetir."""
    if len(fuentes) > len(CLAVES):
        raise RuntimeError(f'Como mucho {len(CLAVES)} videos por proyecto; llegaron {len(fuentes)}')
    usadas = {f['rol'] for f in fuentes if f.get('rol')}
    libres = iter(k for k in CLAVES if k not in usadas)
    return [f.get('rol') or next(libres) for f in fuentes]


def correr(ctx):
    fuentes = ctx.archivos('fuente')
    if not fuentes:
        raise RuntimeError('El proyecto no tiene videos de entrada')
    info = []
    for i, (f, clave) in enumerate(zip(fuentes, claves_de(fuentes))):
        ctx.avance(f'Trayendo {f.get("nombre", "video")}', i / max(len(fuentes), 1) * .4)
        ruta = ctx.local(f)
        m = ffm.sondear(ruta)
        if not m['video']:
            raise RuntimeError(f'{f.get("nombre")} no tiene pista de video')
        if m['audio']:
            ffm.extraer_audio(ruta, ctx.tj(f'a16_{clave}.wav'), 16000, 1)
            ffm.extraer_audio(ruta, ctx.tj(f'a48_{clave}.wav'), 48000, 1)
        vfr = abs(m['fps'] - m['fps_nominal']) > 0.5 if m['fps_nominal'] else False
        info.append({'clave': clave, 'archivo': str(ruta), 'nombre': f.get('nombre'), 'persona': f.get('persona'), **m, 'vfr': vfr})
        ctx.log(f'{clave}: {m["ancho"]}x{m["alto"]} · {m["fps"]:.2f} fps{" variables" if vfr else ""} · '
                f'{m["duracion"] / 60:.1f} min · rotación {m["rotacion"]}{"" if m["audio"] else " · sin audio"}')

    aparte = None
    audios = ctx.archivos('audio')
    if audios:
        ruta = ctx.local(audios[0])
        ffm.extraer_audio(ruta, ctx.tj('a16_S.wav'), 16000, 1)
        ffm.extraer_audio(ruta, ctx.tj('a48_S.wav'), 48000, 1)
        aparte = 'S'
        ctx.log(f'audio aparte: {audios[0].get("nombre")}')
        if len(audios) > 1:
            ctx.aviso('Se subió más de un audio aparte: se usa el primero.')
    if not aparte and not any(f['audio'] for f in info):
        raise RuntimeError('Ningún video tiene audio y no se subió un audio aparte: sin audio no se puede saber quién habla')

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

    ctx.guardar('ingesta', {'fuentes': info, 'laminas': len(laminas), 'audio_aparte': aparte})
    if not ctx.reconstruyendo:
        # La miniatura del tablero y la duracion: un cuadro de la primera fuente.
        f = info[0]
        mini = ctx.salida / 'miniatura.jpg'
        ctx.salida.mkdir(exist_ok=True)
        ffm.correr(['-ss', f'{f["duracion"] * 0.2:.1f}', '-i', f['archivo'], '-frames:v', '1', '-vf', 'scale=640:-2', '-q:v', '4', mini])
        ruta = ctx.alm.subir(ctx.pid, mini, 'miniatura.jpg', 'image/jpeg', clase='miniatura')
        ctx.alm.actualizar_proyecto(ctx.pid, {'miniatura': ruta, 'duracion_s': round(max(x['duracion'] for x in info), 1)})
    ctx.avance('Listo', 1)
