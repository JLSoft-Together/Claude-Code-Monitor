import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

DIR = Path(__file__).parent
sys.path.insert(0, str(DIR.parent / 'office-3d-furniture'))
from chroma import key
from process import place_floor, place_wall, despill, TW, TD

RAW = DIR / '.cache' / 'raw'
CUT = DIR / '.cache' / 'cut'
SHIP = DIR.parent.parent / 'apps' / 'web' / 'public' / 'assets' / 'iso3d' / 'seasonal'
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


def save(img, path):
    img.save(path, 'WEBP', quality=92, alpha_quality=100, method=6)


def main():
    SHIP.mkdir(parents=True, exist_ok=True)
    CUT.mkdir(parents=True, exist_ok=True)
    items, debug = {}, {}
    for sheet, entries in SPEC['sheets'].items():
        parts = split(key(Image.open(RAW / sheet), min_island=150), len(entries))
        if len(parts) != len(entries):
            print(f'WARN {sheet}: {len(parts)} parts, expected {len(entries)}')
        for obj, it in zip(parts, entries):
            if it is None:
                continue
            obj = despill(obj)
            obj.save(CUT / f"{it['key']}.png")
            wall = it.get('wall', False)
            img, anchor, box = (place_wall if wall else place_floor)(obj, it)
            fname = f"{it['key']}.webp"
            save(img, SHIP / fname)
            items[it['key']] = {'file': fname, 'anchor': anchor, 'footprint': it['fp'], 'wall': wall}
            debug[it['key']] = (img, items[it['key']])
    manifest = {'version': 1, 'scale': 2, 'items': dict(sorted(items.items()))}
    (SHIP / 'manifest.json').write_text(json.dumps(manifest, indent=1) + '\n', encoding='utf8')
    contact(debug)
    print(len(items), 'items')


def contact(debug):
    keys = list(debug)
    cw, ch = 220, 260
    sheet = Image.new('RGBA', (len(keys) * cw, ch), (236, 232, 224, 255))
    d = ImageDraw.Draw(sheet)
    for i, k in enumerate(keys):
        img, e = debug[k]
        x0 = i * cw
        bx, by = x0 + cw // 2, ch - 40
        for gx in range(-1, 2):
            d.line([(bx + gx * TW, 20), (bx + gx * TW, ch - 22)], fill=(214, 208, 198, 255))
        for gy in range(0, 5):
            d.line([(x0, by - gy * TD), (x0 + cw, by - gy * TD)], fill=(214, 208, 198, 255))
        ax, ay = e['anchor']
        if e['wall']:
            d.rectangle([x0, by - 96, x0 + cw, by], fill=(222, 214, 200, 255))
            px, py = bx, by
        else:
            px, py = bx - TW // 2, by
        sheet.alpha_composite(img, (px - ax, py - ay))
        if e['wall']:
            d.line([(px - 70, py), (px + 70, py)], fill=(220, 30, 30, 255))
        else:
            fw, fh = e['footprint']
            d.rectangle([px, py - fh * TD, px + fw * TW, py], outline=(220, 30, 30, 255))
        d.ellipse([px - 3, py - 3, px + 3, py + 3], fill=(0, 90, 255, 255))
        d.text((x0 + 4, ch - 18), f"{k} {img.width}x{img.height}", fill=(30, 30, 30, 255))
    big = sheet.resize((sheet.width * 2, sheet.height * 2), Image.NEAREST)
    big.convert('RGB').save(DIR / '.cache' / 'contact-sheet.png')


if __name__ == '__main__':
    main()
