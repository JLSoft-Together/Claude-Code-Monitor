import { afterEach, describe, expect, it, vi } from 'vitest';
import { createWorld } from './index';
import type { RendererFactory, WorldRenderer } from './projection';
import * as artModule from '../art';
import { Camera } from './camera';
import { Renderer } from './render/renderer';

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

function ctxStub(): CanvasRenderingContext2D {
  const state: Record<string, unknown> = { globalAlpha: 1, lineWidth: 1 };
  const special: Record<string, (...a: never[]) => unknown> = {
    getImageData: (_x: number, _y: number, w: number, h: number) => new FakeImageData(Math.max(1, w), Math.max(1, h)),
    createImageData: (w: number, h: number) => new FakeImageData(w, h),
    measureText: (t: string) => ({ width: String(t).length * 6 }),
    createPattern: () => ({ setTransform: () => {} }),
    createLinearGradient: () => ({ addColorStop: () => {} }),
    createRadialGradient: () => ({ addColorStop: () => {} }),
  };
  return new Proxy({} as CanvasRenderingContext2D, {
    get(_t, p: string) {
      if (p in special) return special[p];
      if (p in state) return state[p];
      return () => {};
    },
    set(_t, p: string, v) {
      state[p] = v;
      return true;
    },
  });
}

function canvasStub(): HTMLCanvasElement {
  let ctx: CanvasRenderingContext2D | null = null;
  return Object.assign(new EventTarget(), {
    clientWidth: 1280,
    clientHeight: 800,
    width: 1280,
    height: 800,
    style: {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 800 }),
    getContext: () => (ctx ??= ctxStub()),
  }) as unknown as HTMLCanvasElement;
}

function stubEnv(): { frames: ((ts: number) => void)[]; fetch: ReturnType<typeof vi.fn> } {
  const frames: ((ts: number) => void)[] = [];
  const fetch = vi.fn(async () => new Response(null, { status: 404 }));
  vi.stubGlobal('document', Object.assign(new EventTarget(), { hidden: false, fonts: new EventTarget(), createElement: () => canvasStub(), querySelector: () => null }));
  vi.stubGlobal('window', Object.assign(new EventTarget(), { devicePixelRatio: 1, innerWidth: 1280, innerHeight: 800 }));
  vi.stubGlobal('ImageData', FakeImageData);
  vi.stubGlobal(
    'requestAnimationFrame',
    vi.fn((cb: (ts: number) => void) => {
      frames.push(cb);
      return frames.length;
    }),
  );
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  vi.stubGlobal('fetch', fetch);
  return { frames, fetch };
}

