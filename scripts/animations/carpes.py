"""Carpes celestes : deux koi lumineuses nagent de concert autour du portrait."""
import math
import sys
import numpy as np
from motlib import *

NF = 54
DUR = 110
C = W / 2
TURNS = 1.6
OMEGA = 2 * math.pi * TURNS / NF
BEAT = 2 * math.pi / 9.0          # battement de queue : 9 images
PHI0 = -2.1
LB = 42.0                         # corps (museau -> pedoncule)
LT = 66.0                         # jusqu'au bout de la nageoire caudale
NS = 190

REV0, REV1 = 5.0, 15.0
DIS0, DIS1 = 37.0, 48.0

BODY_A = [0, 1.5, 4, 8, 13, 19, 26, 33, 38, 42]
BODY_W = [2.6, 4.4, 6.0, 7.1, 7.5, 7.1, 5.8, 3.8, 2.4, 1.7]
FIN_A = [36, 40, 46, 52, 58, 66]
FIN_W = [1.6, 3.2, 5.8, 7.8, 8.8, 8.2]

SPOTS = [
    # (a, lateral px, rayon long, rayon lat, couleur)
    [(6.0, 0.5, 4.6, 4.2, 'red'), (13.5, -2.5, 4.0, 3.4, 'red'), (19, 2.0, 7.5, 5.0, 'red'), (27.5, -1.8, 5.5, 4.0, 'org'), (33, 1.5, 3.0, 2.4, 'red')],
    [(3.8, 0.0, 2.8, 3.2, 'org'), (11, -2.2, 6.5, 4.8, 'org'), (17, 3.0, 5.0, 3.6, 'red'), (25, -0.5, 6.0, 5.2, 'red'), (32, 2.2, 2.8, 2.4, 'org')],
]
RED = np.array([244, 92, 64]) / 255
ORG = np.array([255, 150, 62]) / 255
NACRE = np.array([255, 251, 245]) / 255
SHADE = np.array([232, 206, 200]) / 255
TINT_A = np.array([205, 225, 255]) / 255
TINT_B = np.array([255, 210, 225]) / 255
HL = np.array([255, 255, 255]) / 255
FINCOL = np.array([255, 242, 230]) / 255
RIM = np.array([232, 150, 118]) / 255
WARMFIN = np.array([255, 196, 160]) / 255
EDGEGLOW = np.array([255, 244, 214]) / 255

LIGHT = np.array([-0.45, -0.65, 0.62]); LIGHT /= np.linalg.norm(LIGHT)
HALF = LIGHT + np.array([0, 0, 1.0]); HALF /= np.linalg.norm(HALF)


def head_angle(k, f):
    # nage par poussees : un peu plus vite a chaque coup de queue
    return PHI0 + k * math.pi + OMEGA * f + 0.22 * OMEGA / BEAT * math.sin(BEAT * f + k * 1.3)


def spine(k, f):
    ph = head_angle(k, f)
    back = np.linspace(-0.05, 1.3, 900)
    phis = ph - back
    sgn = 1 if k == 0 else -1
    rb = 79.0 + sgn * 7.0 * np.sin(2 * phis + 0.4)
    a = back * 79.0
    u = a / LB
    amp = 0.35 + 3.0 * np.clip(u, 0, 1.6) ** 2
    amp = np.minimum(amp, 6.8)
    lat = amp * np.sin(2 * math.pi * 0.8 * u - BEAT * f - k * 1.3)
    rr = rb + lat * (1 if True else -1)
    pts = np.stack([C + rr * np.cos(phis), C + rr * np.sin(phis)], 1)
    seg = np.linalg.norm(np.diff(pts, axis=0), axis=1)
    arc = np.concatenate([[0], np.cumsum(seg)])
    a0 = np.interp(0.0, back, arc)
    t = np.linspace(a0, a0 + LT, NS)
    return np.stack([np.interp(t, arc, pts[:, 0]), np.interp(t, arc, pts[:, 1])], 1)


def point_at(sp, a):
    x = a / LT * (NS - 1)
    i = int(min(max(x, 0), NS - 2)); fr = x - i
    p = sp[i] * (1 - fr) + sp[i + 1] * fr
    t = sp[min(i + 1, NS - 1)] - sp[max(i - 1, 0)]; t /= np.linalg.norm(t) + 1e-9
    return p, t, np.array([-t[1], t[0]])


def thr_reveal(u, n):
    return 0.5 * u + 0.5 * n


def thr_dissolve(u, n):
    return 0.5 * (1 - u) + 0.5 * n


def prog(f, f0, f1):
    return (f - f0) / (f1 - f0) * 1.3 - 0.15


