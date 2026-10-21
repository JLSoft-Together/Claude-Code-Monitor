// "Meu dia": janela com para onde foi o dia — o tempo dos agentes por status, com destaque para o tempo
// esperando você (o gargalo humano), por projeto, por hora e por conta, as maiores esperas, tokens e custo.
// Dados de GET /api/stats (no ?mock=1, do mesmo acumulador de shared/daystats.ts rodando no navegador sobre o
// simulador). Gráficos em DOM puro: barras finas empilhadas, dica no hover e no foco, tabela equivalente em cada
// cartão e legenda que liga e desliga cada status. Aberto no dia de hoje, atualiza a cada 30 s.
// O modelo (destaques, escalas, rótulos) é puro e testado em ui/daystats-model.test.ts.
import {
  dayKeyOf,
  daysFromHours,
  queryDay,
  StatsBook,
  StatsTracker,
  systemTimeZone,
  TIMED_STATUSES,
  type DayStatsResponse,
  type StatsDaysResponse,
  type StatsSource,
  type TimedStatus,
} from '../../../shared/daystats';
import { seedDemoHistory } from '../../../shared/demo/daystats';
import type { OfficeStore } from '../net/store';
import type { UiComponent, UiContext } from './context';
import { h, iconButton, setAttr, setHidden, setStyleVar, setText } from './dom';
import {
  accountCards,
  ALL_VISIBLE,
  axisLabel,
  dayLabel,
  daysUrl,
  formatAgentTime,
  highlights,
  hourColumns,
  isEmptyDay,
  roomRows,
  shouldRefresh,
  STATUS_TEXT,
  statsUrl,
  statusTable,
  visibleTotal,
  waitRows,
  type HourColumn,
  type RoomRow,
} from './daystats-model';
import { formatClock } from './format';
import { ICONS } from './icons';
import { accountProvider } from './provider';
import { tr } from '../../../shared/i18n';

const REFRESH_MS = 30_000;
const NOTE =
  tr('Tempo de agentes é a soma de todos eles: dois agentes trabalhando por 1 hora contam 2 horas. ') +
  tr('“Esperando você” é o tempo de mão levantada no escritório (permissão, pergunta ou escolha). ') +
  tr('O Habblaud só conta o que acontece enquanto ele está rodando.');

/** De onde vêm os números: o servidor ou, no ?mock=1, o acumulador local. */
interface DaySource {
  days(tz: string): Promise<StatsDaysResponse>;
  day(day: string, tz: string, source?: StatsSource): Promise<DayStatsResponse>;
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: 'no-store' });
  const body = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!res.ok || !body) throw new Error(body?.error ?? tr('erro {0}', [res.status]));
  return body;
}

const httpSource: DaySource = {
  days: (tz) => getJson<StatsDaysResponse>(daysUrl(tz)),
  day: (day, tz, source) => getJson<DayStatsResponse>(statsUrl(day, tz, source)),
};

/**
 * ?mock=1: o mesmo rastreador do servidor sobre os snapshots do simulador, com o histórico fictício do demo.
 * Começa a contar quando a página abre (não quando o painel abre).
 */
class LocalSource implements DaySource {
  private readonly tz = systemTimeZone();
  private readonly book = new StatsBook((t) => dayKeyOf(t, this.tz));
  private readonly tracker = new StatsTracker(this.book, { startedAt: Date.now() });
  private seeded = false;
  private last = 0;

  constructor(store: OfficeStore) {
    store.on('snapshot', (snap) => {
      const now = Date.now();
      if (now - this.last < 1_000) return;
      this.last = now;
      if (!this.seeded) {
        seedDemoHistory(this.book, snap, now, this.tz);
        this.seeded = true;
      }
      this.tracker.observe(snap, now);
    });
  }

  async days(tz: string): Promise<StatsDaysResponse> {
    const today = dayKeyOf(Date.now(), tz);
    const days = new Set([today]);
    for (const d of this.book.list()) for (const k of daysFromHours(d.hoursWithData(), tz)) days.add(k);
    return { tz, today, days: [...days].sort().reverse(), demoAvailable: false };
  }

