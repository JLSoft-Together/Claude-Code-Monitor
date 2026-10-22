import json
import sys

from PIL import Image, ImageDraw

style = next((a.split('=', 1)[1] for a in sys.argv[1:] if a.startswith('--style=')), 'flat')
sfx = '' if style == 'flat' else style
ship = json.load(open('layouts.json'))[style].get('ship', 'apps/web/public/assets/iso/chars')
m = json.load(open(f'../../{ship}/manifest.json'))
W, H = m['frame']['w'], m['frame']['h']
only = [a for a in sys.argv[1:] if not a.startswith('--')]
for e in m['archetypes']:
    if only and e['id'] not in only:
        continue
    sh = Image.open(f'.cache/out{sfx}/{e["id"]}-atlas.png')
    a = e['anims']
    dirs = [k[5:] for k in a if k.startswith('walk_') and not k.startswith('walk_coffee')]
    walk_rows = [(f'stand_{d}', f'walk_{d}') for d in dirs]
    used = {k for r in walk_rows for k in r}
    seated = tuple(k for k in a if a[k]['anchor'] == 'seat')
    rest = tuple(k for k in a if k not in used and k not in seated)
    groups = {'walk': walk_rows, 'pose': [(walk_rows[0][0],) + seated, rest]}
    for g, rows in groups.items():
        cells = [[(k, i) for k in r if k in a for i in range(a[k]['frames'])] for r in rows]
        img = Image.new('RGBA', (W * max(len(c) for c in cells), H * len(rows)), (233, 228, 218, 255))
        for r, cs in enumerate(cells):
            for j, (k, i) in enumerate(cs):
                img.alpha_composite(sh.crop((i * W, a[k]['row'] * H, (i + 1) * W, (a[k]['row'] + 1) * H)), (j * W, r * H))
        d = ImageDraw.Draw(img)
        for r in range(len(rows)):
            for y, col in ((m['anchors']['feet'][1] - 280, (80, 160, 80)), (m['anchors']['seat'][1], (80, 120, 220)), (m['anchors']['feet'][1], (220, 80, 80))):
                d.line([(0, r * H + y), (img.width, r * H + y)], fill=col + (255,))
        img.save(f'.cache/{g}{sfx}-{e["id"]}.png')
