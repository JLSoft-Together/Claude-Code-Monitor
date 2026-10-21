// Entregas (botão da caixa na barra do topo): o que cada agente terminou, do jeito que um BA receberia. A lista mostra a
// manchete (primeira frase da resposta), o resumo em linguagem simples e as miniaturas dos anexos; um toque abre o
// modal com o pedido, a resposta inteira e os anexos, e um toque num anexo abre o visualizador (imagem, PDF, vídeo,
// página, texto). Dados de GET /api/deliveries (server/deliveries/deliveries.ts); arquivos por id opaco em
// /api/deliveries/file/:id. Entrega nova chega com um aviso e conta no selo do botão até você abrir a lista.
// Só com o terminal liberado (a resposta inteira e os arquivos do agente).
import { tr } from '../../../shared/i18n';
import type { DeliveryAttachment, DeliveryInfo } from '../../../shared/types';
import { access } from '../net/access';
import { createAvatar } from './avatar';
import type { UiComponent, UiContext } from './context';
import { h, iconButton, setHidden, setText } from './dom';
import { formatDuration, relativeTime } from './format';
import { ICONS } from './icons';
import { renderMarkdown } from './markdown';
import type { TerminalControl } from './terminal';

export const DELIVERIES_URL = '/api/deliveries';
const POLL_MS = 30_000;
const SEEN_KEY = 'habblaud.deliveries.seen';
const TOAST_MS = 9_000;

// ---------------------------------------------------------------- modelo (puro)

const KINDS = new Set(['image', 'pdf', 'video', 'page', 'text', 'file']);

function isAttachment(v: unknown): v is DeliveryAttachment {
  const a = v as Partial<DeliveryAttachment> | null;
  return !!a && typeof a.id === 'string' && /^[a-f0-9]{8,64}$/.test(a.id) && typeof a.name === 'string' && KINDS.has(a.kind as string);
}

/** Valida a resposta de /api/deliveries (o que não tiver o formato certo fica de fora). */
export function parseDeliveries(body: unknown): DeliveryInfo[] {
  const list = (body as { deliveries?: unknown } | null)?.deliveries;
  if (!Array.isArray(list)) return [];
  return list
    .filter((d): d is DeliveryInfo => {
      const x = d as Partial<DeliveryInfo> | null;
      return !!x && typeof x.id === 'string' && typeof x.headline === 'string' && typeof x.text === 'string' && typeof x.finishedAt === 'number' && Array.isArray(x.attachments);
    })
    .map((d) => ({ ...d, attachments: d.attachments.filter(isAttachment) }));
}

/** Entregas mais novas que a última vez que você abriu a lista. */
export function unseenCount(list: readonly DeliveryInfo[], seenAt: number): number {
  return list.filter((d) => d.finishedAt > seenAt).length;
}

/** As que chegaram depois da última consulta (para o aviso). */
export function arrivals(list: readonly DeliveryInfo[], newestKnown: number): DeliveryInfo[] {
  return newestKnown ? list.filter((d) => d.finishedAt > newestKnown) : [];
}

export function fileUrl(a: Pick<DeliveryAttachment, 'id'>): string {
  return `/api/deliveries/file/${encodeURIComponent(a.id)}`;
}

export function projectName(path: string | undefined): string {
  return path ? (path.split(/[\\/]/).filter(Boolean).pop() ?? path) : '';
}

/** "15 passos · 3 arquivos · 12 min" (o que interessa a quem recebe). */
export function workLine(d: Pick<DeliveryInfo, 'tools' | 'edited' | 'startedAt' | 'finishedAt'>): string {
  const parts = [d.tools === 1 ? tr('1 passo') : tr('{0} passos', [d.tools])];
  if (d.edited) parts.push(d.edited === 1 ? tr('1 arquivo alterado') : tr('{0} arquivos alterados', [d.edited]));
  const ms = d.finishedAt - d.startedAt;
  if (ms >= 60_000) parts.push(formatDuration(ms));
  return parts.join(' · ');
}

