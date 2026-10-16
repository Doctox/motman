# Animation de portrait « Rouge-gorge » (rare, collection Douceur, 16/10/2026).
# Lancer depuis ce dossier :  python rouge_gorge.py [dossier de sortie]
# Un rouge-gorge arrive par la droite, se pose sur le haut du cadre, sautille deux
# fois vers le sommet, lève la tête et chante : trois notes s'envolent au-dessus
# du portrait, sans sortir de l'emprise du cadre. Puis il fait demi-tour et
# repart en fondu : la boucle revient au vide.
import math
import sys

from PIL import ImageDraw

from motlib import SS
from pil_outils import C, canevas, ecrire, halo, lisse, reduit

NF = 64
DUR = 110
DOS = (128, 98, 66)
DOS_SOMBRE = (96, 72, 48)
GORGE = (226, 104, 48)
VENTRE = (246, 236, 220)
TRAIT = (70, 52, 36)
BEC = (60, 44, 30)
NOTE = (31, 58, 51)
NOTE_CORAIL = (201, 77, 41)
ECH = 1.15
ARRIVE, POSE, SAUTE, CHANTE, ENVOL = (0.0, 0.18), (0.18, 0.24), (0.24, 0.42), (0.44, 0.68), (0.72, 0.92)
A_POSE, A_SAUT = -56.0, -88.0           # se pose en haut à droite, sautille vers le sommet
R_PATTES = 55.0


def sur_cadre(a_deg, r):
    a = math.radians(a_deg)
    return C + r * math.cos(a), C + r * math.sin(a)


def P(pts, x, y, incl=0.0, miroir=False):
    c, s = math.cos(incl), math.sin(incl)
    out = []
    for px, py in pts:
        px = -px if miroir else px
        out.append(((x + (px * c - py * s) * ECH) * SS, (y + (px * s + py * c) * ECH) * SS))
    return out


def ellipse(cx, cy, rx, ry, a0=0.0, a1=2 * math.pi, n=30):
    return [(cx + rx * math.cos(a0 + (a1 - a0) * i / (n - 1)), cy + ry * math.sin(a0 + (a1 - a0) * i / (n - 1))) for i in range(n)]


def oiseau(d, x, y, incl, vol, aile, tete, bec, miroir=False, alpha=1.0):
    """De profil, tourné vers la droite ; (x, y) = point des pattes. vol : en vol ;
    aile : -1..1 battement ; tete : 0..1 tête levée ; bec : 0..1 ouvert."""
    A = int(255 * alpha); lw = max(2, int(0.7 * SS))
    by = -8.0                                   # le corps est au-dessus des pattes
    if not vol:
        for dx in (-1.2, 1.0):                  # pattes
            d.line(P([(dx, by + 6), (dx + 0.4, 0)], x, y, incl, miroir), fill=TRAIT + (A,), width=lw)
    # queue
    d.polygon(P([(-6.5, by + 1), (-12.5, by - 1.5 + 2 * vol), (-12, by + 1.8 + 2 * vol), (-6, by + 3.5)], x, y, incl, miroir), fill=DOS_SOMBRE + (A,), outline=TRAIT + (A,))
    # aile lointaine (en vol)
    if vol:
        haut = -6.5 * aile
        d.polygon(P([(-2, by - 2), (3, by - 2.5), (-4 + 2 * aile, by - 3 + haut * 0.8)], x, y, incl, miroir), fill=DOS_SOMBRE + (A,), outline=TRAIT + (A,))
    # corps rond, ventre et gorge orangée
    d.polygon(P(ellipse(0, by, 7.2, 6.0), x, y, incl, miroir), fill=DOS + (A,), outline=TRAIT + (A,), width=lw)
    d.polygon(P(ellipse(1.4, by + 1.6, 5.4, 4.2, -0.4, math.pi + 0.2), x, y, incl, miroir), fill=VENTRE + (A,))
    # tête (se lève pour chanter)
    tx, ty = 5.2 + 0.6 * tete, by - 5.2 - 1.2 * tete
    incl_tete = -0.35 * tete
    d.polygon(P(ellipse(tx, ty, 4.6, 4.3), x, y, incl, miroir), fill=DOS + (A,), outline=TRAIT + (A,), width=lw)
    d.polygon(P(ellipse(3.6, by - 1.0, 4.6, 4.4, -1.2, 2.2) + [(tx + 2.2, ty + 0.6)], x, y, incl, miroir), fill=GORGE + (A,))
    d.polygon(P(ellipse(tx + 1.6, ty + 0.4, 2.8, 3.0, -1.4, 1.8), x, y, incl, miroir), fill=GORGE + (A,))
    # bec : deux mandibules qui s'écartent quand il chante
    bx, byy = tx + 4.2, ty + 0.2
    o = 1.4 * bec
    for sens in (-1, 1):
        ang = incl_tete + sens * 0.18 * bec
        pointe = (bx + 3.4 * math.cos(ang), byy + 3.4 * math.sin(ang) + sens * o * 0.5)
        d.polygon(P([(bx - 0.4, byy + sens * 0.8), pointe, (bx - 0.2, byy)], x, y, incl, miroir), fill=BEC + (A,))
    # œil
    ex, ey = tx + 1.8, ty - 1.0
    d.polygon(P(ellipse(ex, ey, 1.05, 1.05, n=14), x, y, incl, miroir), fill=(24, 20, 18, A))
    d.polygon(P(ellipse(ex + 0.3, ey - 0.35, 0.32, 0.32, n=8), x, y, incl, miroir), fill=(255, 255, 255, A))
    # aile proche : repliée au repos, battante en vol
    if vol:
        haut = -7.5 * aile
        d.polygon(P([(-3.5, by - 1), (3, by - 1.5), (-5 + 3 * aile, by - 2 + haut)], x, y, incl, miroir), fill=DOS + (A,), outline=TRAIT + (A,), width=lw)
    else:
        d.polygon(P(ellipse(-1.8, by - 0.5, 5.2, 3.3, -0.3, math.pi + 0.3), x, y, incl, miroir), fill=DOS_SOMBRE + (A,), outline=TRAIT + (A,))
        d.line(P([(-5, by + 0.5), (1.5, by - 1.5)], x, y, incl, miroir), fill=(150, 120, 84, A), width=max(1, int(0.5 * SS)))


