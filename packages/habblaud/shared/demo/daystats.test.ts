// Histórico fictício do "Meu dia" com a conta do Codex: ela sempre tem algum projeto, com tokens e sem custo.
import { describe, expect, it } from 'vitest';
import type { AgentInfo } from '../types';
import { dayKeyOf, queryDay, StatsBook, type StatsView } from '../daystats';
import { seedDemoHistory } from './daystats';

const now = Date.UTC(2026, 9, 8, 18, 30);

function agent(id: string, roomId: string, account: string): AgentInfo {
  return {
    id,
    kind: 'main',
    roomId,
    name: id,
    look: 'f',
    role: 'Agente principal',
    sessionId: `s-${id}`,
    account,
    status: 'working',
    recent: [],
    tasks: [],
    startedAt: now - 3_600_000,
    lastEventAt: now,
    statusSince: now,
    stats: { toolCalls: 0, tokensIn: 0, tokensOut: 0, subagents: 0 },
    seed: 1,
  };
}

describe('seedDemoHistory com o Codex', () => {
  it('o Codex ganha projeto no histórico (tokens, sem custo); o Claude Code continua com custo', () => {
    const view: StatsView = {
      agents: [agent('demo:1', 'demo:/dev/loja-virtual', 'demo:.claude'), agent('demo:2', 'demo:/dev/loja-virtual', 'demo:.codex')],
      rooms: [{ id: 'demo:/dev/loja-virtual', name: 'loja-virtual' }],
      accounts: [
        { id: 'demo:.claude', name: 'Demo X', short: 'X', color: '#5cc97b' },
        { id: 'demo:.claude-conta2', name: 'Demo Y', short: 'Y', color: '#a77bf3' },
        { id: 'demo:.codex', name: 'Demo Codex', short: 'Z', color: '#f06fa0', provider: 'codex' } as StatsView['accounts'][number],
      ],
    };
    for (const seed of [1, 2, 3, 42, 99]) {
      const book = new StatsBook((t) => dayKeyOf(t, 'UTC'));
      seedDemoHistory(book, view, now, 'UTC', seed);
      const d = queryDay(book.list(), '2026-10-08', 'UTC', now);
      const codex = d.accounts.find((a) => a.id === 'demo:.codex');
      expect(codex, `semente ${seed}`).toBeDefined();
      expect(codex!.counts.tokensIn).toBeGreaterThan(0);
      expect(codex!.counts.costUSD).toBe(0);
      expect(d.accounts.find((a) => a.id === 'demo:.claude')!.counts.costUSD).toBeGreaterThan(0);
    }
  });
});
