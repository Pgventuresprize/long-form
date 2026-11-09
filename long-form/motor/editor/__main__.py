"""Entrada del motor.

  python -m editor servir [puerto]          # local: /despertar como el endpoint de Modal (LF_MOTOR=local)
  python -m editor trabajar                 # vacia la cola de lf_trabajos y sigue esperando
  python -m editor vaciar                   # vacia la cola y sale (lo que corre cada despertar)
  python -m editor local <id> [etapa|todo]  # pruebas sin base: LF_DATOS/proyectos/<id>
  python -m editor aprobar <id> reparto|guion   # en local: aprueba la propuesta tal cual
"""
import hmac
import json
import os
import sys
import threading
import time

from . import almacen, config
from .pipeline import ORDEN, correr_etapa


def _correr_trabajo(alm, t):
    parar = threading.Event()

    def latir(tid=t['id']):
        # la cola devuelve el trabajo si el motor deja de latir (se cayo o lo reiniciaron)
        while not parar.wait(60):
            try:
                alm.latido(tid)
            except Exception:  # noqa: BLE001
                pass
    threading.Thread(target=latir, daemon=True).start()
    try:
        _, costo = correr_etapa(alm, t['proyecto_id'], t['etapa'])
        alm.terminar(t['id'], True, costo=costo)
    except Exception as e:  # noqa: BLE001
        alm.terminar(t['id'], False, f'{type(e).__name__}: {e}')
    finally:
        parar.set()


def vaciar(alm=None, esperar=False):
    """Toma trabajos hasta que la cola del motor quede vacia. Con esperar, sigue mirando cada pocos segundos."""
    alm = alm or almacen.crear()
    if not isinstance(alm, almacen.AlmacenSupabase):
        sys.exit('Faltan SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY')
    espera = 2
    while True:
        try:
            t = alm.reclamar()
        except Exception as e:  # noqa: BLE001
            print('no pude leer la cola:', e, flush=True)
            if not esperar:
                return
            time.sleep(15)
            continue
        if not t:
            if not esperar:
                return
            time.sleep(min(espera, 20))
            espera = min(espera * 1.5, 20)
            continue
        espera = 2
        _correr_trabajo(alm, t)


def servir(puerto=8787):
    """El endpoint que Studio llama al encolar algo. Responde enseguida y vacia la cola en un hilo; si ya
    hay uno vaciando, no arranca otro (la cola ya garantiza un trabajo por proyecto)."""
    from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
    if not config.SECRETO:
        sys.exit('Falta LF_MOTOR_SECRETO')
    ocupado = threading.Lock()

    def drenar():
        if not ocupado.acquire(blocking=False):
            return
        try:
            vaciar()
        finally:
            ocupado.release()

    class Manejador(BaseHTTPRequestHandler):
        def do_POST(self):  # noqa: N802
            auth = self.headers.get('authorization', '')
            if self.path != '/despertar' or not hmac.compare_digest(auth, f'Bearer {config.SECRETO}'):
                self.send_response(404)
                self.end_headers()
                return
            threading.Thread(target=drenar, daemon=True).start()
            cuerpo = json.dumps({'ok': True}).encode()
            self.send_response(202)
            self.send_header('content-type', 'application/json')
            self.end_headers()
            self.wfile.write(cuerpo)

        def log_message(self, *a):
            pass

    print(f'motor local en http://127.0.0.1:{puerto}/despertar · {config.HILOS} hilos', flush=True)
    # Al arrancar se vacia lo que haya quedado en la cola.
    threading.Thread(target=drenar, daemon=True).start()
    ThreadingHTTPServer(('127.0.0.1', puerto), Manejador).serve_forever()


def local(pid, que='todo', hasta=None):
    alm = almacen.AlmacenLocal()
    etapas = ORDEN if que == 'todo' else [que]
    if que == 'todo':
        hecho = alm.estado(pid)
        etapas = [e for e in ORDEN if {'clasificar': 'clasificacion'}.get(e, e) not in hecho]
    for e in etapas:
        correr_etapa(alm, pid, e, encadenar=False)
        if e == hasta:
            break
        if e == 'transcripcion' and 'reparto_aprobado' not in alm.estado(pid):
            print('>> Revisa estado/reparto.json y apruébalo con: python -m editor aprobar', pid, 'reparto')
            break
        if e == 'plan' and 'guion_aprobado' not in alm.estado(pid):
            print('>> Revisa estado/guion.json y apruébalo con: python -m editor aprobar', pid, 'guion')
            break


def aprobar(pid, que):
    alm = almacen.AlmacenLocal()
    est = alm.estado(pid)
    alm.guardar(pid, f'{que}_aprobado', est[que])
    print('aprobado', que)


if __name__ == '__main__':
    a = sys.argv[1:]
    if not a:
        sys.exit(__doc__)
    if a[0] == 'servir':
        servir(int(a[1]) if len(a) > 1 else int(os.environ.get('LF_MOTOR_PUERTO', '8787')))
    elif a[0] == 'trabajar':
        vaciar(esperar=True)
    elif a[0] == 'vaciar':
        vaciar()
    elif a[0] == 'local':
        local(a[1], a[2] if len(a) > 2 else 'todo', os.environ.get('LF_HASTA'))
    elif a[0] == 'aprobar':
        aprobar(a[1], a[2])
    else:
        sys.exit(__doc__)
