"""Una sola puerta a Claude, a traves de Studio.

El motor arma el pedido (instrucciones, transcripcion, esquema) y Studio lo corre con `llamarClaude`: la
clave de la cuenta del proyecto, su tope de gasto y su registro de consumo, los mismos de todo Studio. Sin
Studio, o sin clave en la cuenta, las etapas usan su respaldo sin IA y lo dicen en el registro.

La IA propone (nombres, preguntas, citas, cortes sensibles, capitulos, clips, textos) y una persona aprueba.
Nunca decide sola sobre lo que se publica.
"""
import base64
import contextvars
import json
import time
from pathlib import Path

from . import config

# El proyecto de la etapa que corre: Studio lo usa para saber de que cuenta es la llamada.
proyecto_actual = contextvars.ContextVar('proyecto_actual', default=None)

# Lo que gastaron las llamadas de la etapa en curso, para el informe de costos.
uso_etapa = contextvars.ContextVar('uso_etapa', default=None)


class SinIA(RuntimeError):
    """Studio no esta disponible o la cuenta no tiene Claude: las etapas usan su respaldo."""


def disponible():
    return bool(config.STUDIO_URL and config.SECRETO and proyecto_actual.get())


def imagen(ruta, tipo=None):
    ruta = Path(ruta)
    tipo = tipo or ('image/png' if ruta.suffix.lower() == '.png' else 'image/jpeg')
    return {'type': 'image', 'source': {'type': 'base64', 'media_type': tipo,
                                        'data': base64.b64encode(ruta.read_bytes()).decode()}}


def pedir_json(sistema, contenido, esquema, nombre='respuesta', modelo=None, max_tokens=8000, intentos=2):
    """contenido: str o lista de bloques (texto e imagenes). Devuelve el dict que cumple `esquema`."""
    if not disponible():
        raise SinIA('Sin conexion con Studio para pedir a Claude')
    import requests
    if isinstance(contenido, str):
        contenido = [{'type': 'text', 'text': contenido}]
    cuerpo = {'proyecto_id': proyecto_actual.get(), 'paso': f'longform-{nombre}', 'sistema': sistema,
              'contenido': contenido, 'esquema': esquema, 'max_tokens': max_tokens, 'modelo': modelo}
    err = None
    for i in range(intentos):
        try:
            r = requests.post(f'{config.STUDIO_URL}/api/long-form/ia', json=cuerpo, timeout=900,
                              headers={'authorization': f'Bearer {config.SECRETO}'})
            j = r.json() if r.headers.get('content-type', '').startswith('application/json') else {}
            if r.status_code == 409 or j.get('sinIA'):
                raise SinIA(j.get('error') or 'La cuenta no tiene Claude')
            if r.status_code >= 400 or not j.get('ok'):
                raise RuntimeError(f'Studio {r.status_code}: {j.get("error") or r.text[:300]}')
            datos = j['datos']
            faltan = [k for k in esquema.get('required', []) if k not in datos]
            if faltan:
                raise ValueError(f'faltan campos {faltan}')
            gasto = uso_etapa.get()
            if isinstance(gasto, dict):
                u = j.get('uso') or {}
                gasto['tokens_entrada'] = gasto.get('tokens_entrada', 0) + int(u.get('entrada', 0))
                gasto['tokens_salida'] = gasto.get('tokens_salida', 0) + int(u.get('salida', 0))
            datos['_uso'] = j.get('uso', {})
            return datos
        except SinIA:
            raise
        except Exception as e:  # noqa: BLE001
            err = e
            if i + 1 < intentos:
                time.sleep(4 * (i + 1))
    raise RuntimeError(f'Claude no respondio bien tras {intentos} intentos: {err}')


def texto_transcripcion(segs, desde=0.0, hasta=1e9, max_chars=180000):
    """Transcripcion compacta con marcas [mm:ss] para que la IA cite tiempos reales."""
    out, n = [], 0
    for s in segs:
        if s['fin'] < desde or s['inicio'] > hasta:
            continue
        quien = f" {s['hablante']}:" if s.get('hablante') else ''
        linea = f"[{int(s['inicio'] // 60):02d}:{s['inicio'] % 60:04.1f}]{quien} {s['texto'].strip()}"
        n += len(linea)
        if n > max_chars:
            break
        out.append(linea)
    return '\n'.join(out)


def guardar_respuesta(ruta, datos):
    Path(ruta).write_text(json.dumps(datos, ensure_ascii=False, indent=1), encoding='utf8')
