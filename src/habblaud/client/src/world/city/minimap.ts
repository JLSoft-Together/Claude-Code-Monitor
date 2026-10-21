// Minimapa (canto inferior direito): os quarteirões em volta do jogador, cada um mais aceso quanto mais prédios
// `online` tem (o `minimap` do servidor, grosseiro de propósito), a praça, o retângulo da câmera e o ponto do
// jogador. Clicar leva a CÂMERA até lá (o jogador fica onde está). O modelo é puro; o desenho é um canvas pequeno.
import { tr } from '../../../../shared/i18n';
import { BLOCK, BLOCK_STRIDE, BLOCK_TILES, PLAZA, blockAt } from '../../../../shared/world/city';
import { h } from '../../ui/dom';

/** Quarteirões para cada lado do do jogador. */
export const MINIMAP_RADIUS = 4;
/** Prédios por quarteirão (o máximo de `lit`). */
const LOTS_PER_BLOCK = BLOCK.w * BLOCK.h;

export interface MinimapCell {
  bx: number;
  by: number;
  /** Retângulo em px do minimapa. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** 0..1: intensidade da luz (prédios acesos / 6). */
  light: number;
  /** O servidor listou este quarteirão (tem ao menos um prédio). */
  occupied: boolean;
  plaza: boolean;
}

export interface MinimapModel {
  cells: MinimapCell[];
  /** Ponto do jogador (px do minimapa). */
  me: { x: number; y: number };
  /** Retângulo visível da câmera (px do minimapa). */
  view: { x: number; y: number; w: number; h: number };
  /** px do minimapa por tile. */
  k: number;
  /** Tile no centro do minimapa. */
  cx: number;
  cy: number;
}

/** Intensidade da luz de um quarteirão: cresce rápido no começo (um prédio aceso já aparece). */
export function blockLight(lit: number): number {
  if (!(lit > 0)) return 0;
  return Math.min(1, 0.35 + (0.65 * Math.min(lit, LOTS_PER_BLOCK)) / LOTS_PER_BLOCK);
}

/**
 * Layout do minimapa de `size` px, centrado no quarteirão do jogador (`me` em tiles). `view` = retângulo visível da
 * câmera em tiles.
 */
export function minimapModel(
  blocks: readonly { x: number; y: number; lit: number }[],
  me: { x: number; y: number },
  view: { x: number; y: number; w: number; h: number },
  size: { w: number; h: number },
  radius = MINIMAP_RADIUS,
): MinimapModel {
  const home = blockAt(me.x, me.y);
  const spanX = (2 * radius + 1) * BLOCK_STRIDE.x;
  const spanY = (2 * radius + 1) * BLOCK_STRIDE.y;
  const k = Math.min(size.w / spanX, size.h / spanY);
  // centro: o meio do quarteirão do jogador
  const cx = home.x * BLOCK_STRIDE.x + BLOCK_TILES.w / 2;
  const cy = home.y * BLOCK_STRIDE.y + BLOCK_TILES.h / 2;
  const toX = (tx: number) => size.w / 2 + (tx - cx) * k;
  const toY = (ty: number) => size.h / 2 + (ty - cy) * k;
  const lit = new Map<string, number>();
  for (const b of blocks) lit.set(`${b.x},${b.y}`, b.lit);
  const cells: MinimapCell[] = [];
  for (let by = home.y - radius - 1; by <= home.y + radius + 1; by++) {
    for (let bx = home.x - radius - 1; bx <= home.x + radius + 1; bx++) {
      const x = toX(bx * BLOCK_STRIDE.x);
      const y = toY(by * BLOCK_STRIDE.y);
      const w = BLOCK_TILES.w * k;
      const hh = BLOCK_TILES.h * k;
      if (x + w < 0 || y + hh < 0 || x > size.w || y > size.h) continue;
      const key = `${bx},${by}`;
      const n = lit.get(key);
      cells.push({ bx, by, x, y, w, h: hh, light: blockLight(n ?? 0), occupied: n !== undefined, plaza: bx === PLAZA.x && by === PLAZA.y });
    }
  }
  return { cells, me: { x: toX(me.x), y: toY(me.y) }, view: { x: toX(view.x), y: toY(view.y), w: view.w * k, h: view.h * k }, k, cx, cy };
}