const emptyStore = () => ({ snapshot: null, on: () => () => {} }) as unknown as Parameters<typeof createWorld>[1];

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('world warm-up and ready (Orrery patch I)', () => {
  it('fires onReady once, after the first frame whose renderer is settled', () => {
    const env = stubEnv();
    let settled = false;
    const warm = vi.fn();
    const made: WorldRenderer[] = [];
    const factory: RendererFactory = (c, a, s, cam) => {
      const r = new Renderer(c, a, s, cam) as unknown as WorldRenderer & { settled(): boolean; warmUp(ms: number): void };
      r.settled = () => settled;
      r.warmUp = warm;
      made.push(r);
      return r;
    };
    const world = createWorld(canvasStub(), emptyStore(), { renderer: factory, warmUpMs: 8 });
    expect(warm).toHaveBeenCalledWith(8);
    const ready = vi.fn();
    world.onReady!(ready);
    let ts = 0;
    const step = () => env.frames.shift()?.((ts += 16));
    step();
    step();
    expect(ready).not.toHaveBeenCalled();
    settled = true;
    step();
    expect(ready).toHaveBeenCalledTimes(1);
    step();
    expect(ready).toHaveBeenCalledTimes(1);
    const late = vi.fn();
    world.onReady!(late);
    expect(late).toHaveBeenCalledTimes(1);
    world.setPlayback!({ clock: () => Date.now(), scale: () => 1 });
    expect(made).toHaveLength(2);
    expect(warm).toHaveBeenCalledTimes(1);
    world.destroy();
  });

  it('an unsubscribed or destroyed world never calls back', () => {
    const env = stubEnv();
    const world = createWorld(canvasStub(), emptyStore(), { warmUpMs: 8 });
    const off = vi.fn();
    world.onReady!(off)();
    const gone = vi.fn();
    world.onReady!(gone);
    world.destroy();
    env.frames.shift()?.(16);
    expect(off).not.toHaveBeenCalled();
    expect(gone).not.toHaveBeenCalled();
  });

  it('uses preloaded assets instead of fetching the manifest, and fetches without them', () => {
    const env = stubEnv();
    const setAssets = vi.spyOn(Renderer.prototype, 'setAssets');
    const assets = { wallArt: [] };
    createWorld(canvasStub(), emptyStore(), { assets }).destroy();
    expect(setAssets).toHaveBeenCalledWith(assets);
    expect(env.fetch).not.toHaveBeenCalled();
    createWorld(canvasStub(), emptyStore(), { assets: null }).destroy();
    expect(env.fetch).not.toHaveBeenCalled();
    createWorld(canvasStub(), emptyStore()).destroy();
    expect(env.fetch).toHaveBeenCalled();
  });

  function populated(): { world: ReturnType<typeof createWorld>; total: () => number } {
    const env = stubEnv();
    vi.useFakeTimers({ toFake: ['Date'] });
    const T0 = Date.UTC(2026, 9, 22, 9, 0, 0);
    vi.setSystemTime(T0);
    const store = {
      snapshot: { rev: 1, serverTime: T0, rooms: [], agents: [], accounts: [], meta: { demo: false, sources: [], startedAt: T0, version: 'warm' } },
      on: () => () => {},
    } as unknown as Parameters<typeof createWorld>[1];
    const world = createWorld(canvasStub(), store);
    for (let i = 0; i < 6; i++) world.debug.spawnSession({ project: `p${i}`, subs: 1 });
    let ts = 0;
    for (let i = 0; i < 240; i++) {
      ts += 1000 / 60;
      vi.setSystemTime(T0 + ts);
      env.frames.shift()?.(ts);
    }
    const sim = world.debug.sim;
    return { world, total: () => sim.building.core.length + 1 + [...sim.rooms.values()].filter((x) => x.present).length };
  }

  it('pixel Renderer.warmUp builds areas within the budget per sync, then drops the budget', () => {
    const { world, total } = populated();
    const sim = world.debug.sim;
    expect(total()).toBeGreaterThan(8);
    const r = new Renderer(canvasStub(), artModule, sim, new Camera());
    let clock = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => (clock += 3));
    r.warmUp(8);
    const sizes: number[] = [];
    for (let i = 0; i < 40 && (i === 0 || !r.settled()); i++) {
      r.sync();
      sizes.push(r.areas.size);
    }
    expect(r.areas.size).toBe(total());
    const steps = sizes.map((n, i) => n - (i ? sizes[i - 1]! : 0));
    expect(steps.length).toBeGreaterThan(2);
    for (const d of steps) {
      expect(d).toBeGreaterThan(0);
      expect(d).toBeLessThanOrEqual(3);
    }
    for (const d of sizes.slice(0, -1)) expect(d).toBeLessThan(total());
    const fresh = new Renderer(canvasStub(), artModule, sim, new Camera());
    fresh.sync();
    expect(fresh.areas.size).toBe(total());
    expect(fresh.settled()).toBe(true);
    world.destroy();
    vi.useRealTimers();
  });

  it('a settled pixel Renderer builds new rooms unbudgeted again', () => {
    const { world, total } = populated();
    const r = new Renderer(canvasStub(), artModule, world.debug.sim, new Camera());
    let clock = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => (clock += 3));
    r.warmUp(1);
    for (let i = 0; i < 40 && (i === 0 || !r.settled()); i++) r.sync();
    expect(r.settled()).toBe(true);
    const r2 = new Renderer(canvasStub(), artModule, world.debug.sim, new Camera());
    r2.warmUp(1);
    r2.sync();
    expect(r2.settled()).toBe(false);
    expect(r2.areas.size).toBeLessThan(total());
    for (let i = 0; i < 40 && !r2.settled(); i++) r2.sync();
    for (const vis of [...r2.areas.values()]) if (vis.room) r2.areas.delete(vis.id);
    r2.sync();
    expect(r2.areas.size).toBe(total());
    world.destroy();
    vi.useRealTimers();
  });
});
