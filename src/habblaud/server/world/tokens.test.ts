// Tokens do prédio (server/world/tokens.ts): soma de entrada + saída de hoje e dos 7 dias corridos, só da fonte real
// (o demo nunca entra), arredondada a 2 algarismos.
import { describe, expect, it } from 'vitest';
import { zeroCounts, type DayStatsResponse, type StatsSource } from '../../shared/daystats';
import type { AgentInfo, OfficeSnapshot } from '../../shared/types';
import { DayStatsService } from '../history/daystats';
import { setQuiet } from '../log';
import { BuildingTokens } from './tokens';

setQuiet(true);

const S = 1_000;
/** 15/10/2026 10:00 UTC. */
const T0 = Date.UTC(2026, 9, 15, 10);

function fakeStats(perDay: Record<string, [number, number]>, today = '2026-10-15') {
  const calls: Array<[string, StatsSource | undefined]> = [];
  return {
    calls,
    tz: 'UTC',
    today: () => today,
    day(day: string, _tz: string, source?: StatsSource): DayStatsResponse | null {
      calls.push([day, source]);
      const v = perDay[day];
      if (!v) return null;
      const counts = { ...zeroCounts(), tokensIn: v[0], tokensOut: v[1] };
      return { source: 'real', demoAvailable: false, today, serverTime: T0, stats: { totals: { counts } } } as unknown as DayStatsResponse;
    },
  };
}

describe('BuildingTokens', () => {
  it('hoje e os 7 dias corridos (hoje + 6), arredondados; dia sem dados conta zero', () => {
    const stats = fakeStats({
      '2026-10-15': [1_000_000, 234_567],
      '2026-10-14': [5_000_000, 1_000],
      '2026-10-09': [1_000, 1_000],
      '2026-10-08': [9_999_999_999, 0], // fora da semana
    });
    const t = new BuildingTokens({ stats, now: () => T0 });
    expect(t.read()).toEqual({ day: 1_200_000, week: 6_200_000 });
    expect(stats.calls.every(([, src]) => src === 'real')).toBe(true);
    expect(stats.calls.map(([d]) => d).sort()).toEqual(['2026-10-09', '2026-10-10', '2026-10-11', '2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15']);
  });

  it('dias passados ficam guardados; hoje é relido depois do prazo', () => {
    const per: Record<string, [number, number]> = { '2026-10-15': [100, 0], '2026-10-14': [50, 0] };
    const stats = fakeStats(per);
    let now = T0;
    const t = new BuildingTokens({ stats, now: () => now, ttlMs: 10_000 });
    expect(t.read()).toEqual({ day: 100, week: 150 });
    per['2026-10-15'] = [300, 0];
    per['2026-10-14'] = [999, 0];
    expect(t.read()).toEqual({ day: 100, week: 150 });
    now += 10_000;
    expect(t.read()).toEqual({ day: 300, week: 350 });
    expect(stats.calls.filter(([d]) => d === '2026-10-14')).toHaveLength(1);
  });

  it('com o DayStatsService de verdade e o demo ligado: só os tokens dos agentes reais', () => {
    let now = T0;
    const real: AgentInfo = {
      id: '.claude:1', kind: 'main', roomId: '/p/loja', name: 'Ana', look: 'f', role: 'Agente principal', sessionId: 'sess-1',
      account: '.claude', status: 'working', recent: [], tasks: [], startedAt: T0 - 60_000, lastEventAt: T0, statusSince: T0,
      stats: { toolCalls: 0, tokensIn: 0, tokensOut: 0, subagents: 0 }, seed: 1,
    };
    const demo: AgentInfo = { ...real, id: 'demo:abc-1', roomId: '/demo/loja', account: 'demo:.claude', sessionId: 'sess-demo' };
    let agents = [real, demo];
    const snap = (): Pick<OfficeSnapshot, 'agents' | 'rooms' | 'accounts' | 'meta'> => ({
      agents,
      rooms: [],
      accounts: [],
      meta: { demo: true, sources: [], startedAt: 0, version: 'teste' },
    });
    const svc = new DayStatsService({ dir: null, tz: 'UTC', now: () => now, snapshot: snap });
    const step = (until: number) => {
      while (now < until) {
        now += S;
        svc.sample(now);
      }
    };
    step(T0 + 120 * S); // passa o assentamento do boot
    agents = [
      { ...real, stats: { ...real.stats, tokensIn: 40_000, tokensOut: 2_000 } },
      { ...demo, stats: { ...demo.stats, tokensIn: 7_000_000, tokensOut: 900_000 } },
    ];
    step(T0 + 130 * S);
    expect(svc.isDemo()).toBe(true);
    // Sem `source`, hoje com o demo ligado viria o balde do demo: aqui não.
    expect(svc.day('2026-10-15', 'UTC')?.source).toBe('demo');
    const t = new BuildingTokens({ stats: svc, now: () => now });
    expect(t.read()).toEqual({ day: 42_000, week: 42_000 });
  });
});
