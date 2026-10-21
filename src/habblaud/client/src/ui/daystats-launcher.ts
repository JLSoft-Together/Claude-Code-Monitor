// Botão "Meu dia" da barra superior. O painel (ui/daystats.ts, com gráficos e o acumulador compartilhado) fica num
// pedaço separado do bundle e só é baixado na primeira abertura; no ?mock=1 carrega já no início, para o
// acumulador local contar desde que a página abriu.
import type { UiComponent, UiContext } from './context';
import type { DayPanel } from './daystats';
import { iconButton } from './dom';
import { tr } from '../../../shared/i18n';

/** Colunas de um gráfico em pixels (o mesmo traço dos outros ícones da barra). */
const DAY_ICON =
  '<svg class="ui-px-icon" width="20" height="20" viewBox="0 0 10 10" shape-rendering="crispEdges" aria-hidden="true" focusable="false">' +
  '<path fill="currentColor" d="M0 9h10v1H0zM1 5h2v4H1zM4 2h2v7H4zM7 4h2v5H7z"/></svg>';

export class DayLauncher implements UiComponent {
  readonly button: HTMLButtonElement;
  private panel: DayPanel | null = null;
  private loading: Promise<DayPanel> | null = null;

  /** `mount` coloca a janela do painel na interface quando ela é criada. */
  constructor(
    private readonly ctx: UiContext,
    private readonly mount: (el: HTMLElement) => void,
  ) {
    this.button = iconButton(DAY_ICON, tr('Meu dia: para onde foi o tempo (M)'), () => this.toggle());
    this.button.setAttribute('aria-haspopup', 'dialog');
    if (ctx.store.mock) void this.load();
  }

  toggle(): void {
    if (this.panel) this.panel.toggle();
    else
      void this.load()
        .then((p) => p.open())
        .catch(() => this.ctx.announce(tr('Não foi possível abrir o painel Meu dia.')));
  }

  render(): void {
    this.panel?.render();
  }

  private load(): Promise<DayPanel> {
    this.loading ??= import('./daystats').then((m) => {
      const panel = new m.DayPanel(this.ctx, this.button);
      this.mount(panel.el);
      this.panel = panel;
      return panel;
    });
    // Falhou (rede caiu no meio do download): a próxima tentativa baixa de novo.
    this.loading.catch(() => (this.loading = null));
    return this.loading;
  }
}