def frame_of(thr, f0, f1):
    return f0 + (thr + 0.15) / 1.3 * (f1 - f0)


def vis_field(f, u, n1, n2):
    pr = prog(f, REV0, REV1); pd = prog(f, DIS0, DIS1)
    tr = thr_reveal(u, n1); td = thr_dissolve(u, n2)
    vis = smoothstep(tr - 0.07, tr + 0.05, pr) * (1 - smoothstep(td - 0.05, td + 0.07, pd))
    glow = np.clip(np.exp(-((pr - tr) / 0.08) ** 2) + np.exp(-((pd - td) / 0.08) ** 2), 0, 1)
    return vis, glow


def shade_normal(tf):
    dn = np.clip(tf['lat'] / tf['r'], -1, 1)
    nz = np.sqrt(1 - dn * dn)
    N = np.stack([tf['nx'] * dn, tf['ny'] * dn, nz], -1)
    return dn, nz, np.clip(N @ LIGHT, 0, 1), np.clip(N @ HALF, 0, 1)


def draw_fin_tube(cv, pts, wid, f, k, base_alpha, seed, lon_off=0.0, u_for_vis=None, fork=False):
    tf = tube_fields(pts * SS, wid * SS)
    cov = np.clip(0.5 - tf['sdf'] / 1.6, 0, 1)
    lon = tf['lon'] / SS + lon_off; lat = tf['lat'] / SS
    dn = np.clip(tf['lat'] / tf['r'], -1, 1)
    along = (tf['lon'] / SS) / max(tf['arc'][-1] / SS, 1e-3)
    # rayons fins le long de la nageoire
    rays = 0.8 + 0.2 * np.cos(dn * math.pi * 5.5 + along * 1.5) ** 2
    alpha = cov * base_alpha * rays * (1 - 0.5 * smoothstep(0.15, 1.0, along))
    # liseré lumineux au bord
    rim = smoothstep(0.55, 0.95, np.abs(dn)) + smoothstep(0.75, 1.0, along)
    alpha = np.clip(alpha + cov * 0.35 * np.clip(rim, 0, 1) * base_alpha, 0, 1)
    if fork:
        cut = 60.0 + 11.0 * np.abs(dn) ** 1.6 + 1.3 * np.sin(dn * 8.0 - BEAT * f)
        edge = smoothstep(0.0, 1.6, cut - lon)
        alpha = alpha * edge
    col = WARMFIN + (FINCOL - WARMFIN) * smoothstep(0.0, 0.5, along)[..., None]
    col = col + (TINT_B - col) * (0.45 * smoothstep(0.4, 1.0, along))[..., None]
    col = col + (TINT_A - col) * (0.35 * smoothstep(0.2, 1.0, dn))[..., None]
    col = col + (RIM - col) * (0.6 * np.clip(rim, 0, 1))[..., None]
    uu = np.clip(lon / LT, 0, 1)
    n1 = fbm(lon / 4.0, lat / 2.5, seed); n2 = fbm(lon / 4.0 + 9, lat / 2.5, seed + 5)
    vis, glow = vis_field(f, uu if u_for_vis is None else np.full_like(lon, u_for_vis), n1, n2)
    col = col + (EDGEGLOW - col) * (0.7 * glow)[..., None]
    alpha = alpha * np.clip(vis + 0.5 * glow * smoothstep(0, 0.3, vis + glow * 0.5), 0, 1)
    cv.over(tf['x0'], tf['y0'], col.astype(np.float32), alpha.astype(np.float32))


def side_fin(sp, a_base, side, length, widths, open_ang, f, k):
    p, t, n = point_at(sp, a_base)
    wb = np.interp(a_base, BODY_A, BODY_W)
    base = p + n * side * wb * 0.7
    back = -t
    ang = -side * open_ang
    c, s = math.cos(ang), math.sin(ang)
    d = np.array([c * back[0] - s * back[1], s * back[0] + c * back[1]])
    # courbe douce : le bout traine vers l'arriere
    q = np.linspace(0, 1, 14)[:, None]
    ctrl = base + d * length * 0.55
    tip = base + d * length * 0.75 + back * length * 0.45
    pts = (1 - q) ** 2 * base + 2 * (1 - q) * q * ctrl + q ** 2 * tip
    wid = np.interp(q[:, 0], np.linspace(0, 1, len(widths)), widths)
    return pts, wid


