# Animation de portrait « Coccinelle » (singulier, collection Douceur, 16/10/2026).
# Lancer depuis ce dossier :  python coccinelle.py [dossier de sortie]
# Une coccinelle marche sur le côté droit du cadre, s'arrête, ouvre ses élytres,
# déplie ses ailes et s'envole : elle fait le tour du portrait et se repose là
# d'où elle était partie, replie ses ailes et repart. La boucle n'a pas de
# couture : elle finit exactement dans la pose du début.
import math
import sys

from PIL import ImageDraw

from motlib import SS
from pil_outils import C, canevas, ecrire, halo, lisse, reduit

NF = 60
DUR = 110
ROUGE = (210, 58, 42)
ROUGE_CLAIR = (238, 104, 80)
NOIR = (34, 28, 30)
AILE = (196, 186, 170)
R_SOL = 62.0
A_DEPART, A_ARRET = 72.0, -12.0      # marche : du bas droit vers le côté droit
MARCHE, OUVRE, VOL, POSE, REPLIE = (0.0, 0.30), (0.30, 0.38), (0.38, 0.84), (0.84, 0.90), (0.90, 0.97)
ECH = 1.55


def tourne(pts, x, y, ang, ech=ECH):
    c, s = math.cos(ang), math.sin(ang)
    return [((x + (px * c - py * s) * ech) * SS, (y + (px * s + py * c) * ech) * SS) for px, py in pts]


def ellipse_pts(cx, cy, rx, ry, a0=0.0, a1=2 * math.pi, n=28):
    return [(cx + rx * math.cos(a0 + (a1 - a0) * i / (n - 1)), cy + ry * math.sin(a0 + (a1 - a0) * i / (n - 1))) for i in range(n)]


def coccinelle(d, x, y, cap, ouverture, battement, pas, haut):
    """Vue de dessus ; cap = direction de la tête ; ouverture 0..1 ; haut = envol (ombre)."""
    lw = max(2, int(0.55 * SS))
    if haut > 0.01:                                          # ombre portée quand elle vole
        d.polygon(tourne(ellipse_pts(0, 0, 5.2, 4.2), x + 2.5 * haut, y + 3.5 * haut, cap), fill=(0, 0, 0, int(55 * (1 - 0.4 * haut))))
    # pattes (trois de chaque côté), qui alternent en marchant
    for i, lx in enumerate((-2.6, 0.2, 2.8)):
        for cote in (-1, 1):
            avance = 0.9 * math.sin(2 * math.pi * pas + (i + (cote > 0)) * math.pi) * (1 - haut)
            d.line(tourne([(lx, cote * 3.2), (lx + 1.4 + avance, cote * 5.6)], x, y, cap), fill=NOIR + (255,), width=lw)
    # ailes membraneuses, dépliées sous les élytres ouverts
    if ouverture > 0.05:
        for cote in (-1, 1):
            long = 7.5 + 1.6 * battement
            aile = [(1.5, cote * 0.8), (-long * 0.55, cote * (2.5 + 4.6 * ouverture)), (-long, cote * (1.2 + 2.2 * ouverture)), (-2, cote * 0.4)]
            d.polygon(tourne(aile, x, y, cap), fill=AILE + (int(150 * ouverture),), outline=(120, 110, 100, int(170 * ouverture)))
    # corps sombre et tête
    d.polygon(tourne(ellipse_pts(0, 0, 4.6, 3.6), x, y, cap), fill=NOIR + (255,))
    d.polygon(tourne(ellipse_pts(4.2, 0, 2.0, 2.4, -math.pi / 2, math.pi / 2), x, y, cap), fill=NOIR + (255,))
    for cote in (-1, 1):
        d.polygon(tourne(ellipse_pts(4.9, cote * 1.1, 0.5, 0.45), x, y, cap), fill=(250, 250, 245, 255))
        d.line(tourne([(5.6, cote * 0.8), (7.6, cote * 2.2)], x, y, cap), fill=NOIR + (255,), width=lw)
    # élytres : deux demi-coques rouges qui pivotent vers l'extérieur
    for cote in (-1, 1):
        # cote +1 : moitié y > 0 ; en s'ouvrant, l'arrière de la coque part vers l'extérieur
        ang = -cote * math.radians(38) * ouverture
        demi = ellipse_pts(0, 0, 4.4, 3.5, 0.0 if cote > 0 else math.pi, math.pi if cote > 0 else 2 * math.pi, 18)
        # pivot à l'avant de la coque
        pivot = (3.6, 0.0)
        c, s = math.cos(ang), math.sin(ang)
        demi = [(pivot[0] + (px - pivot[0]) * c - (py - pivot[1]) * s, pivot[1] + (px - pivot[0]) * s + (py - pivot[1]) * c) for px, py in demi]
        d.polygon(tourne(demi, x, y, cap), fill=ROUGE + (255,), outline=NOIR + (255,), width=lw)
        for px, py, r in ((1.2, 1.6, 0.9), (-1.6, 2.0, 0.85), (-0.6, 0.7, 0.6)):
            qx = pivot[0] + (px - pivot[0]) * c - (cote * py - pivot[1]) * s
            qy = pivot[1] + (px - pivot[0]) * s + (cote * py - pivot[1]) * c
            d.polygon(tourne(ellipse_pts(qx, qy, r, r, n=12), x, y, cap), fill=NOIR + (255,))
        hx = pivot[0] + (-1.2 - pivot[0]) * c - (cote * 1.4 - pivot[1]) * s
        hy = pivot[1] + (-1.2 - pivot[0]) * s + (cote * 1.4 - pivot[1]) * c
        d.polygon(tourne(ellipse_pts(hx, hy, 0.9, 0.5, n=10), x, y, cap), fill=ROUGE_CLAIR + (230,))


