"""Guion de graficos: que pieza entra, cuando y con que texto.

Tiempos SIEMPRE en la linea maestra (la de la fuente o del programa sincronizado). Las duraciones de las
piezas son de salida: al renderizar se traducen con el mapa de lo que se conserva, asi los silencios y
cortes nunca rompen una animacion.

La IA propone preguntas, citas, capitulos, cortes y textos de YouTube; las piezas fijas (rotulos, barras con
QR, pop-ups) se colocan con reglas. Todo llega a la aprobacion 2 para que una persona lo revise.
"""
import difflib
import re

from . import ia

# capas: 0,5 videos ilustrativos · 1 pregunta · 2 cita · 2,5 foto · 3 rotulo · 4 barra · 5 pop-up
EXCLUSIVAS = ('rotulo', 'barra')        # ocupan la franja inferior sola


def dur_cita(texto, marca):
    return max(marca.regla('cita_seg_min', 6.5), min(marca.regla('cita_seg_max', 8.5), 3 + len(texto) * 0.07))


ESQUEMA = {
    'type': 'object',
    'required': ['capitulos', 'preguntas', 'citas', 'cortes', 'sensibles', 'youtube'],
    'properties': {
        'capitulos': {'type': 'array', 'items': {'type': 'object', 'required': ['inicio', 'titulo'], 'properties': {
            'inicio': {'type': 'number'}, 'titulo': {'type': 'string', 'description': 'maximo 22 caracteres'}}}},
        'preguntas': {'type': 'array', 'items': {'type': 'object', 'required': ['inicio', 'fin', 'encabezado', 'texto'], 'properties': {
            'inicio': {'type': 'number', 'description': 'segundo en que se hace la pregunta'},
            'fin': {'type': 'number', 'description': 'segundo en que termina ese tema (antes de la siguiente pregunta)'},
            'encabezado': {'type': 'string', 'description': '"<Nombre> pregunta", "Pregunta del público" o "Pregunta del chat"'},
            'texto': {'type': 'string', 'description': 'la pregunta, clara y corta, maximo 60 caracteres'}}}},
        'citas': {'type': 'array', 'items': {'type': 'object', 'required': ['t', 'quien', 'texto', 'original'], 'properties': {
            't': {'type': 'number', 'description': 'segundo en que lo dice'},
            'quien': {'type': 'string'},
            'texto': {'type': 'string', 'description': 'la idea en sus palabras, pulida para leer, maximo 66 caracteres, sin punto final'},
            'original': {'type': 'string', 'description': 'las palabras exactas de la transcripcion de donde sale'}}}},
        'cortes': {'type': 'array', 'items': {'type': 'object', 'required': ['inicio', 'fin', 'motivo', 'tipo'], 'properties': {
            'inicio': {'type': 'number'}, 'fin': {'type': 'number'}, 'motivo': {'type': 'string'},
            'tipo': {'type': 'string', 'enum': ['nota_editorial', 'logistica', 'privado', 'repeticion']}}}},
        'sensibles': {'type': 'array', 'items': {'type': 'object', 'required': ['inicio', 'fin', 'motivo'], 'properties': {
            'inicio': {'type': 'number'}, 'fin': {'type': 'number'}, 'motivo': {'type': 'string'}}}},
        'ilustraciones': {'type': 'array', 'items': {'type': 'object', 'required': ['archivo', 't'], 'properties': {
            'archivo': {'type': 'string'}, 't': {'type': 'number'}, 'porque': {'type': 'string'}}}},
        'youtube': {'type': 'object', 'required': ['titulo', 'descripcion'], 'properties': {
            'titulo': {'type': 'string', 'description': 'maximo 90 caracteres'},
            'descripcion': {'type': 'string', 'description': 'resumen en 2 o 3 parrafos, sin capitulos (se agregan solos)'},
            'etiquetas': {'type': 'array', 'items': {'type': 'string'}}}},
    },
}