def draw_fish(cv, k, f):
    sp = spine(k, f)
    seedk = 20 + k * 7
    # nageoires voilees sous le corps
    flap = math.sin(BEAT * f * 0.5 + k * 2.0)
    for side in (-1, 1):
        o = 1.05 + 0.35 * math.sin(BEAT * f * 0.55 + (0 if side > 0 else 1.6) + k)
        pts, wid = side_fin(sp, 11.0, side, 13.5, [1.6, 3.8, 5.0, 4.4, 1.8], o, f, k)
        draw_fin_tube(cv, pts, wid, f, k, 0.78, seedk + 1, u_for_vis=0.28)
        o2 = 0.7 + 0.25 * math.sin(BEAT * f * 0.55 + 1.2 + (0 if side > 0 else 1.9) + k)
        pts, wid = side_fin(sp, 26.0, side, 8.0, [1.0, 2.7, 2.6, 0.9], o2, f, k)
        draw_fin_tube(cv, pts, wid, f, k, 0.7, seedk + 2, u_for_vis=0.55)
    # caudale : prolongement de la colonne, voilee et fourchue
    ia = int(FIN_A[0] / LT * (NS - 1))
    fin_pts = sp[ia:]
    a_s = np.linspace(FIN_A[0], LT, len(fin_pts))
    wid = np.interp(a_s, FIN_A, FIN_W)
    draw_fin_tube(cv, fin_pts, wid, f, k, 0.85, seedk + 3, lon_off=FIN_A[0], fork=True)

    # corps
    ib = int(LB / LT * (NS - 1)) + 1
    bpts = sp[:ib]
    a_s = np.linspace(0, LB, ib)
    rad = np.interp(a_s, BODY_A, BODY_W)
    tf = tube_fields(bpts * SS, rad * SS)
    cov = np.clip(0.5 - tf['sdf'] / 1.6, 0, 1)
    lon = tf["lon"] / SS; lat = tf['lat'] / SS
    dn, nz, diff, hv = shade_normal(tf)
    spec = hv ** 18
    col = SHADE + (NACRE - SHADE) * smoothstep(0.05, 0.8, diff)[..., None]
    col = col + (TINT_A - col) * (0.30 * smoothstep(0.45, 1.0, dn))[..., None]
    col = col + (TINT_B - col) * (0.30 * smoothstep(0.45, 1.0, -dn))[..., None]
    col = col + (RIM - col) * (0.55 * smoothstep(0.72, 1.0, np.abs(dn)))[..., None]
    # taches
    for (ac, lc, rx, ry, cname) in SPOTS[k]:
        e = ((lon - ac) / rx) ** 2 + ((lat - lc) / ry) ** 2
        e = e + 1.3 * (fbm(lon / 2.0 + ac, lat / 2.0, seedk + 9) - 0.5)
        m = smoothstep(1.0, 0.55, e) * (1 - 0.5 * smoothstep(0.8, 1.0, np.abs(dn)))
        sc = (RED if cname == 'red' else ORG)
        sc = sc + (ORG - sc) * (0.35 * smoothstep(0.2, 1.0, e))[..., None]
        sc = sc * (0.72 + 0.28 * smoothstep(0.0, 0.9, diff))[..., None]
        col = col + (sc - col) * (0.92 * m)[..., None]
    # ecailles nacrees : croissants tres legers
    s1 = np.mod(lon / 2.6, 1.0); s2 = np.mod(lat / 2.6 + 0.5 * np.floor(lon / 2.6), 1.0)
    scale = np.exp(-(((s1 - 0.25) ** 2) + (s2 - 0.5) ** 2) / 0.05)
    col = col * (1 - 0.06 * scale * smoothstep(10, 14, lon) * nz)[..., None]
    col = col + (HL - col) * (0.9 * spec)[..., None]
    alpha = cov * 0.97
    n1 = fbm(lon / 4.0, lat / 2.5, seedk); n2 = fbm(lon / 4.0 + 9, lat / 2.5, seedk + 5)
    vis, glow = vis_field(f, np.clip(lon / LT, 0, 1), n1, n2)
    col = col + (EDGEGLOW - col) * (0.8 * glow)[..., None]
    alpha = alpha * np.clip(vis + 0.6 * glow * smoothstep(0, 0.3, vis + glow * 0.5), 0, 1)
    cv.over(tf['x0'], tf['y0'], col.astype(np.float32), alpha.astype(np.float32))

    # yeux
    hvis, _ = vis_field(f, np.array(0.05), np.array(0.5), np.array(0.5))
    hvis = float(hvis)
    if hvis > 0.02:
        for side in (-1, 1):
            p, t, n = point_at(sp, 4.2)
            e = (p + n * side * 3.6) * SS
            stamp_dot(cv, e[0], e[1], 1.35 * SS * 0.5, (0.18, 0.1, 0.1), 0.95 * hvis)
            stamp_dot(cv, e[0] - 1.2, e[1] - 1.4, 0.35 * SS * 0.5, (1, 1, 1), 0.9 * hvis)


