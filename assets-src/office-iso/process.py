import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

from chroma import blobs, key

ROOT = Path(__file__).parent
REPO = ROOT.parent.parent
RAW = ROOT / '.cache' / 'raw'
OUT = ROOT / '.cache' / 'out'
SHIP = REPO / 'apps' / 'web' / 'public' / 'assets' / 'iso' / 'chars'
OUT.mkdir(parents=True, exist_ok=True)
SHIP.mkdir(parents=True, exist_ok=True)

FW, FH = 192, 320
FEET_Y = 312
STAND_H = 280
SEAT_Y = 240
WALK_H = 0.98
WALK_CYCLE_MS = 640
COLS = 8
FLOOR_BG = (233, 228, 218, 255)
STYLE = next((a.split('=', 1)[1] for a in sys.argv[1:] if a.startswith('--style=')), 'flat')
SUFFIX = '' if STYLE == 'flat' else STYLE
CONF = json.loads((ROOT / f'sheets{SUFFIX}.json').read_text())
ARCH = json.loads((ROOT / f'prompts{SUFFIX}.json').read_text())['archetypes']
TAKE = dict(a.split('=', 1) for a in sys.argv[1:] if '=' in a and not a.startswith('--'))

LAYOUTS = json.loads((ROOT / 'layouts.json').read_text())
LAYOUT = LAYOUTS[STYLE]
ANIMS = [tuple(x) for x in LAYOUT['anims']]
if LAYOUT.get('frame'):
    FW, FH = LAYOUT['frame']
    FEET_Y = LAYOUT['feet']
    SEAT_Y = LAYOUT.get('seat', SEAT_Y + FEET_Y - 312)
if LAYOUT.get('ship'):
    SHIP = REPO / LAYOUT['ship']
    SHIP.mkdir(parents=True, exist_ok=True)
if LAYOUT.get('raw'):
    RAW = ROOT / LAYOUT['raw']
if SUFFIX:
    OUT = ROOT / '.cache' / f'out{SUFFIX}'
    OUT.mkdir(parents=True, exist_ok=True)


def raw(name):
    return Image.open(RAW / f"{name}.{TAKE.get(name, CONF['takes'].get(name, '1'))}.png")


def cut(name, n):
    im = key(raw(name))
    a = np.asarray(im)
    al = a[..., 3] > 40
    lab, k = ndimage.label(al)
    if k == 0:
        raise SystemExit(f'{name}: empty')
    sizes = ndimage.sum(al, lab, range(1, k + 1))
    sl = ndimage.find_objects(lab)
    order = np.argsort(-sizes)
    seeds = [i for i in order if sizes[i] >= sizes[order[0]] * 0.15]
    if len(seeds) != n:
        prof = al.sum(0).astype(float)
        xs = np.flatnonzero(prof > 0)
        x0, x1 = xs[0], xs[-1]
        w = (x1 - x0) / n
        cuts = [0]
        for j in range(1, n):
            c0 = x0 + j * w
            lo, hi = int(c0 - w / 3), int(c0 + w / 3)
            cuts.append(lo + int(np.argmin(prof[lo:hi])))
        cuts.append(im.width)
        print(f'  {name}: {len(seeds)} figures found, expected {n}; cut at valleys {cuts[1:-1]}')
        fr = []
        for j in range(n):
            c = np.asarray(im.crop((cuts[j], 0, cuts[j + 1], im.height))).copy()
            lb, kk = ndimage.label(c[..., 3] > 40)
            if kk > 1:
                sz = ndimage.sum(c[..., 3] > 40, lb, range(1, kk + 1))
                big = int(np.argmax(sz))
                keep = [big + 1]
                for i, sl_i in enumerate(ndimage.find_objects(lb)):
                    edge = sl_i[1].start <= 6 or sl_i[1].stop >= c.shape[1] - 6
                    if i != big and not edge and sz[i] >= sz[big] * 0.002:
                        keep.append(i + 1)
                m = ndimage.binary_dilation(np.isin(lb, keep), iterations=2)
                c[~m] = 0
            c = Image.fromarray(c, 'RGBA')
            fr.append(c.crop(c.getchannel('A').point(lambda v: 255 if v > 8 else 0).getbbox()))
        return fr
    else:
        seeds_sorted = sorted(seeds, key=lambda i: sl[i][1].start)
        def dist(i, s):
            x0, x1 = sl[i][1].start, sl[i][1].stop
            s0, s1 = sl[s][1].start, sl[s][1].stop
            return max(0, s0 - x1, x0 - s1) + abs((x0 + x1) / 2 - (s0 + s1) / 2) * 0.01
        owner = {i: (seeds_sorted.index(i) if i in seeds_sorted else min(range(n), key=lambda j: dist(i, seeds_sorted[j]))) for i in range(k)}
    fr = []
    for j in range(n):
        ids = [i + 1 for i in range(k) if owner[i] == j and sizes[i] >= 60]
        m = np.isin(lab, ids)
        m = ndimage.binary_dilation(m, iterations=2)
        b = a.copy()
        b[~m] = 0
        f = Image.fromarray(b, 'RGBA')
        fr.append(f.crop(f.getchannel('A').point(lambda v: 255 if v > 8 else 0).getbbox()))
    return fr


