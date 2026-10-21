// Interpretação dos rollouts do Codex (linhas sintéticas nos formatos paginated e legacy).
import { describe, expect, it } from 'vitest';
import { R, SOURCES, threadId } from '../../test/codex-fixtures';
import {
  commandText,
  createCodexState,
  describeCodexTool,
  fileChanges,
  parseRolloutLine,
  parseSessionMeta,
  patchFiles,
  pathFromUri,
  usageFromRateLimits,
  type CodexLineResult,
  type CodexState,
} from './rollout';

const T = threadId(1);
const ctx = { idPrefix: 'acc:t', now: 0 };

function feed(lines: string[], state: CodexState = createCodexState()): { state: CodexState; results: CodexLineResult[] } {
  const results = lines.map((l) => parseRolloutLine(state, l, ctx));
  return { state, results };
}

const texts = (results: CodexLineResult[]) => results.flatMap((r) => r.activities.map((a) => a.activity.text));
const ids = (results: CodexLineResult[]) => results.flatMap((r) => r.activities.map((a) => a.activity.id));

describe('rollout do Codex: paginated', () => {
  it('conversa sai dos item_completed; contexto injetado (response_item message) fica de fora', () => {
    const at = Date.parse('2026-10-09T12:00:00Z');
    const { state, results } = feed([
      R.meta(T, { at }),
      R.message('developer', '<permissions instructions> segredo do sistema'),
      R.message('user', '<environment_context>cwd</environment_context>'),
      R.taskStarted('turn1', at + 1),
      R.user(T, 'turn1', 'u1', 'Arrume o teste quebrado da loja', at + 2),
      R.reasoning(T, 'turn1', 'r1', ['Lendo os testes'], at + 3),
      R.reasoning(T, 'turn1', 'r2', ['Ainda pensando'], at + 4),
      R.agent(T, 'turn1', 'a1', 'Corrigi o teste.', at + 5),
      R.taskComplete('turn1', at + 6, 6_000),
    ]);
    expect(texts(results)).toEqual(['Recebeu “Arrume o teste quebrado da loja”', 'Pensando…', 'Escrevendo a resposta', 'Concluiu em 6s']);
    expect(ids(results)).toEqual(['acc:t#u1', 'acc:t#r1', 'acc:t#a1', 'acc:t#turn1:done']);
    expect(results.find((r) => r.activities[0]?.activity.kind === 'prompt')?.activities[0].activity.kind).toBe('prompt');
    expect(state.title).toBe('Arrume o teste quebrado da loja');
    expect(state.mode).toBe('paginated');
    expect(state.gitBranch).toBe('main');
    expect(state.turnOpen).toBe(false);
    const signals = results.flatMap((r) => r.signals.map((s) => s.type));
    expect(signals).toContain('turnStart');
    expect(signals).toContain('turnEnd');
  });

  it('comando: as mesmas atividades do Bash, comando em lista ou texto, erro e recusa', () => {
    const { results, state } = feed([
      R.command(T, 't', 'call_1', 'npm test', { output: 'ok' }),
      R.command(T, 't', 'call_2', 'git push origin main', { exit: 1, output: 'rejected\n' }),
      R.command(T, 't', 'call_3', 'rm -rf build', { status: 'declined' }),
    ]);
    const acts = results.flatMap((r) => r.activities.map((a) => a.activity));
    expect(acts.map((a) => [a.id, a.text, a.tool])).toEqual([
      ['acc:t#call_1', 'Rodando testes', 'Bash'],
      ['acc:t#call_2', 'Enviando commits (git push)', 'Bash'],
      ['acc:t#call_2:e', 'Erro em Bash', 'Bash'],
      ['acc:t#call_3', 'Organizando arquivos', 'Bash'],
      ['acc:t#call_3:r', 'Você recusou: Bash', undefined],
    ]);
    expect(acts[0].detail).toBe('npm test');
    expect(state.stats.toolCalls).toBe(3);
    expect(commandText(['/bin/bash', '-c', 'ls -la'])).toBe('ls -la');
    expect(commandText(['git', 'commit', '-m', 'uma mensagem'])).toBe("git commit -m 'uma mensagem'");
    expect(commandText('  echo oi ')).toBe('echo oi');
  });

  it('atividade em andamento (function_call sem saída) e o item concluído não duplicam (mesmo call_id)', () => {
    const { results: all, state } = feed([
      R.meta(T),
      R.functionCall('call_9', 'exec_command', { cmd: 'npm run build', yield_time_ms: 10_000 }),
      R.customToolCall('call_x', 'exec', 'await tools.exec_command({cmd: "ls"})'),
    ]);
    const results = all.slice(1);
    expect(results[0].activities[0].activity).toMatchObject({ id: 'acc:t#call_9', text: 'Compilando o projeto', tool: 'Bash' });
    expect(results[1].activities[0].activity).toMatchObject({ id: 'acc:t#call_x', text: 'Executando código' });
    expect([...state.pending.keys()]).toEqual(['call_9', 'call_x']);
    const done = parseRolloutLine(state, R.command(T, 't', 'call_9', 'npm run build'), ctx);
    expect(done.activities[0].activity.id).toBe('acc:t#call_9');
    expect(state.pending.has('call_9')).toBe(false);
    // No paginated, só o item concluído conta como ferramenta.
    expect(state.stats.toolCalls).toBe(1);
  });

  it('mudanças de arquivo (mapa do rollout ou lista), apply_patch, MCP e plano', () => {
    const { results, state } = feed([
      R.fileChange(T, 't', 'call_p', {
        '/projetos/loja/src/app.ts': { type: 'update', unified_diff: '@@ -1 +1 @@\n-a\n+b\n', move_path: null },
        '/projetos/loja/src/novo.ts': { type: 'add', content: 'export {}\n' },
      }),
      R.mcp(T, 't', 'call_m', 'github', 'create_pull_request', { owner: 'o', repo: 'r', title: 'x' }, { result: '{"number": 7, "html_url": "https://github.com/o/r/pull/7"}' }),
      R.functionCall('call_plan', 'update_plan', { plan: [{ step: 'Ler o código', status: 'completed' }, { step: 'Corrigir', status: 'in_progress' }] }),
    ]);
    const acts = results.flatMap((r) => r.activities.map((a) => a.activity));
    expect(acts.map((a) => [a.id, a.text])).toEqual([
      ['acc:t#call_p', 'Editando app.ts'],
      ['acc:t#call_p:1', 'Escrevendo novo.ts'],
      ['acc:t#call_m', 'GitHub: create pull request'],
      ['acc:t#call_plan', 'Atualizando o plano'],
    ]);
    expect(acts[2].tool).toBe('mcp__github__create_pull_request');
    expect(state.tasks).toEqual([
      { id: '1', title: 'Ler o código', status: 'completed' },
      { id: '2', title: 'Corrigir', status: 'in_progress' },
    ]);
    expect(results[1].signals.find((s) => s.type === 'github')).toMatchObject({ event: { kind: 'pr_opened', number: 7, repo: 'o/r' }, key: 'call_m' });
    expect(fileChanges([{ path: '/x/a.ts', kind: 'add', diff: 'oi' }])).toEqual([{ path: '/x/a.ts', kind: 'add', text: 'oi' }]);
    expect(patchFiles('*** Begin Patch\n*** Update File: src/a.ts\n@@\n*** Add File: src/b.ts\n+x\n*** End Patch')).toEqual([
      { path: 'src/a.ts', kind: 'update' },
      { path: 'src/b.ts', kind: 'add' },
    ]);
    expect(describeCodexTool('apply_patch', { command: '*** Begin Patch\n*** Add File: docs/x.md\n+oi\n*** End Patch' })).toMatchObject({ tool: 'Write', desc: { text: 'Escrevendo x.md' } });
    expect(describeCodexTool('Bash', { command: 'pytest -q' }).desc.text).toBe('Rodando testes');
    expect(describeCodexTool('create_issue', {}, 'mcp__github__').tool).toBe('mcp__github__create_issue');
  });

  it('code mode do app: a mensagem enviada a você (user_messaging) é a resposta, sem duplicar com a entrega gravada', () => {
    const { results } = feed([
      R.meta(T),
      R.customToolCall('call_js', 'exec', 'await tools.user_messaging.send_message({text: "Achei o bug"})'),
      R.delivered('call_msg', 'Achei o bug no checkout'),
      R.mcp(T, 't', 'call_msg', 'codex_apps', 'user_messaging_send_message', { text: 'Achei o bug no checkout' }, { result: 'ok' }),
      R.delivered('call_cut', 'Texto cortado', Date.now(), false),
    ]);
    const acts = results.flatMap((r) => r.activities.map((a) => a.activity));
    expect(acts.map((a) => [a.id, a.text, a.detail])).toEqual([
      ['acc:t#call_js', 'Executando código', undefined],
      ['acc:t#call_msg', 'Escrevendo a resposta', 'Achei o bug no checkout'],
      // O item concluído tem o mesmo id: o escritório não duplica.
      ['acc:t#call_msg', 'Escrevendo a resposta', 'Achei o bug no checkout'],
      ['acc:t#call_cut', 'Escrevendo a resposta', 'Texto cortado'],
    ]);
  });

  it('uso do plano: só a cota padrão (outro limit_id fica de fora)', () => {
    const rl = { ...R.rateLimits({}), limit_id: 'codex_outro_modelo' };
    expect(usageFromRateLimits(rl, 1)).toBeUndefined();
    expect(usageFromRateLimits({ ...rl, limit_id: null }, 1)).toMatchObject({ fiveHour: { utilization: 12.5 } });
  });

  it('GitHub: o push que deu certo vira evento; o que falhou, não', () => {
    const ok = 'To github.com:o/r.git\n   abc1234..def5678  main -> main\n';
    const rejected = 'To github.com:o/r.git\n ! [rejected]        main -> main (fetch first)\nerror: failed to push some refs\n';
    const { results } = feed([R.command(T, 't', 'c1', 'git push', { output: ok }), R.command(T, 't', 'c2', 'git push', { exit: 1, output: rejected })]);
    expect(results[0].signals).toContainEqual({ type: 'github', event: { kind: 'push', branch: 'main' }, key: 'c1' });
    expect(results[1].signals.some((s) => s.type === 'github')).toBe(false);
  });

  it('tokens: total cumulativo, sem somar o cache de novo', () => {
    const { state } = feed([R.tokens({ input: 1_000, cached: 800, output: 50 }), R.tokens({ input: 3_000, cached: 2_500, output: 120, reasoning: 60 })]);
    expect(state.stats.tokensIn).toBe(3_000);
    expect(state.stats.tokensOut).toBe(120);
  });

  it('uso do plano: janela pela duração, idade da linha e sem cota', () => {
    const at = Date.parse('2026-10-09T12:00:00Z');
    // Posições trocadas: vale a duração (10080 = semana).
    const swapped = usageFromRateLimits(R.rateLimits({ primary: { used: 70, minutes: 10080, resetsAt: 1_900_000_000 }, secondary: { used: 5.5, minutes: 300 } }), at);
    expect(swapped).toEqual({ source: 'codex', fetchedAt: at, sevenDay: { utilization: 70, resetsAt: 1_900_000_000_000 }, fiveHour: { utilization: 5.5, resetsAt: 2_000_000_000_000 } });
    const none = usageFromRateLimits(R.rateLimits({ primary: null, secondary: null, reached: 'workspace_owner_credits_depleted' }), at);
    expect(none).toEqual({ source: 'codex', fetchedAt: at, noQuota: true });
    expect(usageFromRateLimits(R.rateLimits({ primary: null, secondary: null }), at)).toBeUndefined();
    const { state, results } = feed([R.tokens({ input: 1, output: 1, at, rateLimits: { plan: 'pro' } })]);
    expect(state.planType).toBe('pro');
    expect(results[0].signals).toContainEqual({ type: 'usage', usage: expect.objectContaining({ fetchedAt: at, fiveHour: { utilization: 12.5, resetsAt: 2_000_000_000_000 } }), plan: 'pro' });
  });

  it('turno interrompido e ids estáveis numa releitura (inclusive sem id próprio)', () => {
    // Sem session_meta na janela, o formato ainda não é conhecido: a resposta legacy vale.
    const lines = [R.taskStarted('t9'), R.turnAborted('t9'), R.legacyAgent('x')];
    const a = feed(lines);
    const b = feed(lines);
    expect(texts(a.results)).toEqual(['Interrompido por você', 'Escrevendo a resposta']);
    expect(ids(a.results)).toEqual(ids(b.results));
    expect(a.state.turnOpen).toBe(false);
  });
});

