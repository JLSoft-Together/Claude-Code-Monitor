// Chão da cidade (navegador): a célula de quarteirão desenhada UMA vez e repetida em todos os quarteirões (calçada,
// meio-fio, pista com faixa tracejada, faixas de pedestres, gramado dos lotes), a célula da praça (piso de pedra,
// anel de mármore, canteiros), o chão dos jardins dos lotes vazios (caminhos, lago, deck, canteiros de pomar) e os
// sprites próprios da cidade (fonte, floreira). Árvores, postes e bancos vêm de render/props.ts (os do escritório).
import { TILE, type ArtModule } from '../../art/api';
import { mulberry32 } from '../../../../shared/hash';
import { BLOCK_TILES, DOOR, FOUNTAIN, LOT, SIDEWALK } from '../../../../shared/world/city';
import { cellSurfaces, type GardenKind } from './layout';

type Ctx = CanvasRenderingContext2D;

function canvas(w: number, h: number): [HTMLCanvasElement, Ctx] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  return [c, ctx];
}

const T = (n: number) => n * TILE;

function safe(fn: () => void): void {
  try {
    fn();
  } catch {
    // arte incompleta não derruba a cidade
  }
}

/** Grama ~15% menos saturada, como a área externa do escritório. */
function desaturate(ctx: Ctx, x: number, y: number, w: number, h: number, k = 0.16): void {
  ctx.save();
  try {
    ctx.globalCompositeOperation = 'saturation';
    ctx.fillStyle = `rgba(128,128,128,${k})`;
    ctx.fillRect(x, y, w, h);
  } catch {
    // sem o modo de mistura
  }
  ctx.restore();
}

/** Meio-fio: borda clara da calçada e a face escura virada para a pista. */
function curb(ctx: Ctx, x: number, y: number, w: number, h: number, side: 'n' | 's' | 'w' | 'e'): void {
  const light = '#e2dfd6';
  const face = '#8d8a82';
  const dark = '#5f5c56';
  if (side === 's') {
    ctx.fillStyle = light;
    ctx.fillRect(x, y + h - 3, w, 1);
    ctx.fillStyle = face;
    ctx.fillRect(x, y + h - 2, w, 2);
    ctx.fillStyle = dark;
    ctx.fillRect(x, y + h, w, 1);
  } else if (side === 'n') {
    ctx.fillStyle = dark;
    ctx.fillRect(x, y, w, 1);
    ctx.fillStyle = light;
    ctx.fillRect(x, y + 1, w, 1);
  } else if (side === 'e') {
    ctx.fillStyle = light;
    ctx.fillRect(x + w - 2, y, 1, h);
    ctx.fillStyle = face;
    ctx.fillRect(x + w - 1, y, 1, h);
    ctx.fillStyle = 'rgba(40,40,40,0.35)';
    ctx.fillRect(x + w, y, 1, h);
  } else {
    ctx.fillStyle = 'rgba(40,40,40,0.35)';
    ctx.fillRect(x - 1, y, 1, h);
    ctx.fillStyle = face;
    ctx.fillRect(x, y, 1, h);
    ctx.fillStyle = light;
    ctx.fillRect(x + 1, y, 1, h);
  }
}

