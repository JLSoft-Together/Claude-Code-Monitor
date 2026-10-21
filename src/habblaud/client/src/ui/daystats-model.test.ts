import { describe, expect, it } from 'vitest';
import type { AccountDayStats, DayStats, HourDayStats, RoomDayStats, StatusMs, WaitDayStats } from '../../../shared/daystats';
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
  niceAxis,
  roomRows,
  segments,
  shouldRefresh,
  statsUrl,
  statusSummary,
  statusTable,
  waitRows,
} from './daystats-model';

const MIN = 60_000;
const H = 60 * MIN;
const ms = (p: Partial<StatusMs> = {}): StatusMs => ({ waiting: 0, working: 0, idle: 0, shell: 0, ...p });
const counts = (p: Partial<DayStats['totals']['counts']> = {}) => ({ prompts: 0, toolCalls: 0, tasksDone: 0, tokensIn: 0, tokensOut: 0, costUSD: 0, ...p });
const totals = (p: Partial<RoomDayStats> = {}) => ({ ms: ms(), counts: counts(), sessions: 0, subagents: 0, waits: 0, longestWaitMs: 0, ...p });
const clock = (t: number) => new Date(t).toISOString().slice(11, 16);

describe('Meu dia com o Codex', () => {
  const acc = (id: string, p: Partial<AccountDayStats> = {}): AccountDayStats => ({ id, name: id, short: 'X', color: '#000', ...totals(), ...p });

  it('custo só do Claude Code: a conta do Codex mostra tokens, sem custo', () => {
    const cards = accountCards(
      [acc('.claude', { ms: ms({ working: H }), counts: counts({ tokensIn: 10, costUSD: 1.5 }) }), acc('.codex', { ms: ms({ working: H }), counts: counts({ tokensIn: 2_000_000 }) })],
      (id) => id === '.codex',
    );
    expect(cards.map((c) => [c.id, c.codex, c.cost, c.tokens])).toEqual([
      ['.claude', false, 'US$ 1,50', '10'],
      ['.codex', true, null, '2 M'],
    ]);
    // Sem a função, ninguém é do Codex (como antes).
    expect(accountCards([acc('.codex', { ms: ms({ working: H }) })])[0]).toMatchObject({ codex: false, cost: '—' });
  });

  it('dica do custo diz que o Codex não grava custo', () => {
    const day = (c: Partial<DayStats['totals']['counts']>) => ({ totals: { ...totals(), counts: counts(c), waitWallMs: 0 }, waits: [] }) as unknown as DayStats;
    expect(highlights(day({ tokensIn: 5, costUSD: 2 }), clock, true).costHint).toBe('Só do Claude Code: o Codex não grava custo, só tokens');
    expect(highlights(day({ tokensIn: 5 }), clock, true).costHint).toBe('O Codex não grava custo, só tokens');
    expect(highlights(day({ tokensIn: 5, costUSD: 2 }), clock).costHint).toBe('Custo calculado pelo próprio Claude Code');
  });
});

describe('formatação', () => {
  it('tempo de agente não vira "dias"', () => {
    expect(formatAgentTime(12_500)).toBe('12 s');
    expect(formatAgentTime(3 * MIN + 59_000)).toBe('3 min');
    expect(formatAgentTime(2 * H)).toBe('2 h');
    expect(formatAgentTime(27 * H + 5 * MIN)).toBe('27 h 5 min');
    expect(formatAgentTime(-5)).toBe('0 s');
    expect(formatAgentTime(Number.NaN)).toBe('0 s');
  });

  it('resumo dos status para leitores de tela', () => {
    expect(statusSummary(ms({ waiting: 12 * MIN, working: 65 * MIN }))).toBe('esperando você 12 min, trabalhando 1 h 5 min');
    expect(statusSummary(ms({ idle: MIN }), new Set(['working']))).toBe('sem tempo registrado');
  });

  it('rótulos de dia e URLs da API', () => {
    expect(dayLabel('2026-10-08', '2026-10-08')).toBe('Hoje');
    expect(dayLabel('2026-10-07', '2026-10-08')).toBe('Ontem');
    expect(dayLabel('2026-10-01', '2026-10-08')).toMatch(/^qui\.?, 01\/10$/);
    expect(dayLabel('2026-09-30', '2026-10-01')).toBe('Ontem');
    expect(statsUrl('2026-10-08', 'America/Sao_Paulo')).toBe('/api/stats?day=2026-10-08&tz=America%2FSao_Paulo');
    expect(statsUrl('2026-10-08', 'UTC', 'demo')).toBe('/api/stats?day=2026-10-08&tz=UTC&source=demo');
    expect(daysUrl('UTC')).toBe('/api/stats/days?tz=UTC');
    expect(shouldRefresh(true, '2026-10-08', '2026-10-08')).toBe(true);
    expect(shouldRefresh(true, '2026-10-07', '2026-10-08')).toBe(false);
    expect(shouldRefresh(false, '2026-10-08', '2026-10-08')).toBe(false);
  });
});