describe('rollout do Codex: legacy', () => {
  it('o básico: prompt, raciocínio, resposta e comando concluído (function_call + saída)', () => {
    const { results, state } = feed([
      R.meta(T, { history: null }),
      R.legacyUser('Liste os arquivos'),
      R.legacyReasoning('pensando'),
      R.functionCall('c1', 'shell', { command: ['bash', '-lc', 'ls -la'] }),
      R.functionOutput('c1', JSON.stringify({ output: 'erro', metadata: { exit_code: 2 } })),
      R.legacyAgent('Pronto, listei.'),
      // Num legacy, item_completed de UserMessage não existe; se aparecer, não duplica a conversa por isso.
    ]);
    expect(state.mode).toBe('legacy');
    expect(texts(results)).toEqual(['Recebeu “Liste os arquivos”', 'Pensando…', 'Explorando pastas', 'Erro em Bash', 'Escrevendo a resposta']);
    expect(state.stats.toolCalls).toBe(1);
    expect(state.title).toBe('Liste os arquivos');
  });

  it('eventos legacy são ignorados num rollout paginated', () => {
    const { results } = feed([R.meta(T), R.legacyUser('duplicado'), R.legacyAgent('duplicado')]);
    expect(texts(results)).toEqual([]);
  });
});

describe('session_meta', () => {
  const meta = (source: unknown, extra: Record<string, unknown> = {}) =>
    parseSessionMeta({ id: T, session_id: T, cwd: '/p', source, history_mode: 'paginated', ...extra });

  it('subagente (thread_spawn), internos e fontes comuns', () => {
    const parent = threadId(2);
    expect(meta(SOURCES.sub(parent))).toMatchObject({ parentThreadId: parent, agentRole: 'explorer', agentNickname: 'Kepler', internal: false });
    // A chave já apareceu como subAgent (camelCase) na documentação: as duas valem.
    expect(meta({ subAgent: { threadSpawn: { parent_thread_id: parent } } }).parentThreadId).toBe(parent);
    expect(meta(SOURCES.guardian()).internal).toBe(true);
    expect(meta(SOURCES.internal()).internal).toBe(true);
    expect(meta(SOURCES.review()).internal).toBe(true);
    expect(meta('cli', { thread_source: 'guardian_review' }).internal).toBe(true);
    expect(meta('vscode')).toMatchObject({ internal: false, cwd: '/p', historyMode: 'paginated' });
    expect(meta('vscode').parentThreadId).toBeUndefined();
    // Sem thread_spawn, mas com a raiz diferente do próprio id: o pai é a raiz.
    expect(meta('exec', { session_id: parent }).parentThreadId).toBe(parent);
    expect(parseSessionMeta({ id: T }).historyMode).toBe('legacy');
  });
});

