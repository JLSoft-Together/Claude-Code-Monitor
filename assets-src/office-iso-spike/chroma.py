import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

LO, HI = 20.0, None


def key(img, lo=LO, hi=HI, min_island=400):
    lo = LO if lo is None else lo
    a = np.asarray(img.convert('RGB')).astype(np.float32)
    corner = np.concatenate([a[:16, :16].reshape(-1, 3), a[:16, -16:].reshape(-1, 3), a[-16:, :16].reshape(-1, 3), a[-16:, -16:].reshape(-1, 3)])
    bg = np.median(corner, axis=0)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    m = np.minimum(r, b) - g
    if hi is None:
        hi = float(min(bg[0], bg[2]) - bg[1]) - 8.0
    alpha = np.clip((hi - m) / (hi - lo), 0.0, 1.0)
    rel = m / np.maximum(np.minimum(r, b), 1.0)
    alpha = np.where((rel > 0.55) & (np.abs(r - b) < 60), np.minimum(alpha, np.clip((0.75 - rel) / 0.2, 0, 1)), alpha)
    solid = alpha > 0.5
    lab, n = ndimage.label(solid)
    if n:
        sizes = ndimage.sum(solid, lab, range(1, n + 1))
        keep = np.isin(lab, 1 + np.flatnonzero(sizes >= min_island))
        near = ndimage.binary_dilation(keep, iterations=3)
        alpha = np.where(near, alpha, 0.0)
        alpha = np.where(ndimage.binary_fill_holes(keep) & ~(m > hi - 5), np.maximum(alpha, keep.astype(np.float32)), alpha)
    safe = np.maximum(alpha, 1e-3)[..., None]
    fg = (a - (1.0 - alpha[..., None]) * bg) / safe
    fg = np.clip(fg, 0, 255)
    edge = ndimage.binary_dilation(alpha < 0.98, iterations=2) & (alpha > 0)
    spill = np.clip(np.minimum(fg[..., 0], fg[..., 2]) - fg[..., 1], 0, None) * edge
    fg[..., 0] -= spill * 1.0
    fg[..., 2] -= spill * 1.0
    out = np.dstack([np.clip(fg, 0, 255), alpha * 255]).astype(np.uint8)
    out[alpha <= 0.02] = 0
    return Image.fromarray(out, 'RGBA')


def trim(im, pad=2):
    bb = im.getchannel('A').point(lambda v: 255 if v > 8 else 0).getbbox()
    if not bb:
        return im
    x0, y0, x1, y1 = bb
    return im.crop((max(0, x0 - pad), max(0, y0 - pad), min(im.width, x1 + pad), min(im.height, y1 + pad)))


def blobs(im, min_frac=0.02, gap=6):
    al = np.asarray(im.getchannel('A')) > 40
    cols = al.sum(0) > 0
    runs, start = [], None
    for x, v in enumerate(np.append(cols, False)):
        if v and start is None:
            start = x
        elif not v and start is not None:
            runs.append([start, x])
            start = None
    merged = []
    for r in runs:
        if merged and r[0] - merged[-1][1] < gap:
            merged[-1][1] = r[1]
        else:
            merged.append(r)
    total = al.sum()
    res = []
    for x0, x1 in merged:
        if al[:, x0:x1].sum() < total * min_frac:
            continue
        sub = im.crop((x0, 0, x1, im.height))
        bb = sub.getchannel('A').point(lambda v: 255 if v > 8 else 0).getbbox()
        res.append(im.crop((x0 + bb[0], bb[1], x0 + bb[2], bb[3])))
    return res


if __name__ == '__main__':
    for p in sys.argv[1:]:
        o = Path(p).with_suffix('.alpha.png')
        trim(key(Image.open(p))).save(o)
        print(o)
