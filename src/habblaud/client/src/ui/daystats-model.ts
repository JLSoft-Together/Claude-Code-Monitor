// "Meu dia": funções puras do painel (sem DOM), testadas em ui/daystats-model.test.ts. Recebem o DayStats da
// API (shared/daystats.ts) e devolvem o que a tela desenha: destaques, barras empilhadas por status com escala
// comum, colunas por hora com eixo "redondo", participação das contas, ranking de esperas e rótulos.
import {
  TIMED_STATUSES,
  totalMs,
  type AccountDayStats,
  type DayStats,
  type HourDayStats,
  type RoomDayStats,
  type StatsSource,
  type StatusMs,
  type TimedStatus,
  type WaitDayStats,
} from '../../../shared/daystats';
import { formatInt, formatTokens, formatUSD } from './format';
import { intlLocale, tr } from '../../../shared/i18n';

/** Rótulos dos status no painel (o mesmo vocabulário do escritório, do ponto de vista de quem espera). */
export const STATUS_TEXT: Record<TimedStatus, string> = {
  waiting: tr('Esperando você'),
  working: tr('Trabalhando'),
  idle: tr('Ocioso'),
  shell: tr('Esperando o shell'),
};

/**
 * Tempo de agente: "12 s", "3 min", "2 h 10 min" e, passando de um dia, "27 h 5 min" (a soma de vários agentes
 * passa de 24 h sem virar "dias").
 */
export function formatAgentTime(ms: number): string {
  const v = Number.isFinite(ms) ? Math.max(0, ms) : 0;
  if (v < 60_000) return `${Math.floor(v / 1_000)} s`;
  if (v < 3_600_000) return `${Math.floor(v / 60_000)} min`;
  const h = Math.floor(v / 3_600_000);
  const m = Math.floor((v % 3_600_000) / 60_000);
  return m ? `${h} h ${m} min` : `${h} h`;
}

/** Statuses visíveis (a legenda liga e desliga cada um), sempre na ordem de empilhamento. */
export type Visible = ReadonlySet<TimedStatus>;

export const ALL_VISIBLE: Visible = new Set(TIMED_STATUSES);

export function visibleTotal(ms: StatusMs, visible: Visible): number {
  return TIMED_STATUSES.reduce((n, s) => n + (visible.has(s) ? ms[s] : 0), 0);
}

export interface Segment {
  status: TimedStatus;
  ms: number;
  /** Largura (ou altura) em % da escala. */
  pct: number;
}

/** Pedaços de uma barra empilhada (só os status visíveis e não vazios), em % de `scale`. */
export function segments(ms: StatusMs, visible: Visible, scale: number): Segment[] {
  if (!(scale > 0)) return [];
  return TIMED_STATUSES.filter((s) => visible.has(s) && ms[s] > 0).map((s) => ({ status: s, ms: ms[s], pct: (ms[s] / scale) * 100 }));
}

/** Frase com cada status (para leitores de tela e tabelas): "esperando você 12 min, trabalhando 1 h 5 min". */
export function statusSummary(ms: StatusMs, visible: Visible = ALL_VISIBLE): string {
  const parts = TIMED_STATUSES.filter((s) => visible.has(s) && ms[s] > 0).map((s) => `${STATUS_TEXT[s].toLowerCase()} ${formatAgentTime(ms[s])}`);
  return parts.length ? parts.join(', ') : tr('sem tempo registrado');
}

// ---------------------------------------------------------------- destaques

export interface Highlights {
  waiting: string;
  waitingMs: number;
  /** "12 min · Marina em loja, às 14:32" (ou vazio, sem esperas). */
  longest: string;
  /** "Alguém esperou por você durante 35 min" (tempo de relógio). */
  wall: string;
  waits: string;
  working: string;
  sessions: string;
  subagents: string;
  tokens: string;
  tokensDetail: string;
  /** "—" quando os transcripts não trouxeram custo. */
  cost: string;
  costHint: string;
  prompts: string;
  /** "84 ferramentas · 6 tarefas concluídas" */
  activity: string;
}

