// Responder pelo escritório: cartão do pedido de permissão na gaveta do agente (Aprovar, Recusar com
// motivo, "sempre permitir" e Responder no terminal) ou das perguntas do AskUserQuestion (opções, "Outro" e
// Responder), e os atalhos que levam até ele (aviso, contador da barra superior e tecla P). O pedido chega
// pelo hook PermissionRequest (mod/habblaud-permissoes/hooks/permission-hook.mjs); o diálogo continua no
// terminal e vale o que for respondido primeiro.
// Pedido do Codex (`provider: 'codex'`): o hook dele só espera alguns segundos e o terminal só mostra a aprovação
// depois que você responder aqui ou o prazo acabar; não há "sempre permitir" nem "interromper", e recusar pede um
// motivo. O Codex nunca pergunta pelo escritório (sem cartão de pergunta).
import { access, isLoopbackHostname } from '../net/access';
import { ANSWER_OTHER_MAX, ASK_TOOL, checkAnswers } from '../../../shared/answers';
import type { AgentInfo, AskQuestion, PermissionAnswer, PermissionDecision, PermissionRequestInfo, PermissionSuggestionInfo } from '../../../shared/types';
import type { UiContext } from './context';
import { h, KeyedList, setAttr, setHidden, setText, setTitle } from './dom';
import { formatClock, formatDuration } from './format';
import { ICONS } from './icons';
import { diffLineKind, moreLabel, previewText, showToolInput, splitToolTitle } from './terminal';
import { tr } from '../../../shared/i18n';

/** Evento (em ctx.root) que pede para o cartão de um agente aparecer: rolar até ele e receber o foco. */
export const PERMISSION_FOCUS_EVENT = 'habblaud:permission-focus';
const PREVIEW_LINES = 12;
const MESSAGE_MAX = 1_000;

const DESTINATIONS: Record<string, string> = {
  session: tr('só nesta sessão'),
  localSettings: tr('neste projeto, só para você'),
  projectSettings: tr('neste projeto, para todos (versionado)'),
  userSettings: tr('em todos os projetos'),
};

/** Onde a regra "sempre permitir" fica guardada, em português. */
export function destinationLabel(destination: string): string {
  return DESTINATIONS[destination] ?? destination;
}

/**
 * "volta ao terminal em 4 min" (quando o hook desiste de esperar). `seconds` conta os segundos no último minuto
 * (o prazo do Codex é de segundos).
 */
export function expiryText(expiresAt: number, now: number, seconds = false): string {
  const left = expiresAt - now;
  if (left <= 0) return tr('voltando ao terminal…');
  if (left < 60_000) return seconds ? tr('volta ao terminal em {0} s', [Math.ceil(left / 1_000)]) : tr('volta ao terminal em menos de 1 min');
  return tr('volta ao terminal em {0}', [formatDuration(left)]);
}

/** Aviso do cartão de um pedido do Codex. */
export const CODEX_PERMISSION_NOTE = tr('No Codex, a aprovação só aparece no terminal depois que você responder aqui ou o prazo acabar.');

/** O que o cartão oferece para um pedido (muda com a ferramenta). */
export interface PermissionOptions {
  /** "Aprovar e não perguntar de novo" (as sugestões do Claude Code). */
  always: boolean;
  /** "Interromper o agente" junto com a recusa. */
  interrupt: boolean;
  /** Recusar só com motivo. */
  reasonRequired: boolean;
  /** Prazo contado em segundos no último minuto. */
  seconds: boolean;
  /** Aviso curto embaixo da prévia ('' = nenhum). */
  note: string;
}

export function permissionOptions(p: Pick<PermissionRequestInfo, 'provider' | 'suggestions'>, agent: Pick<AgentInfo, 'kind' | 'background'>): PermissionOptions {
  if (p.provider === 'codex') return { always: false, interrupt: false, reasonRequired: true, seconds: true, note: CODEX_PERMISSION_NOTE };
  // Subagente em segundo plano: o Claude Code só mostra o diálogo depois que o hook responde.
  const blocking = agent.kind === 'sub' && !!agent.background;
  return {
    always: !!p.suggestions?.length,
    interrupt: true,
    reasonRequired: false,
    seconds: false,
    note: blocking ? tr('Este subagente roda em segundo plano: o terminal só mostra o pedido depois que você responder aqui ou escolher “Responder no terminal”.') : '',
  };
}

