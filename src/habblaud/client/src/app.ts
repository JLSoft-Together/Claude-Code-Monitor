// O app do cliente: store (dados) -> mundo (canvas) -> UI (painéis). Carregado por main.ts depois do dicionário do
// idioma ativo, porque vários módulos chamam tr() ao carregar.
import { loadAccess } from './net/access';
import { OfficeStore } from './net/store';
import { createWorld, type WorldApi } from './world';
import { createUI } from './ui';
import type { CitySceneHost } from './ui/world/scene-switch';
import type { CityScene } from './world/city';
import { migrateLegacyKeys, safeLocalStorage } from './ui/prefs';
import { getLocale, tr } from '../../shared/i18n';

export function start(): void {
  // Antes de tudo: o mundo (carteiras) e a UI (preferências) leem o localStorage ao serem criados.
  migrateLegacyKeys(safeLocalStorage());

  // Idioma escolhido (shared/i18n): leitores de tela e o corretor do navegador seguem o atributo lang.
  document.documentElement.lang = getLocale();
  document.querySelector('meta[name="description"]')?.setAttribute(
    'content',
    tr('Escritório virtual em pixel art que mostra, em tempo real, o que seus agentes do Claude Code estão fazendo.'),
  );

  const params = new URLSearchParams(location.search);
  const store = new OfficeStore({ mock: params.has('mock') });
  const worldCanvas = document.getElementById('world') as HTMLCanvasElement;
  const uiRoot = document.getElementById('ui') as HTMLElement;
  const world = createWorld(worldCanvas, store);
  const city = cityHost({ world, worldCanvas, uiRoot, mock: store.mock, params, version: () => store.liveSnapshot?.meta.version ?? '' });
  createUI(uiRoot, store, world, city);
  // O que esta página pode fazer (porta local ou remota com login) chega antes do primeiro snapshot (ou desiste em
  // poucos segundos e fica a regra de antes).
  if (store.mock) store.connect();
  else {
    void loadAccess().finally(() => store.connect());
    // Reconexão (servidor reiniciado, celular de volta do bloqueio): o acesso pode ter mudado, e o login pode ter
    // vencido (loadAccess leva à tela de entrada).
    let opened = false;
    store.on('connection', (state) => {
      if (state === 'open') {
        if (opened) void loadAccess();
        opened = true;
      } else if (state === 'closed' && opened) void loadAccess();
    });
  }

  // Facilita a depuração pelo console do navegador.
  Object.assign(window, { habblaud: { store, world, city } });
}

/**
 * A cena da cidade do Habblaud World (botão Mundo): um segundo canvas por cima do escritório, carregado só na
 * primeira vez que abre (quem não usa o World não baixa a cidade). Com a cidade na tela, o escritório para de
 * desenhar e o teclado é da cidade; Esc ou o botão Escritório voltam.
 */
function cityHost(o: { world: WorldApi; worldCanvas: HTMLCanvasElement; uiRoot: HTMLElement; mock: boolean; params: URLSearchParams; version: () => string }): CitySceneHost & { scene(): CityScene | null } {
  let scene: CityScene | null = null;
  let loading: Promise<CityScene> | null = null;
  let open = false;
  const canvas = document.createElement('canvas');
  canvas.id = 'city';
  canvas.hidden = true;
  o.worldCanvas.after(canvas);
  const load = (): Promise<CityScene> =>
    (loading ??= Promise.all([import('./world/city'), import('./net/world-stream')]).then(([m, ws]) => {
      // Modo demonstração: a cidade de mentira (`?perf=N` enche N lotes, para medir). Ao vivo: o stream do servidor
      // local (GET /api/world/stream e POST /api/world/cmd).
      const perf = Number(o.params.get('perf'));
      const buildings = o.mock && Number.isFinite(perf) && perf > 0 ? { buildings: perf } : {};
      // a cidade falsa lembra onde eu estava entre um stream e o seguinte desta página (como o servidor, por conta)
      const memory = {};
      scene = m.createCityScene({
        canvas,
        uiRoot: o.uiRoot,
        openStream: () => ws.createWorldStream({ mock: o.mock, ...buildings, memory }),
        options: () => o.world.getOptions(),
        topInset: () => o.uiRoot.querySelector('.ui-topbar')?.getBoundingClientRect().bottom ?? 64,
        version: () => o.version(),
      });
      return scene;
    }));
  return {
    get open() {
      return open;
    },
    async show() {
      const s = await load();
      open = true;
      o.world.setSuspended?.(true);
      o.worldCanvas.hidden = true;
      s.show();
    },
    hide() {
      open = false;
      scene?.hide();
      o.worldCanvas.hidden = false;
      o.world.setSuspended?.(false);
    },
    zoomBy: (f) => scene?.zoomBy(f),
    recenter: () => scene?.recenter(),
    escape: () => scene?.escape() ?? false,
    visitOwn: () => scene?.visitOwn(),
    scene: () => scene,
  };
}
