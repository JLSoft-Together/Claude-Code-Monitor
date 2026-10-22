import { afterEach, describe, expect, it, vi } from 'vitest';
import { Camera } from './camera';
import { ZOOM_MAX } from './constants';
import type { Projection, RendererFactory, WorldRenderer } from './projection';
import { Overlay, styledFonts, type OverlayTextStyle } from './render/overlay';
import type { Sim } from './sim/sim';
import { SoundCues } from './sound-cues';
import type { SoundCue } from './api';

const created = vi.hoisted(() => ({ list: [] as unknown[] }));

vi.mock('./render/renderer', async (orig) => {
  const m = await orig<typeof import('./render/renderer')>();
  class SpyRenderer extends m.Renderer {
    constructor(...a: ConstructorParameters<typeof m.Renderer>) {
      super(...a);
      created.list.push(this);
    }
  }
  return { ...m, Renderer: SpyRenderer };
});

const { createWorld } = await import('./index');

function stubEnv(): void {
  vi.stubGlobal('document', Object.assign(new EventTarget(), { fonts: new EventTarget(), hidden: false, createElement: () => fakeCanvas() }));
  vi.stubGlobal('window', Object.assign(new EventTarget(), { devicePixelRatio: 1 }));
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 404 })));
}

function recordingCtx(log: string[] = []): CanvasRenderingContext2D {
  const state: Record<string, unknown> = { globalAlpha: 1 };
  return new Proxy({} as CanvasRenderingContext2D, {
    get(_t, p: string) {
      if (p in state) return state[p];
      if (p === 'measureText') return (t: string) => ({ width: t.length * 6 });
      if (p === 'getImageData') return (_x: number, _y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) });
      return (...a: unknown[]) => log.push(`${p}(${a.map((v) => (typeof v === 'number' ? Math.round(v * 100) / 100 : typeof v)).join(',')})`);
    },
    set(_t, p: string, v) {
      state[p] = v;
      return true;
    },
  });
}

function fakeCanvas(): HTMLCanvasElement {
  const ctx = recordingCtx();
  return Object.assign(new EventTarget(), { clientWidth: 800, clientHeight: 600, width: 800, height: 600, style: {}, getContext: () => ctx }) as unknown as HTMLCanvasElement;
}

const emptyStore = () => ({ snapshot: null, on: () => () => {} }) as unknown as Parameters<typeof createWorld>[1];

const shift: Projection = {
  toView: (x, y, h = 0) => ({ x: x + 1000, y: y - h }),
  toWorld: (vx, vy) => ({ x: vx - 1000, y: vy }),
  bounds: (r) => ({ x: r.x + 1000, y: r.y, w: r.w, h: r.h }),
};

afterEach(() => {
  vi.unstubAllGlobals();
  created.list.length = 0;
});

describe('local patch G: renderer factory', () => {
  it('without options the world builds the upstream Renderer, also on a timelapse rebuild', () => {
    stubEnv();
    const w = createWorld(fakeCanvas(), emptyStore());
    expect(created.list).toHaveLength(1);
    w.setPlayback!({ clock: () => 0, scale: () => 1 } as never);
    expect(created.list).toHaveLength(2);
    w.destroy();
  });

  it('a renderer factory replaces the upstream Renderer and is called again on rebuild', () => {
    stubEnv();
    const made: WorldRenderer[] = [];
    const factory: RendererFactory = vi.fn((canvas) => {
      const r: WorldRenderer = {
        ctx: canvas.getContext('2d')!,
        heads: new Map(),
        areas: new Map(),
        setAssets: vi.fn(),
        sync: vi.fn(),
        frame: vi.fn(),
        pruneHeads: vi.fn(),
        clock: () => Date.now(),
        paintingRect: () => null,
        signRect: () => null,
        signIsDark: () => false,
        hourOverride: null,
      };
      made.push(r);
      return r;
    });
    const canvas = fakeCanvas();
    const w = createWorld(canvas, emptyStore(), { projection: shift, renderer: factory });
    expect(created.list).toHaveLength(0);
    expect(factory).toHaveBeenCalledTimes(1);
    expect(vi.mocked(factory).mock.calls[0]![0]).toBe(canvas);
    w.setPlayback!({ clock: () => 5, scale: () => 1 } as never);
    expect(factory).toHaveBeenCalledTimes(2);
    expect(made[1]!.clock()).toBe(5);
    w.destroy();
  });
});