/**
 * `codex` = alguma conta do Codex trabalhou no dia: o custo é só o do Claude Code (o Codex não grava custo, só
 * tokens), e a dica diz isso.
 */
export function highlights(stats: DayStats, clock: (t: number) => string, codex = false): Highlights {
  const t = stats.totals;
  const c = t.counts;
  const top = stats.waits[0];
  const plural = (n: number, one: string, many: string) => `${formatInt(n)} ${n === 1 ? one : many}`;
  return {
    waiting: formatAgentTime(t.ms.waiting),
    waitingMs: t.ms.waiting,
    longest: top ? tr('{0} · {1} em {2}, às {3}{4}', [formatAgentTime(top.ms), top.agentName, top.roomName, clock(top.start), top.ongoing ? tr(' (ainda esperando)') : '']) : '',
    wall: t.waitWallMs > 0 ? tr('Alguém esperou por você durante {0} do dia', [formatAgentTime(t.waitWallMs)]) : '',
    waits: t.waits ? plural(t.waits, tr('espera'), tr('esperas')) : t.ms.waiting > 0 ? tr('só esperas de poucos segundos') : tr('nenhuma espera'),
    working: formatAgentTime(t.ms.working),
    sessions: formatInt(t.sessions),
    subagents: plural(t.subagents, tr('subagente'), tr('subagentes')),
    tokens: formatTokens(c.tokensIn + c.tokensOut),
    tokensDetail: tr('{0} entrada · {1} saída', [formatTokens(c.tokensIn), formatTokens(c.tokensOut)]),
    cost: c.costUSD > 0 ? formatUSD(c.costUSD) : '—',
    costHint:
      c.costUSD > 0
        ? codex
          ? tr('Só do Claude Code: o Codex não grava custo, só tokens')
          : tr('Custo calculado pelo próprio Claude Code')
        : c.tokensIn + c.tokensOut > 0
          ? codex
            ? tr('O Codex não grava custo, só tokens')
            : tr('Os transcripts não trouxeram o custo')
          : tr('Nenhum gasto registrado'),
    prompts: formatInt(c.prompts),
    activity: `${plural(c.toolCalls, tr('ferramenta'), tr('ferramentas'))} · ${plural(c.tasksDone, tr('tarefa concluída'), tr('tarefas concluídas'))}`,
  };
}

// ---------------------------------------------------------------- por projeto

export interface RoomRow {
  id: string;
  name: string;
  ms: StatusMs;
  total: number;
  segments: Segment[];
  /** "12 min esperando você" */
  waiting: string;
  /** "3 h 10 min no total" */
  totalText: string;
  label: string;
}

/** Barras por projeto: escala comum (o maior total visível), na ordem da API (quem mais esperou você primeiro). */
export function roomRows(rooms: readonly RoomDayStats[], visible: Visible): RoomRow[] {
  const scale = Math.max(0, ...rooms.map((r) => visibleTotal(r.ms, visible)));
  return rooms
    .filter((r) => totalMs(r.ms) > 0)
    .map((r) => {
      const total = visibleTotal(r.ms, visible);
      return {
        id: r.id,
        name: r.name,
        ms: r.ms,
        total,
        segments: segments(r.ms, visible, scale),
        waiting: tr('{0} esperando você', [formatAgentTime(r.ms.waiting)]),
        totalText: tr('{0} no total', [formatAgentTime(total)]),
        label: `${r.name}: ${statusSummary(r.ms, visible)}`,
      };
    });
}

// ---------------------------------------------------------------- por hora

export interface AxisScale {
  /** Topo do eixo (ms). */
  max: number;
  /** Marcas (ms), de baixo para cima, sem o zero. */
  ticks: number[];
}

const NICE_MINUTES = [5, 10, 15, 20, 30, 45, 60, 90, 120, 180, 240, 300, 360, 480, 600, 720, 960, 1200, 1440];

