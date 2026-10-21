// Camadas de estado: splash de carregamento, escritório vazio e aviso de conexão perdida.
import type { UiComponent, UiContext } from './context';
import { h, prefersReducedMotion, setHidden, setText } from './dom';
import { FALLBACK_MARK } from './icons';
import { emptyOfficeHint } from './provider';
import { wordmark } from './widgets';
import { tr } from '../../../shared/i18n';

/** Depois de quanto tempo sem conexão o aviso aparece. */
const DISCONNECTED_BANNER_MS = 8_000;

function brandMark(size: number): HTMLElement {
  const mark = h('span', { class: 'ui-brand__mark' });
  const img = h('img', { attrs: { src: '/assets/brand/logo-mark@4x.png', alt: '', width: size, height: size, draggable: 'false' } });
  img.addEventListener('error', () => {
    mark.innerHTML = FALLBACK_MARK;
  });
  mark.append(img);
  return mark;
}

export class Splash implements UiComponent {
  readonly el: HTMLElement;
  private text: HTMLElement;
  private done = false;
  private readonly startedAt = performance.now();
  private tick: ReturnType<typeof setTimeout> | null = null;

  constructor(private ctx: UiContext) {
    this.text = h('p', { class: 'ui-splash__text', text: tr('Conectando ao escritório…') });
    this.el = h(
      'div',
      { class: 'ui-splash', role: 'status', attrs: { 'aria-live': 'polite' } },
      h('div', { class: 'ui-splash__inner' }, brandMark(64), wordmark('ui-splash__name'), this.text, h('span', { class: 'ui-splash__bar' })),
    );
  }

  render(): void {
    if (this.done) return;
    const { store } = this.ctx;
    if (store.snapshot) {
      this.done = true;
      this.el.classList.add('is-hidden');
      const remove = () => this.el.remove();
      if (prefersReducedMotion()) remove();
      else setTimeout(remove, 600);
      return;
    }
    const waited = performance.now() - this.startedAt;
    let text = tr('Conectando ao escritório…');
    if (waited > DISCONNECTED_BANNER_MS) text = tr('O servidor do Habblaud não responde. Confira se ele está rodando (npm run dev ou npm start); seguimos tentando.');
    else if (store.connection === 'closed') text = tr('Não foi possível conectar ao servidor do Habblaud. Tentando de novo…');
    setText(this.text, text);
    // Reavalia o texto mesmo sem eventos novos.
    this.tick ??= setTimeout(() => {
      this.tick = null;
      this.ctx.invalidate();
    }, 1_000);
  }
}

/** Conectado e sem nenhuma sessão: o cartão "escritório vazio" aparece (e os painéis não repetem o aviso). */
export function officeIsEmpty(ctx: UiContext): boolean {
  const { store } = ctx;
  const snap = store.snapshot;
  const connected = store.connection === 'open' || store.connection === 'mock';
  // No timelapse, um momento sem ninguém não é "abra o Claude Code (ou o Codex)".
  return connected && !store.replaying && !!snap && snap.agents.length === 0 && snap.rooms.length === 0;
}

export class EmptyState implements UiComponent {
  readonly el: HTMLElement;
  private hint: HTMLElement;
  private demoBtn: HTMLButtonElement;
  private busy = false;