  async day(day: string, tz: string): Promise<DayStatsResponse> {
    const now = Date.now();
    return { source: 'demo', demoAvailable: false, today: dayKeyOf(now, tz), serverTime: now, stats: queryDay(this.book.list(), day, tz, now) };
  }
}

interface TipRow {
  status?: TimedStatus;
  label: string;
  value: string;
}

type TableKey = 'rooms' | 'hours';

export class DayPanel implements UiComponent {
  readonly el: HTMLDialogElement;
  private readonly source: DaySource;
  private readonly tz = systemTimeZone();
  private days: StatsDaysResponse | null = null;
  private data: DayStatsResponse | null = null;
  private day: string | null = null;
  /** Fonte escolhida pelo usuário (sem escolha: o servidor decide; com o demo ligado, o demo). */
  private sourcePref: StatsSource | undefined;
  private visible = new Set<TimedStatus>(ALL_VISIBLE);
  private tables = new Set<TableKey>();
  private loading = false;
  private error: string | null = null;
  private seq = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private demoSeen: boolean | undefined;
  private opener: HTMLElement | null = null;

  private select: HTMLSelectElement;
  private seg: HTMLElement;
  private segDemo: HTMLButtonElement;
  private segReal: HTMLButtonElement;
  private badge: HTMLElement;
  private status: HTMLElement;
  private statusText: HTMLElement;
  private retry: HTMLButtonElement;
  private content: HTMLElement;
  private tip: HTMLElement;

  /** `button` = o botão "Meu dia" da barra superior (ui/daystats-launcher.ts), que reflete se a janela está aberta. */
  constructor(
    private ctx: UiContext,
    private button: HTMLElement,
  ) {
    this.source = ctx.store.mock ? new LocalSource(ctx.store) : httpSource;

    this.select = h('select', { class: 'ui-day__select', attrs: { 'aria-label': tr('Dia') }, on: { change: () => this.pickDay(this.select.value) } });
    this.segDemo = h('button', { class: 'ui-seg__opt', type: 'button', role: 'radio', text: tr('Demonstração'), on: { click: () => this.pickSource('demo') } });
    this.segReal = h('button', { class: 'ui-seg__opt', type: 'button', role: 'radio', text: tr('Dados reais'), on: { click: () => this.pickSource('real') } });
    this.seg = h('div', { class: 'ui-seg ui-day__source', role: 'radiogroup', hidden: true, attrs: { 'aria-label': tr('Dados exibidos') } }, this.segDemo, this.segReal);
    this.badge = h('span', { class: 'ui-day__badge', text: tr('demonstração'), title: tr('Números fictícios do modo demonstração'), hidden: true });
    const close = iconButton(ICONS.close, tr('Fechar (Esc)'), () => this.close(), 'ui-icon-btn--sm');

    this.statusText = h('span', {});
    this.retry = h('button', { class: 'ui-link-btn', type: 'button', text: tr('Tentar de novo'), hidden: true, on: { click: () => void this.load(true) } });
    // Sem aria-live: "atualizado às…" mudaria a cada 30 s; erros são anunciados à parte.
    this.status = h('p', { class: 'ui-day__status' }, this.statusText, this.retry);
    this.content = h('div', { class: 'ui-day__content' });
    this.tip = h('div', { class: 'ui-day__tip', role: 'tooltip', hidden: true, attrs: { 'aria-hidden': 'true' } });

    this.el = h(
      'dialog',
      { class: 'ui-dialog ui-day', attrs: { 'aria-labelledby': 'ui-day-title' } },
      h(
        'div',
        { class: 'ui-dialog__head ui-day__head' },
        h('div', { class: 'ui-day__title' }, h('h2', { text: tr('Meu dia'), attrs: { id: 'ui-day-title' } }), this.badge),
        h('div', { class: 'ui-day__controls' }, this.select, this.seg),
        close,
      ),
      h('div', { class: 'ui-day__body' }, this.status, this.content, h('p', { class: 'ui-day__note', text: NOTE })),
      this.tip,
    );
    // Clique no fundo fecha; o teclado fica dentro da janela (os atalhos do escritório não disparam por baixo).
    this.el.addEventListener('click', (e) => {
      if (e.target === this.el) this.close();
    });
    this.el.addEventListener('keydown', (e) => e.stopPropagation());
    this.el.addEventListener('close', () => this.onClosed());
    this.el.addEventListener('scroll', () => this.hideTip(), true);
  }