/** Pista: asfalto, faixa tracejada, faixas de pedestres, bueiros e tampas. */
function paintStreets(art: ArtModule, ctx: Ctx, seed: number): void {
  const s = cellSurfaces();
  for (const r of [...s.streets, s.intersection]) safe(() => art.drawFloor(ctx, 'street', T(r.x), T(r.y), T(r.w), T(r.h), { seed: 13 }));
  // bordas da pista escurecidas junto ao meio-fio (sarjeta)
  ctx.fillStyle = 'rgba(20,22,28,0.18)';
  const ow = T(s.sidewalkOuter.w);
  const oh = T(s.sidewalkOuter.h);
  ctx.fillRect(ow, 0, 3, oh);
  ctx.fillRect(0, oh, ow, 3);
  // faixa central tracejada
  ctx.fillStyle = 'rgba(255,226,140,0.85)';
  for (const [x0, y0, x1, y1] of s.laneMarks) {
    if (y0 === y1) for (let x = T(x0); x < T(x1) - 8; x += 24) ctx.fillRect(x, T(y0) - 1, 12, 2);
    else for (let y = T(y0); y < T(y1) - 8; y += 24) ctx.fillRect(T(x0) - 1, y, 2, 12);
  }
  // faixas de pedestres (zebra): barras no sentido do trânsito, empilhadas na travessia
  for (const cw of s.crosswalks) {
    const r = cw.rect;
    ctx.fillStyle = 'rgba(244,244,236,0.9)';
    if (cw.across === 'ns') for (let y = T(r.y) + 4; y < T(r.y + r.h) - 3; y += 6) ctx.fillRect(T(r.x) + 3, y, T(r.w) - 6, 3);
    else for (let x = T(r.x) + 4; x < T(r.x + r.w) - 3; x += 6) ctx.fillRect(x, T(r.y) + 3, 3, T(r.h) - 6);
  }
  // linha de parada antes do cruzamento
  ctx.fillStyle = 'rgba(244,244,236,0.75)';
  ctx.fillRect(ow - 2, oh + 2, 2, T(2) - 2);
  ctx.fillRect(ow + T(3), oh - 2, T(2) - 2, 2);
  // bueiros e tampas de inspeção
  const rng = mulberry32(seed);
  for (let i = 0; i < 3; i++) {
    const x = T(4 + Math.floor(rng() * 36));
    ctx.fillStyle = '#3a3d44';
    ctx.fillRect(x, oh + 4, 10, 3);
    ctx.fillStyle = '#2a2c31';
    for (let k = 1; k < 10; k += 2) ctx.fillRect(x + k, oh + 4, 1, 3);
  }
  const mx = ow + T(2) + 2;
  const my = T(8 + Math.floor(rng() * 10));
  ctx.fillStyle = '#3f4249';
  ctx.beginPath();
  ctx.ellipse(mx + 6, my + 5, 6, 4.5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#585c64';
  ctx.fillRect(mx + 2, my + 4, 8, 1);
  ctx.fillRect(mx + 3, my + 6, 6, 1);
}

/** Calçada (anel em volta do quarteirão) com meio-fio, e a borda de pedra do gramado. */
function paintSidewalkRing(art: ArtModule, ctx: Ctx): void {
  const s = cellSurfaces();
  const o = s.sidewalkOuter;
  safe(() => art.drawFloor(ctx, 'sidewalk', T(o.x), T(o.y), T(o.w), T(o.h), { seed: 12 }));
  // meio-fio nas quatro bordas externas
  curb(ctx, 0, 0, T(o.w), 2, 'n');
  curb(ctx, 0, T(o.h) - 3, T(o.w), 3, 's');
  curb(ctx, 0, 0, 2, T(o.h), 'w');
  curb(ctx, T(o.w) - 3, 0, 3, T(o.h), 'e');
  // covas das árvores e drenos não: a decoração vem por cima
}

/** Gramado dos lotes, com mureta baixa de pedra em volta do quarteirão e a divisa sutil entre os lotes. */
function paintLotsGround(art: ArtModule, ctx: Ctx): void {
  const s = cellSurfaces();
  const b = s.block;
  safe(() => art.drawFloor(ctx, 'grass', T(b.x), T(b.y), T(b.w), T(b.h), { seed: 11 }));
  desaturate(ctx, T(b.x), T(b.y), T(b.w), T(b.h));
  // divisas (linha de grama mais escura)
  ctx.fillStyle = 'rgba(40,70,40,0.18)';
  for (const r of s.lots) {
    ctx.fillRect(T(r.x + r.w) - 1, T(r.y), 1, T(r.h));
    ctx.fillRect(T(r.x), T(r.y + r.h) - 1, T(r.w), 1);
  }
  // mureta de pedra baixa
  const x = T(b.x);
  const y = T(b.y);
  const w = T(b.w);
  const h = T(b.h);
  ctx.fillStyle = '#9a968c';
  ctx.fillRect(x, y, w, 2);
  ctx.fillRect(x, y + h - 2, w, 2);
  ctx.fillRect(x, y, 2, h);
  ctx.fillRect(x + w - 2, y, 2, h);
  ctx.fillStyle = '#c9c5bb';
  ctx.fillRect(x, y, w, 1);
  ctx.fillRect(x, y + h - 2, w, 1);
  ctx.fillRect(x, y, 1, h);
  ctx.fillRect(x + w - 2, y, 1, h);
  // portões dos lotes (abertura da mureta diante das portas)
  for (const r of s.lots) {
    const north = r.y === b.y;
    const gx = T(r.x + DOOR.dx);
    safe(() => art.drawFloor(ctx, 'sidewalk', gx, north ? y : y + h - 2, T(DOOR.w), 2, { seed: 12 }));
  }
}

/** A célula de um quarteirão comum (todas iguais). */
export function cellCanvas(art: ArtModule): HTMLCanvasElement {
  const s = cellSurfaces();
  const [c, ctx] = canvas(T(s.sidewalkOuter.w + s.streets[0]!.w), T(s.sidewalkOuter.h + s.streets[1]!.h));
  paintStreets(art, ctx, 77);
  paintSidewalkRing(art, ctx);
  paintLotsGround(art, ctx);
  return c;
}

/** A célula da praça: piso de pedra, anel de mármore em volta da fonte, canteiros nos cantos e caminhos. */
export function plazaCanvas(art: ArtModule): HTMLCanvasElement {
  const s = cellSurfaces();
  const [c, ctx] = canvas(T(s.sidewalkOuter.w + s.streets[0]!.w), T(s.sidewalkOuter.h + s.streets[1]!.h));
  paintStreets(art, ctx, 99);
  paintSidewalkRing(art, ctx);
  const b = s.block;
  const bx = T(b.x);
  const by = T(b.y);
  const bw = T(b.w);
  const bh = T(b.h);
  // piso de pedra (o da calçada, num tom mais quente), com uma faixa escura em volta e placas grandes no meio
  safe(() => art.drawFloor(ctx, 'sidewalk', bx, by, bw, bh, { seed: 23 }));
  ctx.fillStyle = 'rgba(196,150,96,0.10)';
  ctx.fillRect(bx, by, bw, bh);
  ctx.fillStyle = '#9a8f80';
  ctx.fillRect(bx + T(1), by + T(1), bw - T(2), 3);
  ctx.fillRect(bx + T(1), by + bh - T(1) - 3, bw - T(2), 3);
  ctx.fillRect(bx + T(1), by + T(1), 3, bh - T(2));
  ctx.fillRect(bx + bw - T(1) - 3, by + T(1), 3, bh - T(2));
  ctx.fillStyle = 'rgba(255,248,232,0.5)';
  ctx.fillRect(bx + T(1), by + T(1), bw - T(2), 1);
  // caminhos de pedra clara ligando as quatro calçadas ao anel da fonte
  const fcx = bx + T(FOUNTAIN.x + FOUNTAIN.w / 2);
  const fcy = by + T(FOUNTAIN.y + FOUNTAIN.h / 2);
  ctx.fillStyle = 'rgba(236,226,206,0.55)';
  ctx.fillRect(fcx - T(1.5), by + T(1) + 3, T(3), bh - T(2) - 6);
  ctx.fillRect(bx + T(1) + 3, fcy - T(1.5), bw - T(2) - 6, T(3));
  ctx.fillStyle = 'rgba(140,128,110,0.45)';
  for (const d of [-1, 1]) {
    ctx.fillRect(fcx + d * T(1.5) - (d > 0 ? 1 : 0), by + T(1) + 3, 1, bh - T(2) - 6);
    ctx.fillRect(bx + T(1) + 3, fcy + d * T(1.5) - (d > 0 ? 1 : 0), bw - T(2) - 6, 1);
  }
  // canteiros de grama nos quatro cantos (cantos arredondados, borda de pedra)
  const beds: [number, number, number, number][] = [
    [2, 2, 10, 6],
    [b.w - 12, 2, 10, 6],
    [2, b.h - 8, 10, 6],
    [b.w - 12, b.h - 8, 10, 6],
  ];
  for (const [x, y, w, h] of beds) {
    const px = bx + T(x);
    const py = by + T(y);
    ctx.fillStyle = '#8d8a82';
    ctx.fillRect(px - 2, py - 2, T(w) + 4, T(h) + 4);
    ctx.fillStyle = '#d8d4ca';
    ctx.fillRect(px - 2, py - 2, T(w) + 4, 1);
    safe(() => art.drawFloor(ctx, 'grass', px, py, T(w), T(h), { seed: 31 }));
    desaturate(ctx, px, py, T(w), T(h));
  }
  // anel de mármore em volta da fonte e caminhos em cruz
  const f = FOUNTAIN;
  const cx = bx + T(f.x + f.w / 2);
  const cy = by + T(f.y + f.h / 2);
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(cx, cy, T(7), T(5.2), 0, 0, Math.PI * 2);
  ctx.clip();
  safe(() => art.drawFloor(ctx, 'marble', cx - T(8), cy - T(6), T(16), T(12), { seed: 41 }));
  ctx.restore();
  ctx.strokeStyle = '#8f8676';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.ellipse(cx, cy, T(7) - 1, T(5.2) - 1, 0, 0, Math.PI * 2);
  ctx.stroke();
  // mosaico em volta da bacia
  ctx.strokeStyle = 'rgba(63,127,216,0.35)';
  ctx.lineWidth = 2;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.ellipse(cx, cy + 4, T(4.8), T(3.4), 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.strokeStyle = 'rgba(255,255,255,0.5)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.ellipse(cx, cy - 1, T(7) - 2, T(5.2) - 2, 0, Math.PI, Math.PI * 2);
  ctx.stroke();
  // rosa dos ventos de pedra ao sul (onde se nasce)
  const sx = bx + T(21) + 8;
  const sy = by + T(15) + 8;
  ctx.fillStyle = '#b9b2a4';
  ctx.beginPath();
  ctx.moveTo(sx, sy - 12);
  ctx.lineTo(sx + 4, sy);
  ctx.lineTo(sx, sy + 12);
  ctx.lineTo(sx - 4, sy);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(sx - 12, sy);
  ctx.lineTo(sx, sy - 4);
  ctx.lineTo(sx + 12, sy);
  ctx.lineTo(sx, sy + 4);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#f2a33a';
  ctx.fillRect(sx - 1, sy - 11, 2, 6);
  return c;
}

/** Chão de um jardim (lote vazio), por cima do gramado: caminho do portão, lago, deck ou canteiros. */
export function gardenCanvas(art: ArtModule, kind: GardenKind, north: boolean, seed: number): HTMLCanvasElement {
  const [c, ctx] = canvas(T(LOT.w), T(LOT.h));
  const gx = T(DOOR.dx);
  const path = (x: number, y: number, w: number, h: number) => {
    ctx.fillStyle = '#9a968c';
    ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
    safe(() => art.drawFloor(ctx, 'sidewalk', x, y, w, h, { seed: 12 + seed % 3 }));
  };
  const midY = T(LOT.h / 2);
  switch (kind) {
    case 'park': {
      // caminho do portão até o meio, e uma cruz
      if (north) path(gx, 0, T(2), midY + 8);
      else path(gx, midY - 8, T(2), T(LOT.h) - midY + 8);
      path(T(2), midY - 8, T(10), T(1));
      // canteiro redondo no centro
      ctx.fillStyle = '#6a4b35';
      ctx.beginPath();
      ctx.ellipse(T(7), midY + 14, 18, 7, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#b9b5aa';
      ctx.lineWidth = 2;
      ctx.stroke();
      break;
    }
    case 'pond': {
      if (north) path(gx, 0, T(2), T(2));
      else path(gx, T(LOT.h - 2), T(2), T(2));
      const cx = T(7);
      const cy = midY + (north ? 4 : -4);
      ctx.fillStyle = '#8d8a82';
      ctx.beginPath();
      ctx.ellipse(cx, cy, T(4.6), T(2.8), 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#3f7fa8';
      ctx.beginPath();
      ctx.ellipse(cx, cy, T(4.6) - 3, T(2.8) - 3, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#5aa0c8';
      ctx.beginPath();
      ctx.ellipse(cx - 6, cy - 6, T(3), T(1.4), 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      for (const [x, y] of [
        [cx - 30, cy - 4],
        [cx + 12, cy + 6],
        [cx + 28, cy - 8],
      ]) ctx.fillRect(x!, y!, 5, 1);
      // vitórias-régias
      ctx.fillStyle = '#4b8a45';
      for (const [x, y] of [
        [cx + 20, cy + 3],
        [cx - 22, cy + 8],
      ]) {
        ctx.beginPath();
        ctx.ellipse(x!, y!, 4, 2.5, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = '#f28fb0';
      ctx.fillRect(cx + 19, cy + 2, 2, 1);
      break;
    }
    case 'orchard': {
      ctx.fillStyle = 'rgba(106,75,53,0.55)';
      for (let j = 0; j < 2; j++) ctx.fillRect(T(1), T((north ? 3.4 : 2.4) + j * 4.4), T(12), 6);
      if (north) path(gx, 0, T(2), T(1.4));
      else path(gx, T(LOT.h - 1.4), T(2), T(1.4));
      break;
    }
    case 'cafe': {
      // deck de madeira com borda de pedra e o caminho do portão
      ctx.fillStyle = '#8d8a82';
      ctx.fillRect(T(2) - 2, midY - T(2) - 2, T(10) + 4, T(4) + 4);
      safe(() => art.drawFloor(ctx, 'wood', T(2), midY - T(2), T(10), T(4), { seed: 8 }));
      if (north) path(gx, 0, T(2), midY - T(2));
      else path(gx, midY + T(2), T(2), T(LOT.h) - midY - T(2));
      break;
    }
  }
  return c;
}

/**
 * Fonte da praça (bloqueia 4 × 3 tiles; o desenho passa um pouco para os lados): bacia octogonal de pedra com a
 * mureta à mostra, água, e o chafariz de duas taças no meio. A água que pula e as ondinhas são desenhadas por quadro
 * (scene.ts), a partir de `water` (centro da bacia) e `jet` (topo da taça de cima).
 */
export function fountainCanvas(): { canvas: HTMLCanvasElement; ax: number; ay: number; water: { x: number; y: number; rx: number; ry: number }; jet: { x: number; y: number } } {
  const w = T(6);
  const h = T(5);
  const [c, ctx] = canvas(w, h);
  const cx = w / 2;
  const base = h - 2;
  const rx = T(2.9);
  const ry = T(1.75);
  const wall = 7;
  const cy = base - wall - ry;
  const oct = (ox: number, oy: number, ax: number, ay: number) => {
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = Math.PI / 8 + (i * Math.PI) / 4;
      const x = ox + Math.cos(a) * ax;
      const y = oy + Math.sin(a) * ay;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
  };
  // sombra no chão
  ctx.fillStyle = 'rgba(28,36,52,0.22)';
  oct(cx + 4, cy + wall + 3, rx + 2, ry + 1);
  ctx.fill();
  // mureta (face) e tampa
  ctx.fillStyle = '#6f6a62';
  oct(cx, cy + wall, rx, ry);
  ctx.fill();
  ctx.fillRect(cx - rx * 0.92, cy, rx * 1.84, wall);
  ctx.fillStyle = '#9a948a';
  ctx.fillRect(cx - rx * 0.92, cy + 1, rx * 1.84, wall - 3);
  ctx.fillStyle = 'rgba(255,255,255,0.18)';
  for (let x = Math.round(cx - rx * 0.9); x < cx + rx * 0.9; x += 9) ctx.fillRect(x, cy + 2, 1, wall - 4);
  ctx.fillStyle = '#c9c3b6';
  oct(cx, cy, rx, ry);
  ctx.fill();
  ctx.fillStyle = '#e4dfd4';
  oct(cx, cy - 1, rx - 2, ry - 1.5);
  ctx.fill();
  // água
  ctx.fillStyle = '#2f75a8';
  oct(cx, cy + 1, rx - 6, ry - 5);
  ctx.fill();
  ctx.fillStyle = '#3f8bc2';
  oct(cx, cy, rx - 8, ry - 7);
  ctx.fill();
  ctx.fillStyle = 'rgba(160,214,245,0.55)';
  ctx.beginPath();
  ctx.ellipse(cx - rx * 0.35, cy - ry * 0.3, rx * 0.32, ry * 0.18, 0, 0, Math.PI * 2);
  ctx.fill();
  // pedestal, taça de baixo, coluna e taça de cima
  const p1 = cy - 3;
  ctx.fillStyle = '#7d776d';
  ctx.fillRect(cx - 4, p1 - 10, 8, 12);
  ctx.fillStyle = '#c9c3b6';
  ctx.fillRect(cx - 4, p1 - 10, 3, 12);
  const bowl = (y: number, r: number) => {
    ctx.fillStyle = '#6f6a62';
    ctx.beginPath();
    ctx.ellipse(cx, y + 2, r, r * 0.34, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#d8d2c6';
    ctx.beginPath();
    ctx.ellipse(cx, y, r, r * 0.32, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#4b9ad0';
    ctx.beginPath();
    ctx.ellipse(cx, y, r - 3, r * 0.32 - 2, 0, 0, Math.PI * 2);
    ctx.fill();
  };
  bowl(p1 - 11, 15);
  ctx.fillStyle = '#7d776d';
  ctx.fillRect(cx - 2, p1 - 24, 4, 13);
  ctx.fillStyle = '#c9c3b6';
  ctx.fillRect(cx - 2, p1 - 24, 2, 13);
  bowl(p1 - 25, 8);
  // pinha no topo
  ctx.fillStyle = '#d8d2c6';
  ctx.fillRect(cx - 1, p1 - 30, 3, 5);
  ctx.fillStyle = '#f2a33a';
  ctx.fillRect(cx, p1 - 32, 1, 2);
  return { canvas: c, ax: Math.round(cx), ay: base, water: { x: cx, y: cy, rx: rx - 8, ry: ry - 7 }, jet: { x: cx, y: p1 - 31 } };
}

/** Floreira de pedra com flores. */
export function planterCanvas(seed: number): { canvas: HTMLCanvasElement; ax: number; ay: number } {
  const [c, ctx] = canvas(24, 16);
  const rng = mulberry32(seed);
  ctx.fillStyle = 'rgba(28,36,52,0.2)';
  ctx.fillRect(3, 13, 20, 2);
  ctx.fillStyle = '#7d7a73';
  ctx.fillRect(2, 7, 20, 7);
  ctx.fillStyle = '#b9b5aa';
  ctx.fillRect(2, 7, 20, 2);
  ctx.fillStyle = '#5b3c25';
  ctx.fillRect(3, 6, 18, 2);
  const cols = ['#e8574a', '#f2c94c', '#f08bb0', '#ffffff', '#9b7be0'];
  for (let i = 0; i < 14; i++) {
    const x = 3 + Math.floor(rng() * 18);
    const y = 1 + Math.floor(rng() * 6);
    ctx.fillStyle = '#3f8550';
    ctx.fillRect(x, y + 1, 1, 2);
    ctx.fillStyle = cols[Math.floor(rng() * cols.length)]!;
    ctx.fillRect(x, y, 1, 1);
  }
  return { canvas: c, ax: 12, ay: 14 };
}

/** Tamanho (px) da célula de quarteirão. */
export const CELL_PX = { w: T(BLOCK_TILES.w + 2 * SIDEWALK + 5), h: T(BLOCK_TILES.h + 2 * SIDEWALK + 5) };