/** Agentes com pedido para responder, do pedido mais antigo para o mais recente. */
export function permissionAgents(agents: readonly AgentInfo[]): AgentInfo[] {
  return agents.filter((a) => a.permission && a.status !== 'offline' && a.status !== 'done').sort((a, b) => a.permission!.createdAt - b.permission!.createdAt);
}

/** Próximo agente com pedido depois de `currentId` (volta ao primeiro no fim da fila). */
export function nextPermissionAgent(agents: readonly AgentInfo[], currentId?: string): AgentInfo | undefined {
  const list = permissionAgents(agents);
  if (!list.length) return undefined;
  const i = currentId ? list.findIndex((a) => a.id === currentId) : -1;
  return list[(i + 1) % list.length];
}

/** Seleciona o agente e pede ao cartão para aparecer (rolar até ele e receber o foco). */
export function focusPermission(ctx: UiContext, agentId: string): void {
  ctx.select({ type: 'agent', id: agentId }, { focus: true });
  ctx.root.dispatchEvent(new CustomEvent(PERMISSION_FOCUS_EVENT, { detail: agentId }));
}

/** A página foi aberta pelo próprio computador? (a regra antiga; quem decide agora é o servidor, ver net/access.ts) */
export const isLocalHostname = isLoopbackHostname;

/** Pedido que se responde escolhendo (as perguntas do AskUserQuestion), não aprovando. O Codex nunca pergunta. */
export function isQuestionRequest(p: Pick<PermissionRequestInfo, 'tool' | 'questions' | 'provider'> | undefined): boolean {
  return !!p && p.provider !== 'codex' && p.tool === ASK_TOOL && !!p.questions?.length;
}

/** O que está marcado numa pergunta do cartão: as opções (posições do original) e o "Outro" (marcado, e o texto). */
export interface AskChoice {
  options: readonly number[];
  otherOn: boolean;
  otherText: string;
}

/**
 * Resposta de uma pergunta a partir do que está marcado; undefined = ainda sem resposta. Escolha única: a opção
 * OU o "Outro"; várias: as opções e o "Outro" juntos. "Outro" marcado sem texto conta como sem resposta.
 */
export function answerFor(q: AskQuestion, c: AskChoice | undefined): PermissionAnswer | undefined {
  if (!c) return undefined;
  const other = c.otherOn ? c.otherText.trim().slice(0, ANSWER_OTHER_MAX) : '';
  if (c.otherOn && !other) return undefined;
  const options = q.multiSelect || !other ? c.options.filter((i) => q.options.some((o) => o.index === i)) : [];
  if (!options.length && !other) return undefined;
  return { question: q.index, ...(options.length ? { options: [...options] } : {}), ...(other ? { other } : {}) };
}

/**
 * Corpo da resposta (`answers` da decisão) quando todas as perguntas estão respondidas do jeito que o servidor
 * aceita; undefined enquanto falta alguma (o botão Responder fica desligado).
 */
export function buildAnswers(questions: readonly AskQuestion[], choices: ReadonlyMap<number, AskChoice>): PermissionAnswer[] | undefined {
  const answers: PermissionAnswer[] = [];
  for (const q of questions) {
    const a = answerFor(q, choices.get(q.index));
    if (!a) return undefined;
    answers.push(a);
  }
  return checkAnswers(questions, answers);
}

/** O comando vai inteiro na caixa "$ …" (é o que se aprova); o título mostra só o nome da ferramenta. */
function commandPreview(p: Pick<PermissionRequestInfo, 'input' | 'inputKind'> | null): boolean {
  return !!p && p.inputKind === 'command' && !!p.input?.trim();
}

