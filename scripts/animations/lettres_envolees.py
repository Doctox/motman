# Animation de portrait « Lettres envolées » (rare, vague Le jeu, 13/10/2026).
# Lancer depuis ce dossier :  python lettres_envolees.py [dossier de sortie]
# Des capitales à empattements s'échappent du bord du portrait, grandissent en
# s'éloignant, tournent un peu et montent avant de s'effacer, avec une poussière
# dorée dans leur sillage. Chaque lettre suit un cycle périodique.
import math
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

from motlib import SS
from pil_outils import C, canevas, ecrire, fenetre, halo, lisse, reduit

NF = 60
DUR = 110
ENCRE = (31, 58, 51, 255)          # vert encre de la maison
OR = (197, 155, 69, 255)            # --mm-gold
CREME = (255, 248, 236, 255)


def police(taille):
    for chemin in (r'C:\Windows\Fonts\georgiab.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf'):
        if Path(chemin).exists():
            return ImageFont.truetype(chemin, taille)
    return ImageFont.load_default()


# phi : angle de départ sur le bord du portrait, derive : écart latéral,
# debut/duree : fenêtre de vie sur la boucle, tour : rotation en degrés.
LETTRES = (
    dict(c='M', phi=200, derive=-14, debut=0.00, duree=0.55, tour=-18, couleur=ENCRE),
    dict(c='O', phi=-20, derive=12, debut=0.12, duree=0.55, tour=22, couleur=OR),
    dict(c='T', phi=150, derive=-8, debut=0.26, duree=0.52, tour=-25, couleur=ENCRE),
    dict(c='S', phi=30, derive=16, debut=0.38, duree=0.55, tour=15, couleur=ENCRE),
    dict(c='É', phi=215, derive=-18, debut=0.50, duree=0.52, tour=20, couleur=OR),
    dict(c='A', phi=-35, derive=10, debut=0.62, duree=0.55, tour=-20, couleur=ENCRE),
    dict(c='L', phi=165, derive=-10, debut=0.75, duree=0.52, tour=18, couleur=ENCRE),
    dict(c='R', phi=10, derive=14, debut=0.87, duree=0.55, tour=-15, couleur=OR),
)
TAILLE_MAX = 17.0     # hauteur de capitale (px 224) au plus loin


def lettre(c, hauteur, couleur):
    """Une capitale cernée de crème, en 4x, recadrée sur son encre."""
    taille = int(hauteur * SS * 1.38)
    f = police(taille)
    trait = max(2, int(taille * 0.07))
    im = Image.new('RGBA', (taille * 2, taille * 2), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.text((taille, taille), c, font=f, fill=couleur, anchor='mm', stroke_width=trait, stroke_fill=CREME)
    return im.crop(im.getbbox())


def render(f):
    t = f / NF
    im, d = canevas()
    for i, L in enumerate(LETTRES):
        u = ((t - L['debut']) % 1.0) / L['duree']
        if u >= 1:
            continue
        e = fenetre(u, 0.16, 0.24)
        if e <= 0.01:
            continue
        phi = math.radians(L['phi'])
        r = 48 + 38 * (1 - (1 - u) ** 1.6)                    # du bord du portrait vers l'extérieur
        x = C + r * math.cos(phi) + L['derive'] * u
        y = C + r * math.sin(phi) - 34 * u * u                 # la lettre monte en s'éloignant
        h = TAILLE_MAX * (0.45 + 0.55 * lisse(0, 0.5, u))
        sprite = lettre(L['c'], h, L['couleur']).rotate(L['tour'] * u, resample=Image.BICUBIC, expand=True)
        if e < 1:
            sprite.putalpha(sprite.getchannel('A').point(lambda v: int(v * e)))
        im.alpha_composite(sprite, (int(x * SS - sprite.width / 2), int(y * SS - sprite.height / 2)))
        # poussière dorée dans le sillage
        for k in range(4):
            uk = u - 0.05 * (k + 1)
            if uk <= 0:
                continue
            rk = 48 + 38 * (1 - (1 - uk) ** 1.6)
            xk = C + rk * math.cos(phi) + L['derive'] * uk + 2.2 * math.sin(7 * k + i)
            yk = C + rk * math.sin(phi) - 34 * uk * uk + 2.2 * math.cos(5 * k + i)
            a = int(200 * e * (1 - k / 4))
            rr = (1.3 - 0.2 * k) * SS
            d.ellipse([xk * SS - rr, yk * SS - rr, xk * SS + rr, yk * SS + rr], fill=OR[:3] + (a,))
    return halo(reduit(im), (255, 238, 205), force=0.32, rayon=2.0)


if __name__ == '__main__':
    sortie = sys.argv[1] if len(sys.argv) > 1 else '.'
    ecrire([render(f) for f in range(NF)], 'lettres-envolees', DUR, sortie, affiche=20)
