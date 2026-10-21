// Feed de atividade (painel inferior recolhível): últimos eventos do escritório, do mais antigo ao mais recente.
import { partsKey } from '../../../shared/appearance';
import type { AgentInfo, FeedItem } from '../../../shared/types';
import { createAvatar, createAvatarPlaceholder, updateAvatar } from './avatar';
import type { UiComponent, UiContext } from './context';
import { h, KeyedList, setAttr, setHidden, setText, setTitle } from './dom';
import { formatClock } from './format';
import { ICONS } from './icons';
import { shellDoneKind } from './model';
import { officeIsEmpty } from './overlays';
import { createAccountChip, updateAccountChip } from './widgets';
import { tr } from '../../../shared/i18n';

const VISIBLE = 50;

type AgentMeta = Pick<AgentInfo, 'seed' | 'look' | 'kind' | 'account' | 'parts'>;

export class FeedPanel implements UiComponent {
  readonly el: HTMLElement;
  private list: HTMLElement;
  private rows: KeyedList<FeedItem>;
  private items: FeedItem[] = [];
  private pending: FeedItem[] = [];
  private pendingCounts = new Map<string | undefined, number>();
  private hovering = false;
  private scrolledUp = false;
  private newPill: HTMLButtonElement;
  private ticker: HTMLElement;
  private toggleBtn: HTMLButtonElement;
  private empty: HTMLElement;
  private filterNote: HTMLElement;
  /** Aparência/conta dos agentes com eventos guardados (o feed sobrevive à saída do agente). */
  private meta = new Map<string, AgentMeta>();

  constructor(private ctx: UiContext) {
    this.list = h('ol', { class: 'ui-feed__list', role: 'log', attrs: { 'aria-label': tr('Eventos recentes'), 'aria-live': 'off' } });
    this.rows = new KeyedList<FeedItem>(this.list, {
      key: (f) => f.id,
      create: (f) => this.createRow(f),
      update: (li, f) => this.updateRow(li, f),
    });
    this.empty = h('p', { class: 'ui-feed__empty', text: tr('Os eventos dos agentes aparecem aqui assim que acontecem.') });
    this.newPill = h('button', { class: 'ui-feed__new', type: 'button', hidden: true, on: { click: () => this.resume() } });
    this.ticker = h('span', { class: 'ui-feed__ticker', attrs: { 'aria-hidden': 'true' } });
    this.filterNote = h('span', { class: 'ui-feed__filter', hidden: true });
    this.toggleBtn = h('button', { class: 'ui-icon-btn ui-icon-btn--sm', type: 'button', on: { click: () => ctx.togglePanel('feed') } });
    const scroller = h('div', { class: 'ui-feed__scroll' }, this.list, this.empty);
    scroller.addEventListener('scroll', () => {
      this.scrolledUp = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight > 24;
      if (!this.scrolledUp && !this.hovering) this.flushSoon();
    });
    this.el = h(
      'section',
      { class: 'ui-panel ui-feed', attrs: { 'aria-label': tr('Feed de atividade'), id: 'ui-feed' } },
      h(
        'div',
        { class: 'ui-feed__head' },
        h('button', { class: 'ui-feed__title', type: 'button', on: { click: () => ctx.togglePanel('feed') } }, h('h2', { text: tr('Atividade') }), this.filterNote, this.ticker),
        this.newPill,
        this.toggleBtn,
      ),
      scroller,
    );
    // Pausa a rolagem enquanto o mouse está sobre a lista.
    scroller.addEventListener('mouseenter', () => (this.hovering = true));
    scroller.addEventListener('mouseleave', () => {
      this.hovering = false;
      this.flushSoon();
    });

    ctx.store.on('feed', (fresh) => {
      this.appendPending(fresh);
      ctx.invalidate();
    });
    this.appendPending(ctx.store.feed.slice(-VISIBLE));
    // Partidas e apostas resolvidas no escritório (vida social) entram no feed como eventos locais.
    ctx.world.onSocialEvent?.((e) => {
      const a = ctx.agent(e.agentId);
      if (!a) return;
      this.appendPending([{
        id: e.id,
        agentId: a.id,
        roomId: a.roomId,
        agentName: a.name,
        roomName: e.place,
        account: a.account,
        activity: { id: e.id, kind: 'other', icon: e.icon, text: e.text, at: e.at },
      }]);
      ctx.invalidate();
    });
  }

