"""Caras en un cuadro: YuNet (el detector de OpenCV, modelo en modelos/, licencia MIT).

YuNet ve caras de frente y de perfil, chicas y lejanas (tres personas en una mesa de café, a 640 px), y da
cinco puntos de cada cara: ojos, nariz y las dos comisuras de la boca. La boca sirve para ver quién habla.
Si falta el modelo o la versión de OpenCV no lo trae, se usa Haar (frontal y de perfil), que ve menos y no
da la boca: la posición de la boca se supone.
"""
from pathlib import Path

MODELO = Path(__file__).resolve().parent.parent / 'modelos' / 'face_detection_yunet_2023mar.onnx'
UMBRAL = 0.6
# dónde cae la boca dentro de la caja de la cara, si el detector no la da (cara de frente)
BOCA = (0.5, 0.78)


class Detector:
    def __init__(self, umbral=UMBRAL):
        import cv2
        self.cv2 = cv2
        self.yn = None
        self.tam = None
        if MODELO.exists() and hasattr(cv2, 'FaceDetectorYN'):
            self.yn = cv2.FaceDetectorYN.create(str(MODELO), '', (320, 320), umbral, 0.3, 200)
        else:
            self.frontal = cv2.CascadeClassifier(cv2.data.haarcascades + 'haarcascade_frontalface_default.xml')
            self.perfil = cv2.CascadeClassifier(cv2.data.haarcascades + 'haarcascade_profileface.xml')

    @property
    def nombre(self):
        return 'yunet' if self.yn is not None else 'haar'

    def caras(self, im, min_rel=1 / 30):
        """im: BGR o gris. Caras de al menos `min_rel` del ancho del cuadro:
        [{'caja': [x, y, w, h], 'boca': [x, y] | None, 'p': confianza}], en píxeles del cuadro."""
        cv2 = self.cv2
        h, w = im.shape[:2]
        m = max(8, int(w * min_rel))
        if self.yn is not None:
            bgr = cv2.cvtColor(im, cv2.COLOR_GRAY2BGR) if im.ndim == 2 else im
            if self.tam != (w, h):
                self.yn.setInputSize((w, h))
                self.tam = (w, h)
            _, r = self.yn.detect(bgr)
            out = []
            for c in ([] if r is None else r):
                if c[2] < m:
                    continue
                out.append({'caja': [float(v) for v in c[:4]],
                            'boca': [float((c[10] + c[12]) / 2), float((c[11] + c[13]) / 2)], 'p': float(c[14])})
            return out
        g = im if im.ndim == 2 else cv2.cvtColor(im, cv2.COLOR_BGR2GRAY)
        fs = [list(c) for c in self.frontal.detectMultiScale(g, 1.1, 5, minSize=(m, m))]
        if not fs:
            fs = [list(c) for c in self.perfil.detectMultiScale(g, 1.1, 5, minSize=(m, m))]
            espejo = self.perfil.detectMultiScale(cv2.flip(g, 1), 1.1, 5, minSize=(m, m))
            fs += [[w - x - cw, y, cw, ch] for x, y, cw, ch in espejo]
        return [{'caja': [float(v) for v in c], 'boca': None, 'p': 1.0} for c in fs]
