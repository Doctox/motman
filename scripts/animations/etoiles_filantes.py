# Animation de portrait « Étoiles filantes » (rare, vague Hiver, 13/10/2026).
# Lancer depuis ce dossier :  python etoiles_filantes.py [dossier de sortie]
# Trois étoiles filantes glissent en arc autour du portrait, tête d'or blanc et
# traîne dorée qui s'amenuise ; de petites étoiles scintillent à leur passage.
# Passages et scintillements sont périodiques : la boucle n'a pas de couture.
import math
import sys

import numpy as np

from motlib import SS, Canvas, downsample, stamp_dot, stamp_star, to_image
from pil_outils import C, ecrire, halo, lisse

NF = 56
DUR = 100
OR = (0.78, 0.53, 0.16)
OR_CLAIR = (1.0, 0.86, 0.5)
BLANC = (1.0, 0.98, 0.9)

# debut/duree : passage sur la boucle ; a0 -> a1 : arc parcouru (degrés) ;
# r : rayon de l'arc ; trainee : longueur de traîne en degrés.
FILANTES = (
    dict(debut=0.00, duree=0.30, a0=-160, a1=-40, r=84, trainee=38, taille=1.0),
    dict(debut=0.36, duree=0.28, a0=20, a1=130, r=80, trainee=34, taille=0.85),
    dict(debut=0.68, duree=0.30, a0=200, a1=310, r=88, trainee=40, taille=0.95),
)
# petites étoiles fixes : angle, rayon, phase de scintillement, taille
FIXES = [(-120, 92, 0.1, 2.6), (-70, 74, 0.5, 2.0), (-10, 94, 0.8, 2.4), (45, 76, 0.3, 1.8),
         (100, 95, 0.65, 2.2), (150, 78, 0.9, 2.0), (215, 93, 0.2, 2.5), (255, 76, 0.55, 1.9)]


def pos(r, a_deg):
    a = math.radians(a_deg)
    return C + r * math.cos(a), C + 0.95 * r * math.sin(a)


def render(f):
    t = f / NF
    cv = Canvas()
    fx = Canvas()
    for s in FILANTES:
        u = ((t - s['debut']) % 1.0) / s['duree']
        if u >= 1:
            continue
        p = lisse(0, 1, u)                              # accélère puis ralentit
        e = min(lisse(0, 0.12, u), 1 - lisse(0.8, 1, u))
        tete = s['a0'] + (s['a1'] - s['a0']) * p
        sens = 1 if s['a1'] > s['a0'] else -1
        n = 26
        for k in range(n, -1, -1):                      # traîne : de la queue vers la tête
            q = k / n
            a = tete - sens * s['trainee'] * q * (0.4 + 0.6 * e)
            x, y = pos(s['r'] + 2.5 * q, a)
            rr = (2.8 * (1 - q) ** 1.2 + 0.45) * s['taille'] * SS
            al = e * (1 - q) ** 1.3 * 0.92
            col = tuple(OR[i] + (OR_CLAIR[i] - OR[i]) * (1 - q) for i in range(3))
            stamp_dot(cv, x * SS, y * SS, rr, col, al)
        x, y = pos(s['r'], tete)
        stamp_dot(cv, x * SS, y * SS, 3.3 * s['taille'] * SS, OR_CLAIR, e)
        stamp_dot(cv, x * SS, y * SS, 1.6 * s['taille'] * SS, BLANC, e)
        stamp_star(fx, x * SS, y * SS, 9 * s['taille'] * SS, BLANC, 0.9 * e, angle=math.radians(tete * 2))
    for a, r, ph, taille in FIXES:
        # chaque petite étoile s'allume quand une filante passe près d'elle, et scintille un peu
        proche = 0.0
        for s in FILANTES:
            u = ((t - s['debut']) % 1.0) / s['duree']
            if u < 1:
                tete = s['a0'] + (s['a1'] - s['a0']) * lisse(0, 1, u)
                dist = abs(((a - tete + 180) % 360) - 180)
                proche = max(proche, math.exp(-(dist / 22) ** 2) * (1 - lisse(0.85, 1, u)))
        lueur = 0.18 + 0.12 * math.sin(2 * math.pi * (2 * t + ph)) + 0.7 * proche
        x, y = pos(r, a)
        stamp_dot(cv, x * SS, y * SS, taille * 0.45 * SS, OR, min(1, lueur * 1.1))
        stamp_star(fx, x * SS, y * SS, taille * 2.2 * SS, OR_CLAIR, lueur, angle=0.3)
    im = to_image(downsample(cv.p))
    lum = to_image(downsample(fx.p))
    im.alpha_composite(lum)
    return halo(im, (255, 230, 170), force=0.3, rayon=2.2)


if __name__ == '__main__':
    sortie = sys.argv[1] if len(sys.argv) > 1 else '.'
    ecrire([render(f) for f in range(NF)], 'etoiles-filantes', DUR, sortie, affiche=7)
