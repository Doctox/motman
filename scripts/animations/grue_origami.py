# Animation de portrait « Grue en origami » (légendaire, vague Légendes, 13/10/2026).
# Lancer depuis ce dossier :  python grue_origami.py [dossier de sortie]
# Une feuille de papier corail apparaît en tournant au-dessus du portrait, se
# plie en grue, puis la grue bat des ailes, fait le tour du portrait en semant
# des éclats dorés, et s'envole. Le cycle revient au vide : boucle sans couture.
import math
import sys

import numpy as np
from PIL import Image, ImageDraw

from motlib import SS
from pil_outils import C, canevas, ecrire, halo, lisse, reduit

NF = 72
DUR = 110
CLAIR = (232, 118, 80)
MOYEN = (201, 77, 41)                 # --mm-coral
SOMBRE = (150, 52, 28)
OR = (214, 172, 82)
OR_CLAIR = (250, 222, 150)
APPARITION = (0.00, 0.08)
PLIAGE = (0.06, 0.30)
VOL = (0.30, 0.86)
DEPART = (0.86, 0.97)

# La grue, de profil, tournée vers la droite (px 224, y vers le bas).
# Chaque facette : (sommets, teinte, case de la feuille dont elle provient).
O, T, R, B, L = (0, -3), (0, -15), (12, -3), (0, 9), (-12, -3)
mTR, mRB, mBL, mLT = (6, -9), (6, 3), (-6, 3), (-6, -9)
AILE_HAUTE, AILE_BASSE = (-2.0, -23.0), (1.0, 13.0)


def grue(battement):
    """Facettes de la grue ; battement in [-1, 1] (1 = ailes hautes).
    Chaque aile a deux pans de part et d'autre de son pli central."""
    q = (battement + 1) / 2
    pointe = tuple(AILE_BASSE[i] + (AILE_HAUTE[i] - AILE_BASSE[i]) * q for i in range(2))
    pli = (pointe[0] * 0.55 + 0.2, pointe[1] * 0.55 - 1.2)
    lointaine = (pointe[0] + 4.0, pointe[1] * 0.84 + 0.5)
    pli_l = (lointaine[0] * 0.55 + 1.5, lointaine[1] * 0.55 - 1.0)
    return [
        ([(-4, -2), (4, -2), lointaine], SOMBRE, (O, mLT, T)),             # aile lointaine
        ([(-3, -1), (-9, 3), (-19, -13)], MOYEN, (O, L, mLT)),             # queue
        ([(-9, 2), (0, -3), (0, 7)], MOYEN, (O, B, mBL)),                  # corps, moitié arrière
        ([(0, -3), (9, 2), (0, 7)], CLAIR, (O, mRB, B)),                   # corps, moitié avant
        ([(3, -1), (9, 3), (18, -14)], CLAIR, (O, mTR, R)),                # cou
        ([(18, -14), (15.6, -14.6), (22.5, -9.5)], SOMBRE, (O, R, mRB)),   # tête
        ([(-5, -2), (0.5, -2.5), pointe], CLAIR, (O, T, mTR)),             # aile proche, pan avant
        ([(0.5, -2.5), (5, -2), pointe], MOYEN, (O, mBL, L)),              # aile proche, pan arrière
    ]


def feuille():
    """Facettes de la feuille carrée encore à plat (mêmes cases que la grue)."""
    return [cases for _, _, cases in grue(1)]


def melange(c1, c2, q):
    return tuple(int(c1[i] + (c2[i] - c1[i]) * q) for i in range(3))


def place(pts, x, y, angle, ech, miroir):
    c, s = math.cos(angle), math.sin(angle)
    out = []
    for px, py in pts:
        px = -px if miroir else px
        out.append(((x + (px * c - py * s) * ech) * SS, (y + (px * s + py * c) * ech) * SS))
    return out


def etoile(d, x, y, r, couleur):
    pts = []
    for i in range(8):
        a = i * math.pi / 4
        rr = r if i % 2 == 0 else r * 0.32
        pts.append(((x + rr * math.cos(a)) * SS, (y + rr * math.sin(a)) * SS))
    d.polygon(pts, fill=couleur)