  get isOpen(): boolean {
    return this.el.open;
  }

  open(): void {
    if (this.el.open) return;
    this.opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // Sempre abre no dia de hoje (a página pode ter ficado aberta de um dia para o outro).
    this.day = null;
    this.el.showModal();
    this.button.setAttribute('aria-expanded', 'true');
    void this.load(true);
  }

  close(): void {
    if (this.el.open) this.el.close();
  }

  toggle(): void {
    if (this.el.open) this.close();
    else this.open();
  }

  /** O demo foi ligado ou desligado com a janela aberta: recarrega (a fonte padrão muda). */
  render(): void {
    const demo = this.ctx.store.snapshot?.meta.demo;
    if (demo === this.demoSeen) return;
    const changed = this.demoSeen !== undefined;
    this.demoSeen = demo;
    if (changed && this.el.open && !this.ctx.store.mock) void this.load(true);
  }

  private onClosed(): void {
    this.seq++;
    this.stopTimer();
    this.hideTip();
    this.button.setAttribute('aria-expanded', 'false');
    if (this.opener?.isConnected) this.opener.focus({ preventScroll: true });
    this.opener = null;
  }

  private pickDay(day: string): void {
    this.day = day;
    // Trocar de dia não troca de fonte: quem olha o demo continua no demo.
    this.sourcePref ??= this.data?.source;
    void this.load(false);
  }

  private pickSource(src: StatsSource): void {
    if (this.data?.source === src) return;
    this.sourcePref = src;
    const list = src === 'demo' ? this.days?.demoDays : this.days?.days;
    if (this.day && list && !list.includes(this.day)) this.day = null;
    void this.load(false);
  }

  // ---------------------------------------------------------------- dados

  private async load(withDays: boolean): Promise<void> {
    const seq = ++this.seq;
    this.stopTimer();
    this.loading = true;
    this.renderStatus();
    try {
      if (withDays || !this.days) {
        const days = await this.source.days(this.tz);
        if (seq !== this.seq) return;
        this.days = days;
        // O demo desligou: volta para o padrão.
        if (this.sourcePref === 'demo' && !days.demoAvailable) this.sourcePref = undefined;
      }
      const day = this.day ?? this.days.today;
      const res = await this.source.day(day, this.tz, this.sourcePref);
      if (seq !== this.seq) return;
      this.data = res;
      this.day = res.stats.day;
      this.error = null;
      this.renderAll();
    } catch (err) {
      if (seq !== this.seq) return;
      this.error = err instanceof Error ? err.message : String(err);
      this.ctx.announce(tr('Não foi possível carregar as estatísticas do dia.'));
      // O seletor volta para o dia que está na tela.
      if (this.data) {
        this.day = this.data.stats.day;
        this.renderControls(this.data);
      }
    } finally {
      if (seq === this.seq) {
        this.loading = false;
        this.renderStatus();
        if (shouldRefresh(this.el.open, this.day ?? '', this.data?.today ?? '')) {
          this.timer = setTimeout(() => void this.load(true), REFRESH_MS);
        }
      }
    }
  }

  private stopTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  // ---------------------------------------------------------------- montagem

  private renderStatus(): void {
    this.el.classList.toggle('is-loading', this.loading && !!this.data);
    setHidden(this.retry, !this.error);
    if (this.error) setText(this.statusText, tr('Não foi possível carregar as estatísticas ({0}).', [this.error]));
    else if (this.loading && !this.data) setText(this.statusText, tr('Carregando…'));
    else if (this.data) {
      const today = this.data.stats.day === this.data.today;
      setText(this.statusText, today ? tr('Atualizado às {0} · atualiza a cada 30 s', [formatClock(this.data.serverTime)]) : '');
    }
  }

