"""Etapa 3 · Transcripción con marcas por palabra, y propuesta de reparto (quién es quién).

Se transcribe por partes de 10 min (si el worker se reinicia, las partes hechas no se repiten) con un
texto inicial que trae los nombres propios del proyecto, para que Whisper los escriba bien.

Al terminar se arma la propuesta de reparto que la persona aprueba en la app (aprobación 1).
"""
import json

import numpy as np

from .. import config, ffm, ia
from .. import tipos

PARTE = 600.0


def _modelo():
    from faster_whisper import WhisperModel
    return WhisperModel(config.WHISPER_MODELO, device=config.WHISPER_DISPOSITIVO, compute_type=config.WHISPER_COMPUTO)


def prompt_inicial(ctx):
    nombres = [p['nombre'] for p in ctx.spec.get('personas', [])]
    nombres += [a.get('persona') for a in ctx.archivos('fuente') if a.get('persona')]
    extra = ctx.spec.get('vocabulario', [])
    vistos, out = set(), []
    for n in [ctx.marca.cfg.get('nombre'), ctx.spec.get('titulo')] + nombres + extra:
        if n and n not in vistos:
            vistos.add(n)
            out.append(n)
    return ', '.join(out)


def _groq_parte(ctx, wav, i, a, d):
    """Una parte de 10 min por Groq (whisper-large-v3-turbo). Devuelve segmentos con sus palabras."""
    import requests
    out = d / f'p{i:02d}.json'
    if out.exists():
        return json.loads(out.read_text(encoding='utf8'))
    parte = d / f'p{i:02d}.flac'
    ffm.correr(['-ss', f'{a:.3f}', '-t', f'{PARTE:.3f}', '-i', wav, '-ac', '1', '-ar', '16000', '-c:a', 'flac', parte])
    for intento in range(4):
        with open(parte, 'rb') as f:
            r = requests.post('https://api.groq.com/openai/v1/audio/transcriptions', timeout=300,
                              headers={'Authorization': f'Bearer {config.GROQ_API_KEY}'},
                              files={'file': (parte.name, f, 'audio/flac')},
                              data=[('model', config.GROQ_MODELO), ('response_format', 'verbose_json'),
                                    ('language', ctx.spec.get('idioma', 'es')), ('prompt', prompt_inicial(ctx)[:600]),
                                    ('timestamp_granularities[]', 'word'), ('timestamp_granularities[]', 'segment')])
        if r.status_code == 429 or r.status_code >= 500:
            import time
            time.sleep(3 * (intento + 1))
            continue
        r.raise_for_status()
        break
    j = r.json()
    palabras = [{'p': w['word'].strip(), 'i': round(w['start'] + a, 2), 'f': round(w['end'] + a, 2)} for w in j.get('words') or []]
    res = []
    # Groq da las palabras en una lista aparte: se reparten en sus segmentos por tiempo.
    for s in j.get('segments') or []:
        ini, fin = round(s['start'] + a, 2), round(s['end'] + a, 2)
        res.append({'inicio': ini, 'fin': fin, 'texto': s['text'].strip(),
                    'palabras': [w for w in palabras if ini - 0.05 <= w['i'] < fin + 0.05]})
    out.write_text(json.dumps(res, ensure_ascii=False), encoding='utf8')
    parte.unlink(missing_ok=True)
    return res


