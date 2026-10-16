# Animation de portrait « Chat endormi » (rare, collection Douceur, 16/10/2026).
# Lancer depuis ce dossier :  python chat_endormi.py [dossier de sortie]
# Un chaton roux tigré dort en croissant sur le haut du cadre, la tête posée sur
# ses pattes, la queue touffue enroulée autour de lui. Il respire, de petits
# « z » s'échappent, le bout de sa queue frémit ; au milieu de la boucle son
# oreille remue, il ouvre un œil vert, regarde, et se rendort. Respiration,
# « z » et réveil sont périodiques : boucle sans couture.
# Deuxième dessin (16/10/2026, demandé par le propriétaire) : modelé doux par
# parties (lumière en haut, dessous plus sombre), visage plus grand, pattes,
# rayures qui suivent le dos, « M » du front, ombre portée sur le cadre.
import math
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

from motlib import SS, WS
from pil_outils import C, ecrire, halo, lisse, reduit

NF = 64
DUR = 110
ROUX_CLAIR = (246, 178, 108)
ROUX = (226, 140, 72)
ROUX_SOMBRE = (178, 96, 44)
RAYURE = (176, 92, 40)
CREME = (252, 238, 216)
CREME_OMBRE = (226, 204, 176)
CONTOUR = (112, 62, 30)
ROSE = (238, 156, 150)
ROSE_SOMBRE = (198, 108, 104)
VERT = (132, 176, 84)
CX, CY = C + 3.0, C - 57.0          # couché sur le haut du cadre


def P(x, y):
    return (x * SS, y * SS)


def police(taille):
    for chemin in (r'C:\Windows\Fonts\georgiab.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf'):
        if Path(chemin).exists():
            return ImageFont.truetype(chemin, taille)
    return ImageFont.load_default()


class Toile:
    """Calque RGBA 4x en flottants, peint par masques (modelé par dégradé vertical)."""

    def __init__(self):
        self.rgb = np.zeros((WS, WS, 3), np.float32)
        self.a = np.zeros((WS, WS), np.float32)
        self.yy = np.mgrid[0:WS, 0:WS][0].astype(np.float32) / SS

    def masque(self, dessin, flou=0.0):
        m = Image.new('L', (WS, WS), 0)
        dessin(ImageDraw.Draw(m))
        if flou:
            m = m.filter(ImageFilter.GaussianBlur(flou * SS))
        return np.asarray(m, np.float32) / 255

    def peindre(self, m, haut, bas, y0, y1, opacite=1.0):
        q = np.clip((self.yy - y0) / max(y1 - y0, 1e-3), 0, 1)[..., None]
        couleur = np.array(haut, np.float32) * (1 - q) + np.array(bas, np.float32) * q
        a = m * opacite
        self.rgb = couleur * a[..., None] + self.rgb * (1 - a[..., None])
        self.a = a + self.a * (1 - a)

    def contour(self, m, couleur, epaisseur=0.9, opacite=0.85):
        """Liseré foncé sur le bord extérieur d'une silhouette."""
        im = Image.fromarray((m * 255).astype(np.uint8), 'L')
        large = np.asarray(im.filter(ImageFilter.MaxFilter(int(epaisseur * SS) * 2 + 1)), np.float32) / 255
        bord = np.clip(large - m, 0, 1) * opacite
        self.rgb = np.array(couleur, np.float32) * bord[..., None] + self.rgb * (1 - bord[..., None])
        self.a = bord + self.a * (1 - bord)

    def image(self):
        out = np.zeros((WS, WS, 4), np.uint8)
        # self.rgb est prémultiplié par self.a : on le rend en couleur droite
        out[..., :3] = np.clip(self.rgb / np.maximum(self.a, 1e-4)[..., None], 0, 255).astype(np.uint8)
        out[..., 3] = np.clip(self.a * 255, 0, 255).astype(np.uint8)
        return Image.fromarray(out, 'RGBA')


def ovale(cx, cy, rx, ry):
    return [P(cx - rx, cy - ry), P(cx + rx, cy + ry)]


def queue_pts(flic):
    pts = []
    for i in range(40):
        s = i / 39
        a = math.radians(-10 + 205 * s)
        rx, ry = 22.5 - 4.5 * s, 9.6 - 2.4 * s
        x = CX + 3 + rx * math.cos(a)
        y = CY + 2.5 + ry * math.sin(a)
        if s > 0.72:
            y += flic * ((s - 0.72) / 0.28) ** 2
        pts.append((x, y))
    return pts


