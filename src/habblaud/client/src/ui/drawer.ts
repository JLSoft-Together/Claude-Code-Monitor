// Gaveta de detalhes (direita): agente ou sala selecionados. Agente do Codex: selo "Codex", textos dele (onde
// responder, o terminal, a aprovação no lugar do modo de permissão, sem custo) e a dica dos hooks do Codex.
import type { Activity, AgentInfo, FeedItem, RoomInfo, ShellJob, TaskItem } from '../../../shared/types';
import { roomTheme } from '../art';
import { createAvatarPlaceholder, updateAvatar } from './avatar';
import { CharacterEditor } from './character-editor';
import { MessageComposer } from './composer';
import type { UiComponent, UiContext } from './context';
import { copyText, h, iconButton, KeyedList, setAttr, setHidden, setStyleVar, setText, setTitle, setVariant } from './dom';
import {
  formatClock,
  formatDateTime,
  formatDuration,
  formatElapsed,
  formatInt,
  formatTokens,
  formatUSD,
  permissionLabel,
  plural,
  prettyModel,
  relativeTime,
  shortPath,
} from './format';
import { ICONS } from './icons';
import {
  accountsOf,
  activityFallback,
  aggregateTasks,
  mergeHistory,
  roleLabel,
  shellBoxText,
  shellDoneKind,
  shellKindLabel,
  shellStage,
  shellWaitIn,
  sortByUrgency,
  statusLabel,
  taskProgress,
  visibleShells,
} from './model';
import { access } from '../net/access';
import { PermissionCard } from './permission';
import { canRenameRoom } from './roomrename';
import { accountChipLabel, accountProvider, CODEX_LIVE_HINT, codexApprovalLabel, providerOf } from './provider';
import { ptyControllable } from './ptyapi';
import { createAgentRow, updateAgentRow } from './rows';
import { SocialSection } from './social';
import { TERMINAL_UNAVAILABLE_HINT, type TerminalControl } from './terminal';
import { Movable } from './movable';
import type { PtyControl } from './pty';
import { richText } from './usage';
import {
  createAccountChip,
  createProgress,
  createProviderTag,
  createStatusDot,
  updateAccountChip,
  updateProgress,
  updateProviderTag,
  updateStatusDot,
} from './widgets';
import { tr } from '../../../shared/i18n';

/** Itens da linha do tempo mostrados de início; "Mostrar mais" acrescenta outro tanto. */
const TIMELINE_STEP = 15;
const ROOM_FEED_LIMIT = 15;

// ---------------------------------------------------------------- peças

function section(title: string, ...children: (Node | null)[]): { el: HTMLElement; title: HTMLElement; extra: HTMLElement } {
  const t = h('h3', { class: 'ui-sec__title', text: title });
  const extra = h('span', { class: 'ui-sec__extra' });
  const el = h('section', { class: 'ui-sec' }, h('div', { class: 'ui-sec__head' }, t, extra), ...children.filter((c): c is Node => !!c));
  return { el, title: t, extra };
}

function copyButton(getText: () => string, label: string): HTMLButtonElement {
  const b = iconButton(ICONS.copy, label, async () => {
    const ok = await copyText(getText());
    b.classList.toggle('is-done', ok);
    b.innerHTML = ok ? ICONS.check : ICONS.copy;
    setTitle(b, ok ? tr('Copiado!') : tr('Não foi possível copiar'));
    setTimeout(() => {
      b.classList.remove('is-done');
      b.innerHTML = ICONS.copy;
      setTitle(b, label);
    }, 1400);
  }, 'ui-icon-btn--sm');
  return b;
}

const TASK_MARK: Record<TaskItem['status'], string> = { completed: '✓', in_progress: '◐', pending: '○' };
const TASK_STATE: Record<TaskItem['status'], string> = { completed: tr('concluída'), in_progress: tr('em andamento'), pending: 'pendente' };

function createTaskItem(): HTMLElement {
  return h('li', { class: 'ui-task' }, h('span', { class: 'ui-task__mark', attrs: { 'aria-hidden': 'true' } }), h('span', { class: 'ui-task__text' }), h('span', { class: 'ui-task__owner' }));
}

function updateTaskItem(li: HTMLElement, t: TaskItem, owner?: string): void {
  const [mark, text, ownerEl] = li.children as unknown as HTMLElement[];
  setText(mark, TASK_MARK[t.status]);
  setText(text, t.status === 'in_progress' && t.activeForm ? t.activeForm : t.title);
  setText(ownerEl, owner ?? '');
  setHidden(ownerEl, !owner);
  setVariant(li, 'is-', t.status);
  setAttr(li, 'aria-label', `${t.title}: ${TASK_STATE[t.status]}`);
}

function createTimelineItem(): HTMLElement {
  return h(
    'li',
    { class: 'ui-tl' },
    h('span', { class: 'ui-tl__icon', attrs: { 'aria-hidden': 'true' } }),
    h('span', { class: 'ui-tl__text' }),
    h('time', { class: 'ui-tl__time' }),
  );
}

function updateTimelineItem(li: HTMLElement, a: Activity, now: number, who?: string): void {
  const [icon, text, time] = li.children as unknown as HTMLElement[];
  setText(icon, a.icon);
  setText(text, who ? `${who}: ${a.text}` : a.text);
  setText(time, relativeTime(a.at, now));
  setAttr(time, 'datetime', new Date(a.at).toISOString());
  setTitle(li, `${formatClock(a.at)} · ${a.text}${a.detail ? `\n${a.detail}` : ''}`);
  li.classList.toggle('is-error', !!a.error);
  const done = shellDoneKind(a);
  li.classList.toggle('is-shell-ok', done === 'ok');
  li.classList.toggle('is-shell-fail', done === 'fail');
}

// ---------------------------------------------------------------- shells rodando

interface ShellRefs {
  icon: HTMLElement;
  label: HTMLElement;
  time: HTMLElement;
  badge: HTMLElement;
  since: HTMLElement;
  details: HTMLDetailsElement;
  command: HTMLElement;
}

const shellRefs = new WeakMap<HTMLElement, ShellRefs>();

const SHELL_KIND_VARIANT = (j: ShellJob): string => (j.kind === 'monitor' ? 'monitor' : j.background ? 'bg' : 'fg');

