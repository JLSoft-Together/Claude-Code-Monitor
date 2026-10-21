// Integração da fonte do Codex: um CODEX_HOME temporário (rollouts e locks sintéticos), o AccountsService e o Office.
import { mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentInfo, Notice } from '../../../shared/types';
import { AccountsService } from '../../accounts/service';
import { log, setQuiet } from '../../log';
import { NameStore } from '../../model/names';
import { Office } from '../../model/office';
import { codexHome, R, SOURCES, threadId } from '../../test/codex-fixtures';
import { MAX_LINE_BYTES } from '../tail';
import { CodexSource, scanPrefix } from './source';

setQuiet(true);

const T = threadId(1);
const C = threadId(2);
const KEY = `.codex:${T}`;

let cleanups: Array<() => void> = [];
afterEach(() => {
  for (const c of cleanups) c();
  cleanups = [];
});

function setup(opts: { names?: string[]; noLocks?: boolean; env?: (dirs: string[]) => NodeJS.ProcessEnv } = {}) {
  const homes = (opts.names ?? ['.codex']).map((n) => codexHome(n));
  const home = homes[0];
  cleanups.push(...homes.map((h) => h.cleanup));
  if (opts.noLocks) rmSync(join(home.dir, 'thread-writer-locks'), { recursive: true });
  let clock = Date.now();
  const now = () => clock;
  const late: { office?: Office } = {};
  const accounts = new AccountsService({ dirs: [], home: home.home, env: {}, now, onChange: () => late.office?.markDirty() });
  const office = new Office({
    names: new NameStore(null),
    version: 'teste',
    startedAt: clock,
    accounts: (s) => accounts.list(s),
    sources: () => [],
    accountName: (id) => accounts.find(id)?.detected.name,
    now,
  });
  late.office = office;
  const dirs = homes.map((h) => h.dir);
  const source = new CodexSource({ accounts, office, dirs, env: opts.env?.(dirs) ?? {}, home: home.home, now, watch: false });
  // Para antes de apagar as pastas (nenhum ciclo agendado roda depois).
  cleanups.unshift(() => source.stop());
  const notices: Notice[] = [];
  return {
    home,
    homes,
    accounts,
    office,
    source,
    notices,
    advance(ms: number) {
      clock += ms;
    },
    now,
    poll() {
      source.poll();
      office.tick();
      notices.push(...office.commit().notices);
    },
    agents(): AgentInfo[] {
      return office.commit().snapshot.agents;
    },
    agent(id = KEY): AgentInfo | undefined {
      return office.commit().snapshot.agents.find((a) => a.id === id);
    },
    hook(input: Record<string, unknown>, account?: string): boolean {
      return source.applyHookEvent(account, input);
    },
  };
}