def sur_cadre(a_deg, r=R_SOL):
    a = math.radians(a_deg)
    return C + r * math.cos(a), C + r * math.sin(a)


def render(f):
    t = f / NF
    im, d = canevas()
    ouverture = lisse(*OUVRE, t) * (1 - lisse(*REPLIE, t))
    battement = math.sin(2 * math.pi * f * 0.5) if VOL[0] <= t < POSE[1] else 0.0
    if t < MARCHE[1]:
        u = (t - MARCHE[0]) / (MARCHE[1] - MARCHE[0])
        a = A_DEPART + (A_ARRET - A_DEPART) * lisse(0, 1, u)
        x, y = sur_cadre(a); cap = math.radians(a - 90); haut = 0.0
        pas = 6 * u
    elif t < VOL[0]:
        x, y = sur_cadre(A_ARRET); cap = math.radians(A_ARRET - 90); haut = 0.0; pas = 0
    elif t < POSE[1]:
        # vol : tour du portrait dans le sens inverse des aiguilles, un peu plus loin du cadre
        u = lisse(VOL[0], POSE[1], t)
        a = A_ARRET - (360 - (A_DEPART - A_ARRET)) * u
        r = R_SOL + 3 * math.sin(math.pi * u)
        x, y = sur_cadre(a, r)
        x2, y2 = sur_cadre(a - 2, r)
        cap = math.atan2(y2 - y, x2 - x)
        if t > POSE[0]:                                  # se pose : se tourne vers sa direction de marche
            q = lisse(POSE[0], POSE[1], t)
            cap_marche = math.radians(A_DEPART - 90)
            diff = (cap_marche - cap + math.pi) % (2 * math.pi) - math.pi
            cap = cap + diff * q
        haut = math.sin(math.pi * u) ** 0.5
        pas = 0
    else:
        x, y = sur_cadre(A_DEPART); cap = math.radians(A_DEPART - 90); haut = 0.0; pas = 0
    coccinelle(d, x, y, cap, ouverture, battement, pas, haut)
    return halo(reduit(im), (255, 230, 215), force=0.32, rayon=1.8)


if __name__ == '__main__':
    sortie = sys.argv[1] if len(sys.argv) > 1 else '.'
    ecrire([render(f) for f in range(NF)], 'coccinelle', DUR, sortie, affiche=8)
