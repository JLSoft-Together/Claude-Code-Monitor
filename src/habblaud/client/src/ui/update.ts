// Aviso de versão nova: quando o servidor passa a servir outro build do cliente (ex.: depois de um
// `npm run docker:up`), esta página está desatualizada — ela não conhece estados e recursos novos.
// Mostra o aviso e recarrega sozinha em alguns segundos (dá para adiar).
import type { OfficeStore } from '../net/store';
import { h, setHidden, setText } from './dom';
import { tr } from '../../../shared/i18n';

const RELOAD_IN_S = 5;

export class UpdateBanner {
  readonly el: HTMLElement;
  private text: HTMLElement;
  private timer: ReturnType<typeof setInterval> | null = null;
  private left = RELOAD_IN_S;

  constructor(store: OfficeStore, private reload: () => void = () => location.reload()) {
    this.text = h('span');
    const now = h('button', { class: 'ui-btn ui-btn--sm', type: 'button', text: tr('Recarregar agora'), on: { click: () => this.reload() } });
    const later = h('button', { class: 'ui-btn ui-btn--sm', type: 'button', text: tr('Depois'), on: { click: () => this.postpone() } });
    this.el = h(
      'div',
      { class: 'ui-banner ui-banner--update', role: 'status', hidden: true },
      h('span', { class: 'ui-banner__dot', attrs: { 'aria-hidden': 'true' } }),
      h('span', { class: 'ui-banner__text' }, this.text),
      now,
      later,
    );
    store.on('update', () => this.start());
  }

  private start(): void {
    setHidden(this.el, false);
    this.tick();
    this.timer = setInterval(() => this.tick(), 1_000);
  }

  private tick(): void {
    if (this.left <= 0) {
      this.stop();
      this.reload();
      return;
    }
    setText(this.text, tr('O Habblaud foi atualizado. Recarregando em {0} s…', [this.left]));
    this.left--;
  }

  private postpone(): void {
    this.stop();
    setText(this.text, tr('O Habblaud foi atualizado. Recarregue a página quando quiser.'));
  }

  private stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
