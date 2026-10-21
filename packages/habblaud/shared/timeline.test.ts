import { describe, expect, it } from 'vitest';
import type { AccountInfo, AgentInfo, OfficeSnapshot, RoomInfo } from './types';
import {
  applyChanges,
  compactAgent,
  compactSnapshot,
  dayKey,
  dayStart,
  diffFrames,
  frameOf,
  isDayKey,
  keyframeOf,
  parseTimeline,
  shiftDay,
  toAccountInfo,
  toAgentInfo,
  type TimelineFrame,
} from './timeline';

const T0 = new Date(2026, 9, 7, 10, 0).getTime();

function agent(id: string, extra: Partial<AgentInfo> = {}): AgentInfo {
  return {
    id,
    kind: 'main',
    roomId: '/p/loja',
    name: 'Marina',
    look: 'f',
    role: 'Agente principal',
    sessionId: `s-${id}`,
    account: '.claude',
    status: 'working',
    recent: [],
    tasks: [{ id: '1', title: 'tarefa', status: 'pending' }],
    startedAt: T0,
    lastEventAt: T0,
    statusSince: T0,
    stats: { toolCalls: 3, tokensIn: 10, tokensOut: 5, subagents: 0 },
    seed: 42,
    ...extra,
  };
}

const room = (id: string, slot = 0): RoomInfo => ({ id, name: id.split('/').pop()!, path: id, slot, seed: 7, createdAt: T0 });

const account = (id: string, five = 10): AccountInfo => ({
  id,
  short: 'C',
  name: 'Conta C',
  email: 'alguem@exemplo.example',
  organization: 'Org',
  color: '#f08a3c',
  configDir: '/home/x/.claude',
  sessions: 1,
  usage: { fiveHour: { utilization: five, resetsAt: T0 + 3_600_000 }, source: 'statusline', fetchedAt: T0 },
  usageStatus: 'ok',
});

function snap(agents: AgentInfo[], rooms: RoomInfo[] = [room('/p/loja')], accounts: AccountInfo[] = [account('.claude')]): OfficeSnapshot {
  return { rev: 1, serverTime: T0, rooms, agents, accounts, meta: { demo: false, sources: [], startedAt: T0, version: 't' } };
}

/** Frame -> objeto comparável (Maps viram listas ordenadas). */
const plain = (f: TimelineFrame) => ({
  rooms: [...f.rooms.values()].sort((a, b) => a.id.localeCompare(b.id)),
  agents: [...f.agents.values()].sort((a, b) => a.id.localeCompare(b.id)),
  accounts: [...f.accounts.values()].sort((a, b) => a.id.localeCompare(b.id)),
});

describe('timeline: dias', () => {
  it('chave do dia local, validação estrita e aritmética de calendário', () => {
    expect(dayKey(T0)).toBe('2026-10-07');
    expect(dayKey(new Date(2026, 0, 1, 0, 0, 1).getTime())).toBe('2026-01-01');
    expect(isDayKey('2026-10-07')).toBe(true);
    expect(isDayKey('2024-02-29')).toBe(true);
    for (const bad of ['2026-02-30', '2026-13-01', '2026-00-10', '26-10-07', '2026-10-7', '2026-10-07.jsonl', '../2026-10-07', '2026-10-07/', '', '1999-12-31', null, 20261007]) {
      expect(isDayKey(bad)).toBe(false);
    }
    expect(shiftDay('2026-03-01', -1)).toBe('2026-02-28');
    expect(shiftDay('2026-12-31', 1)).toBe('2027-01-01');
    expect(shiftDay('2026-10-07', -6)).toBe('2026-10-01');
    expect(dayStart('2026-10-07')).toBe(new Date(2026, 9, 7).getTime());
  });
});