describe('barras empilhadas', () => {
  it('pedaços só dos status visíveis e não vazios, em % da escala', () => {
    const s = segments(ms({ waiting: 10, working: 30, idle: 0, shell: 10 }), ALL_VISIBLE, 100);
    expect(s).toEqual([
      { status: 'waiting', ms: 10, pct: 10 },
      { status: 'working', ms: 30, pct: 30 },
      { status: 'shell', ms: 10, pct: 10 },
    ]);
    expect(segments(ms({ working: 5 }), ALL_VISIBLE, 0)).toEqual([]);
  });

  it('projetos: escala comum, ordem da API, sem projetos vazios e com status escondidos', () => {
    const rooms: RoomDayStats[] = [
      { id: '/p/a', name: 'a', ...totals({ ms: ms({ waiting: 30 * MIN, working: 30 * MIN }) }) },
      { id: '/p/b', name: 'b', ...totals({ ms: ms({ working: 2 * H, idle: 2 * H }) }) },
      { id: '/p/c', name: 'c', ...totals() },
    ];
    const rows = roomRows(rooms, ALL_VISIBLE);
    expect(rows.map((r) => r.name)).toEqual(['a', 'b']);
    // A escala é o maior total (b: 4 h): a barra de a ocupa 25%.
    expect(rows[0].segments.reduce((n, s) => n + s.pct, 0)).toBeCloseTo(25);
    expect(rows[1].segments.reduce((n, s) => n + s.pct, 0)).toBeCloseTo(100);
    expect(rows[0].waiting).toBe('30 min esperando você');
    expect(rows[1].totalText).toBe('4 h no total');
    // Sem o ocioso, a escala passa a ser 2 h.
    const noIdle = roomRows(rooms, new Set(['waiting', 'working', 'shell']));
    expect(noIdle[0].segments.reduce((n, s) => n + s.pct, 0)).toBeCloseTo(50);
    expect(noIdle[1].segments.map((s) => s.status)).toEqual(['working']);
  });
});

describe('por hora', () => {
  it('eixo vertical redondo', () => {
    expect(niceAxis(0)).toEqual({ max: 5 * MIN, ticks: [5 * MIN] });
    expect(niceAxis(50 * MIN)).toEqual({ max: H, ticks: [15 * MIN, 30 * MIN, 45 * MIN, H] });
    expect(niceAxis(80 * MIN).ticks).toEqual([30 * MIN, H, 90 * MIN]);
    expect(niceAxis(7.5 * H).ticks).toEqual([2 * H, 4 * H, 6 * H, 8 * H]);
    expect(niceAxis(5 * H)).toEqual({ max: 5 * H, ticks: [2.5 * H, 5 * H] });
    expect(axisLabel(30 * MIN)).toBe('30 min');
    expect(axisLabel(H)).toBe('1 h');
    expect(axisLabel(90 * MIN)).toBe('1 h 30');
  });

  it('colunas: escala comum, hora em curso, horas futuras e marcas a cada 3 h', () => {
    const t0 = Date.UTC(2026, 9, 8, 3);
    const hours: HourDayStats[] = Array.from({ length: 24 }, (_, i) => ({ t: t0 + i * H, hour: i, ms: ms(i === 9 ? { working: 40 * MIN, waiting: 10 * MIN } : {}) }));
    const now = t0 + 9 * H + 20 * MIN;
    const { columns, axis } = hourColumns(hours, ALL_VISIBLE, now);
    expect(axis.max).toBe(H);
    expect(columns[9]).toMatchObject({ now: true, future: false, range: '9h–10h', total: 50 * MIN });
    expect(columns[9].segments.map((s) => [s.status, Math.round(s.pct)])).toEqual([
      ['waiting', 17],
      ['working', 67],
    ]);
    expect(columns[10]).toMatchObject({ now: false, future: true });
    expect(columns.filter((c) => c.tick).map((c) => c.hour)).toEqual([0, 3, 6, 9, 12, 15, 18, 21]);
    expect(columns[9].label).toBe('9h–10h: esperando você 10 min, trabalhando 40 min');
  });
});

