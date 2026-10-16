# Animation de portrait « Chat endormi » (rare, collection Douceur, 16/10/2026).
# Lancer depuis ce dossier :  python chat_endormi.py [dossier de sortie]
# Un chaton roux tigré dort en boule sur le haut du cadre. Il respire, de
# petits « z » s'échappent, le bout de sa queue frémit ; au milieu de la boucle
# son oreille remue, il ouvre un œil vert, regarde, et se rendort. Respiration,
# « z » et réveil sont périodiques : boucle sans couture.
import math
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

from motlib import SS
from pil_outils import C, canevas, ecrire, halo, lisse, reduit

NF = 64
DUR = 110
PELAGE = (232, 150, 80)
RAYURE = (190, 106, 50)
CREME = (250, 232, 206)
TRAIT = (104, 62, 34)
ROSE = (234, 160, 150)
VERT = (126, 170, 82)
ENCRE = (60, 74, 92)
CX, CY = C + 2, C - 60          # le chat est couché sur le haut du cadre


def police(taille):
    for chemin in (r'C:\Windows\Fonts\georgiab.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf'):
        if Path(chemin).exists():
            return ImageFont.truetype(chemin, taille)
    return ImageFont.load_default()


def P(x, y):
    return (x * SS, y * SS)


def ellipse(d, cx, cy, rx, ry, fond, trait=TRAIT, lw=1.0):
    d.ellipse([P(cx - rx, cy - ry), P(cx + rx, cy + ry)], fill=fond + (255,), outline=trait + (255,), width=max(2, int(lw * SS)))


def render(f):
    t = f / NF
    im, d = canevas()
    souffle = math.sin(2 * math.pi * 3 * t)                    # trois respirations par boucle
    reveil = lisse(0.52, 0.58, t) * (1 - lisse(0.74, 0.80, t))   # l'œil s'ouvre puis se referme
    oreille = math.sin(2 * math.pi * lisse(0.47, 0.53, t)) * (1 if 0.47 < t < 0.53 else 0)
    # queue : enroulée devant le corps, le bout frémit (plus fort quand il est réveillé)
    flic = math.sin(2 * math.pi * 4 * t) * (2.0 + 4.0 * reveil)
    queue = []
    for i in range(26):
        s = i / 25
        a = math.radians(-15 + 200 * s)
        rx, ry = 19 - 3 * s, 7.5 - 1.5 * s
        x = CX + 2 + rx * math.cos(a)
        y = CY + 3 + ry * math.sin(a) + (flic * s ** 3 if s > 0.7 else 0)
        queue.append(P(x, y))
    # corps (respire), rayures, ventre
    hy = 8.6 * (1 + 0.045 * souffle)
    ellipse(d, CX + 3, CY - 0.4 * souffle, 18.5, hy, PELAGE)
    for k in (-8, -2, 4, 10):
        d.arc([P(CX + 3 + k - 4, CY - hy - 0.4 * souffle), P(CX + 3 + k + 4, CY - hy + 9 - 0.4 * souffle)], 200, 340,
              fill=RAYURE + (255,), width=max(2, int(1.3 * SS)))
    d.line(queue, fill=TRAIT + (255,), width=int(4.4 * SS), joint='curve')
    d.line(queue, fill=PELAGE + (255,), width=int(2.8 * SS), joint='curve')
    bout = queue[-4:]
    d.line(bout, fill=RAYURE + (255,), width=int(2.8 * SS), joint='curve')
    # tête posée à gauche
    hx, hy0 = CX - 15, CY + 1.5
    for sens, pointe_x in ((-1, -6.2), (1, 3.2)):
        bascule = 1.6 * oreille if sens == 1 else 0
        base_g, base_d = (hx + pointe_x - 3.2, hy0 - 4.5), (hx + pointe_x + 3.2, hy0 - 5.4)
        sommet = (hx + pointe_x + 0.6 + bascule, hy0 - 12.5 + abs(bascule) * 0.4)
        d.polygon([P(*base_g), P(*sommet), P(*base_d)], fill=PELAGE + (255,), outline=TRAIT + (255,), width=max(2, int(1.0 * SS)))
        d.polygon([P(base_g[0] + 1.3, base_g[1] - 0.6), P(sommet[0], sommet[1] + 2.6), P(base_d[0] - 1.3, base_d[1] - 0.4)], fill=ROSE + (255,))
    ellipse(d, hx, hy0, 8.4, 7.2, PELAGE)
    d.arc([P(hx - 3, hy0 - 7.4), P(hx + 3, hy0 - 1)], 200, 340, fill=RAYURE + (255,), width=max(2, int(1.2 * SS)))
    ellipse(d, hx - 0.5, hy0 + 3.2, 4.2, 2.8, CREME, trait=CREME)
    d.polygon([P(hx - 1.4, hy0 + 1.4), P(hx + 0.6, hy0 + 1.4), P(hx - 0.4, hy0 + 2.6)], fill=ROSE + (255,))
    # yeux : fermés (arcs), ou l'œil droit ouvert, vert, pupille fendue
    for ex in (hx - 3.6, hx + 2.6):
        ouvert = reveil if ex > hx else 0.0
        if ouvert > 0.15:
            h = 1.9 * ouvert
            d.ellipse([P(ex - 1.9, hy0 - 1.2 - h), P(ex + 1.9, hy0 - 1.2 + h)], fill=VERT + (255,), outline=TRAIT + (255,), width=max(1, int(0.6 * SS)))
            d.ellipse([P(ex - 0.45, hy0 - 1.2 - h * 0.85), P(ex + 0.45, hy0 - 1.2 + h * 0.85)], fill=(30, 30, 30, 255))
        else:
            d.arc([P(ex - 2, hy0 - 3), P(ex + 2, hy0 + 0.4)], 20, 160, fill=TRAIT + (255,), width=max(2, int(0.9 * SS)))
    # moustaches
    for dy in (-0.4, 0.9):
        d.line([P(hx - 4.4, hy0 + 3 + dy), P(hx - 10.5, hy0 + 2.2 + dy * 2)], fill=TRAIT + (170,), width=max(1, int(0.5 * SS)))
    # les « z » montent quand il dort
    endormi = 1 - reveil
    for k in range(3):
        u = (t * 3 + k / 3) % 1.0
        a = math.sin(math.pi * u) * endormi
        if a < 0.05:
            continue
        taille = 4.0 + 3.2 * u
        zx, zy = hx - 5 - 7 * u, hy0 - 8 - 6 * u
        fz = police(int(taille * SS))
        d.text(P(zx, zy), 'z', font=fz, fill=(92, 112, 140, int(235 * a)), anchor='mm', stroke_width=1, stroke_fill=(255, 250, 240, int(150 * a)))
    return halo(reduit(im), (255, 238, 210), force=0.3, rayon=2.0)


if __name__ == '__main__':
    sortie = sys.argv[1] if len(sys.argv) > 1 else '.'
    ecrire([render(f) for f in range(NF)], 'chat-endormi', DUR, sortie, affiche=12)