def render(f):
    t = f / NF
    T = Toile()
    souffle = math.sin(2 * math.pi * 3 * t)
    reveil = lisse(0.52, 0.58, t) * (1 - lisse(0.74, 0.80, t))
    oreille = math.sin(2 * math.pi * lisse(0.47, 0.53, t)) if 0.47 < t < 0.53 else 0.0
    flic = math.sin(2 * math.pi * 4 * t) * (1.6 + 3.4 * reveil)
    gonfle = 1 + 0.04 * souffle

    # ombre portée douce sur le cadre
    T.peindre(T.masque(lambda d: d.ellipse(ovale(CX + 1, CY + 9.5, 23, 3.4), fill=255), flou=1.4), (60, 40, 30), (60, 40, 30), 0, 1, 0.28)

    # corps en croissant (respire) + cuisse arrière
    by0, by1 = CY - 10 * gonfle, CY + 9
    corps = T.masque(lambda d: (d.ellipse(ovale(CX + 5, CY + 0.5 - 0.5 * souffle, 19, 9.6 * gonfle), fill=255),
                                d.ellipse(ovale(CX + 15, CY + 2.5, 8.5, 7.2), fill=255)))
    T.peindre(corps, ROUX_CLAIR, ROUX_SOMBRE, by0, by1)
    # rayures tigrées : partent de l'échine et descendent sur le flanc en s'incurvant
    haut_dos = CY + 0.5 - 0.5 * souffle - 9.6 * gonfle
    for dx in (-7, -1.5, 4, 9.5, 15, 20):
        def rayure(d, dx=dx):
            pts = []
            for i in range(9):
                q = i / 8
                pts.append(P(CX + dx + 2.2 * q - 1.4 * q * q, haut_dos + 0.6 + 9.0 * q))
            d.line(pts, fill=255, width=int((1.9 - 0.4 * abs(dx - 6) / 14) * SS), joint='curve')
        T.peindre(T.masque(rayure, flou=0.45) * corps, RAYURE, RAYURE, 0, 1, 0.62)
    # reflet du dos
    T.peindre(T.masque(lambda d: d.ellipse(ovale(CX + 4, CY - 6.5 * gonfle, 12, 2.2), fill=255), flou=1.0) * corps, (255, 214, 160), (255, 214, 160), 0, 1, 0.45)
    T.contour(corps, CONTOUR, 0.8)

    # queue touffue enroulée devant, anneaux plus sombres, bout clair
    qp = queue_pts(flic)
    queue = T.masque(lambda d: [d.ellipse(ovale(x, y, (3.1 - 0.6 * i / 39), (3.1 - 0.6 * i / 39)), fill=255) for i, (x, y) in enumerate(qp)])
    T.peindre(queue, ROUX_CLAIR, ROUX_SOMBRE, CY - 2, CY + 13)
    # reflet le long du dessus de la queue : elle se détache du corps
    T.peindre(T.masque(lambda d: d.line([P(x, y - 1.6) for x, y in qp[2:-3]], fill=255, width=int(1.1 * SS), joint='curve'), flou=0.5) * queue, (255, 206, 150), (255, 206, 150), 0, 1, 0.55)
    for i in (8, 15, 22, 29):
        x, y = qp[i]
        T.peindre(T.masque(lambda d, x=x, y=y: d.ellipse(ovale(x, y, 1.2, 3.0), fill=255), flou=0.3) * queue, RAYURE, RAYURE, 0, 1, 0.7)
    x, y = qp[-1]
    T.peindre(T.masque(lambda d: d.ellipse(ovale(x, y, 2.6, 2.6), fill=255), flou=0.3) * queue, CREME, CREME_OMBRE, y - 2, y + 2, 0.9)
    T.contour(queue, CONTOUR, 0.75, 0.95)

    # pattes avant, crème, sous le menton
    hx, hy = CX - 14.5, CY - 0.5
    pattes = T.masque(lambda d: (d.ellipse(ovale(hx - 3.5, CY + 7.2, 4.2, 2.6), fill=255), d.ellipse(ovale(hx + 4.0, CY + 7.6, 4.2, 2.6), fill=255)))
    T.peindre(pattes, CREME, CREME_OMBRE, CY + 5, CY + 10)
    T.contour(pattes, CONTOUR, 0.6, 0.7)

    # oreilles (arrondies, intérieur rose)
    def oreille_pts(sens):
        bascule = 1.4 * oreille if sens > 0 else 0.0
        bx = hx + (4.6 if sens > 0 else -5.6)
        return [(bx - 4.2, hy - 4.5), (bx + 0.6 + bascule, hy - 14.0 + abs(bascule) * 0.3), (bx + 4.2, hy - 5.2)]
    for sens in (-1, 1):
        pts = oreille_pts(sens)
        m = T.masque(lambda d, pts=pts: d.polygon([P(*p) for p in pts], fill=255), flou=0.25)
        T.peindre(m, ROUX, ROUX_SOMBRE, hy - 14, hy - 4)
        T.contour(m, CONTOUR, 0.6)
        inner = [(pts[0][0] + 1.4, pts[0][1] - 0.4), (pts[1][0], pts[1][1] + 3.0), (pts[2][0] - 1.4, pts[2][1] - 0.3)]
        T.peindre(T.masque(lambda d, p=inner: d.polygon([P(*q) for q in p], fill=255), flou=0.3), ROSE, ROSE_SOMBRE, hy - 11, hy - 5, 0.95)

    # tête ronde aux joues duveteuses
    tete = T.masque(lambda d: (d.ellipse(ovale(hx, hy, 10.2, 8.6), fill=255), d.ellipse(ovale(hx - 6.2, hy + 3.2, 4.4, 3.6), fill=255), d.ellipse(ovale(hx + 6.0, hy + 3.4, 4.6, 3.6), fill=255)))
    T.peindre(tete, ROUX_CLAIR, ROUX_SOMBRE, hy - 9, hy + 8)
    # « M » du front et rayures des tempes
    for dx, l in ((-2.6, 3.2), (0, 3.8), (2.6, 3.2)):
        T.peindre(T.masque(lambda d, dx=dx, l=l: d.line([P(hx + dx, hy - 8), P(hx + dx * 0.7, hy - 8 + l)], fill=255, width=int(1.1 * SS)), flou=0.25) * tete, RAYURE, RAYURE, 0, 1, 0.8)
    for sens in (-1, 1):
        T.peindre(T.masque(lambda d, s=sens: d.arc([P(hx + s * 7.5 - 3, hy - 2), P(hx + s * 7.5 + 3, hy + 3)], 250 if s > 0 else 110, 300 if s > 0 else 160, fill=255, width=int(1.0 * SS)), flou=0.25) * tete, RAYURE, RAYURE, 0, 1, 0.7)
    # museau crème
    T.peindre(T.masque(lambda d: (d.ellipse(ovale(hx - 2.4, hy + 3.4, 3.6, 2.8), fill=255), d.ellipse(ovale(hx + 2.4, hy + 3.4, 3.6, 2.8), fill=255), d.ellipse(ovale(hx, hy + 5.0, 3.0, 2.4), fill=255)), flou=0.4) * tete,
              CREME, CREME_OMBRE, hy + 1, hy + 7)
    T.contour(tete, CONTOUR, 0.8)
    rgba = T.image()
    d = ImageDraw.Draw(rgba)
    # nez, bouche « ω », moustaches
    d.polygon([P(hx - 1.3, hy + 1.6), P(hx + 1.3, hy + 1.6), P(hx, hy + 2.9)], fill=ROSE_SOMBRE + (255,))
    d.arc([P(hx - 2.2, hy + 2.2), P(hx, hy + 4.4)], 0, 160, fill=CONTOUR + (220,), width=max(2, int(0.5 * SS)))
    d.arc([P(hx, hy + 2.2), P(hx + 2.2, hy + 4.4)], 20, 180, fill=CONTOUR + (220,), width=max(2, int(0.5 * SS)))
    for sens in (-1, 1):
        for dy in (-0.5, 0.8):
            d.line([P(hx + sens * 4.2, hy + 3.4 + dy), P(hx + sens * 11.5, hy + 2.6 + dy * 2.2)], fill=(255, 250, 240, 200), width=max(1, int(0.35 * SS)))
    # yeux : fermés (arcs avec cils) ; l'œil droit s'ouvre, vert, pupille fendue, reflet
    for ex in (hx - 4.0, hx + 4.0):
        ouvert = reveil if ex > hx else 0.0
        if ouvert > 0.15:
            h = 2.1 * ouvert
            d.ellipse([P(ex - 2.2, hy - 1.0 - h), P(ex + 2.2, hy - 1.0 + h)], fill=VERT + (255,), outline=CONTOUR + (255,), width=max(2, int(0.5 * SS)))
            d.ellipse([P(ex - 0.45, hy - 1.0 - h * 0.85), P(ex + 0.45, hy - 1.0 + h * 0.85)], fill=(28, 26, 22, 255))
            d.ellipse([P(ex + 0.5, hy - 1.0 - h * 0.6), P(ex + 1.2, hy - 1.0 - h * 0.6 + 0.7)], fill=(255, 255, 255, 230))
        else:
            d.arc([P(ex - 2.4, hy - 3.0), P(ex + 2.4, hy + 0.4)], 15, 165, fill=CONTOUR + (255,), width=max(2, int(0.75 * SS)))
            cote = -1 if ex < hx else 1
            d.line([P(ex + cote * 2.2, hy - 1.0), P(ex + cote * 3.0, hy - 1.8)], fill=CONTOUR + (255,), width=max(1, int(0.45 * SS)))
    # joues rosées
    for sens in (-1, 1):
        d.ellipse([P(hx + sens * 5.8 - 1.6, hy + 1.6), P(hx + sens * 5.8 + 1.6, hy + 2.8)], fill=(240, 150, 130, 70))
    # les « z » montent quand il dort
    endormi = 1 - reveil
    for k in range(3):
        u = (t * 3 + k / 3) % 1.0
        a = math.sin(math.pi * u) * endormi
        if a < 0.05:
            continue
        taille = 4.0 + 3.2 * u
        zx, zy = hx - 6 - 7 * u, hy - 9 - 6 * u
        d.text(P(zx, zy), 'z', font=police(int(taille * SS)), fill=(92, 112, 140, int(235 * a)), anchor='mm', stroke_width=1, stroke_fill=(255, 250, 240, int(150 * a)))
    return halo(reduit(rgba), (255, 238, 210), force=0.3, rayon=2.0)


if __name__ == '__main__':
    sortie = sys.argv[1] if len(sys.argv) > 1 else '.'
    ecrire([render(f) for f in range(NF)], 'chat-endormi', DUR, sortie, affiche=12)