/** Rótulo curto do tipo de anexo na miniatura. */
function kindLabel(kind: DeliveryAttachment['kind']): string {
  switch (kind) {
    case 'image':
      return tr('IMG');
    case 'pdf':
      return 'PDF';
    case 'video':
      return tr('VÍDEO');
    case 'page':
      return tr('PÁGINA');
    case 'text':
      return tr('TEXTO');
    default:
      return tr('ARQ');
  }
}

function readSeen(): number {
  try {
    return Number(localStorage.getItem(SEEN_KEY)) || 0;
  } catch {
    return 0;
  }
}

function writeSeen(at: number): void {
  try {
    localStorage.setItem(SEEN_KEY, String(at));
  } catch {
    // sem armazenamento: o selo volta a contar ao recarregar
  }
}

// ---------------------------------------------------------------- componente

export class Deliveries implements UiComponent {
  readonly button: HTMLButtonElement;
  readonly el: HTMLElement;
  private readonly badge: HTMLElement;
  private readonly panel: HTMLElement;
  private readonly listEl: HTMLElement;
  private readonly empty: HTMLElement;
  private readonly modal: HTMLDialogElement;
  private readonly modalBody: HTMLElement;
  private readonly viewer: HTMLDialogElement;
  private readonly viewerBody: HTMLElement;
  private readonly viewerTitle: HTMLElement;
  private readonly viewerCount: HTMLElement;
  private readonly viewerOpen: HTMLAnchorElement;
  private readonly prevBtn: HTMLButtonElement;
  private readonly nextBtn: HTMLButtonElement;
  private readonly toast: HTMLButtonElement;
  private list: DeliveryInfo[] = [];
  private seenAt = readSeen();
  private newestKnown = 0;
  private loading = false;
  private loaded = false;
  private error = '';
  private timer: ReturnType<typeof setInterval> | null = null;
  private toastTimer: ReturnType<typeof setTimeout> | null = null;
  private current: DeliveryInfo | null = null;
  private viewIndex = 0;
  private available = false;

