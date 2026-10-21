// Geometria da cidade vista pela cena: grade do A* igual ao `isWalkable` do city.ts (o do servidor), portas,
// decoração determinística e fora das portas, quarteirões visíveis.
import { describe, expect, it } from 'vitest';
import { BLOCK_STRIDE, FOUNTAIN, isWalkable, lotDoor, lotOrigin, lotSpiral, spawnPoint } from '../../../../shared/world/city';
import { PathFinder } from '../path/astar';
import {
  BUILDING_TILES,
  CELL,
  blockRange,
  buildWalkGrid,
  cellSurfaces,
  gardenKind,
  GARDEN_KINDS,
  lotDecor,
  lotsOfBlock,
  nearestDoor,
  nearestWalkableTile,
  plazaDecor,
  sidewalkDecor,
  walkRectFor,
  TILE,
} from './layout';

const anyLot = () => true;

/** Os n primeiros de um gerador (a espiral é infinita). */
function take<T>(gen: Iterable<T>, n: number): T[] {
  const out: T[] = [];
  for (const v of gen) {
    if (out.length >= n) break;
    out.push(v);
  }
  return out;
}

describe('grade caminhável (A*)', () => {
  it('cada célula é exatamente o isWalkable do city.ts, inclusive nos negativos', () => {
    const rect = { x: -60, y: -40, w: 170, h: 110 };
    const { grid, ox, oy } = buildWalkGrid(rect);
    expect(ox).toBe(-60);
    expect(oy).toBe(-40);
    for (let y = 0; y < grid.h; y++) for (let x = 0; x < grid.w; x++) expect(grid.walkable(x, y)).toBe(isWalkable(ox + x + 0.5, oy + y + 0.5, anyLot));
  });

  it('lotes e a fonte bloqueiam; calçadas, pistas e a frente das portas não', () => {
    const { grid, ox, oy } = buildWalkGrid({ x: -5, y: -5, w: 110, h: 75 });
    const at = (x: number, y: number) => grid.walkable(x - ox, y - oy);
    expect(at(FOUNTAIN.x, FOUNTAIN.y)).toBe(false);
    expect(at(FOUNTAIN.x + 3, FOUNTAIN.y + 2)).toBe(false);
    expect(at(spawnPoint().x, spawnPoint().y)).toBe(true);
    for (const lot of take(lotSpiral(), 12)) {
      const o = lotOrigin(lot);
      expect(at(o.x + 3, o.y + 3)).toBe(false);
      const f = lotDoor(lot).front;
      expect(at(Math.floor(f.x), Math.floor(f.y))).toBe(true);
    }
  });

  it('o A* acha caminho da praça até a porta de um lote, só por tiles caminháveis', () => {
    const lot = take(lotSpiral(), 8)[7]!;
    const goal = lotDoor(lot).front;
    const start = spawnPoint();
    const win = buildWalkGrid(walkRectFor(start, goal));
    const finder = new PathFinder(win.grid);
    const out: number[] = [];
    expect(finder.find(start.x - win.ox, start.y - win.oy, Math.floor(goal.x) - win.ox, Math.floor(goal.y) - win.oy, out)).toBe(true);
    for (let i = 0; i < out.length; i += 2) expect(isWalkable(out[i]! + win.ox + 0.5, out[i + 1]! + win.oy + 0.5, anyLot)).toBe(true);
  });

  it('o tile caminhável mais perto de um ponto dentro de um lote fica na calçada em volta', () => {
    const o = lotOrigin({ x: 3, y: 0 });
    const t = nearestWalkableTile(o.x + 7, o.y + 1)!;
    expect(isWalkable(t.x + 0.5, t.y + 0.5, anyLot)).toBe(true);
    expect(t.y).toBe(o.y - 1);
  });
});