/** Prévia dos argumentos (comando, diff, JSON, texto), com as mesmas classes do terminal. */
function previewBlock(p: Pick<PermissionRequestInfo, 'title' | 'input' | 'inputKind'>): HTMLElement | null {
  if (!commandPreview(p) && !showToolInput(p)) return null;
  const kind = p.inputKind ?? 'text';
  const text = p.input!.replace(/\s+$/, '');
  const fill = (target: HTMLElement, value: string) => {
    target.replaceChildren();
    if (kind !== 'diff') return void (target.textContent = value);
    for (const line of value.split('\n')) target.append(h('span', { class: `ui-term__dl is-${diffLineKind(line)}`, text: line || ' ' }));
  };
  const pv = previewText(text, PREVIEW_LINES);
  const body = h('div', { class: 'ui-term__pre' });
  fill(body, pv.head);
  const box = h('div', { class: `ui-term__in ui-term__in--${kind}` }, body);
  if (kind === 'command') box.prepend(h('span', { class: 'ui-term__dollar', text: '$', attrs: { 'aria-hidden': 'true' } }));
  if (pv.collapsed) {
    let open = false;
    const more = h('button', { class: 'ui-term__more', type: 'button', text: moreLabel(pv.hiddenLines), attrs: { 'aria-expanded': 'false' } });
    more.addEventListener('click', () => {
      open = !open;
      fill(body, open ? pv.text : pv.head);
      setText(more, open ? tr('recolher') : moreLabel(pv.hiddenLines));
      setAttr(more, 'aria-expanded', String(open));
    });
    box.append(more);
  }
  return box;
}

type Phase = 'idle' | 'deny' | 'sending' | 'sent';

/** Uma pergunta do AskUserQuestion no cartão: as caixas das opções e o "Outro" (caixa e texto). */
interface AskRefs {
  q: AskQuestion;
  el: HTMLElement;
  options: HTMLInputElement[];
  other: HTMLInputElement;
  text: HTMLInputElement;
}

const DONE: Record<PermissionDecision['behavior'], string> = { allow: tr('Aprovado'), deny: tr('Recusado'), answer: tr('Respondido'), terminal: tr('Devolvido ao terminal') };

/**
 * Cartão "Pede permissão" (ou "Pergunta para você", no AskUserQuestion) na gaveta do agente. Some quando o
 * pedido é respondido (por aqui ou no terminal), expira ou o agente sai.
 */
export class PermissionCard {
  readonly el: HTMLElement;
  private id = '';
  private agentId = '';
  private phase: Phase = 'idle';
  private detailReq = 0;
  private detail: PermissionRequestInfo | null = null;
  private pendingFocus: string | null = null;

  private icon: HTMLElement;
  private title: HTMLElement;
  private what: HTMLElement;
  private timer: HTMLElement;
  private tool: HTMLElement;
  private preview: HTMLElement;
  private note: HTMLElement;
  private queue: HTMLElement;
  private approveBtn: HTMLButtonElement;
  private denyBtn: HTMLButtonElement;
  private terminalBtn: HTMLButtonElement;
  private always: HTMLElement;
  private suggestions: KeyedList<PermissionSuggestionInfo, HTMLButtonElement>;
  private denyForm: HTMLFormElement;
  private reason: HTMLTextAreaElement;
  private interrupt: HTMLInputElement;
  private interruptRow: HTMLElement;
  private denySubmit: HTMLButtonElement;
  /** O que o cartão oferece para o pedido atual (Claude Code ou Codex). */
  private opts: PermissionOptions = { always: false, interrupt: true, reasonRequired: false, seconds: false, note: '' };
  private status: HTMLElement;
  private remote: HTMLElement;
  /** Perguntas do AskUserQuestion, montadas uma vez por pedido (a seleção sobrevive aos snapshots). */
  private askForm: HTMLFormElement;
  private askId = '';
  private askRefs: AskRefs[] = [];
  private answerBtn: HTMLButtonElement;

