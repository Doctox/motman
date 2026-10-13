# Animation de portrait « Mot trouvé » (rare, vague Le jeu, 13/10/2026).
# Lancer depuis ce dossier :  python mot_trouve.py [dossier de sortie]
# Ce que fait une flèche dans une grille : une case-définition se pose sur le
# cadre, en haut à gauche ; sa flèche épouse le bord du portrait puis rentre à
# l'horizontale ; trois cases s'y posent une à une en travers du bas du portrait
# et le mot s'écrit de gauche à droite (MOT, puis JEU) ; le mot trouvé s'illumine
# d'or, puis tout s'efface. Tout reste dans l'emprise du cadre : rien ne vient
# sur le pseudo ou le score à côté du portrait (vérifié à l'accueil et en duel).
# Deux épisodes par boucle : pas de couture.
import math
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

from motlib import SS
from pil_outils import C, canevas, ecrire, halo, lisse, reduit

NF = 64
DUR = 110
ENCRE = (31, 58, 51)
CREME = (251, 245, 230)
CASE_DEF = (238, 228, 205)
CORAIL = (201, 77, 41)
OR = (243, 206, 112)
OR_VIF = (255, 226, 140)
CASE = 18.0                    # côté d'une case (px 224)
R_FLECHE = 58.0                # la flèche longe le bord du portrait (rayon 52)
LIGNE_MOT = 143.0              # ligne du mot, en travers du bas du portrait
X_MOT = (92.0, 112.0, 132.0)   # centres des trois cases


def police(taille):
    for chemin in (r'C:\Windows\Fonts\georgiab.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf'):
        if Path(chemin).exists():
            return ImageFont.truetype(chemin, taille)
    return ImageFont.load_default()


FONTE = police(int(CASE * 0.72 * SS))
EPISODES = (dict(mot='MOT'), dict(mot='JEU'))


def chemin():
    """La flèche : sous la case-définition, elle longe le bord gauche du portrait
    puis rentre à l'horizontale vers la première case du mot."""
    pts = []
    a_debut = math.radians(-128)
    a_fin = math.radians(-180 - math.degrees(math.asin((LIGNE_MOT - C) / R_FLECHE)))
    for i in range(41):
        a = a_debut + (a_fin - a_debut) * i / 40
        pts.append((C + R_FLECHE * math.cos(a), C + R_FLECHE * math.sin(a)))
    x0 = pts[-1][0]
    for i in range(1, 9):
        pts.append((x0 + (X_MOT[0] - CASE / 2 - 5.0 - x0) * i / 8, LIGNE_MOT))
    return pts


def sous_chemin(pts, p):
    """Les points du chemin jusqu'à la fraction p de sa longueur."""
    longs = [0.0]
    for (ax, ay), (bx, by) in zip(pts, pts[1:]):
        longs.append(longs[-1] + math.hypot(bx - ax, by - ay))
    cible = longs[-1] * p
    out = [pts[0]]
    for i in range(1, len(pts)):
        if longs[i] <= cible:
            out.append(pts[i]); continue
        f = (cible - longs[i - 1]) / max(longs[i] - longs[i - 1], 1e-9)
        ax, ay = pts[i - 1]; bx, by = pts[i]
        out.append((ax + (bx - ax) * f, ay + (by - ay) * f)); break
    return out


def trait(d, pts, couleur, epaisseur):
    if len(pts) > 1:
        d.line([(x * SS, y * SS) for x, y in pts], fill=couleur, width=int(epaisseur * SS), joint='curve')
    for x, y in (pts[0], pts[-1]):
        r = epaisseur * SS / 2
        d.ellipse([x * SS - r, y * SS - r, x * SS + r, y * SS + r], fill=couleur)


def pointe(d, x, y, angle, taille, couleur):
    c, s = math.cos(angle), math.sin(angle)
    pts = [(taille, 0), (-taille * 0.7, taille * 0.75), (-taille * 0.7, -taille * 0.75)]
    d.polygon([((x + px * c - py * s) * SS, (y + px * s + py * c) * SS) for px, py in pts], fill=couleur)