def colour_match(frames, ref, k=1.0):
    r = np.asarray(ref).astype(np.float32)
    rm = r[..., 3] > 200
    mu_r, sd_r = r[rm][:, :3].mean(0), r[rm][:, :3].std(0)
    allpx = np.concatenate([np.asarray(f).astype(np.float32)[np.asarray(f)[..., 3] > 200][:, :3] for f in frames])
    mu, sd = allpx.mean(0), allpx.std(0)
    out = []
    for f in frames:
        a = np.asarray(f).astype(np.float32)
        rgb = (a[..., :3] - mu) / np.maximum(sd, 1) * sd_r + mu_r
        a[..., :3] = a[..., :3] * (1 - k) + rgb * k
        out.append(Image.fromarray(np.clip(a, 0, 255).astype(np.uint8), 'RGBA'))
    return out


def body_h(f):
    al = alpha(f)
    w = al.sum(1)
    rows = np.flatnonzero(w > 0.35 * w.max())
    return float(np.flatnonzero(w > 0)[-1] - rows[0])


def breathe(cell, k):
    bb = cell.getbbox()
    body = cell.crop(bb)
    h = round(body.height * k)
    body = body.resize((body.width, h), Image.LANCZOS)
    out = Image.new('RGBA', cell.size, (0, 0, 0, 0))
    out.alpha_composite(body, (bb[0], bb[3] - h))
    return out


def alpha(im):
    return np.asarray(im.getchannel('A')) > 128


def core_x(im, lo=0.22, hi=0.45):
    al = alpha(im)
    rows = np.flatnonzero(al.any(1))
    y0, y1 = rows[0], rows[-1]
    mids = []
    for y in range(y0 + int((y1 - y0) * lo), y0 + int((y1 - y0) * hi)):
        r = np.append(np.insert(al[y].astype(np.int8), 0, 0), 0)
        d = np.diff(r)
        s, e = np.flatnonzero(d == 1), np.flatnonzero(d == -1)
        if len(s):
            k = int(np.argmax(e - s))
            mids.append((s[k] + e[k]) / 2)
    return float(np.median(mids)) if mids else im.width / 2