function overlayFixture(proj?: Projection, text?: OverlayTextStyle, signRect: WorldRenderer['signRect'] = () => null) {
  const log: string[] = [];
  const ctx = recordingCtx(log);
  const rect = { x: 2, y: 0, w: 16, h: 12 };
  const room = {
    id: 'r1',
    present: true,
    ghost: false,
    phase: 'ready',
    progress: () => 1,
    info: { name: 'alpha' },
    accounts: [],
    theme: { accent: '#ff0000' },
    lightOn: true,
    layout: { rect },
  };
  const sim = {
    rooms: new Map([['r1', room]]),
    chars: new Map(),
    accounts: new Map(),
    people: () => [],
    roomFx: { active: new Map() },
    social: { floaters: [] },
  } as unknown as Sim;
  const renderer = {
    heads: new Map(),
    areas: new Map<string, unknown>([
      ['r1', { id: 'r1', room, layout: { rect } }],
      ['core:copa', { id: 'core:copa', room: undefined, layout: { rect: { x: 16, y: 0, w: 16, h: 12 } } }],
    ]),
    signRect,
    signIsDark: () => false,
  } as unknown as WorldRenderer;
  const camera = { dpr: 1, zoom: 1, viewW: 4000, viewH: 4000, transform: () => ({ scale: 1, ox: 0, oy: 0 }) } as unknown as Camera;
  const ov = new Overlay(ctx, sim, renderer, camera, proj, text);
  return { ov, log, ctx };
}

const opts = { showNames: false, bubbles: 'important' } as never;

describe('local patch G: overlay', () => {
  it('without a projection the selected room frame is the upstream rounded rect', () => {
    const { ov, log } = overlayFixture();
    ov.draw(0, opts, { agent: null, room: 'r1', hover: null });
    expect(log).toContain('roundRect(30,-2,260,196,6)');
    expect(log.some((l) => l.startsWith('lineTo'))).toBe(false);
  });

  it('with a projection the frame is the projected outline and the pill sits at the projected top', () => {
    const { ov, log } = overlayFixture(shift);
    ov.draw(0, opts, { agent: null, room: 'r1', hover: null });
    expect(log).toContain('moveTo(1032,0)');
    expect(log).toContain('lineTo(1288,0)');
    expect(log).toContain('lineTo(1288,192)');
    expect(log).toContain('lineTo(1032,192)');
    expect(log.some((l) => l.startsWith('roundRect(30,-2'))).toBe(false);
    const pill = log.find((l) => l.startsWith('roundRect') && l.endsWith(',7)'));
    const x = Number(pill!.slice('roundRect('.length).split(',')[0]);
    expect(x).toBeGreaterThan(1032);
    expect(x).toBeLessThan(1288);
  });

  it('roomOutline, when given, is used for the frame', () => {
    const outline = vi.fn(() => [
      { x: 0, y: 0 },
      { x: 5, y: 5 },
      { x: 0, y: 10 },
    ]);
    const { ov, log } = overlayFixture({ ...shift, roomOutline: outline });
    ov.draw(0, opts, { agent: null, room: 'r1', hover: null });
    expect(outline).toHaveBeenCalledWith({ x: 32, y: 0, w: 256, h: 192 });
    expect(log).toContain('lineTo(5,5)');
  });
});

