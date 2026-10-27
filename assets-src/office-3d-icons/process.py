import json

import numpy as np
import sys
from pathlib import Path

from PIL import Image, ImageDraw

DIR = Path(__file__).parent
sys.path.insert(0, str(DIR.parent / 'office-3d-furniture'))
from chroma import key
from process import despill

RAW = DIR / '.cache' / 'raw'
CUT = DIR / '.cache' / 'cut'
HI = DIR / 'hi'
SHIP = DIR.parent.parent / 'apps' / 'web' / 'public' / 'assets' / 'iso3d' / 'icons'
SPEC = json.loads((DIR / 'layout.json').read_text(encoding='utf8'))


def split(im, n, gap=6):
    al = np.asarray(im.getchannel('A')) > 40
    cols = np.append(al.sum(0) > 0, False)
    runs, start = [], None
    for x, v in enumerate(cols):
        if v and start is None:
            start = x
        elif not v and start is not None:
            runs.append([start, x])
            start = None
    runs = [r for r in runs if al[:, r[0]:r[1]].sum() > 30]
    while len(runs) > n:
        i = min(range(len(runs) - 1), key=lambda j: runs[j + 1][0] - runs[j][1])
        runs[i] = [runs[i][0], runs[i + 1][1]]
        del runs[i + 1]
    out = []
    for x0, x1 in runs:
        sub = im.crop((x0, 0, x1, im.height))
        bb = sub.getchannel('A').point(lambda v: 255 if v > 8 else 0).getbbox()
        out.append(sub.crop(bb))
    return out


def fit(im, box):
    s = box / max(im.width, im.height)
    return im.resize((max(1, round(im.width * s)), max(1, round(im.height * s))), Image.LANCZOS)


def save(img, path):
    img.save(path, 'WEBP', quality=92, alpha_quality=100, method=6)


def main():
    for d in (SHIP, CUT, HI):
        d.mkdir(parents=True, exist_ok=True)
    items, shown = {}, []
    for sheet, ids in SPEC['sheets'].items():
        parts = split(key(Image.open(RAW / sheet), min_island=150), len(ids))
        if len(parts) != len(ids):
            print(f'WARN {sheet}: {len(parts)} parts, expected {len(ids)}')
        for obj, k in zip(parts, ids):
            if k is None:
                continue
            obj = despill(obj)
            obj.save(CUT / f'{k}.png')
            box = SPEC['box'].get(k, SPEC['defaultBox'])
            img = fit(obj, box)
            save(img, SHIP / f'{k}.webp')
            save(fit(obj, box * 2), HI / f'{k}.webp')
            items[k] = {'file': f'{k}.webp', 'size': [img.width, img.height], 'anchor': [round(img.width / 2), img.height]}
            shown.append((k, img))
    manifest = {'version': 1, 'scale': 2, 'items': dict(sorted(items.items()))}
    (SHIP / 'manifest.json').write_text(json.dumps(manifest, indent=1) + '\n', encoding='utf8')
    contact(shown)
    print(len(items), 'items')


def contact(shown):
    cw, ch = 64, 70
    cols = 8
    rows = (len(shown) + cols - 1) // cols
    out = Image.new('RGBA', (cols * cw * 3, rows * ch * 2 + rows * 40), (0, 0, 0, 255))
    d = ImageDraw.Draw(out)
    bgs = [(236, 232, 224, 255), (210, 196, 170, 255), (44, 48, 58, 255)]
    for i, (k, img) in enumerate(shown):
        r, c = divmod(i, cols)
        for j, bg in enumerate(bgs):
            x0, y0 = c * cw * 3 + j * cw, r * (ch * 2 + 40)
            d.rectangle([x0, y0, x0 + cw - 1, y0 + ch * 2 + 39], fill=bg)
            ax = x0 + cw // 2
            out.alpha_composite(img, (ax - img.width // 2, y0 + ch - 6 - img.height))
            v = img.resize((max(1, img.width // 2), max(1, img.height // 2)), Image.LANCZOS)
            out.alpha_composite(v, (ax - v.width // 2, y0 + ch + 34 - v.height))
            d.line([(ax - 4, y0 + ch - 6), (ax + 4, y0 + ch - 6)], fill=(220, 30, 30, 255))
        d.text((c * cw * 3 + 3, r * (ch * 2 + 40) + ch * 2 + 26), k, fill=(30, 30, 30, 255))
    out.resize((out.width * 2, out.height * 2), Image.NEAREST).convert('RGB').save(DIR / '.cache' / 'contact-sheet.png')


if __name__ == '__main__':
    main()