def case(d, x, y, cote, fond, alpha, lettre=None, encre_lettre=1.0):
    h = cote / 2
    a = int(255 * alpha)
    d.rounded_rectangle([(x - h) * SS, (y - h) * SS, (x + h) * SS, (y + h) * SS], radius=int(2.2 * SS),
                        fill=fond + (a,), outline=ENCRE + (a,), width=max(2, int(1.25 * SS)))
    if lettre and encre_lettre > 0.01:
        d.text((x * SS, y * SS + 0.6 * SS), lettre, font=FONTE, fill=ENCRE + (int(a * encre_lettre),), anchor='mm')


def etoile(d, x, y, r, couleur, alpha):
    pts = []
    for i in range(8):
        a = i * math.pi / 4
        rr = r if i % 2 == 0 else r * 0.3
        pts.append(((x + rr * math.cos(a)) * SS, (y + rr * math.sin(a)) * SS))
    d.polygon(pts, fill=couleur + (int(255 * alpha),))


def episode(d, u, ep):
    sortie = 1 - lisse(0.76, 0.92, u)                    # tout s'efface ensemble
    if sortie <= 0.01 or u <= 0:
        return
    pts_fleche = chemin()
    # 1. la flèche se trace (sous la case-définition, d'où elle sort)
    p = lisse(0.10, 0.36, u)
    if p > 0.01:
        pts = sous_chemin(pts_fleche, p)
        a = int(255 * sortie)
        trait(d, pts, CREME + (a,), 3.6)
        trait(d, pts, CORAIL + (a,), 2.0)
        (ax, ay), (bx, by) = pts[-2] if len(pts) > 1 else pts[0], pts[-1]
        angle = math.atan2(by - ay, bx - ax)
        pointe(d, bx, by, angle, 4.6, CREME + (a,))
        pointe(d, bx, by, angle, 3.4, CORAIL + (a,))
        if p < 0.99:
            etoile(d, bx, by, 3.2, OR_VIF, 0.9 * sortie)
    # 2. la case-définition, posée sur le cadre
    pop = lisse(0.0, 0.08, u)
    rebond = 1 + 0.18 * math.sin(math.pi * lisse(0.0, 0.12, u))
    a_case = math.radians(-128)
    cx, cy = C + 64 * math.cos(a_case), C + 64 * math.sin(a_case)
    cote = CASE * pop * rebond
    if cote > 1:
        case(d, cx, cy, cote, CASE_DEF, sortie)
        for k, l in ((-0.18, 0.62), (0.14, 0.44)):         # deux lignes d'écriture
            y = cy + k * cote
            d.line([((cx - l * cote / 2) * SS, y * SS), ((cx + l * cote / 2) * SS, y * SS)],
                   fill=ENCRE + (int(200 * sortie * pop),), width=max(2, int(0.9 * SS)))
    # 3. les lettres se posent, 4. le mot trouvé s'illumine
    eclat = math.sin(math.pi * lisse(0.62, 0.76, u))
    for i, lettre in enumerate(ep['mot']):
        t0 = 0.38 + 0.075 * i
        q = lisse(t0, t0 + 0.07, u)
        if q <= 0.01:
            continue
        x, y = X_MOT[i], LIGNE_MOT - 7 * (1 - q) ** 2     # tombe dans sa case
        rebond = 1 + 0.16 * math.sin(math.pi * q) * (1 - q)
        fond = tuple(int(CREME[k] + (OR[k] - CREME[k]) * eclat) for k in range(3))
        case(d, x, y, CASE * rebond * (1 + 0.08 * eclat), fond, sortie * q, lettre, lisse(t0 + 0.03, t0 + 0.09, u))
    if eclat > 0.02:
        for dx, dy, r in ((-27, -9, 4.0), (27, -10, 3.4), (-18, 12, 3.0), (24, 11, 3.8)):
            etoile(d, C + dx, LIGNE_MOT + dy, r * eclat, OR_VIF, 0.95 * eclat * sortie)


def render(f):
    im, d = canevas()
    t = f / NF
    for n, ep in enumerate(EPISODES):
        episode(d, (t - n * 0.5) % 1.0 / 0.5 if (t - n * 0.5) % 1.0 < 0.5 else 2.0, ep)
    return halo(reduit(im), (255, 236, 200), force=0.3, rayon=2.0)


if __name__ == '__main__':
    sortie = sys.argv[1] if len(sys.argv) > 1 else '.'
    ecrire([render(f) for f in range(NF)], 'mot-trouve', DUR, sortie, affiche=22)