  constructor(
    private readonly ctx: UiContext,
    private readonly terminal: TerminalControl,
  ) {
    this.badge = h('span', { class: 'ui-deliv-badge', hidden: true, attrs: { 'aria-hidden': 'true' } });
    this.button = iconButton(ICONS.delivery, tr('Entregas: o que os agentes terminaram'), () => this.togglePanel(), 'ui-btn-deliv');
    this.button.setAttribute('aria-haspopup', 'dialog');
    this.button.append(this.badge);
    this.button.hidden = true;

    this.listEl = h('ul', { class: 'ui-deliv-list', attrs: { 'aria-label': tr('Entregas') } });
    this.empty = h('p', { class: 'ui-deliv-empty', text: tr('Carregando as entregas…') });
    this.panel = h(
      'div',
      { class: 'ui-popover ui-deliv', role: 'dialog', tabIndex: -1, attrs: { 'aria-label': tr('Entregas'), id: 'ui-deliveries', popover: 'auto' } },
      h('div', { class: 'ui-popover__head' }, h('h2', { text: tr('Entregas') }), iconButton(ICONS.close, tr('Fechar'), () => this.hidePanel(), 'ui-icon-btn--sm')),
      h('p', { class: 'ui-deliv-lead', text: tr('O que cada agente terminou, em poucas palavras. Toque para ver o pedido, a resposta e os anexos.') }),
      this.empty,
      this.listEl,
    );
    this.panel.addEventListener('toggle', () => {
      this.button.setAttribute('aria-expanded', String(this.panelOpen));
      this.button.classList.toggle('is-on', this.panelOpen);
    });

    this.modalBody = h('div', { class: 'ui-deliv-modal__body' });
    this.modal = h('dialog', { class: 'ui-deliv-modal', attrs: { 'aria-label': tr('Entrega') } }, this.modalBody) as HTMLDialogElement;
    this.modal.addEventListener('click', (e) => {
      if (e.target === this.modal) this.modal.close();
    });

    this.viewerTitle = h('span', { class: 'ui-deliv-viewer__title' });
    this.viewerCount = h('span', { class: 'ui-deliv-viewer__count' });
    this.viewerOpen = h('a', { class: 'ui-btn ui-deliv-viewer__open', text: tr('Abrir'), attrs: { target: '_blank', rel: 'noopener' } }) as HTMLAnchorElement;
    this.prevBtn = iconButton(ICONS.chevronLeft, tr('Anterior'), () => this.step(-1), 'ui-deliv-viewer__nav');
    this.nextBtn = iconButton(ICONS.chevronRight, tr('Próximo'), () => this.step(1), 'ui-deliv-viewer__nav');
    this.viewerBody = h('div', { class: 'ui-deliv-viewer__body' });
    this.viewer = h(
      'dialog',
      { class: 'ui-deliv-viewer', attrs: { 'aria-label': tr('Anexo') } },
      h('div', { class: 'ui-deliv-viewer__bar' }, this.prevBtn, h('div', { class: 'ui-deliv-viewer__label' }, this.viewerTitle, this.viewerCount), this.nextBtn, this.viewerOpen, iconButton(ICONS.close, tr('Fechar'), () => this.viewer.close(), 'ui-icon-btn--sm')),
      this.viewerBody,
    ) as HTMLDialogElement;
    this.viewer.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft') this.step(-1);
      else if (e.key === 'ArrowRight') this.step(1);
    });
    this.viewer.addEventListener('close', () => this.viewerBody.replaceChildren());
    this.wireSwipe();

    this.toast = h('button', { class: 'ui-deliv-toast', type: 'button', hidden: true, on: { click: () => this.onToast() } });

    this.el = h('div', { class: 'ui-deliv-root' }, this.panel, this.modal, this.viewer, this.toast);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && this.available) void this.refresh();
    });
  }

  get panelOpen(): boolean {
    try {
      return this.panel.matches(':popover-open');
    } catch {
      return this.panel.classList.contains('is-open');
    }
  }

  render(): void {
    const store = this.ctx.store;
    // Só na página do celular (porta remota com login e o terminal liberado): no computador o terminal e o histórico
    // já mostram tudo, e a barra não ganha botão nem consulta nova sem configurar o acesso pelo celular.
    const available = access().remote && access().terminal && !!store.snapshot?.meta.terminal && !store.mock && !store.replaying;
    if (available !== this.available) {
      this.available = available;
      setHidden(this.button, !available);
      if (available) {
        void this.refresh();
        this.timer ??= setInterval(() => {
          if (!document.hidden) void this.refresh();
        }, POLL_MS);
      } else if (this.timer) {
        clearInterval(this.timer);
        this.timer = null;
      }
    }
  }

  /** Abre uma entrega pelo id (toque num aviso do celular ou ?delivery= no endereço). */
  async openById(id: string): Promise<boolean> {
    let d = this.list.find((x) => x.id === id);
    if (!d) {
      await this.refresh();
      d = this.list.find((x) => x.id === id);
    }
    if (d) this.openDelivery(d);
    else this.openPanel();
    return !!d;
  }

  /** Abre a lista (atalho para outros componentes). */
  openPanel(): void {
    if (!this.panelOpen) this.togglePanel();
  }

  private async refresh(): Promise<void> {
    if (this.loading) return;
    this.loading = true;
    try {
      const res = await fetch(DELIVERIES_URL, { credentials: 'same-origin', cache: 'no-store' });
      const body: unknown = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((body as { error?: string }).error ?? tr('erro {0}', [res.status]));
      const list = parseDeliveries(body);
      const fresh = this.loaded ? arrivals(list, this.newestKnown) : [];
      this.list = list;
      this.loaded = true;
      this.error = '';
      this.newestKnown = Math.max(this.newestKnown, ...list.map((d) => d.finishedAt), 0);
      if (!this.seenAt) {
        // Primeira vez: nada é "novo" (não acende o selo com a semana inteira).
        this.seenAt = this.newestKnown;
        writeSeen(this.seenAt);
      }
      if (fresh.length) this.showToast(fresh[0], fresh.length);
    } catch (err) {
      this.error = (err as Error).message || tr('não deu para carregar');
    } finally {
      this.loading = false;
      this.updateBadge();
      if (this.panelOpen) this.renderList();
    }
  }

  private updateBadge(): void {
    const n = this.panelOpen ? 0 : unseenCount(this.list, this.seenAt);
    setText(this.badge, n > 9 ? '9+' : String(n));
    setHidden(this.badge, n === 0);
    this.button.setAttribute('aria-label', n > 1 ? tr('Entregas: {0} novas', [n]) : n === 1 ? tr('Entregas: 1 nova') : tr('Entregas: o que os agentes terminaram'));
  }

  private togglePanel(): void {
    if (this.panelOpen) return this.hidePanel();
    const prevSeen = this.seenAt;
    this.renderList(prevSeen);
    const r = this.button.getBoundingClientRect();
    this.panel.style.top = `${Math.round(r.bottom + 8)}px`;
    this.panel.style.right = `${Math.max(8, Math.round(innerWidth - r.right - 4))}px`;
    if (typeof this.panel.showPopover === 'function') this.panel.showPopover();
    else this.panel.classList.add('is-open');
    this.seenAt = Math.max(this.seenAt, this.newestKnown);
    writeSeen(this.seenAt);
    this.updateBadge();
    void this.refresh();
  }

  private hidePanel(): void {
    if (typeof this.panel.hidePopover === 'function' && this.panelOpen) this.panel.hidePopover();
    this.panel.classList.remove('is-open');
  }

  private renderList(highlightAfter = this.seenAt): void {
    const now = Date.now();
    setHidden(this.empty, this.list.length > 0);
    setText(this.empty, this.error ? tr('Não deu para carregar: {0}', [this.error]) : this.loaded ? tr('Nenhuma entrega nos últimos 7 dias.') : tr('Carregando as entregas…'));
    this.listEl.replaceChildren(...this.list.map((d) => h('li', {}, this.card(d, now, d.finishedAt > highlightAfter))));
  }

  private who(d: DeliveryInfo, size: 'sm' | 'md'): HTMLElement {
    const agent = d.agentId ? this.ctx.agent(d.agentId) : undefined;
    if (agent) return createAvatar(agent, size);
    const letter = (d.agentName ?? projectName(d.project) ?? '?').trim().charAt(0).toUpperCase() || '?';
    return h('span', { class: `ui-deliv-initial ui-deliv-initial--${size}`, text: letter, attrs: { 'aria-hidden': 'true' } });
  }

  private card(d: DeliveryInfo, now: number, isNew: boolean): HTMLElement {
    const visuals = d.attachments.slice(0, 4);
    const more = d.attachments.length - visuals.length;
    return h(
      'button',
      { class: `ui-deliv-card${isNew ? ' is-new' : ''}`, type: 'button', on: { click: () => this.openDelivery(d) } },
      h(
        'span',
        { class: 'ui-deliv-card__who' },
        this.who(d, 'sm'),
        h('span', { class: 'ui-deliv-card__name', text: d.agentName ?? tr('Agente') }),
        d.project ? h('span', { class: 'ui-deliv-card__project', text: projectName(d.project) }) : null,
        h('span', { class: 'ui-deliv-card__when', text: relativeTime(d.finishedAt, now) }),
        isNew ? h('span', { class: 'ui-deliv-card__new', text: tr('nova') }) : null,
      ),
      h('span', { class: 'ui-deliv-card__headline', text: d.headline }),
      d.summary ? h('span', { class: 'ui-deliv-card__summary', text: d.summary }) : null,
      visuals.length
        ? h(
            'span',
            { class: 'ui-deliv-card__thumbs' },
            ...visuals.map((a) => this.thumb(a)),
            more > 0 ? h('span', { class: 'ui-deliv-thumb ui-deliv-thumb--more', text: `+${more}` }) : null,
          )
        : null,
      h('span', { class: 'ui-deliv-card__meta', text: workLine(d) }),
    );
  }

  private thumb(a: DeliveryAttachment, big = false): HTMLElement {
    const cls = `ui-deliv-thumb${big ? ' ui-deliv-thumb--big' : ''}`;
    if (a.kind === 'image') return h('img', { class: cls, attrs: { src: fileUrl(a), alt: a.caption ?? a.name, loading: 'lazy', decoding: 'async' } });
    return h('span', { class: `${cls} ui-deliv-thumb--doc ui-deliv-thumb--${a.kind}`, attrs: { title: a.name } }, h('b', { text: kindLabel(a.kind) }), big ? h('span', { text: a.name }) : null);
  }

  openDelivery(d: DeliveryInfo): void {
    this.current = d;
    const now = Date.now();
    const agent = d.agentId ? this.ctx.agent(d.agentId) : undefined;
    const alive = !!agent && agent.status !== 'offline';
    const full = h('div', { class: 'ui-deliv-md' });
    full.append(renderMarkdown(d.text));
    const actions: HTMLElement[] = [];
    if (alive && d.agentId) {
      const id = d.agentId;
      actions.push(
        h('button', { class: 'ui-btn', type: 'button', text: tr('Abrir terminal'), on: { click: () => (this.closeAll(), this.ctx.select({ type: 'agent', id }), (this.ctx.terminals ?? this.terminal).open(id)) } }),
        h('button', { class: 'ui-btn ui-perm__btn--allow', type: 'button', text: tr('Responder'), on: { click: () => (this.closeAll(), this.ctx.select({ type: 'agent', id }, { focus: true })) } }),
      );
    }
    const parts: Array<HTMLElement | null> = [
      h(
        'header',
        { class: 'ui-deliv-modal__head' },
        this.who(d, 'md'),
        h(
          'div',
          { class: 'ui-deliv-modal__who' },
          h('strong', { text: d.agentName ?? tr('Agente') }),
          h('span', { text: [projectName(d.project), relativeTime(d.finishedAt, now), workLine(d)].filter(Boolean).join(' · ') }),
        ),
        iconButton(ICONS.close, tr('Fechar'), () => this.modal.close(), 'ui-icon-btn--sm'),
      ),
      h('h2', { class: 'ui-deliv-modal__headline', text: d.headline }),
      d.summary ? h('div', { class: 'ui-deliv-modal__summary' }, h('span', { class: 'ui-deliv-modal__label', text: tr('Em resumo') }), h('p', { text: d.summary })) : null,
      d.attachments.length
        ? h(
            'div',
            { class: 'ui-deliv-modal__atts' },
            ...d.attachments.map((a, i) =>
              h(
                'button',
                { class: 'ui-deliv-att', type: 'button', attrs: { 'aria-label': tr('Ver {0}', [a.name]) }, on: { click: () => this.openViewer(i) } },
                this.thumb(a, true),
                h('span', { class: 'ui-deliv-att__caption', text: a.caption ?? a.name }),
              ),
            ),
          )
        : null,
      h('div', { class: 'ui-deliv-modal__request' }, h('span', { class: 'ui-deliv-modal__label', text: tr('Pedido') }), h('p', { text: d.request || tr('(sem texto)') })),
      h('details', { class: 'ui-deliv-modal__full' }, h('summary', { text: tr('Resposta completa') }), full),
      actions.length ? h('div', { class: 'ui-deliv-modal__actions' }, ...actions) : null,
    ];
    this.modalBody.replaceChildren(...parts.filter((p): p is HTMLElement => !!p));
    if (!this.modal.open) this.modal.showModal();
    this.modalBody.scrollTop = 0;
  }

  private closeAll(): void {
    if (this.viewer.open) this.viewer.close();
    if (this.modal.open) this.modal.close();
    this.hidePanel();
  }

  private openViewer(index: number): void {
    const d = this.current;
    if (!d || !d.attachments.length) return;
    this.viewIndex = (index + d.attachments.length) % d.attachments.length;
    const a = d.attachments[this.viewIndex];
    const url = fileUrl(a);
    setText(this.viewerTitle, a.caption ?? a.name);
    setText(this.viewerCount, d.attachments.length > 1 ? tr('{0} de {1}', [this.viewIndex + 1, d.attachments.length]) : '');
    setHidden(this.prevBtn, d.attachments.length < 2);
    setHidden(this.nextBtn, d.attachments.length < 2);
    this.viewerOpen.href = url;
    let body: HTMLElement;
    this.viewerBody.classList.remove('is-zoomed');
    if (a.kind === 'image') {
      const img = h('img', { class: 'ui-deliv-viewer__img', attrs: { src: url, alt: a.caption ?? a.name } });
      img.addEventListener('click', (e) => this.toggleZoom(img, e));
      body = img;
    }
    else if (a.kind === 'video') body = h('video', { class: 'ui-deliv-viewer__video', attrs: { src: url, controls: true, playsinline: true } });
    else if (a.kind === 'pdf' || a.kind === 'page') body = h('iframe', { class: 'ui-deliv-viewer__frame', attrs: { src: url, title: a.name } });
    else if (a.kind === 'text') {
      body = h('pre', { class: 'ui-deliv-viewer__text', text: tr('Carregando…') });
      const pre = body;
      void fetch(url, { credentials: 'same-origin' })
        .then(async (r) => (r.ok ? r.text() : Promise.reject(new Error(((await r.json().catch(() => ({}))) as { error?: string }).error ?? tr('erro {0}', [r.status])))))
        .then((t) => setText(pre, t.slice(0, 200_000)), (e: Error) => setText(pre, tr('Não deu para abrir: {0}', [e.message])));
    } else body = h('div', { class: 'ui-deliv-viewer__file' }, h('p', { text: a.name }), h('a', { class: 'ui-btn', text: tr('Baixar'), attrs: { href: url, download: a.name } }));
    if (body instanceof HTMLImageElement || body instanceof HTMLIFrameElement) {
      body.addEventListener('error', () => this.viewerBody.replaceChildren(h('p', { class: 'ui-deliv-viewer__err', text: tr('Não deu para abrir este anexo (o arquivo mudou de lugar ou o computador não respondeu).') })));
    }
    this.viewerBody.replaceChildren(body);
    if (!this.viewer.open) this.viewer.showModal();
  }

  /** Toque na imagem: tamanho real centrado onde tocou (para ler um print largo no celular); outro toque volta. */
  private toggleZoom(img: HTMLImageElement, e: MouseEvent): void {
    const box = img.getBoundingClientRect();
    const zoomed = this.viewerBody.classList.toggle('is-zoomed');
    if (!zoomed || !box.width || !box.height) return;
    const fx = (e.clientX - box.left) / box.width;
    const fy = (e.clientY - box.top) / box.height;
    const view = this.viewerBody;
    view.scrollLeft = fx * img.offsetWidth - view.clientWidth / 2;
    view.scrollTop = fy * img.offsetHeight - view.clientHeight / 2;
  }

  private step(delta: number): void {
    if (this.viewer.open && (this.current?.attachments.length ?? 0) > 1) this.openViewer(this.viewIndex + delta);
  }

  /** Arrastar para o lado troca de anexo (celular). */
  private wireSwipe(): void {
    let x0 = 0;
    let y0 = 0;
    this.viewerBody.addEventListener('touchstart', (e) => {
      if (e.touches.length !== 1) return;
      x0 = e.touches[0].clientX;
      y0 = e.touches[0].clientY;
    }, { passive: true });
    this.viewerBody.addEventListener('touchend', (e) => {
      const t = e.changedTouches[0];
      if (!t || (window.visualViewport?.scale ?? 1) > 1.05 || this.viewerBody.classList.contains('is-zoomed')) return;
      const dx = t.clientX - x0;
      if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(t.clientY - y0) * 1.5) this.step(dx < 0 ? 1 : -1);
    });
  }

  private showToast(d: DeliveryInfo, count: number): void {
    this.current = d;
    this.toast.replaceChildren(
      h('span', { class: 'ui-deliv-toast__icon', attrs: { 'aria-hidden': 'true' } }),
      h('span', { class: 'ui-deliv-toast__text' }, h('b', { text: d.agentName ? tr('{0} entregou', [d.agentName]) : tr('Um agente entregou') }), h('span', { text: count > 1 ? `${d.headline} (+${count - 1})` : d.headline })),
    );
    (this.toast.firstChild as HTMLElement).innerHTML = ICONS.delivery;
    setHidden(this.toast, false);
    this.toast.classList.remove('is-in');
    void this.toast.offsetWidth;
    this.toast.classList.add('is-in');
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => setHidden(this.toast, true), TOAST_MS);
  }

  private onToast(): void {
    setHidden(this.toast, true);
    if (this.current) this.openDelivery(this.current);
  }
}
