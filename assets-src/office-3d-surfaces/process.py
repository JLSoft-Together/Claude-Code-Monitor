import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

from chroma import key, trim

DIR = Path(__file__).parent
RAW = DIR / '.cache' / 'raw'
PRE = DIR / '.cache' / 'preview'
PRE.mkdir(parents=True, exist_ok=True)
ROOT = DIR.parents[1] / 'apps' / 'web' / 'public' / 'assets' / 'iso3d'
SURF = ROOT / 'surfaces'
ART = ROOT / 'wallart'
TILE = 64
WALL_H = 96
K = 0.7
TAKES = json.loads((DIR / 'takes.json').read_text()) if (DIR / 'takes.json').exists() else {}


def raw(name):
    return Image.open(RAW / f'{name}.{TAKES.get(name, 1)}.png')


def grey(a):
    return a[..., 0] * 0.299 + a[..., 1] * 0.587 + a[..., 2] * 0.114


def flatten(a, sigma):
    g = grey(a)
    low = ndimage.gaussian_filter(g, sigma, mode='wrap')
    return np.clip(a * (low.mean() / np.maximum(low, 1))[..., None], 0, 255)


def period(a, axis, guess, spread=0.3):
    g = grey(a)
    g = g - ndimage.gaussian_filter(g, max(guess, 4))
    n = g.shape[axis]
    lo, hi = max(2, int(guess * (1 - spread))), min(n // 2, int(guess * (1 + spread)) + 1)
    best, bd = None, guess
    for d in range(lo, hi):
        if axis == 1:
            c = (g[:, d:] * g[:, :-d]).mean()
        else:
            c = (g[d:] * g[:-d]).mean()
        if best is None or c > best:
            best, bd = c, d
    return bd


def wrap(a, cw, ch, f, x0=None, y0=None, fy=None):
    fy = f if fy is None else fy
    h, w, _ = a.shape
    x0 = (w - cw - f) // 2 if x0 is None else x0
    y0 = (h - ch - fy) // 2 if y0 is None else y0
    r = a[y0:y0 + ch + fy, x0:x0 + cw + f]
    x = r[:, :cw].copy()
    if f:
        t = np.linspace(0, 1, f)[None, :, None]
        x[:, :f] = r[:, cw:cw + f] * (1 - t) + r[:, :f] * t
    y = x[:ch].copy()
    if fy:
        t = np.linspace(0, 1, fy)[:, None, None]
        y[:fy] = x[ch:ch + fy] * (1 - t) + x[:fy] * t
    return y


def to_img(a, mode='RGB'):
    return Image.fromarray(np.clip(a, 0, 255).astype(np.uint8), mode)


def saturate(a, k):
    g = grey(a)[..., None]
    return g + (a - g) * k


def neutral(a, mean=228.0):
    g = grey(a)
    g = (g - g.mean()) * 1.0 + mean
    return np.repeat(g[..., None], 3, axis=2)


FLOORS = {
    'wood': dict(tiles=4, py=8, px=None, fx=160, tint=False, sat=0.82),
    'carpet': dict(tiles=2, size=560, tint=True),
    'tile_check': dict(tiles=2, py=4, px=4, n=2, tint=False),
    'tile_white': dict(tiles=2, py=6, px=6, n=4, tint=False),
    'concrete': dict(tiles=4, size=760, tint=False),
    'marble': dict(tiles=2, py=2, px=2, n=1, tint=False),
}


def floor(kind, cfg):
    a = np.asarray(raw(f'floor-{kind}').convert('RGB')).astype(np.float32)
    h, w, _ = a.shape
    a = flatten(a, w / 5)
    if 'size' in cfg:
        s = cfg['size']
        t = wrap(a, s, s, 140)
    elif kind == 'wood':
        p = period(a, 0, h / cfg['py'])
        rows = min(cfg['py'], (h - 40) // p)
        ch = p * rows
        t = wrap(a, min(ch, w - cfg['fx']), ch, cfg['fx'], fy=min(30, h - ch))
    else:
        py = period(a, 0, h / cfg['py'])
        px = period(a, 1, w / cfg['px'])
        n = cfg['n']
        f = min(px, py) // 3
        t = wrap(a, px * n, py * n, f)
    out = TILE * cfg['tiles']
    im = to_img(t).resize((out, out), Image.LANCZOS)
    arr = np.asarray(im).astype(np.float32)
    if cfg['tint']:
        arr = neutral(arr)
    arr = saturate(arr, cfg.get('sat', 1.0))
    im = to_img(arr)
    name = f'floor-{kind}.webp'
    im.save(SURF / name, quality=92, method=6)
    sheet = Image.new('RGB', (out * 4, out * 4))
    for i in range(4):
        for j in range(4):
            sheet.paste(im, (i * out, j * out))
    sheet.save(PRE / f'floor-{kind}-4x4.png')
    sheet.resize((sheet.width, round(sheet.height * K)), Image.LANCZOS).save(PRE / f'floor-{kind}-4x4-k.png')
    entry = {'file': name, 'tile': [out, out], 'tint': cfg['tint']}
    if cfg['tiles'] != 1:
        entry['tiles'] = cfg['tiles']
    return entry


WALLS = {
    'plain': dict(tint=True, flat=True, cap='#e9e4da'),
    'stripes': dict(tint=True, guess=1 / 6, n=2, cap='#e9e4da'),
    'tiles': dict(tint=True, guess=0.12, cap='#e9e4da'),
    'wood_panel': dict(tint=False, guess=1 / 10, n=3, sat=0.8, cap='#e6dccb'),
    'brick': dict(tint=True, guess=1 / 5, cap='#e9e4da'),
    'glass': dict(tint=False, guess=1 / 2, cap='#5d636b', glass=True),
    'marble': dict(tint=False, guess=1 / 3, cap='#ece6dc'),
}


def skirt_top(a):
    g = grey(a).mean(axis=1)
    h = len(g)
    d = np.abs(np.diff(ndimage.gaussian_filter1d(g, 2)))
    lo, hi = int(h * 0.82), int(h * 0.96)
    return lo + int(np.argmax(d[lo:hi]))


def wall(pat, cfg):
    a = np.asarray(raw(f'wall-{pat}').convert('RGB')).astype(np.float32)
    h, w, _ = a.shape
    st = skirt_top(a)
    face = a[:st]
    col = ndimage.gaussian_filter1d(grey(face).mean(axis=0), w / 6, mode='nearest')
    corr = (col.mean() / col)[None, :, None]
    if not cfg.get('glass'):
        a = np.clip(a * corr, 0, 255)
    bot = h
    s = WALL_H / bot
    if cfg.get('flat'):
        prof = np.median(a[:, w // 4: 3 * w // 4], axis=1)
        lowp = ndimage.gaussian_filter1d(prof[:st], 30, axis=0, mode='nearest')
        prof[:st] = lowp
        tex = np.repeat(prof[:, None, :], round(TILE / s) + 40, axis=1)
        grain = a[:, w // 2 - tex.shape[1] // 2: w // 2 - tex.shape[1] // 2 + tex.shape[1]]
        grain = grain - ndimage.gaussian_filter(grain, (6, 6, 0))
        tex = tex + grain * 0.6
        t = wrap(np.concatenate([tex, tex[:40]], axis=0), tex.shape[1] - 40, h, 40, 0, 0)
    else:
        if cfg['guess']:
            p = period(a[:st], 1, cfg['guess'] * w)
        else:
            p = period(a[:st], 1, w * 0.09, spread=0.6)
        want = TILE / s
        n = cfg.get('n') or max(1, int(round(want / p)))
        cw = n * p
        f = min(p // 3, 80)
        if cw + f > w:
            n -= 1
            cw = n * p
        x0 = (w - cw - f) // 2
        r = a[:, x0:x0 + cw + f]
        tt = np.linspace(0, 1, f)[None, :, None]
        t = r[:, :cw].copy()
        t[:, :f] = r[:, cw:cw + f] * (1 - tt) + r[:, :f] * tt
    im = to_img(t).resize((TILE, WALL_H), Image.LANCZOS)
    arr = np.asarray(im).astype(np.float32)
    sk = round(st * s)
    if cfg['tint']:
        arr = neutral(arr, 226.0)
    arr = saturate(arr, cfg.get('sat', 1.0))
    alpha = np.full(arr.shape[:2], 255.0)
    if cfg.get('glass'):
        L = grey(arr)
        med = np.median(L[:sk])
        frame = L < med - 45
        frame = ndimage.binary_dilation(frame, iterations=1)
        ga = np.clip(0.38 + (L - med) / 90.0, 0.3, 0.85)
        alpha = np.where(frame, 1.0, ga) * 255
        alpha[sk - 1:] = 255
    rgba = np.dstack([arr, alpha])
    im = to_img(rgba, 'RGBA')
    name = f'wall-{pat}.webp'
    im.save(SURF / name, quality=92, method=6, lossless=bool(cfg.get('glass')))
    return im, {'file': name, 'tile': [TILE, WALL_H], 'tint': cfg['tint'], 'cap': cfg['cap'], 'skirting': WALL_H - sk}


def hexrgb(h):
    return np.array([int(h[i:i + 2], 16) for i in (1, 3, 5)], np.float32)


def tinted(im, color):
    a = np.asarray(im.convert('RGBA')).astype(np.float32)
    a[..., :3] = a[..., :3] * hexrgb(color) / 255
    return to_img(a, 'RGBA')


def wall_preview(walls):
    rows = []
    for pat, (im, e) in walls.items():
        if e['tint']:
            im = tinted(im, '#d8dfcf')
        cap = Image.new('RGBA', (TILE * 10, 8), tuple(hexrgb(e['cap']).astype(int)) + (255,))
        row = Image.new('RGBA', (TILE * 10, WALL_H + 8), (60, 60, 60, 255))
        bg = Image.new('RGBA', (TILE * 10, WALL_H), (120, 140, 160, 255))
        row.paste(cap, (0, 0))
        for i in range(10):
            bg.alpha_composite(im, (i * TILE, 0))
        row.paste(bg, (0, 8))
        rows.append(row)
    sheet = Image.new('RGBA', (TILE * 10, sum(r.height + 6 for r in rows)), (40, 40, 40, 255))
    y = 0
    for r in rows:
        sheet.paste(r, (0, y))
        y += r.height + 6
    sheet.save(PRE / 'walls-10.png')


def rug(name):
    im = trim(key(raw(name)), pad=0)
    a = np.asarray(im).astype(np.float32)
    rgb = neutral(a[..., :3], 226.0)
    al = a[..., 3]
    out = to_img(np.dstack([rgb, al]), 'RGBA').resize((384, round(384 * im.height / im.width)), Image.LANCZOS)
    fn = f'{name}.webp'
    out.save(SURF / fn, quality=92, method=6)
    return {'file': fn, 'tint': True, 'size': list(out.size)}


def surfaces():
    SURF.mkdir(parents=True, exist_ok=True)
    man = {'version': 1, 'scale': 2, 'floors': {}, 'walls': {}, 'rugs': {}}
    only = set(sys.argv[2:])
    for k, c in FLOORS.items():
        if (RAW / f'floor-{k}.{TAKES.get(f"floor-{k}", 1)}.png').exists():
            man['floors'][k] = floor(k, c)
    ws = {}
    for k, c in WALLS.items():
        if (RAW / f'wall-{k}.{TAKES.get(f"wall-{k}", 1)}.png').exists():
            ws[k] = wall(k, c)
            man['walls'][k] = ws[k][1]
    if ws:
        wall_preview(ws)
    for r in ('a', 'b'):
        if (RAW / f'rug-{r}.{TAKES.get(f"rug-{r}", 1)}.png').exists():
            man['rugs'][r] = rug(f'rug-{r}')
    (SURF / 'manifest.json').write_text(json.dumps(man, indent=2) + '\n')


def pieces(name, n):
    im = key(raw(name))
    al = np.asarray(im.getchannel('A')) > 128
    lab, k = ndimage.label(ndimage.binary_closing(al, iterations=3))
    sl = ndimage.find_objects(lab)
    boxes = [(s[0].start, s[1].start, s[0].stop, s[1].stop) for s in sl]
    boxes = [b for b in boxes if (b[2] - b[0]) * (b[3] - b[1]) > al.size * 0.01]
    boxes.sort(key=lambda b: (b[0] + b[2]) / 2)
    rows, cur = [], []
    for b in boxes:
        if cur and (b[0] + b[2]) / 2 - (cur[-1][0] + cur[-1][2]) / 2 > (b[2] - b[0]) * 0.5:
            rows.append(sorted(cur, key=lambda c: c[1]))
            cur = []
        cur.append(b)
    if cur:
        rows.append(sorted(cur, key=lambda c: c[1]))
    boxes = [b for r in rows for b in r]
    assert len(boxes) == n, (name, len(boxes), boxes)
    return [im.crop((b[1], b[0], b[3], b[2])) for b in boxes]


ARTSETS = [
    ('art-paint-a', 'painting', [('painting-dawn-lake', 'Dawn lake'), ('painting-arcs', 'Arcs'), ('painting-sailboat', 'Sailboat'), ('painting-lemon-tree', 'Lemon tree')], (104, 64), 2),
    ('art-paint-b', 'painting', [('painting-pine-path', 'Pine path'), ('painting-circles', 'Circles'), ('painting-dunes', 'Dunes'), ('painting-tulips', 'Tulip field')], (104, 64), 2),
    ('art-wide', 'painting', [('painting-wide-hills', 'Green hills'), ('painting-wide-lighthouse', 'Lighthouse coast'), ('painting-wide-horizon', 'Horizon bands')], (232, 88), 4),
    ('art-posters', 'poster', [('poster-code', 'Code'), ('poster-coffee', 'Coffee'), ('poster-rocket', 'Rocket'), ('poster-cat', 'Cat'), ('poster-bug', 'Bug'), ('poster-ship-it', 'Ship it')], (48, 64), 1),
]


def wallart():
    ART.mkdir(parents=True, exist_ok=True)
    out = []
    sheet = []
    for name, kind, ids, size, tiles in ARTSETS:
        if not (RAW / f'{name}.{TAKES.get(name, 1)}.png').exists():
            continue
        for (aid, title), im in zip(ids, pieces(name, len(ids))):
            src_ar = im.width / im.height
            tw, th = size
            if src_ar > tw / th * 1.12:
                tw2 = round(th * src_ar / 1.12)
                tw = min(tw2, tw)
            im = im.resize(size, Image.LANCZOS)
            fn = f'{aid}.webp'
            im.save(ART / fn, lossless=True, method=6)
            e = {'id': aid, 'kind': kind, 'file': fn, 'w': im.width, 'h': im.height, 'tiles': tiles, 'title': title}
            if kind == 'poster':
                e['variant'] = aid[7:].replace('-', '_')
            out.append(e)
            sheet.append((aid, im, round(src_ar / (size[0] / size[1]), 3)))
    (ART / 'manifest.json').write_text(json.dumps({'version': 1, 'scale': 2, 'wallArt': out}, indent=2) + '\n')
    W = 900
    cs = Image.new('RGBA', (W, 1000), (233, 228, 218, 255))
    x = y = 10
    rh = 0
    for aid, im, r in sheet:
        big = im.resize((im.width * 2, im.height * 2), Image.LANCZOS)
        if x + big.width > W:
            x, y = 10, y + rh + 10
            rh = 0
        cs.alpha_composite(big, (x, y))
        x += big.width + 10
        rh = max(rh, big.height)
    cs.save(PRE / 'wallart-sheet.png')
    print('aspect ratios src/target', [(a, r) for a, _, r in sheet])


def room():
    sm = json.loads((SURF / 'manifest.json').read_text())
    am = json.loads((ART / 'manifest.json').read_text())
    W, D = 9, 6
    fl = sm['floors']['wood']
    tex = Image.open(SURF / fl['file']).convert('RGB')
    fw = W * TILE
    fd = D * TILE
    floor_td = Image.new('RGB', (fw, fd))
    for i in range(0, fw, tex.width):
        for j in range(0, fd, tex.height):
            floor_td.paste(tex, (i, j))
    floor_sq = floor_td.resize((fw, round(fd * K)), Image.LANCZOS)
    wl = sm['walls']['plain']
    wim = tinted(Image.open(SURF / wl['file']), '#efe6d6')
    cap_h = 10
    m = 40
    img = Image.new('RGBA', (fw + 2 * m, cap_h + WALL_H + floor_sq.height + 2 * m), (214, 208, 200, 255))
    ox, oy = m, m
    img.paste(Image.new('RGBA', (fw, cap_h), tuple(hexrgb(wl['cap']).astype(int)) + (255,)), (ox, oy))
    for i in range(W):
        img.alpha_composite(wim, (ox + i * TILE, oy + cap_h))
    img.paste(floor_sq, (ox, oy + cap_h + WALL_H))
    shade = np.zeros((14, fw, 4), np.float32)
    shade[..., 3] = np.linspace(70, 0, 14)[:, None]
    img.alpha_composite(to_img(shade, 'RGBA'), (ox, oy + cap_h + WALL_H))
    arts = {e['id']: e for e in am['wallArt']}
    picks = [('painting-dawn-lake', 1), ('poster-coffee', 4), ('painting-arcs', 6)]
    for aid, tx in picks:
        if aid not in arts:
            continue
        e = arts[aid]
        a = Image.open(ART / e['file']).convert('RGBA')
        cx = ox + tx * TILE + e['tiles'] * TILE // 2
        cy = oy + cap_h + int(WALL_H * 0.42)
        sh = Image.new('RGBA', a.size, (0, 0, 0, 0))
        sa = np.asarray(a).astype(np.float32)
        sh = to_img(np.dstack([np.zeros(sa.shape[:2] + (3,)), ndimage.gaussian_filter(sa[..., 3] * 0.35, 2)]), 'RGBA')
        img.alpha_composite(sh, (cx - a.width // 2 + 2, cy - a.height // 2 + 3))
        img.alpha_composite(a, (cx - a.width // 2, cy - a.height // 2))
    img.save(DIR / '.cache' / 'room-preview.png')
    img.resize((img.width * 2, img.height * 2), Image.LANCZOS).save(DIR / '.cache' / 'room-preview@2.png')


if __name__ == '__main__':
    what = sys.argv[1] if len(sys.argv) > 1 else 'all'
    if what in ('surfaces', 'all'):
        surfaces()
    if what in ('art', 'all'):
        wallart()
    if what in ('room', 'all'):
        room()
