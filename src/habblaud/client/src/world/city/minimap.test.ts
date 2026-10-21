// Minimapa: luz por quarteirão (prédios acesos / 6), centrado no quarteirão do jogador, e o clique de volta em tiles.
import { describe, expect, it } from 'vitest';
import { BLOCK_STRIDE, BLOCK_TILES } from '../../../../shared/world/city';
import { blockLight, minimapModel, minimapToTile } from './minimap';

describe('minimapa', () => {
  it('a luz cresce com os acesos e vai de 0 (nenhum) a 1 (os 6)', () => {
    expect(blockLight(0)).toBe(0);
    expect(blockLight(1)).toBeGreaterThan(0.3);
    expect(blockLight(3)).toBeGreaterThan(blockLight(1));
    expect(blockLight(6)).toBe(1);
    expect(blockLight(60)).toBe(1);
  });

  it('centra no quarteirão do jogador, marca a praça e o que o servidor listou', () => {
    const size = { w: 176, h: 116 };
    const me = { x: BLOCK_STRIDE.x + 10, y: 5 };
    const m = minimapModel([{ x: 1, y: 0, lit: 6 }, { x: 2, y: 0, lit: 0 }], me, { x: me.x - 20, y: me.y - 10, w: 40, h: 20 }, size);
    const home = m.cells.find((c) => c.bx === 1 && c.by === 0)!;
    expect(home.light).toBe(1);
    expect(home.occupied).toBe(true);
    expect(home.x + home.w / 2).toBeCloseTo(size.w / 2, 0);
    const empty = m.cells.find((c) => c.bx === 2 && c.by === 0)!;
    expect(empty).toMatchObject({ occupied: true, light: 0 });
    expect(m.cells.find((c) => c.bx === 0 && c.by === 0)!.plaza).toBe(true);
    expect(m.cells.find((c) => c.bx === 3 && c.by === 0)!.occupied).toBe(false);
    for (const c of m.cells) expect(c.x + c.w > 0 && c.y + c.h > 0 && c.x < size.w && c.y < size.h).toBe(true);
    expect(m.me.x).toBeGreaterThan(0);
    expect(m.view.w).toBeCloseTo(40 * m.k);
  });

  it('o clique no meio do minimapa leva ao meio do quarteirão do jogador', () => {
    const size = { w: 176, h: 116 };
    const m = minimapModel([], { x: 0, y: 0 }, { x: 0, y: 0, w: 1, h: 1 }, size);
    const t = minimapToTile(m, size, size.w / 2, size.h / 2);
    expect(t.x).toBeCloseTo(BLOCK_TILES.w / 2);
    expect(t.y).toBeCloseTo(BLOCK_TILES.h / 2);
    const right = minimapToTile(m, size, size.w / 2 + BLOCK_STRIDE.x * m.k, size.h / 2);
    expect(right.x).toBeCloseTo(BLOCK_TILES.w / 2 + BLOCK_STRIDE.x);
  });
});