# --------------------------------------------------------------- particules
PEARL = (1.0, 0.97, 0.9)
GOLD_P = (1.0, 0.85, 0.5)
CORAL_P = (1.0, 0.62, 0.48)


def make_particles(rng):
    parts = []
    for k in (0, 1):
        seedk = 20 + k * 7
        for _ in range(85):
            a = rng.uniform(0, LT * 0.95)
            u = a / LT
            n1 = float(fbm(a / 4.0, 0.0, seedk))
            fa = frame_of(thr_reveal(u, n1), REV0, REV1) + rng.uniform(-0.5, 0.5)
            p, t, n = point_at(spine(k, fa), a)
            wmax = np.interp(a, BODY_A + [66], BODY_W + [8])
            target = p + n * rng.uniform(-0.8, 0.8) * wmax
            ang = rng.uniform(0, 2 * math.pi); dist = rng.uniform(12, 32)
            parts.append(dict(kind='in', fa=fa, dur=rng.uniform(7, 10), target=target,
                              off=np.array([math.cos(ang), math.sin(ang)]) * dist,
                              swirl=rng.uniform(0.8, 1.5) * rng.choice([-1, 1]),
                              col=[PEARL, GOLD_P, CORAL_P][rng.choice(3, p=[0.55, 0.3, 0.15])],
                              size=rng.uniform(0.7, 1.2), tw=rng.uniform(0, 6.28)))
        for _ in range(110):
            a = rng.uniform(0, LT * 0.95)
            u = a / LT
            n2 = float(fbm(a / 4.0 + 9, 0.0, seedk + 5))
            fe = frame_of(thr_dissolve(u, n2), DIS0, DIS1) + rng.uniform(-0.4, 0.4)
            fe = min(fe, NF - 4 - rng.uniform(0, 2))
            p, t, n = point_at(spine(k, fe), a)
            wmax = np.interp(a, BODY_A + [66], BODY_W + [8])
            pos = p + n * rng.uniform(-1, 1) * wmax
            rp = pos - C; rp /= np.linalg.norm(rp) + 1e-9
            ang = rng.uniform(0, 2 * math.pi)
            vel = np.array([math.cos(ang), math.sin(ang)]) * rng.uniform(0.3, 1.3) + rp * rng.uniform(0.1, 0.7) - t * rng.uniform(1.2, 3.2)
            col = [PEARL, GOLD_P, CORAL_P][rng.choice(3, p=[0.45, 0.4, 0.15])]
            parts.append(dict(kind='out', fe=fe, life=min(rng.uniform(5, 10), NF - 1.3 - fe), pos=pos, vel=vel,
                              col=col, size=rng.uniform(0.6, 1.25), star=col is GOLD_P and rng.random() < 0.4,
                              tw=rng.uniform(0, 6.28)))
        # bulles depuis la bouche
        for fb in np.arange(REV1 - 1 + k * 4.5, DIS0 + 1, 9.0):
            for j in range(rng.integers(1, 3)):
                f0 = fb + j * 1.3 + rng.uniform(-0.3, 0.3)
                p, t, n = point_at(spine(k, f0), 0.0)
                parts.append(dict(kind='bubble', fe=f0, life=rng.uniform(9, 13), pos=p - t * 2.5 + n * rng.uniform(-2, 2),
                                  vel=np.array([rng.uniform(-0.1, 0.1), -0.45]) + (p - C) / 80 * 0.3,
                                  r=rng.uniform(1.0, 1.9), wob=rng.uniform(0, 6.28)))
        # ondes lumineuses dans le sillage
        for fr in np.arange(REV1 + 2 + k * 5, DIS0 + 2, 10.0):
            p, t, n = point_at(spine(k, fr), LT - 4)
            parts.append(dict(kind='ripple', fe=fr, life=9.0, pos=p))
        # scintillement de sillage
        for f0 in np.arange(REV1 - 2, DIS0 + 2, 1.1):
            p, t, n = point_at(spine(k, f0), rng.uniform(44, 58))
            parts.append(dict(kind='out', fe=f0, life=rng.uniform(4, 7), pos=p + n * rng.uniform(-6, 6),
                              vel=rng.normal(0, 0.3, 2), col=[PEARL, GOLD_P][rng.integers(0, 2)],
                              size=rng.uniform(0.45, 0.75), star=False, tw=rng.uniform(0, 6.28)))
    return parts