  private renderAll(): void {
    const res = this.data;
    if (!res) return;
    this.renderControls(res);
    // Refazer o conteúdo não pode tirar o foco de quem navega pelo teclado.
    const focusKey = (document.activeElement as HTMLElement | null)?.closest<HTMLElement>('[data-focus-key]')?.dataset.focusKey;
    this.hideTip();
    this.content.replaceChildren(...this.sections(res));
    if (focusKey) this.content.querySelector<HTMLElement>(`[data-focus-key="${CSS.escape(focusKey)}"]`)?.focus({ preventScroll: true });
  }

  private renderControls(res: DayStatsResponse): void {
    const demo = res.source === 'demo';
    setHidden(this.badge, !demo);
    setHidden(this.seg, !res.demoAvailable);
    setAttr(this.segDemo, 'aria-checked', String(demo));
    setAttr(this.segReal, 'aria-checked', String(!demo));
    const list = (demo ? this.days?.demoDays : this.days?.days) ?? [res.today];
    const days = list.includes(res.stats.day) ? list : [res.stats.day, ...list];
    this.select.replaceChildren(...days.map((d) => h('option', { text: dayLabel(d, res.today), attrs: { value: d, selected: d === res.stats.day } })));
    this.select.value = res.stats.day;
    this.select.disabled = days.length < 2;
  }

  private sections(res: DayStatsResponse): HTMLElement[] {
    const stats = res.stats;
    const clock = (t: number) => formatClock(t, false);
    const hl = highlights(stats, clock, stats.accounts.some((a) => this.isCodexAccount(a.id) && a.counts.tokensIn + a.counts.tokensOut > 0));
    const out: HTMLElement[] = [this.kpis(hl)];
    if (isEmptyDay(stats)) {
      const today = stats.day === res.today;
      out.push(
        h('p', {
          class: 'ui-day__empty',
          text: today
            ? tr('Ainda não há tempo registrado hoje. Os números aparecem assim que algum agente trabalhar com o Habblaud aberto.')
            : tr('Nada registrado neste dia.'),
        }),
      );
      return out;
    }
    out.push(this.legend());
    out.push(this.hoursCard(res));
    out.push(this.roomsCard(roomRows(stats.rooms, this.visible)));
    out.push(this.waitsCard(waitRows(stats.waits, clock), res));
    out.push(this.accountsCard(res));
    return out;
  }

  // Destaques: o tempo esperando você em evidência, com a maior espera; os demais em blocos menores.
  private kpis(hl: ReturnType<typeof highlights>): HTMLElement {
    const swatch = h('span', { class: 'ui-day__swatch is-waiting', attrs: { 'aria-hidden': 'true' } });
    const hero = h(
      'div',
      { class: 'ui-day__hero' },
      h('p', { class: 'ui-day__kpi-label' }, swatch, h('span', { text: tr('Esperando você') })),
      h('p', { class: 'ui-day__hero-value', text: hl.waiting }),
      h('p', { class: 'ui-day__kpi-sub', text: hl.waits }),
      hl.longest ? h('p', { class: 'ui-day__kpi-sub' }, h('span', { class: 'ui-day__muted', text: tr('Maior espera: ') }), h('strong', { text: hl.longest })) : null,
      hl.wall ? h('p', { class: 'ui-day__kpi-sub', text: hl.wall }) : null,
    );
    const tile = (label: string, value: string, sub: string, title?: string, status?: TimedStatus) =>
      h(
        'div',
        { class: 'ui-day__kpi', title },
        h('p', { class: 'ui-day__kpi-label' }, status ? h('span', { class: `ui-day__swatch is-${status}`, attrs: { 'aria-hidden': 'true' } }) : null, h('span', { text: label })),
        h('p', { class: 'ui-day__kpi-value', text: value }),
        h('p', { class: 'ui-day__kpi-sub', text: sub }),
      );
    return h(
      'section',
      { class: 'ui-day__kpis', attrs: { 'aria-label': tr('Destaques do dia') } },
      hero,
      tile(tr('Trabalhando'), hl.working, tr('soma do tempo de todos os agentes'), undefined, 'working'),
      tile(tr('Sessões'), hl.sessions, hl.subagents),
      tile(tr('Pedidos'), hl.prompts, hl.activity),
      tile('Tokens', hl.tokens, hl.tokensDetail),
      tile(tr('Custo'), hl.cost, hl.costHint, hl.costHint),
    );
  }

