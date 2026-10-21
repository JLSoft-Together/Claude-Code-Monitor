// Cidade do Habblaud World: a geometria de shared/world/city.ts virada no que a cena precisa (puro, sem DOM).
//
// - Célula de quarteirão: o quarteirão, a calçada em volta e a rua a leste e ao sul (51 × 33 tiles, a distância
//   entre dois quarteirões). Todas as células são iguais (menos a praça); o chão de uma célula é desenhado uma vez e
//   repetido (render em scene.ts).
// - Grade caminhável para o A* numa janela de tiles com origem deslocada (a cidade vai para os negativos).
// - Decoração determinística pela semente do quarteirão e do lote: postes e árvores na calçada, bancos, jardins nos
//   lotes vazios, quintal dos prédios e a praça (fonte, bancos, totem).
//
// Unidades: TILES nas posições do protocolo (x leste, y sul; o ponto é o dos pés); px de mundo = tiles × TILE.
import { TILE } from '../../art/api';
import { hash32, mulberry32 } from '../../../../shared/hash';
import {
  BLOCK,
  BLOCK_STRIDE,
  BLOCK_TILES,
  DOOR,
  FOUNTAIN,
  LOT,
  SIDEWALK,
  SPAWN,
  STREET,
  blockAt,
  blockOrigin,
  isPlaza,
  isWalkable,
  lotDoor,
  lotOrigin,
  type CityPoint,
} from '../../../../shared/world/city';
import { BLOCKED, FREE, WalkGrid } from '../path/grid';

export { TILE };

/** Retângulo em tiles. */
export interface TileRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Célula de um quarteirão relativa à origem dele, em tiles: começa na calçada oeste/norte e inclui a rua leste/sul. */
export const CELL: TileRect = { x: -SIDEWALK, y: -SIDEWALK, w: BLOCK_STRIDE.x, h: BLOCK_STRIDE.y };

/** Largura (tiles) do prédio dentro do lote: 1 tile livre de cada lado (beco com cerca viva). */
export const BUILDING_TILES = LOT.w - 2;

export const lotKey = (lot: CityPoint): string => `${lot.x},${lot.y}`;
export const blockKey = (b: CityPoint): string => `${b.x},${b.y}`;

/** Semente visual de um quarteirão (postes, árvores, bancos). */
export function blockSeed(b: CityPoint): number {
  return hash32(`quarteirao:${b.x},${b.y}`);
}

/** Semente visual de um lote (fachada, jardim). A mesma para quem quer que esteja no lote. */
export function lotSeed(lot: CityPoint): number {
  return hash32(`lote:${lot.x},${lot.y}`);
}

/** O lote é da fileira de cima do quarteirão (porta ao norte)? */
export function isNorthRow(lot: CityPoint): boolean {
  return lot.y - BLOCK.h * Math.floor(lot.y / BLOCK.h) === 0;
}

/** Os 6 lotes de um quarteirão, em ordem de linha (vazio na praça). */
export function lotsOfBlock(b: CityPoint): CityPoint[] {
  if (isPlaza(b)) return [];
  const out: CityPoint[] = [];
  for (let j = 0; j < BLOCK.h; j++) for (let i = 0; i < BLOCK.w; i++) out.push({ x: b.x * BLOCK.w + i, y: b.y * BLOCK.h + j });
  return out;
}

/** Retângulo (px) de uma célula. */
export function cellPx(b: CityPoint): { x: number; y: number; w: number; h: number } {
  const o = blockOrigin(b);
  return { x: (o.x + CELL.x) * TILE, y: (o.y + CELL.y) * TILE, w: CELL.w * TILE, h: CELL.h * TILE };
}