  constructor(private ctx: UiContext) {
    const art = h('div', { class: 'ui-empty__art', attrs: { 'aria-hidden': 'true' } });
    const img = h('img', { attrs: { src: '/assets/illustrations/empty-office.png', alt: '', draggable: 'false' } });
    img.addEventListener('error', () => {
      img.remove();
      art.classList.add('is-css');
      // Ilustração em CSS: mesa vazia, monitor apagado, planta e luminária.
      art.append(
        h('span', { class: 'ui-empty__lamp' }),
        h('span', { class: 'ui-empty__monitor' }),
        h('span', { class: 'ui-empty__desk' }),
        h('span', { class: 'ui-empty__chair' }),
        h('span', { class: 'ui-empty__plant' }),
      );
    });
    art.append(img);
    this.hint = h('p', { class: 'ui-empty__text' });
    this.demoBtn = h('button', { class: 'ui-btn ui-btn--primary', type: 'button', text: tr('Ver demonstração'), on: { click: () => void this.startDemo() } });
    this.el = h(
      'section',
      { class: 'ui-empty', hidden: true, attrs: { 'aria-labelledby': 'ui-empty-title' } },
      art,
      h('h2', { class: 'ui-empty__title', text: tr('O escritório está vazio'), attrs: { id: 'ui-empty-title' } }),
      this.hint,
      this.demoBtn,
    );
  }

  render(): void {
    const { store } = this.ctx;
    const snap = store.snapshot;
    const show = officeIsEmpty(this.ctx);
    setHidden(this.el, !show);
    if (!show || !snap) return;
    setText(this.hint, emptyOfficeHint(snap.accounts));
    this.demoBtn.disabled = this.busy;
    setHidden(this.demoBtn, store.mock);
  }

  private async startDemo(): Promise<void> {
    this.busy = true;
    this.ctx.invalidate();
    try {
      const ok = await this.ctx.store.setDemo(true);
      if (!ok) this.ctx.announce(tr('Não foi possível ligar a demonstração.'));
    } catch {
      this.ctx.announce(tr('Não foi possível falar com o servidor.'));
    } finally {
      this.busy = false;
      this.ctx.invalidate();
    }
  }
}

export class ConnectionBanner implements UiComponent {
  readonly el: HTMLElement;
  private since: number | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private text: HTMLElement;
  private retry: HTMLElement;

  constructor(private ctx: UiContext) {
    this.text = h('span');
    this.retry = h('span', { class: 'ui-banner__retry' });
    // A reconexão automática (com espera crescente) mora no store; o botão só antecipa a próxima tentativa.
    const retryBtn = h('button', { class: 'ui-btn ui-btn--sm', type: 'button', text: tr('Tentar agora'), on: { click: () => ctx.store.reconnectNow() } });
    this.el = h(
      'div',
      { class: 'ui-banner', role: 'alert', hidden: true },
      h('span', { class: 'ui-banner__dot', attrs: { 'aria-hidden': 'true' } }),
      h('span', { class: 'ui-banner__text' }, this.text, this.retry),
      retryBtn,
    );
  }

  render(): void {
    const { store } = this.ctx;
    const conn = store.connection;
    const down = conn === 'connecting' || conn === 'closed';
    if (!down) {
      this.since = null;
      if (this.timer) clearTimeout(this.timer);
      this.timer = null;
      setHidden(this.el, true);
      return;
    }
    this.since ??= Date.now();
    const elapsed = Date.now() - this.since;
    if (elapsed < DISCONNECTED_BANNER_MS) {
      this.timer ??= setTimeout(() => {
        this.timer = null;
        this.ctx.invalidate();
      }, DISCONNECTED_BANNER_MS - elapsed + 50);
      return;
    }
    setText(
      this.text,
      store.snapshot
        ? tr('Sem conexão com o servidor do Habblaud há algum tempo. O escritório mostra o último estado conhecido.')
        : tr('O servidor do Habblaud não responde. Confira se ele está rodando (npm run dev ou npm start).'),
    );
    const next = store.nextRetryAt;
    const secs = next === null ? 0 : Math.max(1, Math.ceil((next - Date.now()) / 1000));
    setText(this.retry, next === null ? tr(' Tentando reconectar…') : tr(' Nova tentativa em {0} s.', [secs]));
    setHidden(this.el, false);
    // Atualiza a contagem regressiva a cada segundo enquanto o aviso estiver aberto.
    this.timer ??= setTimeout(() => {
      this.timer = null;
      this.ctx.invalidate();
    }, 1_000);
  }
}
