# Animation de portrait « Flocons » (commun, vague Hiver, 13/10/2026).
# Lancer depuis ce dossier :  python flocons.py [dossier de sortie]
# Des cristaux de neige a six branches tombent doucement de part et d'autre
# du portrait en se balancant ; deux plus petits passent devant. Chute,
# balancement et rotation sont periodiques : la boucle n'a pas de couture.
import math
import sys

import numpy as np
from PIL import Image, ImageDraw

from motlib import SS, WS
from pil_outils import C, canevas, ecrire, fenetre, halo, reduit

NF = 60
DUR = 110
TRAIT = (126, 162, 192, 235)     # contour bleu ardoise : lisible sur le creme
COEUR = (255, 255, 255, 255)

# x0 : couloir, r : rayon (px 224), phase : decalage de chute, balance :
# amplitude, k : balancements par boucle, tour : sixiemes de tour par boucle.
FLOCONS = (
    dict(x0=34, r=7.5, phase=0.00, balance=6, k=2, tour=1, alpha=1.0),
    dict(x0=188, r=8.5, phase=0.18, balance=5, k=1, tour=-1, alpha=1.0),
    dict(x0=46, r=5.0, phase=0.38, balance=4, k=3, tour=2, alpha=0.95),
    dict(x0=178, r=5.5, phase=0.55, balance=6, k=2, tour=-2, alpha=0.95),
    dict(x0=196, r=4.2, phase=0.86, balance=3, k=2, tour=-1, alpha=0.9),
    dict(x0=88, r=3.6, phase=0.28, balance=7, k=1, tour=1, alpha=0.75),
    dict(x0=140, r=3.8, phase=0.66, balance=7, k=1, tour=-1, alpha=0.75),
    dict(x0=60, r=6.0, phase=0.92, balance=5, k=2, tour=-1, alpha=0.95),
    dict(x0=165, r=6.5, phase=0.45, balance=5, k=1, tour=1, alpha=0.95),
)
HAUT, BAS = 12.0, 204.0


def cristal(d, cx, cy, r, angle, couleur, largeur):
    """Six branches, deux rameaux par branche, en pixels 4x."""
    for i in range(6):
        a = angle + i * math.pi / 3
        ex, ey = cx + r * math.cos(a), cy + r * math.sin(a)
        d.line([(cx, cy), (ex, ey)], fill=couleur, width=largeur)
        for f, l in ((0.5, 0.36), (0.75, 0.22)):
            bx, by = cx + f * r * math.cos(a), cy + f * r * math.sin(a)
            for s in (-1, 1):
                b = a + s * math.pi / 3
                d.line([(bx, by), (bx + l * r * math.cos(b), by + l * r * math.sin(b))], fill=couleur, width=largeur)
    h = r * 0.2
    d.polygon([(cx + h * math.cos(angle + i * math.pi / 3), cy + h * math.sin(angle + i * math.pi / 3)) for i in range(6)], fill=couleur)


def render(f):
    t = f / NF
    im, _ = canevas()
    for fl in FLOCONS:
        u = (t + fl['phase']) % 1.0
        y = HAUT + (BAS - HAUT) * u
        x = fl['x0'] + fl['balance'] * math.sin(2 * math.pi * (fl['k'] * t + fl['phase']))
        e = fenetre(u, 0.14, 0.18) * fl['alpha']
        if e <= 0.01:
            continue
        angle = 2 * math.pi * fl['tour'] / 6 * t + fl['phase'] * 3
        r = fl['r'] * 1.25 * SS
        calque = Image.new('RGBA', im.size, (0, 0, 0, 0)); d = ImageDraw.Draw(calque)
        larg = max(3, int(r * 0.2))
        cristal(d, x * SS, y * SS, r, angle, TRAIT, larg + 3)
        cristal(d, x * SS, y * SS, r * 0.97, angle, COEUR, max(2, larg - 1))
        if e < 1:
            a = np.asarray(calque).copy(); a[..., 3] = (a[..., 3] * e).astype(np.uint8)
            calque = Image.fromarray(a, 'RGBA')
        im.alpha_composite(calque)
    return halo(reduit(im), (220, 236, 250), force=0.35, rayon=2.0)


if __name__ == '__main__':
    sortie = sys.argv[1] if len(sys.argv) > 1 else '.'
    ecrire([render(f) for f in range(NF)], 'flocons', DUR, sortie, affiche=20)
