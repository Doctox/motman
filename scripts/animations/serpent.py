"""Serpent d'emeraude : une lumiere verte s'incarne, ondule autour du portrait puis s'efface."""
import math
import sys
import numpy as np
from motlib import *

NF = 52
DUR = 115
C = W / 2
L = 225.0                     # longueur du corps (px 224)
NS = 300                      # echantillons de colonne
OMEGA = 2 * math.pi * 1.12 / NF
PHI0 = 1.5708 - OMEGA * 27 - 0.35   # la tete passe sous le portrait vers l'image 29
WAVE_K = 2.25                 # ondes le long du corps
WAVE_W = 2 * math.pi / 11.0   # une ondulation toutes les 12 images

# fenetres temporelles
REV0, REV1 = 6.0, 17.0        # materialisation
DIS0, DIS1 = 34.0, 46.0       # dissolution

A_CTRL = [0, 1.5, 4, 7, 10, 13, 16, 20, 40, 80, 150, 200, 225]
R_CTRL = [2.2, 4.0, 6.0, 7.0, 6.9, 5.6, 4.5, 4.6, 5.6, 5.8, 4.2, 2.2, 0.35]


def wrap(a):
    return (a + math.pi) % (2 * math.pi) - math.pi


def head_angle(f):
    # vitesse legerement pulsee au rythme de l'ondulation : poussee organique
    return PHI0 + OMEGA * f + 0.05 * math.sin(WAVE_W * f)


def spine(f):
    ph = head_angle(f)
    back = np.linspace(-0.08, 4.6, 1400)
    phis = ph - back
    u = np.clip(back * 80.0 / L, 0, 1.3)
    dip = 24.0 * np.exp(-(np.vectorize(wrap)(phis - math.pi / 2) / 0.6) ** 2)
    rb = 83.0 - dip + 3.0 * np.sin(2 * phis + 0.7)
    amp = 1.5 + 9.0 * smoothstep(0.0, 0.35, u) - 1.5 * smoothstep(0.7, 1.1, u)
    rr = rb + amp * np.sin(2 * math.pi * WAVE_K * u - WAVE_W * f + 0.4)
    pts = np.stack([C + rr * np.cos(phis), C + rr * np.sin(phis)], 1)
    # le debut (back<0) sert a orienter le museau ; on coupe au museau
    seg = np.linalg.norm(np.diff(pts, axis=0), axis=1)
    arc = np.concatenate([[0], np.cumsum(seg)])
    a0 = np.interp(0.0, back, arc)
    t = np.linspace(a0, a0 + L, NS)
    return np.stack([np.interp(t, arc, pts[:, 0]), np.interp(t, arc, pts[:, 1])], 1)


def body_point(f, u, latn):
    sp = spine(f)
    i = min(int(u * (NS - 1)), NS - 2)
    fr = u * (NS - 1) - i
    p = sp[i] * (1 - fr) + sp[i + 1] * fr
    t = sp[i + 1] - sp[i]; t /= np.linalg.norm(t) + 1e-9
    n = np.array([-t[1], t[0]])
    r = np.interp(u * L, A_CTRL, R_CTRL)
    return p + n * latn * r, t, n


def thr_reveal(u, n):
    return 0.55 * u + 0.45 * n


def thr_dissolve(u, n):
    return 0.55 * (1 - u) + 0.45 * n


def prog(f, f0, f1):
    return (f - f0) / (f1 - f0) * 1.3 - 0.15


def frame_of(thr, f0, f1):
    return f0 + (thr + 0.15) / 1.3 * (f1 - f0)


LIGHT = np.array([-0.45, -0.65, 0.62]); LIGHT /= np.linalg.norm(LIGHT)
HALF = LIGHT + np.array([0, 0, 1.0]); HALF /= np.linalg.norm(HALF)
DEEP = np.array([4, 78, 58]) / 255
MID = np.array([30, 196, 132]) / 255
JADE = np.array([150, 246, 200]) / 255
HL = np.array([236, 255, 245]) / 255
GOLD = np.array([255, 214, 120]) / 255
EDGEGLOW = np.array([210, 255, 225]) / 255


