// Integração: registro + transcript + subagentes em um config dir temporário.
import { mkdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentInfo, Notice } from '../../shared/types';
import { AccountsService } from '../accounts/service';
import { setQuiet } from '../log';
import { NameStore } from '../model/names';
import { Office } from '../model/office';
import { appendLines, L, tempDir, writeLines } from '../test/fixtures';
import { ClaudeWatcher, encodeCwd } from './watcher';

setQuiet(true);

const CWD = '/projetos/loja';

function setup(opts: { tailBytes?: number } = {}) {
  const tmp = tempDir();
  const home = tmp.dir;
  const dir = join(home, '.claude');
  mkdirSync(join(dir, 'sessions'), { recursive: true });
  mkdirSync(join(dir, 'projects'), { recursive: true });
  let clock = Date.now();
  const now = () => clock;
  const late: { office?: Office } = {};
  const accounts = new AccountsService({
    dirs: [dir],
    home,
    env: {},
    now,
    onChange: () => late.office?.markDirty(),
  });
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
  const alive = new Set<number>();
  const watcher = new ClaudeWatcher({ accounts, office, inDocker: false, now, isAlive: (pid) => alive.has(pid), watch: false, tailBytes: opts.tailBytes });
  const notices: Notice[] = [];

  const ctx = {
    tmp,
    dir,
    office,
    watcher,
    advance(ms: number) {
      clock += ms;
    },
    now,
    openSession(pid: number, sessionId: string, extra: Record<string, unknown> = {}) {
      alive.add(pid);
      writeFileSync(
        join(dir, 'sessions', `${pid}.json`),
        JSON.stringify({ pid, sessionId, cwd: CWD, startedAt: clock - 60_000, kind: 'interactive', status: 'busy', ...extra }),
      );
    },
    closeSession(pid: number) {
      alive.delete(pid);
      rmSync(join(dir, 'sessions', `${pid}.json`));
    },
    transcript(sessionId: string) {
      return join(dir, 'projects', encodeCwd(CWD), `${sessionId}.jsonl`);
    },
    subFile(sessionId: string, agentId: string, meta: Record<string, unknown>, lines: string[], runId?: string) {
      const base = join(dir, 'projects', encodeCwd(CWD), sessionId, 'subagents', ...(runId ? ['workflows', runId] : []));
      mkdirSync(base, { recursive: true });
      writeFileSync(join(base, `agent-${agentId}.meta.json`), JSON.stringify(meta));
      const path = join(base, `agent-${agentId}.jsonl`);
      writeLines(path, lines);
      return path;
    },
    poll() {
      watcher.poll();
      office.tick();
      notices.push(...office.commit().notices);
    },
    agents(): AgentInfo[] {
      return office.commit().snapshot.agents;
    },
    agent(id: string): AgentInfo | undefined {
      return office.commit().snapshot.agents.find((a) => a.id === id);
    },
    notices,
  };
  return ctx;
}

type Ctx = ReturnType<typeof setup>;