/** Quarteirões cujas células cruzam o retângulo (px), com uma margem (px) para o que sobe acima da base. */
export function blockRange(view: { x0: number; y0: number; x1: number; y1: number }, margin = 4 * TILE): { bx0: number; by0: number; bx1: number; by1: number } {
  const sw = BLOCK_STRIDE.x * TILE;
  const sh = BLOCK_STRIDE.y * TILE;
  const ox = CELL.x * TILE;
  const oy = CELL.y * TILE;
  return {
    bx0: Math.floor((view.x0 - margin - ox) / sw),
    by0: Math.floor((view.y0 - margin - oy) / sh),
    bx1: Math.floor((view.x1 + margin - ox) / sw),
    by1: Math.floor((view.y1 + margin - oy) / sh),
  };
}

// ------------------------------------------------------------------ superfícies da célula (chão)

export interface Crosswalk {
  /** Retângulo em tiles relativo à célula; `across` = sentido em que se atravessa ('ns' cruza uma rua leste-oeste). */
  rect: TileRect;
  across: 'ns' | 'we';
}

export interface CellSurfaces {
  /** Anel da calçada (retângulo externo e o quarteirão que fica dentro), relativo à célula. */
  sidewalkOuter: TileRect;
  block: TileRect;
  /** Pistas: a vertical (leste), a horizontal (sul) e o cruzamento. */
  streets: TileRect[];
  intersection: TileRect;
  crosswalks: Crosswalk[];
  /** Faixa central tracejada: segmentos [x0, y0, x1, y1] em tiles (relativos à célula). */
  laneMarks: [number, number, number, number][];
  /** Lotes (ordem de linha) relativos à célula. */
  lots: TileRect[];
}

/** O que há em cada célula, em tiles relativos ao canto noroeste da célula (todas iguais). */
export function cellSurfaces(): CellSurfaces {
  const S = SIDEWALK;
  const bw = BLOCK_TILES.w;
  const bh = BLOCK_TILES.h;
  const ow = bw + 2 * S;
  const oh = bh + 2 * S;
  const lots: TileRect[] = [];
  for (let j = 0; j < BLOCK.h; j++) for (let i = 0; i < BLOCK.w; i++) lots.push({ x: S + i * LOT.w, y: S + j * LOT.h, w: LOT.w, h: LOT.h });
  const mid = STREET / 2;
  return {
    sidewalkOuter: { x: 0, y: 0, w: ow, h: oh },
    block: { x: S, y: S, w: bw, h: bh },
    streets: [
      { x: ow, y: 0, w: STREET, h: oh },
      { x: 0, y: oh, w: ow, h: STREET },
    ],
    intersection: { x: ow, y: oh, w: STREET, h: STREET },
    crosswalks: [
      // atravessando a rua de baixo (leste-oeste), nas duas esquinas do quarteirão
      { rect: { x: 0, y: oh, w: S, h: STREET }, across: 'ns' },
      { rect: { x: ow - S, y: oh, w: S, h: STREET }, across: 'ns' },
      // atravessando a rua da direita (norte-sul)
      { rect: { x: ow, y: 0, w: STREET, h: S }, across: 'we' },
      { rect: { x: ow, y: oh - S, w: STREET, h: S }, across: 'we' },
    ],
    laneMarks: [
      [S + 1, oh + mid, ow - S - 1, oh + mid],
      [ow + mid, S + 1, ow + mid, oh - S - 1],
    ],
    lots,
  };
}

// ------------------------------------------------------------------ grade caminhável (A*)

/** Grade caminhável de uma janela de tiles: `grid` local, (ox, oy) = tile da célula (0, 0). */
export interface WalkWindow {
  grid: WalkGrid;
  ox: number;
  oy: number;
}

/** Todo lote bloqueia (com ou sem prédio), como no servidor. */
const anyLot = (): boolean => true;

/** Grade de uma janela (tiles, inteiros): livre onde `isWalkable` do city.ts diz que dá para pisar. */
export function buildWalkGrid(rect: TileRect): WalkWindow {
  const x0 = Math.floor(rect.x);
  const y0 = Math.floor(rect.y);
  const w = Math.max(1, Math.ceil(rect.w));
  const h = Math.max(1, Math.ceil(rect.h));
  const grid = new WalkGrid(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) grid.cells[y * w + x] = isWalkable(x0 + x + 0.5, y0 + y + 0.5, anyLot) ? FREE : BLOCKED;
  return { grid, ox: x0, oy: y0 };
}