function createShellItem(): HTMLElement {
  const icon = h('span', { class: 'ui-shell__icon', attrs: { 'aria-hidden': 'true' } });
  const label = h('span', { class: 'ui-shell__label' });
  const time = h('time', { class: 'ui-shell__time' });
  const badge = h('span', { class: 'ui-shell__badge' });
  const since = h('span', { class: 'ui-shell__since' });
  const command = h('pre', { class: 'ui-mono' });
  const details = h(
    'details',
    { class: 'ui-shell__cmd' },
    h('summary', { text: tr('Comando') }),
    h('div', { class: 'ui-shell__cmd-body' }, command, copyButton(() => command.textContent ?? '', tr('Copiar comando'))),
  );
  const li = h('li', { class: 'ui-shell' }, h('div', { class: 'ui-shell__head' }, icon, label, time), h('div', { class: 'ui-shell__meta' }, badge, since), details);
  shellRefs.set(li, { icon, label, time, badge, since, details, command });
  return li;
}

function updateShellItem(li: HTMLElement, j: ShellJob, now: number): void {
  const r = shellRefs.get(li)!;
  setText(r.icon, j.kind === 'monitor' ? '📡' : '💻');
  setText(r.label, j.label);
  setTitle(r.label, j.label);
  const elapsed = Math.max(0, now - j.startedAt);
  setText(r.time, formatElapsed(elapsed));
  setAttr(r.time, 'datetime', new Date(j.startedAt).toISOString());
  setTitle(r.time, tr('Rodando há {0} (desde {1})', [formatDuration(elapsed), formatClock(j.startedAt)]));
  setText(r.badge, shellKindLabel(j));
  setVariant(r.badge, 'ui-shell__badge--', SHELL_KIND_VARIANT(j));
  setText(r.since, tr('desde {0}', [formatClock(j.startedAt, false)]));
  setTitle(r.since, tr('Iniciado em {0} · id {1}', [formatDateTime(j.startedAt), j.id]));
  setHidden(r.details, !j.command);
  setText(r.command, j.command ?? '');
  setAttr(li, 'aria-label', tr('{0}, {1}, rodando há {2}', [j.label, shellKindLabel(j), formatDuration(elapsed)]));
}


// ---------------------------------------------------------------- visão do agente

class AgentView {
  readonly el: HTMLElement;
  private id = '';
  private last: AgentInfo | null = null;
  private history: Activity[] = [];
  private historyReq = 0;
  /** Sobe ao trocar ao vivo ↔ replay ou ao retroceder: a resposta da geração anterior não entra. */
  private historyGen = 0;
  /** Fonte e instante da última linha do tempo (para perceber troca e retrocesso). */
  private historyReplay = false;
  private historyAt = 0;
  private historyBound = false;

  private avatar: HTMLElement;
  private name: HTMLElement;
  private role: HTMLElement;
  private title: HTMLElement;
  private accChip: HTMLElement;
  private accName: HTMLElement;
  private accProv: HTMLElement;
  private accEmail: HTMLElement;
  /** Dica dos hooks do Codex (ao vivo e aprovar pelo escritório), na gaveta de um agente do Codex. */
  private codexHint: HTMLElement;
  private roomBtn: HTMLButtonElement;
  private roomName: HTMLElement;
  private gone: HTMLElement;
  private dot: HTMLElement;
  private statusText: HTMLElement;
  private statusSince: HTMLElement;
  private followBtn: HTMLButtonElement;
  private termBtn: HTMLButtonElement;
  private termLabel: HTMLElement;
  /** Por que o terminal não abre: no celular não há hover para ler o title, então o toque mostra o motivo aqui. */
  private termWhy: HTMLElement;
  private termWhyTimer: ReturnType<typeof setTimeout> | null = null;
  private alert: HTMLElement;
  private alertText: HTMLElement;
  /**
   * Perguntas e opções do AskUserQuestion pendente, só para leitura: com o pedido no escritório (hook de
   * permissão), quem aparece é o cartão de resposta, no lugar do alerta.
   */
  private alertQuestions: HTMLElement;
  private alertQuestionsKey = '';
  /** Dica de como responder as perguntas por aqui (o plugin de permissões). */
  private alertAnswerHint: HTMLElement;
  /** Pedido de permissão (ou pergunta) para responder por aqui (substitui o alerta genérico enquanto existe). */
  private perm: PermissionCard;
  private shellBox: HTMLElement;
  private shellText: HTMLElement;
  private shellMood: HTMLElement;
  private shellNext: HTMLElement;
  private shellsSec: ReturnType<typeof section>;
  private shells: KeyedList<ShellJob>;
  private actIcon: HTMLElement;
  private actText: HTMLElement;
  private actTime: HTMLElement;
  private actDetails: HTMLDetailsElement;
  private actDetail: HTMLElement;
  /** Mandar mensagem ao agente principal pelo Habblaud (plugin habblaud-mensagens). */
  private composer: MessageComposer;
  private msgSec: ReturnType<typeof section>;
  private tasksSec: ReturnType<typeof section>;
  private tasksBar: HTMLElement;
  private tasks: KeyedList<TaskItem>;
  private teamSec: ReturnType<typeof section>;
  private team: KeyedList<AgentInfo>;
  private teamEmpty: HTMLElement;
  private timeline: KeyedList<Activity>;
  private timelineSec: ReturnType<typeof section>;
  private timelineMore: HTMLButtonElement;
  private timelineLess: HTMLButtonElement;
  /** Quantos itens da linha do tempo aparecem agora. */
  private timelineShown = TIMELINE_STEP;
  private stats: KvList<StatKey>;
  private social: SocialSection;
  readonly character: CharacterEditor;
  private sessionValue: HTMLElement;
  private linesPlus: HTMLElement;
  private linesMinus: HTMLElement;
  private termRo: HTMLElement;