  // Legenda única dos gráficos de status: cada item liga/desliga o status em todos eles (as escalas se refazem).
  private legend(): HTMLElement {
    const items = TIMED_STATUSES.map((s) => {
      const on = this.visible.has(s);
      return h(
        'button',
        {
          class: `ui-day__key${on ? '' : ' is-off'}`,
          type: 'button',
          title: on ? tr('Esconder “{0}” dos gráficos', [STATUS_TEXT[s]]) : tr('Mostrar “{0}” nos gráficos', [STATUS_TEXT[s]]),
          attrs: { 'aria-pressed': String(on), 'data-focus-key': `key:${s}` },
          on: { click: () => this.toggleStatus(s) },
        },
        h('span', { class: `ui-day__swatch is-${s}`, attrs: { 'aria-hidden': 'true' } }),
        h('span', { text: STATUS_TEXT[s] }),
      );
    });
    return h('div', { class: 'ui-day__legend', role: 'group', attrs: { 'aria-label': tr('Status nos gráficos (clique para mostrar ou esconder)') } }, ...items);
  }

  private toggleStatus(s: TimedStatus): void {
    if (this.visible.has(s)) {
      if (this.visible.size === 1) return; // sempre sobra pelo menos um
      this.visible.delete(s);
    } else this.visible.add(s);
    this.renderAll();
  }

  private card(key: string, title: string, sub: string, table?: TableKey): { el: HTMLElement; body: HTMLElement; showTable: boolean } {
    const showTable = !!table && this.tables.has(table);
    const toggle = table
      ? h('button', {
          class: 'ui-link-btn ui-day__table-btn',
          type: 'button',
          text: showTable ? tr('Ver gráfico') : tr('Ver tabela'),
          attrs: { 'aria-pressed': String(showTable), 'data-focus-key': `table:${table}` },
          on: {
            click: () => {
              if (this.tables.has(table)) this.tables.delete(table);
              else this.tables.add(table);
              this.renderAll();
            },
          },
        })
      : null;
    const body = h('div', { class: 'ui-day__card-body' });
    const el = h(
      'section',
      { class: `ui-day__card ui-day__card--${key}`, attrs: { 'aria-labelledby': `ui-day-${key}` } },
      h('div', { class: 'ui-day__card-head' }, h('div', {}, h('h3', { text: title, attrs: { id: `ui-day-${key}` } }), h('p', { class: 'ui-day__card-sub', text: sub })), toggle),
      body,
    );
    return { el, body, showTable };
  }

  private table(head: string[], rows: string[][], caption: string): HTMLElement {
    return h(
      'div',
      { class: 'ui-day__table-wrap' },
      h(
        'table',
        { class: 'ui-day__table' },
        h('caption', { class: 'ui-sr', text: caption }),
        h('thead', {}, h('tr', {}, ...head.map((c, i) => h('th', { text: c, attrs: { scope: 'col', class: i ? 'is-num' : undefined } })))),
        h('tbody', {}, ...rows.map((r) => h('tr', {}, ...r.map((c, i) => (i ? h('td', { class: 'is-num', text: c }) : h('th', { text: c, attrs: { scope: 'row' } })))))),
      ),
    );
  }

  // ---------------------------------------------------------------- por hora

