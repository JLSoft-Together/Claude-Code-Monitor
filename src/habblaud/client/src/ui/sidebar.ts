// Barra lateral: busca, filtro por conta e a lista de salas -> agentes -> subagentes.
import type { AccountInfo, AgentInfo } from '../../../shared/types';
import { roomTheme } from '../art';
import type { UiComponent, UiContext } from './context';
import { moveAgent, orderAgents } from './agentorder';
import { moveRoom, orderRooms } from './roomorder';
import { h, iconButton, KeyedList, setAttr, setHidden, setStyleVar, setText, setTitle } from './dom';
import { plural, shortPath } from './format';
import { ICONS } from './icons';
import { groupRooms, type AgentNode, type RoomGroup } from './model';
import { officeIsEmpty } from './overlays';
import { createAgentRow, updateAgentRow } from './rows';
import { createAccountChip, createProgress, updateAccountChip, updateProgress } from './widgets';
import { tr } from '../../../shared/i18n';

interface RoomRefs {
  head: HTMLButtonElement;
  name: HTMLElement;
  count: HTMLElement;
  path: HTMLElement;
  accs: KeyedList<AccountInfo | string>;
  tasks: HTMLElement;
  tasksBar: HTMLElement;
  tasksText: HTMLElement;
  nodes: KeyedList<AgentNode>;
}

interface NodeRefs {
  row: HTMLButtonElement;
  /** Atalho para a janela de terminal do agente. */
  term: HTMLButtonElement;
  /** Linha + atalho: arrastável para reordenar os agentes da sala. */
  head: HTMLElement;
  subsWrap: HTMLElement;
  subsCaption: HTMLElement;
  subs: KeyedList<AgentInfo>;
}

export class Sidebar implements UiComponent {
  readonly el: HTMLElement;
  private input: HTMLInputElement;
  private query = '';
  private filters: HTMLElement;
  private filterList: KeyedList<AccountInfo, HTMLButtonElement>;
  private scroller: HTMLElement;
  private rooms: KeyedList<RoomGroup>;
  private roomRefs = new WeakMap<HTMLElement, RoomRefs>();
  private nodeRefs = new WeakMap<HTMLElement, NodeRefs>();
  /** Agentes de cada sala na ordem mostrada (para arrastar e soltar). */
  private shown = new Map<string, AgentNode[]>();
  private dragging: { id: string; room: string } | null = null;
  /** Sala sendo arrastada (reordenar as salas) e a ordem mostrada agora. */
  private draggingRoom: string | null = null;
  private shownRooms: string[] = [];
  private empty: HTMLElement;
  private emptyText: HTMLElement;
  private clearBtn: HTMLButtonElement;
  private lastSelKey = '';

