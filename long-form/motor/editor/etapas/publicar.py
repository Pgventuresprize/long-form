"""Publicar en YouTube (la dispara una persona desde la app; nunca corre sola).

Sube el video final con título, descripción, capítulos (en tiempo del video final) y etiquetas, por la
subida reanudable de la YouTube Data API v3. La portada es la tarjeta de intro (YouTube solo la acepta si el
canal está verificado; si no, se avisa y el video queda con la portada automática).
Opcional: los clips verticales como Shorts.
"""
import json
import os
import time
from pathlib import Path

from ..contexto import Mapa, desfase

API = 'https://www.googleapis.com'


def token(ctx):
    import requests
    con = ctx.alm.conexion('youtube') if hasattr(ctx.alm, 'conexion') else None
    refresh = (con or {}).get('refresh_token') or os.environ.get('YOUTUBE_REFRESH_TOKEN')
    if not refresh:
        raise RuntimeError('YouTube no está conectado: conéctalo en Configuración de la app')
    r = requests.post('https://oauth2.googleapis.com/token', timeout=60, data={
        'client_id': os.environ['GOOGLE_CLIENT_ID'], 'client_secret': os.environ['GOOGLE_CLIENT_SECRET'],
        'refresh_token': refresh, 'grant_type': 'refresh_token'})
    if r.status_code != 200:
        raise RuntimeError(f'No pude renovar el acceso a YouTube ({r.status_code}): vuelve a conectarlo')
    return r.json()['access_token']


def capitulos(ctx, g):
    """Capitulos en tiempo del video final (despues del gancho y la intro). YouTube exige: el primero en 0:00, al
    menos 3, de 10 s o mas. Con la opcion capitulos en falso, ninguno."""
    if hasattr(ctx, 'eleccion') and ctx.eleccion('capitulos', True) is False:
        return ''
    gr = ctx.estado['graficos']
    mapa = Mapa([tuple(k) for k in ctx.estado['keep']], ctx.FPS, desfase(gr))
    caps = [(0.0 if i == 0 else mapa.salida(c['inicio']), c['titulo']) for i, c in enumerate(g.get('capitulos', []))]
    limpio = []
    for t, titulo in caps:
        if limpio and t - limpio[-1][0] < 10:
            continue
        limpio.append((t, titulo))
    if len(limpio) < 3:
        return ''

    def mmss(t):
        t = int(t)
        return f'{t // 3600}:{t // 60 % 60:02d}:{t % 60:02d}' if t >= 3600 else f'{t // 60}:{t % 60:02d}'
    return '\n'.join(f'{mmss(t)} {titulo}' for t, titulo in limpio)


def subir(ctx, tok, ruta, meta):
    import requests
    tam = os.path.getsize(ruta)
    r = requests.post(f'{API}/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status', json=meta, timeout=60,
                      headers={'Authorization': f'Bearer {tok}', 'X-Upload-Content-Length': str(tam),
                               'X-Upload-Content-Type': 'video/mp4'})
    if r.status_code != 200:
        raise RuntimeError(f'YouTube rechazó la subida ({r.status_code}): {r.text[:400]}')
    url = r.headers['Location']
    trozo = 32 * 1024 * 1024
    off = 0
    with open(ruta, 'rb') as f:
        while off < tam:
            f.seek(off)
            datos = f.read(trozo)
            fin = off + len(datos) - 1
            for intento in range(6):
                try:
                    r = requests.put(url, data=datos, timeout=600, headers={
                        'Authorization': f'Bearer {tok}', 'Content-Range': f'bytes {off}-{fin}/{tam}'})
                    break
                except requests.RequestException:
                    if intento == 5:
                        raise
                    time.sleep(2 ** intento)
            if r.status_code in (200, 201):
                return r.json()['id']
            if r.status_code == 308:
                rango = r.headers.get('Range')
                off = int(rango.split('-')[1]) + 1 if rango else 0
                ctx.avance(f'Subiendo a YouTube {off / tam:.0%}', off / tam)
                continue
            raise RuntimeError(f'Subida a YouTube falló ({r.status_code}): {r.text[:300]}')
    raise RuntimeError('La subida terminó sin respuesta de YouTube')


def correr(ctx):
    import requests
    pedido = ctx.estado.get('publicar_pedido') or {}
    g = ctx.aprobado('guion') or {}
    yt = dict(g.get('youtube') or {})
    yt.update({k: v for k, v in pedido.items() if k in ('titulo', 'descripcion', 'etiquetas')})
    r = ctx.estado['render']
    ruta = Path(r['local'])
    if not ruta.exists():
        ruta = ctx.alm.traer(ctx.pid, r['remoto'], ctx.salida / r['archivo'])
    desc = (yt.get('descripcion') or '').strip()
    caps = capitulos(ctx, g)
    if caps:
        desc += '\n\nCapítulos\n' + caps
    m = ctx.marca
    desc += '\n\n' + '\n'.join(f'{red}: {handle}' for red, handle in m.redes)
    if m.cfg.get('web'):
        desc += f'\n{m.cfg["web"]}'
    estado = {'privacyStatus': pedido.get('privacidad', 'private'), 'selfDeclaredMadeForKids': False}
    if pedido.get('programar'):
        estado['privacyStatus'] = 'private'
        estado['publishAt'] = pedido['programar']
    meta = {'snippet': {'title': (yt.get('titulo') or ctx.spec.get('titulo'))[:100], 'description': desc[:4900],
                        'tags': (yt.get('etiquetas') or [])[:15], 'categoryId': pedido.get('categoria', '27'),
                        'defaultLanguage': ctx.spec.get('idioma', 'es'), 'defaultAudioLanguage': ctx.spec.get('idioma', 'es')},
            'status': estado}
    tok = token(ctx)
    ctx.avance('Subiendo el video a YouTube', 0)
    vid = subir(ctx, tok, ruta, meta)
    ctx.log(f'video en YouTube: https://youtu.be/{vid}')
    portada = Path(ctx.estado['graficos']['intro'])
    if portada.exists():
        with open(portada, 'rb') as f:
            rr = requests.post(f'{API}/upload/youtube/v3/thumbnails/set?videoId={vid}', data=f, timeout=120,
                               headers={'Authorization': f'Bearer {tok}', 'Content-Type': 'image/png'})
        if rr.status_code != 200:
            ctx.aviso('YouTube no aceptó la portada (el canal debe estar verificado): quedó la automática.')
    shorts = []
    if pedido.get('shorts'):
        for c in ctx.estado.get('clips', []):
            arch = next((a for a in c['archivos'] if a.endswith('_div.mp4')), c['archivos'][0])
            p = ctx.salida / arch
            if not p.exists():
                continue
            texto = (c.get('tiktok') or c.get('titulo') or '')[:4900]
            sid = subir(ctx, tok, p, {'snippet': {'title': c['titulo'][:95] + ' #Shorts', 'description': texto, 'categoryId': '27'},
                                      'status': {'privacyStatus': estado['privacyStatus'], 'selfDeclaredMadeForKids': False}})
            shorts.append({'clip': c['n'], 'id': sid})
            ctx.log(f'Short {c["n"]}: https://youtube.com/shorts/{sid}')
    ctx.guardar('publicado', {'youtube_id': vid, 'url': f'https://youtu.be/{vid}', 'privacidad': estado['privacyStatus'],
                              'version': r['version'], 'shorts': shorts, 'fecha': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
                              'meta': json.loads(json.dumps(meta['snippet']))})
