# Animation de portrait « Escargot » (singulier, collection Douceur, 16/10/2026).
# Lancer depuis ce dossier :  python escargot.py [dossier de sortie]
# Une coquille apparaît sur le haut gauche du cadre ; l'escargot en sort, déplie
# ses antennes, fait lentement le tour du haut du cadre en laissant une traînée
# qui scintille, puis rentre dans sa coquille, qui s'efface. Le cycle revient
# au vide : boucle sans couture.
import math
import sys

from PIL import Image, ImageDraw

from motlib import SS
from pil_outils import C, canevas, ecrire, halo, lisse, reduit

NF = 72
DUR = 110
COQUILLE = (201, 138, 75)
SPIRALE = (122, 74, 34)
CORPS = (217, 194, 163)
TRAIT = (110, 82, 56)
TRAINEE = (176, 196, 214)
ETINCELLE = (236, 196, 104)
R_SOL = 57.0                     # l'escargot marche sur le haut du cadre
A0, A1 = -142.0, -38.0           # de la gauche vers la droite, par le sommet
APPARAIT, SORT, MARCHE, RENTRE, PART = (0.0, 0.07), (0.07, 0.16), (0.16, 0.82), (0.82, 0.90), (0.90, 0.97)


def repere(a_deg):
    """Point au sol, tangente (sens de la marche) et normale sortante."""
    a = math.radians(a_deg)
    p = (C + R_SOL * math.cos(a), C + R_SOL * math.sin(a))
    return p, (-math.sin(a), math.cos(a)), (math.cos(a), math.sin(a))


def vers_monde(pts, p, tg, n, ech=1.0):
    """Coordonnées locales (x vers l'avant, y vers le bas du sol) -> pixels 4x."""
    return [((p[0] + (lx * tg[0] - ly * n[0]) * ech) * SS, (p[1] + (lx * tg[1] - ly * n[1]) * ech) * SS) for lx, ly in pts]


def escargot(d, a_deg, sortie, etire, alpha):
    p, tg, n = repere(a_deg)
    A = int(255 * alpha)
    lw = max(2, int(0.9 * SS))
    # corps : du bout de la queue à la tête, s'étire et se contracte en marchant
    if sortie > 0.02:
        long_av = (4 + 7 * sortie) * (1 + 0.12 * etire)
        long_ar = 9 * (1 - 0.1 * etire)
        corps = [(-long_ar, 0)]
        for i in range(13):
            s = i / 12
            corps.append((-long_ar + (long_ar + long_av) * s, -3.4 * math.sin(math.pi * s) ** 0.7 - (1.6 * s * sortie)))
        corps += [(long_av + 1.2, -1.2 * sortie), (long_av, 0.4)]
        d.polygon(vers_monde(corps, p, tg, n), fill=CORPS + (A,), outline=TRAIT + (A,), width=lw)
        # antennes
        for dx, h in ((-0.4, 6.5), (1.6, 5.2)):
            base = (long_av - 1.0 + dx, -3.2 * sortie)
            bout = (long_av + 2.2 + dx, -3.2 * sortie - h * sortie)
            pts = vers_monde([base, bout], p, tg, n)
            d.line(pts, fill=TRAIT + (A,), width=max(2, int(0.8 * SS)))
            bx, by = pts[1]; r = 0.95 * SS
            d.ellipse([bx - r, by - r, bx + r, by + r], fill=(50, 40, 32, A))
    # coquille et sa spirale
    cx, cy = vers_monde([(-2.0, -7.4)], p, tg, n)[0]
    rc = 7.6 * SS
    d.ellipse([cx - rc, cy - rc, cx + rc, cy + rc], fill=COQUILLE + (A,), outline=TRAIT + (A,), width=lw)
    spirale = []
    for i in range(46):
        s = i / 45
        ang = math.atan2(tg[1], tg[0]) + 4.4 * math.pi * s
        r = rc * 0.82 * (1 - s) ** 1.05
        spirale.append((cx + r * math.cos(ang), cy + r * math.sin(ang)))
    d.line(spirale, fill=SPIRALE + (A,), width=max(2, int(0.85 * SS)), joint='curve')
    hx, hy = cx - n[0] * rc * 0.45 - tg[0] * rc * 0.3, cy - n[1] * rc * 0.45 - tg[1] * rc * 0.3
    d.ellipse([hx - 1.4 * SS, hy - 1.0 * SS, hx + 1.4 * SS, hy + 1.0 * SS], fill=(240, 200, 150, int(A * 0.8)))


def trainee(d, a_fin, alpha, t):
    """Traînée argentée derrière l'escargot, avec des points qui scintillent."""
    if a_fin <= A0 + 0.5 or alpha <= 0.01:
        return
    pts = []
    n = max(2, int((a_fin - A0) / 2))
    for i in range(n + 1):
        a = A0 + (a_fin - A0) * i / n
        p, _, nn = repere(a)
        pts.append(((p[0] - nn[0] * 0.3) * SS, (p[1] - nn[1] * 0.3) * SS))
    d.line(pts, fill=TRAINEE + (int(175 * alpha),), width=max(2, int(1.1 * SS)), joint='curve')
    for k in range(int((a_fin - A0) / 9)):
        a = A0 + 4 + 9 * k
        lueur = 0.5 + 0.5 * math.sin(2 * math.pi * (3 * t + k * 0.37))
        p, _, nn = repere(a)
        x, y = (p[0] - nn[0] * 0.3) * SS, (p[1] - nn[1] * 0.3) * SS
        r = (0.6 + 1.2 * lueur) * SS
        a8 = int(230 * alpha * lueur)
        d.polygon([(x, y - r * 1.8), (x + r * 0.45, y), (x, y + r * 1.8), (x - r * 0.45, y)], fill=ETINCELLE + (a8,))
        d.polygon([(x - r * 1.8, y), (x, y + r * 0.45), (x + r * 1.8, y), (x, y - r * 0.45)], fill=ETINCELLE + (a8,))


def render(f):
    t = f / NF
    im, d = canevas()
    alpha = lisse(*APPARAIT, t) * (1 - lisse(*PART, t))
    if alpha <= 0.005:
        return halo(reduit(im), (255, 240, 215), 0.3, 2.0)
    marche = lisse(*MARCHE, t) * 0.97 + (t - MARCHE[0]) / (MARCHE[1] - MARCHE[0]) * 0.03 if MARCHE[0] < t < MARCHE[1] else (1.0 if t >= MARCHE[1] else 0.0)
    a = A0 + (A1 - A0) * marche
    sortie = lisse(*SORT, t) * (1 - lisse(*RENTRE, t))
    etire = math.sin(2 * math.pi * 6 * t) if MARCHE[0] < t < MARCHE[1] else 0.0
    trainee(d, a, alpha * (1 - lisse(0.86, 0.97, t)), t)
    escargot(d, a, sortie, etire, alpha)
    return halo(reduit(im), (255, 240, 215), force=0.3, rayon=2.0)


if __name__ == '__main__':
    sortie = sys.argv[1] if len(sys.argv) > 1 else '.'
    ecrire([render(f) for f in range(NF)], 'escargot', DUR, sortie, affiche=40)
