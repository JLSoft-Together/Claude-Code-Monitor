// Abas da janela de terminal: os agentes principais presentes no mesmo projeto (sala) do agente aberto.
// Clicar numa aba troca a janela para o terminal daquele agente (interativo ou ao vivo). Arrastar uma aba
// muda a ordem (a mesma da lista lateral; ver ui/agentorder.ts). Ao lado do nome, o começo do que o agente está
// fazendo; o X encerra a sessão (pede um segundo clique) e só aparece com o terminal interativo ligado.
import type { AgentInfo } from '../../../shared/types';
import type { UiContext } from './context';
import { moveAgent, orderAgents } from './agentorder';
import { h, KeyedList, setAttr, setHidden, setText, setTitle } from './dom';
import { activityFallback } from './model';
import { ptyControllable, stopAgent } from './ptyapi';
import { createStatusDot, updateStatusDot } from './widgets';
import { tr } from '../../../shared/i18n';

/** Quanto tempo o X fica pedindo confirmação. */
const CONFIRM_MS = 3000;

/** O que mostrar ao lado do nome: a atividade de quem trabalha ou espera; o título da conversa de quem está parado. */
function doingOf(a: AgentInfo): string {
  if (a.status === 'working' || a.status === 'waiting') return a.activity?.text ?? activityFallback(a);
  return a.title ?? '';
}

export class TermTabs {
  readonly el: HTMLElement;
  private list: KeyedList<AgentInfo>;
  private current: string | null = null;
  private roomId: string | null = null;
  private peers: AgentInfo[] = [];
  /** Aba cujo X espera o segundo clique. */
  private confirming: string | null = null;
  private confirmTimer: ReturnType<typeof setTimeout> | null = null;
  /** Aba sendo arrastada (id do agente). */
  private dragging: string | null = null;

  constructor(private ctx: UiContext) {
    this.el = h('div', { class: 'ui-ttabs', role: 'tablist', hidden: true, attrs: { 'aria-label': tr('Agentes do projeto (arraste para reordenar)') } });
    this.list = new KeyedList<AgentInfo>(this.el, {
      animate: false,
      key: (a) => a.id,
      create: (a) => {
        const b = h(
          'button',
          { class: 'ui-ttab', type: 'button', role: 'tab', attrs: { draggable: 'true' } },
          createStatusDot(),
          h('span', { class: 'ui-ttab__name' }),
          h('span', { class: 'ui-ttab__doing' }),
          h('span', { class: 'ui-ttab__live', text: '›_', hidden: true }),
          // Dentro do botão da aba: span (botão dentro de botão não vale); o teclado usa Delete na aba.
          h('span', { class: 'ui-ttab__close', role: 'button', attrs: { 'aria-label': tr('Encerrar esta sessão') }, text: '×' }),
        );
        const close = b.children[4] as HTMLElement;
        close.addEventListener('click', (e) => {
          e.stopPropagation();
          this.closeTab(b.dataset.id!);
        });
        close.addEventListener('pointerdown', (e) => e.stopPropagation());
        b.addEventListener('keydown', (e) => {
          if (e.key === 'Delete') {
            e.preventDefault();
            this.closeTab(b.dataset.id!);
          }
        });
        b.dataset.id = a.id;
        b.addEventListener('click', () => {
          const id = b.dataset.id!;
          if (id !== this.current) ctx.terminals?.open(id);
        });
        this.wireDrag(b);
        return b;
      },
      update: (b, a) => {
        b.dataset.id = a.id;
        updateStatusDot(b.firstElementChild as HTMLElement, a.status);
        setText(b.children[1] as HTMLElement, a.name);
        const doing = doingOf(a);
        setText(b.children[2] as HTMLElement, doing);
        setHidden(b.children[2] as HTMLElement, !doing);
        const live = !!ctx.terminals?.interactive(a.id);
        setHidden(b.children[3] as HTMLElement, !live);
        const close = b.children[4] as HTMLElement;
        const confirm = this.confirming === a.id;
        setHidden(close, !ctx.terminals?.interactiveEnabled || !ptyControllable(a));
        close.classList.toggle('is-confirm', confirm);
        setText(close, confirm ? tr('encerrar?') : '×');
        setTitle(close, confirm ? tr('Clique de novo para encerrar a sessão (a conversa fica salva)') : tr('Encerrar esta sessão'));
        const on = a.id === this.current;
        b.classList.toggle('is-on', on);
        setAttr(b, 'aria-selected', String(on));
        setTitle(b, `${a.name}${a.title ? ` · ${a.title}` : ''}${doing && doing !== a.title ? `
${doing}` : ''}${live ? tr(' (interativo)') : ''}`);
      },
    });
  }