  private hoursCard(res: DayStatsResponse): HTMLElement {
    const narrow = this.ctx.isNarrow();
    const { columns, axis } = hourColumns(res.stats.hours, this.visible, res.serverTime, narrow ? 6 : 3);
    const c = this.card('hours', tr('Por hora'), tr('Tempo de agentes em cada hora do dia'), 'hours');
    if (c.showTable) {
      const t = statusTable(columns, (col) => col.range, this.visible);
      c.body.append(this.table([tr('Hora'), ...t.head], t.rows, tr('Tempo de agentes por hora')));
      return c.el;
    }
    const grid = h(
      'div',
      { class: 'ui-day__grid', attrs: { 'aria-hidden': 'true' } },
      ...axis.ticks.map((tick) => h('span', { class: 'ui-day__gridline', style: `bottom:${(tick / axis.max) * 100}%` }, h('span', { class: 'ui-day__tick', text: axisLabel(tick) }))),
    );
    const cols = h('div', { class: 'ui-day__cols', role: 'list', attrs: { 'aria-label': tr('Tempo de agentes por hora (setas para navegar)') } });
    let tabbable = columns.findIndex((col) => col.now);
    if (tabbable < 0) tabbable = 0;
    columns.forEach((col, i) => cols.append(this.column(col, i === tabbable)));
    cols.addEventListener('keydown', (e) => this.moveFocus(e, cols));
    const axisX = h(
      'div',
      { class: 'ui-day__xaxis', attrs: { 'aria-hidden': 'true' } },
      ...columns.map((col) => h('span', { class: `ui-day__xlabel${col.now ? ' is-now' : ''}`, text: col.tick || (col.now && !narrow) ? `${col.hour}h` : '' })),
    );
    c.body.append(h('div', { class: 'ui-day__plot' }, grid, cols), axisX);
    return c.el;
  }

  private column(col: HourColumn, tabbable: boolean): HTMLElement {
    const stack = h('span', { class: 'ui-day__stack' }, ...col.segments.map((s) => h('span', { class: `ui-day__seg is-${s.status}`, style: `height:${s.pct}%`, attrs: { 'data-status': s.status } })));
    const el = h(
      'div',
      {
        class: `ui-day__col${col.now ? ' is-now' : ''}`,
        role: 'listitem',
        tabIndex: tabbable ? 0 : -1,
        attrs: { 'aria-label': `${col.label}${col.now ? tr(' (agora)') : ''}`, 'data-focus-key': `hour:${col.t}` },
      },
      stack,
    );
    const rows = (): TipRow[] =>
      col.future
        ? []
        : [
            ...TIMED_STATUSES.filter((s) => this.visible.has(s) && col.ms[s] > 0).map((s) => ({ status: s, label: STATUS_TEXT[s], value: formatAgentTime(col.ms[s]) })),
            { label: 'Total', value: formatAgentTime(col.total) },
          ];
    // A dica sai do topo da coluna pintada (não do topo do gráfico).
    this.bindTip(el, () => `${col.range}${col.now ? tr(' · agora') : col.future ? tr(' · ainda não chegou') : ''}`, rows, () => stack.lastElementChild ?? stack);
    return el;
  }

  /** Setas, Home e End entre as colunas (só uma fica no Tab). */
  private moveFocus(e: KeyboardEvent, list: HTMLElement): void {
    const items = [...list.children] as HTMLElement[];
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (i < 0) return;
    const next = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : -2;
    if (next === -2) return;
    e.preventDefault();
    const target = items[Math.max(0, Math.min(items.length - 1, next))];
    items.forEach((it) => (it.tabIndex = it === target ? 0 : -1));
    target.focus();
  }

  // ---------------------------------------------------------------- por projeto

