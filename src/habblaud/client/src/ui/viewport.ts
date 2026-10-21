// Área livre do escritório: a parte da tela que nenhum painel da UI cobre.
// Mede barra superior, barra lateral, gaveta e feed e informa ao mundo (setViewInsets) para que a visão geral
// e o foco (agente, sala, seguir) enquadrem só o que está visível. A mesma área vira variáveis CSS
// (--free-top/right/bottom/left) para posicionar o estado vazio e os avisos.
//
// Detalhes de interação:
// - a gaveta aberta por um clique no canvas só muda o enquadramento depois da janela do duplo clique
//   (senão a câmera se mexe entre o 1º e o 2º clique e o duplo clique erra o alvo); nesse intervalo a gaveta
//   também deixa os cliques passarem para o canvas;
// - quando a seleção foi aberta "com foco" (lista, feed, aviso, Centralizar, duplo clique), o foco é refeito a
//   cada mudança da área livre, até o usuário mexer na câmera.
import type { Selection, ViewInsets, WorldApi } from '../world/api';

/** Folga entre a borda do painel e o conteúdo enquadrado (px CSS). */
export const INSET_GAP = 8;
/** Janela do duplo clique: a gaveta aberta pelo 1º clique só muda o enquadramento depois dela. */
export const DBLCLICK_GUARD_MS = 380;
/** Área livre mínima: em telas minúsculas os painéis cedem para o mundo continuar utilizável. */
export const MIN_FREE = 120;
/** Tempo da animação de câmera do mundo (+ folga) antes de conferir se o agente ficou visível. */
const CAMERA_SETTLE_MS = 480;
const DOUBLE_TAP_MS = 320;
const DOUBLE_TAP_PX = 24;
const DRAG_PX = 6;
/** Largura padrão e mínima dos avisos (px CSS). */
const TOAST_W = 344;
const TOAST_MIN_W = 280;
const CAMERA_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'a', 'A', 'd', 'D', 'w', 'W', 's', 'S', '+', '=', '-', '_', '0', 'o', 'O']);

/** Geometria final dos painéis (sem as transições de abrir/fechar), em px CSS relativos à viewport. */
export interface PanelGeometry {
  vw: number;
  vh: number;
  /** Borda inferior da barra superior. */
  topBottom: number;
  /** Borda direita da barra lateral aberta. */
  sideRight: number;
  /** Borda esquerda e borda superior da gaveta aberta. */
  drawerLeft: number;
  drawerTop: number;
  /** Gaveta como folha inferior (celular) em vez de coluna à direita. */
  drawerSheet: boolean;
  /** Altura do feed aberto e recolhido, e a distância dele até a borda inferior. */
  feedOpenH: number;
  feedClosedH: number;
  feedMargin: number;
}

export interface PanelFlags {
  sidebar: boolean;
  feed: boolean;
  drawer: boolean;
  /** Tela estreita: a barra lateral vira gaveta sobreposta (com fundo escuro) e não conta como área coberta. */
  narrow: boolean;
}

function shrinkPair(a: number, b: number, total: number): [number, number] {
  const free = total - a - b;
  if (free >= MIN_FREE || a + b <= 0) return [a, b];
  const room = Math.max(0, total - MIN_FREE);
  const k = room / (a + b);
  return [Math.floor(a * k), Math.floor(b * k)];
}

/** Margens cobertas pela UI (puro: testado em viewport.test.ts). */
export function computeInsets(g: PanelGeometry, f: PanelFlags, gap = INSET_GAP): ViewInsets {
  const top = Math.max(0, g.topBottom) + gap;
  const left = f.sidebar && !f.narrow ? Math.max(0, g.sideRight) + gap : 0;
  const right = f.drawer && !g.drawerSheet ? Math.max(0, g.vw - g.drawerLeft) + gap : 0;
  const feedH = f.feed ? g.feedOpenH : g.feedClosedH;
  let bottom = feedH > 0 ? feedH + g.feedMargin + gap : 0;
  if (f.drawer && g.drawerSheet) bottom = Math.max(bottom, g.vh - g.drawerTop + gap);
  const [l, r] = shrinkPair(left, right, g.vw);
  const [t, b] = shrinkPair(top, bottom, g.vh);
  return { top: Math.round(t), right: Math.round(r), bottom: Math.round(b), left: Math.round(l) };
}