describe('ClaudeWatcher', () => {
  let c: Ctx;
  beforeEach(() => {
    c = setup();
  });
  afterEach(() => {
    c.watcher.stop();
    c.tmp.cleanup();
  });

  function bootWithSession(pid = 100, sid = 'sess-a') {
    writeLines(c.transcript(sid), [
      L.raw('ai-title', { aiTitle: 'Carrinho de compras' }),
      L.prompt('Arruma o total do carrinho', { at: c.now() - 5000 }),
      L.assistant([L.tool('r1', 'Read', { file_path: `${CWD}/src/Cart.tsx` })], { at: c.now() - 4000 }),
    ]);
    c.openSession(pid, sid);
    c.watcher.boot();
    c.notices.push(...c.office.commit().notices);
    return `.claude:${pid}`;
  }

  it('boot: sessão aberta vira agente principal com sala, título e atividade, sem avisos', () => {
    const id = bootWithSession();
    const snap = c.office.commit().snapshot;
    expect(snap.rooms).toHaveLength(1);
    expect(snap.rooms[0]).toMatchObject({ id: CWD, name: 'loja', slot: 0 });
    const a = c.agent(id)!;
    expect(a).toMatchObject({ kind: 'main', status: 'working', title: 'Carrinho de compras', role: 'Agente principal', account: '.claude', roomId: CWD });
    expect(a.activity?.text).toBe('Lendo Cart.tsx');
    expect(snap.accounts[0]).toMatchObject({ id: '.claude', short: 'A', sessions: 1 });
    expect(c.notices).toEqual([]);
    expect(c.office.recentFeed(10).map((f) => f.activity.kind)).toEqual(['prompt', 'read']);
  });

  it('acompanha appends do transcript e o status do registro', () => {
    const id = bootWithSession();
    appendLines(c.transcript('sess-a'), [L.assistant([L.tool('e1', 'Edit', { file_path: `${CWD}/src/Cart.tsx` })])]);
    c.poll();
    expect(c.agent(id)!.activity?.text).toBe('Editando Cart.tsx');
    c.openSession(100, 'sess-a', { status: 'waiting', waitingFor: 'permission' });
    c.poll();
    expect(c.agent(id)).toMatchObject({ status: 'waiting', waitingFor: 'aprovar uma permissão' });
    expect(c.notices.at(-1)?.text).toMatch(/^✋ .+ precisa de você em loja: aprovar uma permissão$/);
    c.openSession(100, 'sess-a', { status: 'busy' });
    c.poll();
    c.openSession(100, 'sess-a', { status: 'idle' });
    c.poll();
    const a = c.agent(id)!;
    expect(a.status).toBe('idle');
    expect(a.activity?.kind).toBe('done');
    expect(c.notices.at(-1)).toMatchObject({ level: 'success', text: `✅ ${a.name} concluiu em loja` });
  });

  it('publica os prompts antes e depois de um TodoWrite malformado no mesmo lote', () => {
    const id = bootWithSession();
    appendLines(c.transcript('sess-a'), [
      L.prompt('Prompt anterior'),
      L.assistant([L.tool('todo-malformado', 'TodoWrite', { todos: [null] })]),
      L.prompt('Prompt posterior'),
    ]);
    c.poll();
    expect(c.office.recentFeed(10).filter((f) => f.activity.kind === 'prompt').map((f) => f.activity.detail)).toEqual([
      'Arruma o total do carrinho', 'Prompt anterior', 'Prompt posterior',
    ]);
    expect(c.agent(id)!.activity?.detail).toBe('Prompt posterior');
    c.poll();
    expect(c.office.recentFeed(10).filter((f) => f.activity.detail === 'Prompt posterior')).toHaveLength(1);
  });

  it.each(['abertura', 'append'])('preserva as linhas válidas do subagente com TodoWrite malformado (%s)', (mode) => {
    bootWithSession();
    const path = c.subFile('sess-a', 'malformado', { agentType: 'Explore', description: 'Revisar tarefas' }, [L.prompt('Início', { agentId: 'malformado' })]);
    if (mode === 'append') c.poll();
    appendLines(path, [
      L.prompt('Prompt anterior', { agentId: 'malformado' }),
      L.assistant([L.tool('todo-malformado', 'TodoWrite', { todos: [null] })], { agentId: 'malformado' }),
      L.prompt('Prompt posterior', { agentId: 'malformado' }),
    ]);
    c.poll();
    expect(c.agent('sess-a:malformado')?.activity?.detail).toBe('Prompt posterior');
    expect(c.office.recentFeed(10).filter((f) => f.activity.kind === 'prompt' && f.agentId === 'sess-a:malformado').map((f) => f.activity.detail)).toEqual([
      'Início', 'Prompt anterior', 'Prompt posterior',
    ]);
  });

  it.each(['principal', 'abertura', 'append'])('registra erros de parse e publica as demais linhas do lote (%s)', (mode) => {
    const mainId = bootWithSession();
    const agentId = `erro-${mode}`;
    const id = mode === 'principal' ? mainId : `sess-a:${agentId}`;
    const path = mode === 'principal'
      ? c.transcript('sess-a')
      : c.subFile('sess-a', agentId, { agentType: 'Explore', description: 'Revisar CI' }, [L.prompt('Início', { agentId })]);
    if (mode === 'append') c.poll();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    setQuiet(false);
    try {
      appendLines(path, [
        L.prompt('Prompt anterior'),
        L.assistant([L.tool('checks-malformado', 'Bash', { command: 'gh pr checks --json name,bucket' })]),
        L.result('checks-malformado', '[{"bucket":{"toString":null}}]'),
        L.assistant([L.tool('checks-outro', 'Bash', { command: 'gh pr checks --json name,bucket' })]),
        L.result('checks-outro', '[{"bucket":{"toString":null}}]'),
        L.prompt('Prompt posterior'),
      ]);
      c.poll();
      expect(c.office.recentFeed(10).filter((f) => f.agentId === id && f.activity.kind === 'prompt').map((f) => f.activity.detail).slice(-2)).toEqual([
        'Prompt anterior', 'Prompt posterior',
      ]);
      expect(c.agent(id)!.activity?.detail).toBe('Prompt posterior');
      expect(warn).toHaveBeenCalledWith(`[habblaud] Linha do transcript de ${id} ignorada: Cannot convert object to primitive value`);
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      setQuiet(true);
      warn.mockRestore();
    }
  });

  it('subagente em primeiro plano: entra, trabalha e entrega ao concluir', () => {
    const mainId = bootWithSession();
    appendLines(c.transcript('sess-a'), [L.assistant([L.tool('toolu_f', 'Agent', { description: 'Mapear arquivos', subagent_type: 'Explore', prompt: 'x' })])]);
    c.subFile('sess-a', 'f1', { agentType: 'Explore', description: 'Mapear arquivos', toolUseId: 'toolu_f', spawnDepth: 1, requestShape: 'foreground' }, [
      L.prompt('Mapeie os arquivos do carrinho', { agentId: 'f1' }),
      L.assistant([L.tool('g1', 'Grep', { pattern: 'useCart' })], { agentId: 'f1' }),
    ]);
    c.poll();
    const sub = c.agent('sess-a:f1')!;
    const main = c.agent(mainId)!;
    expect(sub).toMatchObject({ kind: 'sub', parentId: mainId, role: 'Explore', title: 'Mapear arquivos', status: 'working', account: '.claude', roomId: CWD });
    expect(sub.background).toBeUndefined();
    expect(sub.name).not.toBe(main.name);
    expect(sub.activity?.text).toBe('Buscando “useCart”');
    expect(main.stats.subagents).toBe(1);

    appendLines(c.transcript('sess-a'), [L.result('toolu_f', 'achei', { toolUseResult: { status: 'completed', agentId: 'f1' } })]);
    c.poll();
    expect(c.agent('sess-a:f1')!.status).toBe('done');
    expect(c.notices.at(-1)?.text).toBe(`📦 ${sub.name} entregou “Mapear arquivos” para ${main.name}`);
    c.advance(26_000);
    c.poll();
    expect(c.agent('sess-a:f1')).toBeUndefined();
  });

  it('subagente em segundo plano: o lançamento não conclui; a notificação sim', () => {
    bootWithSession();
    appendLines(c.transcript('sess-a'), [
      L.assistant([L.tool('toolu_b', 'Agent', { description: 'Pesquisar API', subagent_type: 'general-purpose', run_in_background: true })]),
      L.result('toolu_b', 'lançado', { toolUseResult: { isAsync: true, status: 'async_launched', agentId: 'b1' } }),
    ]);
    c.subFile('sess-a', 'b1', { agentType: 'general-purpose', description: 'Pesquisar API', toolUseId: 'toolu_b', requestShape: 'background' }, [
      L.prompt('Pesquise a API', { agentId: 'b1' }),
      L.assistant([L.tool('w1', 'WebSearch', { query: 'api pix' })], { agentId: 'b1' }),
    ]);
    c.poll();
    c.advance(2_000);
    c.poll();
    expect(c.agent('sess-a:b1')).toMatchObject({ status: 'working', background: true });
    appendLines(c.transcript('sess-a'), [L.notification('toolu_b', 'completed', 'Achei a documentação')]);
    c.poll();
    expect(c.agent('sess-a:b1')!.status).toBe('done');
  });

  it('fork em segundo plano: entra e trabalha (a cópia da chamada do pai não o conclui); a notificação conclui', () => {
    const mainId = bootWithSession();
    appendLines(c.transcript('sess-a'), [
      L.assistant([L.tool('toolu_fk', 'Agent', { description: 'Arte nova', subagent_type: 'fork', run_in_background: true })]),
      L.result('toolu_fk', 'lançado', { toolUseResult: { isAsync: true, status: 'async_launched', agentId: 'fk1' } }),
    ]);
    c.subFile('sess-a', 'fk1', { agentType: 'fork', isFork: true, description: 'Arte nova', toolUseId: 'toolu_fk', spawnDepth: 1, requestShape: 'background' }, [
      ...L.forkStart('fk1', 'toolu_fk', 'Desenhe as poses', { agentId: 'fk1' }),
      L.assistant([L.tool('r1', 'Read', { file_path: `${CWD}/src/art.ts` })], { agentId: 'fk1' }),
    ]);
    c.poll();
    c.advance(2_000);
    c.poll();
    expect(c.agent('sess-a:fk1')).toMatchObject({ kind: 'sub', parentId: mainId, role: 'fork', title: 'Arte nova', status: 'working', background: true });
    expect(c.agent('sess-a:fk1')!.activity?.text).toBe('Lendo art.ts');
    expect(c.agent(mainId)!.stats.subagents).toBe(1);
    appendLines(c.transcript('sess-a'), [L.notification('toolu_fk', 'completed', 'Poses prontas')]);
    c.poll();
    expect(c.agent('sess-a:fk1')!.status).toBe('done');
  });

  it('fork com transcript grande (lido pelo fim): o começo herdado também não o conclui', () => {
    c.watcher.stop();
    c.tmp.cleanup();
    c = setup({ tailBytes: 600 });
    bootWithSession();
    appendLines(c.transcript('sess-a'), [
      L.assistant([L.tool('toolu_fg', 'Agent', { description: 'Arte grande', subagent_type: 'fork', run_in_background: true })]),
      L.result('toolu_fg', 'lançado', { toolUseResult: { isAsync: true, status: 'async_launched', agentId: 'fk2' } }),
    ]);
    const work = Array.from({ length: 12 }, (_, i) => L.assistant([L.tool(`g${i}`, 'Grep', { pattern: `padrao${i}` })], { agentId: 'fk2' }));
    c.subFile('sess-a', 'fk2', { agentType: 'fork', description: 'Arte grande', toolUseId: 'toolu_fg', requestShape: 'background' }, [
      ...L.forkStart('fk2', 'toolu_fg', 'Desenhe tudo', { agentId: 'fk2' }),
      ...work,
    ]);
    c.poll();
    c.advance(2_000);
    c.poll();
    expect(c.agent('sess-a:fk2')).toMatchObject({ status: 'working' });
  });

  it('subagente conclui por end_turn + 5 s de silêncio', () => {
    bootWithSession();
    c.subFile('sess-a', 'e1', { agentType: 'Plan', description: 'Planejar', toolUseId: 'toolu_x' }, [
      L.prompt('Planeje', { agentId: 'e1' }),
      L.assistant([L.text('Plano pronto.')], { agentId: 'e1', stop: 'end_turn' }),
    ]);
    c.poll();
    expect(c.agent('sess-a:e1')!.status).toBe('working');
    c.advance(6_000);
    c.poll();
    expect(c.agent('sess-a:e1')!.status).toBe('done');
  });

  it('agentes de workflow: entram pela pasta workflows/ e saem com a notificação do workflow', () => {
    bootWithSession();
    appendLines(c.transcript('sess-a'), [
      L.assistant([L.tool('toolu_wf', 'Workflow', { scriptPath: '/x.js' })]),
      L.result('toolu_wf', 'ok', { toolUseResult: { status: 'async_launched', taskId: 'wt1', runId: 'wf_1' } }),
    ]);
    for (const [agentId, label] of [
      ['w1', 'backend'],
      ['w2', 'ui'],
    ]) {
      c.subFile('sess-a', agentId, { agentType: 'workflow-subagent', description: label, workflowPhase: 'Construção', spawnDepth: 1, requestShape: 'foreground' }, [
        L.prompt('Tarefa', { agentId }),
      ], 'wf_1');
    }
    c.poll();
    const subs = c.agents().filter((a) => a.kind === 'sub');
    expect(subs.map((s) => [s.role, s.title, s.status])).toEqual([
      ['Workflow', 'backend', 'working'],
      ['Workflow', 'ui', 'working'],
    ]);
    expect(c.agent('.claude:100')!.stats.subagents).toBe(2);
    // O journal do workflow registra o resultado de cada agente.
    writeLines(join(c.dir, 'projects', encodeCwd(CWD), 'sess-a', 'subagents', 'workflows', 'wf_1', 'journal.jsonl'), [
      JSON.stringify({ type: 'started', agentId: 'w1', label: 'backend' }),
      JSON.stringify({ type: 'result', agentId: 'w1', result: {} }),
    ]);
    c.poll();
    expect(c.agent('sess-a:w1')!.status).toBe('done');
    expect(c.agent('sess-a:w2')!.status).toBe('working');
    appendLines(c.transcript('sess-a'), [L.notification('toolu_wf', 'completed', 'Workflow concluído')]);
    c.poll();
    expect(c.agents().filter((a) => a.kind === 'sub').map((s) => s.status)).toEqual(['done', 'done']);
  });

  it('no boot só entram subagentes escritos nos últimos 90 s e não concluídos', () => {
    writeLines(c.transcript('sess-b'), [L.prompt('oi')]);
    const old = c.subFile('sess-b', 'old', { agentType: 'Explore', toolUseId: 't-old' }, [L.prompt('antigo', { agentId: 'old' })]);
    const past = (c.now() - 10 * 60_000) / 1000;
    utimesSync(old, past, past);
    c.subFile('sess-b', 'new', { agentType: 'Explore', toolUseId: 't-new' }, [L.prompt('novo', { agentId: 'new' })]);
    c.openSession(200, 'sess-b');
    c.watcher.boot();
    const subs = c.agents().filter((a) => a.kind === 'sub');
    expect(subs.map((s) => s.id)).toEqual(['sess-b:new']);
    // O antigo só volta se for escrito de novo.
    appendLines(old, [L.assistant([L.tool('z', 'Read', { file_path: '/a/b.ts' })], { agentId: 'old' })]);
    c.poll();
    expect(c.agent('sess-b:old')?.status).toBe('working');
  });

  it('no boot (reinício do servidor) volta quem está no meio de um comando longo, mesmo quieto há minutos', () => {
    writeLines(c.transcript('sess-r'), [L.prompt('oi')]);
    const quiet = (path: string, ms: number) => {
      const t = (c.now() - ms) / 1000;
      utimesSync(path, t, t);
    };
    // Bash aberto há 3 min (sem resultado ainda): continua trabalhando.
    const busy = c.subFile('sess-r', 'busy', { agentType: 'Explore', toolUseId: 't-busy' }, [
      L.prompt('roda a bateria', { agentId: 'busy', at: c.now() - 200_000 }),
      L.assistant([L.tool('b1', 'Bash', { command: 'npm test' })], { agentId: 'busy', at: c.now() - 180_000, stop: 'tool_use' }),
    ]);
    quiet(busy, 180_000);
    // Terminou há 3 min: fica de fora.
    const ended = c.subFile('sess-r', 'ended', { agentType: 'Explore', toolUseId: 't-ended' }, [
      L.assistant([L.text('pronto')], { agentId: 'ended', at: c.now() - 180_000, stop: 'end_turn' }),
    ]);
    quiet(ended, 180_000);
    // Ferramenta pendente há 12 min: passou do limite, fica de fora.
    const stuck = c.subFile('sess-r', 'stuck', { agentType: 'Explore', toolUseId: 't-stuck' }, [
      L.assistant([L.tool('s1', 'Bash', { command: 'sleep 999' })], { agentId: 'stuck', at: c.now() - 720_000, stop: 'tool_use' }),
    ]);
    quiet(stuck, 720_000);
    // Workflow: journal diz que começou e não terminou (sem ferramenta pendente, quieto há 100 s).
    const wf = c.subFile('sess-r', 'wf1', { agentType: 'workflow-subagent' }, [L.prompt('tarefa', { agentId: 'wf1', at: c.now() - 100_000 })], 'run-1');
    writeFileSync(join(wf, '..', 'journal.jsonl'), `${JSON.stringify({ type: 'started', agentId: 'wf1', label: 'Revisor' })}\n`);
    quiet(wf, 100_000);
    c.openSession(400, 'sess-r');
    c.watcher.boot();
    const subs = c.agents().filter((a) => a.kind === 'sub');
    expect(subs.map((s) => s.id).sort()).toEqual(['sess-r:busy', 'sess-r:wf1']);
    expect(c.agent('sess-r:busy')).toMatchObject({ status: 'working', activity: { kind: 'test' } });
  });

  it('pergunta que já chega respondida vira "Recebeu a sua resposta"; aberta continua pergunta', () => {
    const id = bootWithSession(500, 'sess-q');
    const q = { questions: [{ question: 'Qual banco usar?', options: [] }] };
    appendLines(c.transcript('sess-q'), [
      L.assistant([L.tool('q1', 'AskUserQuestion', q)], { at: c.now() - 2_000, stop: 'tool_use' }),
      L.result('q1', 'Postgres', { at: c.now() - 1_000 }),
    ]);
    c.poll();
    expect(c.agent(id)!.activity).toMatchObject({ kind: 'ask', text: 'Recebeu a sua resposta', detail: 'Qual banco usar?' });
    appendLines(c.transcript('sess-q'), [L.assistant([L.tool('q2', 'AskUserQuestion', q)], { stop: 'tool_use' })]);
    c.poll();
    expect(c.agent(id)!.activity).toMatchObject({ kind: 'ask', text: 'Fazendo uma pergunta a você' });
  });

  it('sessão fechada: principal vai embora (offline), subagentes saem junto, sala some', () => {
    const id = bootWithSession();
    c.subFile('sess-a', 's1', { agentType: 'Explore', toolUseId: 't1' }, [L.prompt('x', { agentId: 's1' })]);
    c.poll();
    c.closeSession(100);
    c.poll();
    // Um sumiço instantâneo do registro não fecha a sessão...
    expect(c.agent(id)!.status).toBe('working');
    c.advance(2_000);
    c.poll();
    // ...mas um sumiço que persiste, sim.
    expect(c.agent(id)!.status).toBe('offline');
    expect(c.agent('sess-a:s1')!.status).toBe('done');
    expect(c.notices.at(-1)?.text).toMatch(/^🚪 .+ encerrou a sessão$/);
    c.advance(21_000);
    c.poll();
    const snap = c.office.commit().snapshot;
    expect(snap.agents).toEqual([]);
    expect(snap.rooms).toEqual([]);
  });

  it('PID morto com o arquivo ainda lá = sessão encerrada', () => {
    const id = bootWithSession();
    c.closeSession(100);
    writeFileSync(join(c.dir, 'sessions', '100.json'), JSON.stringify({ pid: 100, sessionId: 'sess-a', cwd: CWD, status: 'idle' }));
    c.poll();
    c.advance(2_000);
    c.poll();
    expect(c.agent(id)!.status).toBe('offline');
  });

  it('/clear: mesmo processo, sessão nova — mesmo personagem, tarefas zeradas', () => {
    writeLines(c.transcript('sess-a'), [L.assistant([L.tool('t', 'TodoWrite', { todos: [{ content: 'A', status: 'pending' }] })])]);
    c.openSession(100, 'sess-a');
    c.watcher.boot();
    const before = c.agent('.claude:100')!;
    expect(before.tasks).toHaveLength(1);
    writeLines(c.transcript('sess-c'), [L.prompt('Começando de novo')]);
    c.openSession(100, 'sess-c');
    c.poll();
    const after = c.agent('.claude:100')!;
    expect(after).toMatchObject({ name: before.name, sessionId: 'sess-c', tasks: [] });
    expect(after.recent.map((r) => r.kind)).toContain('compact');
    expect(after.activity?.kind).toBe('prompt');
  });

  it('sessão nova depois do boot gera aviso de chegada e de sala nova', () => {
    c.watcher.boot();
    writeLines(c.transcript('sess-n'), [L.prompt('Olá')]);
    c.openSession(300, 'sess-n', { agent: 'frinus' });
    c.poll();
    const a = c.agent('.claude:300')!;
    expect(a.role).toBe('Agente frinus');
    const texts = c.notices.map((n) => n.text);
    expect(texts).toContain('🏗️ Nova sala: loja');
    expect(texts).toContain(`👋 ${a.name} chegou em loja (Conta A)`);
  });
});