def head_w(im, frac=0.16):
    al = alpha(im)
    rows = np.flatnonzero(al.any(1))
    y0 = rows[0]
    band = al[y0: y0 + max(4, int(im.height * frac))]
    return float(np.mean(band.sum(1)[band.sum(1) > 0][len(band) // 3:]))


def scaled(f, s):
    return f.resize((max(1, round(f.width * s)), max(1, round(f.height * s))), Image.LANCZOS)


def place(f, s, mode, cx_frac=None):
    g = scaled(f, s)
    cell = Image.new('RGBA', (FW, FH), (0, 0, 0, 0))
    cx = core_x(g) if cx_frac is None else g.width * cx_frac
    x, y = round(FW / 2 - cx), FEET_Y - g.height
    if y < 0 or x < 0 or x + g.width > FW:
        print(f'    clip: x={x} y={y} w={g.width} h={g.height}')
    cell.alpha_composite(g, (x, y))
    return cell


def exists(name):
    return any(RAW.glob(f'{name}.*.png'))


def build(aid):
    c = CONF['tune'].get(aid, {})
    print(aid)
    out, src, turn = {}, {}, None
    for sh in LAYOUT['sheets']:
        name = sh['name']
        if name in c.get('off', []) or not exists(f'{aid}-{name}'):
            if sh.get('alt') and exists(f'{aid}-{sh["alt"]}'):
                sh = {**sh, **sh.get('alt_spec', {}), 'name': sh['alt']}
                name = sh['name']
            elif sh.get('optional'):
                continue
            else:
                raise SystemExit(f'{aid}: missing sheet {name}')
        fr = cut(f'{aid}-{name}', sh['n'])
        if turn is not None and name in c.get('cm', {}):
            fr = colour_match(fr, turn[sh.get('cm_ref', 0)], c['cm'][name])
        mode = sh['scale']
        if mode in ('turn', 'ref'):
            s = STAND_H / fr[0].height
        elif mode == 'walk':
            s = STAND_H * WALK_H / max(f.height for f in fr)
        else:
            raise SystemExit(f'bad scale {mode}')
        s *= c.get('k', {}).get(name, 1.0)
        if mode == 'turn':
            turn = fr
        print(f'  {name} scale {s:.4f} heights {[round(f.height * s) for f in fr]}')
        skip = c.get('skip', {}).get(name, [])
        for col, anim, anchor, *opt in sh['cols']:
            if anim in skip:
                continue
            ss = s
            if opt and opt[0] == 'match' and anim in src:
                f0, s0 = src[anim]
                ss = s0 * body_h(f0) / body_h(fr[col])
            out.setdefault(anim, []).append(place(fr[col], ss, anchor))
            src.setdefault(anim, (fr[col], ss))
    for anim, how, k in LAYOUT.get('synth', []):
        if anim in out and how == 'breathe':
            out[anim].append(breathe(out[anim][0], c.get('breathe_k', k)))
    return out


def atlas(cells):
    rows = [a for a in ANIMS if a[0] in cells]
    sh = Image.new('RGBA', (FW * COLS, FH * len(rows)), (0, 0, 0, 0))
    meta = {}
    for r, (name, anchor, ms) in enumerate(rows):
        fr = cells[name]
        for i, f in enumerate(fr):
            sh.alpha_composite(f, (i * FW, r * FH))
        if name.startswith('walk'):
            ms = round(WALK_CYCLE_MS / len(fr))
        if len(fr) == 1:
            ms = 0
        meta[name] = {'row': r, 'frames': len(fr), 'ms': ms, 'anchor': anchor}
    return sh, meta


def save_webp(im, path):
    im.save(path, 'WEBP', quality=90, alpha_quality=100, method=6)


def fringe(im):
    a = np.asarray(im).astype(int)
    r, g, b, al = a[..., 0], a[..., 1], a[..., 2], a[..., 3]
    return int(((al > 0) & (np.minimum(r, b) - g > 40) & (np.abs(r - b) < 60)).sum())


def guides(img, n, seat=False):
    d = ImageDraw.Draw(img)
    for i in range(n + 1):
        d.line([(i * FW, 0), (i * FW, img.height)], fill=(170, 170, 200, 255))
    for row in range(img.height // FH):
        y0 = row * FH
        d.line([(0, y0 + FEET_Y), (img.width, y0 + FEET_Y)], fill=(220, 80, 80, 255))
        d.line([(0, y0 + FEET_Y - STAND_H), (img.width, y0 + FEET_Y - STAND_H)], fill=(80, 160, 80, 255))
        if seat:
            d.line([(0, y0 + SEAT_Y), (img.width, y0 + SEAT_Y)], fill=(80, 120, 220, 255))
        for i in range(n):
            d.line([(i * FW + FW // 2, y0 + FEET_Y - 6), (i * FW + FW // 2, y0 + FEET_Y + 6)], fill=(220, 80, 80, 255))


def contact(all_cells):
    order = [a[0] for a in ANIMS]
    ncol = max(sum(len(c.get(k, [])) for k in order) for c in all_cells.values())
    img = Image.new('RGBA', (FW * ncol, FH * len(all_cells)), FLOOR_BG)
    for r, (aid, cells) in enumerate(all_cells.items()):
        x = 0
        for k in order:
            for f in cells.get(k, []):
                img.alpha_composite(f, (x, r * FH))
                x += FW
    guides(img, ncol, seat=True)
    return img


def walk_gif(cells, path):
    walks = [k for k in cells if k.startswith('walk_')]
    n = max(len(cells[k]) for k in walks)
    fr = []
    for i in range(n):
        bg = Image.new('RGBA', (FW * len(walks), FH), FLOOR_BG)
        for j, k in enumerate(walks):
            bg.alpha_composite(cells[k][i * len(cells[k]) // n], (j * FW, 0))
        ImageDraw.Draw(bg).line([(0, FEET_Y), (bg.width, FEET_Y)], fill=(220, 80, 80, 255))
        fr.append(bg.convert('RGB'))
    fr[0].save(path, save_all=True, append_images=fr[1:], duration=WALK_CYCLE_MS // n, loop=0)


def anchors(all_cells):
    heads, chests, hands = [], [], []
    for cells in all_cells.values():
        f = cells[ANIMS[0][0]][0]
        al = alpha(f)
        rows = np.flatnonzero(al.any(1))
        top = rows[0]
        heads.append(top + 0.11 * STAND_H)
        chests.append(top + 0.36 * STAND_H)
        band = al[int(top + 0.50 * STAND_H): int(top + 0.58 * STAND_H)]
        xs = np.flatnonzero(band.any(0))
        hands.append(xs[-1] - 6 if len(xs) else FW / 2 + 30)
    return {
        'feet': [FW // 2, FEET_Y],
        'head': [FW // 2, round(float(np.mean(heads)))],
        'chest': [FW // 2, round(float(np.mean(chests)))],
        'hand': [round(float(np.mean(hands))), round(FEET_Y - STAND_H + 0.54 * STAND_H)],
        'seat': [FW // 2, SEAT_Y],
    }


ids = [a for a in sys.argv[1:] if '=' not in a and not a.startswith('--')] or list(ARCH)
all_cells = {}
for aid in ids:
    all_cells[aid] = build(aid)

manifest_path = SHIP / 'manifest.json'
manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else None
if manifest is None or set(ids) == set(ARCH):
    manifest = {'version': 1, 'scale': 2, 'frame': {'w': FW, 'h': FH}, 'figure': {'standH': STAND_H}, 'cols': COLS, 'anchors': anchors(all_cells), 'archetypes': []}
report = {}
for aid, cells in all_cells.items():
    sh, meta = atlas(cells)
    sh1 = sh.resize((sh.width // 2, sh.height // 2), Image.LANCZOS)
    save_webp(sh, SHIP / f'{aid}.webp')
    save_webp(sh1, SHIP / f'{aid}@1x.webp')
    sh.save(OUT / f'{aid}-atlas.png')
    walk_gif(cells, OUT / f'{aid}-walk.gif')
    c = ARCH[aid]
    entry = {'id': aid, 'look': c['look'], 'name': c['name'], 'sheet': f'{aid}.webp', 'sheet1x': f'{aid}@1x.webp', 'anims': meta}
    manifest['archetypes'] = [e for e in manifest['archetypes'] if e['id'] != aid] + [entry]
    report[aid] = {'fringe_px': fringe(sh), 'webp_kb': round((SHIP / f'{aid}.webp').stat().st_size / 1024),
                   'webp1x_kb': round((SHIP / f'{aid}@1x.webp').stat().st_size / 1024)}
order = list(ARCH)
manifest['archetypes'].sort(key=lambda e: order.index(e['id']))
manifest_path.write_text(json.dumps(manifest, indent=2) + '\n')
cs = contact(all_cells)
cs.save(ROOT / '.cache' / f'contact-sheet{SUFFIX}.png')
for r, aid in enumerate(all_cells):
    n_own = sum(len(v) for v in all_cells[aid].values())
    row = cs.crop((0, r * FH, n_own * FW, (r + 1) * FH))
    half = (n_own + 1) // 2 * FW
    row.crop((0, 0, half, FH)).save(OUT / f'contact-{aid}-a.png')
    row.crop((half, 0, row.width, FH)).save(OUT / f'contact-{aid}-b.png')
print(json.dumps(report, indent=1))