export function sameInsets(a: ViewInsets | null, b: ViewInsets): boolean {
  return !!a && Math.abs(a.top - b.top) < 1 && Math.abs(a.right - b.right) < 1 && Math.abs(a.bottom - b.bottom) < 1 && Math.abs(a.left - b.left) < 1;
}

export function sameSelection(a: Selection, b: Selection): boolean {
  return a === b || (!!a && !!b && a.type === b.type && a.id === b.id);
}

export interface FreeAreaPanels {
  root: HTMLElement;
  topbar: HTMLElement;
  sidebar: HTMLElement;
  drawer: HTMLElement;
  feed: HTMLElement;
}

/** `follow: 'option'` segue a opção "seguir selecionado" do momento; `true` = duplo clique (sempre segue). */
type FocusIntent = { sel: NonNullable<Selection>; follow: boolean | 'option' };

const isCanvas = (t: EventTarget | null): t is HTMLCanvasElement => t instanceof HTMLCanvasElement;

function isTyping(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  return t.isContentEditable || t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement;
}

export class FreeArea {
  private applied: ViewInsets | null = null;
  private probe: HTMLElement;
  private probeFeedOpen: HTMLElement;
  private probeFeedClosed: HTMLElement;
  private probeGap: HTMLElement;
  private guardTimer: ReturnType<typeof setTimeout> | null = null;
  private checkTimer: ReturnType<typeof setTimeout> | null = null;
  private intent: FocusIntent | null = null;
  private toastPlace = '';
  private raf = 0;
  private down: { x: number; y: number; id: number } | null = null;
  private lastTap = { t: 0, x: 0, y: 0 };

  constructor(
    private world: WorldApi,
    private panels: FreeAreaPanels,
    private flags: () => PanelFlags,
  ) {
    // Sonda invisível: resolve as variáveis CSS (que mudam por media query) em px, sem esperar as transições.
    this.probeFeedOpen = document.createElement('span');
    this.probeFeedClosed = document.createElement('span');
    this.probeGap = document.createElement('span');
    this.probeFeedOpen.className = 'ui-probe__feed-open';
    this.probeFeedClosed.className = 'ui-probe__feed-closed';
    this.probeGap.className = 'ui-probe__gap';
    this.probe = document.createElement('div');
    this.probe.className = 'ui-probe';
    this.probe.setAttribute('aria-hidden', 'true');
    this.probe.append(this.probeFeedOpen, this.probeFeedClosed, this.probeGap);
    panels.root.append(this.probe);

    addEventListener('resize', () => this.schedule());
    // A largura/posição do feed anima ao abrir/fechar painéis: reposiciona os avisos no fim da transição.
    panels.feed.addEventListener('transitionend', (e) => {
      if (e.target === panels.feed) this.schedule();
    });
    if (typeof ResizeObserver === 'function') {
      const ro = new ResizeObserver(() => this.schedule());
      ro.observe(panels.topbar);
      ro.observe(this.probeFeedOpen);
      ro.observe(this.probeGap);
      ro.observe(panels.sidebar);
      ro.observe(panels.drawer);
    }
    this.watchCanvas();
  }

  /** Margens atualmente informadas ao mundo. */
  get insets(): ViewInsets {
    return this.applied ?? { top: 0, right: 0, bottom: 0, left: 0 };
  }

  /** A gaveta está no intervalo do duplo clique (ainda não conta como área coberta). */
  get guarding(): boolean {
    return this.guardTimer !== null;
  }