describe('fonte do Codex: presença pelos locks', () => {
  it('lock + rollout: agente principal na sala do projeto, com título, modelo, branch, tokens e status', () => {
    const ctx = setup();
    const t0 = ctx.now();
    const path = ctx.home.rollout(T, [
      R.meta(T, { at: t0 - 50_000, cwd: '/projetos/loja', branch: 'feat/x' }),
      R.turnContext({ at: t0 - 49_000, model: 'gpt-teste-codex' }),
      R.taskStarted('turn1', t0 - 48_000),
      R.user(T, 'turn1', 'u1', 'Rode os testes da loja', t0 - 47_000),
      R.command(T, 'turn1', 'call_1', 'npm test', { at: t0 - 46_000, output: 'ok' }),
      R.tokens({ input: 2_000, cached: 1_500, output: 300, at: t0 - 45_000 }),
    ]);
    ctx.home.lock(T, t0 - 60_000);
    ctx.source.boot();
    const a = ctx.agent()!;
    expect(a).toMatchObject({
      kind: 'main',
      provider: 'codex',
      account: '.codex',
      sessionId: T,
      roomId: '/projetos/loja',
      role: 'Agente principal (Codex)',
      status: 'working',
      title: 'Rode os testes da loja',
      model: 'gpt-teste-codex',
      gitBranch: 'feat/x',
    });
    expect(a.stats).toMatchObject({ tokensIn: 2_000, tokensOut: 300, toolCalls: 1 });
    expect(a.activity?.text).toBe('Rodando testes');
    expect(ctx.source.sources()).toEqual([{ label: '.codex', provider: 'codex', path: ctx.home.dir, sessions: 1, ok: true }]);
    expect(ctx.source.transcriptPathOf(KEY)).toBe(path);
    expect(ctx.source.terminalParser(KEY)).toBeDefined();
    expect(ctx.accounts.list(new Map())[0]).toMatchObject({ id: '.codex', provider: 'codex', name: 'Codex', short: 'X' });

    // Turno concluído: ociosa.
    ctx.advance(1_000);
    ctx.home.append(path, [R.agent(T, 'turn1', 'a1', 'Todos passaram.', ctx.now()), R.taskComplete('turn1', ctx.now() + 1)]);
    ctx.poll();
    expect(ctx.agent()?.status).toBe('idle');
    expect(ctx.agent()?.activity?.kind).toBe('done');

    // Sem lock: fecha (depois da folga).
    ctx.home.unlock(T);
    ctx.poll();
    expect(ctx.agent()?.status).toBe('idle');
    ctx.advance(2_000);
    ctx.poll();
    expect(ctx.agent()?.status).toBe('offline');
    expect(ctx.notices.some((n) => n.text.includes('encerrou'))).toBe(true);
  });

  it('hook de thread revertido troca o rollout aberto e o caminho do terminal na hora', () => {
    const ctx = setup();
    const at = ctx.now() - 10_000;
    const old = ctx.home.rollout(T, [
      R.meta(T, { at }),
      R.taskStarted('t1', at),
      R.user(T, 't1', 'u1', 'Turno antigo', at + 1),
      R.command(T, 't1', 'c1', 'npm test', { at: at + 2 }),
      R.taskComplete('t1', at + 3),
    ], { mtime: at + 3 });
    ctx.home.lock(T, at);
    ctx.source.boot();
    expect(ctx.agent()).toMatchObject({ status: 'idle', title: 'Turno antigo', stats: { toolCalls: 1 } });
    const path = old.replace('.jsonl', `_${C}.jsonl`);
    writeFileSync(path, [
      R.meta(T, { at }),
      R.taskStarted('t2', ctx.now()),
      R.user(T, 't2', 'u2', 'Turno revertido', ctx.now() + 1),
    ].join('\n') + '\n');
    ctx.home.touch(path, ctx.now());
    expect(ctx.hook({ hook_event_name: 'SessionStart', session_id: T, transcript_path: path })).toBe(true);
    expect(ctx.source.transcriptPathOf(KEY)).toBe(realpathSync(path));
    expect(ctx.agent()).toMatchObject({ status: 'working', title: 'Turno revertido', stats: { toolCalls: 0 } });
    // Continua lendo só o novo: a escrita no antigo não encerra o turno revertido.
    ctx.home.append(old, [R.taskComplete('t1', ctx.now() + 2)]);
    ctx.poll();
    expect(ctx.agent()?.status).toBe('working');
    ctx.home.append(path, [R.taskComplete('t2', ctx.now() + 3)]);
    ctx.poll();
    expect(ctx.agent()?.status).toBe('idle');
  });

  it('rollout aberto pelo hook não é recarregado à toa (caminho com symlink, varredura e hook repetido)', () => {
    const ctx = setup();
    const at = ctx.now() - 10_000;
    const path = ctx.home.rollout(T, [R.meta(T, { at }), R.taskStarted('t1', at), R.user(T, 't1', 'u1', 'Turno', at + 1)], { mtime: at + 1 });
    ctx.home.lock(T, at);
    ctx.source.boot();
    // O tmpdir do macOS passa por symlink (/var -> /private/var): o índice guarda um caminho e o hook manda o outro.
    const load = vi.spyOn(ctx.source as unknown as { load: (...a: unknown[]) => void }, 'load');
    ctx.hook({ hook_event_name: 'UserPromptSubmit', session_id: T, transcript_path: path });
    ctx.advance(3_000);
    ctx.poll();
    ctx.hook({ hook_event_name: 'UserPromptSubmit', session_id: T, transcript_path: path });
    ctx.advance(30_000);
    ctx.poll();
    expect(load.mock.calls.length <= 1).toBe(true);
    load.mockRestore();
  });

  it.each([
    { date: '2026/10/09', wait: 3_000 },
    { date: '2026/01/02', wait: 30_000 },
  ])('sem hook, revalida o rollout de thread revertido em $date sem perder as leituras entre varreduras', ({ date, wait }) => {
    const ctx = setup();
    const at = ctx.now() - 10_000;
    const old = ctx.home.rollout(T, [R.meta(T, { at }), R.user(T, 't1', 'u1', 'Turno antigo', at + 1), R.taskComplete('t1', at + 2)], { date, mtime: at + 2 });
    // A pasta antiga fica fora da varredura dos dois dias mais recentes.
    ctx.home.rollout(threadId(3), [], { date: '2026/10/10' });
    ctx.home.rollout(threadId(4), [], { date: '2026/10/09' });
    ctx.home.lock(T, at);
    ctx.source.boot();
    expect(ctx.source.transcriptPathOf(KEY)).toBe(old);
    expect(ctx.agent()).toMatchObject({ status: 'idle', title: 'Turno antigo' });
    const path = old.replace('.jsonl', `_${C}.jsonl`);
    writeFileSync(path, [R.meta(T, { at }), R.taskStarted('t2', ctx.now()), R.user(T, 't2', 'u2', 'Turno revertido', ctx.now() + 1)].join('\n') + '\n');
    ctx.home.touch(path, ctx.now());
    // Antes da próxima varredura, o tail atual ainda recebe linhas normalmente.
    ctx.home.append(old, [R.command(T, 't1', 'c1', 'npm test', { at: at + 3 })]);
    ctx.home.touch(old, at + 3);
    ctx.poll();
    expect(ctx.agent()?.stats.toolCalls).toBe(1);
    expect(ctx.source.transcriptPathOf(KEY)).toBe(old);
    ctx.advance(wait);
    ctx.poll();
    expect(ctx.source.transcriptPathOf(KEY)).toBe(path);
    expect(ctx.agent()).toMatchObject({ status: 'working', title: 'Turno revertido', stats: { toolCalls: 0 } });
  });

  it('mantém o rollout em leitura quando seu mtime atual é mais novo que o de outro arquivo do thread', () => {
    const ctx = setup();
    const at = ctx.now() - 10_000;
    const path = ctx.home.rollout(T, [R.meta(T, { at }), R.user(T, 't1', 'u1', 'Turno atual', at + 1), R.taskComplete('t1', at + 2)], { mtime: at + 2 });
    ctx.home.lock(T, at);
    ctx.source.boot();
    const other = path.replace('.jsonl', `_${C}.jsonl`);
    writeFileSync(other, [R.meta(T, { at }), R.user(T, 't2', 'u2', 'Outro rollout', at + 3), R.taskComplete('t2', at + 4)].join('\n') + '\n');
    ctx.home.touch(other, at + 4);
    ctx.home.append(path, [R.taskStarted('t3', ctx.now())]);
    ctx.home.touch(path, ctx.now());
    ctx.advance(3_000);
    ctx.poll();
    expect(ctx.source.transcriptPathOf(KEY)).toBe(path);
    expect(ctx.agent()).toMatchObject({ status: 'working', title: 'Turno atual' });
  });

  it('lock rápido (manutenção) não vira sessão; o que persiste uns segundos, vira', () => {
    const ctx = setup();
    ctx.home.rollout(T, [R.meta(T, { at: ctx.now() - 3_600_000 }), R.user(T, 't', 'u', 'antiga', ctx.now() - 3_600_000)], { mtime: ctx.now() - 3_600_000 });
    ctx.source.boot();
    ctx.home.lock(T, ctx.now());
    ctx.poll();
    ctx.advance(1_000);
    ctx.poll();
    expect(ctx.agent()).toBeUndefined();
    ctx.home.unlock(T);
    ctx.advance(1_000);
    ctx.poll();
    expect(ctx.agent()).toBeUndefined();
    // Retomada de verdade: o lock fica.
    ctx.home.lock(T, ctx.now());
    ctx.poll();
    expect(ctx.agent()).toBeUndefined();
    ctx.advance(3_500);
    ctx.poll();
    expect(ctx.agent()?.status).toBe('idle');
  });

  it('lock velho de crash (rollout parado há mais de 12 h, sem hook) fica fora; escrita nova reabre', () => {
    const ctx = setup();
    const old = ctx.now() - 13 * 3600_000;
    const path = ctx.home.rollout(T, [R.meta(T, { at: old }), R.taskStarted('t', old), R.user(T, 't', 'u', 'oi', old)], { mtime: old });
    ctx.home.lock(T, old);
    ctx.source.boot();
    expect(ctx.agent()).toBeUndefined();
    ctx.advance(1_000);
    ctx.home.append(path, [R.taskStarted('t2', ctx.now()), R.user(T, 't2', 'u2', 'voltei', ctx.now())]);
    ctx.poll();
    expect(ctx.agent()).toMatchObject({ status: 'working' });
  });

  it('thread antigo retomado agora (lock novo, rollout parado há dias) aparece', () => {
    const ctx = setup();
    const old = ctx.now() - 3 * 86_400_000;
    ctx.home.rollout(T, [R.meta(T, { at: old, cwd: '/projetos/velho' }), R.user(T, 't', 'u', 'antigo', old), R.taskComplete('t', old + 10)], { mtime: old });
    ctx.home.lock(T, ctx.now() - 30_000);
    ctx.source.boot();
    expect(ctx.agent()).toMatchObject({ roomId: '/projetos/velho', status: 'idle', title: 'antigo' });
    // Lock sem rollout esquecido há mais de 12 h (crash antes do primeiro prompt): fora.
    ctx.home.lock(C, ctx.now() - 13 * 3600_000);
    ctx.poll();
    expect(ctx.agent(`.codex:${C}`)).toBeUndefined();
  });

  it('lock sem rollout (CLI aberta, ainda sem mensagem): fica fora até o projeto aparecer e entra direto na sala dele', () => {
    const ctx = setup();
    ctx.home.lock(T, ctx.now() - 20_000);
    ctx.source.boot();
    // O lock não diz a pasta: sem projeto, sem sala (nada de sala provisória).
    expect(ctx.agent()).toBeUndefined();
    expect(ctx.office.commit().snapshot.rooms).toEqual([]);
    ctx.home.rollout(T, [R.meta(T, { at: ctx.now(), cwd: '/projetos/api' }), R.taskStarted('t1', ctx.now()), R.user(T, 't1', 'u1', 'Comece', ctx.now())]);
    ctx.advance(3_100);
    ctx.poll();
    expect(ctx.agent()).toMatchObject({ roomId: '/projetos/api', status: 'working', title: 'Comece' });
    const rooms = ctx.office.commit().snapshot.rooms.map((r) => r.id);
    expect(rooms).toEqual(['/projetos/api']);
  });

  it('lock sem rollout: um hook que diz o projeto faz o agente entrar na hora, já na sala certa', () => {
    const ctx = setup();
    ctx.source.boot();
    ctx.home.lock(T, ctx.now() - 60_000);
    ctx.poll();
    expect(ctx.agent()).toBeUndefined();
    expect(ctx.hook({ hook_event_name: 'SessionStart', session_id: T, cwd: '/projetos/api', transcript_path: null, model: 'gpt-teste-codex', source: 'startup' })).toBe(true);
    expect(ctx.agent()).toMatchObject({ roomId: '/projetos/api', status: 'idle', provider: 'codex' });
  });

  it('threads internos (guardian, revisão) ficam fora', () => {
    const ctx = setup();
    const at = ctx.now() - 5_000;
    ctx.home.rollout(T, [R.meta(T, { at, source: SOURCES.guardian() }), R.taskStarted('t', at)]);
    ctx.home.rollout(C, [R.meta(C, { at, source: SOURCES.review() }), R.taskStarted('t', at)]);
    ctx.home.lock(T, at);
    ctx.home.lock(C, at);
    ctx.source.boot();
    expect(ctx.agents()).toEqual([]);
  });

  it('sem thread-writer-locks/: presença pelo rollout modificado nos últimos 30 min', () => {
    const ctx = setup({ noLocks: true });
    const old = ctx.now() - 2 * 3600_000;
    ctx.home.rollout(T, [R.meta(T, { at: ctx.now() - 60_000 }), R.user(T, 't', 'u', 'recente', ctx.now() - 60_000)]);
    ctx.home.rollout(C, [R.meta(C, { at: old }), R.user(C, 't', 'u', 'velha', old)], { mtime: old });
    ctx.source.boot();
    expect(ctx.agents().map((a) => a.id)).toEqual([KEY]);
  });
});

