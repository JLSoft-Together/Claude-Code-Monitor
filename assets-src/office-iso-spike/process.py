import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

from chroma import blobs, key, trim

ROOT = Path(__file__).parent
RAW = ROOT / '.cache' / 'raw'
OUT = ROOT / '.cache' / 'out'
OUT.mkdir(parents=True, exist_ok=True)
FLOOR_BG = (233, 228, 218, 255)
TW, TH = 128, 64
CHAR_H = 140
FRAME_W, FRAME_H = 96, 160
TAKE = dict(a.split('=') for a in sys.argv[1:])


def raw(name):
    return Image.open(RAW / f"{name}.{TAKE.get(name, '1')}.png")


def on_floor(im, scale=1.0, bg=FLOOR_BG):
    if scale != 1.0:
        im = im.resize((max(1, round(im.width * scale)), max(1, round(im.height * scale))), Image.LANCZOS)
    canvas = Image.new('RGBA', (im.width + 40, im.height + 40), bg)
    canvas.alpha_composite(im, (20, 20))
    return canvas


def fit(im, w):
    s = w / im.width
    return im.resize((round(im.width * s), round(im.height * s)), Image.LANCZOS)


def hair_width(im):
    a = np.asarray(im).astype(int)
    r, g, b, al = a[..., 0], a[..., 1], a[..., 2], a[..., 3]
    m = (al > 200) & (r > 60) & (r < 150) & (g > 35) & (g < 100) & (b < 75) & (r > g + 15) & (g > b)
    lab, n = ndimage.label(m)
    if not n:
        return im.width * 0.3
    sizes = ndimage.sum(m, lab, range(1, n + 1))
    biggest = lab == (1 + int(np.argmax(sizes)))
    cols = np.flatnonzero(biggest.any(0))
    return float(cols[-1] - cols[0] + 1)


