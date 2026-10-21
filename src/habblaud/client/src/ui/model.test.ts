import { describe, expect, it } from 'vitest';
import type { AccountInfo, AgentInfo, RoomInfo, ShellJob } from '../../../shared/types';
import {
  accountsOf,
  activityFallback,
  aggregateTasks,
  computeCounters,
  displayStatus,
  FOREGROUND_WAIT_MS,
  groupRooms,
  hasRunningShells,
  matchesQuery,
  mergeHistory,
  roleLabel,
  SHELL_STAGES,
  shellBoxText,
  shellDoneKind,
  shellKindLabel,
  shellLine,
  shellStage,
  shellWait,
  shellWaitIn,
  shellWaitingAgents,
  shortcutHint,
  sortByUrgency,
  statusLabel,
  visibleShells,
  waitingAgents,
} from './model';

function agent(p: Partial<AgentInfo> & Pick<AgentInfo, 'id' | 'roomId'>): AgentInfo {
  return {
    kind: 'main',
    name: p.id,
    look: 'f',
    role: p.kind === 'sub' ? 'Explore' : 'Agente principal',
    sessionId: `s-${p.id}`,
    account: '.claude',
    status: 'working',
    recent: [],
    tasks: [],
    startedAt: 0,
    lastEventAt: 0,
    statusSince: 0,
    stats: { toolCalls: 0, tokensIn: 0, tokensOut: 0, subagents: 0 },
    seed: 1,
    ...p,
  };
}

function room(id: string, slot: number, path = `/Users/dev/projetos/${id}`): RoomInfo {
  return { id, name: id, path, slot, seed: slot, createdAt: 0 };
}

const accounts: AccountInfo[] = [
  { id: '.claude', short: 'C', name: 'Conta C', email: 'dev@empresa.example', color: '#f08a3c', configDir: '~/.claude', sessions: 1, usageStatus: 'ok' },
  { id: '.claude-conta2', short: 'D', name: 'Conta D', email: 'eu@pessoal.example', color: '#4aa8e8', configDir: '~/.claude-conta2', sessions: 1, usageStatus: 'disabled' },
];

const rooms = [room('loja', 2), room('api', 0), room('site', 1)];
const agents: AgentInfo[] = [
  agent({ id: 'marina', name: 'Marina', roomId: 'api', startedAt: 10, status: 'waiting', statusSince: 50 }),
  agent({ id: 'joao', name: 'João', roomId: 'api', startedAt: 5, account: '.claude-conta2', tasks: [{ id: '1', title: 'a', status: 'completed' }, { id: '2', title: 'b', status: 'in_progress' }] }),
  agent({ id: 'sub1', name: 'Bruno', kind: 'sub', parentId: 'joao', roomId: 'api', startedAt: 20, role: 'Explore', account: '.claude-conta2' }),
  agent({ id: 'sub2', name: 'Clara', kind: 'sub', parentId: 'joao', roomId: 'api', startedAt: 15, role: 'Plan', status: 'done', account: '.claude-conta2' }),
  agent({ id: 'orfao', name: 'Diego', kind: 'sub', parentId: 'sumiu', roomId: 'site', startedAt: 1 }),
  agent({ id: 'saindo', name: 'Elisa', roomId: 'loja', status: 'offline', tasks: [{ id: '1', title: 'x', status: 'pending' }] }),
  agent({ id: 'ana', name: 'Ana', roomId: 'loja', status: 'waiting', statusSince: 20 }),
];
const snap = { rooms, agents, accounts };

describe('computeCounters', () => {
  it('conta salas, agentes presentes, trabalhando, subagentes ativos e esperando', () => {
    expect(computeCounters(snap)).toEqual({ rooms: 3, agents: 6, working: 3, subagents: 2, waiting: 2, shells: 0 });
    expect(computeCounters(null)).toEqual({ rooms: 0, agents: 0, working: 0, subagents: 0, waiting: 0, shells: 0 });
  });
  it('waitingAgents ordena por quem espera há mais tempo', () => {
    expect(waitingAgents(agents).map((a) => a.id)).toEqual(['ana', 'marina']);
  });
});