/** Janela da grade que cobre a ida de `a` até `b` (tiles) com folga: um quarteirão para cada lado. */
export function walkRectFor(a: CityPoint, b: CityPoint, margin = Math.max(BLOCK_STRIDE.x, BLOCK_STRIDE.y)): TileRect {
  const x0 = Math.floor(Math.min(a.x, b.x)) - margin;
  const y0 = Math.floor(Math.min(a.y, b.y)) - margin;
  const x1 = Math.ceil(Math.max(a.x, b.x)) + margin;
  const y1 = Math.ceil(Math.max(a.y, b.y)) + margin;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Tile caminhável mais perto de (x, y) (tiles), procurando em anéis até `maxR`. */
export function nearestWalkableTile(x: number, y: number, maxR = 16): CityPoint | null {
  const tx = Math.floor(x);
  const ty = Math.floor(y);
  if (isWalkable(tx + 0.5, ty + 0.5, anyLot)) return { x: tx, y: ty };
  for (let r = 1; r <= maxR; r++) {
    let best: CityPoint | null = null;
    let bestD = Infinity;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        if (!isWalkable(tx + dx + 0.5, ty + dy + 0.5, anyLot)) continue;
        const d = (tx + dx + 0.5 - x) ** 2 + (ty + dy + 0.5 - y) ** 2;
        if (d < bestD) {
          bestD = d;
          best = { x: tx + dx, y: ty + dy };
        }
      }
    }
    if (best) return best;
  }
  return null;
}

/** Pode pisar em (x, y) tiles? (o mesmo teste do servidor). */
export function walkable(x: number, y: number): boolean {
  return isWalkable(x, y, anyLot);
}

// ------------------------------------------------------------------ portas

export interface DoorInfo {
  lot: CityPoint;
  side: 'n' | 's';
  /** Ponto da calçada em frente à porta (tiles). */
  front: CityPoint;
}

/** A porta mais perto de (x, y) a até `maxDist` tiles, entre os lotes aceitos por `has` (ex.: só os com prédio). */
export function nearestDoor(x: number, y: number, has: (lot: CityPoint) => boolean, maxDist = 1.6): DoorInfo | null {
  const { x: bx, y: by } = blockAt(x, y);
  let best: DoorInfo | null = null;
  let bestD = maxDist * maxDist;
  for (let j = by - 1; j <= by + 1; j++) {
    for (let i = bx - 1; i <= bx + 1; i++) {
      for (const lot of lotsOfBlock({ x: i, y: j })) {
        const d = lotDoor(lot);
        const dd = (d.front.x - x) ** 2 + (d.front.y - y) ** 2;
        if (dd <= bestD && has(lot)) {
          bestD = dd;
          best = { lot, side: d.side, front: d.front };
        }
      }
    }
  }
  return best;
}

// ------------------------------------------------------------------ decoração

export type DecorKind = 'tree' | 'pine' | 'bush' | 'flowers' | 'lamp' | 'bench' | 'rock' | 'hedge' | 'parasol' | 'totem' | 'fountain' | 'planter';

export interface Decor {
  kind: DecorKind;
  /** px de mundo: ponto central inferior (base); ordena a profundidade. */
  x: number;
  y: number;
  seed: number;
  /** Banco: onde se senta (tiles, ponto dos pés) e para onde olha. */
  seat?: { x: number; y: number; dir: 'down' | 'up' | 'left' | 'right' };
  /** Detalhe pequeno (some no zoom bem afastado). */
  small?: boolean;
}

/** Afastamento (tiles) de uma porta em que a calçada fica livre de árvore e poste. */
const DOOR_CLEAR = 3;

