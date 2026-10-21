// Janelas móveis: arrastar pela barra solta o painel do lugar padrão (vira "flutuante"); puxar qualquer borda ou
// quina redimensiona (e também solta); duplo clique na barra devolve ao lugar. Posição e tamanho ficam no navegador
// (localStorage, por painel). Em telas estreitas os painéis continuam fixos.
import { ICONS } from './icons';
import { tr } from '../../../shared/i18n';

const DRAG_THRESHOLD = 4;
/** Quanto da janela precisa continuar visível na tela. */
const KEEP_VISIBLE = 80;
const MIN_W = 300;
const MIN_H = 160;

/** Bordas e quinas que redimensionam: n/s mexem em cima/embaixo, e/w na direita/esquerda. */
const EDGES = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'] as const;
type Edge = (typeof EDGES)[number];

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface MovableOptions {
  /** Chave no localStorage. */
  key: string;
  /** Pode soltar agora? (false em telas estreitas). */
  enabled?: () => boolean;
  /** Chamado ao soltar ou devolver o painel ao lugar. */
  onChange?: (floating: boolean) => void;
  /** Chamado depois de mover ou redimensionar (ex.: reajustar um terminal). */
  onMove?: () => void;
}

export class Movable {
  private box: Box | null = null;
  private max = false;
  private sizing: { id: number; edge: Edge; sx: number; sy: number; start: Box } | null = null;
  private drag: { id: number; dx: number; dy: number; sx: number; sy: number; moving: boolean } | null = null;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private el: HTMLElement,
    handle: HTMLElement,
    private opts: MovableOptions,
  ) {
    handle.classList.add('ui-move-handle');
    handle.addEventListener('pointerdown', (e) => this.onDown(e, handle));
    handle.addEventListener('pointermove', (e) => this.onMove(e));
    handle.addEventListener('pointerup', (e) => this.onUp(e, handle));
    handle.addEventListener('pointercancel', (e) => this.onUp(e, handle));
    handle.addEventListener('dblclick', (e) => {
      if (interactive(e.target)) return;
      if (this.max) this.toggleMaximize();
      else this.dock();
    });
    for (const edge of EDGES) el.append(this.edgeHandle(edge));
    const saved = load(opts.key);
    if (saved && this.allowed()) this.float(saved, false);
    addEventListener('resize', () => {
      // Tela estreita: volta ao lugar sem esquecer a posição guardada, que volta quando a tela alarga de novo.
      if (!this.allowed()) this.unfloat();
      else if (this.box) this.apply(this.box);
      else {
        const saved = load(opts.key);
        if (saved) this.float(saved, true);
      }
    });
    // Redimensionado pelo canto (resize: both): guarda o tamanho novo.
    if (typeof ResizeObserver === 'function') {
      new ResizeObserver(() => {
        if (!this.box || this.max || this.drag?.moving || this.sizing || this.el.hidden) return;
        const w = this.el.offsetWidth;
        const h = this.el.offsetHeight;
        if (!w || !h || (w === this.box.w && h === this.box.h)) return;
        this.box = { ...this.box, w, h };
        this.scheduleSave();
        this.opts.onMove?.();
      }).observe(el);
    }
  }

  get floating(): boolean {
    return this.box !== null;
  }

  /** Ocupando a tela toda do Habblaud (por cima de tudo; não arrasta). */
  get maximized(): boolean {
    return this.max;
  }

  toggleMaximize(force?: boolean): void {
    const next = force ?? !this.max;
    if (next === this.max) return;
    this.max = next;
    this.el.classList.toggle('is-max', next);
    this.opts.onMove?.();
  }

  /**
   * Relê a posição guardada (outra janela com a mesma chave pode ter mudado) e aplica: duas janelas que se
   * revezam no mesmo lugar (os dois terminais) ficam sempre na mesma posição.
   */
  restore(): void {
    const saved = load(this.opts.key);
    if (saved && this.allowed()) this.float(saved, false);
    else if (this.box) {
      this.box = null;
      this.el.classList.remove('is-floating');
      for (const p of ['left', 'top', 'width', 'height']) this.el.style.removeProperty(p);
    }
  }

  /** Volta ao lugar padrão (e esquece a posição guardada). */
  dock(): void {
    if (!this.box) return;
    save(this.opts.key, null);
    this.unfloat();
  }

  /** Volta ao lugar padrão sem mexer na posição guardada. */
  private unfloat(): void {
    if (!this.box) return;
    // Um salvamento pendente gravaria a caixa que já não vale (ou apagaria a guardada).
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = null;
    this.box = null;
    this.el.classList.remove('is-floating');
    for (const p of ['left', 'top', 'width', 'height']) this.el.style.removeProperty(p);
    this.opts.onChange?.(false);
    this.opts.onMove?.();
  }

  /** Alça invisível numa borda/quina: puxar redimensiona a janela (soltando-a do lugar, se estava fixa). */
  private edgeHandle(edge: Edge): HTMLElement {
    const g = document.createElement('div');
    g.className = `ui-resize ui-resize--${edge}`;
    g.setAttribute('aria-hidden', 'true');
    g.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || this.max || !this.allowed()) return;
      e.preventDefault();
      e.stopPropagation();
      const r = this.el.getBoundingClientRect();
      if (!this.box) this.float({ x: r.left, y: r.top, w: r.width, h: r.height }, true);
      this.sizing = { id: e.pointerId, edge, sx: e.clientX, sy: e.clientY, start: { ...this.box! } };
      this.el.classList.add('is-resizing');
      g.setPointerCapture(e.pointerId);
    });
    g.addEventListener('pointermove', (e) => {
      const z = this.sizing;
      if (!z || z.id !== e.pointerId) return;
      const dx = e.clientX - z.sx;
      const dy = e.clientY - z.sy;
      const b = { ...z.start };
      if (edge.includes('e')) b.w = Math.max(MIN_W, z.start.w + dx);
      if (edge.includes('s')) b.h = Math.max(MIN_H, z.start.h + dy);
      if (edge.includes('w')) {
        b.w = Math.max(MIN_W, z.start.w - dx);
        b.x = z.start.x + z.start.w - b.w;
      }
      if (edge.includes('n')) {
        // Para no limite de cima: passando dele, a borda de baixo desceria.
        b.h = Math.max(MIN_H, Math.min(z.start.h - dy, z.start.y + z.start.h - this.minTop()));
        b.y = z.start.y + z.start.h - b.h;
      }
      this.apply(b);
    });
    const end = (e: PointerEvent) => {
      const z = this.sizing;
      if (!z || z.id !== e.pointerId) return;
      this.sizing = null;
      this.el.classList.remove('is-resizing');
      if (g.hasPointerCapture(e.pointerId)) g.releasePointerCapture(e.pointerId);
      this.scheduleSave();
      this.opts.onMove?.();
    };
    g.addEventListener('pointerup', end);
    g.addEventListener('pointercancel', end);
    return g;
  }

  private allowed(): boolean {
    return this.opts.enabled?.() ?? true;
  }

  private onDown(e: PointerEvent, handle: HTMLElement): void {
    if (e.button !== 0 || this.max || interactive(e.target) || !this.allowed()) return;
    const r = this.el.getBoundingClientRect();
    this.drag = { id: e.pointerId, dx: e.clientX - r.left, dy: e.clientY - r.top, sx: e.clientX, sy: e.clientY, moving: false };
    handle.setPointerCapture(e.pointerId);
  }

  private onMove(e: PointerEvent): void {
    const d = this.drag;
    if (!d || d.id !== e.pointerId) return;
    if (!d.moving) {
      if (Math.abs(e.clientX - d.sx) < DRAG_THRESHOLD && Math.abs(e.clientY - d.sy) < DRAG_THRESHOLD) return;
      d.moving = true;
      const r = this.el.getBoundingClientRect();
      this.float({ x: r.left, y: r.top, w: r.width, h: r.height }, true);
      this.el.classList.add('is-dragging');
    }
    e.preventDefault();
    if (this.box) this.apply({ ...this.box, x: e.clientX - d.dx, y: e.clientY - d.dy });
  }

  private onUp(e: PointerEvent, handle: HTMLElement): void {
    const d = this.drag;
    if (!d || d.id !== e.pointerId) return;
    this.drag = null;
    if (handle.hasPointerCapture(e.pointerId)) handle.releasePointerCapture(e.pointerId);
    if (!d.moving) return;
    this.el.classList.remove('is-dragging');
    this.scheduleSave();
    this.opts.onMove?.();
  }

  private float(b: Box, notify: boolean): void {
    const was = this.box !== null;
    this.el.classList.add('is-floating');
    this.apply(b);
    if (!was && notify) this.opts.onChange?.(true);
    else if (!was) queueMicrotask(() => this.opts.onChange?.(true));
  }

  /**
   * Limite de cima: logo abaixo da barra superior, como os painéis no lugar. Por cima dela, a barra da janela
   * ficaria coberta e não haveria por onde arrastar de volta (nem fechar, no terminal).
   */
  private minTop(): number {
    const s = getComputedStyle(this.el);
    return (parseFloat(s.getPropertyValue('--top-h')) || 0) + (parseFloat(s.getPropertyValue('--gap')) || 0);
  }

  /** Aplica a caixa, mantendo um pedaço da janela (e a barra) dentro da tela. */
  private apply(b: Box): void {
    const w = Math.max(MIN_W, Math.min(b.w, innerWidth));
    const x = Math.min(innerWidth - KEEP_VISIBLE, Math.max(KEEP_VISIBLE - w, b.x));
    // O limite de cima vence o de baixo: numa janela baixa demais, a barra continua alcançável.
    const y = Math.max(this.minTop(), Math.min(innerHeight - MIN_H, b.y));
    // A altura encolhe para a janela não passar da borda de baixo.
    const h = Math.max(MIN_H, Math.min(b.h, innerHeight - y - 8));
    this.box = { x, y, w, h };
    const s = this.el.style;
    s.left = `${Math.round(x)}px`;
    s.top = `${Math.round(y)}px`;
    s.width = `${Math.round(w)}px`;
    s.height = `${Math.round(h)}px`;
  }

  private scheduleSave(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => save(this.opts.key, this.box), 250);
  }
}