describe('fonte do Codex: subagentes', () => {
  it('subagente entra como sub do pai enquanto trabalha e entrega ao concluir o turno', () => {
    const ctx = setup();
    const at = ctx.now() - 10_000;
    ctx.home.rollout(T, [R.meta(T, { at }), R.taskStarted('p1', at), R.user(T, 'p1', 'u', 'Investigue com ajuda', at)]);
    const sub = ctx.home.rollout(C, [
      R.meta(C, { at: at + 1_000, sessionId: T, source: SOURCES.sub(T, 'explorer') }),
      R.taskStarted('s1', at + 1_000),
      R.user(C, 's1', 'su', 'Procure onde o login é validado', at + 1_100),
    ]);
    ctx.home.lock(T, at);
    ctx.home.lock(C, at + 1_000);
    ctx.source.boot();
    expect(ctx.agent(`.codex:${C}`)).toMatchObject({
      kind: 'sub',
      provider: 'codex',
      parentId: KEY,
      sessionId: C,
      role: 'Explorer',
      title: 'Procure onde o login é validado',
      status: 'working',
      roomId: '/projetos/loja',
    });
    ctx.advance(1_000);
    ctx.home.append(sub, [R.agent(C, 's1', 'sa', 'Está em auth.ts', ctx.now()), R.taskComplete('s1', ctx.now() + 1)]);
    ctx.poll();
    expect(ctx.agent(`.codex:${C}`)?.status).toBe('done');
    expect(ctx.notices.some((n) => n.text.includes('entregou'))).toBe(true);
    // Volta a trabalhar (o pai mandou outra tarefa).
    ctx.advance(1_000);
    ctx.home.append(sub, [R.taskStarted('s2', ctx.now())]);
    ctx.poll();
    expect(ctx.agent(`.codex:${C}`)?.status).toBe('working');
    // Lock sumiu: entrega e sai.
    ctx.home.unlock(C);
    ctx.poll();
    expect(ctx.agent(`.codex:${C}`)?.status).toBe('working');
    ctx.advance(2_000);
    ctx.poll();
    expect(ctx.agent(`.codex:${C}`)?.status).toBe('done');
    expect(ctx.agent()?.status).toBe('working');
  });

  it('subagente já ocioso ao subir não aparece', () => {
    const ctx = setup();
    const at = ctx.now() - 10_000;
    ctx.home.rollout(T, [R.meta(T, { at })]);
    ctx.home.rollout(C, [R.meta(C, { at, sessionId: T, source: SOURCES.sub(T) }), R.taskStarted('s', at), R.taskComplete('s', at + 10)]);
    ctx.home.lock(T, at);
    ctx.home.lock(C, at);
    ctx.source.boot();
    expect(ctx.agents().map((a) => a.id)).toEqual([KEY]);
  });
});