  /** Recalcula no próximo quadro (vários eventos no mesmo quadro viram uma medição). */
  schedule(): void {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      this.sync();
    });
  }

  /**
   * Mede, informa o mundo e atualiza as variáveis CSS se algo mudou.
   * `refocus: false` quando quem chamou vai focar logo em seguida (o foco já sai com as margens novas).
   */
  sync(opts: { refocus?: boolean } = {}): void {
    if (this.raf) {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
    }
    const f = this.flags();
    const g = this.measure();
    const insets = computeInsets(g, { ...f, drawer: f.drawer && !this.guarding });
    this.placeToasts(insets, g);
    if (sameInsets(this.applied, insets)) return;
    this.applied = insets;
    const s = this.panels.root.style;
    s.setProperty('--free-top', `${insets.top}px`);
    s.setProperty('--free-right', `${insets.right}px`);
    s.setProperty('--free-bottom', `${insets.bottom}px`);
    s.setProperty('--free-left', `${insets.left}px`);
    try {
      this.world.setViewInsets?.(insets);
    } catch (err) {
      console.error('[ui] setViewInsets falhou', err);
    }
    if (opts.refocus !== false) this.refocus();
  }

  /**
   * Avisos: no canto inferior direito, ao lado do feed, quando sobra espaço ali (fora do prédio enquadrado);
   * senão, logo acima do feed / da folha de detalhes. Sempre à esquerda da gaveta.
   */
  private placeToasts(ins: ViewInsets, g: PanelGeometry): void {
    const feed = this.panels.feed;
    const right = Math.max(g.feedMargin, ins.right);
    const beside = g.vw - right - (feed.offsetLeft + feed.offsetWidth) - g.feedMargin;
    const corner = !g.drawerSheet && beside >= TOAST_MIN_W;
    const bottom = corner ? g.feedMargin : ins.bottom;
    const width = corner ? Math.min(TOAST_W, beside) : Math.min(TOAST_W, Math.max(240, g.vw - right - Math.max(g.feedMargin, ins.left)));
    const key = `${bottom}|${width}`;
    if (key === this.toastPlace) return;
    this.toastPlace = key;
    this.panels.root.style.setProperty('--toast-bottom', `${bottom}px`);
    this.panels.root.style.setProperty('--toast-w', `${Math.round(width)}px`);
  }

  // ---------------------------------------------------------------- foco

  /** A seleção foi aberta com foco (lista, feed, aviso, Centralizar): refaz o foco quando a área mudar. */
  setIntent(sel: NonNullable<Selection>, follow: boolean | 'option' = 'option'): void {
    this.intent = { sel, follow };
  }

  clearIntent(): void {
    this.intent = null;
  }

  /** A seleção mudou fora da UI (clique no canvas, agente que saiu). */
  selectionChangedExternally(prev: Selection, sel: Selection): void {
    if (this.intent && !sameSelection(this.intent.sel, sel)) this.intent = null;
    if (!prev && sel) this.beginGuard();
    else if (!sel) this.endGuard(false);
  }

  /** Seleção feita pela UI: a gaveta conta na hora (o foco que vem a seguir já usa a área certa). */
  selectingFromUi(): void {
    this.endGuard(false);
  }

  private refocus(): void {
    const it = this.intent;
    if (!it || !sameSelection(it.sel, this.world.getSelection())) return;
    if (it.sel.type === 'agent') this.world.focusAgent(it.sel.id, { follow: it.follow === 'option' ? this.world.getOptions().followSelected : it.follow });
    else this.world.focusRoom(it.sel.id);
  }

  // ---------------------------------------------------------------- janela do duplo clique

  private beginGuard(): void {
    this.endGuard(false);
    this.panels.drawer.classList.add('is-opening');
    this.guardTimer = setTimeout(() => this.endGuard(true), DBLCLICK_GUARD_MS);
  }

  private endGuard(check: boolean): void {
    if (this.guardTimer === null) return;
    clearTimeout(this.guardTimer);
    this.guardTimer = null;
    this.panels.drawer.classList.remove('is-opening');
    this.sync();
    if (check) this.ensureVisibleSoon();
  }

  /** Depois que a câmera assentar: se o agente selecionado ficou fora da área livre, leva a câmera até ele. */
  private ensureVisibleSoon(): void {
    if (this.checkTimer) clearTimeout(this.checkTimer);
    this.checkTimer = setTimeout(() => {
      this.checkTimer = null;
      const sel = this.world.getSelection();
      if (sel?.type !== 'agent' || this.intent) return;
      const p = this.world.screenPositionOf(sel.id);
      const i = this.insets;
      const visible = !!p && p.x >= i.left && p.x <= innerWidth - i.right && p.y >= i.top && p.y <= innerHeight - i.bottom;
      if (!visible) this.world.focusAgent(sel.id, { follow: this.world.getOptions().followSelected });
    }, CAMERA_SETTLE_MS);
  }

  /** Duplo clique/toque no canvas: o mundo já focou o alvo; a UI passa a manter esse foco. */
  private onDoubleActivate(): void {
    const sel = this.world.getSelection();
    if (!sel) return;
    // Duplo clique em agente = focar e seguir; em sala = enquadrar a sala.
    this.intent = { sel, follow: sel.type === 'agent' };
    if (this.guarding) this.endGuard(false);
  }

  // ---------------------------------------------------------------- interação com a câmera

  private watchCanvas(): void {
    addEventListener('dblclick', (e) => isCanvas(e.target) && this.onDoubleActivate());
    addEventListener(
      'pointerdown',
      (e) => {
        this.down = isCanvas(e.target) ? { x: e.clientX, y: e.clientY, id: e.pointerId } : null;
      },
      true,
    );
    addEventListener(
      'pointermove',
      (e) => {
        if (!this.down || e.buttons === 0) return;
        if (Math.hypot(e.clientX - this.down.x, e.clientY - this.down.y) > DRAG_PX) {
          // Arrastou (ou pinçou): o usuário assumiu a câmera.
          this.intent = null;
          this.down = null;
          this.lastTap.t = 0;
        }
      },
      true,
    );
    addEventListener(
      'pointerup',
      (e) => {
        const d = this.down;
        this.down = null;
        if (!d || !isCanvas(e.target) || e.pointerType === 'mouse') return;
        // Duplo toque (o navegador não dispara dblclick para toque com touch-action: none).
        const now = performance.now();
        if (now - this.lastTap.t < DOUBLE_TAP_MS && Math.hypot(e.clientX - this.lastTap.x, e.clientY - this.lastTap.y) < DOUBLE_TAP_PX) {
          this.lastTap.t = 0;
          // O mundo trata o toque no mesmo evento: espera ele aplicar a seleção/foco.
          queueMicrotask(() => this.onDoubleActivate());
        } else {
          this.lastTap = { t: now, x: e.clientX, y: e.clientY };
        }
      },
      true,
    );
    addEventListener('wheel', (e) => isCanvas(e.target) && (this.intent = null), { capture: true, passive: true });
    addEventListener(
      'keydown',
      (e) => {
        if (e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return;
        if (CAMERA_KEYS.has(e.key)) this.intent = null;
      },
      true,
    );
  }

  // ---------------------------------------------------------------- medição

  /** Posições de layout (offset*), que ignoram o transform das animações de abrir/fechar. */
  private measure(): PanelGeometry {
    const { topbar, sidebar, drawer } = this.panels;
    const vw = innerWidth;
    const vh = innerHeight;
    const drawerSheet = drawer.offsetWidth >= vw - 40 && drawer.offsetTop > topbar.offsetHeight + 40;
    return {
      vw,
      vh,
      topBottom: topbar.offsetTop + topbar.offsetHeight,
      sideRight: sidebar.offsetLeft + sidebar.offsetWidth,
      drawerLeft: drawer.offsetLeft,
      drawerTop: drawer.offsetTop,
      drawerSheet,
      feedOpenH: this.probeFeedOpen.offsetHeight,
      feedClosedH: this.probeFeedClosed.offsetHeight,
      feedMargin: this.probeGap.offsetWidth,
    };
  }
}