  constructor(private ctx: UiContext) {
    this.input = h('input', {
      class: 'ui-search__input',
      type: 'search',
      attrs: { placeholder: tr('Buscar agente, projeto ou conta'), 'aria-label': tr('Buscar agente, projeto ou conta'), autocomplete: 'off', spellcheck: 'false' },
    });
    this.input.addEventListener('input', () => {
      this.query = this.input.value;
      this.ctx.invalidate();
    });
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        if (this.input.value) {
          this.input.value = '';
          this.query = '';
          this.ctx.invalidate();
        } else {
          this.input.blur();
        }
      }
    });
    const searchIcon = h('span', { class: 'ui-search__icon', attrs: { 'aria-hidden': 'true' } });
    searchIcon.innerHTML = ICONS.search;
    const search = h('label', { class: 'ui-search' }, searchIcon, this.input, h('kbd', { class: 'ui-kbd', text: '/', title: tr('Atalho: /') }));

    this.filters = h('div', { class: 'ui-acc-filters', role: 'group', attrs: { 'aria-label': tr('Filtrar por conta') } });
    this.filterList = new KeyedList<AccountInfo, HTMLButtonElement>(this.filters, {
      animate: false,
      key: (a) => a.id,
      create: (a) => {
        const chip = createAccountChip('sm');
        const b = h('button', { class: 'ui-acc-filter', type: 'button' }, chip, h('span', { class: 'ui-acc-filter__name' }));
        b.addEventListener('click', () => this.toggleAccount(a.id));
        return b;
      },
      update: (b, a) => {
        const hidden = this.ctx.prefs.hiddenAccounts.includes(a.id);
        updateAccountChip(b.firstElementChild as HTMLElement, a);
        setText(b.lastElementChild!, a.name);
        setAttr(b, 'aria-pressed', String(!hidden));
        setTitle(b, hidden ? tr('Mostrar a {0} na lista, no feed e nos avisos', [a.name]) : tr('Ocultar a {0} na lista, no feed e nos avisos (o escritório continua mostrando todos)', [a.name]));
        b.classList.toggle('is-off', hidden);
      },
    });

    this.scroller = h('div', { class: 'ui-side__scroll' });
    const list = h('div', { class: 'ui-rooms', role: 'list', attrs: { 'aria-label': tr('Salas') } });
    this.scroller.append(list);
    this.rooms = new KeyedList<RoomGroup>(list, {
      key: (g) => g.room.id,
      create: (g) => this.createRoom(g),
      update: (el, g) => this.updateRoom(el, g),
    });

    this.emptyText = h('p');
    this.clearBtn = h('button', {
      class: 'ui-link-btn',
      type: 'button',
      text: tr('Limpar filtros'),
      on: {
        click: () => {
          this.input.value = '';
          this.query = '';
          this.ctx.updatePrefs({ hiddenAccounts: [] });
        },
      },
    });
    this.empty = h('div', { class: 'ui-side__empty', hidden: true }, this.emptyText, this.clearBtn);
    this.scroller.append(this.empty);

    const close = iconButton(ICONS.close, tr('Fechar painel lateral'), () => ctx.togglePanel('sidebar', false), 'ui-side__close');
    this.el = h(
      'aside',
      { class: 'ui-panel ui-sidebar', attrs: { 'aria-label': tr('Salas e agentes'), id: 'ui-sidebar' } },
      h('div', { class: 'ui-side__head' }, h('div', { class: 'ui-side__title' }, h('h2', { text: tr('Escritório') }), close), search, this.filters),
      this.scroller,
    );
  }

  focusSearch(): void {
    this.input.focus();
    this.input.select();
  }

  render(): void {
    const snap = this.ctx.store.snapshot;
    const accounts = snap?.accounts ?? [];
    const hidden = new Set(this.ctx.prefs.hiddenAccounts);
    this.filterList.sync(accounts.length > 1 ? accounts : []);
    setHidden(this.filters, accounts.length <= 1);

    // Ordem das salas escolhida pelo usuário (arrastando o cabeçalho da sala).
    const groups = orderRooms(groupRooms(snap, { query: this.query, hiddenAccounts: hidden }), (g) => g.room.id);
    this.shownRooms = groups.map((g) => g.room.id);
    this.rooms.sync(groups);

    const filtering = this.query.trim().length > 0 || hidden.size > 0;
    const total = snap?.agents.length ?? 0;
    // Escritório vazio sem filtro: o cartão central já explica; a lista não repete o aviso.
    const showEmpty = groups.length === 0 && (filtering || !officeIsEmpty(this.ctx));
    setHidden(this.empty, !showEmpty);
    if (showEmpty) {
      setText(
        this.emptyText,
        filtering && total > 0
          ? this.query.trim()
            ? tr('Nenhum agente encontrado para “{0}”.', [this.query.trim()])
            : tr('Nenhum agente nas contas selecionadas.')
          : tr('Nenhuma sessão aberta no momento.'),
      );
      setHidden(this.clearBtn, !(filtering && total > 0));
    }

    // Ao mudar a seleção (ex.: clique no canvas), traz o item para a área visível.
    const sel = this.ctx.selection();
    const selKey = sel ? `${sel.type}:${sel.id}` : '';
    if (selKey !== this.lastSelKey) {
      this.lastSelKey = selKey;
      if (sel) {
        const target =
          sel.type === 'agent'
            ? this.el.querySelector<HTMLElement>(`.ui-agent[data-id="${CSS.escape(sel.id)}"]`)
            : this.el.querySelector<HTMLElement>(`.ui-room[data-key="${CSS.escape(sel.id)}"] .ui-room__head`);
        target?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    }
  }

  private toggleAccount(id: string): void {
    const set = new Set(this.ctx.prefs.hiddenAccounts);
    if (set.has(id)) set.delete(id);
    else set.add(id);
    this.ctx.updatePrefs({ hiddenAccounts: [...set] });
  }

  // ---------------------------------------------------------------- salas

  private createRoom(g: RoomGroup): HTMLElement {
    const name = h('span', { class: 'ui-room__name' });
    const count = h('span', { class: 'ui-room__count' });
    const accsEl = h('span', { class: 'ui-room__accs' });
    const path = h('span', { class: 'ui-room__path' });
    const tasksBar = createProgress(tr('Progresso das tarefas da sala'));
    const tasksText = h('span', { class: 'ui-room__tasks-text' });
    const tasks = h('span', { class: 'ui-room__tasks' }, tasksBar, tasksText);
    const swatch = h('span', { class: 'ui-room__swatch', attrs: { 'aria-hidden': 'true' } });
    const head = h(
      'button',
      { class: 'ui-room__head', type: 'button' },
      swatch,
      h('span', { class: 'ui-room__line' }, name, count, accsEl),
      path,
      tasks,
    );
    head.addEventListener('click', () => this.ctx.select({ type: 'room', id: g.room.id }, { focus: true }));
    this.wireRoomDrag(head, g.room.id);
    // Botão direito: renomear a sala (ui/roomrename.ts).
    head.addEventListener('contextmenu', (e) => {
      if (!this.ctx.renameRoom) return;
      e.preventDefault();
      const r = head.getBoundingClientRect();
      this.ctx.renameRoom(g.room.id, { x: r.left + 12, y: r.bottom + 4 });
    });
    try {
      setStyleVar(head, '--room', roomTheme(g.room.seed).accent);
    } catch {
      // Sem tema: mantém a cor padrão do CSS.
    }
    const agentsEl = h('ul', { class: 'ui-nodes' });
    const section = h('section', { class: 'ui-room', role: 'listitem' }, head, agentsEl);
    const accs = new KeyedList<AccountInfo | string>(accsEl, {
      animate: false,
      key: (a) => (typeof a === 'string' ? a : a.id),
      create: () => createAccountChip('sm'),
      update: (chip, a) => (typeof a === 'string' ? updateAccountChip(chip, undefined, a) : updateAccountChip(chip, a)),
    });
    const nodes = new KeyedList<AgentNode>(agentsEl, {
      key: (n) => n.agent.id,
      create: (n) => this.createNode(n),
      update: (el, n) => this.updateNode(el, n),
    });
    this.roomRefs.set(section, { head, name, count, path, accs, tasks, tasksBar, tasksText, nodes });
    return section;
  }

  private updateRoom(section: HTMLElement, g: RoomGroup): void {
    const r = this.roomRefs.get(section)!;
    const sel = this.ctx.selection();
    setText(r.name, g.room.name);
    const present = g.agents.filter((a) => a.status !== 'offline').length;
    setText(r.count, String(present));
    setTitle(r.count, plural(present, tr('agente'), tr('agentes')));
    setText(r.path, shortPath(g.room.path));
    setTitle(r.head, tr('{0}\nClique para ver a sala', [g.room.path]));
    setAttr(r.head, 'aria-label', tr('Sala {0}, {1}', [g.room.name, plural(present, tr('agente'), tr('agentes'))]));
    r.accs.sync(g.accounts.map((id) => this.ctx.account(id) ?? id));
    const selected = sel?.type === 'room' && sel.id === g.room.id;
    r.head.classList.toggle('is-selected', selected);
    setAttr(r.head, 'aria-current', selected ? 'true' : null);
    section.classList.toggle('is-empty', present === 0);

    const t = g.tasks;
    setHidden(r.tasks, t.total === 0);
    if (t.total > 0) {
      updateProgress(r.tasksBar, t.completed, t.total, t.inProgress);
      setText(r.tasksText, tr('{0}/{1} tarefas', [t.completed, t.total]));
    }
    // Ordem escolhida pelo usuário (arrastando as linhas), guardada no navegador.
    const ordered = orderAgents(g.room.id, g.nodes, (n) => n.agent.sessionId);
    this.shown.set(g.room.id, ordered);
    r.nodes.sync(ordered);
  }

  /** Arrastar o cabeçalho de uma sala reordena as salas da lista. */
  private wireRoomDrag(head: HTMLElement, roomId: string): void {
    head.draggable = true;
    const after = (e: DragEvent) => {
      const rect = head.getBoundingClientRect();
      return e.clientY > rect.top + rect.height / 2;
    };
    const clear = () => {
      for (const el of this.el.querySelectorAll('.ui-room__head.is-drop-before, .ui-room__head.is-drop-after')) el.classList.remove('is-drop-before', 'is-drop-after');
    };
    head.addEventListener('dragstart', (e) => {
      this.draggingRoom = roomId;
      head.classList.add('is-dragging');
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', roomId);
      }
    });
    head.addEventListener('dragend', () => {
      this.draggingRoom = null;
      head.classList.remove('is-dragging');
      clear();
    });
    head.addEventListener('dragover', (e) => {
      const from = this.draggingRoom;
      if (!from || from === roomId) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
      clear();
      head.classList.add(after(e) ? 'is-drop-after' : 'is-drop-before');
    });
    head.addEventListener('dragleave', () => head.classList.remove('is-drop-before', 'is-drop-after'));
    head.addEventListener('drop', (e) => {
      const from = this.draggingRoom;
      clear();
      if (!from || from === roomId) return;
      e.preventDefault();
      if (moveRoom(this.shownRooms, from, roomId, after(e))) this.ctx.invalidate();
    });
  }

  /** Arrastar a linha de um agente principal reordena os agentes da mesma sala. */
  private wireDrag(head: HTMLElement): void {
    head.draggable = true;
    const id = () => head.dataset.id ?? '';
    const room = () => head.dataset.room ?? '';
    const after = (e: DragEvent) => {
      const rect = head.getBoundingClientRect();
      return e.clientY > rect.top + rect.height / 2;
    };
    const clear = () => {
      for (const el of this.el.querySelectorAll('.ui-node__head.is-drop-before, .ui-node__head.is-drop-after')) el.classList.remove('is-drop-before', 'is-drop-after');
    };
    head.addEventListener('dragstart', (e) => {
      this.dragging = { id: id(), room: room() };
      head.classList.add('is-dragging');
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', id());
      }
    });
    head.addEventListener('dragend', () => {
      this.dragging = null;
      head.classList.remove('is-dragging');
      clear();
    });
    head.addEventListener('dragover', (e) => {
      const d = this.dragging;
      if (!d || d.room !== room() || d.id === id()) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
      clear();
      head.classList.add(after(e) ? 'is-drop-after' : 'is-drop-before');
    });
    head.addEventListener('dragleave', () => head.classList.remove('is-drop-before', 'is-drop-after'));
    head.addEventListener('drop', (e) => {
      const d = this.dragging;
      clear();
      if (!d || d.room !== room() || d.id === id()) return;
      e.preventDefault();
      const shown = this.shown.get(d.room) ?? [];
      if (moveAgent(d.room, shown, (n) => n.agent.id, (n) => n.agent.sessionId, d.id, id(), after(e))) this.ctx.invalidate();
    });
  }

  // ---------------------------------------------------------------- agentes

  private createNode(n: AgentNode): HTMLElement {
    const row = createAgentRow(n.agent, (id) => this.pick(id));
    const subsCaption = h('span', { class: 'ui-subs__caption' });
    const subsList = h('ul', { class: 'ui-subs__list' });
    const subsWrap = h('div', { class: 'ui-subs', hidden: true }, subsCaption, subsList);
    // Botão irmão da linha (não dentro dela: botão dentro de botão não vale), sobre o status à direita: aparece com
    // o mouse em cima (ou foco) e fica aceso enquanto o terminal do agente estiver aberto.
    const term = h('button', { class: 'ui-node__term', type: 'button' });
    term.innerHTML = ICONS.terminal;
    term.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = row.dataset.id;
      if (id) this.ctx.terminals?.toggle(id, term);
    });
    const head = h('div', { class: 'ui-node__head' }, row, term);
    this.wireDrag(head);
    const li = h('li', { class: 'ui-node' }, head, subsWrap);
    const subs = new KeyedList<AgentInfo>(subsList, {
      key: (a) => a.id,
      create: (a) => h('li', { class: 'ui-subs__item' }, createAgentRow(a, (id) => this.pick(id), 'sm')),
      update: (li2, a) => this.updateRow(li2.firstElementChild as HTMLElement, a),
    });
    this.nodeRefs.set(li, { row, head, term, subsWrap, subsCaption, subs });
    return li;
  }

  private updateNode(li: HTMLElement, n: AgentNode): void {
    const r = this.nodeRefs.get(li)!;
    this.updateRow(r.row, n.agent);
    r.head.dataset.id = n.agent.id;
    r.head.dataset.room = n.agent.roomId;
    const router = this.ctx.terminals;
    const a = n.agent;
    const canTerm = !!router?.available && a.status !== 'offline';
    setHidden(r.term, !canTerm);
    if (canTerm && router) {
      const open = router.openAgentId === a.id;
      const live = router.interactive(a.id);
      r.term.classList.toggle('is-on', open);
      r.term.classList.toggle('is-live', live);
      const what = live ? tr('interativo') : tr('ao vivo');
      setTitle(r.term, open ? tr('Fechar o terminal') : tr('Abrir o terminal de {0} ({1})', [a.name, what]));
      setAttr(r.term, 'aria-label', open ? tr('Fechar o terminal de {0}', [a.name]) : tr('Abrir o terminal de {0}', [a.name]));
    }
    const has = n.subTotal > 0;
    setHidden(r.subsWrap, !has);
    if (has) {
      const shown = n.subs.length;
      setText(r.subsCaption, shown === n.subTotal ? plural(n.subTotal, tr('subagente'), tr('subagentes')) : `${shown} de ${plural(n.subTotal, tr('subagente'), tr('subagentes'))}`);
    }
    r.subs.sync(n.subs);
  }

  private updateRow(row: HTMLElement, a: AgentInfo): void {
    const sel = this.ctx.selection();
    updateAgentRow(row, a, this.ctx.account(a.account), sel?.type === 'agent' && sel.id === a.id, this.ctx.now(), this.ctx.store.snapshot?.agents);
  }

  private pick(id: string): void {
    this.ctx.select({ type: 'agent', id }, { focus: true });
    // Com um terminal aberto, clicar noutro agente troca o terminal para o dele.
    const t = this.ctx.terminals;
    if (t && t.openAgentId !== null && t.openAgentId !== id && this.ctx.agent(id)) t.open(id);
    if (this.ctx.isNarrow()) this.ctx.togglePanel('sidebar', false);
  }
}