  constructor(
    private ctx: UiContext,
    private terminal: TerminalControl,
    private pty: PtyControl,
  ) {
    this.avatar = createAvatarPlaceholder('lg');
    this.name = h('h2', { class: 'ui-hero__name' });
    this.role = h('span', { class: 'ui-role' });
    this.title = h('p', { class: 'ui-hero__title' });
    this.accChip = createAccountChip('md');
    this.accName = h('span', { class: 'ui-hero__acc-name' });
    this.accProv = createProviderTag('ui-prov--xs');
    this.accEmail = h('span', { class: 'ui-hero__acc-email' });
    this.roomName = h('span');
    this.roomBtn = h('button', { class: 'ui-room-link', type: 'button', on: { click: () => this.last && ctx.select({ type: 'room', id: this.last.roomId }, { focus: true }) } }, this.roomName);
    this.character = new CharacterEditor(ctx);
    const heroText = h(
      'div',
      { class: 'ui-hero__text' },
      h('div', { class: 'ui-hero__line' }, this.name, this.character.button, this.role),
      h('div', { class: 'ui-hero__acc' }, this.accChip, this.accName, this.accProv, this.accEmail),
      h('div', { class: 'ui-hero__where' }, h('span', { class: 'ui-muted', text: tr('Sala') }), this.roomBtn),
    );
    this.gone = h('p', { class: 'ui-gone', text: tr('Este agente já saiu do escritório.'), hidden: true });

    this.dot = createStatusDot();
    this.statusText = h('span', { class: 'ui-status__text' });
    this.statusSince = h('span', { class: 'ui-status__since' });
    this.followBtn = h('button', { class: 'ui-btn', type: 'button', attrs: { 'aria-pressed': 'false' }, title: tr('Câmera acompanha o agente (F)'), on: { click: () => this.toggleFollow() } });
    this.followBtn.innerHTML = ICONS.follow;
    this.followBtn.append(h('span', { text: tr('Seguir') }));
    const centerBtn = h('button', { class: 'ui-btn', type: 'button', title: tr('Levar a câmera até o agente'), on: { click: () => ctx.focusSelection() } });
    centerBtn.innerHTML = ICONS.center;
    centerBtn.append(h('span', { text: tr('Centralizar') }));
    const statusRow = h(
      'div',
      { class: 'ui-status' },
      h('span', { class: 'ui-status__label' }, this.dot, this.statusText, this.statusSince),
      h('span', { class: 'ui-status__actions' }, this.followBtn, centerBtn),
    );

    // Terminal: a conversa da sessão como o Claude Code mostra, ao vivo (só com acesso local).
    this.termLabel = h('span', { class: 'ui-term-cta__label', text: tr('Abrir terminal') });
    const termIcon = h('span', { class: 'ui-term-cta__icon', attrs: { 'aria-hidden': 'true' } });
    termIcon.innerHTML = ICONS.terminal;
    this.termBtn = h(
      'button',
      { class: 'ui-btn ui-term-cta', type: 'button', attrs: { 'aria-pressed': 'false' }, on: { click: () => this.toggleTerminal() } },
      termIcon,
      this.termLabel,
      (this.termRo = h('span', { class: 'ui-term-cta__ro', text: tr('ao vivo') })),
      h('kbd', { class: 'ui-kbd', text: 'T', attrs: { 'aria-hidden': 'true' } }),
    );

    this.termWhy = h('p', { class: 'ui-term-cta__why', hidden: true, attrs: { role: 'status' } });

    this.alertText = h('p', { class: 'ui-alert__text' });
    this.alertQuestions = h('div', { class: 'ui-ask', hidden: true });
    this.alertAnswerHint = h('p', { class: 'ui-ask__answer-hint', hidden: true, text: tr('Com o plugin habblaud-permissoes (npm run mod:install), dá para responder as perguntas por aqui.') });
    const alertIcon = h('span', { class: 'ui-alert__icon', attrs: { 'aria-hidden': 'true' } });
    alertIcon.innerHTML = ICONS.hand;
    this.alert = h(
      'div',
      { class: 'ui-alert', role: 'alert', hidden: true },
      alertIcon,
      h('div', {}, h('strong', { class: 'ui-alert__title', text: tr('Precisa de você') }), this.alertText, this.alertQuestions, this.alertAnswerHint),
    );

    // Esperando o shell: caixa de status (com a fase da espera no escritório) e a lista de comandos rodando.
    this.shellText = h('p', { class: 'ui-alert__text' });
    this.shellMood = h('span', { class: 'ui-shell-mood__text' });
    this.shellNext = h('span', { class: 'ui-shell-mood__next' });
    const shellIcon = h('span', { class: 'ui-alert__icon ui-hourglass', attrs: { 'aria-hidden': 'true' } });
    shellIcon.innerHTML = ICONS.hourglass;
    this.shellBox = h(
      'div',
      { class: 'ui-alert ui-alert--shell', hidden: true },
      shellIcon,
      h('div', {}, h('strong', { class: 'ui-alert__title', text: tr('Esperando o shell') }), this.shellText, h('p', { class: 'ui-shell-mood' }, this.shellMood, this.shellNext)),
    );
    const shellList = h('ul', { class: 'ui-shells' });
    this.shellsSec = section(tr('Shells rodando'), shellList);
    this.shells = new KeyedList<ShellJob>(shellList, { key: (j) => j.id, create: createShellItem, update: (li, j) => updateShellItem(li, j, ctx.now()) });

    this.actIcon = h('span', { class: 'ui-now__icon', attrs: { 'aria-hidden': 'true' } });
    this.actText = h('span', { class: 'ui-now__text' });
    this.actTime = h('span', { class: 'ui-now__time' });
    this.actDetail = h('pre', { class: 'ui-mono' });
    this.actDetails = h('details', { class: 'ui-now__details' }, h('summary', { text: tr('Detalhes') }), this.actDetail);
    const nowSec = section(tr('Agora'), h('div', { class: 'ui-now' }, this.actIcon, h('div', { class: 'ui-now__body' }, this.actText, this.actTime)), this.actDetails);
    this.composer = new MessageComposer(ctx, 'drawer');
    this.msgSec = section(tr('Mandar mensagem'), this.composer.el);
    // No celular a caixa fica presa no rodapé da gaveta enquanto a conversa rola (styles.css, .ui-sec--msg).
    this.msgSec.el.classList.add('ui-sec--msg');
    this.social = new SocialSection(ctx);
    this.perm = new PermissionCard(ctx);

    this.tasksBar = createProgress(tr('Progresso das tarefas'));
    const tasksList = h('ul', { class: 'ui-tasks' });
    this.tasksSec = section(tr('Tarefas'), this.tasksBar, tasksList);
    this.tasks = new KeyedList<TaskItem>(tasksList, { key: (t) => t.id, create: createTaskItem, update: (li, t) => updateTaskItem(li, t) });

    const teamList = h('div', { class: 'ui-team' });
    this.teamEmpty = h('p', { class: 'ui-muted ui-small', text: tr('Nenhum subagente no momento.') });
    this.teamSec = section(tr('Subagentes'), teamList, this.teamEmpty);
    this.team = new KeyedList<AgentInfo>(teamList, {
      key: (a) => a.id,
      create: (a) => createAgentRow(a, (id) => ctx.select({ type: 'agent', id }, { focus: true }), 'sm'),
      update: (row, a) => updateAgentRow(row, a, ctx.account(a.account), false, ctx.now(), ctx.store.snapshot?.agents),
    });

    const tl = h('ol', { class: 'ui-timeline' });
    this.timelineMore = h('button', { class: 'ui-btn ui-btn--sm', type: 'button', on: { click: () => this.showTimeline(this.timelineShown + TIMELINE_STEP) } });
    this.timelineLess = h('button', { class: 'ui-btn ui-btn--sm', type: 'button', text: tr('Mostrar menos'), on: { click: () => this.showTimeline(TIMELINE_STEP) } });
    this.timelineSec = section(tr('Linha do tempo'), tl, h('div', { class: 'ui-timeline__more' }, this.timelineMore, this.timelineLess));
    this.timeline = new KeyedList<Activity>(tl, { key: (a) => a.id, create: createTimelineItem, update: (li, a) => updateTimelineItem(li, a, ctx.now()) });

    this.sessionValue = h('span', { class: 'ui-mono-inline' });
    this.linesPlus = h('span', { class: 'ui-plus' });
    this.linesMinus = h('span', { class: 'ui-minus' });
    this.stats = new KvList<StatKey>([
      ['tools', tr('Chamadas de ferramenta')],
      ['tokensIn', tr('Tokens de entrada')],
      ['tokensOut', tr('Tokens de saída')],
      ['cost', tr('Custo estimado')],
      ['lines', tr('Linhas'), h('span', { class: 'ui-lines' }, this.linesPlus, this.linesMinus)],
      ['subs', tr('Subagentes disparados')],
      ['model', tr('Modelo')],
      ['branch', 'Branch'],
      ['perm', tr('Permissões')],
      ['session', tr('Sessão'), h('span', { class: 'ui-copy-row' }, this.sessionValue, copyButton(() => this.last?.sessionId ?? '', tr('Copiar id da sessão')))],
      ['start', tr('Início')],
      ['duration', tr('Duração')],
      ['bg', tr('Execução')],
    ]);
    const statsSec = section(tr('Estatísticas'), this.stats.el);
    this.codexHint = h('p', { class: 'ui-codex-hint', hidden: true }, ...richText(CODEX_LIVE_HINT));

    this.el = h(
      'div',
      { class: 'ui-drawer__view ui-agent-view' },
      h('div', { class: 'ui-hero' }, this.avatar, heroText),
      this.character.el,
      this.title,
      this.gone,
      statusRow,
      this.termBtn,
      this.termWhy,
      this.alert,
      this.perm.el,
      this.shellBox,
      this.shellsSec.el,
      nowSec.el,
      this.msgSec.el,
      this.social.el,
      this.tasksSec.el,
      this.teamSec.el,
      this.timelineSec.el,
      statsSec.el,
      this.codexHint,
    );
  }