def note(d, x, y, double, couleur, alpha, taille=1.0):
    """Une croche (ou deux croches liées), dessinée à la main."""
    A = int(255 * alpha); s = taille
    tetes = [(0, 0)] if not double else [(0, 0), (4.6 * s, -1.4 * s)]
    for hx, hy in tetes:
        cx, cy = x + hx, y + hy
        d.ellipse([(cx - 1.7 * s) * SS, (cy - 1.25 * s) * SS, (cx + 1.7 * s) * SS, (cy + 1.25 * s) * SS], fill=couleur + (A,))
        d.line([((cx + 1.5 * s) * SS, cy * SS), ((cx + 1.5 * s) * SS, (cy - 7 * s) * SS)], fill=couleur + (A,), width=max(2, int(0.75 * SS)))
    if double:
        d.line([((x + 1.5 * s) * SS, (y - 7 * s) * SS), ((x + 6.1 * s) * SS, (y - 8.4 * s) * SS)], fill=couleur + (A,), width=max(3, int(1.4 * SS)))
    else:
        d.line([((x + 1.5 * s) * SS, (y - 7 * s) * SS), ((x + 4.2 * s) * SS, (y - 4.4 * s) * SS)], fill=couleur + (A,), width=max(2, int(1.0 * SS)))


def render(f):
    t = f / NF
    im, d = canevas()
    aile = math.sin(2 * math.pi * f / 3)
    pose_xy = sur_cadre(A_POSE, R_PATTES)
    if t < ARRIVE[1]:
        # arrive de la droite en planant, tourné vers la gauche, en fondu
        u = lisse(*ARRIVE, t)
        a = -18 + (A_POSE + 18) * u
        r = R_PATTES + 6 * (1 - u) ** 1.5
        x, y = sur_cadre(a, r); y -= 5 * math.sin(math.pi * u)
        oiseau(d, x, y, 0.15 * (1 - u), True, aile, 0, 0, miroir=True, alpha=lisse(0.0, 0.07, t))
    elif t < SAUTE[1]:
        if t < POSE[1]:
            x, y = pose_xy
        else:
            u = (t - SAUTE[0]) / (SAUTE[1] - SAUTE[0])
            k = min(int(u * 2), 1); v = u * 2 - k        # deux sauts
            a = A_POSE + (A_SAUT - A_POSE) * (k + lisse(0, 1, v)) / 2
            x, y = sur_cadre(a, R_PATTES); y -= 3.5 * math.sin(math.pi * v)
        incl = math.radians(math.degrees(math.atan2(y - C, x - C)) + 90) * 0.6
        oiseau(d, x, y, incl, False, 0, 0, 0, miroir=True)
    elif t < ENVOL[0]:
        x, y = sur_cadre(A_SAUT, R_PATTES)
        incl = math.radians(A_SAUT + 90) * 0.6
        chant = lisse(CHANTE[0], CHANTE[0] + 0.04, t) * (1 - lisse(CHANTE[1] - 0.03, CHANTE[1], t))
        bec = chant * (0.5 + 0.5 * math.sin(2 * math.pi * f / 2.5))
        oiseau(d, x, y, incl, False, 0, chant, bec, miroir=True)
        for k, (debut, double, couleur) in enumerate(((0.46, False, NOTE), (0.53, True, NOTE_CORAIL), (0.60, False, NOTE))):
            u = (t - debut) / 0.16
            if 0 < u < 1:
                nx = x - 15 - 10 * u + 2 * math.sin(6 * u + k)   # au-dessus du portrait, vers la gauche
                ny = y - 9 - 6 * u
                note(d, nx, ny, double, couleur, math.sin(math.pi * u) ** 0.7, 0.85 + 0.2 * u)
    else:
        # demi-tour, et il repart vers la droite en fondu
        u = lisse(*ENVOL, t)
        a = A_SAUT + 52 * u
        r = R_PATTES + 1.5 * u
        x, y = sur_cadre(a, r); y -= 2 * math.sin(math.pi * u)
        oiseau(d, x, y, -0.2 * u, True, aile, 0, 0, alpha=1 - lisse(0.80, 0.92, t))
    return halo(reduit(im), (255, 236, 214), force=0.3, rayon=1.8)


if __name__ == '__main__':
    sortie = sys.argv[1] if len(sys.argv) > 1 else '.'
    ecrire([render(f) for f in range(NF)], 'rouge-gorge', DUR, sortie, affiche=36)
