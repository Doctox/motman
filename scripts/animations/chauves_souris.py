# Animation de portrait « Chauves-souris » (vague Halloween, 13/10/2026).
# Lancer depuis ce dossier :  python chauves_souris.py  [dossier de sortie]
# Trois silhouettes aubergine tournent autour du portrait en battant des ailes ;
# un liseré lavande les garde lisibles sur fond sombre. La boucle est sans
# couture : trajectoires et apparitions sont périodiques sur NF images.
import math
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

from motlib import SS, W, WS, Canvas, blur_fast, downsample, over_small, save_apng, stamp_dot, stamp_star, to_image

NF = 50
DUR = 110
C = W / 2
FLAP = 5                     # images par battement d'ailes (divise NF)

BODY = np.array([24, 18, 30]) / 255
MEMBRANE = np.array([50, 38, 60]) / 255
BONE = np.array([20, 15, 25]) / 255
RIM = np.array([205, 188, 224]) / 255
EYE = (0.96, 0.78, 0.42)
GLOW = np.array([184, 162, 214], np.float32) / 255

# r0 : rayon moyen, dr : respiration du rayon, sens : +1 horaire, debut et
# duree : fenetre de visibilite sur la boucle (0..1), echelle : profondeur.
BATS = (
    dict(r0=74, dr=6, theta0=-2.3, sens=1, debut=0.00, duree=0.62, echelle=1.45, phase=0.0),
    dict(r0=78, dr=5, theta0=0.4, sens=-1, debut=0.34, duree=0.60, echelle=1.18, phase=0.37),
    dict(r0=70, dr=6, theta0=2.6, sens=1, debut=0.67, duree=0.62, echelle=1.32, phase=0.71),
)
FADE = 0.09


def envelope(t, debut, duree):
    """Visibilite periodique : 0 hors fenetre, montee et descente douces."""
    u = (t - debut) % 1.0
    if u >= duree:
        return 0.0, u
    e = min(u / FADE, (duree - u) / FADE, 1.0)
    return e * e * (3 - 2 * e), u


def position(b, t):
    th = b['theta0'] + b['sens'] * 2 * math.pi * t
    r = b['r0'] + b['dr'] * math.sin(2 * math.pi * 2 * t + b['phase'] * 6)
    bob = 3.0 * math.sin(2 * math.pi * 3 * t + b['phase'] * 9)
    return C + r * math.cos(th), C + 0.9 * r * math.sin(th) + bob


def scallop(p, q, toward, n=9, depth=0.46):
    """Bord de fuite festonne entre deux pointes d'ailes."""
    m = (p + q) / 2
    ctrl = m + (toward - m) * depth
    s = np.linspace(0, 1, n)[1:-1, None]
    return (1 - s) ** 2 * p + 2 * (1 - s) * s * ctrl + s * s * q


def wing_local(a):
    """Aile droite en coordonnees locales (px 224, y vers le bas). a = +1 ailes hautes."""
    shoulder = np.array([1.6, -1.2])
    wrist = np.array([6.5, -3.0])
    tips = [np.array([13.5, -4.5]), np.array([12.2, 1.4]), np.array([8.6, 4.0])]
    tail = np.array([2.2, 3.4])
    ang = -a * math.radians(34)
    ca, sa = math.cos(ang), math.sin(ang)
    squash = 1.0 - 0.28 * abs(a)

    def tr(p):
        d = p - shoulder
        d = np.array([d[0] * squash, d[1]])
        return shoulder + np.array([d[0] * ca - d[1] * sa, d[0] * sa + d[1] * ca])

    wrist_t = tr(wrist)
    tips_t = [tr(p) for p in tips]
    tail_t = tr(tail) * 0.35 + tail * 0.65
    outline = [shoulder, wrist_t, tips_t[0]]
    outline += list(scallop(tips_t[0], tips_t[1], wrist_t))
    outline += [tips_t[1]]
    outline += list(scallop(tips_t[1], tips_t[2], wrist_t))
    outline += [tips_t[2]]
    outline += list(scallop(tips_t[2], tail_t, shoulder, depth=0.22))
    outline += [tail_t]
    bones = [(wrist_t, tips_t[0]), (wrist_t, tips_t[1]), (wrist_t, tips_t[2]), (shoulder, wrist_t)]
    return np.array(outline), bones


def to_world(pts, x, y, scale, tilt, lift):
    pts = np.asarray(pts, float) * scale
    c, s = math.cos(tilt), math.sin(tilt)
    out = np.stack([pts[..., 0] * c - pts[..., 1] * s, pts[..., 0] * s + pts[..., 1] * c], -1)
    return (out + np.array([x, y + lift])) * SS