  get agentId(): string {
    return this.id;
  }

  open(id: string): void {
    if (this.id === id) return;
    this.character.open(id);
    this.id = id;
    this.last = null;
    this.history = [];
    this.timelineShown = TIMELINE_STEP;
    this.timeline.clear();
    this.tasks.clear();
    this.team.clear();
    this.shells.clear();
    this.actDetails.open = false;
    this.loadHistory();
  }

  /** Histórico longo do agente (o pedido mais recente vale; ver historyGen). */
  private loadHistory(): void {
    const id = this.id;
    if (!id) return;
    const req = ++this.historyReq;
    const gen = this.historyGen;
    this.ctx.store
      .agentHistory(id)
      .then((hist) => {
        // Outro agente (req) ou troca de fonte/retrocesso no meio do caminho (gen): a resposta não vale mais.
        if (req !== this.historyReq || gen !== this.historyGen) return;
        this.history = mergeHistory(hist, this.history, 200, this.ctx.store.replaying ? this.ctx.store.snapshot?.serverTime : undefined);
        this.ctx.invalidate();
      })
      .catch(() => {
        // Sem histórico longo: a linha do tempo usa as atividades recentes do snapshot.
      });
  }

  /**
   * No replay, a linha do tempo para no instante reproduzido. Trocar a fonte ou retroceder invalida
   * o pedido em curso; na troca, recomeça pelo snapshot (e, de volta ao vivo, busca o histórico de novo).
   */
  private historyUntil(): number | undefined {
    const replaying = this.ctx.store.replaying;
    const at = this.ctx.store.snapshot?.serverTime ?? 0;
    if (this.historyBound) {
      const sourceChanged = replaying !== this.historyReplay;
      const rewound = replaying && at < this.historyAt;
      if (sourceChanged || rewound) {
        this.historyGen++;
        if (sourceChanged) {
          this.history = [];
          if (!replaying) this.loadHistory();
        }
      }
    }
    this.historyBound = true;
    this.historyReplay = replaying;
    this.historyAt = at;
    return replaying ? at : undefined;
  }

  /** Abre (ou fecha) o terminal deste agente; desligado sem acesso local ou depois que ele saiu. */
  toggleTerminal(): void {
    if (!this.id) return;
    if (this.termBtn.getAttribute('aria-disabled') === 'true') {
      // No celular não há hover para ler a dica: o toque mostra o motivo embaixo do botão.
      const why = this.termBtn.title;
      setText(this.termWhy, why);
      setHidden(this.termWhy, false);
      this.ctx.announce(why);
      if (this.termWhyTimer) clearTimeout(this.termWhyTimer);
      this.termWhyTimer = setTimeout(() => setHidden(this.termWhy, true), 8_000);
      return;
    }
    setHidden(this.termWhy, true);
    if (this.ctx.terminals) this.ctx.terminals.toggle(this.id, this.termBtn);
    else this.terminal.toggle(this.id, this.termBtn);
  }

  private showTimeline(n: number): void {
    this.timelineShown = Math.max(TIMELINE_STEP, n);
    this.ctx.invalidate();
  }

  toggleFollow(): void {
    const follow = !this.ctx.world.getOptions().followSelected;
    this.ctx.world.setOptions({ followSelected: follow });
    // Foca de novo com a opção nova: ligar começa a seguir; desligar mantém o agente no centro, parado.
    if (this.id) this.ctx.focusSelection();
    this.ctx.invalidate();
  }

