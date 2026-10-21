import { afterEach, describe, expect, it, vi } from 'vitest';
import { OfficeStore } from '../net/store';
import type { WorldApi, WorldPlayback } from '../world/api';
import { createUI } from './index';
import { SoundControl } from './sound';
import { dayLabel, hourTicks, TimelapsePlayer } from './timelapse';

// Só o contexto e o player reais: os outros painéis não participam do relógio.
vi.mock('./daystats-launcher');
vi.mock('./roomrename');
vi.mock('./drawer');
vi.mock('./feed');
vi.mock('./help');
vi.mock('./history');
vi.mock('./hovertip');
vi.mock('./notify');
vi.mock('./overlays');
vi.mock('./settings');
vi.mock('./sidebar');
vi.mock('./sound');
vi.mock('./terminal');
vi.mock('./toasts');
vi.mock('./version');
vi.mock('./update');
vi.mock('./viewport');
vi.mock('./topbar', () => ({ TopBar: class {
  panelGroup = { prepend() {} };
  addPanelButton() {}
  addStatus() {}
  render() {}
} }));

/** DOM mínimo para os controles do player, sem layout nem canvas. */
class ElementStub extends EventTarget {
  className = '';
  textContent = '';
  value = '';
  children: ElementStub[] = [];
  classList = { add() {}, toggle() {} };
  style = { getPropertyValue: () => '', setProperty() {} };
  private attrs = new Map<string, string>();
  append(...children: ElementStub[]): void { this.children.push(...children.filter((el) => el instanceof ElementStub)); }
  replaceChildren(...children: ElementStub[]): void { this.children = children; }
  setAttribute(name: string, value: string): void { this.attrs.set(name, value); }
  getAttribute(name: string): string | null { return this.attrs.get(name) ?? null; }
  getContext(): null { return null; }
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('timelapse: rótulos', () => {
  it('dia: Hoje, Ontem ou a data curta', () => {
    expect(dayLabel('2026-10-08', '2026-10-08')).toBe('Hoje');
    expect(dayLabel('2026-10-07', '2026-10-08')).toBe('Ontem');
    expect(dayLabel('2026-10-01', '2026-10-01')).toBe('Hoje');
    expect(dayLabel('2026-09-30', '2026-10-01')).toBe('Ontem');
    expect(dayLabel('2026-10-05', '2026-10-08')).toMatch(/5 de out/);
  });

  it('régua: horas cheias, no máximo ~6 marcas', () => {
    const at = (h: number, m = 0) => new Date(2026, 9, 7, h, m).getTime();
    expect(hourTicks(at(9, 10), at(12, 30)).map((t) => new Date(t).getHours())).toEqual([10, 11, 12]);
    expect(hourTicks(at(9), at(19)).map((t) => new Date(t).getHours())).toEqual([10, 12, 14, 16, 18]);
    expect(hourTicks(at(0, 5), at(23, 50)).map((t) => new Date(t).getHours())).toEqual([4, 8, 12, 16, 20]);
    expect(hourTicks(at(9, 10), at(9, 50))).toEqual([]);
  });
});

describe('timelapse: relógio dos painéis', () => {
  it('acompanha o player ao pausar, reproduzir, pular e voltar ao vivo', async () => {
    const from = new Date(2026, 9, 7, 9).getTime();
    const live = new Date(2026, 9, 8, 12).getTime();
    vi.useFakeTimers();
    vi.setSystemTime(live);
    vi.stubGlobal('document', {
      createElement: () => new ElementStub(),
      documentElement: new ElementStub(),
      addEventListener() {},
    });
    vi.stubGlobal('addEventListener', () => {});
    vi.stubGlobal('requestAnimationFrame', (cb: () => void) => setTimeout(cb, 16));
    vi.stubGlobal('cancelAnimationFrame', (id: ReturnType<typeof setTimeout>) => clearTimeout(id));
    const records = [
      { t: 'k', at: from, v: 1, every: 300_000, rooms: [], agents: [], accounts: [] },
      { t: 'end', at: from + 600_000 },
    ];
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ recording: true, days: [{ day: '2026-10-07', from, to: from + 600_000 }] })))
      .mockResolvedValueOnce(new Response(records.map((r) => JSON.stringify(r)).join('\n'))));
    let playback: WorldPlayback | null = null;
    const world = {
      getSelection: () => null,
      onSelect() {},
      setOptions() {},
      setPlayback: (p: WorldPlayback | null) => { playback = p; },
    } as unknown as WorldApi;
    const render = vi.spyOn(TimelapsePlayer.prototype, 'render');
    createUI(new ElementStub() as unknown as HTMLElement, new OfficeStore(), world);
    const ctx = vi.mocked(SoundControl).mock.calls.at(-1)![0];
    const player = render.mock.contexts[0] as TimelapsePlayer;
    const control = (name: string) => {
      const find = (el: ElementStub): ElementStub | undefined => el.className === name ? el : el.children.filter(Boolean).map(find).find(Boolean);
      return find(player.el as unknown as ElementStub)!;
    };
    const play = control('ui-icon-btn ui-lapse__play');
    const range = control('ui-lapse__range');
    expect(ctx.now()).toBe(live);
    await player.show();
    play.dispatchEvent(new Event('click'));
    vi.advanceTimersByTime(120_000);
    expect(player.badge.children[2].textContent).toBe('09:00');
    expect(playback!.clock()).toBe(from);
    expect(ctx.now()).toBe(from);

    play.dispatchEvent(new Event('click'));
    vi.advanceTimersByTime(16);
    expect(ctx.now()).toBe(from + 2_880);
    expect(playback!.clock()).toBe(from + 2_880);
    const speeds = control('ui-seg ui-lapse__speed');
    speeds.children[0].dispatchEvent(new Event('click'));
    vi.advanceTimersByTime(16);
    expect(ctx.now()).toBe(from + 3_840);
    play.dispatchEvent(new Event('click'));
    range.value = '300';
    range.dispatchEvent(new Event('change'));
    expect(ctx.now()).toBe(from + 300_000);
    range.value = '60';
    range.dispatchEvent(new Event('change'));
    vi.advanceTimersByTime(120_000);
    expect(ctx.now()).toBe(from + 60_000);

    range.value = '599';
    range.dispatchEvent(new Event('change'));
    speeds.children[2].dispatchEvent(new Event('click'));
    play.dispatchEvent(new Event('click'));
    vi.advanceTimersByTime(32);
    expect(ctx.now()).toBe(from + 600_000);
    vi.advanceTimersByTime(120_000);
    expect(ctx.now()).toBe(from + 600_000);
    player.close();
    expect(ctx.now()).toBe(live + 360_064);
    vi.advanceTimersByTime(2_000);
    expect(ctx.now()).toBe(live + 362_064);
  });
});