/** Eixo vertical "redondo" para `value` (ms de agente numa hora; passa de 60 min com vários agentes). */
export function niceAxis(value: number): AxisScale {
  const minutes = Math.max(1, value / 60_000);
  const top = NICE_MINUTES.find((m) => m >= minutes) ?? Math.ceil(minutes / 1440) * 1440;
  // 2 a 4 marcas em partes iguais e redondas: múltiplos de 1 h (ou de 30 min) a partir de 2 h; de 5 min abaixo disso.
  const steps = top >= 120 ? [60, 30] : [5];
  let parts = 1;
  for (const unit of steps) {
    const p = [4, 3, 2].find((n) => Number.isInteger(top / n) && (top / n) % unit === 0);
    if (p) {
      parts = p;
      break;
    }
  }
  const step = top / parts;
  return { max: top * 60_000, ticks: Array.from({ length: parts }, (_, i) => (i + 1) * step * 60_000) };
}

/** Rótulo curto de uma marca do eixo: "30 min", "1 h", "1 h 30", "2 h". */
export function axisLabel(ms: number): string {
  const min = Math.round(ms / 60_000);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} h ${String(m).padStart(2, '0')}` : `${h} h`;
}

export interface HourColumn {
  t: number;
  hour: number;
  ms: StatusMs;
  total: number;
  segments: Segment[];
  /** "14h–15h" */
  range: string;
  label: string;
  /** Hora em curso (só no dia de hoje). */
  now: boolean;
  /** Hora que ainda não chegou (hoje, depois de agora). */
  future: boolean;
  /** Rótulo do eixo X nesta coluna (a cada `every` horas). */
  tick: boolean;
}

export function hourColumns(hours: readonly HourDayStats[], visible: Visible, now: number, every = 3): { columns: HourColumn[]; axis: AxisScale } {
  const axis = niceAxis(Math.max(0, ...hours.map((h) => visibleTotal(h.ms, visible))));
  const columns = hours.map((h, i) => {
    const total = visibleTotal(h.ms, visible);
    const next = (h.hour + 1) % 24;
    const range = `${h.hour}h–${next}h`;
    return {
      t: h.t,
      hour: h.hour,
      ms: h.ms,
      total,
      segments: segments(h.ms, visible, axis.max),
      range,
      label: `${range}: ${statusSummary(h.ms, visible)}`,
      now: now >= h.t && now < (hours[i + 1]?.t ?? h.t + 3_600_000),
      future: h.t > now,
      tick: h.hour % every === 0,
    };
  });
  return { columns, axis };
}

// ---------------------------------------------------------------- por conta

export interface AccountCard {
  id: string;
  name: string;
  short: string;
  color: string;
  /** Participação no tempo de trabalho do dia (0–100). */
  share: number;
  shareText: string;
  working: string;
  waiting: string;
  sessions: string;
  tokens: string;
  /** null = conta do Codex (ele não grava custo: o cartão mostra só os tokens). */
  cost: string | null;
  /** Conta do Codex (chip vazado). */
  codex: boolean;
}

/** `isCodex` diz quais contas são do Codex (o protocolo do dia não traz a ferramenta: vem do snapshot ou do id). */
export function accountCards(accounts: readonly AccountDayStats[], isCodex: (id: string) => boolean = () => false): AccountCard[] {
  const work = accounts.reduce((n, a) => n + a.ms.working, 0);
  return accounts
    .filter((a) => totalMs(a.ms) > 0 || a.counts.tokensIn > 0)
    .map((a) => {
      const share = work > 0 ? Math.round((a.ms.working / work) * 100) : 0;
      const codex = isCodex(a.id);
      return {
        id: a.id,
        name: a.name,
        short: a.short,
        color: a.color,
        share,
        shareText: tr('{0}% do trabalho do dia', [share]),
        working: formatAgentTime(a.ms.working),
        waiting: formatAgentTime(a.ms.waiting),
        sessions: `${formatInt(a.sessions)} ${a.sessions === 1 ? tr('sessão') : tr('sessões')}${a.subagents ? ` · ${formatInt(a.subagents)} sub` : ''}`,
        tokens: formatTokens(a.counts.tokensIn + a.counts.tokensOut),
        cost: codex ? null : a.counts.costUSD > 0 ? formatUSD(a.counts.costUSD) : '—',
        codex,
      };
    });
}

// ---------------------------------------------------------------- maiores esperas

export interface WaitRow {
  key: string;
  rank: number;
  duration: string;
  /** Largura da barrinha (% da maior espera). */
  pct: number;
  agentName: string;
  roomName: string;
  account: string;
  /** "14:32–14:44" */
  when: string;
  reason?: string;
  ongoing: boolean;
  label: string;
}

export function waitRows(waits: readonly WaitDayStats[], clock: (t: number) => string): WaitRow[] {
  const longest = Math.max(1, ...waits.map((w) => w.ms));
  return waits.map((w, i) => {
    const when = w.ongoing ? tr('desde {0}', [clock(w.start)]) : `${clock(w.start)}–${clock(w.end)}`;
    const row: WaitRow = {
      key: `${w.agentId}|${w.start}`,
      rank: i + 1,
      duration: formatAgentTime(w.ms),
      pct: Math.max(2, (w.ms / longest) * 100),
      agentName: w.agentName,
      roomName: w.roomName,
      account: w.account,
      when,
      ongoing: !!w.ongoing,
      label: `${i + 1}º: ${formatAgentTime(w.ms)}, ${w.agentName} em ${w.roomName}, ${when}${w.reason ? tr(', para {0}', [w.reason]) : ''}${w.ongoing ? tr(', ainda esperando') : ''}`,
    };
    if (w.reason) row.reason = w.reason;
    return row;
  });
}

// ---------------------------------------------------------------- tabelas (o gêmeo acessível de cada gráfico)

/** Linhas de tabela de status: [nome, cada status visível..., total]. */
export function statusTable<T extends { ms: StatusMs }>(items: readonly T[], name: (item: T) => string, visible: Visible): { head: string[]; rows: string[][] } {
  const cols = TIMED_STATUSES.filter((s) => visible.has(s));
  return {
    head: [...cols.map((s) => STATUS_TEXT[s]), 'Total'],
    rows: items.map((it) => [name(it), ...cols.map((s) => (it.ms[s] > 0 ? formatAgentTime(it.ms[s]) : '—')), formatAgentTime(visibleTotal(it.ms, visible))]),
  };
}

// ---------------------------------------------------------------- dias, URLs e atualização

const weekdayFmt = new Intl.DateTimeFormat(intlLocale(), { weekday: 'short', day: '2-digit', month: '2-digit', timeZone: 'UTC' });

/** "Hoje", "Ontem" ou "qui., 01/10" (a data de "AAAA-MM-DD", sem depender do fuso). */
export function dayLabel(day: string, today: string): string {
  if (day === today) return tr('Hoje');
  const [y, m, d] = day.split('-').map(Number);
  const t = Date.UTC(y, m - 1, d);
  const [ty, tm, td] = today.split('-').map(Number);
  if (Date.UTC(ty, tm - 1, td) - t === 86_400_000) return tr('Ontem');
  return weekdayFmt.format(t);
}

export function statsUrl(day: string, tz: string, source?: StatsSource): string {
  const q = new URLSearchParams({ day, tz });
  if (source) q.set('source', source);
  return `/api/stats?${q}`;
}

export function daysUrl(tz: string): string {
  return `/api/stats/days?${new URLSearchParams({ tz })}`;
}

/** O painel se atualiza sozinho só aberto e no dia de hoje. */
export function shouldRefresh(open: boolean, day: string, today: string): boolean {
  return open && day === today;
}

/** O dia não tem nada para mostrar? */
export function isEmptyDay(stats: DayStats): boolean {
  return totalMs(stats.totals.ms) === 0 && stats.totals.counts.tokensIn === 0 && stats.waits.length === 0;
}