  render(): void {
    const live = this.ctx.agent(this.id);
    if (live) this.last = live;
    const a = this.last;
    if (!a) return;
    const now = this.ctx.now();
    const account = this.ctx.account(a.account);
    const room = this.ctx.store.room(a.roomId);
    const provider = providerOf(a);
    const codex = provider === 'codex';

    updateAvatar(this.avatar, a, 'lg');
    setStyleVar(this.avatar, '--acc', account?.color ?? '#8b98b3');
    setText(this.name, a.name);
    this.character.render(a, !!live);
    setText(this.role, roleLabel(a));
    setVariant(this.role, 'ui-role--', a.kind);
    setText(this.title, a.title ?? '');
    setHidden(this.title, !a.title);
    setTitle(this.title, a.title ?? '');
    updateAccountChip(this.accChip, account, a.account, a.provider);
    setText(this.accName, account?.name ?? a.account);
    updateProviderTag(this.accProv, provider, account?.name ?? '');
    // E-mail (Claude Code) ou, no Codex (sem e-mail), o plano.
    const accSub = account?.email ?? (codex && account?.plan ? tr('plano {0}', [account.plan]) : '');
    setText(this.accEmail, accSub);
    setHidden(this.accEmail, !accSub);
    setText(this.roomName, room?.name ?? a.roomId);
    setTitle(this.roomBtn, room ? tr('{0}\nClique para ver a sala', [room.path]) : '');
    setHidden(this.gone, !!live);
    this.el.classList.toggle('is-gone', !live);

    // Status (quem está parado num comando longo aparece como "Esperando o shell", como no escritório).
    const wait = live ? shellWaitIn(a, this.ctx.store.snapshot?.agents ?? [], now) : null;
    const status = wait ? 'shell' : a.status;
    updateStatusDot(this.dot, status);
    setText(this.statusText, statusLabel(status));
    // Parado num comando longo: o "desde" é o início do comando (o status do servidor continua 'working').
    const since = wait?.foreground ? wait.since : a.statusSince;
    setText(this.statusSince, relativeTime(since, now));
    setTitle(this.statusSince, tr('Desde {0}', [formatClock(since)]));
    const following = this.ctx.world.getOptions().followSelected;
    setAttr(this.followBtn, 'aria-pressed', String(following));
    this.followBtn.classList.toggle('is-on', following);
    this.renderTerminalButton(!!live);

    // Alerta.
    const waiting = a.status === 'waiting' && !!live;
    this.perm.render(live);
    setHidden(this.alert, !waiting || this.perm.visible);
    if (waiting) {
      const accName = account?.name ?? a.account;
      // Codex: "Vá ao Codex (Conta X)"; sem repetir quando a conta já se chama "Codex".
      const where = codex ? tr('ao Codex{0}', [/codex/i.test(accName) ? '' : ` (${accName})`]) : tr('ao terminal da {0}', [accName]);
      setText(this.alertText, tr('Vá {0} em {1} para responder{2}', [where, room?.name ?? tr('seu projeto'), a.waitingFor ? `: ${a.waitingFor}` : '.']));
    }
    // Perguntas do AskUserQuestion (só leitura): o Codex não pergunta pelo escritório.
    const asking = waiting && !codex && a.activity?.kind === 'ask' ? a.activity : undefined;
    this.renderQuestions(asking);
    // Sem o pedido no escritório: dá para responder por aqui com o plugin (só com a trava local, como o cartão). O Codex
    // não responde perguntas pelo escritório.
    const answerable =
      !codex && !!asking?.questions?.length && !this.perm.visible && !this.ctx.store.mock && !!this.ctx.store.snapshot?.meta.terminal && access().permissions;
    setHidden(this.alertAnswerHint, !answerable);

    // Esperando o shell.
    setHidden(this.shellBox, !wait);
    if (wait) {
      setText(this.shellText, shellBoxText(wait));
      const stage = shellStage(now - wait.since);
      setText(this.shellMood, `${stage.emoji} ${stage.text}`);
      setText(this.shellNext, stage.nextIn !== null ? tr('Próxima fase em {0}', [formatDuration(Math.max(1_000, stage.nextIn))]) : '');
      setHidden(this.shellNext, stage.nextIn === null);
      setTitle(this.shellNext, tr('Quanto falta para o personagem mudar o que faz enquanto espera (veja a Ajuda)'));
    }
    // Sem shells próprios, mostra os que ele espera de um subagente.
    const own = live ? visibleShells(a, now) : [];
    const jobs = own.length || !wait ? own : wait.jobs;
    setHidden(this.shellsSec.el, jobs.length === 0);
    setText(this.shellsSec.extra, jobs.length > 1 ? String(jobs.length) : '');
    this.shells.sync(jobs);

    // Atividade atual.
    const act = a.activity;
    setText(this.actIcon, act?.icon ?? '·');
    setText(this.actText, act?.text ?? activityFallback(a));
    // A duração só entra quando o texto ainda não a traz ("Concluiu em 33s" já diz quanto levou).
    const showDuration = !!act?.durationMs && act.kind !== 'done' && !/\d\s?(?:ms|s|min|h)\b/.test(act.text);
    setText(this.actTime, act ? `${relativeTime(act.at, now)}${showDuration ? ` · levou ${formatDuration(act.durationMs!)}` : ''}` : '');
    this.actText.classList.toggle('is-error', !!act?.error);
    const detail = act?.detail ?? '';
    setHidden(this.actDetails, !detail);
    setText(this.actDetail, detail);

    // Mandar mensagem: só para principais presentes (com o recurso ligado e a página local; sem o plugin, a dica).
    setHidden(this.msgSec.el, this.composer.render(live, this.id) === 'off');

    // Vida social (personalidade, carteira, rodas): só de quem está no escritório.
    if (live) this.social.render(a.id, now);
    else setHidden(this.social.el, true);

    // Tarefas.
    const tp = taskProgress(a.tasks);
    setHidden(this.tasksSec.el, a.tasks.length === 0);
    updateProgress(this.tasksBar, tp.completed, tp.total, tp.inProgress);
    setText(this.tasksSec.extra, `${tp.completed}/${tp.total}`);
    this.tasks.sync(a.tasks);

    // Equipe: subagentes (principal) ou responsável (sub).
    if (a.kind === 'main') {
      const subs = sortByUrgency((this.ctx.store.snapshot?.agents ?? []).filter((s) => s.parentId === a.id));
      setText(this.teamSec.title, tr('Subagentes'));
      setText(this.teamSec.extra, subs.length ? String(subs.length) : '');
      setText(this.teamEmpty, a.stats.subagents ? tr('Nenhum ativo agora ({0} nesta sessão).', [plural(a.stats.subagents, tr('disparado'), tr('disparados'))]) : tr('Nenhum subagente disparado ainda.'));
      setHidden(this.teamEmpty, subs.length > 0);
      this.team.sync(subs);
    } else {
      const parent = a.parentId ? this.ctx.agent(a.parentId) : undefined;
      setText(this.teamSec.title, tr('Responsável'));
      setText(this.teamSec.extra, '');
      setText(this.teamEmpty, tr('O agente principal já não está no escritório.'));
      setHidden(this.teamEmpty, !!parent);
      this.team.sync(parent ? [parent] : []);
    }

    // Linha do tempo (mais recente primeiro). No replay, nada depois do instante reproduzido.
    const until = this.historyUntil();
    this.history = mergeHistory(this.history, a.recent, 200, until);
    const items = this.history.slice(-this.timelineShown).reverse();
    const hiddenCount = Math.max(0, this.history.length - this.timelineShown);
    setHidden(this.timelineMore, hiddenCount === 0);
    setText(this.timelineMore, tr('Mostrar mais {0}', [Math.min(TIMELINE_STEP, hiddenCount)]));
    setHidden(this.timelineLess, this.timelineShown <= TIMELINE_STEP || this.history.length <= TIMELINE_STEP);
    this.timeline.sync(items);
    setText(this.timelineSec.extra, this.history.length ? String(this.history.length) : '');

    this.renderStats(a, now);

    // Codex: como ter o ao vivo e as aprovações por aqui (o servidor ainda não diz se os hooks dele estão ligados).
    setHidden(this.codexHint, !codex || a.kind !== 'main' || !live || this.ctx.store.replaying);
  }

