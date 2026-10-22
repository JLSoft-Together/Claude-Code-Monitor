import colorsys
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageOps
from scipy import ndimage

from chroma import key, blobs

DIR = Path(__file__).parent
RAW = DIR / '.cache' / 'raw'
CUT = DIR / '.cache' / 'cut'
SHIP = DIR.parent.parent / 'apps' / 'web' / 'public' / 'assets' / 'iso3d' / 'furniture'
TW, TD = 64, 44.8
SPEC = json.loads((DIR / 'layout.json').read_text(encoding='utf8'))


def cut_sheet(name):
    CUT.mkdir(parents=True, exist_ok=True)
    im = key(Image.open(RAW / name))
    parts = blobs(im, min_frac=0.004, gap=24)
    return parts


def lum(a):
    return 0.299 * a[..., 0] + 0.587 * a[..., 1] + 0.114 * a[..., 2]


def largest_bbox(mask, union=0.0):
    lab, n = ndimage.label(mask)
    if not n:
        return None
    sizes = ndimage.sum(mask, lab, range(1, n + 1))
    if union:
        keep = np.isin(lab, 1 + np.flatnonzero(sizes >= sizes.max() * union))
    else:
        keep = lab == int(np.argmax(sizes)) + 1
    ys, xs = np.nonzero(keep)
    return [int(xs.min()), int(ys.min()), int(xs.max() - xs.min() + 1), int(ys.max() - ys.min() + 1)]


def holes(alpha):
    solid = alpha > 128
    return ndimage.binary_fill_holes(solid) & ~solid & (alpha < 40)


def detect(im, kind):
    a = np.asarray(im).astype(np.float32)
    al = a[..., 3]
    rgb = a[..., :3]
    L = lum(rgb)
    if kind == 'screen':
        m = (al > 200) & (L < 75) & (rgb[..., 2] >= rgb[..., 0])
        return largest_bbox(ndimage.binary_opening(m, iterations=1))
    if kind == 'white':
        m = (al > 200) & (L > 228)
        return largest_bbox(ndimage.binary_opening(m, iterations=1))
    if kind == 'cream':
        m = (al > 200) & (L > 205) & (rgb[..., 0] - rgb[..., 2] < 45)
        return largest_bbox(ndimage.binary_opening(m, iterations=1), 0.25)
    if kind == 'mirror':
        m = (al > 200) & (rgb[..., 2] > rgb[..., 0] + 6) & (L > 120)
        return largest_bbox(ndimage.binary_opening(m, iterations=1), 0.25)
    if kind == 'inset':
        ys, xs = np.nonzero(al > 128)
        x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
        w, h = x1 - x0, y1 - y0
        return [int(x0 + w * 0.07), int(y0 + h * 0.2), int(w * 0.86), int(h * 0.6)]
    if kind == 'hole':
        return largest_bbox(holes(al), 0.25)
    return None


def recolor(im, mode):
    a = np.asarray(im).astype(np.float32) / 255.0
    rgb = a[..., :3]
    mx, mn = rgb.max(-1), rgb.min(-1)
    sat = np.where(mx > 0, (mx - mn) / np.maximum(mx, 1e-6), 0)
    hsv = np.vectorize(colorsys.rgb_to_hsv, otypes=[float, float, float])
    h, s, v = hsv(rgb[..., 0], rgb[..., 1], rgb[..., 2])
    blue = (h > 0.52) & (h < 0.70) & (sat > 0.12) & (a[..., 3] > 0)
    if mode == 'red':
        h2, s2, v2 = np.where(blue, 0.995, h), np.where(blue, np.minimum(s * 1.25, 1), s), np.where(blue, v * 0.92, v)
    elif mode == 'green':
        h2, s2, v2 = np.where(blue, 0.27, h), np.where(blue, s * 0.95, s), np.where(blue, v * 0.88, v)
    elif mode == 'gray':
        h2, s2, v2 = h, np.where(blue, s * 0.1, s), np.where(blue, v * 0.86, v)
    else:
        h2, s2, v2 = h, np.where(blue, s * 0.12, s), np.where(blue, v * 0.42, v)
    back = np.vectorize(colorsys.hsv_to_rgb, otypes=[float, float, float])
    r, g, b = back(h2, s2, v2)
    out = np.dstack([r, g, b, a[..., 3]])
    return Image.fromarray((np.clip(out, 0, 1) * 255).astype(np.uint8), 'RGBA')


def despill(im):
    a = np.asarray(im).astype(np.float32)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    m = np.clip(np.minimum(r, b) - g, 0, None)
    a[..., 0] -= m * 0.9
    a[..., 2] -= m * 0.9
    return Image.fromarray(np.clip(a, 0, 255).astype(np.uint8), 'RGBA')


def tint_holes(im, rgba=(200, 225, 240, 46)):
    a = np.asarray(im).copy()
    hm = holes(a[..., 3].astype(np.float32))
    a[hm] = rgba
    return Image.fromarray(a, 'RGBA')


