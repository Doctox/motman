# Animation de portrait « Flèches » (singulier, vague Le jeu, 13/10/2026).
# Lancer depuis ce dossier :  python fleches.py [dossier de sortie]
# Les flèches des cases-définitions — droites et coudées — font le tour du
# portrait, corail cerné de crème, avec un éclat doré à la pointe. Elles
# apparaissent et s'effacent tour à tour. Orbite et fenêtres sont périodiques.
import math
import sys

from PIL import Image, ImageDraw

from motlib import SS
from pil_outils import C, canevas, ecrire, fenetre, halo, reduit

NF = 48
DUR = 110
CORAIL = (201, 77, 41, 255)        # --mm-coral
CREME = (255, 248, 236, 255)
OR = (232, 196, 110)

# forme : 'droite' ou 'coudee' ; debut/duree : fenetre de visibilite sur la boucle.
FLECHES = [dict(theta0=i * 2 * math.pi / 6, forme='coudee' if i % 2 else 'droite',
                debut=(i * 0.17) % 1.0, duree=0.62, r0=76 + (i % 3) * 3) for i in range(6)]


def trace(forme):
    """Ligne de la flèche en coordonnées locales (px 224), pointe vers +x."""
    if forme == 'droite':
        return [(-7.0, 0.0), (4.5, 0.0)], (4.5, 0.0)
    return [(-6.0, -6.0), (-6.0, 0.0), (4.5, 0.0)], (4.5, 0.0)


def place(points, x, y, a, echelle):
    c, s = math.cos(a), math.sin(a)
    return [((x + (px * c - py * s) * echelle) * SS, (y + (px * s + py * c) * echelle) * SS) for px, py in points]


def fleche(d, forme, x, y, a, echelle, couleur, epaisseur):
    ligne, (hx, hy) = trace(forme)
    tete = [(hx, -3.4), (hx + 5.2, 0.0), (hx, 3.4)]
    pts = place(ligne, x, y, a, echelle)
    d.line(pts, fill=couleur, width=int(epaisseur * SS * echelle), joint='curve')
    for p in (pts[0],):
        r = epaisseur * SS * echelle / 2
        d.ellipse([p[0] - r, p[1] - r, p[0] + r, p[1] + r], fill=couleur)
    d.polygon(place(tete, x, y, a, echelle), fill=couleur)


def render(f):
    t = f / NF
    im, _ = canevas()
    for fl in FLECHES:
        u = ((t - fl['debut']) % 1.0) / fl['duree']
        e = fenetre(u, 0.18, 0.2) if u < 1 else 0.0
        if e <= 0.01:
            continue
        th = fl['theta0'] + 2 * math.pi * t
        r = fl['r0'] + 3 * math.sin(2 * math.pi * 2 * t + fl['theta0'])
        x, y = C + r * math.cos(th), C + 0.94 * r * math.sin(th)
        a = th + math.pi / 2                       # tangente : la flèche suit son orbite
        ech = 1.7 * (0.6 + 0.4 * e)
        calque = Image.new('RGBA', im.size, (0, 0, 0, 0)); d = ImageDraw.Draw(calque)
        fleche(d, fl['forme'], x, y, a, ech, CREME, 4.0)
        fleche(d, fl['forme'], x, y, a, ech * 0.97, CORAIL, 2.3)
        # eclat dore a la pointe
        px, py = place([(4.5 + 4.2, 0.0)], x, y, a, ech)[0]
        rr = 1.8 * SS
        d.ellipse([px - rr, py - rr, px + rr, py + rr], fill=OR + (int(220 * e),))
        if e < 1:
            calque.putalpha(calque.getchannel('A').point(lambda v: int(v * e)))
        im.alpha_composite(calque)
    return halo(reduit(im), (255, 214, 170), force=0.3, rayon=2.0)


if __name__ == '__main__':
    sortie = sys.argv[1] if len(sys.argv) > 1 else '.'
    ecrire([render(f) for f in range(NF)], 'fleches', DUR, sortie, affiche=12)