describe('fonte do Codex: uso do plano', () => {
  it('o rate_limits mais recente entre as sessões vai para a conta, com o plano; sem cota', () => {
    const ctx = setup();
    const at = ctx.now() - 60_000;
    ctx.home.rollout(T, [R.meta(T, { at }), R.tokens({ input: 1, output: 1, at, rateLimits: { primary: { used: 30 }, plan: 'pro' } })]);
    ctx.home.rollout(C, [R.meta(C, { at: at - 1_000 }), R.tokens({ input: 1, output: 1, at: at - 1_000, rateLimits: { primary: { used: 99 } } })]);
    ctx.home.lock(T, at);
    ctx.home.lock(C, at);
    ctx.source.boot();
    const acc = ctx.accounts.list(new Map())[0];
    expect(acc).toMatchObject({ id: '.codex', plan: 'Pro', usageStatus: 'ok', usage: { source: 'codex', fetchedAt: at, fiveHour: { utilization: 30 } } });
    const path = ctx.home.rollout(T, []);
    ctx.home.append(path, [R.tokens({ input: 1, output: 1, at: ctx.now(), rateLimits: { primary: null, secondary: null, reached: 'workspace_owner_credits_depleted' } })]);
    ctx.poll();
    expect(ctx.accounts.list(new Map())[0].usage).toEqual({ source: 'codex', fetchedAt: ctx.now(), noQuota: true });
  });

  it('conta sem sessão aberta: o uso do último rollout (com a idade dele)', () => {
    const ctx = setup();
    const at = ctx.now() - 2 * 3600_000;
    ctx.home.rollout(T, [R.meta(T, { at }), R.tokens({ input: 1, output: 1, at, rateLimits: { plan: 'plus' } })], { mtime: at });
    ctx.source.boot();
    expect(ctx.agents()).toEqual([]);
    expect(ctx.accounts.list(new Map())[0]).toMatchObject({ plan: 'Plus', usageStatus: 'stale', usage: { fetchedAt: at } });
  });

  it('conta sem sessão aberta: pula o rollout mais recente sem números e acha o uso numa pasta de data antiga', () => {
    const ctx = setup();
    const at = ctx.now() - 5 * 3600_000;
    // Sessão retomada: o arquivo fica na pasta da criação (antiga), mas foi mexido há pouco.
    ctx.home.rollout(T, [R.meta(T, { at }), R.tokens({ input: 1, output: 1, at, rateLimits: { plan: 'team' } })], { date: '2026/01/02', mtime: at });
    // Arquivada depois, sem nenhum token_count: é a mais recente, mas não diz nada do uso.
    const T3 = threadId(3);
    ctx.home.rollout(T3, [R.meta(T3, { at: at + 60_000 })], { archived: true, mtime: at + 60_000 });
    ctx.source.boot();
    expect(ctx.accounts.list(new Map())[0]).toMatchObject({ plan: 'Team', usageStatus: 'stale', usage: { source: 'codex', fetchedAt: at } });
  });
});

