"""Testes das operações de pixel art. Uso: python3 -E scripts/assets/test_pixelops.py"""

from __future__ import annotations

import unittest

import numpy as np
from PIL import Image

import pixelart
import pixelops as px


def blocky(native: np.ndarray, scale: float) -> np.ndarray:
    """Amplia com blocos de tamanho NÃO inteiro (como a IA faz), sem interpolação."""
    h, w = native.shape[:2]
    out_w, out_h = round(w * scale), round(h * scale)
    xs = np.minimum((np.arange(out_w) / scale).astype(int), w - 1)
    ys = np.minimum((np.arange(out_h) / scale).astype(int), h - 1)
    return native[ys][:, xs]


class UnscaleTest(unittest.TestCase):
    def test_recupera_a_grade_nativa(self) -> None:
        rng = np.random.default_rng(1)
        palette = np.array([[28, 37, 65], [250, 198, 101], [66, 140, 161], [208, 200, 189], [102, 176, 71]], dtype=np.uint8)
        native = palette[rng.integers(0, len(palette), size=(24, 30))]
        big = blocky(native, 10.24)
        out, _, period = px.unscale(big)
        self.assertAlmostEqual(period, 10.24, delta=0.1)
        self.assertEqual(out.shape[:2], native.shape[:2])
        self.assertGreater((out == native).all(axis=2).mean(), 0.97)


class ChromaTest(unittest.TestCase):
    def test_fundo_estimado_pela_moldura(self) -> None:
        img = np.zeros((40, 40, 3), dtype=np.uint8)
        img[:] = (192, 74, 138)  # "magenta" errado, como o de algumas tomadas
        img[10:30, 12:28] = (66, 140, 161)
        mask = px.magenta_mask(img)
        self.assertTrue(mask[0, 0])
        self.assertFalse(mask[20, 20])
        self.assertEqual(int((~mask).sum()), 20 * 16)


class ModeTest(unittest.TestCase):
    def test_reducao_por_moda_nao_mistura_cores(self) -> None:
        native = np.zeros((4, 4, 3), dtype=np.uint8)
        native[:, :2] = (255, 0, 0)
        native[:, 2:] = (0, 0, 255)
        big = blocky(native, 8.0)
        palette = px.build_palette(big, None, 4)
        small, alpha = px.downscale_mode(big, np.ones(big.shape[:2], dtype=bool), 4, 4, palette)
        self.assertTrue(alpha.all())
        colors = {tuple(c) for c in small.reshape(-1, 3)}
        self.assertEqual(colors, {(255, 0, 0), (0, 0, 255)})


class MergeTest(unittest.TestCase):
    def test_funde_tons_quase_iguais_no_mais_frequente(self) -> None:
        img = np.zeros((4, 4, 3), dtype=np.uint8)
        img[:] = (17, 25, 49)
        img[0, :2] = (15, 23, 46)  # tom quase igual (ruído do k-means)
        img[3, 3] = (254, 224, 116)  # cor distinta: fica
        alpha = np.ones((4, 4), dtype=bool)
        alpha[3, 2] = False
        out = px.merge_similar(img, alpha, 12)
        colors = {tuple(c) for c in out[alpha].tolist()}
        self.assertEqual(colors, {(17, 25, 49), (254, 224, 116)})


class FontTest(unittest.TestCase):
    def test_acentos_e_largura(self) -> None:
        self.assertEqual(pixelart.text_width("Habblaud"), 47)
        img = pixelart.text_image("escritório ação", "#ffffff")
        self.assertEqual(img.height, pixelart.CELL_HEIGHT)
        with self.assertRaises(KeyError):
            pixelart.text_width("€")

    def test_marks_tem_tamanho_e_alfa_binario(self) -> None:
        for size in (16, 32):
            mark = pixelart.mark(size)
            self.assertEqual(mark.size, (size, size))
            self.assertLessEqual(set(np.array(mark)[..., 3].ravel().tolist()), {0, 255})
        self.assertIsInstance(pixelart.signage(), Image.Image)


if __name__ == "__main__":
    unittest.main()