def trajet(u):
    """Position et vitesse sur le tour du portrait : u in [0, 1]."""
    a = math.radians(-128 + 318 * u)
    r = 70 + 3 * math.sin(2 * math.pi * u)
    x, y = C + r * math.cos(a), C + 0.92 * r * math.sin(a) - 4 * math.sin(math.pi * u)
    return x, y


DEPART_XY = trajet(0.0)


def render(f):
    t = f / NF
    im, d = canevas()
    sillage = []
    if t < PLIAGE[1]:
        # la feuille apparaît, tourne et se plie
        app = lisse(*APPARITION, t)
        pli = lisse(*PLIAGE, t)
        x, y = DEPART_XY[0], DEPART_XY[1] - 6 * (1 - pli)
        angle = math.radians(200 * (1 - pli) ** 1.5 + 8 * math.sin(2 * math.pi * pli))
        ech = (0.6 + 0.6 * app) * (1 - 0.15 * math.sin(math.pi * pli))
        for (sommets, teinte, cases), cases_plat in zip(grue(math.cos(math.pi * pli * 3)), feuille()):
            pts = [tuple(cases_plat[i][k] + (sommets[i][k] - cases_plat[i][k]) * pli for k in range(2)) for i in range(3)]
            # pendant le pliage, les facettes passent par le revers plus clair
            couleur = melange(CLAIR, teinte, lisse(0.3, 1, pli)) if pli < 1 else teinte
            alpha = int(255 * app)
            poly = place(pts, x, y, angle, ech * 1.25, False)
            d.polygon(poly, fill=couleur + (alpha,), outline=OR + (alpha,), width=max(2, int(0.35 * SS)))
        if 0.02 < t < 0.12:
            etoile(d, x + 14, y - 12, 4.5 * math.sin(math.pi * lisse(0.02, 0.12, t)), OR_CLAIR + (230,))
    elif t < DEPART[1]:
        if t < VOL[1]:
            u = lisse(VOL[0], VOL[1], t) * 0.88 + (t - VOL[0]) / (VOL[1] - VOL[0]) * 0.12
            ech, alpha = 1.3, 255
        else:
            q = lisse(*DEPART, t)
            u = 1.0 + 0.12 * q
            ech, alpha = 1.3 * (1 - 0.55 * q), int(255 * (1 - q))
        x, y = trajet(u)
        if t >= VOL[1]:
            y -= 8 * lisse(*DEPART, t)
        x2, y2 = trajet(u + 0.01)
        vx, vy = x2 - x, y2 - y
        miroir = vx < 0
        pente = math.atan2(vy, abs(vx) + 1e-6)
        angle = max(-0.6, min(0.6, pente)) * (-1 if miroir else 1)
        battement = math.sin(2 * math.pi * f / 6)
        for sommets, teinte, _ in grue(battement):
            poly = place(sommets, x, y + 1.2 * battement, angle, ech, miroir)
            d.polygon(poly, fill=teinte + (alpha,), outline=OR + (alpha,), width=max(2, int(0.35 * SS)))
        # sillage d'éclats dorés
        for k in range(1, 7):
            uk = u - 0.022 * k
            if uk < 0:
                continue
            xk, yk = trajet(uk)
            if t >= VOL[1]:
                yk -= 8 * lisse(*DEPART, t) * (1 - k / 7)
            yk += 2.5 * math.sin(3 * k + f * 0.7)
            sillage.append((xk, yk, (3.2 - 0.35 * k), int(alpha * (1 - k / 7))))
        if t >= DEPART[1] - 0.04:
            q = lisse(DEPART[1] - 0.04, DEPART[1], t)
            etoile(d, x, y, 7 * math.sin(math.pi * q), OR_CLAIR + (230,))
    for xk, yk, r, a in sillage:
        if r > 0.6 and a > 8:
            etoile(d, xk, yk, r, OR_CLAIR + (a,))
    return halo(reduit(im), (255, 214, 170), force=0.3, rayon=2.0)


if __name__ == '__main__':
    sortie = sys.argv[1] if len(sys.argv) > 1 else '.'
    ecrire([render(f) for f in range(NF)], 'grue-origami', DUR, sortie, affiche=34)