/** Tile do mundo sob um ponto do minimapa. */
export function minimapToTile(m: Pick<MinimapModel, 'k' | 'cx' | 'cy'>, size: { w: number; h: number }, px: number, py: number): { x: number; y: number } {
  return { x: m.cx + (px - size.w / 2) / m.k, y: m.cy + (py - size.h / 2) / m.k };
}

// ====================================================================== DOM

export class Minimap {
  readonly el: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private model: MinimapModel | null = null;
  private size = { w: 176, h: 116 };
  private sig = '';

  constructor(onPick: (tile: { x: number; y: number }) => void) {
    this.canvas = h('canvas', { class: 'ui-city-minimap__canvas', attrs: { 'aria-hidden': 'true' } });
    this.ctx = this.canvas.getContext('2d')!;
    this.el = h(
      'nav',
      { class: 'ui-city-minimap', attrs: { 'aria-label': tr('Minimapa: clique para levar a câmera até lá') }, title: tr('Minimapa: clique para levar a câmera até lá') },
      this.canvas,
    );
    this.canvas.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!this.model) return;
      const r = this.canvas.getBoundingClientRect();
      onPick(minimapToTile(this.model, this.size, e.clientX - r.left, e.clientY - r.top));
    });
  }

  /** Redesenha se algo mudou (o jogador anda, a câmera mexe, o servidor manda o minimapa novo). */
  draw(blocks: readonly { x: number; y: number; lit: number }[], version: number, me: { x: number; y: number }, view: { x: number; y: number; w: number; h: number }): void {
    const cw = this.canvas.clientWidth || this.size.w;
    const ch = this.canvas.clientHeight || this.size.h;
    const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    const sig = `${version}|${Math.round(me.x * 2)}|${Math.round(me.y * 2)}|${Math.round(view.x)}|${Math.round(view.y)}|${Math.round(view.w)}|${cw}|${ch}|${dpr}`;
    if (sig === this.sig) return;
    this.sig = sig;
    this.size = { w: cw, h: ch };
    if (this.canvas.width !== Math.round(cw * dpr) || this.canvas.height !== Math.round(ch * dpr)) {
      this.canvas.width = Math.round(cw * dpr);
      this.canvas.height = Math.round(ch * dpr);
    }
    const m = (this.model = minimapModel(blocks, me, view, this.size));
    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cw, ch);
    // ruas (o fundo) e quarteirões
    ctx.fillStyle = '#2a2f3a';
    ctx.fillRect(0, 0, cw, ch);
    for (const c of m.cells) {
      const x = Math.round(c.x);
      const y = Math.round(c.y);
      const w = Math.max(2, Math.round(c.w));
      const hh = Math.max(2, Math.round(c.h));
      if (c.plaza) ctx.fillStyle = '#b9b2a4';
      else if (c.light > 0) ctx.fillStyle = `rgba(255,206,110,${(0.25 + c.light * 0.75).toFixed(3)})`;
      else ctx.fillStyle = c.occupied ? '#55607a' : '#3a5a45';
      ctx.fillRect(x, y, w, hh);
      if (c.light > 0) {
        ctx.fillStyle = `rgba(255,240,200,${(c.light * 0.5).toFixed(3)})`;
        ctx.fillRect(x + 1, y + 1, Math.max(1, w - 2), 1);
      }
      if (c.plaza) {
        ctx.fillStyle = '#5ea8d6';
        ctx.fillRect(Math.round(x + w / 2 - 1), Math.round(y + hh / 2 - 1), 2, 2);
      }
    }
    // retângulo da câmera
    ctx.strokeStyle = 'rgba(232,236,245,0.75)';
    ctx.lineWidth = 1;
    ctx.strokeRect(Math.round(m.view.x) + 0.5, Math.round(m.view.y) + 0.5, Math.max(2, Math.round(m.view.w)), Math.max(2, Math.round(m.view.h)));
    // eu
    ctx.fillStyle = '#12151d';
    ctx.fillRect(Math.round(m.me.x) - 3, Math.round(m.me.y) - 3, 6, 6);
    ctx.fillStyle = '#7cc8ff';
    ctx.fillRect(Math.round(m.me.x) - 2, Math.round(m.me.y) - 2, 4, 4);
  }
}