  /** `agentId` = agente aberto na janela (null = sessão do histórico ou nenhum). */
  render(agentId: string | null): void {
    this.current = agentId;
    const agent = agentId ? this.ctx.agent(agentId) : undefined;
    this.roomId = agent?.roomId ?? null;
    const peers = agent
      ? (this.ctx.store.snapshot?.agents ?? [])
          .filter((a) => a.kind === 'main' && a.roomId === agent.roomId && a.status !== 'offline' && !a.id.startsWith('demo:'))
          .sort((x, y) => x.startedAt - y.startedAt || x.id.localeCompare(y.id))
      : [];
    this.peers = agent ? orderAgents(agent.roomId, peers, (a) => a.sessionId) : [];
    // Uma aba só não ajuda: some.
    setHidden(this.el, this.peers.length < 2);
    this.list.sync(this.peers.length < 2 ? [] : this.peers);
  }

  /** X da aba: o primeiro clique pede confirmação; o segundo encerra a sessão (aqui ou noutro terminal). */
  private closeTab(id: string): void {
    if (!this.ctx.terminals?.interactiveEnabled || !ptyControllable(this.ctx.agent(id))) return;
    if (this.confirming !== id) {
      this.resetConfirm();
      this.confirming = id;
      this.confirmTimer = setTimeout(() => {
        this.resetConfirm();
        this.ctx.invalidate();
      }, CONFIRM_MS);
      this.ctx.invalidate();
      return;
    }
    this.resetConfirm();
    const name = this.ctx.agent(id)?.name ?? tr('Sessão');
    stopAgent(id)
      .then(() => this.ctx.announce(tr('{0}: sessão encerrada.', [name])))
      .catch((err: Error) => this.ctx.announce(tr('Não deu para encerrar: {0}', [err.message])))
      .finally(() => this.ctx.invalidate());
    // Era a aba aberta: passa para a vizinha.
    if (id === this.current) {
      const i = this.peers.findIndex((a) => a.id === id);
      const next = this.peers[i + 1] ?? this.peers[i - 1];
      if (next) this.ctx.terminals?.open(next.id);
    }
  }

  private resetConfirm(): void {
    if (this.confirmTimer) clearTimeout(this.confirmTimer);
    this.confirmTimer = null;
    this.confirming = null;
  }

  private wireDrag(b: HTMLElement): void {
    b.addEventListener('dragstart', (e) => {
      this.dragging = b.dataset.id ?? null;
      b.classList.add('is-dragging');
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', this.dragging ?? '');
      }
    });
    b.addEventListener('dragend', () => {
      this.dragging = null;
      b.classList.remove('is-dragging');
      this.clearMarks();
    });
    b.addEventListener('dragover', (e) => {
      if (!this.dragging || this.dragging === b.dataset.id) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
      const after = this.isAfter(b, e.clientX);
      this.clearMarks();
      b.classList.add(after ? 'is-drop-after' : 'is-drop-before');
    });
    b.addEventListener('dragleave', () => b.classList.remove('is-drop-before', 'is-drop-after'));
    b.addEventListener('drop', (e) => {
      e.preventDefault();
      const from = this.dragging;
      const to = b.dataset.id;
      this.clearMarks();
      if (!from || !to || from === to) return;
      this.move(from, to, this.isAfter(b, e.clientX));
    });
  }

  private isAfter(b: HTMLElement, x: number): boolean {
    const r = b.getBoundingClientRect();
    return x > r.left + r.width / 2;
  }

  private clearMarks(): void {
    for (const el of this.el.querySelectorAll('.is-drop-before, .is-drop-after')) el.classList.remove('is-drop-before', 'is-drop-after');
  }

  /** Põe `from` antes (ou depois) de `to` e guarda a ordem do projeto. */
  private move(from: string, to: string, after: boolean): void {
    if (!this.roomId) return;
    if (moveAgent(this.roomId, this.peers, (a) => a.id, (a) => a.sessionId, from, to, after)) this.ctx.invalidate();
  }
}