  constructor(private ctx: UiContext) {
    this.icon = h('span', { class: 'ui-perm__icon', attrs: { 'aria-hidden': 'true' } });
    this.title = h('strong', { class: 'ui-perm__title' });
    this.what = h('p', { class: 'ui-perm__what' });
    this.timer = h('span', { class: 'ui-perm__timer' });
    this.tool = h('div', { class: 'ui-perm__tool' });
    this.preview = h('div', { class: 'ui-perm__preview' });
    this.note = h('p', { class: 'ui-perm__note', hidden: true });
    this.queue = h('p', { class: 'ui-perm__queue', hidden: true });
    this.remote = h('p', { class: 'ui-perm__note', hidden: true, text: tr('Para responder por aqui, abra o Habblaud por http://localhost (ou 127.0.0.1). Por enquanto, responda no terminal.') });

    this.approveBtn = h('button', { class: 'ui-btn ui-perm__btn ui-perm__btn--allow', type: 'button', on: { click: () => this.send({ behavior: 'allow' }) } }, tr('✓ Aprovar'));
    this.answerBtn = h('button', { class: 'ui-btn ui-perm__btn ui-perm__btn--allow', type: 'button', hidden: true, on: { click: () => this.sendAnswer() } }, tr('✓ Responder'));
    this.askForm = h('form', { class: 'ui-perm-ask', hidden: true, attrs: { 'aria-label': tr('Perguntas do agente') } });
    this.askForm.addEventListener('submit', (e) => {
      e.preventDefault();
      this.sendAnswer();
    });
    this.askForm.addEventListener('change', () => this.syncAnswer());
    this.denyBtn = h('button', { class: 'ui-btn ui-perm__btn ui-perm__btn--deny', type: 'button', attrs: { 'aria-expanded': 'false' }, on: { click: () => this.toggleDeny() } }, tr('✕ Recusar…'));
    this.terminalBtn = h(
      'button',
      { class: 'ui-btn ui-perm__btn', type: 'button', title: tr('O Habblaud deixa este pedido de lado: vale o que você responder no terminal'), on: { click: () => this.send({ behavior: 'terminal' }) } },
      tr('Responder no terminal'),
    );

    const list = h('div', { class: 'ui-perm__rules' });
    this.suggestions = new KeyedList<PermissionSuggestionInfo, HTMLButtonElement>(list, {
      animate: false,
      key: (s) => String(s.index),
      create: (s) => h('button', { class: 'ui-btn ui-perm__rule', type: 'button', on: { click: () => this.send({ behavior: 'allow', suggestion: s.index }) } }),
      update: (btn, s) => {
        const rules = s.rules.join(', ');
        setText(btn, `${rules} · ${destinationLabel(s.destination)}`);
        setTitle(btn, tr('Aprovar agora e não perguntar de novo: {0} ({1})', [rules, destinationLabel(s.destination)]));
      },
    });
    this.always = h('div', { class: 'ui-perm__always', hidden: true }, h('span', { class: 'ui-perm__always-label', text: tr('Aprovar e não perguntar de novo:') }), list);

    this.reason = h('textarea', { class: 'ui-perm__reason', attrs: { rows: 2, maxlength: MESSAGE_MAX, placeholder: tr('Motivo (opcional, vai para o agente). Ex.: use pnpm em vez de npm'), 'aria-label': tr('Motivo da recusa (opcional)') } });
    this.interrupt = h('input', { type: 'checkbox', class: 'ui-perm__check' });
    this.interruptRow = h('label', { class: 'ui-perm__check-row' }, this.interrupt, h('span', { text: tr('Interromper o agente (ele para e espera você)') }));
    this.denySubmit = h('button', { class: 'ui-btn ui-perm__btn ui-perm__btn--deny', type: 'submit' }, tr('Recusar'));
    this.denyForm = h(
      'form',
      { class: 'ui-perm__deny', hidden: true },
      this.reason,
      this.interruptRow,
      h('div', { class: 'ui-perm__actions' }, this.denySubmit, h('button', { class: 'ui-btn ui-perm__btn', type: 'button', on: { click: () => this.toggleDeny(false) } }, tr('Cancelar'))),
    );
    // Codex: recusar só com motivo (o botão acende quando há texto).
    this.reason.addEventListener('input', () => this.syncDeny());
    this.denyForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const message = this.reason.value.trim().slice(0, MESSAGE_MAX);
      if (this.opts.reasonRequired && !message) return this.reason.focus();
      this.send({ behavior: 'deny', ...(message ? { message } : {}), ...(this.opts.interrupt && this.interrupt.checked ? { interrupt: true } : {}) });
    });
    // Esc dentro do formulário fecha só o formulário (não a gaveta).
    this.denyForm.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      this.toggleDeny(false);
    });

    this.status = h('p', { class: 'ui-perm__status', role: 'status', attrs: { 'aria-live': 'polite' } });
    this.el = h(
      'section',
      { class: 'ui-perm', hidden: true, tabIndex: -1 },
      h('div', { class: 'ui-perm__head' }, this.icon, h('div', { class: 'ui-perm__head-text' }, this.title, this.what), this.timer),
      this.tool,
      this.preview,
      this.askForm,
      this.note,
      this.queue,
      this.remote,
      h('div', { class: 'ui-perm__actions' }, this.approveBtn, this.answerBtn, this.denyBtn, this.terminalBtn),
      this.always,
      this.denyForm,
      this.status,
    );
    ctx.root.addEventListener(PERMISSION_FOCUS_EVENT, (e) => {
      this.pendingFocus = (e as CustomEvent<string>).detail;
      ctx.invalidate();
    });
  }

  /** O cartão está à mostra (há pedido para este agente). */
  get visible(): boolean {
    return !this.el.hidden;
  }

  render(agent: AgentInfo | undefined): void {
    const p = agent?.permission;
    if (!agent || !p) {
      setHidden(this.el, true);
      this.reset('', agent?.id ?? '');
      return;
    }
    if (p.id !== this.id || agent.id !== this.agentId) this.reset(p.id, agent.id);
    setHidden(this.el, false);
    const now = this.ctx.now();
    const opts = (this.opts = permissionOptions(p, agent));
    const codex = p.provider === 'codex';
    this.el.classList.toggle('is-codex', codex);
    const ask = isQuestionRequest(p);
    const kind = ask ? 'ask' : 'perm';
    if (this.el.dataset.kind !== kind) {
      this.el.dataset.kind = kind;
      this.icon.innerHTML = ask ? ICONS.help : ICONS.lock;
      setAttr(this.el, 'aria-label', ask ? tr('Pergunta do agente') : tr('Pedido de permissão'));
    }
    setText(this.title, ask ? (p.questions!.length > 1 ? tr('Perguntas para você') : tr('Pergunta para você')) : tr('Pede permissão'));
    const by = p.subagent ? tr(' · subagente {0}', [p.subagent]) : '';
    setText(this.what, ask ? tr('Aqui ou no terminal: vale a primeira resposta{0}', [by]) :`${p.icon} ${p.text}${by}`);
    setText(this.timer, expiryText(p.expiresAt, now, opts.seconds));
    setTitle(
      this.timer,
      codex
        ? tr('Pedido feito às {0}. Sem resposta aqui até {1}, o Codex segue sem a decisão do escritório e pede a aprovação no terminal.', [formatClock(p.createdAt), formatClock(p.expiresAt)])
        : tr('Pedido feito às {0}. Sem resposta aqui até {1}, o Habblaud devolve o pedido ao terminal.', [formatClock(p.createdAt), formatClock(p.expiresAt)]),
    );

    // Pergunta: o formulário com as opções no lugar do título da ferramenta e da prévia dos argumentos.
    setHidden(this.tool, ask);
    setHidden(this.preview, ask);
    setHidden(this.askForm, !ask);
    if (ask && this.askId !== p.id) this.buildAsk(p);
    if (!ask) {
      const full = this.detail?.id === p.id ? this.detail : p.input !== undefined ? p : null;
      const { name, args } = splitToolTitle(p.title);
      const shown = commandPreview(full) ? '' : args;
      if (this.tool.dataset.title !== `${p.title}|${shown}`) {
        this.tool.dataset.title = `${p.title}|${shown}`;
        this.tool.replaceChildren(h('strong', { text: name }), shown ? document.createTextNode(shown) : '');
      }
      setTitle(this.tool, p.title);
      if (this.preview.dataset.id !== `${p.id}:${full ? 'full' : 'short'}`) {
        this.preview.dataset.id = `${p.id}:${full ? 'full' : 'short'}`;
        this.preview.replaceChildren(full ? (previewBlock(full) ?? '') : h('span', { class: 'ui-muted ui-small', text: tr('Carregando os detalhes…') }));
      }
    }

    // Aviso: subagente em segundo plano (Claude Code) ou o terminal do Codex, que só pede depois do escritório.
    setHidden(this.note, !opts.note);
    setText(this.note, opts.note);
    setHidden(this.queue, !p.queued);
    setText(this.queue, p.queued ? tr('+{0} {1} deste agente na fila', [p.queued, p.queued === 1 ? tr('pedido') : tr('pedidos')]) : '');

    setHidden(this.remote, this.isLocal());
    const busy = this.isBusy();
    setHidden(this.approveBtn, ask);
    setHidden(this.answerBtn, !ask);
    for (const b of [this.approveBtn, this.denyBtn, this.terminalBtn]) b.disabled = busy;
    for (const el of this.askForm.querySelectorAll('input')) el.disabled = busy;
    if (ask) this.syncAnswer();
    setTitle(this.denyBtn, ask ? tr('Não responder: o agente segue sem a resposta (com o motivo, se você escrever um)') : codex ? tr('Recusar com um motivo (o Codex pede um)') : '');
    setTitle(
      this.terminalBtn,
      codex ? tr('O Habblaud solta o pedido agora: o Codex mostra a aprovação no terminal') : tr('O Habblaud deixa este pedido de lado: vale o que você responder no terminal'),
    );
    this.suggestions.sync(opts.always ? (p.suggestions ?? []) : []);
    for (const b of this.suggestions.container.querySelectorAll('button')) b.disabled = busy;
    setHidden(this.always, ask || !opts.always || this.phase === 'deny');
    setHidden(this.denyForm, this.phase !== 'deny');
    setHidden(this.interruptRow, !opts.interrupt);
    setAttr(
      this.reason,
      'placeholder',
      opts.reasonRequired
        ? tr('Motivo (obrigatório no Codex, vai para o agente). Ex.: use pnpm em vez de npm')
        : tr('Motivo (opcional, vai para o agente). Ex.: {0}', [ask ? tr('decida você, com o que for mais seguro') : tr('use pnpm em vez de npm')]),
    );
    setAttr(this.reason, 'aria-label', opts.reasonRequired ? tr('Motivo da recusa (obrigatório)') : tr('Motivo da recusa (opcional)'));
    for (const el of this.denyForm.querySelectorAll<HTMLButtonElement | HTMLTextAreaElement | HTMLInputElement>('button, textarea, input')) el.disabled = busy;
    this.syncDeny();
    setAttr(this.denyBtn, 'aria-expanded', String(this.phase === 'deny'));
    this.denyBtn.classList.toggle('is-on', this.phase === 'deny');

    if (this.pendingFocus === agent.id) {
      this.pendingFocus = null;
      requestAnimationFrame(() => {
        this.el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        this.el.focus({ preventScroll: true });
      });
    }
  }

  private reset(id: string, agentId: string): void {
    if (id === this.id && agentId === this.agentId) return;
    this.id = id;
    this.agentId = agentId;
    this.phase = 'idle';
    this.detail = null;
    this.reason.value = '';
    this.interrupt.checked = false;
    setText(this.status, '');
    this.status.classList.remove('is-error');
    delete this.preview.dataset.id;
    this.askId = '';
    this.askRefs = [];
    this.askForm.replaceChildren();
    if (!id) return;
    const req = ++this.detailReq;
    this.ctx.store
      .permissionDetail(agentId, id)
      .then((d) => {
        if (req !== this.detailReq || !d) return;
        this.detail = d;
        this.ctx.invalidate();
      })
      .catch(() => {
        // Sem detalhe (acesso que não é local ou pedido já respondido): fica o título.
      });
  }

  /** Codex: "Recusar" só acende com um motivo escrito. */
  private syncDeny(): void {
    const missing = this.opts.reasonRequired && !this.reason.value.trim();
    this.denySubmit.disabled = this.isBusy() || missing;
    setTitle(this.denySubmit, missing ? tr('Escreva o motivo: o Codex recusa só com um motivo') : '');
  }

  private toggleDeny(open = this.phase !== 'deny'): void {
    if (this.phase === 'sending' || this.phase === 'sent') return;
    this.phase = open ? 'deny' : 'idle';
    this.ctx.invalidate();
    if (open) requestAnimationFrame(() => this.reason.focus());
    else this.denyBtn.focus();
  }

  private async send(d: PermissionDecision): Promise<void> {
    const id = this.id;
    if (!id || this.phase === 'sending' || this.phase === 'sent') return;
    this.phase = 'sending';
    this.status.classList.remove('is-error');
    setText(this.status, tr('Enviando a resposta…'));
    this.ctx.invalidate();
    let error: string | undefined;
    try {
      error = await this.ctx.store.decidePermission(id, d);
    } catch {
      error = tr('Não foi possível falar com o Habblaud. Responda no terminal.');
    }
    if (this.id !== id) return;
    if (error) {
      this.phase = 'idle';
      this.status.classList.add('is-error');
      setText(this.status, error);
    } else {
      this.phase = 'sent';
      const done = DONE[d.behavior];
      setText(this.status, `${done}.`);
      this.ctx.announce(`${done}: ${this.ctx.agent(this.agentId)?.name ?? tr('agente')}.`);
    }
    this.ctx.invalidate();
  }

  /** Esta página pode responder (porta local, ou remota com permissions liberado; ou o modo mock). */
  private isLocal(): boolean {
    return this.ctx.store.mock || access().permissions;
  }

  /** Sem como responder agora: enviando, já respondido ou página aberta de fora do computador. */
  private isBusy(): boolean {
    return this.phase === 'sending' || this.phase === 'sent' || !this.isLocal();
  }

  // ---------------------------------------------------------------- perguntas (AskUserQuestion)

  /** Monta as perguntas de um pedido (só quando o pedido muda: a seleção sobrevive aos snapshots). */
  private buildAsk(p: PermissionRequestInfo): void {
    this.askId = p.id;
    this.askRefs = (p.questions ?? []).map((q) => this.askQuestion(p.id, q));
    this.askForm.replaceChildren(...this.askRefs.map((r) => r.el));
  }

  /** Uma pergunta: rádios (escolha única) ou caixas (várias), cada opção com a descrição, e o "Outro" com texto. */
  private askQuestion(requestId: string, q: AskQuestion): AskRefs {
    const name = `ask-${requestId}-${q.index}`;
    const input = (value: string) => h('input', { class: 'ui-perm-ask__input', type: q.multiSelect ? 'checkbox' : 'radio', attrs: { name, value } });
    const optionText = (label: string, description?: string) =>
      h('span', { class: 'ui-perm-ask__opt-text' }, h('strong', { text: label }), description ? h('span', { class: 'ui-ask__desc', text: description }) : null);
    const options = q.options.map((o) => ({ input: input(String(o.index)), o }));
    const other = input('other');
    const text = h('input', {
      class: 'ui-perm-ask__text',
      type: 'text',
      attrs: { maxlength: ANSWER_OTHER_MAX, placeholder: tr('Escreva a sua resposta'), autocomplete: 'off', 'aria-label': tr('Outra resposta para: {0}', [q.question]) },
    });
    text.addEventListener('input', () => {
      // Escrever no campo marca o "Outro".
      if (text.value.trim() && !other.checked) other.checked = true;
      this.syncAnswer();
    });
    text.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.sendAnswer();
      } else if (e.key === 'Escape') {
        // Esc sai do campo (não fecha a gaveta).
        e.preventDefault();
        text.blur();
      }
    });
    const el = h(
      'fieldset',
      { class: 'ui-perm-ask__q' },
      h('legend', { class: 'ui-perm-ask__legend' }, q.header ? h('span', { class: 'ui-ask__tag', text: q.header }) : null, h('span', { class: 'ui-ask__question', text: q.question })),
      h('p', { class: 'ui-ask__hint', text: q.multiSelect ? tr('Pode escolher mais de uma') : tr('Escolha uma') }),
      ...options.map(({ input: box, o }) => h('label', { class: 'ui-perm-ask__opt' }, box, optionText(o.label, o.description))),
      h('div', { class: 'ui-perm-ask__other' }, h('label', { class: 'ui-perm-ask__opt' }, other, optionText(tr('Outro'))), text),
    );
    return { q, el, options: options.map((x) => x.input), other, text };
  }

  /** O que está marcado em cada pergunta. */
  private choices(): Map<number, AskChoice> {
    return new Map(this.askRefs.map((r) => [r.q.index, { options: r.options.filter((i) => i.checked).map((i) => Number(i.value)), otherOn: r.other.checked, otherText: r.text.value }]));
  }

  private answers(): PermissionAnswer[] | undefined {
    return buildAnswers(
      this.askRefs.map((r) => r.q),
      this.choices(),
    );
  }

  /** Liga o Responder só com todas as perguntas respondidas. */
  private syncAnswer(): void {
    const ready = !!this.answers();
    this.answerBtn.disabled = this.isBusy() || !ready;
    setTitle(this.answerBtn, ready ? tr('Mandar as respostas ao agente') : tr('Responda todas as perguntas (no “Outro”, escreva a resposta)'));
  }

  private sendAnswer(): void {
    const answers = this.answers();
    if (answers && !this.isBusy()) void this.send({ behavior: 'answer', answers });
  }
}