def render_body(cv, f):
    sp = spine(f) * SS
    a_s = np.linspace(0, L, NS)
    rad = np.interp(a_s, A_CTRL, R_CTRL) * SS
    tf = tube_fields(sp, rad)
    sdf = tf['sdf']
    cov = np.clip(0.5 - sdf / 1.6, 0, 1)
    if cov.max() <= 0:
        return
    lon = tf['lon'] / SS; lat = tf['lat'] / SS
    u = np.clip(lon / L, 0, 1)
    dn = np.clip(tf['lat'] / tf['r'], -1, 1)
    nz = np.sqrt(1 - dn * dn)
    N = np.stack([tf['nx'] * dn, tf['ny'] * dn, nz], -1)
    diff = np.clip(N @ LIGHT, 0, 1)
    spec = np.clip(N @ HALF, 0, 1) ** 22

    col = DEEP + (MID - DEEP) * smoothstep(0.0, 0.75, diff)[..., None]
    col = col + (JADE - col) * (smoothstep(0.55, 1.0, diff) * 0.75)[..., None]
    # ecailles : treillis en losanges qui suit le corps
    sc = 3.1
    q1 = np.mod((lon + lat * 1.1) / sc, 1.0); q2 = np.mod((lon - lat * 1.1) / sc, 1.0)
    edge = np.minimum(np.minimum(q1, 1 - q1), np.minimum(q2, 1 - q2))
    lines = 1 - smoothstep(0.03, 0.2, edge)
    col = col * (1 - 0.34 * lines * nz * smoothstep(0.03, 0.12, u))[..., None]
    # ligne dorsale de petites taches dorees
    ph = np.mod(lon, 9.0) - 4.5
    spot = np.exp(-(ph / 1.3) ** 2 - (lat / 1.05) ** 2) * smoothstep(0.08, 0.14, u) * (1 - smoothstep(0.8, 0.95, u))
    col = col + (GOLD - col) * (0.55 * spot)[..., None]
    col = col + (HL - col) * (0.9 * spec)[..., None]

    alpha = cov * (0.9 + 0.1 * nz) * (1 - 0.45 * smoothstep(0.72, 1.0, u))

    # materialisation / dissolution a bruit attache au corps
    nz1 = fbm(lon / 5.0, lat / 2.2 + 3.0, 3)
    nz2 = fbm(lon / 4.0 + 17, lat / 2.0, 9)
    tr = thr_reveal(u, nz1); td = thr_dissolve(u, nz2)
    pr = prog(f, REV0, REV1); pd = prog(f, DIS0, DIS1)
    vis = smoothstep(tr - 0.07, tr + 0.05, pr) * (1 - smoothstep(td - 0.05, td + 0.07, pd))
    glow = np.exp(-((pr - tr) / 0.08) ** 2) + np.exp(-((pd - td) / 0.08) ** 2)
    glow = np.clip(glow, 0, 1)
    col = col + (EDGEGLOW - col) * (0.8 * glow)[..., None]
    # frange lumineuse un peu plus large que le corps visible
    alpha = alpha * np.clip(vis + 0.6 * glow * smoothstep(0.0, 0.3, vis + glow * 0.5), 0, 1)
    cv.over(tf['x0'], tf['y0'], col.astype(np.float32), alpha.astype(np.float32))

    # yeux dores, visibles avec la tete
    head_u = 0.03
    hv = smoothstep(thr_reveal(head_u, 0.5) - 0.07, thr_reveal(head_u, 0.5) + 0.05, pr) * \
        (1 - smoothstep(thr_dissolve(head_u, 0.5) - 0.05, thr_dissolve(head_u, 0.5) + 0.07, pd))
    if hv > 0.01:
        for side in (-1, 1):
            p, t, n = body_point(f, 7.5 / L, 0.52 * side)
            p = p * SS
            stamp_dot(cv, p[0], p[1], 1.7 * SS * 0.55, (1.0, 0.84, 0.36), 1.0 * hv)
            stamp_dot(cv, p[0] - t[0] * 1.0, p[1] - t[1] * 1.0, 0.75 * SS * 0.5, (0.1, 0.07, 0.02), 0.95 * hv)
            stamp_dot(cv, p[0] - 1.6 - t[0], p[1] - 2.0, 0.28 * SS * 0.5, (1, 1, 0.9), 0.9 * hv)
        # langue fourchue qui sort brievement
        cyc = (f % 13) / 13.0
        if 0.35 < cyc < 0.62 and hv > 0.5:
            ext = math.sin((cyc - 0.35) / 0.27 * math.pi)
            p0, t, n = body_point(f, 0.0, 0.0)
            tip = p0 - t * 5.5 * ext
            for k in range(14):
                q = p0 + (tip - p0) * (k / 13)
                stamp_dot(cv, q[0] * SS, q[1] * SS, 0.9, (1.0, 0.45, 0.42), 0.9 * hv)
            for side in (-1, 1):
                end = tip - t * 1.8 * ext + n * side * 1.3 * ext
                for k in range(8):
                    q = tip + (end - tip) * (k / 7)
                    stamp_dot(cv, q[0] * SS, q[1] * SS, 0.75, (1.0, 0.45, 0.42), 0.85 * hv)


