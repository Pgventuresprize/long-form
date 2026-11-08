"""Etapa 4 · Plan: tomas, silencios y propuesta del guion de gráficos (llega a la aprobación 2)."""
from .. import guion as G
from .. import ia, silencios
from ..contexto import Mapa

INTRO = 5.4


def personas_aprobadas(ctx):
    rep = ctx.aprobado('reparto')
    if not rep:
        raise RuntimeError('Falta el reparto aprobado')
    return rep, [p for p in rep['personas'] if p.get('nombre')]


def nombrar_segmentos(ctx, segs, rep, tomas=None):
    """Cada segmento con el nombre de quien habla (camaras: por micro; meet: por la toma)."""
    por_id = {p['id']: p for p in rep['personas']}
    if ctx.tipo == 'camaras':
        for s in segs:
            p = por_id.get(s.get('hablante'))
            s['quien'] = p['nombre'] if p and p.get('nombre') else None
    else:
        for s in segs:
            mid = (s['inicio'] + s['fin']) / 2
            t = next((t for t in tomas if t['a'] <= mid < t['b']), None)
            s['quien'] = t.get('n') if t else None
    return segs


def correr(ctx):
    rep, personas = personas_aprobadas(ctx)
    segs = ctx.json_trabajo('transcripcion.json')
    ctx.avance('Armando las tomas', .05)
    if ctx.tipo == 'camaras':
        from . import camaras
        tomas = camaras.edl(ctx, rep)
        wav = ctx.tj('programa16.wav')
        fin = ctx.estado['analisis']['fin'] - ctx.estado['analisis']['inicio']
    else:
        from . import meet
        tomas = meet.tomas(ctx, rep)
        wav = ctx.tj('a16_A.wav')
        fin = tomas[-1]['b']
    segs = nombrar_segmentos(ctx, segs, rep, tomas)
    ctx.json_trabajo('transcripcion.json', segs)
    if not ctx.reconstruyendo:
        ctx.guardar('tomas', tomas)

    ctx.avance('Midiendo silencios', .2)
    k = ctx.opcion('silencio_k', 0.35)
    cortes_sil, info = silencios.pausas(wav, k, ctx.opcion('silencio_min', 0.6), ctx.opcion('silencio_aire', 0.18))
    keep = silencios.conservar(fin, cortes_sil, ctx.FPS)
    mapa = Mapa(keep, ctx.FPS, INTRO)
    ctx.json_trabajo('silencios.json', cortes_sil)
    ctx.log(f"silencios: voz {info['voz_db']} dB, piso {info['piso_db']} dB, umbral {info['umbral_db']} dB; "
            f"{info['pausas']} pausas, se quitan {info['segundos'] / 60:.1f} min; queda {mapa.total / ctx.FPS / 60:.1f} min de {fin / 60:.1f}")

    if ctx.reconstruyendo:
        return
    ctx.avance('Proponiendo preguntas, citas y capítulos', .35)
    try:
        g = G.proponer(ctx, segs, fin, personas)
        ctx.log(f"IA: {len(g['preguntas'])} preguntas, {len(g['citas'])} citas, {len(g['capitulos'])} capítulos, "
                f"{len(g['cortes'])} cortes y {len(g['sensibles'])} tramos sensibles propuestos")
    except ia.SinIA:
        g = G.respaldo(ctx, segs, fin)
        ctx.aviso('Sin clave de Claude: el guion llega sin preguntas ni citas; agrégalas en la aprobación del guion.')
    # orden, ids y limites
    g['preguntas'] = sorted(g['preguntas'], key=lambda q: q['inicio'])
    for i, q in enumerate(g['preguntas'], 1):
        q['id'] = f'q{i:02d}'
        q['inicio'] = max(0.0, min(q['inicio'], fin))
        q['fin'] = max(q['inicio'] + 8, min(q['fin'], fin))
    g['citas'] = G.verificar_citas(sorted(g['citas'], key=lambda c: c['t']), segs)
    tope = ctx.marca.regla('cita_max_caracteres', 66)
    for i, c in enumerate(g['citas'], 1):
        c['id'] = f'c{i:02d}'
        c['texto'] = c['texto'].rstrip('. ')
        p = next((p for p in personas if p['nombre'] == c['quien']), None)
        c['rol'] = c.get('rol') or (p.get('rol') if p else '')
        if len(c['texto']) > tope:
            c['revisar'] = (c.get('revisar', '') + f' Tiene {len(c["texto"])} caracteres (máximo {tope}).').strip()
    for c in g['cortes']:
        c['aplicar'] = c.get('tipo') in ('nota_editorial', 'logistica', 'privado')
    for i, c in enumerate(g['capitulos']):
        c['inicio'] = 0 if i == 0 else c['inicio']
    # ilustraciones: archivos subidos, con el momento propuesto
    ilus = []
    for a in ctx.archivos('ilustracion'):
        nombre = a.get('nombre') or a['ruta'].rsplit('/', 1)[-1]
        prop = next((x for x in g.get('ilustraciones', []) if x['archivo'] == nombre), None)
        ext = a['ruta'].rsplit('.', 1)[-1].lower()
        modo = 'video' if ext in ('mp4', 'mov', 'm4v', 'webm') else 'foto'
        ilus.append({'archivo': nombre, 'ruta': a['ruta'], 'modo': a.get('modo', modo), 't': prop['t'] if prop else None,
                     'porque': prop.get('porque') if prop else 'Sin ubicar: elige el momento',
                     'desde': a.get('desde', 0)})
    g['ilustraciones'] = ilus
    g['fijas'] = G.colocar_fijas(ctx, g, mapa, personas, segs)
    g.setdefault('titulo', ctx.spec.get('titulo', ''))
    g['subtitulo_intro'] = ctx.spec.get('subtitulo_intro') or ' × '.join(p['nombre'] for p in personas[:3])
    g['pie_intro'] = ctx.spec.get('pie_intro') or ctx.marca.texto('pie_intro')
    g['duracion_estimada'] = round(INTRO + mapa.total / ctx.FPS + 6, 1)
    g.pop('_uso', None)
    ctx.guardar('plan', {'tomas': len(tomas), 'silencios': info, 'duracion_estimada': g['duracion_estimada']})
    ctx.guardar('guion', g)