describe('timeline: resumo do snapshot', () => {
  it('só os campos de desenho: sem tarefas, números, detalhe do comando nem e-mail da conta', () => {
    const a = agent('.claude:1', {
      waitingFor: 'aprovar uma permissão',
      activity: { id: 'x', kind: 'run', icon: '💻', text: 'Rodando npm test', detail: 'npm test -- --token=***', tool: 'Bash', at: T0 + 5 },
      shells: [{ id: 'b1', label: 'Testes', command: 'npm test', startedAt: T0, background: true, kind: 'shell' }],
      title: 'x'.repeat(400),
    });
    const c = compactAgent(a);
    expect(c).not.toHaveProperty('tasks');
    expect(c).not.toHaveProperty('stats');
    expect(c).not.toHaveProperty('recent');
    expect(c.activity).toEqual({ kind: 'run', icon: '💻', text: 'Rodando npm test', at: T0 + 5, tool: 'Bash' });
    expect(c.shells).toEqual([{ id: 'b1', label: 'Testes', startedAt: T0, background: true, kind: 'shell' }]);
    expect(c.title!.length).toBeLessThanOrEqual(160);
    expect(c.demo).toBeUndefined();
    const f = compactSnapshot(snap([a, agent('demo:x1', { name: 'Caio' })], [room('/p/loja'), room('demo:/p/app', 1)], [account('.claude'), account('demo:.claude')]));
    expect(f.agents.get('demo:x1')!.demo).toBe(true);
    expect(f.rooms.get('demo:/p/app')!.demo).toBe(true);
    expect(f.accounts.get('demo:.claude')!.demo).toBe(true);
    const acc = f.accounts.get('.claude')!;
    expect(acc).not.toHaveProperty('email');
    expect(acc).not.toHaveProperty('organization');
    expect(acc).not.toHaveProperty('configDir');
    expect(acc.usage).toEqual({ source: 'statusline', fiveHour: { utilization: 10, resetsAt: T0 + 3_600_000 } });
  });
});

describe('timeline: ferramenta (provider)', () => {
  it('copia provider de agente e conta (ausente = Claude Code) e volta igual', () => {
    const cx = agent('.codex:t1', { provider: 'codex', account: '.codex' });
    const acc: AccountInfo = { ...account('.codex'), provider: 'codex', usage: { source: 'codex', fetchedAt: T0, noQuota: true } };
    const f = compactSnapshot(snap([cx, agent('.claude:1')], [room('/p/loja')], [account('.claude'), acc]));
    expect(f.agents.get('.codex:t1')!.provider).toBe('codex');
    expect(f.agents.get('.claude:1')).not.toHaveProperty('provider');
    expect(f.accounts.get('.codex')).toMatchObject({ provider: 'codex', usage: { source: 'codex', noQuota: true } });
    expect(f.accounts.get('.claude')).not.toHaveProperty('provider');
    expect(toAgentInfo(f.agents.get('.codex:t1')!).provider).toBe('codex');
    expect(toAgentInfo(f.agents.get('.claude:1')!)).not.toHaveProperty('provider');
    expect(toAccountInfo(f.accounts.get('.codex')!, T0)).toMatchObject({ provider: 'codex', usage: { source: 'codex', noQuota: true } });
    expect(toAccountInfo(f.accounts.get('.claude')!, T0)).not.toHaveProperty('provider');
  });
});