SISTEMA = """Eres el editor de un programa tipo talk show de {marca}. Recibes la transcripción con tiempos y quién habla.
Propones el guion de gráficos que una persona revisará antes de publicar. Reglas:
- PREGUNTAS: una por tema, como en un noticiero: queda en pantalla todo lo que dura el tema (inicio = cuando se
  pregunta, fin = cuando empieza el siguiente tema). Más o menos una cada 4 a 6 minutos. Texto corto y claro.
- CITAS: frases que resumen la conversación, dichas de verdad por esa persona en ese momento. Puedes pulirlas para
  que se lean bien (quitar muletillas) pero sin cambiar el sentido ni agregar datos. Máximo 66 caracteres.
  Más o menos una cada 1,5 a 3 minutos, repartidas entre quienes hablan. En "original" copia las palabras exactas.
- CAPÍTULOS: 5 a 9 bloques con título de 1 a 3 palabras; el primero en 0.
- CORTES: propón quitar (a) lo que pidan las notas editoriales, (b) logística sin valor (¿me escuchan?, pruebas de
  sonido, alguien cambia de dispositivo, foto grupal, despedidas largas), (c) datos privados de alguien
  (teléfonos, correos, direcciones, dinero personal). Da el motivo concreto.
- SENSIBLES: tramos que una persona debe mirar antes de publicar aunque no los cortes (cifras sin fuente,
  terceros nombrados con datos, posibles llaves o contraseñas leídas en voz alta, métricas internas, menores).
- ILUSTRACIONES: si hay archivos ilustrativos, ubícalos en el momento en que se menciona lo que muestran.
- No inventes nombres, cifras ni hechos. Si algo no está en la transcripción, no lo pongas.
- Tiempos en segundos (número), tomados de las marcas [mm:ss.s] de la transcripción."""


def proponer(ctx, segs, dur, personas):
    nombres = ', '.join(f"{p['nombre']} ({p.get('rol') or 'sin rol'})" for p in personas if p.get('nombre'))
    ilus = [a.get('nombre') or a['ruta'].rsplit('/', 1)[-1] for a in ctx.archivos('ilustracion')]
    cuerpo = (f"Título: {ctx.spec.get('titulo')}\nDuración: {dur / 60:.0f} min\nPersonas: {nombres}\n"
              f"Notas editoriales de quien pidió la edición: {ctx.spec.get('notas_editoriales') or 'ninguna'}\n"
              f"Archivos ilustrativos disponibles: {', '.join(ilus) if ilus else 'ninguno'}\n\n"
              f"Transcripción:\n{ia.texto_transcripcion(segs)}")
    r = ia.pedir_json(SISTEMA.format(marca=ctx.marca.cfg['nombre']), cuerpo, ESQUEMA, 'guion', max_tokens=16000)
    return r


def _norm(s):
    return re.sub(r'[^a-z0-9áéíóúñü ]', '', s.lower())


def verificar_citas(citas, segs, ventana=25):
    """Comprueba que cada cita salga de lo que se dijo cerca de su tiempo; si no, la marca para revisar."""
    for c in citas:
        cerca = ' '.join(s['texto'] for s in segs if abs(s['inicio'] - c['t']) < ventana)
        orig = _norm(c.get('original') or c['texto'])
        ratio = difflib.SequenceMatcher(None, orig, _norm(cerca)).find_longest_match(0, len(orig), 0, len(_norm(cerca))).size
        c['coincidencia'] = round(ratio / max(len(orig), 1), 2)
        if c['coincidencia'] < 0.5:
            c['revisar'] = 'No encontré estas palabras cerca de ese minuto: confirma la cita y el tiempo.'
        # el tiempo exacto: empieza cuando arranca la frase original
        mejor = None
        for s in segs:
            if abs(s['inicio'] - c['t']) < ventana:
                sc = difflib.SequenceMatcher(None, orig[:40], _norm(s['texto'])).ratio()
                if mejor is None or sc > mejor[0]:
                    mejor = (sc, s['inicio'])
        if mejor and mejor[0] > 0.45:
            c['t'] = mejor[1]
    return citas