describe('fonte do Codex: eventos de hook', () => {
  const ev = (name: string, extra: Record<string, unknown> = {}) => ({
    hook_event_name: name,
    session_id: T,
    cwd: '/projetos/api',
    transcript_path: null,
    model: 'gpt-teste-codex',
    permission_mode: 'default',
    turn_id: 'turn1',
    ...extra,
  });

  it('SessionStart: o agente aparece já, na sala do cwd do evento, antes do lock e do rollout', () => {
    const ctx = setup();
    ctx.source.boot();
    expect(ctx.hook(ev('SessionStart', { source: 'startup' }))).toBe(true);
    expect(ctx.agent()).toMatchObject({ roomId: '/projetos/api', provider: 'codex', status: 'idle' });
  });

  it('prompt, ferramenta (sem duplicar com o item concluído), aprovação e fim do turno', () => {
    const ctx = setup();
    ctx.source.boot();
    expect(ctx.hook(ev('UserPromptSubmit', { prompt: 'rode os testes' }))).toBe(true);
    expect(ctx.agent()?.status).toBe('working');
    expect(ctx.hook(ev('PreToolUse', { tool_name: 'Bash', tool_use_id: 'call_7', tool_input: { command: 'npm test' } }))).toBe(true);
    expect(ctx.agent()?.activity).toMatchObject({ id: `${KEY}#call_7`, text: 'Rodando testes', tool: 'Bash' });
    expect(ctx.hook(ev('PermissionRequest', { tool_name: 'Bash', tool_input: { command: 'npm test', description: 'x' } }))).toBe(true);
    expect(ctx.agent()).toMatchObject({ status: 'waiting', waitingFor: 'aprovar um comando' });
    // O rollout aparece com a linha antiga do turno: não desfaz a espera.
    ctx.advance(10);
    const path = ctx.home.rollout(T, [R.meta(T, { at: ctx.now() - 5_000, cwd: '/projetos/api' }), R.taskStarted('turn1', ctx.now() - 4_000)]);
    ctx.home.lock(T, ctx.now() - 5_000);
    ctx.advance(3_100);
    ctx.poll();
    expect(ctx.agent()?.status).toBe('waiting');
    // Aprovou no terminal: o comando concluiu (mesmo call_id: não duplica a atividade).
    ctx.home.append(path, [R.command(T, 'turn1', 'call_7', 'npm test', { at: ctx.now(), output: 'ok' })]);
    ctx.poll();
    expect(ctx.agent()?.status).toBe('working');
    const recent = ctx.office.detail(KEY)!.history.filter((a) => a.id === `${KEY}#call_7`);
    expect(recent).toHaveLength(1);
    expect(ctx.hook(ev('PostToolUse', { tool_name: 'Bash', tool_use_id: 'call_7', tool_input: {}, tool_response: {} }))).toBe(true);
    expect(ctx.hook(ev('Stop', { stop_hook_active: false, last_assistant_message: 'ok' }))).toBe(true);
    expect(ctx.agent()?.status).toBe('idle');
  });

  it('apply_patch e MCP: as mesmas atividades do Claude Code', () => {
    const ctx = setup();
    ctx.source.boot();
    ctx.hook(ev('PreToolUse', { tool_name: 'apply_patch', tool_use_id: 'c1', tool_input: { command: '*** Begin Patch\n*** Update File: src/app.ts\n@@\n-a\n+b\n*** End Patch' } }));
    expect(ctx.agent()?.activity).toMatchObject({ text: 'Editando app.ts', tool: 'Edit' });
    ctx.hook(ev('PreToolUse', { tool_name: 'mcp__github__merge_pull_request', tool_use_id: 'c2', tool_input: { pullNumber: 3 } }));
    expect(ctx.agent()?.activity).toMatchObject({ text: 'GitHub: merge pull request', tool: 'mcp__github__merge_pull_request' });
  });

  it('agent_id vs session_id: o evento de subagente vai para o filho, que entra como sub do pai', () => {
    const ctx = setup();
    ctx.source.boot();
    ctx.hook(ev('SessionStart'));
    expect(ctx.hook(ev('SubagentStart', { agent_id: C, agent_type: 'worker' }))).toBe(true);
    expect(ctx.agent(`.codex:${C}`)).toMatchObject({ kind: 'sub', parentId: KEY, role: 'Worker', status: 'working' });
    expect(ctx.hook(ev('PreToolUse', { agent_id: C, agent_type: 'worker', tool_name: 'Bash', tool_use_id: 'c9', tool_input: { command: 'ls' } }))).toBe(true);
    expect(ctx.agent(`.codex:${C}`)?.activity?.id).toBe(`.codex:${C}#c9`);
    expect(ctx.agent()?.activity?.id).not.toBe(`${KEY}#c9`);
    expect(ctx.hook(ev('PermissionRequest', { agent_id: C, tool_name: 'Bash', tool_input: { command: 'rm x' } }))).toBe(true);
    expect(ctx.agent(`.codex:${C}`)?.status).toBe('waiting');
    expect(ctx.agent()?.status).not.toBe('waiting');
    expect(ctx.hook(ev('SubagentStop', { agent_id: C, agent_type: 'worker', stop_hook_active: false, agent_transcript_path: null }))).toBe(true);
    expect(ctx.agent(`.codex:${C}`)?.status).toBe('done');
  });

  it('evento desconhecido, sessão inválida ou sem conta que case: false', () => {
    const ctx = setup({ names: ['.codex', '.codex-trabalho'] });
    ctx.source.boot();
    expect(ctx.hook(ev('Desconhecido'))).toBe(false);
    expect(ctx.hook(ev('SessionStart', { session_id: 'nao-e-uuid' }))).toBe(false);
    // Duas contas e nada que diga qual: não casa.
    expect(ctx.hook(ev('SessionStart'))).toBe(false);
    // Pelo id da conta, pela pasta ou pelo transcript_path.
    expect(ctx.hook(ev('SessionStart'), '.codex-trabalho')).toBe(true);
    expect(ctx.agent(`.codex-trabalho:${T}`)?.account).toBe('.codex-trabalho');
    expect(ctx.hook(ev('SessionStart', { session_id: C }), ctx.homes[0].dir)).toBe(true);
    expect(ctx.agent(`.codex:${C}`)).toBeDefined();
    const T3 = threadId(3);
    const tp = join(ctx.homes[1].dir, 'sessions', '2026', '10', '09', `rollout-2026-10-09T09-00-00-${T3}.jsonl`);
    expect(ctx.hook(ev('SessionStart', { session_id: T3, transcript_path: tp }))).toBe(true);
    expect(ctx.agent(`.codex-trabalho:${T3}`)).toBeDefined();
    // SessionEnd de sessão que ninguém conhece: false.
    expect(ctx.hook(ev('SessionEnd', { session_id: threadId(4), reason: 'other' }), '.codex')).toBe(false);
  });

  it('subagente cujo primeiro evento é um pedido de aprovação entra já esperando', () => {
    const ctx = setup();
    ctx.source.boot();
    ctx.hook(ev('SessionStart'));
    expect(ctx.hook(ev('PermissionRequest', { agent_id: C, agent_type: 'worker', tool_name: 'Bash', tool_input: { command: 'rm -rf build' } }))).toBe(true);
    expect(ctx.agent(`.codex:${C}`)).toMatchObject({ kind: 'sub', parentId: KEY, status: 'waiting', waitingFor: 'aprovar um comando' });
  });

  it('Docker: o hook roda no host e casa a conta pela pasta do HOST (configDir) ou pelo transcript_path de lá', () => {
    const ctx = setup({
      names: ['.codex', '.codex-b'],
      env: (dirs) => ({
        HABBLAUD_ACCOUNTS: JSON.stringify([
          { id: '.codex', provider: 'codex', configDir: '/Users/host/.codex', mountDir: dirs[0], short: 'CX', name: 'Codex CX', color: '#111111' },
          { id: '.codex-b', provider: 'codex', configDir: '/Users/host/.codex-b', mountDir: dirs[1], short: 'CB', name: 'Codex CB', color: '#222222' },
        ]),
      }),
    });
    ctx.source.boot();
    expect(ctx.accounts.list(new Map()).map((a) => [a.id, a.configDir, a.short])).toEqual([
      ['.codex', '/Users/host/.codex', 'CX'],
      ['.codex-b', '/Users/host/.codex-b', 'CB'],
    ]);
    expect(ctx.source.sources().map((s) => s.path)).toEqual(['/Users/host/.codex', '/Users/host/.codex-b']);
    expect(ctx.hook(ev('SessionStart'), '/Users/host/.codex-b')).toBe(true);
    expect(ctx.agent(`.codex-b:${T}`)).toBeDefined();
    const tp = `/Users/host/.codex/sessions/2026/10/09/rollout-2026-10-09T09-00-00-${C}.jsonl`;
    expect(ctx.hook(ev('SessionStart', { session_id: C, transcript_path: tp }))).toBe(true);
    expect(ctx.agent(`.codex:${C}`)).toBeDefined();
  });

  it('a presença do hook dura 60 s sem lock; SessionEnd fecha', () => {
    const ctx = setup();
    ctx.source.boot();
    ctx.hook(ev('SessionStart'));
    ctx.advance(30_000);
    ctx.poll();
    expect(ctx.agent()?.status).toBe('idle');
    ctx.advance(31_000);
    ctx.poll();
    ctx.advance(2_000);
    ctx.poll();
    expect(ctx.agent()?.status).toBe('offline');
    // De novo, agora com lock: SessionEnd fecha quando o lock some (ou depois de 5 s).
    ctx.advance(30_000);
    ctx.poll();
    ctx.hook(ev('SessionStart'));
    ctx.home.lock(T, ctx.now() - 10_000);
    ctx.poll();
    expect(ctx.agent()?.status).toBe('idle');
    expect(ctx.hook(ev('SessionEnd', { reason: 'other' }))).toBe(true);
    ctx.poll();
    expect(ctx.agent()?.status).toBe('idle');
    ctx.advance(6_000);
    ctx.poll();
    expect(ctx.agent()?.status).toBe('offline');
  });

  it('Docker sem a pasta de locks montada: o hook dá presença; sem eventos por 60 s, sai', () => {
    const ctx = setup({ noLocks: true });
    ctx.source.boot();
    ctx.hook(ev('UserPromptSubmit', { prompt: 'x' }));
    expect(ctx.agent()?.status).toBe('working');
    ctx.advance(61_000);
    ctx.poll();
    ctx.advance(2_000);
    ctx.poll();
    expect(ctx.agent()?.status).toBe('offline');
  });
});