  /** Lista as perguntas pendentes com as opções, só para leitura (sem o pedido no escritório, a resposta é no Claude Code). */
  private renderQuestions(act: Activity | undefined): void {
    const qs = act?.questions ?? [];
    setHidden(this.alertQuestions, qs.length === 0);
    const key = qs.length ? `${act!.id}|${qs.length}` : '';
    if (key === this.alertQuestionsKey) return;
    this.alertQuestionsKey = key;
    this.alertQuestions.replaceChildren(
      ...qs.map((q) =>
        h(
          'div',
          { class: 'ui-ask__q' },
          q.header ? h('span', { class: 'ui-ask__tag', text: q.header }) : null,
          h('p', { class: 'ui-ask__question', text: q.question }),
          q.multiSelect ? h('p', { class: 'ui-ask__hint', text: tr('Pode escolher mais de uma') }) : null,
          h(
            'ol',
            { class: 'ui-ask__opts' },
            ...q.options.map((o) =>
              h('li', {}, h('strong', { text: o.label }), o.description ? h('span', { class: 'ui-ask__desc', text: o.description }) : null),
            ),
          ),
        ),
      ),
    );
  }

  private renderTerminalButton(live: boolean, provider = providerOf(this.last)): void {
    const router = this.ctx.terminals;
    const available = (router ? router.available : !!this.ctx.store.snapshot?.meta.terminal) && access().terminal;
    const open = (router ? router.openAgentId : this.terminal.agentId) === this.id;
    // Interativo: o Claude Code roda aqui (pty) ou roda noutro terminal e dá para assumir pela janela.
    const readOnly = !!this.ctx.store.snapshot?.meta.terminal;
    const kind = !this.id ? '' : router?.interactive(this.id) ? 'interativo' : !readOnly && this.pty.enabled && ptyControllable(this.last) ? 'em outro terminal' : 'ao vivo';
    setText(this.termRo, kind === 'interativo' ? tr('interativo') : kind === 'ao vivo' ? tr('ao vivo') : kind ? tr('em outro terminal') : '');
    // aria-disabled (e não disabled): o botão continua focável e a dica do porquê aparece no hover.
    const enabled = open || (available && live);
    if (enabled) setHidden(this.termWhy, true);
    setAttr(this.termBtn, 'aria-disabled', enabled ? null : 'true');
    this.termBtn.classList.toggle('is-disabled', !enabled);
    setAttr(this.termBtn, 'aria-pressed', String(open));
    this.termBtn.classList.toggle('is-on', open);
    setText(this.termLabel, open ? tr('Fechar terminal') : tr('Abrir terminal'));
    setTitle(
      this.termBtn,
      open
        ? tr('Fechar o terminal (T)')
        : !available
          ? this.ctx.store.replaying
            ? tr('Sem terminal no timelapse: a conversa é a de agora, não a do momento reproduzido.')
            : this.ctx.store.snapshot?.meta.terminal && access().remote
              ? tr('O terminal não está liberado no acesso remoto (HABBLAUD_REMOTE_ALLOW).')
              : TERMINAL_UNAVAILABLE_HINT
          : !live
            ? tr('O agente já saiu do escritório.')
            : kind === 'ao vivo'
              ? tr('Ver a conversa desta sessão como no {0}, ao vivo{1} (T)', [
                  provider === 'codex' ? 'Codex' : tr('terminal do Claude Code'),
                  this.pty.enabled && ptyControllable(this.last) ? tr('; "Assumir daqui" continua nela aqui') : '',
                ])
              : kind === 'interativo'
                ? tr('Abrir o terminal desta sessão, que roda aqui no Habblaud (T)')
                : tr('Abrir o terminal: a sessão roda em outro terminal; dá para assumir daqui (T)'),
    );
  }

  private renderStats(a: AgentInfo, now: number): void {
    const s = a.stats;
    const st = this.stats;
    st.set('tools', formatInt(s.toolCalls));
    st.set('tokensIn', formatTokens(s.tokensIn));
    st.set('tokensOut', formatTokens(s.tokensOut));
    st.set('cost', s.costUSD !== undefined ? formatUSD(s.costUSD) : null);
    const codex = providerOf(a) === 'codex';
    const hasLines = s.linesAdded !== undefined || s.linesRemoved !== undefined;
    st.show('lines', hasLines);
    setText(this.linesPlus, `+${formatInt(s.linesAdded ?? 0)}`);
    setText(this.linesMinus, `−${formatInt(s.linesRemoved ?? 0)}`);
    st.set('subs', a.kind === 'main' ? formatInt(s.subagents) : null);
    st.set('model', prettyModel(a.model));
    st.set('branch', a.gitBranch ?? null);
    // Codex: a política de aprovação (quando o servidor a manda) no lugar do modo de permissão do Claude Code.
    st.label('perm', codex ? tr('Aprovações') : tr('Permissões'));
    st.set('perm', a.kind !== 'main' ? null : codex ? (a.permissionMode ? codexApprovalLabel(a.permissionMode) : null) : permissionLabel(a.permissionMode));

    setText(this.sessionValue, a.sessionId);
    setTitle(this.sessionValue, a.sessionId);
    st.set('start', formatDateTime(a.startedAt));
    st.set('duration', formatDuration(now - a.startedAt));
    st.set('bg', a.background ? tr('Em segundo plano') : null);
  }
}

