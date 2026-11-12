"""Etapa 4 · Plan: tomas, silencios y propuesta del guion de gráficos (llega a la aprobación 2).

Segun lo que eligio la persona en Studio (o sugiere el referente, ver ctx.eleccion), el guion trae ademas:
- el gancho: la frase mas fuerte (5 a 20 s) que abre el video antes de la intro; se revisa en el guion;
- la duracion objetivo: Claude sabe cuanto dura y cuanto deberia, y propone cortes de tipo 'duracion' a frases
  completas; si aun sobra, los silencios se aprietan un nivel. Lo estimado y el objetivo quedan en el guion y en
  estado.plan;
- la cadencia del b-roll: las ilustraciones de la carpeta de apoyo (y las fotos sueltas) se reparten a ese ritmo.
"""
from .. import estilo
from .. import guion as G
from .. import ia, silencios
from ..contexto import Mapa

INTRO = 5.4
OUTRO = 6.0
TOLERANCIA = 1.03           # un 3 % sobre el objetivo ya esta bien: no se corta por segundos
NIVELES = ('suave', 'normal', 'fuerte')


def apretar_silencios(k, minimo, aire):
    """El nivel de silencios que sigue al actual (de estilo.SILENCIOS), o None si ya es el mas apretado. El actual
    es el nivel mas parecido a lo que se uso."""
    def distancia(n):
        v = estilo.SILENCIOS[n]
        return abs(v['silencio_k'] - k) * 10 + abs(v['silencio_min'] - minimo) + abs(v['silencio_aire'] - aire)
    actual = min(NIVELES, key=distancia)
    i = NIVELES.index(actual)
    if i + 1 >= len(NIVELES):
        return None
    sig = NIVELES[i + 1]
    return sig, dict(estilo.SILENCIOS[sig])


def pedido_duracion(estimada_s, objetivo_s):
    """Lo que se le dice a Claude si el video sobra; None si ya cabe (o no hay objetivo)."""
    if not objetivo_s or estimada_s <= objetivo_s * TOLERANCIA:
        return None
    return {'estimada_s': round(estimada_s, 1), 'objetivo_s': round(objetivo_s, 1)}


def cortes_aplicados(g):
    return [(c['inicio'], c['fin']) for c in g.get('cortes', []) if c.get('aplicar')]


def objetivo_s(ctx):
    v = ctx.eleccion('duracion_objetivo_min', None)
    try:
        v = float(v) if v is not None else None
    except (TypeError, ValueError):
        return None
    return v * 60 if v and v > 0 else None


def personas_aprobadas(ctx):
    rep = ctx.aprobado('reparto')
    if not rep:
        raise RuntimeError('Falta el reparto aprobado')
    return rep, [p for p in rep['personas'] if p.get('nombre')]