describe('fonte do Codex: contas', () => {
  it('duas contas: nomes "Codex X", letras e cores sem colidir; ids devolvidos pelo AccountsService', () => {
    const ctx = setup({ names: ['.codex', '.codex-trabalho'] });
    const list = ctx.accounts.list(new Map());
    expect(list.map((a) => [a.id, a.provider, a.short, a.name])).toEqual([
      ['.codex', 'codex', 'X', 'Codex X'],
      ['.codex-trabalho', 'codex', 'T', 'Codex T'],
    ]);
    expect(new Set(list.map((a) => a.color)).size).toBe(2);
    expect(ctx.source.accountEntries().map((e) => e.id)).toEqual(['.codex', '.codex-trabalho']);
  });

  it('rollout compactado (.zst) sozinho: ignorado (com aviso no log), a sessão fica fora por falta de projeto', () => {
    const ctx = setup();
    const dir = join(ctx.home.dir, 'sessions', '2026', '10', '01');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `rollout-2026-10-01T09-00-00-${T}.jsonl.zst`), Buffer.from([0x28, 0xb5, 0x2f, 0xfd, 0, 1, 2]));
    ctx.home.lock(T, ctx.now() - 60_000);
    ctx.source.boot();
    // Sem o rollout legível não há projeto: fica fora (um hook com o cwd o traria).
    expect(ctx.agent()).toBeUndefined();
    expect(ctx.source.transcriptPathOf(KEY)).toBeUndefined();
  });
});

