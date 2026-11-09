"""Los tipos de grabacion y lo que cada uno hace en cada etapa.

La etapa `clasificar` decide el tipo; desde ahi cada etapa le pregunta al tipo en vez de ramificar:

    analizar(ctx)              etapa analisis: deja el estado 'analisis' y el audio del programa
    hablantes(ctx, segs)       pone s['hablante'] en cada segmento si el tipo sabe quien habla
    reparto(ctx, segs)         la propuesta de quien es quien
    tomas(ctx, rep)            la lista de planos sobre la linea del programa
    fin(ctx, tomas)            duracion del programa (s)
    quien(ctx, segs, rep, tomas)  nombre de quien habla en cada segmento
    compositor(ctx)            arma cada trozo del render
    tomas_render(ctx, items, mapa)  ajuste de los planos despues de los graficos (o None)

El programa es la linea de tiempo comun: 0 es el primer instante en que hay todas las fuentes. Todo tipo deja
`programa16.wav` y `programa48.wav` cubriendo [0, fin], asi la transcripcion, los silencios y la mezcla final no
dependen del tipo. Si la persona subio un audio aparte, ese es el programa (sincronizado por correlacion).
"""
import numpy as np

from . import ffm

NOMBRES = {
    'meet': 'Videollamada en galería',
    'camaras': 'Varias cámaras a la vez',
    'una_camara': 'Una cámara',
    'podcast': 'Pódcast o video ya editado',
    'charla': 'Charla con diapositivas',
    'pantalla': 'Grabación de pantalla',
}
CLAVES = tuple(NOMBRES)


# ---------------------------------------------------------------- fuentes
def fuentes(ctx):
    """Las pistas de video del proyecto: las que dejo `clasificar` (con las partes sucesivas ya unidas) o, antes
    de clasificar, las de la ingesta tal cual."""
    cl = ctx.estado.get('clasificacion') or {}
    return cl.get('pistas') or ctx.estado['ingesta']['fuentes']


# ---------------------------------------------------------------- audio del programa
def programa(ctx, sr=16000):
    return ctx.tj(f'programa{sr // 1000}.wav')


def audio_aparte(ctx):
    """La clave del audio aparte que dejo la ingesta, o None."""
    return (ctx.estado.get('ingesta') or {}).get('audio_aparte')


def escribir_programa(ctx, maestra, inicio, fin, solo_aparte=False):
    """Deja programa16/48.wav sobre [inicio, fin] de la linea de la fuente maestra.

    Con audio aparte, ese audio se alinea con la maestra (misma correlacion que la sincronia de camaras) y
    reemplaza al de camara. Devuelve el informe de la sincronia, o None si no habia audio aparte. Con
    solo_aparte y sin audio aparte no hace nada (las camaras arman su propia mezcla)."""
    ap = audio_aparte(ctx)
    if not ap and solo_aparte:
        return None
    dur = fin - inicio
    off = 0.0
    info = None
    clave = maestra
    if ap and (maestra is None or not ctx.tj(f'a16_{maestra}.wav').exists()):
        # el video no tiene audio con que comparar: se alinea por el comienzo
        ctx.aviso('El video no tiene audio propio: el audio aparte se alinea por el comienzo. Revisa la sincronía de labios.')
        info = {'off': 0.0, 'confianza': None, 'deriva': []}
        clave = ap
    elif ap:
        from .etapas.camaras import sincronizar
        _, m = ffm.leer_wav(ctx.tj(f'a16_{maestra}.wav'))
        _, x = ffm.leer_wav(ctx.tj(f'a16_{ap}.wav'))
        off, sc, deriva, _ = sincronizar(np.asarray(m, np.float32), np.asarray(x, np.float32))
        info = {'off': round(off, 3), 'confianza': round(sc, 3), 'deriva': deriva}
        ctx.log(f'audio aparte = {maestra} + {off:.3f} s (confianza {sc:.2f})')
        if sc < 0.1:
            ctx.aviso(f'El audio aparte casi no se parece al de la cámara (confianza {sc:.2f}): revisa que sea la misma grabación.')
        clave = ap
    elif maestra is None or not ctx.tj(f'a16_{maestra}.wav').exists():
        raise RuntimeError('No hay audio para el programa: el video principal no tiene sonido y no se subió un audio aparte')
    for sr in (16000, 48000):
        desde = inicio + off
        filtro = None
        if desde < 0:
            filtro = f'adelay={int(round(-desde * 1000))}:all=1'
            desde = 0.0
        ffm.extraer_audio(ctx.tj(f'a{sr // 1000}_{clave}.wav'), programa(ctx, sr), sr, 1, filtro, desde=desde, dur=dur)
    return info


