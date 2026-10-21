// A projeção (shared/world/projection.ts) é o único lugar que monta o pacote do prédio. Estes testes são a garantia
// da lista fechada de docs/world/privacidade.md: chaves só as do schema.json, nenhum texto do escritório no pacote
// (canários), nada de número que pareça horário, demonstração de fora, nomes do pool, aparência sem a semente,
// parentId traduzido, limites e as opções do jogador.
import { describe, expect, it } from 'vitest';
import { PART_KEYS } from '../appearance';
import { hash32, mulberry32 } from '../hash';
import { NAME_POOL } from '../names';
import type { AgentInfo, RoomInfo } from '../types';
import { flattenAppearance } from './appearance-flat';
import { project, projectWithReport, roundTokens, tasksBand, uplinkBytes, type ProjectionInput, type WorldIdSource } from './projection';
import { UPLINK_LIMITS, type WorldUplink } from './protocol';
import schemaJson from './schema.json';
import { compileValidator, jsonKeyPaths, schemaKeyPaths } from './schema-validator';

const schema = schemaJson as unknown as { [k: string]: unknown };
const validate = compileValidator(schema);
const ALLOWED = schemaKeyPaths(schema);
const NOW = 1_760_000_000_000;

/** Ids do mundo de mentira: aleatórios de um PRNG com semente (reprodutíveis), guardados por chave. */
class FakeIds implements WorldIdSource {
  readonly floors = new Map<string, string>();
  readonly agents = new Map<string, string>();
  readonly calls: string[] = [];
  private rnd = mulberry32(42);
  private hex(n: number): string {
    let s = '';
    while (s.length < n) s += Math.floor(this.rnd() * 16).toString(16);
    return s;
  }
  floorId(roomId: string): string {
    this.calls.push(roomId);
    if (!this.floors.has(roomId)) this.floors.set(roomId, `f_${this.hex(10)}`);
    return this.floors.get(roomId)!;
  }
  agentId(agentId: string): string {
    this.calls.push(agentId);
    if (!this.agents.has(agentId)) this.agents.set(agentId, `a_${this.hex(8)}`);
    return this.agents.get(agentId)!;
  }
}

const POOL = new Set(NAME_POOL.map((p) => p.name));
const LOOK_OF = new Map(NAME_POOL.map((p) => [p.name, p.look]));
const isPoolName = (n: string) => POOL.has(n.replace(/ [0-9]{1,3}$/, ''));

function room(id: string, extra: Partial<RoomInfo> = {}): RoomInfo {
  return { id, name: id.split('/').pop() ?? id, path: id, slot: 0, seed: hash32(id), createdAt: NOW - 1000, ...extra };
}

function agent(id: string, roomId: string, extra: Partial<AgentInfo> = {}): AgentInfo {
  return {
    id,
    kind: 'main',
    roomId,
    name: 'Marina',
    look: 'f',
    role: 'Agente principal',
    sessionId: `sess-${id}`,
    account: '.claude',
    status: 'working',
    recent: [],
    tasks: [],
    startedAt: NOW - 60_000,
    lastEventAt: NOW - 1000,
    statusSince: NOW - 5000,
    stats: { toolCalls: 3, tokensIn: 1000, tokensOut: 200, subagents: 0 },
    seed: hash32(id),
    ...extra,
  };
}

function input(rooms: RoomInfo[], agents: AgentInfo[], extra: Partial<ProjectionInput> = {}): ProjectionInput {
  return { rooms, agents, theme: 'none', version: '0.11.0', options: { compactions: false, tokensVisible: true }, ...extra };
}

const agentsOf = (u: WorldUplink) => u.floors.flatMap((f) => f.agents);