/** Decoração da calçada de um quarteirão (postes, árvores nas covas, bancos), determinística. */
export function sidewalkDecor(b: CityPoint): Decor[] {
  const o = blockOrigin(b);
  const seed = blockSeed(b);
  const rng = mulberry32(seed);
  const out: Decor[] = [];
  const px = (t: number) => t * TILE;
  const flip = seed & 1;
  // calçadas norte e sul: postes e árvores nas divisas dos lotes (longe das portas), na faixa junto ao meio-fio
  const doorsX = [0, 1, 2].map((i) => o.x + i * LOT.w + DOOR.dx + DOOR.w / 2);
  const nearDoor = (x: number) => doorsX.some((d) => Math.abs(x - d) < DOOR_CLEAR);
  for (const side of ['n', 's'] as const) {
    const rowY = side === 'n' ? o.y - SIDEWALK : o.y + BLOCK_TILES.h + SIDEWALK - 1;
    const slots = [0, LOT.w, 2 * LOT.w, 3 * LOT.w];
    slots.forEach((sx, i) => {
      const tx = o.x + sx;
      if (nearDoor(tx)) return;
      const lamp = (i + flip + (side === 's' ? 1 : 0)) % 2 === 0;
      if (lamp) out.push({ kind: 'lamp', x: px(tx) + (sx === 0 ? 6 : sx === 3 * LOT.w ? -6 : 0), y: px(rowY) + 10, seed: seed + i });
      else out.push({ kind: rng() < 0.22 ? 'pine' : 'tree', x: px(tx), y: px(rowY) + 12, seed: Math.floor(rng() * 1e9) });
    });
    // um banco por lado, de frente para a rua (norte: de costas para o quarteirão)
    if (rng() < 0.7) {
      const lot = Math.floor(rng() * 3);
      const bx = o.x + lot * LOT.w + (rng() < 0.5 ? 2 : LOT.w - 3);
      if (!nearDoor(bx + 1)) {
        const by = rowY;
        out.push({ kind: 'bench', x: px(bx + 1), y: px(by) + 13, seed: seed + 7, seat: { x: bx + 1, y: by + 0.85, dir: 'down' } });
      }
    }
  }
  // calçadas oeste e leste: um poste no meio e árvores perto das esquinas
  for (const side of ['w', 'e'] as const) {
    const colX = side === 'w' ? o.x - SIDEWALK : o.x + BLOCK_TILES.w + SIDEWALK - 1;
    const ys = [3, Math.floor(BLOCK_TILES.h / 2), BLOCK_TILES.h - 3];
    ys.forEach((sy, i) => {
      const ty = o.y + sy;
      const cx = px(colX) + 8;
      if (i === 1) out.push({ kind: 'lamp', x: cx, y: px(ty) + 10, seed: seed + 20 + i });
      else if (rng() < 0.85) out.push({ kind: rng() < 0.25 ? 'pine' : 'tree', x: cx, y: px(ty) + 12, seed: Math.floor(rng() * 1e9) });
      else out.push({ kind: 'bush', x: cx, y: px(ty) + 12, seed: Math.floor(rng() * 1e9), small: true });
    });
  }
  return out;
}

/** Variantes de jardim de lote vazio. */
export type GardenKind = 'park' | 'pond' | 'orchard' | 'cafe';
export const GARDEN_KINDS: readonly GardenKind[] = ['park', 'pond', 'orchard', 'cafe'];

export function gardenKind(lot: CityPoint): GardenKind {
  return GARDEN_KINDS[lotSeed(lot) % GARDEN_KINDS.length]!;
}

/**
 * Decoração de um lote. Vazio: jardim (árvores, canteiros, bancos, guarda-sóis). Com prédio: o quintal do meio do
 * quarteirão (cerca viva e arbustos atrás do prédio), escondido pelo próprio prédio quando ele é bem alto.
 */