describe('groupRooms', () => {
  it('ordena salas por slot e aninha subagentes sob o pai', () => {
    const g = groupRooms(snap);
    expect(g.map((r) => r.room.id)).toEqual(['api', 'site', 'loja']);
    const api = g[0];
    expect(api.nodes.map((n) => n.agent.id)).toEqual(['joao', 'marina']);
    expect(api.nodes[0].subs.map((s) => s.id)).toEqual(['sub2', 'sub1']);
    expect(api.nodes[0].subTotal).toBe(2);
    expect(api.accounts).toEqual(['.claude', '.claude-conta2']);
    expect(api.tasks).toEqual({ completed: 1, inProgress: 1, total: 2 });
  });
  it('subagente sem pai na sala vira item de primeiro nível', () => {
    const site = groupRooms(snap).find((r) => r.room.id === 'site')!;
    expect(site.nodes.map((n) => n.agent.id)).toEqual(['orfao']);
  });
  it('filtra por texto sem acentos (nome do subagente mantém o pai como contexto)', () => {
    const g = groupRooms(snap, { query: 'bruno', hiddenAccounts: new Set() });
    expect(g.map((r) => r.room.id)).toEqual(['api']);
    expect(g[0].nodes.map((n) => n.agent.id)).toEqual(['joao']);
    expect(g[0].nodes[0].subs.map((s) => s.id)).toEqual(['sub1']);
    expect(g[0].matches).toBe(1);
  });
  it('se o principal bate, mostra todos os subagentes', () => {
    const g = groupRooms(snap, { query: 'joao', hiddenAccounts: new Set() });
    expect(g[0].nodes[0].subs).toHaveLength(2);
  });
  it('busca por sala/caminho e por conta', () => {
    expect(groupRooms(snap, { query: 'projetos/loja', hiddenAccounts: new Set() }).map((r) => r.room.id)).toEqual(['loja']);
    const byAccount = groupRooms(snap, { query: 'pessoal', hiddenAccounts: new Set() });
    expect(byAccount.flatMap((r) => r.nodes.map((n) => n.agent.id))).toEqual(['joao']);
  });
  it('oculta contas desligadas no filtro', () => {
    const g = groupRooms(snap, { query: '', hiddenAccounts: new Set(['.claude-conta2']) });
    const api = g.find((r) => r.room.id === 'api')!;
    expect(api.nodes.map((n) => n.agent.id)).toEqual(['marina']);
    const onlyD = groupRooms(snap, { query: '', hiddenAccounts: new Set(['.claude']) });
    expect(onlyD.map((r) => r.room.id)).toEqual(['api']);
  });
  it('sem snapshot devolve lista vazia', () => {
    expect(groupRooms(null)).toEqual([]);
  });
});