def transcribir(ctx, wav):
    from .. import tipos
    dur = ffm.duracion(wav)
    # las partes hechas se guardan por audio: si el programa cambia (otro tipo, audio aparte) no se reusan
    d = ctx.tj(f'tx_{tipos.huella(wav)}')
    d.mkdir(exist_ok=True)
    n = int(np.ceil(dur / PARTE))
    if config.GROQ_API_KEY:
        from concurrent.futures import ThreadPoolExecutor
        ctx.avance(f'Transcribiendo {n} partes a la vez', .05)
        with ThreadPoolExecutor(min(n, 8)) as ex:
            partes = list(ex.map(lambda i: _groq_parte(ctx, wav, i, i * PARTE, d), range(n)))
        ctx.costo['audio_min'] = round(ctx.costo.get('audio_min', 0) + dur / 60, 2)
        ctx.costo['transcripcion'] = 'groq'
        return [s for p in partes for s in p]
    ctx.costo['transcripcion'] = f'faster-whisper {config.WHISPER_MODELO}'
    modelo = None
    segs = []
    for i in range(n):
        out = d / f'p{i:02d}.json'
        a = i * PARTE
        if not out.exists():
            ctx.avance(f'Transcribiendo {int(a // 60)}–{int(min(a + PARTE, dur) // 60)} min', i / n)
            parte = d / f'p{i:02d}.wav'
            ffm.extraer_audio(wav, parte, 16000, 1, desde=a, dur=PARTE)
            modelo = modelo or _modelo()
            _, audio = ffm.leer_wav(parte)      # se pasa el arreglo: evita depender de PyAV para leer
            it, info = modelo.transcribe(np.asarray(audio, np.float32), language=ctx.spec.get('idioma', 'es'), word_timestamps=True,
                                         vad_filter=True, beam_size=int(ctx.opcion('whisper_beam', 1)),
                                         initial_prompt=prompt_inicial(ctx), condition_on_previous_text=False)
            res = [{'inicio': round(s.start + a, 2), 'fin': round(s.end + a, 2), 'texto': s.text.strip(),
                    'palabras': [{'p': w.word.strip(), 'i': round(w.start + a, 2), 'f': round(w.end + a, 2)}
                                 for w in (s.words or [])]} for s in it]
            out.write_text(json.dumps(res, ensure_ascii=False), encoding='utf8')
            parte.unlink(missing_ok=True)
        segs += json.loads(out.read_text(encoding='utf8'))
    return segs


def _hablante_camaras(ctx, segs):
    an = ctx.estado['analisis']
    lab = np.load(ctx.tj('etiquetas.npy'))
    claves = an['claves']
    paso = an['paso']
    for s in segs:
        a, b = int((s['inicio'] + an['inicio']) / paso), int((s['fin'] + an['inicio']) / paso)
        v = lab[a:max(b, a + 1)]
        v = v[v >= 0]
        s['hablante'] = claves[int(np.bincount(v).argmax())] if len(v) else None


def _reparto_camaras(ctx, segs):
    an = ctx.estado['analisis']
    personas = {p['nombre']: p for p in ctx.spec.get('personas', [])}
    out = []
    for f in tipos.fuentes(ctx):
        k = f['clave']
        nombre = f.get('persona') or ''
        p = personas.get(nombre, {})
        muestras = [s['texto'] for s in segs if s.get('hablante') == k and len(s['texto']) > 40][:4]
        mini = ctx.salida / f'camara_{k}.jpg'
        t = f['duracion'] * 0.3
        ffm.correr(['-ss', f'{t:.1f}', '-i', f['archivo'], '-frames:v', '1', '-vf', 'scale=480:-2', str(mini)])
        out.append({'id': k, 'tipo': 'camara', 'nombre': nombre, 'rol': p.get('rol', ''), 'handle': p.get('handle', ''),
                    'voz': round(an['voz'].get(k, 0), 3), 'muestras': muestras, 'miniatura': f'camara_{k}.jpg',
                    'origen': 'proyecto' if nombre else 'pendiente'})
    lab = np.load(ctx.tj('etiquetas.npy'))
    if (lab == -2).mean() > 0.02:
        out.append({'id': 'X', 'tipo': 'tercero', 'nombre': '', 'rol': '', 'handle': '', 'voz': round(float((lab == -2).mean()), 3),
                    'muestras': [], 'origen': 'pendiente',
                    'nota': 'Una tercera voz en la llamada: se muestra en pantalla dividida. Ponle nombre si aparece en rótulos o citas.'})
    return out