describe('scanPrefix do Codex', () => {
  it('ignora linha acima do teto e lê as vizinhas', async () => {
    const dir = join(tmpdir(), `habblaud-codex-prefix-${process.pid}`);
    mkdirSync(dir, { recursive: true });
    const warn = vi.spyOn(log, 'warnOnce').mockImplementation(() => {});
    try {
      const file = join(dir, 'rollout.jsonl');
      const body = Buffer.concat([
        Buffer.from(`${R.turnContext({ model: 'antes' })}\n`),
        Buffer.from('{"timestamp":"2026-10-10T00:00:00.000Z","type":"turn_context","payload":{"model":"'),
        Buffer.alloc(MAX_LINE_BYTES, 0x6e),
        Buffer.from('"}}\n'),
        Buffer.from(`${R.taskStarted('t1')}\n`),
      ]);
      writeFileSync(file, body);
      const { state } = await scanPrefix(file, body.length, 'codex:teste', 0);
      // Booleano de propósito: o valor errado seria a linha gigante, e o diff não pode imprimi-la.
      expect(state.model === 'antes').toBe(true);
      expect(state.turnOpen).toBe(true);
      expect(warn).toHaveBeenCalledWith(`oversize-line:${file}`, expect.stringContaining('8 MiB'));
    } finally {
      warn.mockRestore();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