describe('utilidades', () => {
  it('matchesQuery exige todos os termos', () => {
    const a = agents[0];
    expect(matchesQuery(a, rooms[1], accounts[0], 'marina api')).toBe(true);
    expect(matchesQuery(a, rooms[1], accounts[0], 'marina loja')).toBe(false);
    expect(matchesQuery(a, rooms[1], accounts[0], '   ')).toBe(true);
  });
  it('roleLabel', () => {
    expect(roleLabel({ kind: 'main', role: 'Agente principal' })).toBe('Agente principal');
    expect(roleLabel({ kind: 'sub', role: '' })).toBe('Subagente');
  });
  it('aggregateTasks soma tarefas de vários agentes', () => {
    expect(aggregateTasks(agents)).toEqual({ completed: 1, inProgress: 1, total: 3 });
  });
  it('accountsOf respeita a ordem das contas', () => {
    expect(accountsOf([{ account: '.claude-conta2' }, { account: '.claude' }, { account: 'x' }], accounts)).toEqual(['.claude', '.claude-conta2', 'x']);
  });
  it('sortByUrgency coloca quem precisa de você primeiro', () => {
    expect(sortByUrgency(agents.filter((a) => a.roomId === 'api')).map((a) => a.id)).toEqual(['marina', 'joao', 'sub1', 'sub2']);
  });
  it('shortcutHint', () => {
    expect(shortcutHint(accounts)).toBe('atalhos c ou d');
    expect(shortcutHint([accounts[0]])).toBe('atalho c');
    expect(shortcutHint([{ short: 'C' }, { short: 'D' }, { short: 'E' }])).toBe('atalhos c, d ou e');
    expect(shortcutHint([])).toBe('');
  });
  it('mergeHistory deduplica e ordena por horário', () => {
    const h = [
      { id: 'a', at: 1 },
      { id: 'b', at: 3 },
    ];
    const r = [
      { id: 'b', at: 3 },
      { id: 'c', at: 2 },
    ];
    expect(mergeHistory(h, r).map((x) => x.id)).toEqual(['a', 'c', 'b']);
    expect(mergeHistory(h, r, 2).map((x) => x.id)).toEqual(['c', 'b']);
  });
  it('mergeHistory no replay descarta atividades posteriores ao instante', () => {
    // Selecionou o agente em t=2000 (atividade final já no histórico) e voltou para t=1000:
    // o snapshot só traz a de 1000, mas a de 2000 não pode continuar na gaveta.
    const acumulado = [
      { id: 'a', at: 1000 },
      { id: 'b', at: 2000 },
    ];
    const noInstante = [{ id: 'a', at: 1000 }];
    expect(mergeHistory(acumulado, noInstante).map((x) => x.id)).toEqual(['a', 'b']);
    expect(mergeHistory(acumulado, noInstante, 200, 1000).map((x) => x.id)).toEqual(['a']);
    // Resposta do histórico ao vivo que ainda traz o futuro: no instante do replay ela também sai.
    const respostaAoVivo = [
      { id: 'a', at: 1000 },
      { id: 'c', at: 500 },
      { id: 'b', at: 2000 },
    ];
    expect(mergeHistory(noInstante, respostaAoVivo, 200, 1000).map((x) => x.id)).toEqual(['c', 'a']);
  });
});

describe('activityFallback', () => {
  it('sem atividade ainda: texto pelo status, nunca "Chegando…" para quem já está sentado', () => {
    expect(activityFallback({ status: 'idle' })).toBe('Aguardando instruções');
    expect(activityFallback({ status: 'working' })).toBe('Trabalhando…');
    expect(activityFallback({ status: 'waiting', waitingFor: 'aprovar uma permissão' })).toBe('Precisa de você: aprovar uma permissão');
    expect(activityFallback({ status: 'waiting' })).toBe('Precisa de você');
    expect(activityFallback({ status: 'shell' })).toBe('Esperando o shell terminar');
    expect(activityFallback({ status: 'done' })).toBe('Concluiu a tarefa');
    expect(activityFallback({ status: 'offline' })).toBe('Saindo do escritório');
  });
});

// ---------------------------------------------------------------- esperando o shell

const S = 1_000;
const MIN = 60 * S;
const NOW = 1_800_000_000_000;

function job(p: Partial<ShellJob> & Pick<ShellJob, 'id'>): ShellJob {
  return { label: `Comando ${p.id}`, startedAt: NOW - MIN, background: true, kind: 'shell', ...p };
}

