import { afterEach, describe, expect, it, vi } from 'vitest';
import { createWorld } from './index';

type Rec = { hash: number; ops: string[] | null; w: number; h: number };

const recs = new WeakMap<object, Rec>();

function fnv(h: number, s: string): number {
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
}

function bytesHash(d: ArrayLike<number>): string {
  let h = 2166136261;
  for (let i = 0; i < d.length; i++) {
    h ^= d[i];
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h.toString(16);
}

function fmt(v: unknown): string {
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(3);
  if (typeof v === 'string') return JSON.stringify(v);
  if (v === null || v === undefined) return String(v);
  if (Array.isArray(v)) return `[${v.map(fmt).join(',')}]`;
  if (typeof v === 'object') {
    const r = recs.get(v as object);
    if (r) return `canvas(${r.w}x${r.h}#${r.hash.toString(16)})`;
    const data = (v as { data?: ArrayLike<number> }).data;
    if (data && typeof data.length === 'number') return `img#${bytesHash(data)}`;
    const tag = (v as { __tag?: string }).__tag;
    if (tag) return tag;
    return 'obj';
  }
  return typeof v;
}

class FakeImageData {
  data: Uint8ClampedArray;
  width: number;
  height: number;
  constructor(a: Uint8ClampedArray | number, b: number, c?: number) {
    if (typeof a === 'number') {
      this.width = a;
      this.height = b;
      this.data = new Uint8ClampedArray(Math.max(0, a * b * 4));
    } else {
      this.data = a;
      this.width = b;
      this.height = c ?? Math.floor(a.length / 4 / Math.max(1, b));
    }
  }
}

function makeCtx(canvas: { width: number; height: number }, rec: Rec): CanvasRenderingContext2D {
  const log = (s: string) => {
    rec.hash = fnv(rec.hash, s);
    rec.ops?.push(s);
  };
  const state: Record<string, unknown> = { globalAlpha: 1, font: '10px sans-serif', lineWidth: 1, globalCompositeOperation: 'source-over' };
  const special: Record<string, (...a: unknown[]) => unknown> = {
    getImageData: (_x, _y, w, h) => new FakeImageData(Math.max(1, Number(w)), Math.max(1, Number(h))),
    createImageData: (w, h) => (typeof w === 'object' ? new FakeImageData((w as FakeImageData).width, (w as FakeImageData).height) : new FakeImageData(Number(w), Number(h))),
    measureText: (t) => ({ width: String(t).length * 6, actualBoundingBoxAscent: 7, actualBoundingBoxDescent: 2 }),
    createPattern: (src) => ({ __tag: `pattern(${fmt(src)})`, setTransform: () => {} }),
    createLinearGradient: (...a) => ({ __tag: `lg(${a.map(fmt).join(',')})`, addColorStop: () => {} }),
    createRadialGradient: (...a) => ({ __tag: `rg(${a.map(fmt).join(',')})`, addColorStop: () => {} }),
    isPointInPath: () => false,
    getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
    getLineDash: () => [],
  };
  return new Proxy({} as CanvasRenderingContext2D, {
    get(_t, p: string) {
      if (p === 'canvas') return canvas;
      if (p in special) {
        const fn = special[p];
        return (...a: unknown[]) => {
          log(`${p}(${a.map(fmt).join(',')})`);
          return fn(...a);
        };
      }
      if (p in state) return state[p];
      return (...a: unknown[]) => log(`${p}(${a.map(fmt).join(',')})`);
    },
    set(_t, p: string, v) {
      state[p] = v;
      log(`${p}=${fmt(v)}`);
      return true;
    },
  });
}

function makeCanvas(record: boolean, extra: Record<string, unknown> = {}): HTMLCanvasElement {
  const rec: Rec = { hash: 2166136261, ops: record ? [] : null, w: 0, h: 0 };
  let ctx: CanvasRenderingContext2D | null = null;
  const target = Object.assign(new EventTarget(), {
    style: {} as Record<string, string>,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
    getContext: () => (ctx ??= makeCtx(target as unknown as { width: number; height: number }, rec)),
    ...extra,
  });
  let w = 300;
  let h = 150;
  Object.defineProperty(target, 'width', {
    get: () => w,
    set: (v: number) => {
      w = v;
      rec.w = v;
      rec.hash = fnv(rec.hash, `width=${v}`);
    },
  });
  Object.defineProperty(target, 'height', {
    get: () => h,
    set: (v: number) => {
      h = v;
      rec.h = v;
      rec.hash = fnv(rec.hash, `height=${v}`);
    },
  });
  rec.w = w;
  rec.h = h;
  recs.set(target, rec);
  return target as unknown as HTMLCanvasElement;
}

function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const T0 = Date.UTC(2026, 9, 22, 10, 30, 0);

function setupEnv(): { frames: ((ts: number) => void)[] } {
  const frames: ((ts: number) => void)[] = [];
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(T0);
  vi.spyOn(Math, 'random').mockImplementation(seeded(42));
  const doc = Object.assign(new EventTarget(), {
    hidden: false,
    fonts: new EventTarget(),
    createElement: (tag: string) => {
      if (tag !== 'canvas') throw new Error(`createElement(${tag})`);
      return makeCanvas(false);
    },
    querySelector: () => null,
  });
  vi.stubGlobal('document', doc);
  vi.stubGlobal('window', Object.assign(new EventTarget(), { devicePixelRatio: 1, innerWidth: 800, innerHeight: 600 }));
  vi.stubGlobal('ImageData', FakeImageData);
  vi.stubGlobal('requestAnimationFrame', vi.fn((cb: (ts: number) => void) => {
    frames.push(cb);
    return frames.length;
  }));
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 404 })));
  return { frames };
}

const store = () =>
  ({
    snapshot: { rev: 1, serverTime: T0, rooms: [], agents: [], accounts: [], meta: { demo: false, sources: [], startedAt: T0, version: 'golden' } },
    on: () => () => {},
  }) as unknown as Parameters<typeof createWorld>[1];

async function renderGolden(): Promise<{ text: string; count: number }> {
  const env = setupEnv();
  const canvas = makeCanvas(true, { clientWidth: 800, clientHeight: 600 });
  const world = createWorld(canvas, store());
  await Promise.resolve();
  await Promise.resolve();
  const ids = [world.debug.spawnSession({ project: 'alpha', subs: 1 }), world.debug.spawnSession({ project: 'beta', subs: 2 })];
  world.debug.setHour(15);
  const rec = recs.get(canvas)!;
  let ts = 1000;
  const step = (n: number) => {
    for (let i = 0; i < n; i++) {
      vi.setSystemTime(T0 + ts);
      ts += 1000 / 30;
      const cb = env.frames.shift();
      cb?.(ts);
    }
  };
  step(90);
  world.select({ type: 'agent', id: ids[0] });
  step(20);
  world.select({ type: 'room', id: [...world.debug.sim.rooms.keys()][0] });
  rec.ops!.length = 0;
  step(3);
  const text = rec.ops!.join('\n');
  world.destroy();
  return { text, count: rec.ops!.length };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('patch G golden (pixel path)', () => {
  it('createWorld without projection/renderer draws the recorded upstream frame sequence', async () => {
    const out = await renderGolden();
    expect(out.count).toBeGreaterThan(500);
    await expect(out.text).toMatchFileSnapshot('./__golden__/pixel-frames.txt');
  });

  it('is deterministic across runs', async () => {
    const a = await renderGolden();
    const b = await renderGolden();
    expect(b.text).toBe(a.text);
  });
});
