"""Donde vive cada cosa.

La carpeta de trabajo del worker es una cache: se puede borrar y cada etapa vuelve a traer lo que necesita.
La verdad vive en dos sitios:
  - la base (lf_proyectos.estado): los JSON de cada etapa (reparto, guion, plan...), que la app muestra y edita;
  - el almacenamiento: los archivos de entrada que sube la persona y las salidas listas para publicar.

Hay dos implementaciones con la misma interfaz:
  - Local: una carpeta por proyecto (sirve para probar sin nube).
  - Supabase: PostgREST + Storage (con subida reanudable TUS para archivos de varios GB).
"""
import base64
import json
import os
import shutil
import time
from pathlib import Path

from . import config


class Almacen:
    # ---- interfaz
    def proyecto(self, pid) -> dict: ...
    def estado(self, pid) -> dict: ...
    def guardar(self, pid, clave, valor): ...
    def traer(self, pid, ruta_remota, destino) -> Path: ...
    def subir(self, pid, origen, nombre, tipo=None) -> str: ...
    def fase(self, pid, fase, detalle='', progreso=None): ...
    def log(self, pid, mensaje, nivel='info', etapa=None): ...
    def encolar(self, pid, etapa, datos=None): ...
    def marca(self, slug) -> Path: ...

    def carpeta(self, pid) -> Path:
        d = config.DATOS / 'proyectos' / str(pid)
        for sub in ('entrada', 'trabajo', 'salida'):
            (d / sub).mkdir(parents=True, exist_ok=True)
        return d


def _json_escribe(ruta, valor):
    tmp = Path(str(ruta) + f'.{os.getpid()}.tmp')
    tmp.write_text(json.dumps(valor, ensure_ascii=False, indent=1), encoding='utf8')
    os.replace(tmp, ruta)


class AlmacenLocal(Almacen):
    """proyectos/<id>/proyecto.json + estado/*.json; las entradas se copian desde donde diga el proyecto."""

    def __init__(self, raiz=None):
        self.raiz = Path(raiz or config.DATOS)
        self.cola = []

    def carpeta(self, pid):
        d = self.raiz / 'proyectos' / str(pid)
        for sub in ('entrada', 'trabajo', 'salida', 'estado'):
            (d / sub).mkdir(parents=True, exist_ok=True)
        return d

    def proyecto(self, pid):
        return json.loads((self.carpeta(pid) / 'proyecto.json').read_text(encoding='utf-8-sig'))

    def estado(self, pid):
        out = {}
        for p in sorted((self.carpeta(pid) / 'estado').glob('*.json')):
            out[p.stem] = json.loads(p.read_text(encoding='utf-8-sig'))
        return out

    def guardar(self, pid, clave, valor):
        _json_escribe(self.carpeta(pid) / 'estado' / f'{clave}.json', valor)

    def traer(self, pid, ruta_remota, destino):
        destino = Path(destino)
        if destino.exists():
            return destino
        origen = Path(ruta_remota)
        if not origen.is_absolute():
            origen = self.carpeta(pid) / 'fuentes' / ruta_remota
        destino.parent.mkdir(parents=True, exist_ok=True)
        # enlace en vez de copia: los originales pueden pesar varios GB
        try:
            os.link(origen, destino)
        except OSError:
            shutil.copy2(origen, destino)
        return destino

    def subir(self, pid, origen, nombre, tipo=None, clase='salida', version=None):
        d = self.carpeta(pid) / 'publicado'
        d.mkdir(exist_ok=True)
        shutil.copy2(origen, d / nombre)
        return str(d / nombre)

    def etapa_hecha(self, pid, etapa, inicio, fin, costo):
        self.log(pid, f'{etapa} en {fin - inicio:.1f} s · {json.dumps(costo, ensure_ascii=False)}', 'etapa', etapa)

    def aviso(self, pid, tipo, titulo, cuerpo='', accion=None):
        self.log(pid, f'aviso {tipo}: {titulo}', 'aviso')

    def fase(self, pid, fase, detalle='', progreso=None):
        _json_escribe(self.carpeta(pid) / 'fase.json', {'fase': fase, 'detalle': detalle, 'progreso': progreso, 't': time.time()})
        print(f'[{pid}] fase={fase} {detalle} {"" if progreso is None else f"{progreso:.0%}"}', flush=True)

    def log(self, pid, mensaje, nivel='info', etapa=None):
        linea = f'{time.strftime("%H:%M:%S")} {nivel:5s} {etapa or "":12s} {mensaje}'
        print(f'[{pid}] {linea}', flush=True)
        with open(self.carpeta(pid) / 'registro.txt', 'a', encoding='utf8') as f:
            f.write(linea + '\n')

    def encolar(self, pid, etapa, datos=None, quien='motor'):
        self.cola.append((pid, etapa, datos or {}))

    def marca(self, slug):
        """En local la marca es una carpeta con marca.json (un preset), por ruta o en LF_DATOS/marcas."""
        p = Path(slug)
        return p if (p / 'marca.json').exists() else self.raiz / 'marcas' / slug