def correr(ctx):
    from .. import tipos
    tipo = tipos.de(ctx)
    wav = tipos.programa(ctx, 16000)
    segs = None
    if ctx.reconstruyendo and ctx.estado.get('transcripcion', {}).get('remoto'):
        try:
            # ya se transcribio en otro worker: se baja en vez de volver a correr Whisper
            p = ctx.alm.traer(ctx.pid, ctx.estado['transcripcion']['remoto'], ctx.salida / 'transcripcion.json')
            segs = json.loads(p.read_text(encoding='utf8'))
        except Exception:  # noqa: BLE001
            segs = None
    if segs is None:
        segs = transcribir(ctx, wav)
    if not ctx.reconstruyendo:
        ctx.avance('Viendo quién habla en cada frase', .9)
    tipo.hablantes(ctx, segs)
    texto =' '.join(s['texto'] for s in segs)
    ctx.log(f'{len(segs)} segmentos, {len(texto.split())} palabras')
    ctx.json_trabajo('transcripcion.json', segs)
    ctx.salida.mkdir(exist_ok=True)
    (ctx.salida / 'transcripcion.json').write_text(json.dumps(segs, ensure_ascii=False), encoding='utf8')
    remoto = ctx.estado.get('transcripcion', {}).get('remoto') if ctx.reconstruyendo else \
        ctx.alm.subir(ctx.pid, ctx.salida / 'transcripcion.json', 'transcripcion.json', 'application/json')
    ctx.guardar('transcripcion', {'segmentos': len(segs), 'palabras': len(texto.split()), 'archivo': 'transcripcion.json',
                                  'remoto': remoto})

    if ctx.reconstruyendo:
        return
    ctx.avance('Armando la propuesta de reparto', .95)
    reparto = tipo.reparto(ctx, segs)
    try:
        ia_extra = _nombres_por_ia(ctx, reparto, segs)
        if ia_extra:
            reparto['sugerencias_ia'] = ia_extra
    except ia.SinIA:
        ctx.log('Sin clave de Claude: el reparto queda con lo que trae el proyecto', 'aviso')
    for p in reparto['personas']:
        if p.get('miniatura'):
            ctx.alm.subir(ctx.pid, ctx.salida / p['miniatura'], p['miniatura'])
    ctx.guardar('reparto', reparto)


def _nombres_por_ia(ctx, reparto, segs):
    """Claude lee la transcripcion y propone nombre y rol de quien falte (se presentan, los presentan)."""
    faltan = [p for p in reparto['personas'] if not p.get('nombre')]
    if not faltan:
        return None
    esquema = {'type': 'object', 'required': ['personas'], 'properties': {'personas': {'type': 'array', 'items': {
        'type': 'object', 'required': ['id', 'nombre', 'evidencia'],
        'properties': {'id': {'type': 'string'}, 'nombre': {'type': 'string'}, 'rol': {'type': 'string'},
                       'evidencia': {'type': 'string', 'description': 'frase textual de la transcripcion que lo sostiene, con su minuto'}}}}}}
    lista = '\n'.join(f"- id {p['id']} ({p['tipo']}): " + (f"habla {p['voz']:.0%}. " if isinstance(p.get('voz'), (int, float)) else '')
                      + f"Ejemplos: {' | '.join(p.get('muestras', [])[:3])}" for p in faltan)
    r = ia.pedir_json(
        'Eres asistente de edición de video. Propón nombres SOLO si la transcripción los sostiene (alguien se '
        'presenta o lo presentan). Si no hay evidencia, deja nombre vacío. Nunca inventes.',
        f'Proyecto: {ctx.spec.get("titulo")}\nPersonas sin nombre:\n{lista}\n\nTranscripción:\n'
        f'{ia.texto_transcripcion(segs, max_chars=60000)}', esquema, 'nombres')
    for s in r['personas']:
        for p in reparto['personas']:
            if p['id'] == s['id'] and s.get('nombre') and not p.get('nombre'):
                p['nombre'] = s['nombre']
                p['rol'] = p.get('rol') or s.get('rol', '')
                p['origen'] = 'ia'
                p['evidencia'] = s.get('evidencia')
    return r['personas']
