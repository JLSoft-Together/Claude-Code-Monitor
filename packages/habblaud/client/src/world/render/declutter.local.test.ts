import { describe, expect, it } from 'vitest';
import { boxesOverlap, Declutter, DECLUTTER_HOLD_MS, type DeclutterBox, type DeclutterItem } from './declutter';

const W = 60;
const H = 14;

function tag(id: string, rank: number, x: number, y: number, forced = false): DeclutterItem {
  const half = H / 2;
  return { id, rank, forced, cands: [0, half, -half, H, -H].map((dy) => ({ x, y: y + dy, w: W, h: H })) };
}

function shownBoxes(items: DeclutterItem[], res: ReturnType<Declutter['run']>): DeclutterBox[] {
  return res.flatMap((r, i) => (r.placed ? [items[i]!.cands[r.index]!] : []));
}

function noOverlap(boxes: DeclutterBox[]): boolean {
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) if (boxesOverlap(boxes[i]!, boxes[j]!)) return false;
  return true;
}

function crowd(n: number, seed = 1): DeclutterItem[] {
  let s = seed;
  const rnd = () => ((s = (s * 1103515245 + 12345) >>> 0) / 2 ** 32);
  return Array.from({ length: n }, (_, i) => tag(`l:${i}`, i < 2 ? 3000 : i < 5 ? 2000 : 1000, 100 + rnd() * 160, 100 + rnd() * 90));
}

describe('local patch G: label declutter', () => {
  it('placed tags never overlap each other or the obstacles', () => {
    const d = new Declutter();
    const items = crowd(18);
    const obstacles = [150, 120, 40, 20];
    const res = d.run(items, obstacles, 0, 16);
    const boxes = shownBoxes(items, res);
    expect(boxes.length).toBeGreaterThan(3);
    expect(boxes.length).toBeLessThan(18);
    expect(noOverlap(boxes)).toBe(true);
    expect(boxes.some((b) => boxesOverlap(b, { x: 150, y: 120, w: 40, h: 20 }))).toBe(false);
  });

  it('handles ~100 items with no overlaps', () => {
    const d = new Declutter();
    const items = crowd(100, 7);
    const t0 = performance.now();
    const res = d.run(items, [], 0, 16);
    expect(performance.now() - t0).toBeLessThan(50);
    expect(noOverlap(shownBoxes(items, res))).toBe(true);
  });

  it('higher rank wins a contested spot, whatever the input order', () => {
    for (const flip of [false, true]) {
      const d = new Declutter();
      const a = tag('l:idle-sub', 1000, 100, 100);
      const b = tag('l:waiting', 4000, 100, 100);
      const items = flip ? [b, a] : [a, b];
      a.cands = [a.cands[0]!];
      b.cands = [b.cands[0]!];
      const res = d.run(items, [], 0, 16);
      const win = items.indexOf(b);
      expect(res[win]!.placed).toBe(true);
      expect(res[1 - win]!.placed).toBe(false);
    }
  });

  it('nudges a tag vertically by at most one tag height before hiding it', () => {
    const d = new Declutter();
    const a = tag('l:a', 3000, 100, 100);
    const b = tag('l:b', 2000, 110, 100);
    const res = d.run([a, b], [], 0, 16);
    expect(res[0]).toMatchObject({ placed: true, index: 0 });
    expect(res[1]!.placed).toBe(true);
    const box = b.cands[res[1]!.index]!;
    expect(Math.abs(box.y - 100)).toBeGreaterThan(0);
    expect(Math.abs(box.y - 100)).toBeLessThanOrEqual(H);
  });

  it('forced items (selected / hovered) are always placed, even on top of others', () => {
    const d = new Declutter();
    const a = tag('l:a', 3000, 100, 100);
    const sel = tag('l:sel', 6000, 100, 100, true);
    const obstacles: number[] = [];
    for (let y = 60; y < 140; y += 10) obstacles.push(80, y, 120, 10);
    const res = d.run([a, sel], obstacles, 0, 16);
    expect(res[1]!.placed).toBe(true);
    expect(res[0]!.placed).toBe(false);
  });

  it('is stable frame to frame: same input keeps the same picks, small moves keep the placement', () => {
    const d = new Declutter();
    let items = crowd(18, 3);
    const first = d.run(items, [], 0, 16).map((r) => `${r.placed}:${r.index}`);
    for (let f = 1; f < 30; f++) {
      const again = d.run(items, [], f * 16, 16).map((r) => `${r.placed}:${r.index}`);
      expect(again).toEqual(first);
    }
    const placedBefore = d.run(items, [], 500, 16).map((r) => r.placed);
    items = items.map((it, i) => ({ ...it, cands: it.cands.map((c) => ({ ...c, x: c.x + (i % 2 ? 0.4 : -0.4) })) }));
    const placedAfter = d.run(items, [], 516, 16).map((r) => r.placed);
    expect(placedAfter.filter((p, i) => p !== placedBefore[i]).length).toBeLessThanOrEqual(1);
  });

  it('a shown tag keeps its previous slot over an equal-rank newcomer', () => {
    const d = new Declutter();
    const a = tag('l:z-late-id', 1000, 100, 100);
    a.cands = [a.cands[0]!];
    d.run([a], [], 0, 16);
    const b = tag('l:a-early-id', 1000, 100, 100);
    b.cands = [b.cands[0]!];
    const res = d.run([b, a], [], 16, 16);
    expect(res[1]!.placed).toBe(true);
    expect(res[0]!.placed).toBe(false);
  });

  it('a hidden tag waits before coming back (hysteresis) and fades in and out', () => {
    const d = new Declutter();
    const low = tag('l:low', 1000, 100, 100);
    low.cands = [low.cands[0]!];
    const high = tag('l:high', 3000, 100, 100);
    high.cands = [high.cands[0]!];
    expect(d.run([low], [], 0, 16)[0]).toMatchObject({ placed: true, alpha: 1 });
    const hidden = d.run([low, high], [], 16, 16)[0]!;
    expect(hidden.placed).toBe(false);
    expect(hidden.alpha).toBeGreaterThan(0);
    expect(hidden.alpha).toBeLessThan(1);
    expect(hidden.index).toBe(0);
    let r = d.run([low], [], 32, 16)[0]!;
    expect(r.placed).toBe(false);
    r = d.run([low], [], 16 + DECLUTTER_HOLD_MS + 1, 16)[0]!;
    expect(r.placed).toBe(true);
    expect(r.alpha).toBeLessThan(1);
    for (let t = 0; t < 20; t++) r = d.run([low], [], 400 + t * 16, 16)[0]!;
    expect(r.alpha).toBe(1);
  });
});
