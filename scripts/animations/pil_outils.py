# Outils communs des animations dessinees au crayon PIL (13/10/2026) :
# canevas 4x, sortie reduite en alpha premultiplie, halo doux pour les fonds
# sombres, controle « rien ne touche le bord », ecriture APNG + affiche.
import math
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

from motlib import W, SS, WS, save_apng

C = W / 2


def canevas():
    """Calque RGBA 4x transparent et son crayon."""
    im = Image.new('RGBA', (WS, WS), (0, 0, 0, 0))
    return im, ImageDraw.Draw(im)


def reduit(im):
    """4x -> 224 sans franges sombres (reduction en alpha premultiplie)."""
    return im.convert('RGBa').resize((W, W), Image.LANCZOS).convert('RGBA')


def halo(im, couleur, force=0.3, rayon=2.4):
    """Halo doux sous le dessin : le garde lisible sur fond sombre."""
    a = im.getchannel('A').filter(ImageFilter.GaussianBlur(rayon))
    a = a.point(lambda v: int(min(255, v * force)))
    h = Image.new('RGBA', im.size, couleur + (0,)); h.putalpha(a)
    h.alpha_composite(im)
    return h


def lisse(e0, e1, x):
    t = min(1.0, max(0.0, (x - e0) / (e1 - e0)))
    return t * t * (3 - 2 * t)


def fenetre(u, entree=0.12, sortie=0.15):
    """Apparition puis disparition douces sur u in [0, 1]."""
    if u <= 0 or u >= 1:
        return 0.0
    return min(lisse(0, entree, u), 1 - lisse(1 - sortie, 1, u))


def ecrire(frames, nom, duree, dossier='.', affiche=None):
    dossier = Path(dossier); dossier.mkdir(parents=True, exist_ok=True)
    marge = max(int(np.asarray(f)[..., 3][np.r_[0:3, -3:0]].max()) for f in frames)
    marge = max(marge, max(int(np.asarray(f)[..., 3][:, np.r_[0:3, -3:0]].max()) for f in frames))
    save_apng(frames, dossier / f'{nom}.png', duree)
    k = affiche if affiche is not None else len(frames) // 3
    frames[k].save(dossier / f'{nom}-poster.webp', 'WEBP', quality=92, method=6)
    poids = (dossier / f'{nom}.png').stat().st_size // 1024
    print(f'{nom} : {len(frames)} images, {poids} Ko, alpha max au bord {marge}')