def make_particles(rng):
    parts = []
    # 1) rassemblement : points qui convergent vers leur place sur le corps
    for _ in range(150):
        u = rng.uniform(0, 1) ** 0.9
        latn = rng.uniform(-0.9, 0.9)
        nzv = float(fbm(u * L / 5.0, latn * 4 / 2.2 + 3.0, 3))
        fa = frame_of(thr_reveal(u, nzv), REV0, REV1) + rng.uniform(-0.5, 0.5)
        target, _, _ = body_point(fa, u, latn)
        dur = rng.uniform(7, 11)
        ang = rng.uniform(0, 2 * math.pi)
        dist = rng.uniform(14, 36)
        off = np.array([math.cos(ang), math.sin(ang)]) * dist
        swirl = rng.uniform(0.8, 1.6) * rng.choice([-1, 1])
        gold = rng.random() < 0.3
        parts.append(dict(kind='in', fa=fa, dur=dur, target=target, off=off, swirl=swirl,
                          gold=gold, size=rng.uniform(0.7, 1.25), tw=rng.uniform(0, 6.28)))
    # 2) dissolution : paillettes emeraude et or
    for _ in range(190):
        u = rng.uniform(0, 1)
        latn = rng.uniform(-1, 1)
        nzv = float(fbm(u * L / 4.0 + 17, latn * 4 / 2.0, 9))
        fe = frame_of(thr_dissolve(u, nzv), DIS0, DIS1) + rng.uniform(-0.4, 0.4)
        if fe > NF - 3:
            fe = NF - 3 - rng.uniform(0, 2)
        pos, t, n = body_point(fe, u, latn)
        life = min(rng.uniform(5, 11), NF - 1.2 - fe)
        ang = rng.uniform(0, 2 * math.pi)
        rp = pos - C; rp /= np.linalg.norm(rp) + 1e-9
        vel = np.array([math.cos(ang), math.sin(ang)]) * rng.uniform(0.3, 1.5) + rp * rng.uniform(0.2, 0.9) - t * rng.uniform(1.0, 3.0)
        gold = rng.random() < 0.42
        parts.append(dict(kind='out', fe=fe, life=life, pos=pos, vel=vel, gold=gold,
                          size=rng.uniform(0.6, 1.3), star=gold and rng.random() < 0.35, tw=rng.uniform(0, 6.28)))
    # 3) scintillement de sillage pendant la nage
    for f0 in np.arange(REV1 - 2, DIS0 + 2, 0.55):
        u = rng.uniform(0.55, 0.98)
        latn = rng.choice([-1, 1]) * rng.uniform(0.8, 1.4)
        pos, t, n = body_point(f0, u, latn)
        life = rng.uniform(4, 8)
        vel = n * latn * rng.uniform(0.2, 0.6) + rng.normal(0, 0.25, 2)
        parts.append(dict(kind='out', fe=f0, life=life, pos=pos, vel=vel, gold=rng.random() < 0.5,
                          size=rng.uniform(0.45, 0.8), star=False, tw=rng.uniform(0, 6.28)))
    return parts