/** Todos os números do JSON (para conferir que nada parece horário nem vaza contadores). */
function numbersIn(v: unknown, out: number[] = []): number[] {
  if (typeof v === 'number') out.push(v);
  else if (Array.isArray(v)) for (const x of v) numbersIn(x, out);
  else if (v && typeof v === 'object') for (const x of Object.values(v)) numbersIn(x, out);
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// O escritório cheio de canários
// ---------------------------------------------------------------------------------------------------------------

const CANARY_ROOM = '/Users/canario-usuario/projetos/CANARIO-PROJETO-SECRETO';
const CANARY_ROOM_2 = '/home/canario2/CANARIO-CLIENTE-X';
const MAIN_ID = '.claude-CANARIO-CONTA:91827';
const SUB_ID = 'CANARIO-SESSAO-123:agent-CANARIO-456';
const CODEX_ID = '.codex-CANARIO:thread-CANARIO-789';
const SECRET_NUMBERS = { seed: 3141592653, cost: 1234.5678, lines: 98765, removed: 45678, tools: 7777, tokensIn: 5_550_001, tokensOut: 4_440_001 };

function canaryOffice(): { rooms: RoomInfo[]; agents: AgentInfo[] } {
  const rooms = [
    room(CANARY_ROOM, { name: 'CANARIO-NOME-DA-SALA (alias CANARIO-APELIDO)' }),
    room(CANARY_ROOM_2, { name: 'CANARIO-SALA-2', effect: { kind: 'party', text: 'CANARIO-PR #12 mergeado', at: NOW, until: NOW + 12_000 } }),
  ];
  const activity = {
    id: 'act-CANARIO',
    kind: 'run' as const,
    icon: '🏃',
    text: 'CANARIO-ATIVIDADE rodando testes',
    detail: 'CANARIO-COMANDO npm test -- --secret=CANARIO-SEGREDO',
    tool: 'Bash',
    at: NOW - 500,
  };
  const common: Partial<AgentInfo> = {
    title: 'CANARIO-TITULO corrigir o login de canario@exemplo.com',
    activity,
    recent: [activity, { ...activity, id: 'act-CANARIO-2', text: 'CANARIO-RECENTE', kind: 'compact', icon: '🧹' }],
    tasks: [
      { id: '1', title: 'CANARIO-TAREFA escrever testes', status: 'completed', activeForm: 'CANARIO-TAREFA-GERUNDIO' },
      { id: '2', title: 'CANARIO-TAREFA-2', status: 'in_progress' },
    ],
    shells: [{ id: 'sh-CANARIO', label: 'CANARIO-SHELL', command: 'CANARIO-COMANDO-SHELL rm -rf /tmp/x', startedAt: NOW - 9000, background: true, kind: 'shell' }],
    model: 'claude-CANARIO-MODELO-opus',
    gitBranch: 'feat/CANARIO-BRANCH',
    permissionMode: 'CANARIO-PERMISSAO',
    waitingFor: 'CANARIO-ESPERA aprovar canario@exemplo.com',
    stats: { toolCalls: SECRET_NUMBERS.tools, tokensIn: SECRET_NUMBERS.tokensIn, tokensOut: SECRET_NUMBERS.tokensOut, costUSD: SECRET_NUMBERS.cost, linesAdded: SECRET_NUMBERS.lines, linesRemoved: SECRET_NUMBERS.removed, subagents: 1 },
    seed: SECRET_NUMBERS.seed,
    startedAt: 1_700_000_000_123,
    lastEventAt: 1_700_000_000_456,
    statusSince: 1_700_000_000_789,
    role: 'CANARIO-PAPEL',
    canMessage: true,
  };
  const agents = [
    agent(MAIN_ID, CANARY_ROOM, {
      ...common,
      name: 'CANARIONOMEEDITADO Silva',
      custom: true,
      parts: { hair: '#e47aa8', hairStyle: 'afro' },
      account: '.claude-CANARIO-CONTA',
      sessionId: 'CANARIO-SESSAO-123',
      status: 'waiting',
    }),
    agent(SUB_ID, CANARY_ROOM, { ...common, kind: 'sub', parentId: MAIN_ID, name: 'Caio', look: 'm', account: '.claude-CANARIO-CONTA', background: true, sessionId: 'CANARIO-SESSAO-123' }),
    agent(CODEX_ID, CANARY_ROOM_2, { ...common, provider: 'codex', name: 'Rafael', look: 'm', account: '.codex-CANARIO', status: 'shell' }),
  ];
  return { rooms, agents };
}

describe('projeção: lista fechada', () => {
  const { rooms, agents } = canaryOffice();
  const ids = new FakeIds();
  const u = project(
    input(rooms, agents, { tokens: { day: 123_456, week: 7_654_321 }, options: { compactions: true, tokensVisible: true }, compacted: new Set([MAIN_ID]) }),
    ids,
    NOW,
  );
  const json = JSON.stringify(u);

  it('o pacote passa no schema.json e tem o que o escritório tem', () => {
    expect(validate(u)).toEqual([]);
    expect(u.floors).toHaveLength(2);
    expect(agentsOf(u)).toHaveLength(3);
    // Todas as chaves opcionais aparecem aqui (tokens, parentId, compacted), para o teste de chaves valer por inteiro.
    expect(json).toContain('"tokens"');
    expect(json).toContain('"parentId"');
    expect(json).toContain('"compacted"');
  });

  it('teste de chaves: toda chave, em qualquer nível, está na lista fechada tirada do schema.json', () => {
    for (const path of jsonKeyPaths(u)) expect(ALLOWED, path).toContain(path);
    expect(ALLOWED.size).toBe(32);
  });

  it('teste de canários: nenhum texto do escritório aparece no JSON', () => {
    expect(json.toLowerCase()).not.toContain('canario');
    for (const s of [CANARY_ROOM, CANARY_ROOM_2, MAIN_ID, SUB_ID, CODEX_ID, '@exemplo.com', 'Silva', 'Bash', 'opus', 'feat/', '/Users', '/home', '.claude', '.codex', 'sess-', 'Agente principal']) {
      expect(json, s).not.toContain(s);
    }
  });

  it('nenhum número além de v, tasksDone e tokens; nada que pareça horário (1e12 a 2e12)', () => {
    const nums = numbersIn(u);
    for (const n of nums) expect(n < 1e12 || n > 2e12, String(n)).toBe(true);
    const allowed = new Set([1, 0, 2, 3, u.tokens!.day, u.tokens!.week]);
    for (const n of nums) expect(allowed, String(n)).toContain(n);
    for (const secret of Object.values(SECRET_NUMBERS)) expect(nums).not.toContain(secret);
    expect(json).not.toContain(String(SECRET_NUMBERS.seed));
  });

  it('ids só do mundo, nunca do escritório', () => {
    for (const f of u.floors) expect(f.id).toMatch(/^f_[0-9a-f]{10}$/);
    for (const a of agentsOf(u)) expect(a.id).toMatch(/^a_[0-9a-f]{8}$/);
    expect(u.floors.map((f) => f.id).sort()).toEqual([ids.floors.get(CANARY_ROOM), ids.floors.get(CANARY_ROOM_2)].sort());
  });
});

describe('projeção: regras', () => {
  it('demonstração nunca entra (nem pede id do mundo)', () => {
    const ids = new FakeIds();
    const rooms = [room('/p/real'), room('demo:/sala-demo')];
    const agents = [
      agent('acc:1', '/p/real'),
      agent('demo:agente-1', 'demo:/sala-demo'),
      agent('demo:agente-2', '/p/real'),
      agent('acc:2', 'demo:/sala-demo'),
    ];
    const u = project(input(rooms, agents), ids, NOW);
    expect(u.floors).toHaveLength(1);
    expect(agentsOf(u)).toHaveLength(1);
    expect(ids.calls.some((c) => c.startsWith('demo:') || c === 'acc:2')).toBe(false);
    // Só demonstração: prédio sem andares.
    expect(project(input([room('demo:/x')], [agent('demo:a', 'demo:/x')]), new FakeIds(), NOW).floors).toEqual([]);
  });

  it('só agentes presentes: done e offline somem, e a sala sem ninguém presente não vira andar', () => {
    const rooms = [room('/p/a'), room('/p/b'), room('/p/vazia')];
    const agents = [
      agent('m1', '/p/a', { status: 'working' }),
      agent('m2', '/p/a', { status: 'idle' }),
      agent('m3', '/p/b', { status: 'offline' }),
      agent('s1', '/p/b', { kind: 'sub', parentId: 'm3', status: 'done' }),
      agent('m4', '/p/a', { status: 'shell' }),
      agent('m5', '/p/a', { status: 'waiting' }),
    ];
    const u = project(input(rooms, agents), new FakeIds(), NOW);
    expect(u.floors).toHaveLength(1);
    expect(agentsOf(u).map((a) => a.status).sort()).toEqual(['idle', 'shell', 'waiting', 'working']);
  });

  it('ordem pelo id do mundo, não pela chegada; principais antes dos subagentes', () => {
    const rooms = Array.from({ length: 6 }, (_, i) => room(`/p/${i}`));
    const agents = rooms.flatMap((r, i) => [agent(`m${i}`, r.id), agent(`s${i}`, r.id, { kind: 'sub', parentId: `m${i}` }), agent(`n${i}`, r.id)]);
    const u = project(input(rooms, agents), new FakeIds(), NOW);
    const fids = u.floors.map((f) => f.id);
    expect(fids).toEqual([...fids].sort());
    for (const f of u.floors) {
      const kinds = f.agents.map((a) => a.kind);
      expect(kinds).toEqual(['main', 'main', 'sub']);
      expect(f.agents[0].id < f.agents[1].id).toBe(true);
    }
  });

  it('nome sempre do pool, do mesmo look, sem repetir, e independente do nome do escritório', () => {
    const rooms = [room('/p/a')];
    const agents = Array.from({ length: 40 }, (_, i) => agent(`m${i}`, '/p/a', { name: i % 2 ? 'Fulano de Tal' : 'Ana', look: i % 3 ? 'f' : 'm' }));
    const ids = new FakeIds();
    const u = project(input(rooms, agents), ids, NOW);
    const names = agentsOf(u).map((a) => a.name);
    expect(new Set(names).size).toBe(names.length);
    for (const a of agentsOf(u)) {
      expect(isPoolName(a.name), a.name).toBe(true);
      expect(LOOK_OF.get(a.name), a.name).toBe(a.look);
    }
    // Trocar o nome (editado) no escritório não muda nada no mundo.
    const renamed = agents.map((a) => ({ ...a, name: 'Nome Real Da Pessoa', custom: true as const }));
    expect(project(input(rooms, renamed), ids, NOW)).toEqual(u);
  });

  it('pool esgotado: sufixo numérico, ainda do pool', () => {
    const agents = Array.from({ length: 64 }, (_, i) => agent(`m${i}`, '/p/a', { look: 'm' }));
    const u = project(input([room('/p/a')], agents), new FakeIds(), NOW);
    const names = agentsOf(u).map((a) => a.name);
    expect(new Set(names).size).toBe(64);
    expect(names.filter((n) => / [0-9]+$/.test(n)).length).toBeGreaterThan(0);
    for (const n of names) expect(isPoolName(n), n).toBe(true);
    expect(validate(u)).toEqual([]);
  });

  it('o nome fica enquanto o id do mundo não troca, mesmo com outro agente saindo', () => {
    const rooms = [room('/p/a')];
    const agents = Array.from({ length: 30 }, (_, i) => agent(`m${i}`, '/p/a', { look: 'f' }));
    const ids = new FakeIds();
    const first = project(input(rooms, agents), ids, NOW);
    const previous = new Map(agentsOf(first).map((a) => [a.id, a.name]));
    const second = project(input(rooms, agents.slice(5), { previousNames: previous }), ids, NOW);
    for (const a of agentsOf(second)) expect(a.name).toBe(previous.get(a.id));
    // Nome anterior fora do pool (ou de outro look) não é aceito.
    const bad = new Map([[agentsOf(first)[0].id, 'Nome Inventado']]);
    expect(agentsOf(project(input(rooms, agents, { previousNames: bad }), ids, NOW))[0].name).not.toBe('Nome Inventado');
  });

  it('aparência: sorteada do id do mundo (nunca da semente) com as peças do editor por cima', () => {
    const ids = new FakeIds();
    const a = agent('m1', '/p/a', { seed: 111, look: 'm' });
    const u1 = project(input([room('/p/a')], [a]), ids, NOW);
    const u2 = project(input([room('/p/a')], [{ ...a, seed: 222 }]), ids, NOW);
    expect(u2).toEqual(u1);
    const wid = ids.agents.get('m1')!;
    expect(agentsOf(u1)[0].parts).toEqual(flattenAppearance(hash32(wid), undefined, 'm'));
    expect(Object.keys(agentsOf(u1)[0].parts)).toEqual([...PART_KEYS]);
    const edited = project(input([room('/p/a')], [{ ...a, custom: true, parts: { skin: '#5a3623', topStyle: 'polo' } }]), ids, NOW);
    expect(agentsOf(edited)[0].parts).toEqual({ ...flattenAppearance(hash32(wid), undefined, 'm'), skin: '#5a3623', topStyle: 'polo' });
  });

  it('parentId vira o id do mundo do pai; subagente sem o pai no pacote vai sem parentId', () => {
    const ids = new FakeIds();
    const rooms = [room('/p/a')];
    const agents = [
      agent('m1', '/p/a'),
      agent('s1', '/p/a', { kind: 'sub', parentId: 'm1' }),
      agent('s2', '/p/a', { kind: 'sub', parentId: 's1' }),
      agent('m2', '/p/a', { status: 'offline' }),
      agent('s3', '/p/a', { kind: 'sub', parentId: 'm2' }),
      agent('s4', '/p/a', { kind: 'sub', parentId: 'nao-existe' }),
    ];
    const u = project(input(rooms, agents), ids, NOW);
    const byId = new Map(agentsOf(u).map((a) => [a.id, a]));
    expect(byId.get(ids.agents.get('s1')!)).toMatchObject({ kind: 'sub', parentId: ids.agents.get('m1') });
    expect(byId.get(ids.agents.get('s2')!)).toMatchObject({ kind: 'sub', parentId: ids.agents.get('s1') });
    for (const orphan of ['s3', 's4']) {
      const w = byId.get(ids.agents.get(orphan)!)!;
      expect(w.kind).toBe('sub');
      expect('parentId' in w).toBe(false);
    }
    expect(byId.get(ids.agents.get('m1')!)!.parentId).toBeUndefined();
    expect(validate(u)).toEqual([]);
  });

  it('provider ausente é claude; codex continua codex', () => {
    const u = project(input([room('/p/a')], [agent('m1', '/p/a'), agent('m2', '/p/a', { provider: 'codex' })]), new FakeIds(), NOW);
    expect(agentsOf(u).map((a) => a.provider).sort()).toEqual(['claude', 'codex']);
  });

  it('tokens só com tokensVisible, arredondados a 2 algarismos', () => {
    const base = input([room('/p/a')], [agent('m1', '/p/a')], { tokens: { day: 1_234_567, week: 98_765_432.7 } });
    expect(project(base, new FakeIds(), NOW).tokens).toEqual({ day: 1_200_000, week: 99_000_000 });
    expect(project({ ...base, options: { ...base.options, tokensVisible: false } }, new FakeIds(), NOW).tokens).toBeUndefined();
    expect(project({ ...base, tokens: undefined }, new FakeIds(), NOW).tokens).toBeUndefined();
    expect([0, -5, NaN, 7, 99, 100, 149, 150, 12_345, 850_123, 1e16].map(roundTokens)).toEqual([0, 0, 0, 7, 99, 100, 150, 150, 12_000, 850_000, 1e15]);
  });

  it('compacted só com o opt-in e só para quem compactou', () => {
    const agents = [agent('m1', '/p/a'), agent('m2', '/p/a')];
    const ids = new FakeIds();
    const on = project(input([room('/p/a')], agents, { options: { compactions: true, tokensVisible: true }, compacted: new Set(['m1']) }), ids, NOW);
    const flagged = agentsOf(on).filter((a) => a.compacted);
    expect(flagged.map((a) => a.id)).toEqual([ids.agents.get('m1')]);
    const off = project(input([room('/p/a')], agents, { compacted: new Set(['m1']) }), ids, NOW);
    expect(JSON.stringify(off)).not.toContain('compacted');
  });

  it('tasksDone: faixa das concluídas no dia (a contagem do chamador vale sobre a lista)', () => {
    expect([0, 1, 2, 3, 5, 6, 40, -1, NaN].map(tasksBand)).toEqual([0, 1, 1, 2, 2, 3, 3, 0, 0]);
    const done = (n: number) => Array.from({ length: n }, (_, i) => ({ id: String(i), title: 'x', status: 'completed' as const }));
    const agents = [agent('m1', '/p/a', { tasks: done(4) }), agent('m2', '/p/a', { tasks: done(1) })];
    const ids = new FakeIds();
    const u = project(input([room('/p/a')], agents, { tasksToday: new Map([['m2', 9]]) }), ids, NOW);
    const by = new Map(agentsOf(u).map((a) => [a.id, a.tasksDone]));
    expect(by.get(ids.agents.get('m1')!)).toBe(2);
    expect(by.get(ids.agents.get('m2')!)).toBe(3);
  });

  it('tema e versão como vieram', () => {
    const u = project(input([], [], { theme: 'halloween', version: '1.2.3' }), new FakeIds(), NOW);
    expect(u).toEqual({ v: 1, version: '1.2.3', theme: 'halloween', floors: [] });
  });
});

describe('projeção: limites', () => {
  it('64 andares no máximo; o resto fica de fora e é avisado', () => {
    const rooms = Array.from({ length: 70 }, (_, i) => room(`/p/${i}`));
    const r = projectWithReport(input(rooms, rooms.map((x, i) => agent(`m${i}`, x.id))), new FakeIds(), NOW);
    expect(r.uplink.floors).toHaveLength(UPLINK_LIMITS.floors);
    expect(r.truncated).toEqual({ floors: 6, agents: 6 });
    expect(validate(r.uplink)).toEqual([]);
  });

  it('64 agentes por andar; principais ficam, subagentes saem primeiro', () => {
    const agents = [
      ...Array.from({ length: 50 }, (_, i) => agent(`m${i}`, '/p/a')),
      ...Array.from({ length: 30 }, (_, i) => agent(`s${i}`, '/p/a', { kind: 'sub', parentId: `m${i}` })),
    ];
    const r = projectWithReport(input([room('/p/a')], agents), new FakeIds(), NOW);
    const list = agentsOf(r.uplink);
    expect(list).toHaveLength(64);
    expect(list.filter((a) => a.kind === 'main')).toHaveLength(50);
    expect(r.truncated).toEqual({ floors: 0, agents: 16 });
  });

  it('256 agentes no total e 64 KB: corta, continua válido e nenhum subagente aponta para fora do pacote', () => {
    const rooms = Array.from({ length: 10 }, (_, i) => room(`/p/${i}`));
    const agents = rooms.flatMap((r, i) => [
      ...Array.from({ length: 15 }, (_, j) => agent(`m${i}-${j}`, r.id, { look: j % 2 ? 'f' : 'm' })),
      ...Array.from({ length: 20 }, (_, j) => agent(`s${i}-${j}`, r.id, { kind: 'sub', parentId: `m${i}-${j % 15}` })),
    ]);
    const r = projectWithReport(input(rooms, agents, { tokens: { day: 1, week: 2 } }), new FakeIds(), NOW);
    const list = agentsOf(r.uplink);
    expect(list.length).toBeLessThanOrEqual(UPLINK_LIMITS.agentsTotal);
    expect(r.bytes).toBe(uplinkBytes(r.uplink));
    expect(r.bytes).toBeLessThanOrEqual(UPLINK_LIMITS.bytes);
    expect(r.truncated!.agents).toBe(350 - list.length);
    expect(validate(r.uplink)).toEqual([]);
    const present = new Set(list.map((a) => a.id));
    for (const a of list) if (a.parentId) expect(present).toContain(a.parentId);
    for (const f of r.uplink.floors) expect(f.agents.length).toBeGreaterThan(0);
  });

  it('um escritório comum (3 projetos, 5 agentes) cabe em uns 2 KB e não é cortado', () => {
    const rooms = [room('/p/a'), room('/p/b'), room('/p/c')];
    const agents = [agent('m1', '/p/a'), agent('s1', '/p/a', { kind: 'sub', parentId: 'm1' }), agent('m2', '/p/b'), agent('m3', '/p/c'), agent('m4', '/p/c')];
    const r = projectWithReport(input(rooms, agents, { tokens: { day: 850_000, week: 12_000_000 } }), new FakeIds(), NOW);
    expect(r.truncated).toBeUndefined();
    expect(r.bytes).toBeLessThan(2600);
  });
});