def render_particles(cv, parts, f):
    for p in parts:
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
                a = smoothstep(0.0, 0.35, s) * (0.55 + 0.45 * s)
            else:
                pos = p['target']; a = max(0.0, 1 - (f - p['fa']) / 2.0)
            tw = 0.75 + 0.25 * math.sin(p['tw'] + f * 1.9)
            stamp_dot(cv, pos[0] * SS, pos[1] * SS, p['size'] * SS * 0.62, p['col'], float(min(1, a * tw * 1.2)), additive=True)
        elif p['kind'] == 'out':
            s = (f - p['fe']) / p['life']
            if s < 0 or s > 1:
                continue
            kk = 1 - math.exp(-(f - p['fe']) * 0.35)
            pos = p['pos'] + p['vel'] * (kk / 0.35)
            a = (1 - s) ** 1.3 * min(1.0, (f - p['fe']) * 2 + 0.4)
            tw = 0.6 + 0.4 * math.sin(p['tw'] + f * 2.3)
            sz = p['size'] * (1 - 0.4 * s)
            if p['star']:
                stamp_star(cv, pos[0] * SS, pos[1] * SS, sz * SS * 1.5, p['col'], float(a * tw), angle=0.3)
            else:
                stamp_dot(cv, pos[0] * SS, pos[1] * SS, sz * SS * 0.55, p['col'], float(a * tw), additive=True)
        elif p['kind'] == 'bubble':
            s = (f - p['fe']) / p['life']
            if s < 0 or s > 1:
                continue
            dt = f - p['fe']
            pos = p['pos'] + p['vel'] * dt * (1 - 0.3 * s) + np.array([math.sin(p['wob'] + dt * 0.9) * 1.0, 0])
            r = p['r'] * (1 + 0.35 * s)
            a = smoothstep(0, 0.15, s) * (1 - s) ** 1.2
            stamp_ring(cv, pos[0] * SS, pos[1] * SS, r * SS, 0.3 * SS, (0.9, 0.97, 1.0), float(0.7 * a))
            stamp_dot(cv, (pos[0] - r * 0.4) * SS, (pos[1] - r * 0.4) * SS, 0.35 * SS, (1, 1, 1), float(0.9 * a), additive=True)
        elif p['kind'] == 'ripple':
            s = (f - p['fe']) / p['life']
            if s < 0 or s > 1:
                continue
            r = 2.0 + 8 * (1 - (1 - s) ** 2)
            a = (1 - s) ** 1.5 * smoothstep(0, 0.12, s)
            stamp_ring(cv, p['pos'][0] * SS, p['pos'][1] * SS, r * SS, 0.28 * SS, (0.95, 0.97, 1.0), float(0.22 * a))
            if False:
                r2 = 2 + 7 * (1 - (1 - (s - 0.2) / 0.8) ** 2)
                stamp_ring(cv, p['pos'][0] * SS, p['pos'][1] * SS, r2 * SS, 0.25 * SS, (0.92, 0.96, 1.0), float(0.25 * a))


def render(f, parts):
    body = Canvas()
    # la carpe dont la tete est la plus basse passe devant (legere profondeur)
    order = sorted((0, 1), key=lambda k: math.sin(head_angle(k, f)))
    for k in order:
        draw_fish(body, k, f)
    b = downsample(body.p)
    ab = b[..., 3]
    ga = np.clip(0.38 * blur_fast(ab, 3.0) + 0.25 * blur_fast(ab, 8.0), 0, 0.75)
    glow = np.zeros_like(b)
    glow[..., :3] = np.array([255, 196, 150], np.float32) / 255 * ga[..., None]
    glow[..., 3] = ga
    out = over_small(b, glow)
    pc = Canvas()
    render_particles(pc, parts, f)
    pp = downsample(pc.p)
    pa = blur_fast(pp[..., 3], 2.2) * 0.3
    ph = np.zeros_like(pp)
    ph[..., :3] = np.array([255, 236, 200], np.float32) / 255 * pa[..., None]
    ph[..., 3] = pa
    out = over_small(pp, over_small(ph, out))
    return to_image(out)


if __name__ == '__main__':
    rng = np.random.default_rng(5)
    parts = make_particles(rng)
    only = [int(x) for x in sys.argv[1:]]
    frames = []
    for f in (only or range(NF)):
        frames.append(render(float(f), parts))
    if only:
        for f, im in zip(only, frames):
            im.save(f'dbg_carpes_{f}.png')
    else:
        save_apng(frames, 'carpes-celestes.png', DUR)
        frames[27].save('carpes-celestes-poster.webp', 'WEBP', quality=92, method=6)