describe('pathFromUri', () => {
  it('caminho POSIX, com percent-encoding', () => {
    expect(pathFromUri('file:///repo/a.png')).toBe('/repo/a.png');
    expect(pathFromUri('file:///home/user/my%20file.png')).toBe('/home/user/my file.png');
    expect(pathFromUri('file:///tmp/caf%C3%A9.png')).toBe('/tmp/café.png');
  });

  it('drive do Windows (a letra da URI decide, não o sistema), com percent-encoding', () => {
    expect(pathFromUri('file:///C:/repo/a.png')).toBe('C:\\repo\\a.png');
    expect(pathFromUri('file:///C:/repo/my%20file.png')).toBe('C:\\repo\\my file.png');
  });

  it('UNC preserva o servidor, com percent-encoding', () => {
    expect(pathFromUri('file://servidor/share/a.png')).toBe('\\\\servidor\\share\\a.png');
    expect(pathFromUri('file://servidor/share/my%20file.png')).toBe('\\\\servidor\\share\\my file.png');
  });

  it('o que não é file:// e URI inválida continuam como antes', () => {
    expect(pathFromUri('/repo/a.png')).toBe('/repo/a.png');
    expect(pathFromUri('C:\\repo\\a.png')).toBe('C:\\repo\\a.png');
    expect(pathFromUri('FILE:///C:/repo/a.png')).toBe('FILE:///C:/repo/a.png');
    expect(pathFromUri(undefined)).toBeUndefined();
    expect(pathFromUri('')).toBeUndefined();
    expect(pathFromUri('   ')).toBeUndefined();
    // % inválido: o decode falha e sobra o resto depois de "file://". %2F o decode aceita e vira barra.
    expect(pathFromUri('file:///tmp/%ZZ')).toBe('/tmp/%ZZ');
    expect(pathFromUri('file://%')).toBe('%');
    expect(pathFromUri('file:///home/user/a%2Fb.png')).toBe('/home/user/a/b.png');
  });
});
