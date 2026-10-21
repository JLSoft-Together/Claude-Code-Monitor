// O botão Mundo: só com `meta.world.scene.available` e pela página do próprio computador (o snapshot também vai ao
// celular, mas as rotas da cena não); no modo demonstração, sem as travas. E a volta ao escritório quando a interface
// escolhe um agente ou sala com a cidade aberta (aviso, Responder).
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WorldMeta, WorldSource } from '../../net/world';
import type { Selection } from '../../world/api';
import type { UiContext } from '../context';
import { citySceneAvailable, SceneSwitch, type CitySceneHost } from './scene-switch';
import type { WorldGate } from './world-model';

const meta = (scene?: { available: boolean }): WorldMeta => ({ enabled: true, configured: true, state: 'approved', ...(scene ? { scene } : {}) });
const src = (m: WorldMeta | undefined, fake = false): WorldSource => ({ client: null, fake, meta: () => m });
const LOCAL: WorldGate = { remote: false, local: true, terminal: true, fake: false };

describe('citySceneAvailable', () => {
  it('com a cena disponível e a página do próprio computador', () => {
    expect(citySceneAvailable(src(meta({ available: true })), LOCAL)).toBe(true);
    expect(citySceneAvailable(src(meta({ available: false })), LOCAL)).toBe(false);
    expect(citySceneAvailable(src(meta()), LOCAL)).toBe(false);
    expect(citySceneAvailable(src(undefined), LOCAL)).toBe(false);
  });

  it('nunca pelo celular nem sem a trava do terminal; no modo demonstração, sem as travas', () => {
    const on = meta({ available: true });
    expect(citySceneAvailable(src(on), { ...LOCAL, remote: true })).toBe(false);
    expect(citySceneAvailable(src(on), { ...LOCAL, local: false })).toBe(false);
    expect(citySceneAvailable(src(on), { ...LOCAL, terminal: false })).toBe(false);
    expect(citySceneAvailable(src(on, true), { remote: false, local: false, terminal: false, fake: true })).toBe(true);
  });
});

/** Elemento mínimo para o botão Mundo no ambiente Node (só o que `h()` e `render()` tocam). */
class ElementStub {
  className = '';
  textContent = '';
  innerHTML = '';
  title = '';
  hidden = false;
  classList = { toggle: () => {} };
  setAttribute(): void {}
  addEventListener(): void {}
  append(): void {}
}

describe('SceneSwitch.leaveFor', () => {
  afterEach(() => vi.unstubAllGlobals());

  /** A cena (host falso) e a interface como em ui/index.ts: `ctx.select` passa pela guarda antes de selecionar. */
  function setup() {
    vi.stubGlobal('document', { createElement: () => new ElementStub() });
    const host = {
      open: false as boolean,
      show: vi.fn(async () => void (host.open = true)),
      hide: vi.fn(() => void (host.open = false)),
      zoomBy() {},
      recenter() {},
      escape: () => false,
    } satisfies CitySceneHost;
    let selection: Selection = null;
    const selected: Selection[] = [];
    const inCityAtSelect: boolean[] = [];
    let sw!: SceneSwitch;
    const ctx = {
      store: { replaying: false, liveSnapshot: undefined },
      isTimelapseOpen: () => false,
      announce: vi.fn(),
      selection: () => selection,
      select: (sel: Selection) => {
        sw.leaveFor(sel);
        inCityAtSelect.push(host.open);
        selected.push(sel);
        selection = sel;
      },
    } as unknown as UiContext;
    const onChange = vi.fn();
    sw = new SceneSwitch(ctx, src(meta({ available: true }), true), host, onChange);
    return { host, ctx, sw, onChange, selected, inCityAtSelect, setSelection: (s: Selection) => (selection = s) };
  }

  it('com a cidade aberta, escolher um agente ou uma sala volta ao escritório antes de selecionar', () => {
    for (const sel of [{ type: 'agent', id: 'a1' }, { type: 'room', id: 'r1' }] as const) {
      const { host, ctx, sw, onChange, inCityAtSelect } = setup();
      host.open = true;
      ctx.select(sel);
      expect(host.hide).toHaveBeenCalledTimes(1);
      expect(onChange).toHaveBeenCalledTimes(1);
      expect(sw.inCity).toBe(false);
      expect(inCityAtSelect).toEqual([false]);
    }
  });

  it('desmarcar (null) não fecha a cidade, e fora da cidade nada muda', () => {
    const a = setup();
    a.host.open = true;
    a.ctx.select(null);
    expect(a.host.hide).not.toHaveBeenCalled();
    expect(a.onChange).not.toHaveBeenCalled();
    expect(a.sw.inCity).toBe(true);

    const b = setup();
    b.ctx.select({ type: 'agent', id: 'a1' });
    expect(b.host.hide).not.toHaveBeenCalled();
    expect(b.onChange).not.toHaveBeenCalled();
  });

  it('abrir a cidade com um agente selecionado desmarca sem voltar ao escritório', async () => {
    const { host, sw, selected, setSelection } = setup();
    setSelection({ type: 'agent', id: 'a1' });
    await sw.open();
    expect(selected).toEqual([null]);
    expect(host.show).toHaveBeenCalledTimes(1);
    expect(host.hide).not.toHaveBeenCalled();
    expect(sw.inCity).toBe(true);
  });
});
