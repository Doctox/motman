# Animation de portrait « Feu d'artifice » (rare, vague Hiver, 05/11/2026).
# Lancer depuis ce dossier :  python feu_artifice.py [dossier de sortie]
# Une fusée monte à gauche du portrait et éclate en corail, une autre à droite et
# éclate en sauge. Puis deux fusées montent ensemble, se rejoignent au-dessus de la
# tête et donnent le bouquet final : une grande gerbe d'or qui retombe en pluie le
# long du cadre. Tout se passe autour du cadre, jamais dessus. La boucle revient au vide.
import math
import random
import sys

from motlib import SS, Canvas, downsample, stamp_dot, stamp_star, to_image
from pil_outils import C, ecrire, halo, lisse

NF = 76
DUR = 100
BLANC = (1.0, 0.98, 0.9)
OR = (0.78, 0.53, 0.16)
OR_CLAIR = (1.0, 0.82, 0.42)
CORAIL = (0.79, 0.30, 0.16)
SAUGE = (0.13, 0.50, 0.38)
# Les plus grands cadres (Dragon doré, Citrouilles) vont jusqu'à 78 : tout se passe au-delà.
R_MONTEE = 80.0                 # les fusées contournent le cadre
R_VISAGE = 62.0                 # rien en deçà : ni visage, ni anneau du cadre
R_LOIN = 108.0                  # ni au bord de l'image

# debut/duree de la montée, angles parcourus (degrés), éclat à la fin de la montée.
FUSEES = (
    dict(debut=0.02, duree=0.10, a0=150, a1=225),
    dict(debut=0.26, duree=0.10, a0=30, a1=-55),
    dict(debut=0.50, duree=0.13, a0=165, a1=270),
    dict(debut=0.50, duree=0.13, a0=15, a1=-90),
)
# t : instant de l'éclat ; duree ; rayon ; couleurs ; g : chute en fin de vie, en pixels.
ECLATS = (
    dict(t=0.12, duree=0.26, a=225, r=88, rayon=22, n=20, coul=CORAIL, bout=OR_CLAIR, g=10, graine=3),
    dict(t=0.36, duree=0.26, a=-55, r=88, rayon=22, n=20, coul=SAUGE, bout=OR_CLAIR, g=10, graine=8),
    dict(t=0.63, duree=0.24, a=-90, r=84, rayon=26, n=30, coul=OR, bout=OR_CLAIR, g=14, graine=5),
)
# La pluie d'or du bouquet : gouttes qui glissent le long du cadre, des deux côtés.
PLUIE = 22
T_PLUIE, D_PLUIE = 0.69, 0.27


def sur_cadre(a_deg, r):
    a = math.radians(a_deg)
    return C + r * math.cos(a), C + r * math.sin(a)


def garde(x, y):
    """Part de lumière gardée à cet endroit : ni sur le visage, ni trop loin."""
    d = math.hypot(x - C, y - C)
    return lisse(R_VISAGE, R_VISAGE + 6, d) * (1 - lisse(R_LOIN - 8, R_LOIN, d))


def point(cv, x, y, sigma, coul, alpha):
    stamp_dot(cv, x * SS, y * SS, sigma * SS, coul, alpha * garde(x, y))


def fusee(cv, fx, f, t):
    u = (t - f['debut']) / f['duree']
    if not 0 <= u <= 1.02:
        return
    p = lisse(0, 1, min(u, 1)) * 0.25 + min(u, 1) * 0.75
    e = lisse(0, 0.15, u)
    sens = 1 if f['a1'] > f['a0'] else -1
    tete = f['a0'] + (f['a1'] - f['a0']) * p
    for k in range(12, 0, -1):                          # la traîne, de la queue vers la tête
        q = k / 12
        a = tete - sens * 26 * q * min(1, p * 3)
        x, y = sur_cadre(a, R_MONTEE + 1.2 * math.sin(k * 1.7 + t * 40) * q)
        point(cv, x, y, (1.7 * (1 - q) + 0.5), OR if k > 3 else OR_CLAIR, e * (1 - q) ** 1.0)
    x, y = sur_cadre(tete, R_MONTEE)
    point(cv, x, y, 2.3, CORAIL, e)
    point(cv, x, y, 1.1, BLANC, e)


