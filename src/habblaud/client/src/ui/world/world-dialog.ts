// A janela do Habblaud World: um <dialog> modal (top layer, fundo escurecido, foco preso, Esc fecha) com o botão
// próprio na barra do topo (ícone de cidade, só com o servidor do mundo configurado) e aberto também pelo chip
// "no mundo" / "pausado" ao lado da versão, pelos popups de lançamento ("Criar conta", "Criar personagem") e pelo
// aviso "Enquanto você estava fora". O conteúdo é o WorldSettingsGroup (settings-world.ts): conta, lista de espera,
// personagem, "Seu prédio", dispositivos, conta e dados, bloqueados e sair. O cabeçalho leva o prédio em pixels, o
// título, o chip do estado da conta e o botão de fechar; o corpo rola. A dica do tema em Configurações › Aparência
// continua vindo do grupo (themeNote/onThemePicked), por isso o grupo mora aqui e o popover só recebe os dois.
//
// Dois modais ao mesmo tempo (o popup da lista de espera logo depois do cadastro, ou "Ver o que foi enviado"):
// showModal() empilha na top layer, o Esc fecha só o de cima e o foco volta a esta janela quando ele fecha.
import { tr } from '../../../../shared/i18n';
import type { WorldSource, WorldThemeChoice } from '../../net/world';
import type { UiComponent, UiContext } from '../context';
import { h, iconButton, setHidden } from '../dom';
import { ICONS } from '../icons';
import { WorldSettingsGroup, worldGate } from './settings-world';
import { WORLD_BUILDING_ICON } from './world-popups';
import { worldSectionMode, type WorldScreen } from './world-model';

const TITLE_ID = 'ui-world-dialog-title';

/** O que as Configurações precisam do World: a dica do tema em Aparência e o envio do tema escolhido ao prédio. */
export interface WorldThemeLink {
  readonly themeNote: HTMLElement;
  onThemePicked(theme: WorldThemeChoice): Promise<void>;
}

export class WorldDialog implements UiComponent, WorldThemeLink {
  readonly el: HTMLDialogElement;
  private readonly group: WorldSettingsGroup;
  private readonly body: HTMLElement;
  private readonly title: HTMLElement;
  /** Quem tinha o foco antes de abrir (o botão da barra, o chip…): volta para lá ao fechar. */
  private opener: HTMLElement | null = null;

  constructor(
    private readonly ctx: UiContext,
    private readonly src: WorldSource,
    /** O botão da barra do topo: some sem o servidor do mundo configurado e ganha aria-expanded. */
    private readonly button: HTMLElement,
  ) {
    this.group = new WorldSettingsGroup(ctx, src);
    const badge = h('span', { class: 'ui-world-dialog__badge', attrs: { 'aria-hidden': 'true' } });
    badge.innerHTML = WORLD_BUILDING_ICON;
    this.title = h('h2', { class: 'ui-world-dialog__title', text: tr('Habblaud World'), tabIndex: -1, attrs: { id: TITLE_ID } });
    const close = iconButton(ICONS.close, tr('Fechar (Esc)'), () => this.close(), 'ui-icon-btn--sm');
    this.body = h('div', { class: 'ui-world-dialog__body' }, this.group.el);
    this.el = h(
      'dialog',
      // `aria-modal` só enquanto aberto (fechado, o <dialog> fica no DOM e não pode parecer um modal aberto).
      { class: 'ui-world-dialog', attrs: { 'aria-labelledby': TITLE_ID } },
      h('div', { class: 'ui-world-dialog__head' }, badge, h('div', { class: 'ui-world-dialog__heading' }, this.title, this.group.chip), close),
      this.body,
    );
    // Clique no fundo (fora do conteúdo) fecha.
    this.el.addEventListener('click', (e) => {
      if (e.target === this.el) this.close();
    });
    // O teclado fica dentro da janela: os atalhos do escritório não disparam por baixo. O Esc fecha (o <dialog>
    // modal já faz isso; sem showModal, fazemos aqui) e não chega aos atalhos.
    this.el.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key !== 'Escape' || typeof this.el.showModal === 'function') return;
      e.preventDefault();
      this.close();
    });
    this.el.addEventListener('close', () => this.onClosed());
  }

  get themeNote(): HTMLElement {
    return this.group.themeNote;
  }

  onThemePicked(theme: WorldThemeChoice): Promise<void> {
    return this.group.onThemePicked(theme);
  }

  get isOpen(): boolean {
    return this.el.open;
  }

  /** Abre (se fechada) e, com `screen`, vai para a tela pedida (o cadastro, o personagem, o prédio…). */
  show(screen?: WorldScreen, opener?: HTMLElement | null): void {
    this.group.show(screen);
    if (this.el.open) return;
    this.opener = opener ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    if (typeof this.el.showModal === 'function') this.el.showModal();
    else this.el.setAttribute('open', '');
    this.el.setAttribute('aria-modal', 'true');
    this.button.setAttribute('aria-expanded', 'true');
    this.body.scrollTop = 0;
    // O foco começa no título (o leitor de tela anuncia a janela); as telas com formulário levam ao primeiro campo.
    this.title.focus({ preventScroll: true });
    this.ctx.invalidate();
  }

  toggle(opener?: HTMLElement | null): void {
    if (this.el.open) this.close();
    else this.show(undefined, opener);
  }

  close(): void {
    if (!this.el.open) return;
    this.el.removeAttribute('aria-modal');
    if (typeof this.el.close === 'function') this.el.close();
    else {
      this.el.removeAttribute('open');
      this.onClosed();
    }
  }

  private onClosed(): void {
    this.button.setAttribute('aria-expanded', 'false');
    if (this.opener?.isConnected) this.opener.focus({ preventScroll: true });
    this.opener = null;
    this.ctx.invalidate();
  }

  render(): void {
    // Sem servidor do mundo configurado (ou pela porta do celular), nem o botão aparece.
    const hidden = worldSectionMode(this.src.meta(), worldGate(this.ctx, this.src)) === 'hidden';
    setHidden(this.button, hidden);
    if (hidden && this.el.open) this.close();
    this.group.render(this.el.open);
  }
}