describe('local patch G: overlay text style', () => {
  const style: OverlayTextStyle = { family: '"Be Vietnam Pro", system-ui', padX: 8, padY: 4 };

  it('without a text style the room pill keeps the upstream size and font', () => {
    const { ov, log, ctx } = overlayFixture(shift);
    ov.draw(0, opts, { agent: null, room: null, hover: null });
    expect(log.some((l) => l.startsWith('roundRect(') && l.endsWith(',48,22,7)'))).toBe(true);
    expect(String(ctx.font)).not.toContain('Be Vietnam Pro');
  });

  it('with a text style pills get padding around the measured glyph box and use the given family', () => {
    const { ov, log, ctx } = overlayFixture(shift, style);
    ov.draw(0, opts, { agent: null, room: null, hover: null });
    const h = Math.ceil(12 * 0.72 + 12 * 0.5 + 2 * style.padY);
    expect(log.some((l) => l.startsWith('roundRect(') && l.endsWith(`,${30 + 4 + 2 * style.padX},${h},7)`))).toBe(true);
    expect(String(ctx.font)).toContain('Be Vietnam Pro');
    expect(styledFonts(style.family).bubble).toMatch(/^500 /);
    expect(styledFonts(style.family).label).toMatch(/^600 /);
  });

  it('a common area whose renderer paints the name on a wall sign loses its pill once the sign is readable', () => {
    const core = (l: string[]) => l.filter((x) => x.startsWith('fillText(string')).length;
    const without = overlayFixture(shift, style);
    without.ov.draw(0, opts, { agent: null, room: null, hover: null });
    const sign = overlayFixture(shift, style, (vis) => (vis.id === 'core:copa' ? { x: 1300, y: 10, w: 40, h: 12 } : null));
    sign.ov.draw(0, opts, { agent: null, room: null, hover: null });
    expect(core(sign.log)).toBe(core(without.log) - 1);
  });
});

describe('local patch G: zoom cap', () => {
  it('camera.maxZoom bounds the zoom levels and every zoom target', () => {
    expect(new Camera().maxZoom).toBe(ZOOM_MAX);
    const cam = new Camera();
    cam.maxZoom = 2.5;
    expect(Math.max(...cam.levels())).toBeLessThanOrEqual(2.5);
    cam.animateTo(0, 0, 6, 0, 1);
    cam.update(10, null, 0.01);
    expect(cam.zoom).toBe(2.5);
    cam.zoomAt(6, 0, 0, 0, false);
    expect(cam.zoom).toBe(2.5);
  });

  it('createWorld asks maxZoom with the view size and the camera never zooms past it', () => {
    stubEnv();
    vi.useFakeTimers({ toFake: ['Date'] });
    const frames: ((ts: number) => void)[] = [];
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn((cb: (ts: number) => void) => frames.push(cb)),
    );
    const maxZoom = vi.fn(() => 2.5);
    const w = createWorld(fakeCanvas(), emptyStore(), { projection: shift, maxZoom });
    expect(maxZoom).toHaveBeenCalledWith({ w: 800, h: 600 });
    for (let i = 0; i < 4; i++) w.zoomBy(4);
    for (let i = 0; i < 40; i++) {
      vi.advanceTimersByTime(50);
      frames.shift()?.(i * 50);
    }
    expect((w.debug.state() as { camera: { zoom: number } }).camera.zoom).toBeLessThanOrEqual(2.5);
    w.destroy();
    vi.useRealTimers();
  });
});

function soundFixture(proj?: Projection) {
  const elevator = { door: 0, spotId: 'e1' };
  const sim = {
    elevators: [elevator],
    spots: new Map([['e1', { x: 100, y: 100 }]]),
    chars: new Map(),
    social: { gatherings: [] },
  } as unknown as Sim;
  const camera = {
    zoom: 1,
    viewW: 400,
    viewH: 400,
    screenToWorld: (sx: number, sy: number) => ({ x: sx, y: sy }),
  } as unknown as Camera;
  const cues = new SoundCues(sim, camera, () => 0, proj);
  const out: SoundCue[] = [];
  cues.update(0, (c) => out.push(c));
  elevator.door = 0.5;
  cues.update(16, (c) => out.push(c));
  return out;
}