export function lotDecor(lot: CityPoint, built: boolean): Decor[] {
  const o = lotOrigin(lot);
  const seed = lotSeed(lot);
  const rng = mulberry32(seed ^ 0x5bd1e995);
  const out: Decor[] = [];
  const X = (t: number) => (o.x + t) * TILE;
  const Y = (t: number) => (o.y + t) * TILE;
  const s = () => Math.floor(rng() * 1e9);
  const north = isNorthRow(lot);
  if (built) {
    // quintal: fileira de cerca viva junto ao meio do quarteirão e um arbusto ou árvore pequena
    const hy = north ? Y(LOT.h) - 2 : Y(0) + 12;
    for (let x = 1; x < LOT.w - 1; x += 2) out.push({ kind: 'hedge', x: X(x) + TILE, y: hy, seed: seed + x, small: true });
    const ty = north ? Y(LOT.h - 1.4) : Y(1.6);
    if (rng() < 0.8) out.push({ kind: rng() < 0.3 ? 'pine' : 'tree', x: X(1.2), y: ty, seed: s() });
    if (rng() < 0.8) out.push({ kind: rng() < 0.3 ? 'pine' : 'tree', x: X(LOT.w - 1.2), y: ty, seed: s() });
    return out;
  }
  // lote vazio: jardim. Bordas de cerca viva viradas para a calçada, com o portão onde seria a porta.
  const kind = gardenKind(lot);
  const edgeY = north ? Y(0) + 13 : Y(LOT.h) - 2;
  for (let x = 0; x < LOT.w; x += 2) {
    if (x >= DOOR.dx - 1 && x <= DOOR.dx + 1) continue;
    out.push({ kind: (x / 2) % 3 === 1 ? 'flowers' : 'hedge', x: X(x) + TILE, y: edgeY, seed: seed + x * 3, small: true });
  }
  const cx = LOT.w / 2;
  const cy = LOT.h / 2;
  switch (kind) {
    case 'park':
      out.push({ kind: 'tree', x: X(2.5), y: Y(north ? 4.5 : 3.5), seed: s() });
      out.push({ kind: rng() < 0.5 ? 'pine' : 'tree', x: X(11.5), y: Y(north ? 3.8 : 4.2), seed: s() });
      out.push({ kind: 'tree', x: X(10.5), y: Y(north ? 9.5 : 8.8), seed: s() });
      out.push({ kind: 'bush', x: X(3.5), y: Y(north ? 9.2 : 8.4), seed: s(), small: true });
      out.push({ kind: 'flowers', x: X(cx), y: Y(cy + 0.6), seed: s(), small: true });
      out.push({ kind: 'bench', x: X(cx), y: Y(cy - 1.2), seed: s(), seat: { x: o.x + cx, y: o.y + cy - 1.35, dir: 'down' } });
      break;
    case 'pond':
      out.push({ kind: 'rock', x: X(3.2), y: Y(cy + 2.2), seed: s(), small: true });
      out.push({ kind: 'rock', x: X(10.4), y: Y(cy - 1.8), seed: s(), small: true });
      out.push({ kind: 'tree', x: X(1.8), y: Y(north ? 10.6 : 3.2), seed: s() });
      out.push({ kind: 'pine', x: X(12.2), y: Y(north ? 10.2 : 3.6), seed: s() });
      out.push({ kind: 'bush', x: X(4.6), y: Y(cy - 2.6), seed: s(), small: true });
      out.push({ kind: 'bush', x: X(9.5), y: Y(cy + 2.8), seed: s(), small: true });
      break;
    case 'orchard':
      for (let j = 0; j < 2; j++) for (let i = 0; i < 4; i++) out.push({ kind: 'tree', x: X(2.2 + i * 3.2), y: Y((north ? 4.6 : 3.6) + j * 4.4), seed: s() });
      break;
    case 'cafe':
      out.push({ kind: 'parasol', x: X(4), y: Y(cy + 0.5), seed: s() });
      out.push({ kind: 'parasol', x: X(10), y: Y(cy + 0.5), seed: s() });
      out.push({ kind: 'planter', x: X(cx), y: Y(cy - 2.5), seed: s(), small: true });
      out.push({ kind: 'tree', x: X(1.6), y: Y(north ? 10.4 : 2.6), seed: s() });
      out.push({ kind: 'tree', x: X(12.4), y: Y(north ? 10.4 : 2.6), seed: s() });
      break;
  }
  return out;
}