type StatKey = 'tools' | 'tokensIn' | 'tokensOut' | 'cost' | 'lines' | 'subs' | 'model' | 'branch' | 'perm' | 'session' | 'start' | 'duration' | 'bg';

/** Lista chave/valor de linhas fixas: cada linha é criada uma vez e só tem o texto/visibilidade atualizados. */
class KvList<K extends string> {
  readonly el: HTMLElement;
  private rows = new Map<K, { dt: HTMLElement; dd: HTMLElement }>();

  constructor(defs: readonly [K, string, Node?][]) {
    this.el = h('dl', { class: 'ui-kv ui-stats' });
    for (const [key, label, content] of defs) {
      const dt = h('dt', { text: label });
      const dd = h('dd');
      if (content) dd.append(content);
      this.rows.set(key, { dt, dd });
      this.el.append(dt, dd);
    }
  }

  /** Troca o rótulo da linha (ex.: "Aprovações" no Codex). */
  label(key: K, text: string): void {
    setText(this.rows.get(key)!.dt, text);
  }

  /** Define o texto da linha; `null` oculta a linha. */
  set(key: K, value: string | null): void {
    const r = this.rows.get(key)!;
    this.show(key, value !== null);
    if (value !== null) setText(r.dd, value);
  }

  show(key: K, visible: boolean): void {
    const r = this.rows.get(key)!;
    setHidden(r.dt, !visible);
    setHidden(r.dd, !visible);
  }
}

// ---------------------------------------------------------------- visão da sala

class RoomView {
  readonly el: HTMLElement;
  private id = '';
  private last: RoomInfo | null = null;
  private swatch: HTMLElement;
  private name: HTMLElement;
  private renameBtn: HTMLButtonElement;
  private path: HTMLElement;
  private gone: HTMLElement;
  private accs: KeyedList<string>;
  private agents: KeyedList<AgentInfo>;
  private agentsSec: ReturnType<typeof section>;
  private agentsEmpty: HTMLElement;
  private tasksSec: ReturnType<typeof section>;
  private tasksBar: HTMLElement;
  private tasks: KeyedList<{ task: TaskItem; owner: string; key: string }>;
  private feed: KeyedList<FeedItem>;
  private feedSec: ReturnType<typeof section>;
  private newBtn: HTMLButtonElement;
  private newMsg: HTMLElement;

  constructor(
    private ctx: UiContext,
    private pty: PtyControl,
  ) {
    this.newBtn = h('button', { class: 'ui-btn', type: 'button', text: tr('Nova sessão'), title: tr('Abre um Claude Code novo nesta pasta, num terminal interativo'), on: { click: () => this.newSession() } });
    this.newMsg = h('p', { class: 'ui-actions__msg is-error', role: 'status', hidden: true });
    this.swatch = h('span', { class: 'ui-room-hero__swatch', attrs: { 'aria-hidden': 'true' } });
    this.name = h('h2', { class: 'ui-hero__name' });
    // Lápis: o mesmo campo do botão direito na sala (ui/roomrename.ts), aberto embaixo do nome.
    this.renameBtn = iconButton(
      ICONS.pencil,
      tr('Renomear sala'),
      () => {
        const r = this.name.getBoundingClientRect();
        ctx.renameRoom?.(this.id, { x: r.left, y: r.bottom + 6 });
      },
      'ui-icon-btn--sm ui-room-hero__rename',
    );
    this.path = h('span', { class: 'ui-room-hero__path' });
    const centerBtn = h('button', { class: 'ui-btn', type: 'button', title: tr('Levar a câmera até a sala'), on: { click: () => ctx.focusSelection() } });
    centerBtn.innerHTML = ICONS.center;
    centerBtn.append(h('span', { text: tr('Centralizar') }));
    this.gone = h('p', { class: 'ui-gone', text: tr('Esta sala foi fechada: todos os agentes saíram.'), hidden: true });

    const accsEl = h('div', { class: 'ui-acc-list' });
    this.accs = new KeyedList<string>(accsEl, {
      animate: false,
      key: (id) => id,
      create: () => h('span', { class: 'ui-acc-item' }, createAccountChip('sm'), h('span')),
      update: (el, id) => {
        const acc = ctx.account(id);
        updateAccountChip(el.firstElementChild as HTMLElement, acc, id);
        // "Conta C · dev@x.com"; no Codex, "Codex · plano Team".
        setText(el.lastElementChild!, accountChipLabel(acc, id, accountProvider(acc, id)).replace(/ \((.+)\)$/, ' · $1'));
      },
    });

    const agentsList = h('div', { class: 'ui-team' });
    this.agentsEmpty = h('p', { class: 'ui-muted ui-small', text: tr('Ninguém na sala agora.') });
    this.agentsSec = section(tr('Agentes'), agentsList, this.agentsEmpty);
    this.agents = new KeyedList<AgentInfo>(agentsList, {
      key: (a) => a.id,
      create: (a) => createAgentRow(a, (id) => ctx.select({ type: 'agent', id }, { focus: true }), 'sm'),
      update: (row, a) => updateAgentRow(row, a, ctx.account(a.account), false, ctx.now(), ctx.store.snapshot?.agents),
    });

    this.tasksBar = createProgress(tr('Progresso das tarefas da sala'));
    const tasksList = h('ul', { class: 'ui-tasks' });
    this.tasksSec = section(tr('Tarefas'), this.tasksBar, tasksList);
    this.tasks = new KeyedList(tasksList, { key: (t) => t.key, create: createTaskItem, update: (li, t) => updateTaskItem(li, t.task, t.owner) });

    const feedList = h('ol', { class: 'ui-timeline' });
    this.feedSec = section(tr('Atividade recente'), feedList);
    this.feed = new KeyedList<FeedItem>(feedList, { key: (f) => f.id, create: createTimelineItem, update: (li, f) => updateTimelineItem(li, f.activity, ctx.now(), f.agentName) });

    this.el = h(
      'div',
      { class: 'ui-drawer__view ui-room-view' },
      h(
        'div',
        { class: 'ui-room-hero' },
        this.swatch,
        h('div', { class: 'ui-hero__text' }, h('div', { class: 'ui-room-hero__title' }, this.name, this.renameBtn), h('span', { class: 'ui-copy-row' }, this.path, copyButton(() => this.last?.path ?? '', tr('Copiar caminho')))),
      ),
      this.gone,
      h('div', { class: 'ui-status' }, accsEl, h('span', { class: 'ui-status__actions' }, this.newBtn, centerBtn)),
      this.newMsg,
      this.agentsSec.el,
      this.tasksSec.el,
      this.feedSec.el,
    );
  }

