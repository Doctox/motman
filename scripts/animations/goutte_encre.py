# Animation de portrait « Goutte d'encre » (précieux, vague Légendes, 13/10/2026).
# Lancer depuis ce dossier :  python goutte_encre.py [dossier de sortie]
# Une goutte d'encre tombe sur le haut du cadre, éclabousse, puis deux traits
# de plume — pleins et déliés, cernés d'or — contournent le portrait et finissent
# en volutes. L'encre s'évapore ensuite en poussière dorée. Le cycle revient au
# vide : la boucle n'a pas de couture.
import math
import sys

import numpy as np
from PIL import Image, ImageDraw

from motlib import SS
from pil_outils import C, canevas, ecrire, halo, lisse, reduit

NF = 64
DUR = 110
ENCRE = (26, 32, 62, 255)
REFLET = (92, 112, 170, 255)
OR = (205, 163, 76, 255)
OR_CLAIR = (246, 214, 140)
R_ARC = 77.0
CHUTE = (0.04, 0.16)          # la goutte se forme puis tombe
TRACE = (0.16, 0.50)          # les deux traits poussent
EVAPORE = (0.70, 0.94)        # l'encre part, de l'impact vers les volutes


def courbe(n=220):
    """Trait droit : arc du sommet vers le bas à droite, puis volute (px 224)."""
    pts = []
    k = int(n * 0.74)
    for i in range(k):
        th = math.radians(-90 + 148 * i / (k - 1))
        r = R_ARC + 3.5 * math.sin(math.pi * i / (k - 1))
        pts.append((C + r * math.cos(th), C + r * math.sin(th)))
    # volute : spirale qui rentre en tournant dans le sens horaire
    th_fin = math.radians(58)
    cx, cy = C + (R_ARC - 10) * math.cos(th_fin), C + (R_ARC - 10) * math.sin(th_fin)
    a0 = math.atan2(pts[-1][1] - cy, pts[-1][0] - cx)
    for i in range(1, n - k + 1):
        q = i / (n - k)
        a = a0 + 2 * math.pi * 1.15 * q
        r = 10 * (1 - 0.72 * q)
        pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    return np.array(pts)


COURBE = courbe()


def largeur(s, direction):
    """Pleins et déliés : plume biseautée à 45°, plus épaisse au départ."""
    base = 1.2 + 5.2 * math.sin(math.pi * min(s / 0.85, 1)) ** 0.8 * (1 - 0.45 * s)
    plume = 0.45 + 0.55 * abs(math.sin(direction - math.radians(45)))
    return max(0.6, base * plume)


def contour(a, b, miroir, extra=0.0):
    """Polygone du trait entre les abscisses curvilignes a et b (fractions)."""
    n = len(COURBE)
    i0, i1 = int(a * (n - 1)), max(int(b * (n - 1)), int(a * (n - 1)) + 2)
    pts = COURBE[i0:i1 + 1].copy()
    if miroir:
        pts[:, 0] = 2 * C - pts[:, 0]
    tang = np.gradient(pts, axis=0)
    tang /= np.maximum(np.linalg.norm(tang, axis=1, keepdims=True), 1e-9)
    nrm = np.stack([-tang[:, 1], tang[:, 0]], 1)
    gauche, droite = [], []
    for j, (p, tg, nm) in enumerate(zip(pts, tang, nrm)):
        s = (i0 + j) / (n - 1)
        w = largeur(s, math.atan2(tg[1], tg[0])) / 2 + extra
        # pointe effilée au bout qui pousse et au bout qui s'évapore
        w *= min(1.0, (j + 1) / 6, (len(pts) - j) / 5)
        gauche.append(tuple((p + nm * w) * SS)); droite.append(tuple((p - nm * w) * SS))
    return gauche + droite[::-1], pts


def goutte(d, x, y, taille, couleur):
    """Goutte en larme, pointe vers le haut (px 224)."""
    pts = []
    for i in range(40):
        a = 2 * math.pi * i / 40
        r = taille * (1 - 0.55 * max(0, math.sin(a - math.pi / 2)) ** 3)
        px = x + r * math.cos(a) * (0.82 if math.sin(a) < 0 else 1)
        py = y + r * math.sin(a) * (1.45 if math.sin(a) < 0 else 1)
        pts.append((px * SS, py * SS))
    d.polygon(pts, fill=couleur)