describe('contas, esperas e destaques', () => {
  const accounts: AccountDayStats[] = [
    { id: '.c', name: 'Conta C', short: 'C', color: '#f08a3c', ...totals({ ms: ms({ working: 3 * H, waiting: 20 * MIN }), sessions: 2, subagents: 3, counts: counts({ tokensIn: 1_200_000, tokensOut: 30_000, costUSD: 4.5 }) }) },
    { id: '.d', name: 'Conta D', short: 'D', color: '#4aa8e8', ...totals({ ms: ms({ working: H }), sessions: 1 }) },
    { id: '.e', name: 'Conta E', short: 'E', color: '#5cc97b', ...totals() },
  ];

  it('cartões das contas com a fatia do trabalho', () => {
    const cards = accountCards(accounts);
    expect(cards.map((c) => [c.short, c.share])).toEqual([
      ['C', 75],
      ['D', 25],
    ]);
    expect(cards[0]).toMatchObject({ color: '#f08a3c', shareText: '75% do trabalho do dia', sessions: '2 sessões · 3 sub', tokens: '1,2 M', cost: 'US$ 4,50' });
    expect(cards[1]).toMatchObject({ sessions: '1 sessão', cost: '—' });
  });

  it('ranking das esperas', () => {
    const t = Date.UTC(2026, 9, 8, 14, 32);
    const waits: WaitDayStats[] = [
      { agentId: 'a', agentName: 'Marina', roomId: '/p/loja', roomName: 'loja', account: '.c', start: t, end: t + 12 * MIN, ms: 12 * MIN, reason: 'aprovar uma permissão' },
      { agentId: 'b', agentName: 'Caio', roomId: '/p/api', roomName: 'api', account: '.d', start: t + H, end: t + H + 3 * MIN, ms: 3 * MIN, ongoing: true },
    ];
    const rows = waitRows(waits, clock);
    expect(rows[0]).toMatchObject({ rank: 1, duration: '12 min', pct: 100, when: '14:32–14:44', ongoing: false });
    expect(rows[0].label).toBe('1º: 12 min, Marina em loja, 14:32–14:44, para aprovar uma permissão');
    expect(rows[1]).toMatchObject({ rank: 2, pct: 25, when: 'desde 15:32', ongoing: true });
    expect(rows[1].label).toContain('ainda esperando');
  });

  it('destaques do dia', () => {
    const t = Date.UTC(2026, 9, 8, 14, 32);
    const stats: DayStats = {
      day: '2026-10-08',
      tz: 'UTC',
      start: 0,
      end: 0,
      totals: { ...totals({ ms: ms({ waiting: 48 * MIN, working: 5 * H + 20 * MIN }), sessions: 3, subagents: 1, waits: 4, counts: counts({ prompts: 12, toolCalls: 300, tasksDone: 1, tokensIn: 2_000_000, tokensOut: 50_000 }) }), waitWallMs: 35 * MIN },
      rooms: [],
      accounts: [],
      hours: [],
      waits: [{ agentId: 'a', agentName: 'Marina', roomId: '/p/loja', roomName: 'loja', account: '.c', start: t, end: t + 12 * MIN, ms: 12 * MIN }],
    };
    const h = highlights(stats, clock);
    expect(h).toMatchObject({
      waiting: '48 min',
      waits: '4 esperas',
      longest: '12 min · Marina em loja, às 14:32',
      wall: 'Alguém esperou por você durante 35 min do dia',
      working: '5 h 20 min',
      sessions: '3',
      subagents: '1 subagente',
      tokens: '2,1 M',
      prompts: '12',
      activity: '300 ferramentas · 1 tarefa concluída',
      cost: '—',
      costHint: 'Os transcripts não trouxeram o custo',
    });
    expect(isEmptyDay(stats)).toBe(false);
    const empty = { ...stats, totals: { ...totals(), waitWallMs: 0 }, waits: [] };
    expect(isEmptyDay(empty)).toBe(true);
    expect(highlights(empty, clock)).toMatchObject({ waits: 'nenhuma espera', longest: '', wall: '', costHint: 'Nenhum gasto registrado' });
  });

  it('tabela equivalente', () => {
    const t = statusTable([{ name: 'loja', ms: ms({ waiting: 5 * MIN, working: H }) }], (r) => r.name, new Set(['waiting', 'working']));
    expect(t.head).toEqual(['Esperando você', 'Trabalhando', 'Total']);
    expect(t.rows).toEqual([['loja', '5 min', '1 h', '1 h 5 min']]);
  });
});