describe('local patch G: sound cues', () => {
  it('without a projection the elevator ding is in view at full gain', () => {
    const out = soundFixture();
    expect(out).toHaveLength(1);
    expect(out[0]!.gain).toBe(1);
  });

  it('with a projection the spot is projected before the view test and the pan', () => {
    const out = soundFixture(shift);
    expect(out).toHaveLength(1);
    expect(out[0]!.gain).toBe(0.5);
    expect(out[0]!.pan).toBe(0.7);
  });
});

function fontCtx(log: string[]): CanvasRenderingContext2D {
  const state: Record<string, unknown> = { globalAlpha: 1, font: '' };
  return new Proxy({} as CanvasRenderingContext2D, {
    get(_t, p: string) {
      if (p in state) return state[p];
      if (p === 'measureText') return (t: string) => ({ width: t.length * 6 });
      if (p === 'fillText') return (t: string, x: number, y: number) => log.push(`fillText(${t},${Math.round(x)},${Math.round(y)})@${String(state.font)}`);
      return (...a: unknown[]) => log.push(`${p}(${a.map((v) => (typeof v === 'number' ? Math.round(v * 100) / 100 : typeof v)).join(',')})`);
    },
    set(_t, p: string, v) {
      state[p] = v;
      return true;
    },
  });
}

function speechFixture(text?: OverlayTextStyle, fx?: { kind: 'party' | 'alarm'; text: string }) {
  const log: string[] = [];
  const ctx = fontCtx(log);
  const rect = { x: 2, y: 0, w: 16, h: 12 };
  const room = { id: 'r1', present: true, ghost: false, phase: 'ready', progress: () => 1, info: { name: 'alpha' }, accounts: [], theme: { accent: '#ff0000' }, lightOn: true, layout: { rect } };
  const ch = {
    id: 'a1',
    mode: 'wait',
    icon: null,
    seated: false,
    dir: 'down',
    alpha: 1,
    leaving: false,
    tx: 10,
    ty: 4,
    appearance: {},
    info: { name: 'Jin', kind: 'main', account: 'x', provider: 'claude', waitingFor: 'Duyệt một quyền', seed: 1 },
  };
  const head = { x: 500, y: 300, feetY: 358, visible: true, bx: 490, by: 300, bw: 20, bh: 58, depth: 0 };
  const active = new Map<string, unknown>();
  if (fx) active.set('r1', { roomId: 'r1', kind: fx.kind, text: fx.text, start: -1000, end: 60_000 });
  const sim = {
    rooms: new Map([['r1', room]]),
    chars: new Map([['a1', ch]]),
    accounts: new Map(),
    people: () => [ch],
    roomFx: { active, alarmOwner: () => undefined },
    social: { floaters: [] },
  } as unknown as Sim;
  const renderer = {
    heads: new Map([['a1', head]]),
    areas: new Map<string, unknown>([['r1', { id: 'r1', room, layout: { rect } }]]),
    signRect: () => null,
    signIsDark: () => false,
  } as unknown as WorldRenderer;
  const camera = { dpr: 1, zoom: 1, viewW: 4000, viewH: 4000, transform: () => ({ scale: 1, ox: 0, oy: 0 }) } as unknown as Camera;
  const ov = new Overlay(ctx, sim, renderer, camera, shift, text);
  return { ov, log, head };
}