/** Botão "expandir na tela toda / restaurar" de uma janela móvel (o `get` devolve o Movable dela). */
export function maximizeButton(get: () => Movable | undefined, onToggle?: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'ui-icon-btn ui-icon-btn--sm ui-term__max';
  const sync = () => {
    const max = !!get()?.maximized;
    b.innerHTML = max ? ICONS.restore : ICONS.maximize;
    const label = max ? tr('Restaurar o tamanho') : tr('Expandir na tela toda');
    b.title = label;
    b.setAttribute('aria-label', label);
    b.setAttribute('aria-pressed', String(max));
  };
  b.addEventListener('click', () => {
    get()?.toggleMaximize();
    sync();
    onToggle?.();
  });
  sync();
  return b;
}

/** Clique num botão/campo da barra não arrasta. */
function interactive(t: EventTarget | null): boolean {
  return t instanceof Element && !!t.closest('button, a, input, select, textarea, [role="button"], kbd');
}

function load(key: string): Box | null {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? 'null') as Partial<Box> | null;
    if (v && [v.x, v.y, v.w, v.h].every((n) => typeof n === 'number' && Number.isFinite(n))) return v as Box;
  } catch {
    // sem armazenamento
  }
  return null;
}

function save(key: string, b: Box | null): void {
  try {
    if (b) localStorage.setItem(key, JSON.stringify({ x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.w), h: Math.round(b.h) }));
    else localStorage.removeItem(key);
  } catch {
    // sem armazenamento
  }
}