  private roomsCard(rows: RoomRow[]): HTMLElement {
    const c = this.card('rooms', tr('Por projeto'), tr('Ordenado pelo tempo esperando você'), 'rooms');
    if (!rows.length) {
      c.body.append(h('p', { class: 'ui-day__muted', text: tr('Nenhum projeto com tempo neste dia.') }));
      return c.el;
    }
    if (c.showTable) {
      const t = statusTable(rows, (r) => r.name, this.visible);
      c.body.append(this.table([tr('Projeto'), ...t.head], t.rows, tr('Tempo de agentes por projeto')));
      return c.el;
    }
    const list = h('ul', { class: 'ui-day__bars' });
    for (const r of rows) {
      const track = h(
        'span',
        { class: 'ui-day__track' },
        ...r.segments.map((s) => h('span', { class: `ui-day__seg is-${s.status}`, style: `width:${s.pct}%`, attrs: { 'data-status': s.status } })),
      );
      const li = h(
        'li',
        { class: 'ui-day__bar', tabIndex: 0, attrs: { 'aria-label': r.label, 'data-focus-key': `room:${r.id}` } },
        h(
          'span',
          { class: 'ui-day__bar-head' },
          h('span', { class: 'ui-day__bar-name', text: r.name, title: r.id }),
          h('span', { class: 'ui-day__bar-value' }, this.visible.has('waiting') ? h('strong', { text: r.waiting }) : null, h('span', { class: 'ui-day__muted', text: r.totalText })),
        ),
        track,
      );
      const tipRows = (): TipRow[] => [
        ...TIMED_STATUSES.filter((s) => this.visible.has(s) && r.ms[s] > 0).map((s) => ({ status: s, label: STATUS_TEXT[s], value: formatAgentTime(r.ms[s]) })),
        { label: 'Total', value: formatAgentTime(visibleTotal(r.ms, this.visible)) },
      ];
      this.bindTip(li, () => r.name, tipRows);
      list.append(li);
    }
    c.body.append(list);
    return c.el;
  }

  // ---------------------------------------------------------------- maiores esperas

  private waitsCard(rows: ReturnType<typeof waitRows>, res: DayStatsResponse): HTMLElement {
    const c = this.card('waits', tr('Maiores esperas'), tr('Quanto tempo cada agente ficou de mão levantada esperando você'));
    if (!rows.length) {
      c.body.append(h('p', { class: 'ui-day__muted', text: tr('Nenhuma espera por você neste dia.') }));
      return c.el;
    }
    const accounts = new Map(res.stats.accounts.map((a) => [a.id, a]));
    const list = h('ol', { class: 'ui-day__waits' });
    for (const w of rows) {
      const acc = accounts.get(w.account);
      const chip = h('span', { class: 'ui-acc-chip', text: acc?.short ?? '?', title: acc?.name ?? w.account });
      setStyleVar(chip, '--acc', acc?.color ?? '#8b98b3');
      if (this.isCodexAccount(w.account)) chip.dataset.provider = 'codex';
      list.append(
        h(
          'li',
          { class: `ui-day__wait${w.ongoing ? ' is-ongoing' : ''}`, attrs: { 'aria-label': w.label } },
          h('span', { class: 'ui-day__rank', text: `${w.rank}`, attrs: { 'aria-hidden': 'true' } }),
          h(
            'span',
            { class: 'ui-day__wait-main', attrs: { 'aria-hidden': 'true' } },
            h(
              'span',
              { class: 'ui-day__wait-top' },
              h('strong', { class: 'ui-day__wait-dur', text: w.duration }),
              h('span', { class: 'ui-day__wait-bar' }, h('span', { class: 'ui-day__seg is-waiting', style: `width:${w.pct}%` })),
              w.ongoing ? h('span', { class: 'ui-day__now', text: tr('esperando agora') }) : null,
            ),
            h(
              'span',
              { class: 'ui-day__wait-who' },
              chip,
              h('span', { class: 'ui-day__wait-name', text: w.agentName }),
              h('span', { class: 'ui-day__muted', text: `${tr('em {0}', [w.roomName])} · ${w.when}${w.reason ? ` · ${w.reason}` : ''}` }),
            ),
          ),
        ),
      );
    }
    c.body.append(list);
    return c.el;
  }

  // ---------------------------------------------------------------- por conta