def huella(ruta):
    """Identifica un archivo por tamaño y su primer mega: si el audio del programa cambia (otro tipo, audio
    aparte), la transcripcion por partes guardada deja de valer."""
    import hashlib
    from pathlib import Path
    p = Path(ruta)
    with open(p, 'rb') as f:
        h = hashlib.md5(f.read(1 << 20))
    h.update(str(p.stat().st_size).encode())
    return h.hexdigest()[:10]


# ---------------------------------------------------------------- planos
def corte_j(tomas, fps=30, cuadros=4):
    """En cada cambio de plano el audio de la toma nueva entra unos cuadros antes que su imagen: el corte de
    video se corre `cuadros` hacia adelante. No se toca un plano tan corto que quedaria en nada."""
    d = cuadros / fps
    out = [dict(t) for t in tomas]
    for i in range(1, len(out)):
        a, b = out[i - 1], out[i]
        if a.get('plano') != b.get('plano') and b['b'] - b['a'] > 1.0 + d:
            a['b'] = round(a['b'] + d, 4)
            b['a'] = round(b['a'] + d, 4)
    return out


def factores_color(medias, maestra):
    """Ganancia por canal (B, G, R) para que cada camara se parezca a la maestra. Se limita a +-12 %: es
    igualar, no corregir una toma mala."""
    ref = np.array(medias[maestra], np.float32)
    out = {}
    for k, m in medias.items():
        f = ref / np.maximum(np.array(m, np.float32), 1.0)
        out[k] = [round(float(np.clip(v, 0.88, 1.12)), 3) for v in f]
    return out


def filtro_color(f):
    """colorchannelmixer con la ganancia de cada canal (f en orden B, G, R)."""
    if not f or all(abs(v - 1) < 0.01 for v in f):
        return ''
    b, g, r = f
    return f'colorchannelmixer=rr={r}:gg={g}:bb={b},'


# Reduccion de ruido suave para video de camara (nunca para pantallas: borronearia el texto).
RUIDO = 'hqdn3d=1.5:1.5:4:4,'


# ---------------------------------------------------------------- tipos
class Tipo:
    clave = ''
    disposicion = 'pantalla'      # graficos sobre el plano; 'escenario': panel de contenido y columna
    corte_j = False
    silencio_min = None           # pausa minima que se corta (s); None = la del proyecto
    reduce_ruido_audio = True

    @property
    def nombre(self):
        return NOMBRES[self.clave]

    def analizar(self, ctx):
        raise NotImplementedError

    def hablantes(self, ctx, segs):
        return None

    def reparto(self, ctx, segs):
        raise NotImplementedError

    def tomas(self, ctx, rep):
        raise NotImplementedError

    def fin(self, ctx, tomas):
        an = ctx.estado['analisis']
        return an['fin'] - an['inicio']

    def quien(self, ctx, segs, rep, tomas):
        """Por defecto: el hablante del segmento; si solo hay una persona con nombre, es ella."""
        por_id = {p['id']: p for p in rep['personas']}
        con_nombre = [p for p in rep['personas'] if p.get('nombre')]
        for s in segs:
            p = por_id.get(s.get('hablante'))
            if p is None and len(con_nombre) == 1:
                p = con_nombre[0]
            s['quien'] = p['nombre'] if p and p.get('nombre') else None
        return segs

    def compositor(self, ctx):
        raise NotImplementedError

    def tomas_render(self, ctx, items, mapa):
        return None

    def clip_dividido(self):
        """Si los clips verticales tienen version dividida (dos personas arriba y abajo)."""
        return False