def eclat(cv, fx, e, t):
    age = (t - e['t']) / e['duree']
    if not 0 <= age < 1:
        return
    cx, cy = sur_cadre(e['a'], e['r'])
    if age < 0.14:                                      # l'éclair de l'explosion
        v = 1 - age / 0.14
        stamp_dot(cv, cx * SS, cy * SS, (5 + 7 * (1 - v)) * SS, OR_CLAIR, 0.5 * v)
        stamp_star(fx, cx * SS, cy * SS, (10 + 12 * (1 - v)) * SS, BLANC, v)
    alea = random.Random(e['graine'])
    for i in range(e['n']):
        ang = 2 * math.pi * (i + alea.uniform(-0.3, 0.3)) / e['n']
        # Deux coquilles, pour que la gerbe soit pleine et non un simple anneau.
        vit = (alea.uniform(0.82, 1.0) if i % 2 else alea.uniform(0.42, 0.68)) * e['rayon']
        phase = alea.uniform(0, 6.28)
        d = vit * (1 - (1 - age) ** 3)
        chute = e['g'] * age * age
        # Le rayon : un trait qui part du centre et se raccourcit en s'éteignant.
        long = d * (0.75 - 0.6 * lisse(0.1, 0.6, age))
        vie = 1 - lisse(0.55, 1, age)
        for k in range(9):
            q = k / 8
            dd = d - long * q
            x = cx + dd * math.cos(ang)
            y = cy + dd * math.sin(ang) + chute * (1 - 0.5 * q)
            coul = e['coul'] if age < 0.45 else tuple(e['coul'][c] + (e['bout'][c] - e['coul'][c]) * lisse(0.45, 0.8, age) for c in range(3))
            scint = 1 if age < 0.5 else 0.66 + 0.34 * math.sin(phase + t * 90)
            point(cv, x, y, (1.15 - 0.45 * age) * (1 - 0.55 * q), coul, vie * scint * (1 - q) ** 0.8)
        if age > 0.4 and i % 3 == 0:                    # quelques bouts s'allument avant de s'éteindre
            x, y = cx + d * math.cos(ang), cy + d * math.sin(ang) + chute
            lueur = (0.5 + 0.5 * math.sin(phase + t * 110)) * (1 - lisse(0.7, 1, age)) * garde(x, y)
            stamp_star(fx, x * SS, y * SS, 5.5 * SS, BLANC, 0.85 * lueur, angle=phase)


def pluie(cv, fx, t):
    """Après le bouquet, l'or retombe et glisse sur les deux flancs du portrait."""
    alea = random.Random(11)
    for i in range(PLUIE):
        cote = 1 if i % 2 else -1
        depart = alea.uniform(0, 0.42)
        duree = alea.uniform(0.5, 0.58)
        u = ((t - T_PLUIE) / D_PLUIE - depart) / duree
        a0 = alea.uniform(14, 40)                       # depuis le sommet...
        # ... jusque vers le milieu du flanc ; moins bas à droite, où commence le pseudo.
        a1 = alea.uniform(50, 72) if cote > 0 else alea.uniform(60, 100)
        r = alea.uniform(78, 94)
        phase = alea.uniform(0, 6.28)
        if not 0 <= u < 1:
            continue
        e = lisse(0, 0.1, u) * (1 - lisse(0.6, 1, u))
        for k in range(7):
            q = k / 6
            ecart = a0 + (a1 - a0) * max(0.0, u ** 1.6 - 0.1 * q)
            x, y = sur_cadre(-90 + cote * ecart, r)
            coul = OR_CLAIR if k < 2 else OR
            point(cv, x, y, 1.15 * (1 - 0.6 * q), coul, e * (1 - q) ** 1.2)
        if i % 4 == 0:
            ecart = a0 + (a1 - a0) * u ** 1.6
            x, y = sur_cadre(-90 + cote * ecart, r)
            stamp_star(fx, x * SS, y * SS, 5 * SS, BLANC, 0.8 * e * (0.5 + 0.5 * math.sin(phase + t * 120)) * garde(x, y), angle=phase)


def render(f):
    t = f / NF
    cv, fx = Canvas(), Canvas()
    for e in ECLATS:
        eclat(cv, fx, e, t)
    for fu in FUSEES:
        fusee(cv, fx, fu, t)
    pluie(cv, fx, t)
    im = to_image(downsample(cv.p))
    im.alpha_composite(to_image(downsample(fx.p)))
    return halo(im, (255, 228, 170), force=0.3, rayon=2.0)


if __name__ == '__main__':
    sortie = sys.argv[1] if len(sys.argv) > 1 else '.'
    ecrire([render(f) for f in range(NF)], 'feu-artifice', DUR, sortie, affiche=55)
