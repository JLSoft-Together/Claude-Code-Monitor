export interface DeclutterBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface DeclutterItem {
  id: string;
  rank: number;
  forced: boolean;
  cands: DeclutterBox[];
}

export interface DeclutterPick {
  placed: boolean;
  index: number;
  alpha: number;
}

interface Memory {
  pick: number;
  last: number;
  alpha: number;
  hiddenAt: number;
  seenAt: number;
}

export const DECLUTTER_FADE_MS = 160;
export const DECLUTTER_HOLD_MS = 300;
export const DECLUTTER_FORGET_MS = 3000;
const CELL = 64;

class Grid {
  private cells = new Map<number, number[]>();
  private boxes: number[] = [];

  reset(): void {
    this.cells.clear();
    this.boxes.length = 0;
  }

  private key(cx: number, cy: number): number {
    return (cx + 32768) * 65536 + (cy + 32768);
  }

  add(x: number, y: number, w: number, h: number): void {
    const i = this.boxes.length / 4;
    this.boxes.push(x, y, w, h);
    const x0 = Math.floor(x / CELL);
    const x1 = Math.floor((x + w) / CELL);
    const y0 = Math.floor(y / CELL);
    const y1 = Math.floor((y + h) / CELL);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cy = y0; cy <= y1; cy++) {
        const k = this.key(cx, cy);
        const list = this.cells.get(k);
        if (list) list.push(i);
        else this.cells.set(k, [i]);
      }
    }
  }

  hits(x: number, y: number, w: number, h: number): boolean {
    const b = this.boxes;
    const x0 = Math.floor(x / CELL);
    const x1 = Math.floor((x + w) / CELL);
    const y0 = Math.floor(y / CELL);
    const y1 = Math.floor((y + h) / CELL);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cy = y0; cy <= y1; cy++) {
        const list = this.cells.get(this.key(cx, cy));
        if (!list) continue;
        for (const i of list) {
          const o = i * 4;
          if (x < b[o] + b[o + 2] && x + w > b[o] && y < b[o + 1] + b[o + 3] && y + h > b[o + 1]) return true;
        }
      }
    }
    return false;
  }
}

export function boxesOverlap(a: DeclutterBox, b: DeclutterBox): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

export class Declutter {
  private mem = new Map<string, Memory>();
  private grid = new Grid();
  private order: number[] = [];

  get size(): number {
    return this.mem.size;
  }

  run(items: readonly DeclutterItem[], obstacles: readonly number[], now: number, dt: number): DeclutterPick[] {
    const grid = this.grid;
    grid.reset();
    for (let i = 0; i + 3 < obstacles.length; i += 4) grid.add(obstacles[i], obstacles[i + 1], obstacles[i + 2], obstacles[i + 3]);
    const mem = this.mem;
    const order = this.order;
    order.length = items.length;
    const shown = (i: number) => {
      const m = mem.get(items[i].id);
      return m && m.pick >= 0 ? 1 : 0;
    };
    for (let i = 0; i < items.length; i++) order[i] = i;
    order.sort((a, b) => items[b].rank - items[a].rank || shown(b) - shown(a) || (items[a].id < items[b].id ? -1 : items[a].id > items[b].id ? 1 : 0));
    const out: DeclutterPick[] = new Array(items.length);
    const step = dt > 0 ? Math.min(1, dt / DECLUTTER_FADE_MS) : 1;
    for (const i of order) {
      const it = items[i];
      const n = it.cands.length;
      const m = mem.get(it.id);
      const prev = m && m.pick >= 0 && m.pick < n ? m.pick : -1;
      const fits = (c: number) => {
        const b = it.cands[c];
        return !grid.hits(b.x, b.y, b.w, b.h);
      };
      let pick = prev >= 0 && fits(prev) ? prev : -1;
      for (let c = 0; pick < 0 && c < n; c++) if (c !== prev && fits(c)) pick = c;
      if (pick >= 0 && m && m.pick < 0 && !it.forced && now - m.hiddenAt < DECLUTTER_HOLD_MS) pick = -1;
      if (pick < 0 && it.forced && n) pick = prev >= 0 ? prev : 0;
      if (pick >= 0) {
        const b = it.cands[pick];
        grid.add(b.x, b.y, b.w, b.h);
      }
      const alpha = pick >= 0 ? (m ? Math.min(1, m.alpha + step) : 1) : m ? Math.max(0, m.alpha - step) : 0;
      const last = pick >= 0 ? pick : m && m.last < n ? m.last : -1;
      if (m) {
        if (pick < 0 && m.pick >= 0) m.hiddenAt = now;
        m.pick = pick;
        m.last = last;
        m.alpha = alpha;
        m.seenAt = now;
      } else mem.set(it.id, { pick, last, alpha, hiddenAt: pick < 0 ? now : -Infinity, seenAt: now });
      out[i] = { placed: pick >= 0, index: alpha > 0 ? last : -1, alpha };
    }
    if (mem.size > items.length * 2 + 32) for (const [id, m] of mem) if (now - m.seenAt > DECLUTTER_FORGET_MS) mem.delete(id);
    return out;
  }

  reset(): void {
    this.mem.clear();
  }
}