describe('ClaudeWatcher com transcript maior que a janela do boot', () => {
  it('a linha do tempo longa recebe as atividades do começo do arquivo (sem ir para o feed)', async () => {
    const c = setup({ tailBytes: 1_500 });
    try {
      const t0 = c.now() - 600_000;
      const lines = Array.from({ length: 30 }, (_, i) => L.assistant([L.tool(`r${i}`, 'Read', { file_path: `${CWD}/src/arquivo${i}.ts` })], { at: t0 + i * 1_000 }));
      writeLines(c.transcript('sess-h'), lines);
      c.openSession(600, 'sess-h');
      c.watcher.boot();
      const before = c.office.detail('.claude:600')!.history.length;
      expect(before).toBeLessThan(30);
      await c.watcher.idle();
      const history = c.office.detail('.claude:600')!.history;
      expect(history).toHaveLength(30);
      expect(history.map((a) => a.text)).toEqual(Array.from({ length: 30 }, (_, i) => `Lendo arquivo${i}.ts`));
      expect(c.office.recentFeed(100).filter((f) => f.agentId === '.claude:600')).toHaveLength(before);
    } finally {
      c.watcher.stop();
      c.tmp.cleanup();
    }
  });
});

describe('ClaudeWatcher — esperando o shell', () => {
  let c: Ctx;
  beforeEach(() => {
    c = setup();
  });
  afterEach(() => {
    c.watcher.stop();
    c.tmp.cleanup();
  });

  const SUITE = { command: 'vendor/bin/phpunit --group cms', description: 'Rodar a suíte completa', run_in_background: true };

  /** Turno que deixa um Bash em segundo plano rodando e termina. */
  function backgroundTurn(at: number, id = 'toolu_bg', taskId = 'bo0ov3q3l', input: Record<string, unknown> = SUITE): string[] {
    return [
      L.prompt('Roda a suíte inteira', { at: at - 2_000 }),
      L.assistant([L.tool(id, 'Bash', input)], { at, stop: 'tool_use' }),
      L.bgLaunched(id, taskId, { at: at + 500 }),
      L.assistant([L.text('Deixei a suíte rodando; aviso quando terminar.')], { at: at + 1_000, stop: 'end_turn' }),
      L.system('turn_duration', { durationMs: 3_000 }, { at: at + 1_100 }),
    ];
  }

  it('registro "shell": fica esperando com o job, balão e aviso; a fila encerra com ShellDone e a entrega não tira o ShellDone do balão', () => {
    const t0 = c.now();
    writeLines(c.transcript('sess-s'), backgroundTurn(t0 - 10_000));
    c.openSession(700, 'sess-s', { status: 'busy' });
    c.watcher.boot();
    const id = '.claude:700';
    expect(c.agent(id)!.shells).toEqual([
      { id: 'bo0ov3q3l', label: 'Rodar a suíte completa', command: 'vendor/bin/phpunit --group cms', startedAt: t0 - 9_500, background: true, kind: 'shell' },
    ]);

    c.openSession(700, 'sess-s', { status: 'shell' });
    c.poll();
    let a = c.agent(id)!;
    expect(a.status).toBe('shell');
    expect(a.activity).toMatchObject({ kind: 'wait', icon: '⏳', text: 'Esperando o shell: Rodar a suíte completa', tool: 'ShellWait' });
    expect(c.notices.map((n) => n.text)).toEqual([`⏳ ${a.name} está esperando o shell em loja: Rodar a suíte completa`]);
    expect(c.office.recentFeed(1)[0].activity.tool).toBe('ShellWait');

    // Passa o tempo; nada muda (sem novos avisos, sem novo balão).
    c.advance(60_000);
    c.poll();
    expect(c.notices).toHaveLength(1);

    // O shell termina: a fila grava a notificação; o agente acorda e recebe a mensagem.
    appendLines(c.transcript('sess-s'), [
      L.shellNotification('queue', { taskId: 'bo0ov3q3l', toolUseId: 'toolu_bg', status: 'completed', summary: 'Background command "Rodar a suíte completa" completed (exit code 0)' }, { at: c.now() }),
      L.shellNotification('message', { taskId: 'bo0ov3q3l', toolUseId: 'toolu_bg', status: 'completed' }, { at: c.now() + 10 }),
    ]);
    c.openSession(700, 'sess-s', { status: 'busy' });
    c.poll();
    a = c.agent(id)!;
    expect(a.status).toBe('working');
    expect(a.shells).toBeUndefined();
    expect(a.activity).toMatchObject({ tool: 'ShellDone', icon: '✅', text: 'Shell terminou: Rodar a suíte comp… (1min 10s)', durationMs: 69_500 });
    expect(a.activity!.error).toBeUndefined();
    expect(c.notices.at(-1)).toMatchObject({ level: 'success', text: `✅ ${a.name}: shell terminou em loja — Rodar a suíte completa` });
    expect(c.office.recentFeed(2).map((f) => f.activity.text)).toEqual(['Shell terminou: Rodar a suíte comp… (1min 10s)', 'Recebeu resultado em segundo plano']);
    // Nenhum "concluiu" no caminho: o fim do turno virou espera pelo shell.
    expect(c.notices.some((n) => n.text.includes('concluiu'))).toBe(false);
  });

  it('boot em "shell": balão sem aviso; só a mensagem (sem fila) encerra; falha => error e aviso de alerta amarelo', () => {
    const t0 = c.now();
    writeLines(c.transcript('sess-f'), backgroundTurn(t0 - 30_000, 'toolu_m', 'bmig1', { command: 'php artisan migrate', description: 'Migração do banco', run_in_background: true }));
    c.openSession(710, 'sess-f', { status: 'shell' });
    c.watcher.boot();
    c.notices.push(...c.office.commit().notices);
    const id = '.claude:710';
    expect(c.agent(id)).toMatchObject({ status: 'shell', activity: { text: 'Esperando o shell: Migração do banco' } });
    expect(c.notices).toEqual([]);
    appendLines(c.transcript('sess-f'), [
      L.shellNotification('message', { taskId: 'bmig1', status: 'failed', summary: 'Background command "Migração do banco" failed with exit code 1' }, { at: c.now() }),
    ]);
    c.openSession(710, 'sess-f', { status: 'busy' });
    c.poll();
    const a = c.agent(id)!;
    expect(a.activity).toMatchObject({ tool: 'ShellDone', icon: '❌', text: 'Shell falhou: Migração do banco', error: true });
    expect(a.activity!.detail).toBe('Código de saída 1 — php artisan migrate');
    expect(c.notices.at(-1)).toMatchObject({ level: 'warn', text: `❌ ${a.name}: shell falhou em loja — Migração do banco` });
  });

  it('CLI antiga: registro "idle" + Bash em segundo plano sem notificação = shell; KillShell encerra como interrompido (sem aviso)', () => {
    const t0 = c.now();
    writeLines(c.transcript('sess-o'), backgroundTurn(t0 - 5_000, 'toolu_o', 'bold1'));
    c.openSession(720, 'sess-o', { status: 'idle' });
    c.watcher.boot();
    const id = '.claude:720';
    expect(c.agent(id)).toMatchObject({ status: 'shell', activity: { tool: 'ShellWait' } });
    appendLines(c.transcript('sess-o'), [
      L.prompt('Para esse teste', { at: c.now() }),
      L.assistant([L.tool('k1', 'KillShell', { shell_id: 'bold1' })], { at: c.now() + 1_000 }),
      L.result('k1', 'Shell bold1 killed', { at: c.now() + 1_200 }),
    ]);
    c.poll();
    const a = c.agent(id)!;
    expect(a.status).toBe('idle');
    expect(a.shells).toBeUndefined();
    expect(a.recent.find((x) => x.tool === 'ShellDone')).toMatchObject({ icon: '🛑', text: 'Shell interrompido: Rodar a suíte completa', error: true });
    expect(c.notices.filter((n) => n.text.includes('shell'))).toEqual([]);
  });

  it('versão que grava "shell": "idle" é a palavra final (sem fallback) e, depois de 30 s, limpa o job que perdeu o término', () => {
    const t0 = c.now();
    writeLines(c.transcript('sess-v'), backgroundTurn(t0 - 5_000, 'toolu_v', 'bperdido'));
    c.openSession(725, 'sess-v', { status: 'idle', version: '2.1.292' });
    c.watcher.boot();
    const id = '.claude:725';
    expect(c.agent(id)!.status).toBe('idle');
    expect(c.agent(id)!.shells).toHaveLength(1);
    c.advance(31_000);
    c.poll();
    expect(c.agent(id)!.shells).toBeUndefined();
    expect(c.agent(id)!.recent.some((x) => x.tool === 'ShellDone')).toBe(false);
  });

  it('aprende a versão: uma sessão mais antiga gravando "shell" passa a valer como referência', () => {
    const t0 = c.now();
    writeLines(c.transcript('sess-w1'), backgroundTurn(t0 - 5_000, 'w1', 'bw1'));
    writeLines(c.transcript('sess-w2'), backgroundTurn(t0 - 5_000, 'w2', 'bw2'));
    c.openSession(726, 'sess-w1', { status: 'shell', version: '2.1.250' });
    c.openSession(727, 'sess-w2', { status: 'idle', version: '2.1.260' });
    c.watcher.boot();
    expect(c.agent('.claude:726')!.status).toBe('shell');
    // 2.1.260 >= 2.1.250 (que grava "shell"): "idle" sem fallback.
    expect(c.agent('.claude:727')!.status).toBe('idle');
  });

  it('o fallback ignora shell antigo (> 12 h) e shell de antes do processo atual (sessão retomada)', () => {
    const t0 = c.now();
    writeLines(c.transcript('sess-r'), [...backgroundTurn(t0 - 13 * 3_600_000, 'velho', 'bvelho'), ...backgroundTurn(t0 - 120_000, 'anterior', 'bant')]);
    // O processo começou há 60 s (fixture): o shell de 2 min atrás morreu com o processo anterior.
    c.openSession(730, 'sess-r', { status: 'idle', startedAt: t0 - 60_000 });
    c.watcher.boot();
    expect(c.agent('.claude:730')).toMatchObject({ status: 'idle' });
    expect(c.agent('.claude:730')!.shells).toBeUndefined();
  });

  it('primeiro plano: entra em shells (background false) e sai no resultado; aprovação pendente esconde o comando', () => {
    const t0 = c.now();
    writeLines(c.transcript('sess-p'), [
      L.prompt('Instala tudo', { at: t0 - 40_000 }),
      L.assistant([L.tool('fg1', 'Bash', { command: 'npm ci', description: 'Instalar as dependências' })], { at: t0 - 30_000, stop: 'tool_use' }),
    ]);
    c.openSession(740, 'sess-p', { status: 'waiting', waitingFor: 'permission' });
    c.watcher.boot();
    const id = '.claude:740';
    expect(c.agent(id)!.shells).toBeUndefined();
    c.advance(5_000);
    c.openSession(740, 'sess-p', { status: 'busy' });
    c.poll();
    // O relógio do comando começa quando a aprovação termina.
    expect(c.agent(id)!.shells).toEqual([{ id: 'fg1', label: 'Instalar as dependências', command: 'npm ci', startedAt: t0, background: false, kind: 'shell' }]);
    c.advance(30_000);
    c.poll();
    // 30 s sem nada novo no transcript: continua mostrando o comando (não "Pensando…").
    expect(c.agent(id)).toMatchObject({ status: 'working', activity: { kind: 'run', text: 'Instalando dependências' } });
    appendLines(c.transcript('sess-p'), [L.result('fg1', 'added 812 packages', { at: c.now() })]);
    c.poll();
    expect(c.agent(id)!.shells).toBeUndefined();
    // Comando em primeiro plano não gera ShellDone.
    expect(c.agent(id)!.recent.some((x) => x.tool === 'ShellDone')).toBe(false);
  });

  it('boot: o fim do arquivo reconstrói o que roda e mostra o que já terminou (no feed, sem aviso)', () => {
    const t0 = c.now();
    writeLines(c.transcript('sess-b'), [
      ...backgroundTurn(t0 - 40_000, 'b1', 'bfeito'),
      L.shellNotification('queue', { taskId: 'bfeito', toolUseId: 'b1', status: 'completed', summary: 'x (exit code 0)' }, { at: t0 - 20_000 }),
      L.shellNotification('message', { taskId: 'bfeito', toolUseId: 'b1', status: 'completed' }, { at: t0 - 20_000 }),
      ...backgroundTurn(t0 - 15_000, 'b2', 'brodando', { command: 'npm run build', description: 'Build de produção', run_in_background: true }),
    ]);
    c.openSession(750, 'sess-b', { status: 'shell' });
    c.watcher.boot();
    c.notices.push(...c.office.commit().notices);
    const a = c.agent('.claude:750')!;
    expect(a.shells?.map((j) => [j.id, j.label])).toEqual([['brodando', 'Build de produção']]);
    expect(a.activity?.text).toBe('Esperando o shell: Build de produção');
    expect(c.office.recentFeed(50).filter((f) => f.activity.tool === 'ShellDone').map((f) => f.activity.text)).toEqual(['Shell terminou: Rodar a suíte completa (20s)']);
    expect(c.notices).toEqual([]);
  });

  it('subagente: Bash dele em segundo plano, notificado no transcript do principal', () => {
    const t0 = c.now();
    writeLines(c.transcript('sess-u'), [L.prompt('Delegando', { at: t0 - 5_000 })]);
    c.openSession(760, 'sess-u', { status: 'busy' });
    c.watcher.boot();
    c.subFile('sess-u', 'sub1', { agentType: 'general-purpose', toolUseId: 'toolu_sub' }, [
      L.prompt('Roda os testes', { agentId: 'sub1', at: t0 - 1_000 }),
      L.assistant([L.tool('toolu_sb', 'Bash', { command: 'pytest -q', description: 'Rodar os testes', run_in_background: true })], { agentId: 'sub1', at: t0 }),
      L.bgLaunched('toolu_sb', 'bsub1', { agentId: 'sub1', at: t0 + 100 }),
    ]);
    c.poll();
    expect(c.agent('sess-u:sub1')!.shells?.map((j) => j.id)).toEqual(['bsub1']);
    expect(c.agent('.claude:760')!.shells).toBeUndefined();
    appendLines(c.transcript('sess-u'), [L.shellNotification('queue', { taskId: 'bsub1', toolUseId: 'toolu_sb', status: 'completed' }, { at: c.now() + 5_000 })]);
    c.poll();
    const sub = c.agent('sess-u:sub1')!;
    expect(sub.shells).toBeUndefined();
    expect(sub.activity).toMatchObject({ tool: 'ShellDone', text: 'Shell terminou: Rodar os testes (5s)' });
  });

  it('/clear e sessão encerrada limpam os shells', () => {
    const t0 = c.now();
    writeLines(c.transcript('sess-c1'), backgroundTurn(t0 - 5_000));
    c.openSession(770, 'sess-c1', { status: 'shell' });
    c.watcher.boot();
    expect(c.agent('.claude:770')!.shells).toHaveLength(1);
    writeLines(c.transcript('sess-c2'), [L.prompt('Começando de novo')]);
    c.openSession(770, 'sess-c2', { status: 'idle' });
    c.poll();
    expect(c.agent('.claude:770')!.shells).toBeUndefined();
    writeLines(c.transcript('sess-c3'), backgroundTurn(c.now() - 1_000, 'b3', 'b3x'));
    c.openSession(770, 'sess-c3', { status: 'shell' });
    c.poll();
    expect(c.agent('.claude:770')!.shells).toHaveLength(1);
    c.closeSession(770);
    c.poll();
    c.advance(2_000);
    c.poll();
    expect(c.agent('.claude:770')).toMatchObject({ status: 'offline' });
    expect(c.agent('.claude:770')!.shells).toBeUndefined();
  });
});