  render(): void {
    for (const a of this.ctx.store.snapshot?.agents ?? []) {
      const m = this.meta.get(a.id);
      if (!m || m.seed !== a.seed || m.account !== a.account || partsKey(m.parts) !== partsKey(a.parts)) {
        this.meta.set(a.id, { seed: a.seed, look: a.look, kind: a.kind, account: a.account, parts: a.parts });
      }
    }
    const open = this.ctx.isPanelOpen('feed');
    const paused = this.hovering || this.scrolledUp;
    if (this.pending.length && (!paused || !open)) this.flush();
    this.pruneMeta();

    // Filtro por conta da barra lateral: também vale para o feed.
    const hidden = this.ctx.prefs.hiddenAccounts;
    const filtering = hidden.length > 0;
    const visible = filtering ? this.items.filter((f) => this.visible(f)) : this.items;
    const pending = filtering ? this.pending.filter((f) => this.visible(f)) : this.pending;
    let newCount = 0;
    for (const [account, count] of this.pendingCounts) if (!account || !hidden.includes(account)) newCount += count;
    setHidden(this.newPill, !(paused && newCount > 0 && open));
    if (newCount) setText(this.newPill, newCount === 1 ? tr('1 nova') : tr('{0} novas', [Math.min(newCount, 99)]));
    // Escritório vazio: o cartão central já explica; o feed só mostra o que houver de antes.
    setHidden(this.empty, visible.length > 0 || officeIsEmpty(this.ctx));
    setText(
      this.empty,
      filtering && this.items.length > 0 ? tr('Nenhum evento das contas selecionadas.') : tr('Os eventos dos agentes aparecem aqui assim que acontecem.'),
    );
    setHidden(this.filterNote, !filtering);
    if (filtering) {
      const names = hidden.map((id) => this.ctx.account(id)?.name ?? id);
      setText(this.filterNote, 'filtrado');
      setTitle(this.filterNote, tr('Sem {0} (filtro da barra lateral)', [names.join(', ')]));
    }

    const latest = pending[pending.length - 1] ?? visible[visible.length - 1];
    setText(this.ticker, latest ? `${latest.agentName}: ${latest.activity.icon} ${latest.activity.text}` : '');
    this.toggleBtn.innerHTML = open ? ICONS.chevronDown : ICONS.chevronUp;
    const label = open ? tr('Recolher feed ( ] )') : tr('Abrir feed ( ] )');
    setAttr(this.toggleBtn, 'aria-label', label);
    setTitle(this.toggleBtn, label);
    setAttr(this.toggleBtn, 'aria-expanded', String(open));

    // Contas podem ter mudado de cor/nome (ou o filtro mudou): atualiza as linhas visíveis.
    if (open) this.rows.sync(visible);
  }

  /** Conta do evento: a do próprio item (servidor novo) ou a do agente, se já apareceu. */
  private accountOf(f: FeedItem): string | undefined {
    return f.account ?? this.meta.get(f.agentId)?.account ?? this.ctx.agent(f.agentId)?.account;
  }

  private visible(f: FeedItem): boolean {
    const acc = this.accountOf(f);
    return !acc || !this.ctx.prefs.hiddenAccounts.includes(acc);
  }

  private appendPending(fresh: FeedItem[]): void {
    // A contagem por conta sobrevive ao descarte das pendências mais antigas.
    for (const f of fresh) {
      const account = this.accountOf(f);
      this.pendingCounts.set(account, (this.pendingCounts.get(account) ?? 0) + 1);
    }
    this.pending.push(...fresh.slice(-VISIBLE));
    this.pending = this.pending.slice(-VISIBLE);
    this.pruneMeta();
  }

