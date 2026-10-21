// Terminal interativo: janela flutuante com o Claude Code rodando de verdade (pty no servidor, xterm.js aqui).
// Ao contrário do terminal ao vivo (ui/terminal.ts, que mostra a conversa), aqui dá para digitar, responder e encerrar.
// Sessão aberta noutro terminal (ex.: Windows Terminal) abre primeiro no terminal ao vivo, com "Assumir daqui";
// esta janela só mostra o aviso de "em outro terminal" quando o terminal ao vivo está desligado. As abas trocam
// entre os agentes do mesmo projeto; as duas janelas se revezam no mesmo lugar.
// As teclas não vazam para os atalhos do escritório (T, P, M, Esc...): Esc, por exemplo, interrompe o Claude.
// Fechar a janela não encerra a sessão; "Encerrar" encerra.
import type { AgentInfo, PtyInfo } from '../../../shared/types';
import type { UiComponent, UiContext } from './context';
import { h, iconButton, setHidden, setText } from './dom';
import { ICONS } from './icons';
import { maximizeButton, Movable } from './movable';
import { closePty, createPty, stopAgent, takeoverAgent } from './ptyapi';
import type { PtyPane } from './ptypane';
import { TermActions } from './termactions';
import { TermTabs } from './termtabs';
import { createAccountChip, updateAccountChip } from './widgets';
import { tr } from '../../../shared/i18n';

/** O que a gaveta e os atalhos usam do terminal interativo. */
export interface PtyControl {
  /** Recurso ligado (fora do Docker, com node-pty e acesso local). */
  readonly enabled: boolean;
  /** Por que está desligado. */
  readonly reason: string;
  /** Terminal interativo rodando deste agente. */
  ptyOf(agentId: string): PtyInfo | undefined;
  /** Agente aberto na janela (com pty ou aberto noutro terminal). */
  readonly agentId: string | null;
  readonly isOpen: boolean;
  /** Abre a janela no agente: o pty dele ou, se a sessão roda noutro terminal, a oferta de assumir. */
  openAgent(agentId: string): void;
  close(): void;
  takeover(agentId: string): Promise<void>;
  newSession(cwd: string, account?: string): Promise<void>;
  stop(agentId: string): Promise<void>;
}

export class PtyPanel implements UiComponent, PtyControl {
  readonly el: HTMLElement;
  private pane: PtyPane | null = null;
  private loading: Promise<PtyPane> | null = null;
  private info: PtyInfo | null = null;
  /** Agente aberto noutro terminal (sem pty aqui), mostrado com "Assumir daqui". */
  private external: string | null = null;
  private screen: HTMLElement;
  private away: HTMLElement;
  private awayTitle: HTMLElement;
  private nameEl: HTMLElement;
  private accEl: HTMLElement;
  private roomEl: HTMLElement;
  private stateEl: HTMLElement;
  private actions: TermActions;
  private tabs: TermTabs;
  private movable: Movable;
  /** Avisado quando a janela aparece (o terminal ao vivo fecha: a janela é uma só). */
  onShow: (() => void) | null = null;
  /** Agente a selecionar quando aparecer no snapshot (sessão recém-aberta ou assumida). */
  private pendingSelect: string | null = null;

  constructor(private ctx: UiContext) {
    const icon = h('span', { class: 'ui-term__icon', attrs: { 'aria-hidden': 'true' } });
    icon.innerHTML = ICONS.terminal;
    this.accEl = createAccountChip('sm');
    this.nameEl = h('strong', { class: 'ui-term__name' });
    this.roomEl = h('span', { class: 'ui-term__room' });
    this.stateEl = h('span', { class: 'ui-pty__state', role: 'status' });
    this.actions = new TermActions(ctx, this, false, async () => {
      if (this.info) await closePty(this.info.id);
    });
    this.tabs = new TermTabs(ctx);
    const close = iconButton(ICONS.close, tr('Fechar a janela (a sessão continua rodando)'), () => this.close(), 'ui-icon-btn--sm ui-term__close');
    const bar = h(
      'div',
      { class: 'ui-term__bar' },
      icon,
      h('span', { class: 'ui-term__kind', text: tr('terminal') }),
      h('div', { class: 'ui-term__who' }, this.accEl, this.nameEl, this.roomEl),
      this.stateEl,
      h('span', { class: 'ui-pty__live', text: tr('interativo') }),
      this.actions.el,
      maximizeButton(() => this.movable, () => requestAnimationFrame(() => this.pane?.refit(true))),
      close,
    );
    this.screen = h('div', { class: 'ui-pty__body' });
    this.awayTitle = h('p', { class: 'ui-pty__away-title' });
    this.away = h(
      'div',
      { class: 'ui-pty__away', hidden: true },
      h('strong', { text: tr('Esta sessão está aberta em outro terminal') }),
      this.awayTitle,
      h('p', { class: 'ui-muted', text: tr('Use "Assumir daqui" (no topo) para encerrar lá e continuar a mesma conversa nesta janela, podendo digitar.') }),
    );
    this.el = h('section', { class: 'ui-term ui-pty', role: 'dialog', hidden: true, attrs: { 'aria-label': tr('Terminal') } }, bar, this.tabs.el, this.screen, this.away);
    // Teclas digitadas no terminal são do Claude Code, não dos atalhos do escritório.
    this.el.addEventListener('keydown', (e) => e.stopPropagation());
    this.movable = new Movable(this.el, bar, { key: 'habblaud.move.term', enabled: () => !ctx.isNarrow(), onMove: () => this.pane?.refit(true) });
    this.el.addEventListener('keyup', (e) => e.stopPropagation());
  }

