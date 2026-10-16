# Animation de portrait « Tasse de thé » (commun, collection Douceur, 16/10/2026).
# Lancer depuis ce dossier :  python tasse_the.py [dossier de sortie]
# Une tasse de porcelaine fume au pied du portrait. Deux volutes de vapeur
# montent en ondulant ; une fois par boucle, elles s'enroulent en un petit
# cœur qui s'élève et se dissipe. Tout est périodique : boucle sans couture.
import math
import sys

import numpy as np
from PIL import Image, ImageDraw

from motlib import SS, Canvas, downsample, stamp_dot, to_image
from pil_outils import C, canevas, ecrire, halo, lisse, reduit

NF = 56
DUR = 110
PORCELAINE = (252, 248, 240)
TRAIT = (96, 78, 62)
BLEU = (98, 128, 176)
OR = (205, 163, 76)
THE = (176, 104, 46)
VAPEUR = (0.80, 0.84, 0.88)
TASSE_X, TASSE_Y = C, C + 60          # posée sur le bas du cadre


def tasse(d):
    """Soucoupe, tasse, anse et thé, en pixels 4x (contours encre douce)."""
    x, y = TASSE_X, TASSE_Y
    s = SS
    lw = max(2, int(1.0 * s))
    # soucoupe
    d.ellipse([(x - 17) * s, (y + 6) * s, (x + 17) * s, (y + 13) * s], fill=PORCELAINE + (255,), outline=TRAIT + (255,), width=lw)
    d.arc([(x - 13) * s, (y + 7.5) * s, (x + 13) * s, (y + 11.5) * s], 0, 180, fill=OR + (255,), width=max(1, int(0.6 * s)))
    # anse
    d.ellipse([(x + 8) * s, (y - 7) * s, (x + 17) * s, (y + 3) * s], outline=TRAIT + (255,), width=int(2.6 * s))
    d.ellipse([(x + 8) * s, (y - 7) * s, (x + 17) * s, (y + 3) * s], outline=PORCELAINE + (255,), width=int(1.3 * s))
    # corps de la tasse : demi-ellipse arrondie
    corps = [(x - 12, y - 8), (x + 12, y - 8)]
    for i in range(1, 20):
        a = math.pi * i / 20
        corps.append((x + 12 * math.cos(a), y - 8 + 15 * math.sin(a)))
    d.polygon([(px * s, py * s) for px, py in corps], fill=PORCELAINE + (255,), outline=TRAIT + (255,))
    d.line([(px * s, py * s) for px, py in corps] + [(corps[0][0] * s, corps[0][1] * s)], fill=TRAIT + (255,), width=lw)
    # frise bleue
    d.arc([(x - 10) * s, (y - 6) * s, (x + 10) * s, (y + 3) * s], 20, 160, fill=BLEU + (255,), width=max(1, int(0.8 * s)))
    for k in (-6, 0, 6):
        r = 1.1
        d.ellipse([(x + k - r) * s, (y + 1.5 - r) * s, (x + k + r) * s, (y + 1.5 + r) * s], fill=BLEU + (255,))
    # bord doré et thé
    d.ellipse([(x - 12) * s, (y - 10.5) * s, (x + 12) * s, (y - 5.5) * s], fill=PORCELAINE + (255,), outline=OR + (255,), width=lw)
    d.ellipse([(x - 10) * s, (y - 9.6) * s, (x + 10) * s, (y - 6.4) * s], fill=THE + (255,))
    d.ellipse([(x - 5) * s, (y - 9.1) * s, (x - 1) * s, (y - 8.2) * s], fill=(222, 160, 98, 255))


def coeur(t):
    """Point du contour d'un cœur, t in [0, 2π), taille unité ~1."""
    return 16 * math.sin(t) ** 3 / 16, -(13 * math.cos(t) - 5 * math.cos(2 * t) - 2 * math.cos(3 * t) - math.cos(4 * t)) / 16


def volute(cv, t, decale, phase, coeur_q):
    """Une volute : des points doux le long d'une ondulation qui monte.
    coeur_q > 0 : la volute se replie en moitié de cœur."""
    for k in range(34):
        s = k / 33                               # 0 en bas (tasse), 1 en haut
        age = (s + t * 1.0 + phase) % 1.0        # la vapeur défile vers le haut
        y = TASSE_Y - 11 - 38 * s
        x = TASSE_X + decale + 4.5 * math.sin(2 * math.pi * (1.4 * s - 2 * t + phase)) * (0.4 + s)
        if coeur_q > 0:
            # moitié de cœur : la volute gauche dessine le lobe gauche, la droite le lobe droit
            ang = math.pi * s * (1 if decale > 0 else -1)
            hx, hy = coeur(ang)
            cx_, cy_ = TASSE_X + 12 * hx, TASSE_Y - 36 + 12 * hy - 8 * coeur_q
            x = x + (cx_ - x) * coeur_q
            y = y + (cy_ - y) * coeur_q
        alpha = math.sin(math.pi * s) ** 0.8 * (0.30 + 0.25 * math.sin(2 * math.pi * age) ** 2)
        if coeur_q > 0:
            alpha = alpha * (1 - coeur_q) + 0.55 * coeur_q * (1 - lisse(0.75, 1.0, coeur_q))
        r = (1.4 + 1.6 * s) * SS
        stamp_dot(cv, x * SS, y * SS, r, VAPEUR, alpha)


def render(f):
    t = f / NF
    # le cœur se forme, monte et se dissipe entre 0,40 et 0,85 de la boucle
    q = lisse(0.40, 0.62, t) * (1 - lisse(0.72, 0.86, t))
    monte = lisse(0.40, 0.86, t)
    cv = Canvas()
    for decale, phase in ((-3.5, 0.0), (3.5, 0.5)):
        volute(cv, t, decale, phase, q * (0.6 + 0.4 * monte))
    vapeur = to_image(downsample(cv.p))
    im, d = canevas()
    tasse(d)
    tasse_img = reduit(im)
    tasse_img.alpha_composite(vapeur)
    return halo(tasse_img, (255, 244, 225), force=0.28, rayon=2.0)


if __name__ == '__main__':
    sortie = sys.argv[1] if len(sys.argv) > 1 else '.'
    ecrire([render(f) for f in range(NF)], 'tasse-the', DUR, sortie, affiche=34)
