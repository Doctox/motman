# Fait passer une animation DERRIÈRE le portrait au lieu de devant (05/11/2026).
# Dragon solaire, L'Oiseau de lumière et Papillons du songe traversaient le visage ;
# leurs générateurs ne sont pas dans le dépôt, on reprend donc les images telles quelles
# et on efface ce qui tombe sur le portrait.
# Lancer depuis ce dossier :  python derriere_portrait.py <dossier-lab> [dossier de sortie]
# Écrit <nom>-2.png et <nom>-2-poster.webp : une image refaite change de nom, sinon
# les téléphones gardent l'ancienne en cache.
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageSequence

from motlib import W, posterize

# Le portrait fait 52 de rayon sur ce canevas (55 dans le bandeau de duel, où
# l'animation est à 204 %). Le fondu commence dans le portrait et finit juste après.
R_DEDANS, R_DEHORS = 47.0, 58.0
SEUIL_VU = 150                  # en dessous, on ne voit plus la créature
NOMS = ('dragon-solaire', 'oiseau-de-lumiere', 'papillons-du-songe')


def masque():
    yy, xx = np.mgrid[:W, :W]
    t = np.clip((np.hypot(xx - (W - 1) / 2, yy - (W - 1) / 2) - R_DEDANS) / (R_DEHORS - R_DEDANS), 0, 1)
    return (t * t * (3 - 2 * t)).astype(np.float32)


def traiter(nom, lab, sortie):
    src = Image.open(lab / f'{nom}.png')
    m = masque()
    images, durees = [], []
    for f in ImageSequence.Iterator(src):
        a = np.asarray(f.convert('RGBA')).astype(np.float32)
        avant = (a[..., 3] > 90).sum()
        a[..., 3] *= m
        # La créature est derrière le portrait : elle y passe vite, on ne regarde pas du vide.
        cachee = avant > SEUIL_VU and (a[..., 3] > 90).sum() <= SEUIL_VU
        durees.append(f.info.get('duration', 100) / (2 if cachee else 1))
        images.append(Image.fromarray(a.round().clip(0, 255).astype(np.uint8), 'RGBA'))
    # L'affiche : l'image la plus chargée qui reste, la créature bien visible autour du portrait.
    k = int(np.argmax([np.asarray(i)[..., 3].sum() for i in images]))
    images[k].save(sortie / f'{nom}-2-poster.webp', 'WEBP', quality=92, method=6)
    images = [posterize(i, 4) for i in images]
    images[0].save(sortie / f'{nom}-2.png', format='PNG', save_all=True, append_images=images[1:],
                   duration=durees, loop=0, disposal=0, blend=0, optimize=True)
    print(f'{nom}-2 : {len(images)} images, {(sortie / f"{nom}-2.png").stat().st_size // 1024} Ko')


if __name__ == '__main__':
    lab = Path(sys.argv[1])
    sortie = Path(sys.argv[2]) if len(sys.argv) > 2 else lab
    sortie.mkdir(parents=True, exist_ok=True)
    for nom in NOMS:
        traiter(nom, lab, sortie)