  get enabled(): boolean {
    return !!this.ctx.store.snapshot?.meta.pty?.enabled && !this.ctx.store.replaying;
  }

  get reason(): string {
    if (this.ctx.store.replaying) return tr('Sem terminal no timelapse');
    return this.ctx.store.snapshot?.meta.pty?.reason ?? tr('Terminal interativo desligado');
  }

  get isOpen(): boolean {
    return this.info !== null || this.external !== null;
  }

  get agentId(): string | null {
    return this.info?.agentId ?? this.external;
  }

  ptyOf(agentId: string): PtyInfo | undefined {
    return this.ctx.store.snapshot?.ptys?.find((p) => p.agentId === agentId && p.exitedAt === undefined);
  }

  openAgent(agentId: string): void {
    const p = this.ptyOf(agentId);
    if (p) return this.show(p);
    this.pane?.detach();
    this.info = null;
    this.external = agentId;
    this.reveal();
    this.render();
    this.ctx.invalidate();
  }

  close(): void {
    if (!this.isOpen) return;
    this.pane?.detach();
    this.info = null;
    this.external = null;
    this.el.hidden = true;
    this.ctx.invalidate();
  }

  async takeover(agentId: string): Promise<void> {
    const p = await takeoverAgent(agentId);
    if (p) this.show(p, true);
  }

  async newSession(cwd: string, account?: string): Promise<void> {
    const p = await createPty(cwd, account);
    if (p) this.show(p, true);
  }

  async stop(agentId: string): Promise<void> {
    await stopAgent(agentId);
    this.ctx.announce(tr('Sessão encerrada.'));
  }

  render(): void {
    if (this.external) return this.renderExternal(this.external);
    const info = this.info;
    if (!info) return;
    // A lista do snapshot traz o estado mais novo (encerrado, código de saída).
    const fresh = this.ctx.store.snapshot?.ptys?.find((p) => p.id === info.id);
    if (fresh) this.info = fresh;
    const cur = this.info ?? info;
    const agent: AgentInfo | undefined = this.ctx.agent(cur.agentId);
    if (agent && this.pendingSelect === cur.agentId) {
      this.pendingSelect = null;
      this.ctx.select({ type: 'agent', id: agent.id });
    }
    setText(this.nameEl, agent?.name ?? 'Claude Code');
    updateAccountChip(this.accEl, this.ctx.account(cur.account), cur.account);
    setText(this.roomEl, agent?.title ?? cur.cwd);
    const ended = cur.exitedAt !== undefined;
    setText(this.stateEl, ended ? tr('encerrado') : agent ? '' : cur.resumed ? tr('retomando…') : tr('iniciando…'));
    this.actions.withTakeover = false;
    this.actions.render(ended ? null : (agent ?? null));
    this.tabs.render(agent ? agent.id : null);
    this.setMode(false);
  }

  /** Sessão aberta noutro terminal: quem é, do que se trata e o "Assumir daqui". */
  private renderExternal(id: string): void {
    // Assumida (por aqui ou por outra aba do navegador): vira o terminal de verdade.
    const own = this.ptyOf(id);
    if (own) return this.show(own);
    const agent = this.ctx.agent(id);
    setText(this.nameEl, agent?.name ?? tr('Agente'));
    if (agent) updateAccountChip(this.accEl, this.ctx.account(agent.account), agent.account);
    const room = agent ? this.ctx.store.room(agent.roomId) : undefined;
    setText(this.roomEl, room?.name ?? '');
    setText(this.stateEl, agent ? tr('em outro terminal') : tr('saiu do escritório'));
    setText(this.awayTitle, agent?.title ?? '');
    setHidden(this.awayTitle, !agent?.title);
    this.actions.withTakeover = true;
    this.actions.render(agent ?? null);
    this.tabs.render(agent ? id : null);
    this.setMode(true);
  }

  private setMode(away: boolean): void {
    setHidden(this.away, !away);
    setHidden(this.screen, away);
    this.el.classList.toggle('is-away', away);
  }

  private reveal(): void {
    if (this.el.hidden) this.movable.restore();
    this.el.hidden = false;
    this.onShow?.();
  }

  private show(p: PtyInfo, fresh = false): void {
    this.info = p;
    this.external = null;
    if (fresh) this.pendingSelect = p.agentId;
    this.reveal();
    this.render();
    void this.ensurePane().then((pane) => {
      if (this.info?.id !== p.id) return;
      pane.attach(p.id);
      requestAnimationFrame(() => {
        pane.refit(true);
        pane.focus();
      });
    });
    this.ctx.invalidate();
  }

  private ensurePane(): Promise<PtyPane> {
    if (this.pane) return Promise.resolve(this.pane);
    this.loading ??= import('./ptypane').then(({ PtyPane }) => {
      this.pane = new PtyPane(() => this.ctx.invalidate());
      this.screen.append(this.pane.el);
      return this.pane;
    });
    return this.loading;
  }
}