describe('célula e quarteirões visíveis', () => {
  it('a célula tem a calçada, a pista e o quarteirão somando a distância entre quarteirões', () => {
    const s = cellSurfaces();
    expect(CELL.w).toBe(BLOCK_STRIDE.x);
    expect(CELL.h).toBe(BLOCK_STRIDE.y);
    expect(s.sidewalkOuter.w + s.streets[0]!.w).toBe(BLOCK_STRIDE.x);
    expect(s.sidewalkOuter.h + s.streets[1]!.h).toBe(BLOCK_STRIDE.y);
    expect(s.lots).toHaveLength(6);
    expect(s.crosswalks).toHaveLength(4);
  });

  it('a faixa de quarteirões cobre a vista (com margem) e só ela', () => {
    const r = blockRange({ x0: 0, y0: 0, x1: 10, y1: 10 }, 0);
    expect(r).toEqual({ bx0: 0, by0: 0, bx1: 0, by1: 0 });
    const r2 = blockRange({ x0: -1, y0: -1, x1: BLOCK_STRIDE.x * TILE * 2, y1: 5 }, 0);
    expect(r2.bx0).toBe(0);
    expect(r2.bx1).toBe(2);
    // a calçada oeste do quarteirão 0 (x = -2 tiles) já é do quarteirão 0
    expect(blockRange({ x0: -2 * TILE, y0: 0, x1: -2 * TILE + 1, y1: 1 }, 0).bx0).toBe(0);
    expect(blockRange({ x0: -3 * TILE, y0: 0, x1: -3 * TILE + 1, y1: 1 }, 0).bx0).toBe(-1);
  });

  it('a praça não tem lotes; os outros quarteirões têm 6, em ordem de linha', () => {
    expect(lotsOfBlock({ x: 0, y: 0 })).toEqual([]);
    expect(lotsOfBlock({ x: -1, y: 2 })).toEqual([
      { x: -3, y: 4 }, { x: -2, y: 4 }, { x: -1, y: 4 },
      { x: -3, y: 5 }, { x: -2, y: 5 }, { x: -1, y: 5 },
    ]);
    expect(BUILDING_TILES).toBe(12);
  });
});

describe('portas', () => {
  it('acha a porta mais perto entre os lotes aceitos', () => {
    const lot = { x: 4, y: 1 };
    const f = lotDoor(lot).front;
    expect(nearestDoor(f.x, f.y + 0.4, () => true)?.lot).toEqual(lot);
    expect(nearestDoor(f.x, f.y + 0.4, (l) => l.x !== 4)).toBeNull();
    expect(nearestDoor(f.x + 5, f.y, () => true)).toBeNull();
  });
});

describe('decoração determinística', () => {
  it('a calçada sai igual a cada chamada e deixa a frente das portas livre', () => {
    for (const b of [{ x: 1, y: 0 }, { x: -2, y: 3 }, { x: 0, y: 0 }, { x: 4, y: -1 }]) {
      const a = sidewalkDecor(b);
      expect(sidewalkDecor(b)).toEqual(a);
      const o = { x: b.x * BLOCK_STRIDE.x, y: b.y * BLOCK_STRIDE.y };
      const doorsX = [0, 1, 2].map((i) => o.x + i * 14 + 7);
      for (const d of a) {
        const ty = d.y / TILE;
        // só as calçadas norte e sul têm portas
        const onDoorRow = ty < o.y || ty > o.y + 24;
        if (!onDoorRow || d.x / TILE < o.x || d.x / TILE > o.x + 42) continue;
        for (const dx of doorsX) expect(Math.abs(d.x / TILE - dx)).toBeGreaterThanOrEqual(2.5);
      }
    }
  });

  it('jardins e quintais saem iguais por lote; jardim é uma das variantes', () => {
    const lot = { x: 7, y: -3 };
    expect(lotDecor(lot, false)).toEqual(lotDecor(lot, false));
    expect(lotDecor(lot, true)).toEqual(lotDecor(lot, true));
    expect(GARDEN_KINDS).toContain(gardenKind(lot));
    // tudo dentro do lote
    const o = lotOrigin(lot);
    for (const d of [...lotDecor(lot, false), ...lotDecor(lot, true)]) {
      expect(d.x).toBeGreaterThanOrEqual(o.x * TILE);
      expect(d.x).toBeLessThanOrEqual((o.x + 14) * TILE);
      expect(d.y).toBeGreaterThanOrEqual(o.y * TILE);
      expect(d.y).toBeLessThanOrEqual((o.y + 12) * TILE);
    }
  });

  it('a praça tem a fonte, bancos com assento caminhável e o totem perto do nascimento', () => {
    const p = plazaDecor();
    expect(p.filter((d) => d.kind === 'fountain')).toHaveLength(1);
    const seats = p.filter((d) => d.seat);
    expect(seats.length).toBeGreaterThanOrEqual(4);
    for (const d of seats) expect(isWalkable(d.seat!.x, d.seat!.y, anyLot)).toBe(true);
    expect(p.some((d) => d.kind === 'totem')).toBe(true);
    expect(seats.some((d) => Math.hypot(d.seat!.x - spawnPoint().x, d.seat!.y - spawnPoint().y) <= 10)).toBe(true);
  });

  it('os bancos da calçada também ficam em tile caminhável', () => {
    for (let bx = -3; bx <= 3; bx++) for (let by = -3; by <= 3; by++) for (const d of sidewalkDecor({ x: bx, y: by })) if (d.seat) expect(isWalkable(d.seat.x, d.seat.y, anyLot)).toBe(true);
  });
});