def foot_x(im):
    al = np.asarray(im.getchannel('A')) > 128
    rows = np.flatnonzero(al.any(1))
    band = al[max(0, rows[-1] - im.height // 12): rows[-1] + 1]
    xs = np.flatnonzero(band.any(0))
    return (xs[0] + xs[-1]) / 2


def torso_x(im):
    al = np.asarray(im.getchannel('A')) > 128
    rows = np.flatnonzero(al.any(1))
    y0, y1 = rows[0], rows[-1]
    band = al[y0 + int((y1 - y0) * 0.30): y0 + int((y1 - y0) * 0.45)]
    xs = np.flatnonzero(band.any(0))
    cols = band.sum(0)
    return float((np.arange(len(cols)) * cols).sum() / max(cols.sum(), 1))


def normalise(frames, scale, anchor='torso'):
    res = []
    for f in frames:
        g = f.resize((max(1, round(f.width * scale)), max(1, round(f.height * scale))), Image.LANCZOS)
        cell = Image.new('RGBA', (FRAME_W, FRAME_H), (0, 0, 0, 0))
        fx = foot_x(g) if anchor == 'foot' else torso_x(g)
        cell.alpha_composite(g, (round(FRAME_W / 2 - fx), FRAME_H - 4 - g.height))
        res.append(cell)
    return res


def strip(cells, bg=None, guides=True):
    s = Image.new('RGBA', (FRAME_W * len(cells), FRAME_H), bg or (0, 0, 0, 0))
    for i, c in enumerate(cells):
        s.alpha_composite(c, (i * FRAME_W, 0))
    if guides:
        d = ImageDraw.Draw(s)
        for i in range(len(cells) + 1):
            d.line([(i * FRAME_W, 0), (i * FRAME_W, FRAME_H)], fill=(160, 160, 200, 255))
        d.line([(0, FRAME_H - 4), (s.width, FRAME_H - 4)], fill=(220, 80, 80, 255))
    return s


def gif(cells, path, ms=150, scale=2):
    fr = []
    for c in cells:
        bg = Image.new('RGBA', c.size, FLOOR_BG)
        bg.alpha_composite(c)
        fr.append(bg.convert('RGB').resize((c.width * scale, c.height * scale), Image.LANCZOS))
    fr[0].save(path, save_all=True, append_images=fr[1:], duration=ms, loop=0)


def iso_tile(im):
    t = trim(key(im), pad=0)
    t = t.resize((TW, TH), Image.LANCZOS)
    mask = Image.new('L', (TW, TH), 0)
    ImageDraw.Draw(mask).polygon([(TW / 2, 0), (TW, TH / 2), (TW / 2, TH), (0, TH / 2)], fill=255)
    a = np.minimum(np.asarray(t.getchannel('A')), np.asarray(mask))
    rgb = np.asarray(t)[..., :3].copy()
    filled = ndimage.grey_dilation(rgb, size=(3, 3, 1))
    rgb = np.where((np.asarray(t.getchannel('A')) < 200)[..., None], filled, rgb)
    t = Image.fromarray(np.dstack([rgb, np.asarray(mask)]).astype(np.uint8), 'RGBA')
    return t


def grid_pos(gx, gy, ox, oy):
    return ox + (gx - gy) * TW // 2, oy + (gx + gy) * TH // 2


report = {}

desk = trim(key(raw('desk')))
desk.save(OUT / 'desk.png')
cp = trim(key(raw('chair-plant')))
parts = blobs(cp)
report['chair_plant_blobs'] = len(parts)
chair, plant = parts[0], parts[-1]
chair.save(OUT / 'chair.png')
plant.save(OUT / 'plant.png')
wall = trim(key(raw('wall')))
wall.save(OUT / 'wall.png')

row = Image.new('RGBA', (900, 420), FLOOR_BG)
x = 10
for im, w in [(desk, 300), (chair, 130), (plant, 140)]:
    f = fit(im, w)
    row.alpha_composite(f, (x, 400 - f.height))
    x += f.width + 30
row.save(OUT / 'furniture-on-floor.png')

tile = iso_tile(raw('floor'))
tile.save(OUT / 'floor-tile.png')
N = 6
ox, oy = N * TW // 2 + 20, 300
W_H, H_H = N * TW + 40, N * TH + 340


def grid_floor(t):
    sc = Image.new('RGBA', (W_H, H_H), FLOOR_BG)
    for gy in range(N):
        for gx in range(N):
            px, py = grid_pos(gx, gy, ox, oy)
            sc.alpha_composite(t, (px - TW // 2, py))
    return sc


grid_floor(tile).save(OUT / 'floor-6x6-diamond-tile.png')


def seamless_tex(im):
    a = np.asarray(im.convert('RGB')).astype(np.float32)[110:1199]
    h, w, _ = a.shape
    f = 120
    left, right = a[:, :f], a[:, w - f:]
    ramp = np.linspace(0, 1, f)[None, :, None]
    blend = right * (1 - ramp) + left * ramp
    core = a[:, f:w - f]
    out = np.concatenate([blend, core], axis=1)
    return Image.fromarray(out.clip(0, 255).astype(np.uint8))


tex = seamless_tex(raw('floor-tex'))
tex.save(OUT / 'floor-texture-seamless.png')
tiled = Image.new('RGB', (tex.width * 2, tex.height * 2))
for i in range(2):
    for j in range(2):
        tiled.paste(tex, (i * tex.width, j * tex.height))
tiled.resize((tiled.width // 3, tiled.height // 3), Image.LANCZOS).save(OUT / 'floor-texture-2x2.png')

TEX_PER_TILE = 440


def iso_floor(tex):
    reps = int(np.ceil(N * TEX_PER_TILE / min(tex.size))) + 1
    big = Image.new('RGB', (tex.width * reps, tex.height * reps))
    for i in range(reps):
        for j in range(reps):
            big.paste(tex, (i * tex.width, j * tex.height))
    k = (TW / 2) / TEX_PER_TILE
    pre = big.resize((round(big.width * k), round(big.height * k)), Image.LANCZOS)
    kk = 0.5
    X0, Y0 = ox, oy
    coeffs = (kk, 1.0, -kk * X0 - Y0, -kk, 1.0, kk * X0 - Y0)
    proj = pre.transform((W_H, H_H), Image.AFFINE, coeffs, resample=Image.BICUBIC)
    mask = Image.new('L', (W_H, H_H), 0)
    top = grid_pos(0, 0, ox, oy)
    ImageDraw.Draw(mask).polygon([top, (top[0] + N * TW // 2, top[1] + N * TH // 2), (top[0], top[1] + N * TH), (top[0] - N * TW // 2, top[1] + N * TH // 2)], fill=255)
    sc = Image.new('RGBA', (W_H, H_H), FLOOR_BG)
    sc.paste(proj, (0, 0), mask)
    return sc


floor_only = iso_floor(tex)
floor_only.save(OUT / 'floor-6x6-projected.png')


def wall_profile(w):
    a = np.asarray(w).astype(np.float32)
    h, wd, _ = a.shape
    sk = np.zeros((h + wd // 2 + 4, wd, 4), np.float32)
    for x in range(wd):
        sh = round((x) * 0.5)
        sk[sh:sh + h, x] = a[:, x]
    al = sk[..., 3] > 128
    cols = np.flatnonzero(al.sum(0) > al.sum(0).max() * 0.9)
    mid = sk[:, cols[len(cols) // 4]: cols[3 * len(cols) // 4]]
    prof = np.median(mid, axis=1)
    return Image.fromarray(prof[:, None, :].clip(0, 255).astype(np.uint8), 'RGBA')


def wall_run(prof, run_w, height_mul=2.0, scale=1.0):
    p = np.asarray(prof).astype(np.float32)[:, 0]
    rows = np.flatnonzero(p[:, 3] > 10)
    p = p[rows[0]:rows[-1] + 1]
    n = len(p)
    cap, base_ = int(n * 0.08), int(n * 0.16)
    mid = p[cap:n - base_]
    idx = np.linspace(0, len(mid) - 1, int(len(mid) * height_mul)).round().astype(int)
    col = np.concatenate([p[:cap], mid[idx], p[n - base_:]])
    col = Image.fromarray(col[:, None, :].astype(np.uint8), 'RGBA')
    col = col.resize((1, max(1, round(col.height * scale))), Image.LANCZOS)
    c = np.asarray(col).astype(np.float32)[:, 0]
    hh = len(c)
    out = np.zeros((hh + run_w // 2 + 2, run_w, 4), np.float32)
    for x in range(run_w):
        sh = (run_w - x) // 2
        out[sh:sh + hh, x] = c
    return Image.fromarray(out.astype(np.uint8), 'RGBA')


prof = wall_profile(wall)
wscale = (TW / 2) / wall.width * 0.85
run = wall_run(prof, N * TW // 2, height_mul=2.4, scale=wscale)
run.save(OUT / 'wall-run.png')
report['wall_run'] = run.size


def walls(sc):
    left = run
    right = run.transpose(Image.FLIP_LEFT_RIGHT)
    top = grid_pos(0, 0, ox, oy)
    sc.alpha_composite(left, (top[0] - N * TW // 2, top[1] + N * TH // 2 - left.height + 2))
    sc.alpha_composite(right, (top[0], top[1] + N * TH // 2 - right.height + 2))


walled = floor_only.copy()
walls(walled)
walled.save(OUT / 'floor-wall.png')
walled_t = grid_floor(tile)
walls(walled_t)
walled_t.save(OUT / 'floor-wall-diamond-tile.png')

base = trim(key(raw('char-base')))
base.save(OUT / 'char-base.png')
base_hw = hair_width(base)
scale_base = CHAR_H / base.height
report['base'] = {'size': base.size, 'hair_w': base_hw}

sheets = {}
for name, n_expect in [('walk-se', 4), ('walk-se-v2', 4), ('sit-type', 2), ('sit-type-v2', 2), ('back-ne', 4)]:
    sh = key(raw(name))
    fr = blobs(sh)
    for i, f in enumerate(fr):
        f.save(OUT / f'{name}-f{i + 1}.png')
    hw = [hair_width(f) for f in fr]
    hs = [f.height for f in fr]
    scale = scale_base * base_hw / float(np.median(hw))
    cells = normalise(fr, scale)
    sheets[name] = cells
    report[name] = {'frames': len(fr), 'expected': n_expect, 'raw_heights': hs, 'hair_w': [round(h) for h in hw],
                    'norm_h_px': [round(h * scale) for h in hs], 'bbox_w_px': [round(f.width * scale) for f in fr]}
    strip(cells).save(OUT / f'{name}-strip.png')
    strip(cells, guides=False).save(OUT / f'{name}-sheet.png')
    gif(cells, OUT / f'{name}.gif', ms=150 if 'sit' not in name else 220)

base_cell = normalise([base], scale_base)[0]
strip([base_cell, sheets['walk-se-v2'][0], sheets['walk-se-v2'][1], sheets['sit-type-v2'][0], sheets['back-ne'][0]], bg=FLOOR_BG).save(OUT / 'identity-compare.png')


def bob(cells, dy=(0, -2)):
    out = []
    for c, d in zip(cells, dy):
        n = Image.new('RGBA', c.size, (0, 0, 0, 0))
        n.alpha_composite(c, (0, d))
        out.append(n)
    return out


c2 = blobs(key(raw('char2-turn')))
for i, f in enumerate(c2):
    f.save(OUT / f'char2-dir{i + 1}.png')
c2_scale = CHAR_H / float(np.median([f.height for f in c2]))
c2_cells = normalise(c2, c2_scale)
report['char2-turn'] = {'frames': len(c2), 'raw_heights': [f.height for f in c2]}
strip(c2_cells).save(OUT / 'char2-turn-strip.png')
mir = [c.transpose(Image.FLIP_LEFT_RIGHT) for c in (sheets['walk-se-v2'][0], sheets['back-ne'][0])]
strip([sheets['walk-se-v2'][0], mir[0], sheets['back-ne'][0], mir[1]], bg=FLOOR_BG).save(OUT / 'char1-4dir-by-mirror.png')

mock = walled.copy()
items = []


def put(im, gx, gy, dx=0, dy=0, z=0.0):
    items.append((gx + gy + z, im, gx, gy, dx, dy))


desk_s = fit(desk, 3 * TW // 2 + 6)
chair_s = fit(chair, round(TW * 0.6))
plant_s = fit(plant, round(TW * 0.62))
sit = sheets['sit-type-v2'][0]
put(plant_s, 0.55, 0.55, 0, -4)
put(plant_s, 0.55, 5.0, 0, -4)
put(chair_s, 2.0, 2.0, 0, -10)
put(sit, 2.0, 2.0, 2, -24, 0.01)
put(desk_s, 3.0, 2.6, 0, 0)
put(chair_s, 4.1, 0.9, 0, -10)
put(fit(desk, 3 * TW // 2 + 6), 5.1, 1.5, 0, 0)
put(sheets['walk-se-v2'][0], 3.4, 4.6, 0, -6)
put(sheets['back-ne'][1], 1.5, 4.0, 0, -6)
put(c2_cells[1], 4.6, 4.2, 0, -6)
put(c2_cells[3], 5.0, 3.3, 0, -6)
for _, im, gx, gy, dx, dy in sorted(items, key=lambda t: t[0]):
    px, py = grid_pos(gx, gy, ox, oy)
    mock.alpha_composite(im, (round(px - im.width / 2 + dx), round(py + TH - im.height + dy)))
mock = trim(mock.convert('RGBA'), pad=0)
mock.save(ROOT / '.cache' / 'mock-scene.png')
(OUT / 'report.json').write_text(json.dumps(report, indent=2))
print(json.dumps(report))