class AlmacenSupabase(Almacen):
    """PostgREST para tablas y RPC, Storage para archivos. Usa la clave service_role: corre solo en el servidor.

    Las tablas son las de Studio (supabase/migraciones/2026-11-08-long-form.sql): cada fila lleva su cuenta y
    las rutas del bucket van por cuenta y proyecto (<cuenta>/<proyecto>/salida/...)."""

    TUS_CHUNK = 6 * 1024 * 1024   # Supabase exige trozos de 6 MB en la subida reanudable
    UMBRAL_TUS = 40 * 1024 * 1024  # por encima, subida reanudable

    def __init__(self):
        import requests
        self.rq = requests.Session()
        self.url = config.SUPABASE_URL
        self.rq.headers.update({'apikey': config.SUPABASE_KEY, 'Authorization': f'Bearer {config.SUPABASE_KEY}'})
        self._marcas = {}
        self._cuentas = {}

    def cuenta(self, pid):
        if pid not in self._cuentas:
            self._cuentas[pid] = self._get('lf_proyectos', id=f'eq.{pid}', select='account_id')[0]['account_id']
        return self._cuentas[pid]

    # ---- PostgREST
    def _get(self, tabla, **filtros):
        r = self.rq.get(f'{self.url}/rest/v1/{tabla}', params=filtros, timeout=60)
        r.raise_for_status()
        return r.json()

    def _patch(self, tabla, filtros, datos):
        r = self.rq.patch(f'{self.url}/rest/v1/{tabla}', params=filtros, json=datos,
                          headers={'Prefer': 'return=minimal'}, timeout=60)
        r.raise_for_status()

    def _post(self, tabla, datos):
        r = self.rq.post(f'{self.url}/rest/v1/{tabla}', json=datos, headers={'Prefer': 'return=minimal'}, timeout=60)
        r.raise_for_status()

    def rpc(self, nombre, **args):
        r = self.rq.post(f'{self.url}/rest/v1/rpc/{nombre}', json=args, timeout=60)
        r.raise_for_status()
        return r.json() if r.text else None

    def proyecto(self, pid):
        filas = self._get('lf_proyectos', id=f'eq.{pid}', select='id,account_id,titulo,tipo,esfuerzo,notas,cta_defecto,spec')
        if not filas:
            raise KeyError(f'proyecto {pid} no existe')
        p = filas[0]
        self._cuentas[pid] = p['account_id']
        spec = dict(p.get('spec') or {})
        # La marca es la cuenta: su estilo long form se arma como carpeta en marca().
        spec.update({'id': p['id'], 'titulo': p['titulo'], 'tipo': p['tipo'] or spec.get('tipo') or 'camaras',
                     'marca': p['account_id'], 'account_id': p['account_id'], 'esfuerzo': p['esfuerzo'],
                     'notas_editoriales': spec.get('notas_editoriales') or p.get('notas') or '', 'cta_defecto': p.get('cta_defecto')})
        spec['archivos'] = self._get('lf_archivos', proyecto_id=f'eq.{pid}', subida='eq.lista', select='*', order='creado.asc')
        return spec

    def estado(self, pid):
        return self._get('lf_proyectos', id=f'eq.{pid}', select='estado')[0].get('estado') or {}

    def guardar(self, pid, clave, valor):
        # merge atomico en jsonb: dos etapas no se pisan las claves
        self.rpc('lf_guardar_estado', p_proyecto=pid, p_clave=clave, p_valor=valor)

    # ---- Storage
    def traer(self, pid, ruta_remota, destino):
        destino = Path(destino)
        if destino.exists() and destino.stat().st_size > 0:
            return destino
        destino.parent.mkdir(parents=True, exist_ok=True)
        tmp = destino.with_suffix(destino.suffix + '.part')
        with self.rq.get(f'{self.url}/storage/v1/object/{config.BUCKET}/{ruta_remota}', stream=True, timeout=600) as r:
            r.raise_for_status()
            with open(tmp, 'wb') as f:
                for b in r.iter_content(8 * 1024 * 1024):
                    f.write(b)
        os.replace(tmp, destino)
        return destino

    def subir(self, pid, origen, nombre, tipo=None, clase='salida', version=None):
        """Sube a <cuenta>/<proyecto>/salida/<nombre>. La fila de lf_archivos se reemplaza si ya existia:
        subir dos veces lo mismo no la duplica. Los renders llevan su version en el nombre."""
        cuenta = self.cuenta(pid)
        clave = f'{cuenta}/{pid}/salida/{nombre}'
        tam = os.path.getsize(origen)
        tipo = tipo or _tipo(nombre)
        if tam < self.UMBRAL_TUS:
            with open(origen, 'rb') as f:
                r = self.rq.post(f'{self.url}/storage/v1/object/{config.BUCKET}/{clave}', data=f,
                                 headers={'Content-Type': tipo, 'x-upsert': 'true'}, timeout=600)
            r.raise_for_status()
        else:
            self._tus(origen, clave, tipo, tam)
        r = self.rq.post(f'{self.url}/rest/v1/lf_archivos', params={'on_conflict': 'ruta'}, timeout=60,
                         headers={'Prefer': 'resolution=merge-duplicates,return=minimal'},
                         json={'account_id': cuenta, 'proyecto_id': pid, 'tipo': clase, 'nombre': nombre, 'ruta': clave,
                               'bytes': tam, 'mime': tipo, 'version': version, 'subida': 'lista'})
        r.raise_for_status()
        return clave

    def _tus(self, origen, clave, tipo, tam):
        meta = ','.join(f'{k} {base64.b64encode(v.encode()).decode()}' for k, v in
                        (('bucketName', config.BUCKET), ('objectName', clave), ('contentType', tipo), ('cacheControl', '3600')))
        r = self.rq.post(f'{self.url}/storage/v1/upload/resumable', timeout=60, headers={
            'Tus-Resumable': '1.0.0', 'Upload-Length': str(tam), 'Upload-Metadata': meta, 'x-upsert': 'true'})
        r.raise_for_status()
        destino = r.headers['Location']
        off = 0
        with open(origen, 'rb') as f:
            while off < tam:
                f.seek(off)
                trozo = f.read(self.TUS_CHUNK)
                for intento in range(5):
                    try:
                        r = self.rq.patch(destino, data=trozo, timeout=300, headers={
                            'Tus-Resumable': '1.0.0', 'Upload-Offset': str(off),
                            'Content-Type': 'application/offset+octet-stream'})
                        r.raise_for_status()
                        break
                    except Exception:
                        if intento == 4:
                            raise
                        time.sleep(2 ** intento)
                        h = self.rq.head(destino, headers={'Tus-Resumable': '1.0.0'}, timeout=60)
                        off = int(h.headers.get('Upload-Offset', off))
                        f.seek(off)
                        trozo = f.read(self.TUS_CHUNK)
                off = int(r.headers.get('Upload-Offset', off + len(trozo)))

    # ---- avance y registro
    TABLERO = {'revision_reparto': 'revision', 'revision_guion': 'revision', 'listo': 'listo', 'error': 'error'}

    def fase(self, pid, fase, detalle='', progreso=None):
        self._patch('lf_proyectos', {'id': f'eq.{pid}'}, {'fase': fase, 'detalle': (detalle or '')[:500], 'progreso': progreso,
                                                         'tablero': self.TABLERO.get(fase, 'procesando'),
                                                         'actualizado': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())})

    def log(self, pid, mensaje, nivel='info', etapa=None):
        print(f'[{pid}] {nivel} {etapa or ""} {mensaje}', flush=True)
        try:
            self._post('lf_eventos', {'account_id': self.cuenta(pid), 'proyecto_id': pid, 'nivel': nivel, 'etapa': etapa,
                                      'mensaje': mensaje[:4000]})
        except Exception:  # noqa: BLE001
            pass

    def etapa_hecha(self, pid, etapa, inicio, fin, costo):
        """La linea de tiempo: cuanto tardo la etapa y cuanto costo."""
        iso = lambda t: time.strftime('%Y-%m-%dT%H:%M:%S', time.gmtime(t)) + f'.{int(t % 1 * 1000):03d}Z'  # noqa: E731
        try:
            self._post('lf_eventos', {'account_id': self.cuenta(pid), 'proyecto_id': pid, 'nivel': 'etapa', 'etapa': etapa,
                                      'mensaje': f'{etapa} en {fin - inicio:.0f} s', 'inicio': iso(inicio), 'fin': iso(fin),
                                      'duracion_ms': int((fin - inicio) * 1000), 'costo': costo})
        except Exception:  # noqa: BLE001
            pass

    def aviso(self, pid, tipo, titulo, cuerpo='', accion=None):
        """Un aviso de la campana de Studio."""
        try:
            self._post('lf_avisos', {'account_id': self.cuenta(pid), 'proyecto_id': pid, 'tipo': tipo, 'titulo': titulo[:200],
                                     'cuerpo': cuerpo[:1000], 'accion': accion or f'/long-form/{pid}'})
        except Exception:  # noqa: BLE001
            pass

    def encolar(self, pid, etapa, datos=None, quien='motor'):
        self.rpc('lf_encolar', p_proyecto=pid, p_etapa=etapa, p_datos=datos or {}, p_quien=quien)

    def marca(self, cuenta):
        """El estilo long form de la cuenta, armado como carpeta. Se rehace cuando el estilo cambia."""
        if cuenta in self._marcas:
            return self._marcas[cuenta]
        from . import estilo
        filas = self._get('lf_estilos', account_id=f'eq.{cuenta}', select='config,updated_at')
        if not filas:
            raise RuntimeError('La marca no tiene estilo de long form: se configura en Marca > Estilo editorial > Long form')
        e = filas[0]
        d = config.DATOS / 'marcas' / str(cuenta)
        firma = d / '.firma'
        if not (firma.exists() and firma.read_text() == str(e['updated_at'])):
            bib = {f['id']: f for f in self._get('lf_biblioteca', account_id=f'eq.{cuenta}', select='id,ruta,formato')}
            estilo.armar(e['config'], self._bajar, d, bib)
            firma.write_text(str(e['updated_at']))
        self._marcas[cuenta] = d
        return d

    def _bajar(self, bucket, ruta, destino):
        destino = Path(destino)
        destino.parent.mkdir(parents=True, exist_ok=True)
        r = self.rq.get(f'{self.url}/storage/v1/object/{bucket}/{ruta}', timeout=300)
        r.raise_for_status()
        destino.write_bytes(r.content)
        return destino

    def conexion(self, proveedor):
        return None   # publicar en YouTube queda fuera de long form por ahora

    # ---- cola
    def reclamar(self):
        filas = self.rpc('lf_reclamar', p_worker=config.WORKER_ID, p_lease_seg=900, p_quien='motor')
        return filas[0] if filas else None

    def latido(self, trabajo_id):
        self.rpc('lf_latido', p_trabajo=trabajo_id, p_lease_seg=900)

    def terminar(self, trabajo_id, ok, error=None, costo=None):
        self.rpc('lf_terminar', p_trabajo=trabajo_id, p_ok=ok, p_error=(error or '')[:4000], p_costo=costo)


def _tipo(nombre):
    ext = nombre.rsplit('.', 1)[-1].lower()
    return {'mp4': 'video/mp4', 'mov': 'video/quicktime', 'png': 'image/png', 'jpg': 'image/jpeg', 'json': 'application/json',
            'md': 'text/markdown', 'srt': 'application/x-subrip', 'txt': 'text/plain', 'wav': 'audio/wav'}.get(ext, 'application/octet-stream')


def crear():
    return AlmacenSupabase() if config.SUPABASE_URL and config.SUPABASE_KEY else AlmacenLocal()