/** A praça (quarteirão 0,0): fonte no centro, bancos de frente para ela, canteiros com árvores, postes e o totem. */
export function plazaDecor(): Decor[] {
  const o = blockOrigin({ x: 0, y: 0 });
  const X = (t: number) => (o.x + t) * TILE;
  const Y = (t: number) => (o.y + t) * TILE;
  const out: Decor[] = [];
  const f = FOUNTAIN;
  out.push({ kind: 'fountain', x: X(f.x + f.w / 2), y: Y(f.y + f.h), seed: 1 });
  // bancos em volta da fonte: dois ao norte (de costas para o norte, olhando a fonte) e dois ao sul
  for (const dx of [-5, 5]) {
    out.push({ kind: 'bench', x: X(f.x + f.w / 2 + dx), y: Y(f.y - 1) + 13, seed: 3 + dx, seat: { x: o.x + f.x + f.w / 2 + dx, y: o.y + f.y - 1 + 0.85, dir: 'down' } });
    out.push({ kind: 'bench', x: X(f.x + f.w / 2 + dx), y: Y(f.y + f.h + 2) + 13, seed: 4 + dx, seat: { x: o.x + f.x + f.w / 2 + dx, y: o.y + f.y + f.h + 2 + 0.85, dir: 'down' } });
  }
  // canteiros nos quatro cantos (árvores e flores) e postes nas diagonais
  const corners: [number, number][] = [
    [6, 5],
    [BLOCK_TILES.w - 6, 5],
    [6, BLOCK_TILES.h - 4],
    [BLOCK_TILES.w - 6, BLOCK_TILES.h - 4],
  ];
  corners.forEach(([cx, cy], i) => {
    out.push({ kind: i % 2 ? 'pine' : 'tree', x: X(cx - 1.5), y: Y(cy), seed: 100 + i * 7 });
    out.push({ kind: 'tree', x: X(cx + 1.5), y: Y(cy + 0.4), seed: 200 + i * 11 });
    out.push({ kind: 'flowers', x: X(cx), y: Y(cy + 1.6), seed: 300 + i, small: true });
    out.push({ kind: 'bush', x: X(cx - 3), y: Y(cy + 1.4), seed: 400 + i, small: true });
    out.push({ kind: 'bush', x: X(cx + 3), y: Y(cy + 1.2), seed: 500 + i, small: true });
  });
  for (const [lx, ly] of [
    [12, 4],
    [BLOCK_TILES.w - 12, 4],
    [12, BLOCK_TILES.h - 5],
    [BLOCK_TILES.w - 12, BLOCK_TILES.h - 5],
  ] as const) {
    out.push({ kind: 'lamp', x: X(lx) + 8, y: Y(ly) + 10, seed: lx * 3 + ly });
  }
  // o totem do Habblaud ao lado do ponto de nascimento
  out.push({ kind: 'totem', x: X(SPAWN.x - 3) + 8, y: Y(SPAWN.y) + 4, seed: 2 });
  out.push({ kind: 'planter', x: X(SPAWN.x + 3) + 8, y: Y(SPAWN.y) + 6, seed: 9, small: true });
  return out;
}

/** Decoração fixa de um quarteirão: a calçada e, na praça, a própria praça. */
export function blockDecor(b: CityPoint): Decor[] {
  const out = sidewalkDecor(b);
  if (isPlaza(b)) out.push(...plazaDecor());
  return out;
}