  get roomId(): string {
    return this.id;
  }

  /** Sessão nova na pasta da sala, na conta de quem estiver nela (ou na padrão). */
  private newSession(): void {
    const r = this.last;
    if (!r) return;
    // Só conta do Claude Code (nem Codex nem demo); sem nenhuma na sala, o servidor usa a padrão.
    const account = (this.ctx.store.snapshot?.agents ?? []).find((a) => a.roomId === r.id && ptyControllable(a))?.account;
    setHidden(this.newMsg, true);
    this.pty.newSession(r.path, account).catch((err: Error) => {
      setText(this.newMsg, tr('Não deu: {0}', [err.message]));
      setHidden(this.newMsg, false);
    });
  }

  open(id: string): void {
    if (this.id === id) return;
    this.id = id;
    this.last = null;
    this.agents.clear();
    this.tasks.clear();
    this.feed.clear();
  }

  render(): void {
    const live = this.ctx.store.room(this.id);
    if (live) this.last = live;
    const r = this.last;
    if (!r) return;
    setText(this.name, r.name);
    setText(this.path, shortPath(r.path));
    setTitle(this.path, r.path);
    try {
      setStyleVar(this.swatch, '--room', roomTheme(r.seed).accent);
    } catch {
      // Sem tema: cor padrão.
    }
    setHidden(this.gone, !!live);
    setHidden(this.renameBtn, !live || !canRenameRoom(this.ctx, r.id));
    setHidden(this.newBtn, !this.pty.enabled);

    const snap = this.ctx.store.snapshot;
    const agents = (snap?.agents ?? []).filter((a) => a.roomId === r.id);
    this.accs.sync(accountsOf(agents, snap?.accounts ?? []));
    const ordered = sortByUrgency(agents);
    setText(this.agentsSec.extra, agents.length ? String(agents.length) : '');
    setHidden(this.agentsEmpty, agents.length > 0);
    this.agents.sync(ordered);

    const tp = aggregateTasks(agents);
    setHidden(this.tasksSec.el, tp.total === 0);
    updateProgress(this.tasksBar, tp.completed, tp.total, tp.inProgress);
    setText(this.tasksSec.extra, `${tp.completed}/${tp.total}`);
    this.tasks.sync(agents.flatMap((a) => a.tasks.map((task) => ({ task, owner: a.name, key: `${a.id}#${task.id}` }))));

    const feed = this.ctx.store.feed.filter((f) => f.roomId === r.id).slice(-ROOM_FEED_LIMIT).reverse();
    setHidden(this.feedSec.el, feed.length === 0);
    this.feed.sync(feed);
  }
}

// ---------------------------------------------------------------- gaveta

export class Drawer implements UiComponent {
  readonly el: HTMLElement;
  private body: HTMLElement;
  private agentView: AgentView;
  private roomView: RoomView;
  private mode: 'agent' | 'room' | null = null;
  private heading: HTMLElement;
  private movable: Movable;
  /** Avisado quando a gaveta é solta ou volta ao lugar (a área livre do escritório muda). */
  onLayoutChange: (() => void) | null = null;

  constructor(
    private ctx: UiContext,
    terminal: TerminalControl,
    pty: PtyControl,
  ) {
    this.agentView = new AgentView(ctx, terminal, pty);
    this.roomView = new RoomView(ctx, pty);
    this.heading = h('span', { class: 'ui-drawer__kind' });
    const close = iconButton(ICONS.close, tr('Fechar detalhes (Esc)'), () => ctx.select(null));
    this.body = h('div', { class: 'ui-drawer__body' });
    const bar = h('div', { class: 'ui-drawer__bar' }, this.heading, close);
    this.el = h(
      'aside',
      { class: 'ui-panel ui-drawer', attrs: { 'aria-label': tr('Detalhes'), id: 'ui-drawer', 'aria-hidden': 'true' } },
      bar,
      this.body,
    );
    // Arrastar pela barra solta a gaveta: flutuante, ela não cobre mais a lateral do escritório.
    this.movable = new Movable(this.el, bar, { key: 'habblaud.move.drawer', enabled: () => !ctx.isNarrow(), onChange: () => this.onLayoutChange?.() });
    this.el.inert = true;
  }

  get isOpen(): boolean {
    return this.mode !== null;
  }

  /** Solta do lugar (arrastada pela barra). */
  get floating(): boolean {
    return this.movable.floating;
  }

  toggleFollow(): void {
    if (this.mode === 'agent') this.agentView.toggleFollow();
  }

  render(): void {
    const sel = this.ctx.selection();
    const mode = sel?.type ?? null;
    if (mode !== this.mode) {
      // Gaveta fechada ou fora do agente: o editor fecha, e ao reabrir começa do estado atual do agente.
      if (this.mode === 'agent') this.agentView.character.close();
      this.mode = mode;
      this.body.replaceChildren(...(mode === 'agent' ? [this.agentView.el] : mode === 'room' ? [this.roomView.el] : []));
      this.body.scrollTop = 0;
      this.el.classList.toggle('is-open', mode !== null);
      setAttr(this.el, 'aria-hidden', mode ? 'false' : 'true');
      this.el.inert = mode === null;
    }
    if (sel?.type === 'agent') {
      if (this.agentView.agentId !== sel.id) this.body.scrollTop = 0;
      this.agentView.open(sel.id);
      setText(this.heading, this.ctx.agent(sel.id)?.kind === 'sub' ? tr('Subagente') : tr('Agente'));
      this.agentView.render();
    } else if (sel?.type === 'room') {
      if (this.roomView.roomId !== sel.id) this.body.scrollTop = 0;
      this.roomView.open(sel.id);
      setText(this.heading, tr('Sala'));
      this.roomView.render();
    }
  }
}
