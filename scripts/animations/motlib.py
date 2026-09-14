# Générateurs des animations de portrait redessinées le 14/09/2026
# (serpent-emeraude, carpes-celestes). Lancer depuis ce dossier :
#   python serpent.py   /   python carpes.py
# Les APNG et posters sont écrits dans le dossier courant ; les copier ensuite
# dans public/assets/animations/lab/. Rendu en 4x puis réduit (LANCZOS).
"""Outils communs : canevas 4x en alpha premultiplie, tubes le long d'une colonne,
particules, bruit, reduction LANCZOS et ecriture APNG."""
import numpy as np
from PIL import Image

W = 224
SS = 4
WS = W * SS


def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def _hash(ix, iy, seed):
    h = (ix.astype(np.int64) * 374761393 + iy.astype(np.int64) * 668265263 + seed * 1442695041) & 0xFFFFFFFF
    h = ((h ^ (h >> 13)) * 1274126177) & 0xFFFFFFFF
    return ((h ^ (h >> 16)) & 0xFFFF) / 65535.0


def vnoise(x, y, seed=0):
    x = np.asarray(x, dtype=np.float64)
    y = np.asarray(y, dtype=np.float64)
    ix = np.floor(x); iy = np.floor(y)
    fx = x - ix; fy = y - iy
    fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy)
    a = _hash(ix, iy, seed); b = _hash(ix + 1, iy, seed)
    c = _hash(ix, iy + 1, seed); d = _hash(ix + 1, iy + 1, seed)
    return (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy


def fbm(x, y, seed=0):
    return 0.65 * vnoise(x, y, seed) + 0.35 * vnoise(x * 2.1 + 5.3, y * 2.1 + 1.7, seed + 11)


class Canvas:
    """RGBA premultiplie, float32, en resolution 4x."""

    def __init__(self, size=WS):
        self.size = size
        self.p = np.zeros((size, size, 4), np.float32)

    def over(self, x0, y0, rgb, a):
        """rgb (h,w,3) couleur droite 0..1, a (h,w) 0..1, coin haut-gauche (x0,y0)."""
        h, w = a.shape
        X0 = max(x0, 0); Y0 = max(y0, 0)
        X1 = min(x0 + w, self.size); Y1 = min(y0 + h, self.size)
        if X1 <= X0 or Y1 <= Y0:
            return
        a = a[Y0 - y0:Y1 - y0, X0 - x0:X1 - x0]
        rgb = rgb[Y0 - y0:Y1 - y0, X0 - x0:X1 - x0] if rgb.ndim == 3 else rgb
        dst = self.p[Y0:Y1, X0:X1]
        inv = (1.0 - a)[..., None]
        dst[..., :3] = rgb * a[..., None] + dst[..., :3] * inv
        dst[..., 3] = a + dst[..., 3] * (1.0 - a)

    def add(self, x0, y0, rgb, a):
        """Lumiere additive (ecran) : garde l'alpha borne a 1."""
        h, w = a.shape
        X0 = max(x0, 0); Y0 = max(y0, 0)
        X1 = min(x0 + w, self.size); Y1 = min(y0 + h, self.size)
        if X1 <= X0 or Y1 <= Y0:
            return
        a = a[Y0 - y0:Y1 - y0, X0 - x0:X1 - x0]
        dst = self.p[Y0:Y1, X0:X1]
        col = np.asarray(rgb, np.float32)
        dst[..., :3] = np.minimum(dst[..., :3] + col * a[..., None], 1.0)
        dst[..., 3] = np.maximum(np.minimum(dst[..., 3] + a * (1.0 - dst[..., 3]), 1.0),
                                 dst[..., :3].max(axis=-1))


def downsample(p, size=W):
    out = np.zeros((size, size, 4), np.float32)
    for c in range(4):
        im = Image.fromarray(np.ascontiguousarray(p[..., c]), 'F')
        out[..., c] = np.asarray(im.resize((size, size), Image.LANCZOS))
    out = np.clip(out, 0, 1)
    out[..., :3] = np.minimum(out[..., :3], out[..., 3:4])
    return out


def blur(p, sigma):
    r = int(sigma * 3) + 1
    x = np.arange(-r, r + 1)
    k = np.exp(-x * x / (2 * sigma * sigma)); k /= k.sum()
    out = p.copy()
    for axis in (0, 1):
        out = np.apply_along_axis(lambda v: np.convolve(v, k, mode='same'), axis, out)
    return out


def blur_fast(a, sigma):
    """flou gaussien separable sur tableau 2D ou 3D (canaux en dernier)."""
    r = int(sigma * 3) + 1
    x = np.arange(-r, r + 1)
    k = (np.exp(-x * x / (2 * sigma * sigma))).astype(np.float32); k /= k.sum()
    pad = [(r, r), (r, r)] + ([(0, 0)] if a.ndim == 3 else [])
    b = np.pad(a, pad)
    tmp = np.zeros_like(b)
    for i, kv in enumerate(k):
        tmp[:, r:-r] += kv * b[:, i:i + b.shape[1] - 2 * r]
    out = np.zeros_like(b)
    for i, kv in enumerate(k):
        out[r:-r] += kv * tmp[i:i + b.shape[0] - 2 * r]
    return out[r:-r, r:-r]


def over_small(top, bottom):
    """compose deux tableaux premultiplies (h,w,4)."""
    return top + bottom * (1.0 - top[..., 3:4])


def to_image(pm):
    a = pm[..., 3]
    rgb = np.zeros_like(pm[..., :3])
    m = a > 1e-5
    rgb[m] = pm[..., :3][m] / a[m][:, None]
    out = np.zeros(pm.shape, np.uint8)
    out[..., :3] = np.clip(rgb * 255 + 0.5, 0, 255)
    a8 = np.clip(a * 255 + 0.5, 0, 255).astype(np.uint8)
    out[..., 3] = a8
    out[a8 == 0, :3] = 0
    return Image.fromarray(out, 'RGBA')


def tube_fields(pts, rad, pad=3):
    """pts (N,2), rad (N,) en pixels 4x. Renvoie la boite et, par pixel :
    sdf, coordonnee laterale (px), longitudinale (px), rayon local, normale (nx, ny)."""
    tang = np.gradient(pts, axis=0)
    tang /= np.maximum(np.linalg.norm(tang, axis=1, keepdims=True), 1e-9)
    nrm = np.stack([-tang[:, 1], tang[:, 0]], 1)
    seg = np.linalg.norm(np.diff(pts, axis=0), axis=1)
    arc = np.concatenate([[0], np.cumsum(seg)])
    rmax = rad.max()
    x0 = int(np.floor((pts[:, 0] - rad).min())) - pad
    y0 = int(np.floor((pts[:, 1] - rad).min())) - pad
    x1 = int(np.ceil((pts[:, 0] + rad).max())) + pad
    y1 = int(np.ceil((pts[:, 1] + rad).max())) + pad
    h, w = y1 - y0, x1 - x0
    sdf = np.full((h, w), 1e9, np.float32)
    lat = np.zeros((h, w), np.float32)
    lon = np.zeros((h, w), np.float32)
    rl = np.ones((h, w), np.float32)
    nx = np.zeros((h, w), np.float32)
    ny = np.zeros((h, w), np.float32)
    for i in range(len(pts)):
        r = rad[i]
        if r < 0.05:
            continue
        cx, cy = pts[i]
        bx0 = int(cx - r - pad) - x0; bx1 = int(cx + r + pad) + 2 - x0
        by0 = int(cy - r - pad) - y0; by1 = int(cy + r + pad) + 2 - y0
        bx0 = max(bx0, 0); by0 = max(by0, 0); bx1 = min(bx1, w); by1 = min(by1, h)
        xs = np.arange(bx0, bx1, dtype=np.float32) + x0 + 0.5 - cx
        ys = np.arange(by0, by1, dtype=np.float32) + y0 + 0.5 - cy
        dx = xs[None, :]; dy = ys[:, None]
        dist = np.sqrt(dx * dx + dy * dy)
        val = dist - r
        sub = sdf[by0:by1, bx0:bx1]
        m = val < sub
        if not m.any():
            continue
        sub[m] = val[m]
        tx, ty = tang[i]; n0, n1 = nrm[i]
        lat[by0:by1, bx0:bx1][m] = (dx * n0 + dy * n1)[m]
        lon[by0:by1, bx0:bx1][m] = (arc[i] + dx * tx + dy * ty)[m]
        rl[by0:by1, bx0:bx1][m] = r
        nx[by0:by1, bx0:bx1][m] = n0
        ny[by0:by1, bx0:bx1][m] = n1
    return dict(x0=x0, y0=y0, sdf=sdf, lat=lat, lon=lon, r=rl, nx=nx, ny=ny,
                arc=arc, tang=tang, nrm=nrm)


def resample(pts, n, length=None):
    seg = np.linalg.norm(np.diff(pts, axis=0), axis=1)
    arc = np.concatenate([[0], np.cumsum(seg)])
    L = arc[-1] if length is None else min(length, arc[-1])
    t = np.linspace(0, L, n)
    return np.stack([np.interp(t, arc, pts[:, 0]), np.interp(t, arc, pts[:, 1])], 1)


def stamp_dot(cv, x, y, sigma, rgb, alpha, additive=False):
    """x, y, sigma en pixels 4x."""
    if alpha <= 0.002:
        return
    r = int(sigma * 3) + 2
    ix, iy = int(x), int(y)
    xs = np.arange(ix - r, ix + r + 1, dtype=np.float32) + 0.5 - x
    ys = np.arange(iy - r, iy + r + 1, dtype=np.float32) + 0.5 - y
    d2 = xs[None, :] ** 2 + ys[:, None] ** 2
    a = (np.exp(-d2 / (2 * sigma * sigma)) * alpha).astype(np.float32)
    col = np.broadcast_to(np.asarray(rgb, np.float32), a.shape + (3,))
    if additive:
        cv.add(ix - r, iy - r, rgb, a)
    else:
        cv.over(ix - r, iy - r, col, a)


def stamp_star(cv, x, y, size, rgb, alpha, angle=0.0):
    """petite etincelle : coeur + deux branches fines (pixels 4x)."""
    if alpha <= 0.002:
        return
    r = int(size * 1.6) + 2
    ix, iy = int(x), int(y)
    xs = np.arange(ix - r, ix + r + 1, dtype=np.float32) + 0.5 - x
    ys = np.arange(iy - r, iy + r + 1, dtype=np.float32) + 0.5 - y
    X = xs[None, :]; Y = ys[:, None]
    c, s = np.cos(angle), np.sin(angle)
    u = X * c + Y * s; v = -X * s + Y * c
    wl = size * 0.55; ww = max(size * 0.07, 0.9)
    br = np.exp(-(u * u) / (2 * wl * wl) - (v * v) / (2 * ww * ww)) + np.exp(-(v * v) / (2 * wl * wl) - (u * u) / (2 * ww * ww))
    core = np.exp(-(X * X + Y * Y) / (2 * (size * 0.18) ** 2))
    a = np.clip(0.75 * br + core, 0, 1) * alpha
    cv.add(ix - r, iy - r, rgb, a.astype(np.float32))


def stamp_ring(cv, x, y, radius, width, rgb, alpha):
    if alpha <= 0.002:
        return
    r = int(radius + width * 3) + 2
    ix, iy = int(x), int(y)
    xs = np.arange(ix - r, ix + r + 1, dtype=np.float32) + 0.5 - x
    ys = np.arange(iy - r, iy + r + 1, dtype=np.float32) + 0.5 - y
    d = np.sqrt(xs[None, :] ** 2 + ys[:, None] ** 2)
    a = np.exp(-((d - radius) ** 2) / (2 * width * width)) * alpha
    col = np.broadcast_to(np.asarray(rgb, np.float32), a.shape + (3,))
    cv.over(ix - r, iy - r, col, a.astype(np.float32))


def posterize(im, q=4, thr=4):
    a = np.asarray(im).astype(np.int32)
    a[..., :3] = (a[..., :3] // q) * q + q // 2
    a[..., 3] = np.where(a[..., 3] < thr, 0, (a[..., 3] + 2) // 4 * 4)
    a = np.clip(a, 0, 255)
    a[a[..., 3] == 0, :3] = 0
    return Image.fromarray(a.astype(np.uint8), 'RGBA')


def save_apng(frames, path, duration, q=4):
    frames = [posterize(f, q) for f in frames]
    frames[0].save(path, format='PNG', save_all=True, append_images=frames[1:],
                   duration=duration, loop=0, disposal=0, blend=0, optimize=True)
