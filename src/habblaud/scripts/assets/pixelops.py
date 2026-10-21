"""Operações de pixel art usadas no pós-processamento (Pillow + numpy, sem estado).

- chroma key com cor de fundo estimada pela moldura da imagem;
- detecção da grade de "pixels grandes" que a IA desenhou e desampliação para a resolução nativa;
- redução por moda (sem misturar cores) ou por área, quantização sem dithering, alfa binário;
- contorno de 1px, remoção de pixels isolados e ampliação NEAREST.
"""

from __future__ import annotations

from collections import deque

import numpy as np
from PIL import Image, ImageEnhance


# ---------------------------------------------------------------------------
# utilidades de cor


def hex_rgb(value: str) -> tuple[int, int, int]:
    value = value.lstrip("#")
    return int(value[0:2], 16), int(value[2:4], 16), int(value[4:6], 16)


def magenta_mask(rgb: np.ndarray) -> np.ndarray:
    """True onde o pixel é fundo de chroma key.

    A cor de referência é a mediana da moldura da imagem (a IA nem sempre acerta o #FF00FF exato);
    soma-se a isso qualquer tom claramente magenta (franja rosada do anti-aliasing).
    """
    frame = np.concatenate([rgb[:4].reshape(-1, 3), rgb[-4:].reshape(-1, 3),
                            rgb[:, :4].reshape(-1, 3), rgb[:, -4:].reshape(-1, 3)])
    ref = np.median(frame, axis=0)
    dist = np.sqrt(((rgb.astype(np.float64) - ref) ** 2).sum(axis=2))
    r, g, b = (rgb[..., i].astype(np.int16) for i in range(3))
    magenta = (r - g > 90) & (b - g > 90) & (np.abs(r - b) < 80)
    return (dist < 48) | magenta


def remove_specks(fg: np.ndarray, min_area: int) -> np.ndarray:
    """Remove ilhas pequenas de primeiro plano (sujeira que sobra do chroma key)."""
    h, w = fg.shape
    seen = np.zeros_like(fg, dtype=bool)
    keep = np.zeros_like(fg, dtype=bool)
    ys, xs = np.nonzero(fg)
    for y0, x0 in zip(ys, xs):
        if seen[y0, x0]:
            continue
        comp = []
        queue = deque([(y0, x0)])
        seen[y0, x0] = True
        while queue:
            y, x = queue.popleft()
            comp.append((y, x))
            for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                ny, nx = y + dy, x + dx
                if 0 <= ny < h and 0 <= nx < w and fg[ny, nx] and not seen[ny, nx]:
                    seen[ny, nx] = True
                    queue.append((ny, nx))
        if len(comp) >= min_area:
            cy, cx = zip(*comp)
            keep[list(cy), list(cx)] = True
    return keep


def bbox(mask: np.ndarray) -> tuple[int, int, int, int]:
    ys, xs = np.nonzero(mask)
    return int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1


def crop_to_aspect(img: Image.Image, w: int, h: int) -> Image.Image:
    """Corta ao centro para a proporção w:h."""
    target = w / h
    iw, ih = img.size
    if iw / ih > target:
        nw = round(ih * target)
        x0 = (iw - nw) // 2
        return img.crop((x0, 0, x0 + nw, ih))
    nh = round(iw / target)
    y0 = (ih - nh) // 2
    return img.crop((0, y0, iw, y0 + nh))


# ---------------------------------------------------------------------------
# redução e paleta