def render(f):
    t = f / NF
    im, d = canevas()
    haut_x, haut_y = C, C - R_ARC
    # 1. la goutte
    if CHUTE[0] <= t < CHUTE[1] + 0.02:
        q = lisse(CHUTE[0], CHUTE[1], t)
        y = 20 + (haut_y - 20) * q * q
        taille = 2.8 + 2.8 * lisse(CHUTE[0], CHUTE[0] + 0.05, t)
        goutte(d, haut_x, y, taille + 0.9, OR)
        goutte(d, haut_x, y, taille, ENCRE)
    # 2. éclaboussure à l'impact
    if TRACE[0] - 0.01 <= t < TRACE[0] + 0.12:
        q = lisse(TRACE[0] - 0.01, TRACE[0] + 0.12, t)
        rng = np.random.default_rng(4)
        for _ in range(7):
            a = rng.uniform(-math.pi * 0.95, -math.pi * 0.05); v = rng.uniform(5, 11)
            x = haut_x + v * q * math.cos(a); y = haut_y + v * q * math.sin(a) + 9 * q * q
            rr = (1.3 - 0.9 * q) * SS
            if rr > 0.3:
                d.ellipse([x * SS - rr - 3, y * SS - rr - 3, x * SS + rr + 3, y * SS + rr + 3], fill=OR)
                d.ellipse([x * SS - rr, y * SS - rr, x * SS + rr, y * SS + rr], fill=ENCRE)
    # 3. les deux traits
    fin = lisse(TRACE[0], TRACE[1], t) if t >= TRACE[0] else 0.0
    debut = lisse(EVAPORE[0], EVAPORE[1], t)
    if fin > 0.01 and debut < 0.995:
        for miroir in (False, True):
            poly_or, _ = contour(debut, fin, miroir, extra=0.75)
            d.polygon(poly_or, fill=OR)
        for miroir in (False, True):
            poly, pts = contour(debut, fin, miroir)
            d.polygon(poly, fill=ENCRE)
            # reflet bleuté le long du trait
            if len(pts) > 4:
                off = np.array([-0.5, -0.6])
                d.line([tuple((p + off) * SS) for p in pts[2:-2]], fill=REFLET, width=int(0.55 * SS))
            # perle d'encre au bout qui pousse
            if fin < 0.995 and t < TRACE[1]:
                x, y = pts[-1]
                rr = 2.2 * SS
                d.ellipse([x * SS - rr - 3, y * SS - rr - 3, x * SS + rr + 3, y * SS + rr + 3], fill=OR)
                d.ellipse([x * SS - rr, y * SS - rr, x * SS + rr, y * SS + rr], fill=ENCRE)
    # 4. éclat doré qui parcourt l'arabesque achevée
    if TRACE[1] <= t < EVAPORE[0] + 0.05:
        q = lisse(TRACE[1], EVAPORE[0] + 0.05, t)
        for miroir in (False, True):
            x, y = COURBE[int(q * (len(COURBE) - 1))]
            if miroir:
                x = 2 * C - x
            for rr, a in ((3.4, 70), (1.8, 200)):
                d.ellipse([x * SS - rr * SS, y * SS - rr * SS, x * SS + rr * SS, y * SS + rr * SS], fill=OR_CLAIR + (a,))
    # 5. poussière dorée là où l'encre s'évapore
    if EVAPORE[0] <= t < EVAPORE[1] + 0.05:
        rng = np.random.default_rng(int(t * 1000) % 7 + 11)
        for miroir in (False, True):
            for k in range(9):
                age = k / 9
                s = max(0.0, debut - age * 0.16)
                x, y = COURBE[int(s * (len(COURBE) - 1))]
                if miroir:
                    x = 2 * C - x
                x += 3 * math.sin(11 * k + (1 if miroir else 0)); y -= 10 * age + 2 * math.cos(7 * k)
                rr = (1.4 - 1.0 * age) * SS
                a = int(220 * (1 - age) * (1 - lisse(EVAPORE[1] - 0.02, EVAPORE[1] + 0.05, t)))
                if rr > 0.4 and a > 4:
                    d.ellipse([x * SS - rr, y * SS - rr, x * SS + rr, y * SS + rr], fill=OR_CLAIR + (a,))
    return halo(reduit(im), (236, 212, 150), force=0.26, rayon=2.0)


if __name__ == '__main__':
    sortie = sys.argv[1] if len(sys.argv) > 1 else '.'
    ecrire([render(f) for f in range(NF)], 'goutte-encre', DUR, sortie, affiche=40)