def place_floor(obj, it):
    fw, fh = it['fp']
    if 'size' in it:
        o = obj.resize(tuple(it['size']), Image.LANCZOS)
    else:
        s = it['px'] / obj.height if 'px' in it else fw * TW * it['fill'] / obj.width
        o = obj.resize((max(1, round(obj.width * s)), max(1, round(obj.height * s))), Image.LANCZOS)
    cx = o.width / 2 + it.get('dx', 0) * TW
    ax_f = cx - fw * TW / 2
    ay_f = o.height + it.get('sy', 0) * TD
    left = min(0, ax_f)
    top = min(0, ay_f - fh * TD)
    right = max(o.width, ax_f + fw * TW)
    bottom = max(o.height, ay_f)
    pad = 2
    W = int(np.ceil(right - left)) + 2 * pad
    H = int(np.ceil(bottom - top)) + 2 * pad
    ox, oy = pad - int(np.floor(left)), pad - int(np.floor(top))
    canvas = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    canvas.alpha_composite(o, (ox, oy))
    anchor = [round(ax_f + ox), round(ay_f + oy)]
    return canvas, anchor, (ox, oy, o.width, o.height)


def place_wall(obj, it):
    bw, bh = it['box']
    s = min(bw / obj.width, bh / obj.height)
    o = obj.resize((max(1, round(obj.width * s)), max(1, round(obj.height * s))), Image.LANCZOS)
    pad = 2
    elev = it.get('elev', 0)
    W = o.width + 2 * pad
    H = o.height + 2 * pad + elev
    canvas = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    canvas.alpha_composite(o, (pad, pad))
    anchor = [W // 2, pad + o.height + elev]
    return canvas, anchor, (pad, pad, o.width, o.height)


def front_of(img, it, box):
    f = it.get('front')
    if not f:
        return None
    ox, oy, ow, oh = box
    mask = Image.new('L', img.size, 0)
    d = ImageDraw.Draw(mask)
    if f == 'all':
        d.rectangle([0, 0, img.width, img.height], fill=255)
    elif f.startswith('rows:'):
        t0, t1 = [float(v) for v in f[5:].split(',')]
        d.rectangle([0, oy + t0 * oh, img.width, oy + t1 * oh], fill=255)
    elif f == 'stall':
        a = np.asarray(img).astype(np.float32)
        oak = (a[..., 3] > 200) & (a[..., 0] > 150) & (a[..., 0] - a[..., 2] > 85) & (a[..., 1] > 110) & (a[..., 1] < 200)
        rows = np.nonzero(oak.sum(1) > 6)[0]
        y0 = int(rows.min()) - 2 if len(rows) else int(oy + 0.5 * oh)
        d.rectangle([0, y0, img.width, img.height], fill=255)
    elif f.startswith('poly:'):
        pts = json.loads(f[5:])
        d.polygon([(ox + x * ow, oy + y * oh) for x, y in pts], fill=255)
    out = img.copy()
    out.putalpha(Image.fromarray(np.minimum(np.asarray(img.getchannel('A')), np.asarray(mask))))
    return out


def save(img, name):
    img.save(SHIP / name, 'WEBP', quality=90, alpha_quality=100, method=6)


def main():
    SHIP.mkdir(parents=True, exist_ok=True)
    items = {}
    debug = {}
    elevator = {}
    for sheet, entries in SPEC['sheets'].items():
        parts = cut_sheet(sheet)
        if len(parts) != len(entries):
            print(f'WARN {sheet}: {len(parts)} parts, expected {len(entries)}', [p.size for p in parts])
        for obj, it in zip(parts, entries):
            if it is None:
                continue
            obj.save(CUT / f"{it['key'].replace(':', '-')}.png")
            variants = [(it['key'], obj, it)]
            for extra in it.get('recolor', []):
                variants.append((f"{it['base']}:{extra}", recolor(obj, extra), it))
            if it.get('mirror'):
                variants.append((it['mirror'], ImageOps.mirror(obj), {**it, 'mirrored': True}))
            for k, o, spec in variants:
                if spec.get('despill'):
                    o = despill(o)
                if spec.get('glass'):
                    o = tint_holes(o)
                wall = k.startswith('wall:')
                img, anchor, box = (place_wall if wall else place_floor)(o, spec)
                if spec.get('mirrored') and spec.get('front'):
                    spec = {**spec, 'front': None}
                fname = k.replace(':', '-') + '.webp'
                entry = {'file': fname}
                if not wall:
                    entry['footprint'] = spec['fp']
                entry['anchor'] = anchor
                entry['height'] = spec.get('h') or round(box[3] / TW, 2)
                fr = front_of(img, spec, box)
                if fr is not None:
                    fn = k.replace(':', '-') + '.front.webp'
                    save(fr, fn)
                    entry['front'] = fn
                rects = {}
                for rn, how in spec.get('rects', {}).items():
                    r = detect(img, how)
                    if r:
                        rects[rn] = r
                if rects:
                    entry['rects'] = rects
                if k.startswith('wall:elevator'):
                    elevator[k] = (img, entry)
                    continue
                save(img, fname)
                items[k] = entry
                debug[k] = (img, entry)
    if 'wall:elevator:closed' in elevator and 'wall:elevator:open' in elevator:
        ci, ce = elevator['wall:elevator:closed']
        oi, oe = elevator['wall:elevator:open']
        W, H = max(ci.width, oi.width), max(ci.height, oi.height)
        cc = Image.new('RGBA', (W, H)); cc.alpha_composite(ci, ((W - ci.width) // 2, H - ci.height))
        oc = Image.new('RGBA', (W, H)); oc.alpha_composite(oi, ((W - oi.width) // 2, H - oi.height))
        anchor = [W // 2, H - (ci.height - ce['anchor'][1])]
        diff = np.abs(np.asarray(cc).astype(np.int32) - np.asarray(oc).astype(np.int32))[..., :3].sum(-1) > 60
        diff = ndimage.binary_opening(diff, iterations=2)
        dx, dy, dw, dh = largest_bbox(diff)
        leaves = cc.crop((dx, dy, dx + dw, dy + dh))
        half = dw // 2
        L = leaves.crop((0, 0, half, dh))
        R = leaves.crop((half, 0, dw, dh))
        for st in range(5):
            frac = st / 4
            fr = oc.copy()
            layer = Image.new('RGBA', (dw, dh))
            sh = round(half * frac * 0.96)
            if st == 0:
                layer = leaves
            elif sh < half:
                layer.alpha_composite(L.crop((sh, 0, half, dh)), (0, 0))
                layer.alpha_composite(R.crop((0, 0, half - sh, dh)), (half + sh, 0))
            fr.alpha_composite(layer, (dx, dy))
            k = f'wall:elevator:{st}'
            fname = f'wall-elevator-{st}.webp'
            save(fr, fname)
            e = {'file': fname, 'anchor': anchor, 'height': ce['height'], 'rects': {'door': [dx, dy, dw, dh]}}
            items[k] = e
            debug[k] = (fr, e)
        items['wall:elevator'] = {**items['wall:elevator:0'], 'file': 'wall-elevator-0.webp'}
    for alias, src in SPEC.get('aliases', {}).items():
        if src in items:
            items[alias] = items[src]
    manifest = {'version': 1, 'scale': 2, 'notes': SPEC['notes'], 'items': dict(sorted(items.items()))}
    (SHIP / 'manifest.json').write_text(json.dumps(manifest, indent=1) + '\n', encoding='utf8')
    contact(debug)
    print(len(items), 'items')


def contact(debug):
    keys = sorted(debug)
    cols = 8
    cw, ch = 260, 300
    rows = (len(keys) + cols - 1) // cols
    sheet = Image.new('RGBA', (cols * cw, rows * ch), (236, 232, 224, 255))
    d = ImageDraw.Draw(sheet)
    for i, k in enumerate(keys):
        x0, y0 = (i % cols) * cw, (i // cols) * ch
        bx, by = x0 + cw // 2, y0 + ch - 40
        for gx in range(-2, 3):
            d.line([(bx + gx * TW, y0 + 20), (bx + gx * TW, y0 + ch - 22)], fill=(214, 208, 198, 255))
        for gy in range(0, 6):
            d.line([(x0, by - gy * TD), (x0 + cw, by - gy * TD)], fill=(214, 208, 198, 255))
    for i, k in enumerate(keys):
        img, e = debug[k]
        x0, y0 = (i % cols) * cw, (i // cols) * ch
        bx, by = x0 + cw // 2, y0 + ch - 40
        ax, ay = e['anchor']
        if 'footprint' in e:
            fw, fh = e['footprint']
            px, py = bx - round(fw * TW / 2), by
        else:
            px, py = bx, by
        sheet.alpha_composite(img, (px - ax, py - ay))
        if 'front' in e:
            fr = Image.open(SHIP / e['front'])
            tint = Image.new('RGBA', fr.size, (255, 120, 0, 0))
            ta = np.asarray(fr.getchannel('A')) // 3
            tint.putalpha(Image.fromarray(ta.astype(np.uint8)))
            sheet.alpha_composite(tint, (px - ax, py - ay))
        if 'footprint' in e:
            d.rectangle([px, py - fh * TD, px + fw * TW, py], outline=(220, 30, 30, 255), width=1)
        else:
            d.line([(px - 70, py), (px + 70, py)], fill=(220, 30, 30, 255), width=1)
        for rn, (rx, ry, rw, rh) in e.get('rects', {}).items():
            d.rectangle([px - ax + rx, py - ay + ry, px - ax + rx + rw, py - ay + ry + rh], outline=(0, 160, 255, 255))
        d.ellipse([px - 3, py - 3, px + 3, py + 3], fill=(0, 90, 255, 255))
        d.text((x0 + 4, y0 + ch - 18), k, fill=(30, 30, 30, 255))
    sheet.convert('RGB').save(DIR / '.cache' / 'contact-sheet.png')


if __name__ == '__main__':
    main()