describe('shellWait', () => {
  it("status 'shell': todos os comandos, o tempo é o do shell mais antigo", () => {
    const w = shellWait(
      {
        status: 'shell',
        statusSince: NOW - 5 * S,
        shells: [job({ id: 'b2', startedAt: NOW - 2 * MIN }), job({ id: 'b1', label: 'Rodar a suíte', startedAt: NOW - 12 * MIN })],
      },
      NOW,
    )!;
    expect(w.jobs.map((j) => j.id)).toEqual(['b1', 'b2']);
    expect(w.main?.label).toBe('Rodar a suíte');
    expect(w.since).toBe(NOW - 12 * MIN);
    expect(w.foreground).toBe(false);
  });
  it('monitor mais antigo não dirige o tempo quando há um shell', () => {
    const w = shellWait(
      { status: 'shell', statusSince: NOW, shells: [job({ id: 'm', kind: 'monitor', startedAt: NOW - 60 * MIN }), job({ id: 'b', startedAt: NOW - MIN })] },
      NOW,
    )!;
    expect(w.main?.id).toBe('b');
    expect(w.since).toBe(NOW - MIN);
    expect(w.jobs).toHaveLength(2);
  });
  it("status 'shell' sem comandos conhecidos usa statusSince", () => {
    const w = shellWait({ status: 'shell', statusSince: NOW - 30 * S }, NOW)!;
    expect(w.jobs).toEqual([]);
    expect(w.main).toBeUndefined();
    expect(w.since).toBe(NOW - 30 * S);
  });
  it('trabalhando: só comandos em primeiro plano rodando há mais de 10 s', () => {
    const fresh = job({ id: 'f', background: false, startedAt: NOW - 3 * S });
    const long = job({ id: 'l', background: false, startedAt: NOW - FOREGROUND_WAIT_MS });
    const bg = job({ id: 'bg', startedAt: NOW - 20 * MIN });
    expect(shellWait({ status: 'working', statusSince: 0, shells: [fresh, bg] }, NOW)).toBeNull();
    const w = shellWait({ status: 'working', statusSince: 0, shells: [fresh, long, bg] }, NOW)!;
    expect(w.jobs.map((j) => j.id)).toEqual(['l']);
    expect(w.foreground).toBe(true);
  });
  it('outros status nunca esperam shell; início no futuro (relógio adiantado) não passa de agora', () => {
    expect(shellWait({ status: 'idle', statusSince: 0, shells: [job({ id: 'x' })] }, NOW)).toBeNull();
    expect(shellWait({ status: 'waiting', statusSince: 0, shells: [job({ id: 'x' })] }, NOW)).toBeNull();
    expect(shellWait({ status: 'shell', statusSince: 0, shells: [job({ id: 'x', startedAt: NOW + 5 * S })] }, NOW)!.since).toBe(NOW);
  });
  it('displayStatus mostra o comando longo em primeiro plano como "Esperando o shell"', () => {
    const long = job({ id: 'l', background: false, startedAt: NOW - 15 * S });
    expect(displayStatus({ status: 'working', statusSince: 0, shells: [long] }, NOW)).toBe('shell');
    expect(displayStatus({ status: 'working', statusSince: 0, shells: [] }, NOW)).toBe('working');
    expect(displayStatus({ status: 'shell', statusSince: 0 }, NOW)).toBe('shell');
    expect(statusLabel('shell')).toBe('Esperando o shell');
  });
});