class Camaras(Tipo):
    clave = 'camaras'
    corte_j = True

    def analizar(self, ctx):
        from .etapas import camaras
        camaras.correr(ctx)

    def hablantes(self, ctx, segs):
        from .etapas.transcripcion import _hablante_camaras
        _hablante_camaras(ctx, segs)

    def reparto(self, ctx, segs):
        from .etapas.transcripcion import _reparto_camaras
        return {'tipo': 'camaras', 'personas': _reparto_camaras(ctx, segs)}

    def tomas(self, ctx, rep):
        from .etapas import camaras
        return corte_j(camaras.edl(ctx, rep), ctx.FPS)

    def compositor(self, ctx):
        from .etapas.render import CompositorCamaras
        return CompositorCamaras(ctx)

    def tomas_render(self, ctx, items, mapa):
        from .etapas.graficos import planos_para_fotos
        return planos_para_fotos(ctx, items, mapa)

    def clip_dividido(self):
        return True


class Meet(Tipo):
    clave = 'meet'
    disposicion = 'escenario'

    def analizar(self, ctx):
        from .etapas import meet
        meet.correr(ctx)

    def reparto(self, ctx, segs):
        from .etapas import meet
        return meet.propuesta_reparto(ctx, segs)

    def tomas(self, ctx, rep):
        from .etapas import meet
        return meet.tomas(ctx, rep)

    def fin(self, ctx, tomas):
        return tomas[-1]['b']

    def quien(self, ctx, segs, rep, tomas):
        for s in segs:
            mid = (s['inicio'] + s['fin']) / 2
            t = next((t for t in tomas if t['a'] <= mid < t['b']), None)
            s['quien'] = t.get('n') if t else None
        return segs

    def compositor(self, ctx):
        from .etapas.meet import CompositorMeet
        return CompositorMeet(ctx)

    def clip_dividido(self):
        return True


class UnaCamara(Tipo):
    clave = 'una_camara'
    corte_j = True

    def analizar(self, ctx):
        from .etapas import una_camara
        una_camara.analizar(ctx)

    def hablantes(self, ctx, segs):
        from .etapas import una_camara
        una_camara.hablantes(ctx, segs)

    def reparto(self, ctx, segs):
        from .etapas import una_camara
        return una_camara.reparto(ctx, segs, self.clave)

    def tomas(self, ctx, rep):
        from .etapas import una_camara
        return corte_j(una_camara.tomas(ctx, rep), ctx.FPS)

    def compositor(self, ctx):
        from .etapas.una_camara import CompositorUnaCamara
        return CompositorUnaCamara(ctx)


class Podcast(UnaCamara):
    """Ya viene editado: se respetan sus cortes. Solo silencios largos, graficos, audio y marca."""
    clave = 'podcast'
    corte_j = False
    silencio_min = 1.2
    reduce_ruido_audio = False

    def hablantes(self, ctx, segs):
        return None

    def tomas(self, ctx, rep):
        return [{'a': 0.0, 'b': self.fin(ctx, None), 'plano': 'W'}]


class Charla(Tipo):
    clave = 'charla'
    disposicion = 'escenario'

    def analizar(self, ctx):
        from .etapas import contenido
        contenido.analizar(ctx, self.clave)

    def reparto(self, ctx, segs):
        from .etapas import contenido
        return contenido.reparto(ctx, segs, self.clave)

    def tomas(self, ctx, rep):
        from .etapas import contenido
        return contenido.tomas_charla(ctx, rep)

    def compositor(self, ctx):
        from .etapas.contenido import CompositorCharla
        return CompositorCharla(ctx)


class Pantalla(Charla):
    clave = 'pantalla'
    disposicion = 'pantalla'

    def tomas(self, ctx, rep):
        from .etapas import contenido
        return contenido.tomas_pantalla(ctx, rep)

    def compositor(self, ctx):
        from .etapas.contenido import CompositorPantalla
        return CompositorPantalla(ctx)


_TIPOS = {t.clave: t for t in (Camaras(), Meet(), UnaCamara(), Podcast(), Charla(), Pantalla())}


def de(ctx_o_clave):
    clave = ctx_o_clave if isinstance(ctx_o_clave, str) else ctx_o_clave.tipo
    if clave not in _TIPOS:
        raise RuntimeError(f'Tipo de grabación desconocido: {clave!r}. La etapa clasificar tiene que correr antes.')
    return _TIPOS[clave]