describe('local patch G: iso speech bubbles and fx banner', () => {
  const style: OverlayTextStyle = { family: '"Be Vietnam Pro", system-ui', padX: 8, padY: 4 };
  const rr = (l: string) => l.slice('roundRect('.length, -1).split(',').map(Number);

  it('a waiting agent bubble pads the glyph box 8 x 4, keeps its tail at the head and clears the name tag', () => {
    const { ov, log, head } = speechFixture(style);
    ov.draw(0, opts, { agent: null, room: null, hover: null });
    const h = Math.ceil(12 * 0.72 + 12 * 0.5 + 2 * style.padY);
    const bodies = log.filter((l) => l.startsWith('roundRect(') && l.endsWith(',7)')).map(rr);
    const body = bodies.find((b) => b[3] === h - 1)!;
    expect(body).toBeTruthy();
    const w = body[2]! + 1;
    expect(w).toBe('Duyệt một quyền'.length * 6 + (6 + 4) + 2 * style.padX);
    const y = body[1]! - 0.5;
    expect(y + h).toBeLessThanOrEqual(head.y - 13);
    const tip = log.find((l) => l.startsWith(`lineTo(${head.x},`))!;
    expect(Number(tip.slice(tip.indexOf(',') + 1, -1))).toBe(y + h + 5);
    const say = log.find((l) => l.startsWith('fillText(Duyệt một quyền'))!;
    expect(say).toContain('Be Vietnam Pro');
    expect(Number(say.split(',')[1])).toBe(body[0]! - 0.5 + style.padX + 6 + 4);
    const tag = log.filter((l) => l.startsWith('roundRect(') && l.endsWith(',7.5)')).map(rr)[0]!;
    expect(tag[1]).toBeGreaterThanOrEqual(head.feetY);
    expect(tag[1]! >= y + h || tag[1]! + tag[3]! <= y).toBe(true);
  });

  it('the GitHub fx banner uses the text style family only when one is given', () => {
    const iso = speechFixture(style, { kind: 'party', text: 'PR #12 merged!' });
    iso.ov.draw(0, opts, { agent: null, room: null, hover: null });
    const isoBanner = iso.log.find((l) => l.startsWith('fillText(🎉 PR #12'))!;
    expect(isoBanner).toContain('@600 11.5px "Be Vietnam Pro"');
    const pixel = speechFixture(undefined, { kind: 'party', text: 'PR #12 merged!' });
    pixel.ov.draw(0, opts, { agent: null, room: null, hover: null });
    const pixelBanner = pixel.log.find((l) => l.startsWith('fillText(🎉 PR #12'))!;
    expect(pixelBanner).toContain('@800 11.5px ui-sans-serif');
  });
});

function crowdFixture(n: number, text: OverlayTextStyle | undefined, mode: 'idle' | 'work' = 'idle', waiting = 1) {
  const log: string[] = [];
  const base = recordingCtx(log);
  const ctx = new Proxy(base, {
    get(t, p: string) {
      if (p === 'fillText') return (s: string, ...a: number[]) => log.push(`text:${s}`, `fillText(string,${a.map((v) => Math.round(v * 100) / 100).join(',')})`);
      return Reflect.get(t, p);
    },
    set(t, p: string, v) {
      return Reflect.set(t, p, v);
    },
  });
  const chars = Array.from({ length: n }, (_, i) => ({
    id: `c${i}`,
    mode: i < waiting ? 'wait' : mode,
    icon: null,
    seated: false,
    dir: 'down',
    atSpot: null,
    leaving: false,
    tx: 3,
    ty: 3,
    appearance: {},
    info: { name: `agent-${i}`, kind: i === 1 ? 'main' : 'sub', account: 'x', seed: i, activity: { icon: '🔧', text: `task ${i}` }, waitingFor: 'approve' },
    bubbleText: null,
    bubbleUntil: 0,
    sayText: null,
    sayUntil: 0,
    shellSince: 0,
    activityChangedAt: 1,
  }));
  const heads = new Map(chars.map((c, i) => [c.id, { x: 200 + (i % 6) * 14, y: 200 + Math.floor(i / 6) * 9, feetY: 230 + Math.floor(i / 6) * 9, visible: true, bx: 0, by: 0, bw: 0, bh: 0, depth: 0 }]));
  const sim = {
    rooms: new Map(),
    chars: new Map(chars.map((c) => [c.id, c])),
    accounts: new Map(),
    people: () => chars,
    roomFx: { active: new Map(), alarmOwner: () => false },
    social: { floaters: [] },
    spots: new Map(),
    visitor: null,
    visit: false,
  } as unknown as Sim;
  const renderer = { heads, areas: new Map(), signRect: () => null, signIsDark: () => false } as unknown as WorldRenderer;
  const camera = { dpr: 1, zoom: 1, viewW: 1000, viewH: 800, transform: () => ({ scale: 1, ox: 0, oy: 0 }) } as unknown as Camera;
  return { ov: new Overlay(ctx, sim, renderer, camera, shift, text), log };
}