describe('contagem e ordem com shells', () => {
  const shellRoom = [room('mega', 0)];
  const list: AgentInfo[] = [
    agent({ id: 'beatriz', roomId: 'mega', status: 'shell', statusSince: NOW - MIN, shells: [job({ id: 'b1', startedAt: NOW - 8 * MIN }), job({ id: 'b2' })] }),
    agent({ id: 'caio', roomId: 'mega', status: 'working', startedAt: 2, shells: [job({ id: 'fg', background: false, startedAt: NOW - 30 * S })] }),
    agent({ id: 'dani', roomId: 'mega', status: 'working', startedAt: 3, shells: [job({ id: 'fg2', background: false, startedAt: NOW - 2 * S })] }),
    agent({ id: 'eva', roomId: 'mega', status: 'shell', startedAt: 4, statusSince: NOW - 3 * S }),
    agent({ id: 'fora', roomId: 'mega', status: 'offline', shells: [job({ id: 'z' })] }),
    agent({ id: 'gabi', roomId: 'mega', status: 'waiting', startedAt: 5 }),
  ];
  it('computeCounters conta os shells esperados e tira do "trabalhando" quem está parado num comando longo', () => {
    expect(computeCounters({ rooms: shellRoom, agents: list }, NOW)).toEqual({ rooms: 1, agents: 5, working: 1, subagents: 0, waiting: 1, shells: 4 });
  });
  it('shellWaitingAgents: de quem espera há mais tempo para o mais recente', () => {
    expect(shellWaitingAgents(list, NOW).map((a) => a.id)).toEqual(['beatriz', 'caio', 'eva']);
  });
  it('sortByUrgency: "precisa de você" > "esperando o shell" > "trabalhando"', () => {
    expect(sortByUrgency(list).map((a) => a.id)).toEqual(['gabi', 'beatriz', 'eva', 'caio', 'dani', 'fora']);
  });
  it('hasRunningShells liga o cronômetro só com shells rodando', () => {
    expect(hasRunningShells({ agents: list })).toBe(true);
    expect(hasRunningShells({ agents: [agent({ id: 'x', roomId: 'mega', status: 'idle' })] })).toBe(false);
    expect(hasRunningShells({ agents: [agent({ id: 'x', roomId: 'mega', status: 'offline', shells: [job({ id: 'z' })] })] })).toBe(false);
    expect(hasRunningShells(null)).toBe(false);
  });
  it('visibleShells esconde comandos em primeiro plano recém-iniciados', () => {
    const a = { shells: [job({ id: 'novo', background: false, startedAt: NOW - 500 }), job({ id: 'mon', kind: 'monitor', startedAt: NOW - 100 }), job({ id: 'bg', startedAt: NOW - 5 * MIN })] };
    expect(visibleShells(a, NOW).map((j) => j.id)).toEqual(['bg', 'mon']);
    expect(visibleShells({}, NOW)).toEqual([]);
  });
  it('a busca encontra o agente pelo shell que ele espera', () => {
    const a = agent({ id: 'b', roomId: 'mega', status: 'shell', shells: [job({ id: 'b1', label: 'Rodar a suíte completa com phpunit' })] });
    expect(matchesQuery(a, shellRoom[0], undefined, 'phpunit')).toBe(true);
    expect(matchesQuery(a, shellRoom[0], undefined, 'esperando shell')).toBe(true);
    expect(matchesQuery(agent({ id: 'x', roomId: 'mega', status: 'idle' }), shellRoom[0], undefined, 'shell')).toBe(false);
  });
});

describe('shellWaitIn', () => {
  const main = agent({ id: 'm', roomId: 'mega', status: 'shell', statusSince: NOW - 10 * S });
  const sub = agent({ id: 's', kind: 'sub', parentId: 'm', roomId: 'mega', status: 'done', shells: [job({ id: 'b1', label: 'Build do sub', startedAt: NOW - 4 * MIN })] });
  const neto = agent({ id: 'n', kind: 'sub', parentId: 's', roomId: 'mega', status: 'working', shells: [job({ id: 'b2', startedAt: NOW - MIN }), job({ id: 'fg', background: false, startedAt: NOW - 2 * S })] });
  it('sem shells próprios, usa os de segundo plano dos subagentes (em qualquer nível)', () => {
    const w = shellWaitIn(main, [main, sub, neto], NOW)!;
    expect(w.jobs.map((j) => j.id)).toEqual(['b1', 'b2']);
    expect(w.main?.label).toBe('Build do sub');
    expect(w.since).toBe(NOW - 4 * MIN);
  });
  it('com shells próprios (ou fora do status shell), ignora os subagentes', () => {
    const own = { ...main, shells: [job({ id: 'meu' })] };
    expect(shellWaitIn(own, [own, sub], NOW)!.jobs.map((j) => j.id)).toEqual(['meu']);
    expect(shellWaitIn({ ...main, status: 'idle' }, [main, sub], NOW)).toBeNull();
    expect(shellWaitIn(main, [main], NOW)!.jobs).toEqual([]);
  });
  it('computeCounters conta os shells herdados', () => {
    expect(computeCounters({ rooms: [room('mega', 0)], agents: [main, sub] }, NOW).shells).toBe(1);
    expect(computeCounters({ rooms: [room('mega', 0)], agents: [main, sub, neto] }, NOW).shells).toBe(2);
  });
});