def draw_bat(b, t, f):
    """Renvoie (couleur premultipliee 4x, alpha 4x, position, yeux) ou None."""
    env, _ = envelope(t, b['debut'], b['duree'])
    if env <= 0.001:
        return None
    x, y = position(b, t)
    x2, _ = position(b, t + 0.004)
    vx = (x2 - x) / 0.004
    tilt = math.radians(16) * math.tanh(vx / 260.0)
    a = math.cos(2 * math.pi * (f / FLAP + b['phase']))
    lift = -0.7 * a
    scale = b['echelle'] * (0.55 + 0.45 * env)

    wing_im = Image.new('L', (WS, WS), 0)
    body_im = Image.new('L', (WS, WS), 0)
    bone_im = Image.new('L', (WS, WS), 0)
    dw, db, dn = ImageDraw.Draw(wing_im), ImageDraw.Draw(body_im), ImageDraw.Draw(bone_im)
    outline, bones = wing_local(a)
    for side in (1, -1):
        mirror = np.array([side, 1.0])
        poly = to_world(outline * mirror, x, y, scale, tilt, lift)
        dw.polygon([tuple(p) for p in poly], fill=255)
        for p, q in bones:
            seg = to_world(np.array([p, q]) * mirror, x, y, scale, tilt, lift)
            dn.line([tuple(seg[0]), tuple(seg[1])], fill=255, width=max(2, int(round(0.45 * SS * scale))))
    body = to_world(np.array([[0, 2.0]]), x, y, scale, tilt, lift)[0]
    rx, ry = 2.6 * SS * scale, 4.3 * SS * scale
    db.ellipse([body[0] - rx, body[1] - ry, body[0] + rx, body[1] + ry], fill=255)
    head = to_world(np.array([[0, -3.3]]), x, y, scale, tilt, lift)[0]
    rh = 2.5 * SS * scale
    db.ellipse([head[0] - rh, head[1] - rh, head[0] + rh, head[1] + rh], fill=255)
    for side in (1, -1):
        ear = to_world(np.array([[-2.1 * side, -4.4], [-1.5 * side, -7.9], [-0.3 * side, -5.1]]), x, y, scale, tilt, lift)
        db.polygon([tuple(p) for p in ear], fill=255)

    mw = np.asarray(wing_im, np.float32) / 255
    mb = np.asarray(body_im, np.float32) / 255
    mn = np.asarray(bone_im, np.float32) / 255 * mw
    m = np.maximum(mw, mb)
    col = MEMBRANE[None, None] * mw[..., None]
    col = col * (1 - mn[..., None]) + BONE[None, None] * mn[..., None]
    col = col * (1 - mb[..., None]) + BODY[None, None] * mb[..., None]
    # Liseré : la lumiere vient d'en haut a gauche.
    off = int(1.2 * SS)
    shifted = np.roll(np.roll(m, off, axis=0), off, axis=1)
    rim = np.clip(m - shifted, 0, 1) * 0.6
    col = col * (1 - rim[..., None]) + RIM[None, None] * rim[..., None]
    alpha = m * (0.94 * env)
    eyes = [to_world(np.array([[s * 0.95, -3.5]]), x, y, scale, tilt, lift)[0] for s in (-1, 1)]
    return col * alpha[..., None], alpha, (x, y), eyes, env, scale


def puff(cv, x, y, age, seed):
    """Trois etincelles ambre a l'apparition et a la disparition."""
    rng = np.random.default_rng(seed)
    if age < 0 or age > 1:
        return
    for _ in range(3):
        ang = rng.uniform(0, 2 * math.pi)
        d = rng.uniform(6, 12)
        stamp_star(cv, (x + d * math.cos(ang)) * SS, (y + d * math.sin(ang)) * SS,
                   rng.uniform(2.2, 3.4) * SS, EYE, 0.9 * math.sin(math.pi * age), rng.uniform(0, 1))


def render(f):
    t = f / NF
    cv = Canvas()
    fx = Canvas()
    for i, b in enumerate(BATS):
        # Nuages aux deux bouts de la fenetre de visibilite.
        for k, moment in enumerate((b['debut'], b['debut'] + b['duree'])):
            age = ((t - moment + 0.5) % 1.0 - 0.5) / 0.12 + 0.25
            if 0 <= age <= 1:
                px, py = position(b, moment % 1.0)
                puff(fx, px, py, age, seed=100 * i + k)
        got = draw_bat(b, t, f)
        if got is None:
            continue
        pm, alpha, _, eyes, env, scale = got
        cv.p[..., :3] = pm + cv.p[..., :3] * (1 - alpha[..., None])
        cv.p[..., 3] = alpha + cv.p[..., 3] * (1 - alpha)
        for ex, ey in eyes:
            stamp_dot(cv, ex, ey, 0.42 * SS * scale, EYE, 0.95 * env)
    bats = downsample(cv.p)
    halo_a = np.clip(blur_fast(bats[..., 3], 2.4) * 0.30, 0, 0.3)
    halo = np.zeros_like(bats)
    halo[..., :3] = GLOW * halo_a[..., None]
    halo[..., 3] = halo_a
    out = over_small(bats, halo)
    out = over_small(downsample(fx.p), out)
    return to_image(out)


if __name__ == '__main__':
    dossier = Path(sys.argv[1]) if len(sys.argv) > 1 else Path('.')
    dossier.mkdir(parents=True, exist_ok=True)
    frames = []
    for f in range(NF):
        frames.append(render(f))
        print('image', f, flush=True)
    save_apng(frames, dossier / 'chauves-souris.png', DUR)
    frames[8].save(dossier / 'chauves-souris-poster.webp', 'WEBP', quality=92, method=6)