GREEN_P = (0.55, 1.0, 0.78)
GOLD_P = (1.0, 0.86, 0.5)


def render_particles(cv, parts, f):
    for p in parts:
        col = GOLD_P if p['gold'] else GREEN_P
        if p['kind'] == 'in':
            s = (f - (p['fa'] - p['dur'])) / p['dur']
            if s < 0 or f > p['fa'] + 2.0:
                continue
            if s <= 1:
                e = s * s * (3 - 2 * s)
                ang = p['swirl'] * (1 - e)
                c, sn = math.cos(ang), math.sin(ang)
                off = np.array([c * p['off'][0] - sn * p['off'][1], sn * p['off'][0] + c * p['off'][1]]) * (1 - e)
                pos = p['target'] + off
                dc = np.linalg.norm(pos - C)
                if dc > 100:
                    pos = C + (pos - C) * (100 / dc)
                a = smoothstep(0.0, 0.35, s) * (0.55 + 0.45 * s)
            else:
                pos = p['target']
                a = max(0.0, 1 - (f - p['fa']) / 2.0)
            tw = 0.75 + 0.25 * math.sin(p['tw'] + f * 1.9)
            stamp_dot(cv, pos[0] * SS, pos[1] * SS, p['size'] * SS * 0.65, col, float(min(1, a * tw * 1.3)), additive=True)
        else:
            s = (f - p['fe']) / p['life']
            if s < 0 or s > 1:
                continue
            k = 1 - math.exp(-(f - p['fe']) * 0.35)
            pos = p['pos'] + p['vel'] * (k / 0.35)
            a = (1 - s) ** 1.3 * min(1.0, (f - p['fe']) * 2 + 0.4)
            tw = 0.6 + 0.4 * math.sin(p['tw'] + f * 2.3)
            sz = p['size'] * (1 - 0.4 * s)
            if p.get('star'):
                stamp_star(cv, pos[0] * SS, pos[1] * SS, sz * SS * 1.5, col, float(a * tw), angle=0.3)
            else:
                stamp_dot(cv, pos[0] * SS, pos[1] * SS, sz * SS * 0.5, col, float(a * tw), additive=True)


def render(f, parts):
    body = Canvas()
    render_body(body, f)
    b = downsample(body.p)
    ab = b[..., 3]
    g1 = blur_fast(ab, 3.0); g2 = blur_fast(ab, 8.0)
    ga = np.clip(0.45 * g1 + 0.28 * g2, 0, 0.8)
    glow = np.zeros_like(b)
    gcol = np.array([60, 220, 160], np.float32) / 255
    glow[..., :3] = gcol * ga[..., None]
    glow[..., 3] = ga
    out = over_small(b, glow)
    pc = Canvas()
    render_particles(pc, parts, f)
    pp = downsample(pc.p)
    # halo doux autour des particules
    pa = blur_fast(pp[..., 3], 2.2) * 0.35
    ph = np.zeros_like(pp)
    ph[..., :3] = np.array([120, 240, 180], np.float32) / 255 * pa[..., None]
    ph[..., 3] = pa
    out = over_small(pp, over_small(ph, out))
    return to_image(out)


if __name__ == '__main__':
    rng = np.random.default_rng(11)
    parts = make_particles(rng)
    only = [int(x) for x in sys.argv[1:]]
    frames = []
    for f in (only or range(NF)):
        frames.append(render(float(f), parts))
        print('image', f, flush=True)
    if only:
        for f, im in zip(only, frames):
            im.save(f'dbg_serpent_{f}.png')
    else:
        save_apng(frames, 'serpent-emeraude.png', DUR)
        frames[26].save('serpent-emeraude-poster.webp', 'WEBP', quality=92, method=6)