describe('textos da espera', () => {
  it('shellLine: "⏳ <label> · <tempo>" e "×N" com vários', () => {
    const one = shellLine({ jobs: [job({ id: 'a', label: 'Rodar testes' })], main: job({ id: 'a', label: 'Rodar testes' }), since: NOW - 75 * S, foreground: false }, NOW);
    expect(one).toEqual({ label: 'Rodar testes', time: '1:15', count: '', text: '⏳ Rodar testes · 1:15' });
    const two = shellLine({ jobs: [job({ id: 'a' }), job({ id: 'b' })], main: job({ id: 'a', label: 'Build' }), since: NOW - 62 * MIN, foreground: false }, NOW);
    expect(two.count).toBe('×2');
    expect(two.time).toBe('1:02:00');
    expect(two.text).toBe('⏳ Build · 1:02:00 (2 shells)');
  });
  it('shellLine sem comandos conhecidos usa um texto genérico', () => {
    expect(shellLine({ jobs: [], since: NOW, foreground: false }, NOW).label).toBe('Esperando o shell terminar');
    expect(shellLine({ jobs: [], since: NOW, foreground: true }, NOW).label).toBe('Esperando o comando terminar');
  });
  it('shellBoxText explica o que está acontecendo', () => {
    expect(shellBoxText({ foreground: false, jobs: [job({ id: 'a' })] })).toMatch(/^Terminou o turno e está esperando o shell terminar\./);
    expect(shellBoxText({ foreground: false, jobs: [job({ id: 'a' }), job({ id: 'b' })] })).toMatch(/esperando 2 shells terminarem/);
    expect(shellBoxText({ foreground: true, jobs: [] })).toMatch(/parado num comando/);
  });
  it('shellKindLabel', () => {
    expect(shellKindLabel({ kind: 'shell', background: true })).toBe('segundo plano');
    expect(shellKindLabel({ kind: 'shell', background: false })).toBe('primeiro plano');
    expect(shellKindLabel({ kind: 'monitor', background: true })).toBe('monitor');
  });
  it('shellStage segue a escalada: pipoca, giro na cadeira, teia, cochilo', () => {
    expect(SHELL_STAGES.map((s) => s.stage)).toEqual(['popcorn', 'spin', 'cobweb', 'nap']);
    expect(shellStage(0)).toMatchObject({ stage: 'popcorn', nextIn: 3 * MIN });
    expect(shellStage(3 * MIN - 1).stage).toBe('popcorn');
    expect(shellStage(3 * MIN)).toMatchObject({ stage: 'spin', nextIn: 7 * MIN });
    expect(shellStage(10 * MIN).stage).toBe('cobweb');
    expect(shellStage(24 * MIN + 59 * S)).toMatchObject({ stage: 'cobweb', nextIn: S });
    expect(shellStage(25 * MIN)).toMatchObject({ stage: 'nap', nextIn: null });
    expect(shellStage(-5 * S).stage).toBe('popcorn');
  });
  it('shellDoneKind reconhece o marcador ShellDone do servidor', () => {
    expect(shellDoneKind({ tool: 'ShellDone' })).toBe('ok');
    expect(shellDoneKind({ tool: 'ShellDone', error: true })).toBe('fail');
    expect(shellDoneKind({ tool: 'Bash', error: true })).toBeNull();
    expect(shellDoneKind(undefined)).toBeNull();
  });
});