def correr(ctx):
    from .. import tipos
    tipo = tipos.de(ctx)
    rep, personas = personas_aprobadas(ctx)
    segs = ctx.json_trabajo('transcripcion.json')
    ctx.avance('Armando las tomas', .05)
    tomas = tipo.tomas(ctx, rep)
    wav = tipos.programa(ctx, 16000)
    fin = tipo.fin(ctx, tomas)
    segs = tipo.quien(ctx, segs, rep, tomas)
    ctx.json_trabajo('transcripcion.json', segs)
    if not ctx.reconstruyendo:
        ctx.guardar('tomas', tomas)
        # los planos ajustados de una pasada anterior (quiza de otro tipo) ya no valen
        ctx.guardar('tomas_render', None)

    ctx.avance('Midiendo silencios', .2)
    k = ctx.opcion('silencio_k', 0.35)
    minimo = tipo.silencio_min or ctx.opcion('silencio_min', 0.6)
    cortes_sil, info = silencios.pausas(wav, k, minimo, ctx.opcion('silencio_aire', 0.18))
    keep = silencios.conservar(fin, cortes_sil, ctx.FPS)
    mapa = Mapa(keep, ctx.FPS, INTRO)
    ctx.json_trabajo('silencios.json', cortes_sil)
    ctx.log(f"silencios: voz {info['voz_db']} dB, piso {info['piso_db']} dB, umbral {info['umbral_db']} dB; "
            f"{info['pausas']} pausas, se quitan {info['segundos'] / 60:.1f} min; queda {mapa.total / ctx.FPS / 60:.1f} min de {fin / 60:.1f}")

    if ctx.reconstruyendo:
        return
    # lo que eligio la persona (o sugiere el referente): gancho, duracion objetivo y ritmo de las ilustraciones
    quiere_gancho = bool(ctx.eleccion('gancho', False))
    objetivo = objetivo_s(ctx)
    broll = ctx.eleccion('broll_cada_min', None)
    pedido = pedido_duracion(INTRO + mapa.total / ctx.FPS + OUTRO, objetivo)
    ctx.avance('Proponiendo preguntas, citas y capítulos', .35)
    con_ia = True
    try:
        g = G.proponer(ctx, segs, fin, personas, gancho=quiere_gancho, duracion=pedido, broll_min=broll)
        ctx.log(f"IA: {len(g['preguntas'])} preguntas, {len(g['citas'])} citas, {len(g['capitulos'])} capítulos, "
                f"{len(g['cortes'])} cortes y {len(g['sensibles'])} tramos sensibles propuestos")
    except ia.SinIA:
        con_ia = False
        g = G.respaldo(ctx, segs, fin)
        ctx.aviso('Sin clave de Claude: el guion llega sin preguntas ni citas; agrégalas en la aprobación del guion.')
        if quiere_gancho:
            ctx.aviso('Sin clave de Claude no se elige el gancho: el video abre con la intro.')
        if pedido:
            ctx.aviso('Sin clave de Claude no se proponen cortes por duración: solo se aprietan los silencios.')
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
        c['aplicar'] = c.get('tipo') in ('nota_editorial', 'logistica', 'privado', 'duracion')
    g['cortes'] = G.ajustar_cortes_duracion(g['cortes'], segs)
    G.respetar_cortes_duracion(g)
    for i, c in enumerate(g['capitulos']):
        c['inicio'] = 0 if i == 0 else c['inicio']
    prohibidos = cortes_aplicados(g) + [(s['inicio'], s['fin']) for s in g.get('sensibles', [])]
    # gancho: a frases completas y fuera de lo cortado o sensible; la persona lo ve y lo puede apagar en el guion
    if quiere_gancho and con_ia:
        gancho = G.ajustar_gancho(g.get('gancho'), segs, prohibidos, fin)
        if gancho:
            g['gancho'] = gancho
        else:
            g.pop('gancho', None)
            ctx.aviso('Claude no dejó un gancho que sirva (5 a 20 s, fuera de cortes y tramos sensibles): el video abre con la intro.')
    else:
        g.pop('gancho', None)
    # ilustraciones: archivos de apoyo (y fotos sueltas), con el momento propuesto
    ilus = []
    for a in G.subidas_ilustrativas(ctx):
        nombre = G.nombre_archivo(a)
        prop = next((x for x in g.get('ilustraciones', []) if x.get('archivo') == nombre), None)
        ext = a['ruta'].rsplit('.', 1)[-1].lower()
        modo = 'video' if ext in ('mp4', 'mov', 'm4v', 'webm') and a.get('tipo') != 'foto' else 'foto'
        t = prop.get('t') if prop else None
        ilus.append({'archivo': nombre, 'ruta': a['ruta'], 'modo': a.get('modo', modo),
                     't': max(0.0, min(float(t), fin)) if isinstance(t, (int, float)) else None,
                     'porque': prop.get('porque') if prop else 'Sin ubicar: elige el momento',
                     'desde': a.get('desde', 0)})
    # las que quedaron sin momento se ubican solas, al ritmo del b-roll si lo hay (la persona las revisa)
    g['ilustraciones'] = G.ubicar_ilustraciones(ilus, segs, fin, float(broll) * 60 if broll else None, prohibidos)

    # duracion objetivo: con los cortes propuestos, ¿todavia sobra? entonces se aprietan los silencios un nivel
    edit = cortes_aplicados(g)
    keep = silencios.conservar(fin, [tuple(c) for c in cortes_sil] + edit, ctx.FPS)
    estimada = INTRO + Mapa(keep, ctx.FPS, INTRO).total / ctx.FPS + OUTRO
    if objetivo and estimada > objetivo * TOLERANCIA:
        sig = apretar_silencios(k, minimo, ctx.opcion('silencio_aire', 0.18))
        if sig:
            nivel, v = sig
            m2 = tipo.silencio_min or v['silencio_min']
            cortes_sil, info = silencios.pausas(wav, v['silencio_k'], m2, v['silencio_aire'])
            ctx.json_trabajo('silencios.json', cortes_sil)
            info['apretados'] = nivel
            keep = silencios.conservar(fin, [tuple(c) for c in cortes_sil] + edit, ctx.FPS)
            estimada = INTRO + Mapa(keep, ctx.FPS, INTRO).total / ctx.FPS + OUTRO
            ctx.log(f'duración objetivo {objetivo / 60:.1f} min: silencios apretados a «{nivel}», quedan {estimada / 60:.1f} min')
        if estimada > objetivo * TOLERANCIA:
            ctx.aviso(f'El video queda en {estimada / 60:.1f} min y el objetivo es {objetivo / 60:.1f} min: '
                      'en el guion puedes agregar cortes para acercarte.')
    # los graficos fijos van en tiempo de salida: con cortes por duracion se ubican sobre lo que de verdad queda
    if any(c.get('tipo') == 'duracion' and c.get('aplicar') for c in g['cortes']) or info.get('apretados'):
        mapa = Mapa(keep, ctx.FPS, INTRO)
    g['fijas'] = G.colocar_fijas(ctx, g, mapa, personas, segs)
    g.setdefault('titulo', ctx.spec.get('titulo', ''))
    g['subtitulo_intro'] = ctx.spec.get('subtitulo_intro') or ' × '.join(p['nombre'] for p in personas[:3])
    g['pie_intro'] = ctx.spec.get('pie_intro') or ctx.marca.texto('pie_intro')
    g_s = (g['gancho']['fin'] - g['gancho']['inicio']) if g.get('gancho') else 0.0
    g['duracion_estimada'] = round(estimada + g_s, 1)
    plan = {'tomas': len(tomas), 'silencios': info, 'duracion_estimada': g['duracion_estimada']}
    if objetivo:
        g['duracion_objetivo'] = round(objetivo, 1)
        plan['duracion_objetivo'] = g['duracion_objetivo']
    g.pop('_uso', None)
    ctx.guardar('plan', plan)
    ctx.guardar('guion', g)