def build_palette(rgb: np.ndarray, mask: np.ndarray | None, colors: int, balance: float = 0.0) -> np.ndarray:
    """Paleta (até `colors` x 3) por median cut + k-means sobre os pixels de primeiro plano.

    `balance` > 0 reamostra os pixels com peso 1 / frequência^balance (por faixas de cor), para
    que cores de área pequena porém importantes (verde das plantas, telas) não sumam da paleta.
    """
    pixels = rgb[mask] if mask is not None else rgb.reshape(-1, 3)
    rng = np.random.default_rng(7)
    if balance > 0:
        bins = (pixels // 16).astype(np.int32)
        key = bins[:, 0] * 256 + bins[:, 1] * 16 + bins[:, 2]
        _, inverse, counts = np.unique(key, return_inverse=True, return_counts=True)
        weights = 1.0 / counts[inverse] ** balance
        pixels = pixels[rng.choice(len(pixels), min(200_000, len(pixels)), replace=True, p=weights / weights.sum())]
    elif len(pixels) > 400_000:
        pixels = pixels[rng.choice(len(pixels), 400_000, replace=False)]
    side = int(np.ceil(np.sqrt(len(pixels))))
    pad = np.zeros((side * side, 3), dtype=np.uint8)
    pad[: len(pixels)] = pixels
    pad[len(pixels):] = pixels[0]
    strip = Image.fromarray(pad.reshape(side, side, 3), "RGB")
    q = strip.quantize(colors=colors, method=Image.Quantize.MEDIANCUT, kmeans=4, dither=Image.Dither.NONE)
    pal = np.array(q.getpalette()[: colors * 3], dtype=np.int32).reshape(-1, 3)
    used = np.unique(np.array(q))
    return pal[used]


def nearest_index(rgb: np.ndarray, palette: np.ndarray) -> np.ndarray:
    """Índice da cor mais próxima da paleta (distância com pesos perceptuais simples)."""
    weights = np.array([0.30, 0.59, 0.11]) * 3
    flat = rgb.reshape(-1, 3).astype(np.int32)
    out = np.empty(len(flat), dtype=np.int32)
    for start in range(0, len(flat), 200_000):
        chunk = flat[start:start + 200_000]
        d = (((chunk[:, None, :] - palette[None, :, :]) ** 2) * weights).sum(axis=2)
        out[start:start + 200_000] = d.argmin(axis=1)
    return out.reshape(rgb.shape[:2])


def cell_edges(size: int, cells: int) -> np.ndarray:
    return np.linspace(0, size, cells + 1).round().astype(int)


def _comb_scores(rgb: np.ndarray, axis: int, periods: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Para cada período candidato: quanto um pente periódico coincide com as bordas de cor (e a fase)."""
    diff = np.abs(np.diff(rgb.astype(np.int32), axis=axis)).sum(axis=2)
    signal = diff.sum(axis=0) if axis == 1 else diff.sum(axis=1)
    signal = signal / (signal.mean() + 1e-9)
    n = len(signal)
    scores = np.zeros(len(periods))
    phases = np.zeros(len(periods))
    for i, period in enumerate(periods):
        ks = np.arange(0, n / period)
        for phase in np.arange(0, period, 0.25):
            pos = np.round(phase + ks * period).astype(int)
            s = signal[pos[pos < n]].mean()
            if s > scores[i]:
                scores[i], phases[i] = s, phase
    return scores, phases


def grid_period(rgb: np.ndarray, lo: float = 4.0, hi: float = 48.0) -> tuple[float, float, float]:
    """Período (px) da grade de "pixels grandes" desenhada pela IA e as fases em x e y.

    Pixels são quadrados, então o período é um só (soma das pontuações dos dois eixos).
    Múltiplos do período verdadeiro também pontuam alto; por isso, a partir do melhor período,
    escolhe-se o menor divisor inteiro dele que ainda tenha >= 70% da pontuação.
    """
    periods = np.arange(lo, hi, 0.02)
    sx, phx = _comb_scores(rgb, 1, periods)
    sy, phy = _comb_scores(rgb, 0, periods)
    total = sx + sy
    best = int(total.argmax())
    chosen = best
    for k in range(8, 1, -1):
        near = np.nonzero(np.abs(periods - periods[best] / k) < 0.15)[0]
        if len(near) == 0:
            continue
        cand = near[total[near].argmax()]
        if total[cand] >= 0.7 * total[best]:
            chosen = int(cand)
            break
    return float(periods[chosen]), float(phx[chosen]), float(phy[chosen])


def unscale(rgb: np.ndarray, mask: np.ndarray | None = None) -> tuple[np.ndarray, np.ndarray | None, float]:
    """Desfaz a ampliação da pixel art gerada: amostra cada bloco da grade detectada pela moda do miolo.

    Retorna (rgb nativo, máscara nativa ou None, período horizontal).
    """
    px, phx, phy = grid_period(rgb)
    py = px
    h, w = rgb.shape[:2]
    # bordas dos blocos: fase + k * período (+1 porque a diferença k está entre k e k+1)
    xs = np.unique(np.clip(np.round(np.arange(phx + 1 - px * np.ceil(phx / px), w + px, px)).astype(int), 0, w))
    ys = np.unique(np.clip(np.round(np.arange(phy + 1 - py * np.ceil(phy / py), h + py, py)).astype(int), 0, h))
    out = np.zeros((len(ys) - 1, len(xs) - 1, 3), dtype=np.uint8)
    out_mask = np.zeros(out.shape[:2], dtype=bool) if mask is not None else None
    for j in range(len(ys) - 1):
        for i in range(len(xs) - 1):
            y0, y1, x0, x1 = ys[j], ys[j + 1], xs[i], xs[i + 1]
            # miolo do bloco (evita a franja de interpolação nas bordas)
            my, mx = max(0, (y1 - y0) // 4), max(0, (x1 - x0) // 4)
            block = rgb[y0 + my:y1 - my or None, x0 + mx:x1 - mx or None].reshape(-1, 3)
            if block.size == 0:
                block = rgb[y0:y1, x0:x1].reshape(-1, 3)
            if out_mask is not None:
                mblock = mask[y0 + my:y1 - my or None, x0 + mx:x1 - mx or None].reshape(-1)
                if mblock.size == 0:
                    mblock = mask[y0:y1, x0:x1].reshape(-1)
                out_mask[j, i] = mblock.mean() >= 0.5
                if out_mask[j, i]:
                    block = block[mblock]
            keys, counts = np.unique(block // 8, axis=0, return_counts=True)
            winner = keys[counts.argmax()]
            sel = np.all(block // 8 == winner, axis=1)
            out[j, i] = block[sel].mean(axis=0).astype(np.uint8)
    return out, out_mask, px


def downscale_mode(rgb: np.ndarray, mask: np.ndarray, w: int, h: int, palette: np.ndarray,
                   dark_bias: float = 0.0) -> tuple[np.ndarray, np.ndarray]:
    """Redução por moda: cada célula recebe a cor de paleta mais frequente (sem misturar cores).

    `dark_bias` > 0 favorece tons escuros (preserva contornos finos que ocupam pouco da célula).
    Retorna (rgb w x h, alfa binário).
    """
    idx = nearest_index(rgb, palette)
    lum = palette @ np.array([0.30, 0.59, 0.11])
    bias = 1.0 + dark_bias * (1.0 - lum / 255.0) ** 2
    xs, ys = cell_edges(rgb.shape[1], w), cell_edges(rgb.shape[0], h)
    out = np.zeros((h, w, 3), dtype=np.uint8)
    alpha = np.zeros((h, w), dtype=bool)
    k = len(palette)
    for cy in range(h):
        for cx in range(w):
            m = mask[ys[cy]:ys[cy + 1], xs[cx]:xs[cx + 1]]
            if m.size == 0 or m.mean() < 0.5:
                continue
            cell = idx[ys[cy]:ys[cy + 1], xs[cx]:xs[cx + 1]][m]
            votes = np.bincount(cell, minlength=k) * bias
            out[cy, cx] = palette[int(votes.argmax())]
            alpha[cy, cx] = True
    return out, alpha


def downscale_box(rgb: np.ndarray, mask: np.ndarray, w: int, h: int) -> tuple[np.ndarray, np.ndarray]:
    """Redução por área (média), ponderada pela máscara para não puxar a cor do fundo."""
    m = mask.astype(np.float64)
    weighted = rgb.astype(np.float64) * m[..., None]
    xs, ys = cell_edges(rgb.shape[1], w), cell_edges(rgb.shape[0], h)
    out = np.zeros((h, w, 3), dtype=np.uint8)
    alpha = np.zeros((h, w), dtype=bool)
    for cy in range(h):
        for cx in range(w):
            mm = m[ys[cy]:ys[cy + 1], xs[cx]:xs[cx + 1]]
            cov = mm.mean() if mm.size else 0.0
            if cov < 0.5:
                continue
            s = weighted[ys[cy]:ys[cy + 1], xs[cx]:xs[cx + 1]].sum(axis=(0, 1)) / mm.sum()
            out[cy, cx] = np.clip(s, 0, 255).astype(np.uint8)
            alpha[cy, cx] = True
    return out, alpha


def quantize(rgb: np.ndarray, alpha: np.ndarray, colors: int, balance: float = 0.0) -> np.ndarray:
    """Quantiza para no máximo `colors` cores (sem dithering), considerando só pixels opacos."""
    if alpha.sum() == 0:
        return rgb
    palette = build_palette(rgb, alpha, colors, balance)
    return palette[nearest_index(rgb, palette)].astype(np.uint8)


def merge_similar(rgb: np.ndarray, alpha: np.ndarray, min_dist: float) -> np.ndarray:
    """Funde cores quase iguais (distância RGB < `min_dist`) na mais frequente delas.

    O k-means às vezes divide uma área chapada (o contorno, a sombra da fachada) em dois tons
    indistinguíveis, que só viram ruído na pixel art; esta etapa devolve um tom por material.
    """
    if alpha.sum() == 0:
        return rgb
    colors, inverse, counts = np.unique(rgb[alpha], axis=0, return_inverse=True, return_counts=True)
    target = np.arange(len(colors))
    kept: list[int] = []
    for i in np.argsort(-counts, kind="stable"):
        near = [k for k in kept if np.linalg.norm(colors[k].astype(float) - colors[i]) < min_dist]
        if near:
            target[i] = near[0]
        else:
            kept.append(int(i))
    out = rgb.copy()
    out[alpha] = colors[target[inverse.reshape(-1)]]
    return out


def enhance(rgb: np.ndarray, saturation: float, contrast: float) -> np.ndarray:
    img = Image.fromarray(rgb, "RGB")
    if saturation != 1.0:
        img = ImageEnhance.Color(img).enhance(saturation)
    if contrast != 1.0:
        img = ImageEnhance.Contrast(img).enhance(contrast)
    return np.array(img)


def add_outline(rgba: np.ndarray, color: str) -> np.ndarray:
    """Contorno externo de 1px (vizinhança 4) em volta dos pixels opacos."""
    a = rgba[..., 3] > 0
    grown = a.copy()
    grown[1:, :] |= a[:-1, :]
    grown[:-1, :] |= a[1:, :]
    grown[:, 1:] |= a[:, :-1]
    grown[:, :-1] |= a[:, 1:]
    ring = grown & ~a
    out = rgba.copy()
    out[ring] = (*hex_rgb(color), 255)
    return out


def to_rgba(rgb: np.ndarray, alpha: np.ndarray) -> np.ndarray:
    out = np.zeros((*rgb.shape[:2], 4), dtype=np.uint8)
    out[..., :3] = rgb
    out[..., 3] = np.where(alpha, 255, 0)
    out[~alpha, :3] = 0
    return out


def upscale(img: Image.Image, factor: int) -> Image.Image:
    return img.resize((img.width * factor, img.height * factor), Image.NEAREST)


def despeckle(rgb: np.ndarray, passes: int = 1) -> np.ndarray:
    """Troca pixels isolados (os 4 vizinhos têm todos a mesma outra cor) pela cor da vizinhança."""
    out = rgb.copy()
    for _ in range(passes):
        c = out[1:-1, 1:-1]
        up, down, left, right = out[:-2, 1:-1], out[2:, 1:-1], out[1:-1, :-2], out[1:-1, 2:]
        same = (np.all(up == down, axis=2) & np.all(up == left, axis=2) & np.all(up == right, axis=2)
                & ~np.all(up == c, axis=2))
        c[same] = up[same]
    return out


def crop_rgba(img: Image.Image) -> Image.Image:
    """Recorta a imagem RGBA ao retângulo dos pixels opacos."""
    box = img.getbbox()
    return img.crop(box) if box else img