describe('timeline: deltas', () => {
  it('diferença aplicada sobre o estado anterior reconstrói o novo', () => {
    const before = compactSnapshot(
      snap([agent('.claude:1', { waitingFor: 'responder', status: 'waiting' }), agent('.claude:2', { name: 'Caio', roomId: '/p/api' })], [room('/p/loja'), room('/p/api', 1)]),
    );
    const after = compactSnapshot(
      snap(
        [
          agent('.claude:1', { status: 'idle', statusSince: T0 + 9, activity: { id: 'a', kind: 'done', icon: '✅', text: 'Concluiu', at: T0 + 9 } }),
          agent('s:sub', { kind: 'sub', parentId: '.claude:1', name: 'Luan', role: 'Explore' }),
        ],
        [room('/p/loja')],
        [account('.claude', 25)],
      ),
    );
    const d = diffFrames(before, after)!;
    expect(d).not.toBeNull();
    // Agente alterado: só o que mudou (waitingFor some com null); o novo vem completo; o que saiu, null.
    const byId = new Map(d.agents!);
    expect(byId.get('.claude:1')).toEqual({ status: 'idle', statusSince: T0 + 9, activity: { kind: 'done', icon: '✅', text: 'Concluiu', at: T0 + 9 }, waitingFor: null });
    expect(byId.get('s:sub')).toMatchObject({ id: 's:sub', kind: 'sub', parentId: '.claude:1', name: 'Luan' });
    expect(byId.get('.claude:2')).toBeNull();
    expect(d.rooms).toEqual([['/p/api', null]]);
    expect(d.accounts![0][0]).toBe('.claude');

    const frame = frameOf(keyframeOf(before, T0, 300_000));
    const old = frame.agents.get('.claude:1')!;
    applyChanges(frame, JSON.parse(JSON.stringify(d)));
    expect(plain(frame)).toEqual(plain(after));
    // O objeto antigo não foi alterado (snapshots já entregues continuam valendo).
    expect(old.status).toBe('waiting');
    expect(old.waitingFor).toBe('responder');
  });

  it('sem mudança no que o player desenha = sem delta', () => {
    const a = compactSnapshot(snap([agent('.claude:1')]));
    const b = compactSnapshot(snap([agent('.claude:1', { stats: { toolCalls: 99, tokensIn: 1, tokensOut: 1, subagents: 0 }, lastEventAt: T0 + 50 })]));
    expect(diffFrames(a, b)).toBeNull();
  });

  it('patch de agente desconhecido incompleto (linha perdida) é ignorado', () => {
    const frame = frameOf(keyframeOf(compactSnapshot(snap([])), T0, 300_000));
    applyChanges(frame, { agents: [['fantasma', { status: 'idle' }]] });
    expect(frame.agents.size).toBe(0);
  });
});

describe('timeline: leitura do arquivo', () => {
  it('ignora linhas inválidas e segura o relógio que voltou', () => {
    const k = keyframeOf(compactSnapshot(snap([agent('.claude:1')])), T0, 300_000, true);
    const text = [
      JSON.stringify(k),
      '{"t":"d","at":',
      JSON.stringify({ t: 'd', at: T0 + 2000, agents: [['.claude:1', { status: 'idle' }]] }),
      JSON.stringify({ t: 'd', at: T0 + 1000, agents: [['.claude:1', { status: 'working' }]] }),
      JSON.stringify({ t: 'x', at: T0 + 3000 }),
      JSON.stringify({ t: 'd', at: 'ontem' }),
      JSON.stringify({ t: 'end', at: T0 + 4000 }),
      '',
    ].join('\n');
    const recs = parseTimeline(text);
    expect(recs.map((r) => r.t)).toEqual(['k', 'd', 'd', 'end']);
    expect(recs.map((r) => r.at)).toEqual([T0, T0 + 2000, T0 + 2000, T0 + 4000]);
  });

  it('resumo -> AgentInfo/AccountInfo completos para o mundo e a interface', () => {
    const c = compactAgent(agent('.claude:1', { activity: { id: 'z', kind: 'edit', icon: '✏️', text: 'Editando App.tsx', at: T0 + 7 } }));
    const a = toAgentInfo(c);
    expect(a).toMatchObject({ id: '.claude:1', sessionId: '.claude:1', tasks: [], stats: { toolCalls: 0 }, lastEventAt: T0 + 7 });
    expect(a.activity!.id).toBe(`tl:.claude:1:${T0 + 7}:edit`);
    expect(a.recent).toEqual([a.activity]);
    const acc = toAccountInfo(compactSnapshot(snap([])).accounts.get('.claude')!, T0 + 99);
    expect(acc.usage).toEqual({ source: 'statusline', fetchedAt: T0 + 99, fiveHour: { utilization: 10, resetsAt: T0 + 3_600_000 } });
    expect(acc.configDir).toBe('');
  });

  it('parts do personagem editado vão e voltam; agente sem parts continua sem', () => {
    const parts = { skin: '#5a3623', hairStyle: 'bob' } as const;
    const c = compactAgent(agent('.claude:1', { parts }));
    expect(c.parts).toEqual(parts);
    expect(toAgentInfo(c).parts).toEqual(parts);
    const plain = compactAgent(agent('.claude:2'));
    expect('parts' in plain).toBe(false);
    expect(toAgentInfo(plain).parts).toBeUndefined();
  });
});