  private accountsCard(res: DayStatsResponse): HTMLElement {
    const cards = accountCards(res.stats.accounts, (id) => this.isCodexAccount(id));
    const c = this.card('accounts', tr('Por conta'), tr('Cada conta na cor dela, com a fatia do tempo de trabalho do dia'));
    if (!cards.length) {
      c.body.append(h('p', { class: 'ui-day__muted', text: tr('Nenhuma conta com tempo neste dia.') }));
      return c.el;
    }
    const grid = h('div', { class: 'ui-day__accounts' });
    for (const a of cards) {
      const chip = h('span', { class: 'ui-acc-chip ui-acc-chip--md', text: a.short, attrs: { 'aria-hidden': 'true', ...(a.codex ? { 'data-provider': 'codex' } : {}) } });
      setStyleVar(chip, '--acc', a.color);
      const meter = h(
        'span',
        { class: 'ui-day__meter', role: 'img', attrs: { 'aria-label': a.shareText } },
        h('span', { class: 'ui-day__meter-fill', style: `width:${a.share}%` }),
      );
      const stat = (label: string, value: string) => [h('dt', { text: label }), h('dd', { text: value })];
      const card = h(
        'article',
        { class: 'ui-day__account', attrs: { 'aria-label': a.name } },
        h('div', { class: 'ui-day__account-head' }, chip, h('strong', { class: 'ui-day__account-name', text: a.name }), h('span', { class: 'ui-day__muted', text: a.sessions })),
        meter,
        h('p', { class: 'ui-day__kpi-sub', text: a.shareText }),
        h(
          'dl',
          { class: 'ui-day__account-stats' },
          ...stat(tr('Trabalhando'), a.working),
          ...stat(tr('Esperando você'), a.waiting),
          ...stat('Tokens', a.tokens),
          // Codex: não grava custo, só tokens.
          ...(a.cost !== null ? stat(tr('Custo'), a.cost) : [h('dt', { text: tr('Custo') }), h('dd', { text: tr('só tokens'), title: tr('O Codex não grava custo, só tokens') })]),
        ),
      );
      setStyleVar(card, '--acc', a.color);
      grid.append(card);
    }
    c.body.append(grid);
    return c.el;
  }

  /** Conta do Codex: a do snapshot diz; uma conta que já saiu, o jeito do id (".codex"). */
  private isCodexAccount(id: string): boolean {
    return accountProvider(this.ctx.account(id), id) === 'codex';
  }

  // ---------------------------------------------------------------- dica (hover e foco)

  private bindTip(el: HTMLElement, title: () => string, rows: () => TipRow[], anchor: () => Element = () => el): void {
    const show = (hl?: TimedStatus) => this.showTip(anchor(), title(), rows(), hl);
    el.addEventListener('pointerenter', (e) => show(statusOf(e.target)));
    el.addEventListener('pointermove', (e) => show(statusOf(e.target)));
    el.addEventListener('pointerleave', () => this.hideTip());
    el.addEventListener('focus', () => show());
    el.addEventListener('blur', () => this.hideTip());
  }

  private showTip(anchor: Element, title: string, rows: TipRow[], hl?: TimedStatus): void {
    this.tip.replaceChildren(
      h('p', { class: 'ui-day__tip-title', text: title }),
      ...rows.map((r) =>
        h(
          'p',
          { class: `ui-day__tip-row${r.status && r.status === hl ? ' is-hl' : ''}${r.status ? '' : ' is-total'}` },
          h('span', { class: `ui-day__tip-key${r.status ? ` is-${r.status}` : ''}`, attrs: { 'aria-hidden': 'true' } }),
          h('strong', { text: r.value }),
          h('span', { text: r.label }),
        ),
      ),
    );
    this.tip.hidden = false;
    const box = this.el.getBoundingClientRect();
    const a = anchor.getBoundingClientRect();
    const tip = this.tip.getBoundingClientRect();
    const left = Math.min(Math.max(8, a.left - box.left + a.width / 2 - tip.width / 2), box.width - tip.width - 8);
    let top = a.top - box.top - tip.height - 8;
    if (top < 8) top = a.bottom - box.top + 8;
    this.tip.style.left = `${Math.round(left)}px`;
    this.tip.style.top = `${Math.round(top)}px`;
  }

  private hideTip(): void {
    this.tip.hidden = true;
  }
}

function statusOf(target: EventTarget | null): TimedStatus | undefined {
  const s = target instanceof HTMLElement ? target.dataset.status : undefined;
  return s && (TIMED_STATUSES as readonly string[]).includes(s) ? (s as TimedStatus) : undefined;
}
