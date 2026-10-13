# Animation de portrait « Bulles de savon » (commun, vague Printemps, 13/10/2026).
# Lancer depuis ce dossier :  python bulles.py [dossier de sortie]
# Des bulles irisees montent de part et d'autre du portrait en ondulant, puis
# eclatent en un petit cercle et quelques gouttelettes. Chaque bulle suit un
# cycle periodique : la boucle n'a pas de couture.
import math
import sys

import numpy as np

from motlib import SS, Canvas, downsample, over_small, stamp_dot, to_image
from pil_outils import C, ecrire, halo, lisse

NF = 56
DUR = 110

# x0 : couloir, y0 -> y1 : montee (px 224), r : rayon, phase, duree : part du
# cycle ou la bulle existe, k : ondulations, sens de l'irisation.
BULLES = (
    dict(x0=50, y0=176, y1=46, r=10.5, phase=0.00, duree=0.62, k=2, iris=1),
    dict(x0=176, y0=182, y1=58, r=8.5, phase=0.20, duree=0.58, k=2, iris=-1),
    dict(x0=34, y0=150, y1=70, r=6.0, phase=0.42, duree=0.52, k=3, iris=1),
    dict(x0=190, y0=150, y1=40, r=11.5, phase=0.56, duree=0.64, k=1, iris=-1),
    dict(x0=66, y0=196, y1=110, r=5.0, phase=0.76, duree=0.48, k=2, iris=1),
    dict(x0=160, y0=200, y1=96, r=6.5, phase=0.88, duree=0.50, k=3, iris=-1),
)
ECLAT = 0.13      # part de la vie de la bulle consacree a l'eclatement


def bulle(cv, x, y, r, e, t, sens):
    R = r * SS
    n = int(R * 1.6) + 6
    ix, iy = int(x * SS), int(y * SS)
    xs = np.arange(ix - n, ix + n + 1, dtype=np.float32) + 0.5 - x * SS
    ys = np.arange(iy - n, iy + n + 1, dtype=np.float32) + 0.5 - y * SS
    X, Y = xs[None, :], ys[:, None]
    d = np.sqrt(X * X + Y * Y); ang = np.arctan2(Y, X)
    h = (ang / (2 * np.pi) + sens * t * 0.8) % 1.0
    teinte = np.stack([0.5 + 0.5 * np.cos(2 * np.pi * (h + o)) for o in (0.0, 0.33, 0.66)], -1)
    teinte = 0.62 + 0.38 * teinte                       # pastel
    w = max(1.1 * SS * r / 10, 2.2)
    anneau = np.exp(-((d - R) / w) ** 2)
    pellicule = np.clip(1 - d / R, 0, 1) ** 0.5 * (d < R) * 0.07
    # liseré gris-bleu fin : la bulle reste visible sur fond creme
    trait = np.exp(-((d - R - w * 0.9) / (w * 0.45)) ** 2) * 0.22
    a = np.clip(anneau * 0.78 + pellicule, 0, 1) * e
    rgb = teinte * (anneau * 0.78)[..., None] + np.array([0.85, 0.92, 1.0]) * pellicule[..., None]
    rgb = rgb / np.maximum(anneau * 0.78 + pellicule, 1e-4)[..., None]
    cv.over(ix - n, iy - n, np.broadcast_to(np.array([0.42, 0.52, 0.62], np.float32), a.shape + (3,)), (trait * e).astype(np.float32))
    cv.over(ix - n, iy - n, rgb.astype(np.float32), a.astype(np.float32))
    # reflets : un croissant en haut a gauche, un point en bas a droite
    stamp_dot(cv, (x - r * 0.42) * SS, (y - r * 0.45) * SS, R * 0.16, (1, 1, 1), 0.85 * e)
    stamp_dot(cv, (x - r * 0.2) * SS, (y - r * 0.6) * SS, R * 0.08, (1, 1, 1), 0.7 * e)
    stamp_dot(cv, (x + r * 0.45) * SS, (y + r * 0.42) * SS, R * 0.07, (1, 1, 1), 0.55 * e)


def eclat(cv, x, y, r, p, sens, graine):
    """p : 0 -> 1 pendant l'eclatement."""
    R = r * SS * (1 + 0.55 * p)
    e = (1 - p) ** 1.4
    n = int(R * 1.4) + 6
    ix, iy = int(x * SS), int(y * SS)
    xs = np.arange(ix - n, ix + n + 1, dtype=np.float32) + 0.5 - x * SS
    ys = np.arange(iy - n, iy + n + 1, dtype=np.float32) + 0.5 - y * SS
    d = np.sqrt(xs[None, :] ** 2 + ys[:, None] ** 2)
    a = np.exp(-((d - R) / (1.2 * SS)) ** 2) * 0.6 * e
    cv.over(ix - n, iy - n, np.broadcast_to(np.array([0.93, 0.88, 1.0], np.float32), a.shape + (3,)), a.astype(np.float32))
    rng = np.random.default_rng(graine)
    for _ in range(6):
        ang = rng.uniform(0, 2 * np.pi); v = rng.uniform(0.9, 1.6)
        dist = r * (1 + v * p * 1.2)
        stamp_dot(cv, (x + dist * math.cos(ang)) * SS, (y + dist * math.sin(ang) + 6 * p * p) * SS,
                  SS * 0.75, (0.78, 0.86, 0.98), 0.9 * e)


def render(f):
    t = f / NF
    cv = Canvas()
    for i, b in enumerate(BULLES):
        u = ((t - b['phase']) % 1.0) / b['duree']
        if u >= 1:
            continue
        monte = min(u / (1 - ECLAT), 1.0)
        y = b['y0'] + (b['y1'] - b['y0']) * (1 - (1 - monte) ** 1.3)
        x = b['x0'] + 5 * math.sin(2 * math.pi * (b['k'] * monte + b['phase']))
        r = b['r'] * (0.45 + 0.55 * lisse(0, 0.25, monte))
        if u < 1 - ECLAT:
            bulle(cv, x, y, r, lisse(0, 0.12, u), t, b['iris'])
        else:
            eclat(cv, x, y, r, (u - (1 - ECLAT)) / ECLAT, b['iris'], 50 + i)
    im = to_image(downsample(cv.p))
    return halo(im, (230, 236, 255), force=0.25, rayon=1.8)


if __name__ == '__main__':
    sortie = sys.argv[1] if len(sys.argv) > 1 else '.'
    ecrire([render(f) for f in range(NF)], 'bulles', DUR, sortie, affiche=10)
