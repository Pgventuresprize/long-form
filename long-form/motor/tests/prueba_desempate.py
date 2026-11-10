"""El desempate con Claude, de punta a punta en el motor, contra un Studio falso.

    python tests/prueba_desempate.py        (desde long-form/motor; usa la muestra corta-A de tests/armar_muestras.py)

Las reglas se fuerzan a dudar (confianza baja entre tres tipos) y un servidor local hace de /api/long-form/ia.
Comprueba lo que el motor manda (cuatro cuadros, cada uno con su minuto delante, y solo los tipos que quedaron
en pie) y lo que hace con cada respuesta:
- Claude elige un tipo: se usa, y la razon queda en la evidencia.
- La cuenta no tiene Claude (409): queda la regla y se dice.
- Studio falla (502) o Claude elige un tipo que no estaba en pie: queda la regla, la etapa no se cae.

La llamada real a Claude (la de Studio con `llamarClaude`) necesita una clave en la cuenta; esta prueba no la usa.
"""
import json
import os
import sys
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

M = Path(os.environ.get('LF_MUESTRAS', r'C:\Users\juanf\lf-local\muestras'))
os.environ['LF_DATOS'] = os.environ.get('LF_PRUEBAS', r'C:\Users\juanf\lf-local\pruebas-tipos')
MARCA = os.environ.get('LF_MARCA', r'C:\Users\juanf\lf-local\datos\marcas\ae595bcd-a273-4a10-928e-f66f9d59ca68')
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from editor import almacen, config  # noqa: E402
from editor.etapas import clasificar as C  # noqa: E402
from editor.pipeline import correr_etapa  # noqa: E402

SECRETO = 'prueba-desempate'
pedidos = []
respuesta = {}


class Studio(BaseHTTPRequestHandler):
    def do_POST(self):  # noqa: N802
        cuerpo = json.loads(self.rfile.read(int(self.headers['content-length'])))
        pedidos.append({'auth': self.headers.get('authorization'), 'path': self.path, **cuerpo})
        estado, datos = respuesta['estado'], respuesta['datos']
        b = json.dumps(datos).encode()
        self.send_response(estado)
        self.send_header('content-type', 'application/json')
        self.send_header('content-length', str(len(b)))
        self.end_headers()
        self.wfile.write(b)

    def log_message(self, *a):
        pass


def main():
    if not (M / 'corta-A.mp4').exists():
        print('-- falta la muestra corta-A.mp4 (tests/armar_muestras.py)')
        return 0
    srv = HTTPServer(('127.0.0.1', 0), Studio)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    config.STUDIO_URL = f'http://127.0.0.1:{srv.server_port}'
    config.SECRETO = SECRETO

    # las reglas dudan: confianza baja entre tres tipos
    regla = C.decidir
    C.decidir = lambda pistas, hay_pdf: (lambda r: ('una_camara', 'baja', r[2], ['una_camara', 'pantalla', 'podcast'], {'camara': 'A'}))(regla(pistas, hay_pdf))

    alm = almacen.AlmacenLocal()
    pid = 'desempate'
    d = alm.carpeta(pid)
    (d / 'estado').mkdir(parents=True, exist_ok=True)
    spec = {'id': pid, 'titulo': 'Prueba desempate', 'tipo': None, 'esfuerzo': 'rapido', 'idioma': 'es', 'marca': MARCA,
            'opciones': {'clips': 0}, 'archivos': [{'tipo': 'fuente', 'rol': 'A', 'ruta': str(M / 'corta-A.mp4'), 'nombre': 'corta-A.mp4'}]}
    (d / 'proyecto.json').write_text(json.dumps(spec, ensure_ascii=False), encoding='utf8')
    if not (d / 'trabajo' / '.hecho_ingesta').exists():
        correr_etapa(alm, pid, 'ingesta', encadenar=False)

    def clasificar(estado, datos):
        respuesta.update(estado=estado, datos=datos)
        pedidos.clear()
        (d / 'trabajo' / '.hecho_clasificar').unlink(missing_ok=True)
        correr_etapa(alm, pid, 'clasificar', encadenar=False)
        return alm.estado(pid)['clasificacion']

    fallas = []

    def ver(cond, msj):
        print(('ok    ' if cond else 'FALLA ') + msj)
        if not cond:
            fallas.append(msj)

    # 1. Claude elige
    cl = clasificar(200, {'ok': True, 'datos': {'tipo': 'pantalla', 'porque': 'Se ve un escritorio con ventanas y casi nunca una cara.'},
                          'uso': {'entrada': 1200, 'salida': 40}})
    ver(len(pedidos) == 1, f'un solo pedido a Studio ({len(pedidos)})')
    p = pedidos[0] if pedidos else {}
    ver(p.get('auth') == f'Bearer {SECRETO}' and p.get('path') == '/api/long-form/ia', 'con el secreto del motor, a /api/long-form/ia')
    ver(p.get('proyecto_id') == pid and p.get('paso') == 'longform-clasificar', 'dice de qué proyecto y qué paso es')
    bl = p.get('contenido') or []
    imgs = [i for i, b in enumerate(bl) if b['type'] == 'image']
    ver(len(imgs) == 4, f'cuatro cuadros ({len(imgs)})')
    ver(all(i > 0 and bl[i - 1]['type'] == 'text' and bl[i - 1]['text'].startswith('Minuto') for i in imgs), 'cada cuadro lleva su minuto delante')
    ver(all(b['source']['media_type'] == 'image/jpeg' and len(b['source']['data']) > 1000 for b in bl if b['type'] == 'image'), 'los cuadros son JPEG de verdad')
    ver(p.get('esquema', {}).get('properties', {}).get('tipo', {}).get('enum') == ['una_camara', 'pantalla', 'podcast'],
        'Claude solo puede elegir entre los tipos que quedaron en pie')
    ver(cl['tipo'] == 'pantalla' and cl['por_ia'] is True, f'se usa lo que eligió Claude ({cl["tipo"]}, por_ia={cl["por_ia"]})')
    ver(any('La IA miró los cuadros y eligió «Grabación de pantalla»: Se ve un escritorio' in r for r in cl['razones']), 'la razón queda en la evidencia')

    # 2. La cuenta no tiene Claude
    cl = clasificar(409, {'ok': False, 'sinIA': True, 'error': 'No hay token de Claude configurado.'})
    ver(cl['tipo'] == 'una_camara' and not cl['por_ia'], f'sin Claude queda la regla ({cl["tipo"]})')
    ver(any('Sin clave de Claude' in r for r in cl['razones']), 'y lo dice')

    # 3. Studio falla
    cl = clasificar(502, {'ok': False, 'error': 'Claude no devolvió el JSON pedido.'})
    ver(cl['tipo'] == 'una_camara' and not cl['por_ia'], f'si Studio falla queda la regla y la etapa termina ({cl["tipo"]})')
    ver(any('Claude no respondió' in r for r in cl['razones']), 'y lo dice')

    # 4. Claude responde un tipo que no estaba en pie
    cl = clasificar(200, {'ok': True, 'datos': {'tipo': 'meet', 'porque': 'x'}})
    ver(cl['tipo'] == 'una_camara' and not cl['por_ia'], f'un tipo fuera de los candidatos se ignora ({cl["tipo"]})')
    ver(any('respuesta usable' in r for r in cl['razones']), 'y lo dice')

    srv.shutdown()
    C.decidir = regla
    print(f'{len(fallas)} fallas')
    return 1 if fallas else 0


if __name__ == '__main__':
    sys.exit(main())