describe('ClaudeWatcher — shell lançado no começo de um transcript maior que a janela do boot', () => {
  it('entra quando o começo do arquivo é lido; o que terminou dentro da janela não volta', async () => {
    const c = setup({ tailBytes: 3_000 });
    try {
      const t0 = c.now() - 600_000;
      const lines = [
        L.assistant([L.tool('cedo', 'Bash', { command: 'npm run e2e', description: 'Testes de ponta a ponta', run_in_background: true })], { at: t0 }),
        L.bgLaunched('cedo', 'bcedo', { at: t0 + 100 }),
        L.assistant([L.tool('fim', 'Bash', { command: 'npm run build', description: 'Build', run_in_background: true })], { at: t0 + 200 }),
        L.bgLaunched('fim', 'bfim', { at: t0 + 300 }),
        ...Array.from({ length: 30 }, (_, i) => L.assistant([L.tool(`r${i}`, 'Read', { file_path: `${CWD}/src/arquivo${i}.ts` })], { at: t0 + 1_000 + i * 1_000 })),
        L.shellNotification('queue', { taskId: 'bfim', toolUseId: 'fim', status: 'completed' }, { at: t0 + 50_000 }),
        L.assistant([L.text('Pronto.')], { at: t0 + 51_000, stop: 'end_turn' }),
      ];
      writeLines(c.transcript('sess-g'), lines);
      c.openSession(800, 'sess-g', { status: 'shell', startedAt: t0 - 60_000 });
      c.watcher.boot();
      expect(c.agent('.claude:800')!.shells).toBeUndefined();
      await c.watcher.idle();
      c.poll();
      const a = c.agent('.claude:800')!;
      expect(a.shells?.map((j) => [j.id, j.label, j.startedAt])).toEqual([['bcedo', 'Testes de ponta a ponta', t0 + 100]]);
      expect(a.activity?.text).toBe('Esperando o shell: Testes de ponta a ponta');
    } finally {
      c.watcher.stop();
      c.tmp.cleanup();
    }
  });
});
