// Botões do topo da janela de terminal: "Assumir daqui" (sessão aberta noutro terminal: encerra lá e continua a
// mesma conversa aqui, interativa) e "Encerrar". Os dois pedem um segundo clique.
// Só para agentes principais reais (os do demo não têm processo) e com o terminal interativo ligado.
import type { AgentInfo } from '../../../shared/types';
import type { UiContext } from './context';
import { h, setHidden, setText, setTitle } from './dom';
import type { PtyControl } from './pty';
import { ptyControllable } from './ptyapi';
import { tr } from '../../../shared/i18n';

const CONFIRM_MS = 4000;

type Kind = 'stop' | 'takeover';

export class TermActions {
  readonly el: HTMLElement;
  private agent: AgentInfo | null = null;
  private takeBtn: HTMLButtonElement;
  private stopBtn: HTMLButtonElement;
  private msg: HTMLElement;
  private confirm: Kind | null = null;
  private confirmTimer: ReturnType<typeof setTimeout> | null = null;
  private busy = false;

  constructor(
    private ctx: UiContext,
    private pty: PtyControl,
    /** Mostrar "Assumir daqui" (sessão aberta noutro terminal). */
    public withTakeover: boolean,
    /** Encerrar este agente (padrão: pela API; no interativo, fecha o pty). */
    private onStop?: (agent: AgentInfo) => Promise<void>,
  ) {
    this.takeBtn = h('button', { class: 'ui-btn ui-btn--sm ui-btn--accent', type: 'button', on: { click: () => this.run('takeover') } });
    setTitle(this.takeBtn, tr('Encerra a sessão no terminal onde ela está e continua a mesma conversa aqui, podendo digitar'));
    this.stopBtn = h('button', { class: 'ui-btn ui-btn--sm ui-btn--danger', type: 'button', on: { click: () => this.run('stop') } });
    setTitle(this.stopBtn, tr('Encerra esta sessão do Claude Code (a conversa fica salva)'));
    this.msg = h('span', { class: 'ui-termact__msg', role: 'status', hidden: true });
    this.el = h('span', { class: 'ui-termact', hidden: true }, this.msg, this.takeBtn, this.stopBtn);
  }

  /** `agent` = agente presente na janela (null = sessão do histórico, saiu ou nenhum). */
  render(agent: AgentInfo | null): void {
    if (agent?.id !== this.agent?.id) {
      this.resetConfirm();
      this.showMsg('');
    }
    this.agent = agent;
    const usable = ptyControllable(agent) && this.pty.enabled;
    setHidden(this.el, !usable);
    if (!usable) return;
    setHidden(this.takeBtn, !this.withTakeover);
    setText(this.takeBtn, this.confirm === 'takeover' ? tr('Confirmar?') : tr('Assumir daqui'));
    setText(this.stopBtn, this.confirm === 'stop' ? tr('Confirmar?') : tr('Encerrar'));
    this.takeBtn.classList.toggle('is-confirm', this.confirm === 'takeover');
    this.stopBtn.classList.toggle('is-confirm', this.confirm === 'stop');
    this.takeBtn.disabled = this.busy;
    this.stopBtn.disabled = this.busy;
  }

  private run(kind: Kind): void {
    const a = this.agent;
    if (!a || this.busy) return;
    if (this.confirm !== kind) {
      this.resetConfirm();
      this.confirm = kind;
      this.confirmTimer = setTimeout(() => {
        this.resetConfirm();
        this.ctx.invalidate();
      }, CONFIRM_MS);
      this.ctx.invalidate();
      return;
    }
    this.resetConfirm();
    this.busy = true;
    this.showMsg(kind === 'stop' ? tr('Encerrando…') : tr('Assumindo…'));
    this.ctx.invalidate();
    const job = kind === 'stop' ? (this.onStop ? this.onStop(a) : this.pty.stop(a.id)) : this.pty.takeover(a.id);
    job
      .then(() => this.showMsg(''))
      .catch((err: Error) => this.showMsg(tr('Não deu: {0}', [err.message]), true))
      .finally(() => {
        this.busy = false;
        this.ctx.invalidate();
      });
  }

  private showMsg(text: string, error = false): void {
    setText(this.msg, text);
    setHidden(this.msg, !text);
    setTitle(this.msg, text);
    this.msg.classList.toggle('is-error', error);
  }

  private resetConfirm(): void {
    if (this.confirmTimer) clearTimeout(this.confirmTimer);
    this.confirmTimer = null;
    this.confirm = null;
  }
}