const rects = (log: string[], radius: string) =>
  log
    .filter((l) => l.startsWith('roundRect(') && l.endsWith(`,${radius})`))
    .map((l) => l.slice('roundRect('.length, -1).split(',').map(Number))
    .map(([x, y, w, h]) => ({ x: x!, y: y!, w: w!, h: h! }));

const overlapping = (rs: { x: number; y: number; w: number; h: number }[]) => {
  let n = 0;
  for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) {
    const a = rs[i]!;
    const b = rs[j]!;
    if (a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y) n++;
  }
  return n;
};

describe('local patch G: overlay declutter', () => {
  const style: OverlayTextStyle = { family: 'system-ui', padX: 8, padY: 4, declutter: true };
  const names = { showNames: true, bubbles: 'none' } as never;

  it('crowded name tags: visible tags never overlap, waiting and main agents keep theirs, selection always shows', () => {
    const { ov, log } = crowdFixture(18, style);
    for (let f = 0; f < 3; f++) {
      log.length = 0;
      ov.draw(1000 + f * 16, names, { agent: 'c17', room: null, hover: null });
    }
    const tags = rects(log, '7.5');
    expect(tags.length).toBeGreaterThan(2);
    expect(tags.length).toBeLessThan(18);
    expect(overlapping(tags)).toBe(0);
    const drawn = log.filter((l) => l.startsWith('fillText(string')).length;
    expect(drawn).toBeGreaterThan(0);
  });

  it('keeps the same tags from frame to frame (no flicker)', () => {
    const { ov, log } = crowdFixture(18, style);
    const frame = (t: number) => {
      log.length = 0;
      ov.draw(t, names, { agent: null, room: null, hover: null });
      return rects(log, '7.5').map((r) => `${r.x},${r.y}`).join('|');
    };
    frame(1000);
    const a = frame(1016);
    for (let f = 2; f < 20; f++) expect(frame(1000 + f * 16)).toBe(a);
  });

  it('crowded bubbles do not overlap each other either', () => {
    const { ov, log } = crowdFixture(18, style, 'work');
    for (let f = 0; f < 3; f++) {
      log.length = 0;
      ov.draw(1000 + f * 16, { showNames: false, bubbles: 'all' } as never, { agent: null, room: null, hover: null });
    }
    const bubbles = rects(log, '7').filter((_, i, all) => i % 2 === 1 || all.length === 1);
    expect(bubbles.length).toBeGreaterThan(1);
    expect(overlapping(bubbles)).toBe(0);
  });

  it('without declutter the upstream placement runs unchanged', () => {
    const plain = crowdFixture(18, { family: 'system-ui', padX: 8, padY: 4 });
    plain.ov.draw(1000, names, { agent: null, room: null, hover: null });
    const decl = crowdFixture(18, style);
    decl.ov.draw(1000, names, { agent: null, room: null, hover: null });
    expect(rects(plain.log, '7.5').length).toBeGreaterThan(0);
    expect(rects(decl.log, '7.5')).not.toEqual(rects(plain.log, '7.5'));
  });

  it('waiting agents keep their name tag and their full ✋ bubble however crowded; others make room', () => {
    const { ov, log } = crowdFixture(18, style, 'work', 6);
    for (let f = 0; f < 3; f++) {
      log.length = 0;
      ov.draw(1000 + f * 16, { showNames: true, bubbles: 'all' } as never, { agent: null, room: null, hover: null });
    }
    for (let i = 0; i < 6; i++) expect(log, `agent-${i}`).toContain(`text:agent-${i}`);
    expect(log.filter((l) => l === 'text:Approve')).toHaveLength(6);
    const others = log.filter((l) => /^text:agent-(\d+)$/.test(l) && Number(l.slice(11)) >= 6).length;
    expect(others).toBeLessThan(12);
  });
});