def primeras_apariciones(segs, minimo=3.0):
    """Primer momento en que cada persona habla seguido al menos `minimo` s (para su rotulo)."""
    out = {}
    for s in segs:
        q = s.get('quien')
        if q and q not in out and s['fin'] - s['inicio'] >= minimo:
            out[q] = s['inicio'] + 1.0
    return out


def colocar_fijas(ctx, g, mapa, personas, segs):
    """Rotulos, barras con QR y pop-ups segun las reglas de la marca. Devuelve la lista y los avisos."""
    m = ctx.marca
    fps = mapa.fps
    total = mapa.total / fps
    def o(t):
        return mapa.cuadro(t) / fps

    # franja inferior ocupada por preguntas (bordes) y citas
    ocup = []
    for q in g['preguntas']:
        ocup += [(o(q['inicio']) - 1, o(q['inicio']) + 3), (o(q['fin']) - 2, o(q['fin']) + 1)]
    for c in g['citas']:
        ocup.append((o(c['t']) - 0.5, o(c['t']) + dur_cita(c['texto'], m) + 0.5))

    def libre(a, b):
        return all(b <= x or a >= y for x, y in ocup)

    fijas = []
    # rotulos: primera vez que habla cada persona
    apar = primeras_apariciones(segs)
    for p in personas:
        if not p.get('nombre') or p.get('sin_rotulo'):
            continue
        t = apar.get(p['nombre'])
        if t is None:
            continue
        a = o(max(t, 0.5))
        for d in range(0, 60):
            if libre(a + d, a + d + 5.5):
                a += d
                break
        fijas.append({'tipo': 'rotulo', 'persona': p['nombre'], 'salida': round(a, 2)})
        ocup.append((a - .5, a + 5.5))

    # barras con QR: cada CTA al menos N veces, repartidas a lo largo del video
    ctas = [c for c in (ctx.spec.get('ctas') or m.ctas) if c in m.ctas]
    if ctas and total > 120:
        cada = m.regla('barra_cada_min', 7) * 60
        n = max(len(ctas) * m.regla('barras_por_cta_min', 2), int(total // cada))
        n = min(n, max(int(total // 60), 1))
        for i in range(n):
            ideal = 20 + (total - 40) * (i + 0.5) / n
            for d in sorted(range(-90, 91, 2), key=abs):
                a = ideal + d
                if 15 < a < total - 20 and libre(a - 1, a + 13):
                    fijas.append({'tipo': 'barra', 'cta': ctas[i % len(ctas)], 'salida': round(a, 2)})
                    ocup.append((a - 1, a + 13))
                    break
            else:
                fijas.append({'tipo': 'barra', 'cta': ctas[i % len(ctas)], 'salida': round(ideal, 2), 'parte_pregunta': True})
                ocup.append((ideal - 1, ideal + 13))
    # pop-up compacto arriba a la derecha (no usa la franja inferior)
    cada = m.regla('popup_cada_min', 9) * 60
    for i in range(int(total // cada)):
        fijas.append({'tipo': 'popup', 'salida': round(cada * (i + 0.6), 2)})
    fijas.sort(key=lambda f: f['salida'])
    return fijas


def respaldo(ctx, segs, dur):
    """Sin IA: capitulos cada ~8 min con la primera frase del tramo, sin preguntas ni citas."""
    caps = [{'inicio': 0, 'titulo': 'Inicio'}]
    n = max(int(dur // 480), 0)
    for i in range(1, n + 1):
        t = dur * i / (n + 1)
        caps.append({'inicio': round(t), 'titulo': f'Parte {i + 1}'})
    return {'capitulos': caps, 'preguntas': [], 'citas': [], 'cortes': [], 'sensibles': [], 'ilustraciones': [],
            'youtube': {'titulo': ctx.spec.get('titulo', ''), 'descripcion': '', 'etiquetas': []}, 'sin_ia': True}