  /** Esquece quem saiu do escritório e não tem mais evento guardado. */
  private pruneMeta(): void {
    const needed = new Set([...this.items, ...this.pending].map((f) => f.agentId));
    for (const a of this.ctx.store.snapshot?.agents ?? []) needed.add(a.id);
    for (const id of this.meta.keys()) if (!needed.has(id)) this.meta.delete(id);
  }

  private flush(): void {
    const known = new Set(this.items.map((f) => f.id));
    for (const f of this.pending) if (!known.has(f.id)) this.items.push(f);
    this.pending = [];
    this.pendingCounts.clear();
    this.items = this.items.slice(-VISIBLE);
    this.pruneMeta();
    this.rows.sync(this.ctx.prefs.hiddenAccounts.length ? this.items.filter((f) => this.visible(f)) : this.items);
    const scroller = this.list.parentElement!;
    requestAnimationFrame(() => {
      scroller.scrollTop = scroller.scrollHeight;
    });
  }

  private flushSoon(): void {
    this.scrolledUp = false;
    this.ctx.invalidate();
  }

  private resume(): void {
    this.hovering = false;
    this.scrolledUp = false;
    this.flush();
    this.ctx.invalidate();
  }

  private createRow(f: FeedItem): HTMLElement {
    const m = this.meta.get(f.agentId) ?? this.metaFromStore(f.agentId);
    const avatar = m ? createAvatar(m, 'xs') : createAvatarPlaceholder('xs');
    const btn = h(
      'button',
      { class: 'ui-feed__row', type: 'button' },
      h('time', { class: 'ui-feed__time' }),
      avatar,
      h('span', { class: 'ui-feed__who' }),
      createAccountChip('sm'),
      h('span', { class: 'ui-feed__room' }),
      h('span', { class: 'ui-feed__icon', attrs: { 'aria-hidden': 'true' } }),
      h('span', { class: 'ui-feed__text' }),
    );
    btn.addEventListener('click', () => {
      if (this.ctx.agent(f.agentId)) this.ctx.select({ type: 'agent', id: f.agentId }, { focus: true });
      else if (this.ctx.store.room(f.roomId)) this.ctx.select({ type: 'room', id: f.roomId }, { focus: true });
    });
    return h('li', { class: 'ui-feed__item' }, btn);
  }

  private updateRow(li: HTMLElement, f: FeedItem): void {
    const btn = li.firstElementChild as HTMLElement;
    const [time, avatar, who, chip, room, icon, text] = btn.children as unknown as HTMLElement[];
    const m = this.meta.get(f.agentId);
    setText(time, formatClock(f.activity.at));
    setAttr(time, 'datetime', new Date(f.activity.at).toISOString());
    if (m) updateAvatar(avatar, m, 'xs');
    setText(who, f.agentName);
    const acc = this.accountOf(f);
    updateAccountChip(chip, acc ? this.ctx.account(acc) : undefined, acc ?? '');
    setHidden(chip, !acc);
    setText(room, f.roomName);
    setText(icon, f.activity.icon);
    setText(text, f.activity.text);
    li.classList.toggle('is-error', !!f.activity.error);
    li.classList.toggle('is-social', f.id.startsWith('social:'));
    // Fim de um shell (✅ terminou / ❌ falhou ou foi interrompido): linha com destaque próprio.
    const done = shellDoneKind(f.activity);
    li.classList.toggle('is-shell-ok', done === 'ok');
    li.classList.toggle('is-shell-fail', done === 'fail');
    const present = !!this.ctx.agent(f.agentId);
    li.classList.toggle('is-gone', !present);
    setTitle(btn, `${formatClock(f.activity.at)} · ${f.agentName} em ${f.roomName}\n${f.activity.text}${f.activity.detail ? `\n${f.activity.detail}` : ''}`);
  }

  private metaFromStore(id: string): AgentMeta | undefined {
    const a = this.ctx.agent(id);
    if (!a) return undefined;
    const m = { seed: a.seed, look: a.look, kind: a.kind, account: a.account, parts: a.parts };
    this.meta.set(id, m);
    return m;
  }
}
