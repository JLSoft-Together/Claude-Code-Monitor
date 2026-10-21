import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { log } from '../log';
import { L, tempDir } from '../test/fixtures';
import { FileTail, MAX_LINE_BYTES } from './tail';
import {
  applyTaskOp,
  createTranscriptState,
  forkDirective,
  mergePrefix,
  parseLine,
  parseTaskNotification,
  scanPrefix,
  titleOf,
  type LineResult,
  type TranscriptState,
} from './transcript';

const T0 = Date.parse('2026-10-06T10:00:00Z');

function feed(state: TranscriptState, lines: string[]): LineResult[] {
  return lines.map((l) => parseLine(state, l, { idPrefix: 'acc:1', now: T0 }));
}

function acts(results: LineResult[]) {
  return results.flatMap((r) => r.activities);
}

describe('parseLine — atividades', () => {
  it('prompt, pensamento, ferramenta, resposta e fim de turno', () => {
    const s = createTranscriptState();
    const r = feed(s, [
      L.prompt('Arruma o bug do carrinho', { at: T0 }),
      L.assistant([L.thinking()], { at: T0 + 1000, msgId: 'm1' }),
      L.assistant([L.tool('tu1', 'Read', { file_path: '/p/src/Cart.tsx' })], { at: T0 + 2000, msgId: 'm1' }),
      L.result('tu1', 'conteúdo', { at: T0 + 2500 }),
      L.assistant([L.text('Pronto, corrigi.')], { at: T0 + 3000, msgId: 'm2', stop: 'end_turn' }),
      L.system('turn_duration', { durationMs: 65_000 }, { at: T0 + 3100 }),
    ]);
    const a = acts(r);
    expect(a.map((x) => x.activity.kind)).toEqual(['prompt', 'think', 'read', 'respond', 'done']);
    expect(a[2].activity).toMatchObject({ text: 'Lendo Cart.tsx', tool: 'Read', at: T0 + 2000 });
    expect(a[4].activity).toMatchObject({ text: 'Concluiu em 1min 5s', durationMs: 65_000 });
    expect(a.every((x) => x.activity.id.startsWith('acc:1#'))).toBe(true);
    expect(new Set(a.map((x) => x.activity.id)).size).toBe(a.length);
    expect(s.ended).toBe(true);
    expect(s.stats.toolCalls).toBe(1);
  });

  it('ignora meta, comandos locais, lembretes e tipos desconhecidos', () => {
    const s = createTranscriptState();
    const r = feed(s, [
      L.meta('Caveat: mensagens locais'),
      L.prompt('<command-name>/clear</command-name>\n<command-message>clear</command-message>'),
      L.prompt('<local-command-stdout>ok</local-command-stdout>'),
      L.prompt('<system-reminder>x</system-reminder>'),
      L.raw('file-history-snapshot', { snapshot: {} }),
      L.raw('tipo-do-futuro', { x: 1 }),
      'isto não é json',
      '[]',
    ]);
    expect(acts(r)).toEqual([]);
  });

  it('comando de barra de trabalho vira prompt', () => {
    const s = createTranscriptState();
    const a = acts(feed(s, [L.prompt('<command-message>review</command-message>\n<command-name>/review</command-name>\n<command-args>123</command-args>')]));
    expect(a).toHaveLength(1);
    expect(a[0].activity.kind).toBe('prompt');
    expect(a[0].activity.detail).toBe('/review 123');
  });

  it('um único "Pensando…" por mensagem', () => {
    const s = createTranscriptState();
    const a = acts(
      feed(s, [
        L.assistant([L.thinking()], { at: T0, msgId: 'm1' }),
        L.assistant([L.thinking()], { at: T0 + 100, msgId: 'm1' }),
      ]),
    );
    expect(a).toHaveLength(1);
  });

  it('erro de ferramenta antiga vai para o histórico sem virar a atividade atual', () => {
    const s = createTranscriptState();
    const r = feed(s, [
      L.assistant([L.tool('a', 'Bash', { command: 'npm test' }), L.tool('b', 'Read', { file_path: '/x/y.ts' })], { at: T0 }),
      L.result('a', 'Exit code 1\nfalhou', { error: true, at: T0 + 10 }),
      L.result('b', 'Arquivo inexistente', { error: true, at: T0 + 20 }),
    ]);
    const a = acts(r);
    const errors = a.filter((x) => x.activity.kind === 'error');
    expect(errors).toHaveLength(2);
    expect(errors[0]).toMatchObject({ current: false, activity: { text: 'Erro em Bash', detail: 'Exit code 1', error: true } });
    expect(errors[1].current).toBe(true);
  });

  it('interrupção e recusa', () => {
    const s = createTranscriptState();
    const a = acts(
      feed(s, [
        L.assistant([L.tool('a', 'Edit', { file_path: '/x/a.ts' })], { at: T0 }),
        L.result('a', "The user doesn't want to proceed with this tool use.", {
          error: true,
          extraText: '[Request interrupted by user for tool use]',
        }),
        L.assistant([L.tool('b', 'Write', { file_path: '/x/b.ts' })], { at: T0 + 10 }),
        L.result('b', "The user doesn't want to proceed with this tool use. The tool use was rejected", { error: true }),
      ]),
    );
    expect(a.map((x) => x.activity.text)).toEqual(['Editando a.ts', 'Interrompido por você', 'Escrevendo b.ts', 'Você recusou: Write']);
    expect(s.ended).toBe(false);
  });

  it('compactação, erro de API e resultado em segundo plano', () => {
    const s = createTranscriptState();
    const r = feed(s, [
      L.system('compact_boundary', { compactMetadata: {} }),
      L.system('api_error', { retryAttempt: 1 }),
      L.system('api_error', { retryAttempt: 2 }),
      L.notification('toolu_bg', 'completed', 'Tudo certo'),
    ]);
    const a = acts(r);
    expect(a.map((x) => x.activity.kind)).toEqual(['compact', 'wait', 'other']);
    expect(a[2].activity.detail).toBe('Tudo certo');
    expect(r[3].signals).toEqual([{ type: 'notification', toolUseId: 'toolu_bg', taskId: 't1', status: 'completed', summary: 'Tudo certo' }]);
  });
});

describe('parseLine — títulos, tarefas e números', () => {
  it('título: custom-title > agent-name > ai-title > último prompt', () => {
    const s = createTranscriptState();
    feed(s, [L.prompt('Faz a página de checkout com resumo')]);
    expect(titleOf(s)).toBe('Faz a página de checkout com resumo');
    feed(s, [L.raw('ai-title', { aiTitle: 'Checkout' })]);
    expect(titleOf(s)).toBe('Checkout');
    feed(s, [L.raw('agent-name', { agentName: 'Agente X' })]);
    expect(titleOf(s)).toBe('Agente X');
    feed(s, [L.raw('custom-title', { customTitle: 'Loja' })]);
    expect(titleOf(s)).toBe('Loja');
  });

  it('TodoWrite substitui a lista; TaskCreate/TaskUpdate editam (id vindo do resultado)', () => {
    const s = createTranscriptState();
    feed(s, [
      L.assistant([
        L.tool('t1', 'TodoWrite', {
          todos: [
            { content: 'Ler código', status: 'completed', activeForm: 'Lendo código' },
            { content: 'Corrigir', status: 'in_progress', activeForm: 'Corrigindo' },
          ],
        }),
      ]),
    ]);
    expect(s.tasks.map((t) => [t.id, t.title, t.status])).toEqual([
      ['1', 'Ler código', 'completed'],
      ['2', 'Corrigir', 'in_progress'],
    ]);
    const s2 = createTranscriptState();
    feed(s2, [
      L.assistant([L.tool('c1', 'TaskCreate', { subject: 'Escrever testes', activeForm: 'Escrevendo testes' })]),
      L.result('c1', 'Task #7 created successfully', { toolUseResult: { task: { id: '7', subject: 'Escrever testes' } } }),
      L.assistant([L.tool('c2', 'TaskCreate', { subject: 'Revisar' })]),
      L.result('c2', 'Task #8 created successfully: Revisar'),
      L.assistant([L.tool('u1', 'TaskUpdate', { taskId: '7', status: 'in_progress' })]),
      L.assistant([L.tool('u2', 'TaskUpdate', { taskId: '8', status: 'deleted' })]),
    ]);
    expect(s2.tasks).toEqual([{ id: '7', title: 'Escrever testes', status: 'in_progress', activeForm: 'Escrevendo testes' }]);
  });

  it('tokens: linhas da mesma mensagem contam uma vez (com o uso final)', () => {
    const s = createTranscriptState();
    feed(s, [
      L.assistant([L.thinking()], { msgId: 'm1', usage: { input_tokens: 2, output_tokens: 3, cache_read_input_tokens: 1000, cache_creation_input_tokens: 50 } }),
      L.assistant([L.tool('x', 'Bash', { command: 'ls' })], {
        msgId: 'm1',
        usage: { input_tokens: 2, output_tokens: 40, cache_read_input_tokens: 1000, cache_creation_input_tokens: 50 },
      }),
      L.assistant([L.text('ok')], { msgId: 'm2', usage: { input_tokens: 5, output_tokens: 7, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } }),
    ]);
    expect(s.stats.tokensIn).toBe(1052 + 5);
    expect(s.stats.tokensOut).toBe(40 + 7);
    expect(s.stats.toolCalls).toBe(1);
  });

  it('cost-state mais recente vale; modelo, branch e modo de permissão', () => {
    const s = createTranscriptState();
    feed(s, [
      L.raw('cost-state', { totalCostUSD: 0.5, totalLinesAdded: 10, totalLinesRemoved: 2 }),
      L.raw('cost-state', { totalCostUSD: 1.23456, totalLinesAdded: 30, totalLinesRemoved: 4 }),
      L.raw('permission-mode', { permissionMode: 'auto' }),
      L.assistant([L.text('oi')], { model: 'claude-opus-teste', gitBranch: 'feat/x' }),
      L.assistant([L.text('oi')], { model: '<synthetic>', gitBranch: 'HEAD' }),
    ]);
    expect(s.stats).toMatchObject({ costUSD: 1.2346, linesAdded: 30, linesRemoved: 4 });
    expect(s.model).toBe('claude-opus-teste');
    expect(s.gitBranch).toBe('feat/x');
    expect(s.permissionMode).toBe('auto');
  });
});

describe('parseLine — sinais de subagentes', () => {
  it('Agent em primeiro plano: spawn e término', () => {
    const s = createTranscriptState();
    const r = feed(s, [
      L.assistant([L.tool('toolu_a', 'Agent', { description: 'Revisar código', subagent_type: 'Explore', prompt: '...' })]),
      L.result('toolu_a', 'resumo', { toolUseResult: { status: 'completed', agentId: 'abc123', totalTokens: 10 } }),
    ]);
    expect(r[0].signals).toEqual([
      { type: 'spawn', spawn: expect.objectContaining({ toolUseId: 'toolu_a', tool: 'Agent', description: 'Revisar código', subagentType: 'Explore', background: false }) },
    ]);
    expect(r[1].signals).toEqual([{ type: 'finished', toolUseId: 'toolu_a', agentId: 'abc123', error: false }]);
    expect(s.stats.subagents).toBe(1);
  });

  it('em segundo plano: lançado (não termina) e depois notificação', () => {
    const s = createTranscriptState();
    const r = feed(s, [
      L.assistant([L.tool('toolu_b', 'Agent', { description: 'Pesquisar', subagent_type: 'fork', run_in_background: 'true' })]),
      L.result('toolu_b', 'lançado', { toolUseResult: { isAsync: true, status: 'async_launched', agentId: 'bg1' } }),
      L.assistant([L.tool('toolu_w', 'Workflow', { scriptPath: '/x.js' })]),
      L.result('toolu_w', 'ok', { toolUseResult: { status: 'async_launched', taskId: 'w1', runId: 'wf_1' } }),
      L.assistant([L.tool('toolu_s', 'TaskStop', { task_id: 'w1' })]),
      L.result('toolu_s', 'parado'),
    ]);
    expect(r[0].signals[0]).toMatchObject({ type: 'spawn', spawn: { background: true } });
    expect(r[1].signals).toEqual([{ type: 'launched', toolUseId: 'toolu_b', agentId: 'bg1' }]);
    expect(r[3].signals).toEqual([{ type: 'launched', toolUseId: 'toolu_w', runId: 'wf_1', taskId: 'w1' }]);
    expect(r[5].signals).toEqual([{ type: 'stopped', taskId: 'w1' }]);
  });

  it('fork: a cópia herdada da chamada Agent não vira spawn nem término; a instrução vira o prompt', () => {
    const s = createTranscriptState();
    const r = feed(s, [
      ...L.forkStart('fk1', 'toolu_fk', 'Desenhe as poses novas', { agentId: 'fk1' }),
      L.assistant([L.tool('r1', 'Read', { file_path: '/projetos/demo/a.ts' })], { agentId: 'fk1' }),
    ]);
    expect(r.flatMap((x) => x.signals)).toEqual([]);
    expect(acts(r).map((a) => [a.activity.kind, a.activity.text])).toEqual([
      ['prompt', expect.stringContaining('Desenhe as poses novas')],
      ['read', 'Lendo a.ts'],
    ]);
    expect(s.stats).toMatchObject({ subagents: 0, toolCalls: 1 });
    expect(s.lastPrompt).toBe('Desenhe as poses novas');
    expect(s.pendingTools.has('toolu_fk')).toBe(false);
    expect(forkDirective('<fork-boilerplate>\nregras\n</fork-boilerplate>\n\nYour directive: Faça X')).toBe('Faça X');
  });

  it('notificação enfileirada (queue-operation) também sinaliza, sem atividade', () => {
    const s = createTranscriptState();
    const r = parseLine(
      s,
      JSON.stringify({ type: 'queue-operation', operation: 'enqueue', content: '<task-notification><tool-use-id>toolu_q</tool-use-id><status>completed</status></task-notification>' }),
      { idPrefix: 'p', now: T0 },
    );
    expect(r.activities).toEqual([]);
    expect(r.signals).toEqual([{ type: 'notification', toolUseId: 'toolu_q', status: 'completed' }]);
  });

  it('parseTaskNotification', () => {
    expect(parseTaskNotification('<task-notification><task-id>x</task-id><status>killed</status></task-notification>')).toEqual({
      taskId: 'x',
      toolUseId: undefined,
      status: 'killed',
      summary: undefined,
    });
  });
});

describe('parseLine — sinais de shells', () => {
  it('Bash em segundo plano: início (rótulo, comando mascarado), lançamento com id da tarefa, término pela fila e pela mensagem', () => {
    const s = createTranscriptState();
    const r = feed(s, [
      L.assistant(
        [L.tool('toolu_bg', 'Bash', { command: 'API_TOKEN=abc123456 vendor/bin/phpunit', description: 'Rodar a suíte completa em grupos com phpunit', run_in_background: true, timeout: 600000 })],
        { at: T0 },
      ),
      L.bgLaunched('toolu_bg', 'bo0ov3q3l', { at: T0 + 500 }),
      L.shellNotification('queue', { taskId: 'bo0ov3q3l', toolUseId: 'toolu_bg', status: 'completed', summary: 'Background command "x" completed (exit code 0)' }, { at: T0 + 60_000 }),
      L.shellNotification('message', { taskId: 'bo0ov3q3l', toolUseId: 'toolu_bg', status: 'completed' }, { at: T0 + 60_100 }),
    ]);
    expect(r[0].signals).toEqual([
      {
        type: 'shellStart',
        shell: {
          toolUseId: 'toolu_bg',
          label: 'Rodar a suíte completa em grupos com phpunit',
          command: 'API_TOKEN=*** vendor/bin/phpunit',
          background: true,
          kind: 'shell',
          at: T0,
        },
      },
    ]);
    expect(r[1].signals).toEqual([{ type: 'shellResult', toolUseId: 'toolu_bg', taskId: 'bo0ov3q3l', error: false }]);
    expect(r[1].at).toBe(T0 + 500);
    expect(r[2]).toMatchObject({ activities: [], at: T0 + 60_000 });
    expect(r[2].signals).toEqual([
      { type: 'notification', taskId: 'bo0ov3q3l', toolUseId: 'toolu_bg', status: 'completed', summary: 'Background command "x" completed (exit code 0)' },
    ]);
    expect(r[3].signals[0]).toMatchObject({ type: 'notification', taskId: 'bo0ov3q3l' });
    expect(r[3].activities[0].activity.text).toBe('Recebeu resultado em segundo plano');
  });

  it('Bash em primeiro plano: início sem segundo plano e resultado sem id; sem description, o rótulo resume o comando', () => {
    const s = createTranscriptState();
    const r = feed(s, [L.assistant([L.tool('fg', 'Bash', { command: 'npm test' })]), L.result('fg', 'ok, 10 testes')]);
    expect(r[0].signals).toEqual([{ type: 'shellStart', shell: expect.objectContaining({ toolUseId: 'fg', label: 'Rodando testes', background: false }) }]);
    expect(r[1].signals).toEqual([{ type: 'shellResult', toolUseId: 'fg', error: false }]);
  });

  it('a saída de um comando em primeiro plano não é confundida com um id de segundo plano', () => {
    const s = createTranscriptState();
    const r = feed(s, [
      L.assistant([L.tool('fg', 'Bash', { command: 'cat log' })]),
      L.result('fg', 'linha 1\nCommand running in background with ID: bzzzz'),
      L.assistant([L.tool('fg2', 'Bash', { command: 'jq . t.jsonl' })]),
      // Caso real: um comando que imprime o JSON de um tool_result com essa frase na primeira linha.
      L.result('fg2', '[{"tool_use_id":"toolu_x","type":"tool_result","content":"Command running in background with ID: bo0ov3q3l. Output"}]'),
      L.assistant([L.tool('bg', 'Bash', { command: 'sleep 99', run_in_background: true })]),
      // Versões sem toolUseResult.backgroundTaskId: o id vem do texto do próprio Claude Code.
      L.result('bg', 'Command running in background with ID: b7x2k9. Output is being written to: /tmp/x'),
    ]);
    expect(r[1].signals).toEqual([{ type: 'shellResult', toolUseId: 'fg', error: false }]);
    expect(r[3].signals).toEqual([{ type: 'shellResult', toolUseId: 'fg2', error: false }]);
    expect(r[5].signals).toEqual([{ type: 'shellResult', toolUseId: 'bg', taskId: 'b7x2k9', error: false }]);
  });

  it('Monitor é um job em segundo plano do tipo monitor; KillShell/TaskStop param o id; fim de turno e interrupção', () => {
    const s = createTranscriptState();
    const r = feed(s, [
      L.assistant([L.tool('mon', 'Monitor', { description: 'erros no deploy.log', command: 'tail -f deploy.log | grep --line-buffered ERROR', timeout_ms: 600000 })]),
      L.result('mon', 'Monitor started with ID: m4k2z9', { toolUseResult: { taskId: 'm4k2z9' } }),
      L.assistant([L.tool('k1', 'KillShell', { shell_id: 'bo0ov3q3l' })]),
      L.result('k1', 'killed'),
      L.system('turn_duration', { durationMs: 1_000 }),
      L.prompt('[Request interrupted by user]'),
    ]);
    expect(r[0].signals).toEqual([{ type: 'shellStart', shell: expect.objectContaining({ kind: 'monitor', background: true, label: 'erros no deploy.log', timeoutMs: 600000 }) }]);
    expect(r[1].signals).toEqual([{ type: 'shellResult', toolUseId: 'mon', taskId: 'm4k2z9', error: false }]);
    expect(r[3].signals).toEqual([{ type: 'stopped', taskId: 'bo0ov3q3l' }]);
    expect(r[4].signals).toEqual([{ type: 'turnEnd' }]);
    expect(r[5].signals).toEqual([{ type: 'turnEnd' }]);
  });

  it('lançamento cujo tool_use ficou antes da janela lida ainda sinaliza (pelo backgroundTaskId)', () => {
    const s = createTranscriptState();
    const r = feed(s, [L.bgLaunched('toolu_antes', 'bantes1')]);
    expect(r[0].signals).toEqual([{ type: 'shellResult', toolUseId: 'toolu_antes', taskId: 'bantes1', error: false }]);
  });

  it('scanPrefix devolve os sinais de shell do começo do arquivo, com o horário de cada linha', async () => {
    const tmp = tempDir();
    try {
      const file = join(tmp.dir, 's.jsonl');
      const lines = [
        L.assistant([L.tool('b1', 'Bash', { command: 'npm run build', run_in_background: true })], { at: T0 }),
        L.bgLaunched('b1', 'bbuild', { at: T0 + 1_000 }),
        L.shellNotification('queue', { taskId: 'bbuild', toolUseId: 'b1', status: 'completed' }, { at: T0 + 9_000 }),
      ];
      writeFileSync(file, lines.map((l) => `${l}\n`).join(''));
      const prefix = await scanPrefix(file, Buffer.byteLength(lines.map((l) => `${l}\n`).join('')), new Set());
      expect(prefix.shellEvents.map((e) => [e.signal.type, e.at])).toEqual([
        ['shellStart', T0],
        ['shellResult', T0 + 1_000],
        ['notification', T0 + 9_000],
      ]);
    } finally {
      tmp.cleanup();
    }
  });

  it('scanPrefix ignora linha acima do teto e lê as vizinhas', async () => {
    const tmp = tempDir();
    const warn = vi.spyOn(log, 'warnOnce').mockImplementation(() => {});
    try {
      const file = join(tmp.dir, 's.jsonl');
      const before = `${L.raw('custom-title', { customTitle: 'Antes' })}\n`;
      const after = `${L.raw('ai-title', { aiTitle: 'Depois' })}\n`;
      const body = Buffer.concat([
        Buffer.from(before),
        Buffer.from('{"type":"agent-name","sessionId":"sess-teste","agentName":"'),
        Buffer.alloc(MAX_LINE_BYTES, 0x6e),
        Buffer.from('"}\n'),
        Buffer.from(after),
      ]);
      writeFileSync(file, body);
      const prefix = await scanPrefix(file, body.length, new Set());
      expect(prefix.state.customTitle).toBe('Antes');
      expect(prefix.state.aiTitle).toBe('Depois');
      // Booleano de propósito: o valor antigo é a linha gigante, e o diff não pode imprimi-la.
      expect(prefix.state.agentName === undefined).toBe(true);
      expect(warn).toHaveBeenCalledWith(`oversize-line:${file}`, expect.stringContaining('8 MiB'));
    } finally {
      warn.mockRestore();
      tmp.cleanup();
    }
  });
});

describe('janela final + prefixo em segundo plano', () => {
  it('mescla títulos, tarefas e números sem contar duas vezes', async () => {
    const tmp = tempDir();
    try {
      const file = join(tmp.dir, 's.jsonl');
      const prefixLines = [
        L.raw('custom-title', { customTitle: 'Projeto antigo' }),
        L.assistant([L.tool('c1', 'TaskCreate', { subject: 'Primeira' })], { msgId: 'p1' }),
        L.result('c1', 'Task #1 created successfully'),
        L.raw('cost-state', { totalCostUSD: 2, totalLinesAdded: 5, totalLinesRemoved: 1 }),
        // Mensagem que atravessa a fronteira: primeira linha no prefixo...
        L.assistant([L.thinking()], { msgId: 'mx', usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } }),
      ];
      const tailLines = [
        // ...e a segunda (uso final) na janela.
        L.assistant([L.tool('t9', 'Bash', { command: 'ls' })], { msgId: 'mx', usage: { input_tokens: 1, output_tokens: 50, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } }),
        L.assistant([L.tool('u1', 'TaskUpdate', { taskId: '1', status: 'completed' })], { msgId: 't2' }),
      ];
      const prefixText = prefixLines.map((l) => `${l}\n`).join('');
      writeFileSync(file, prefixText + tailLines.map((l) => `${l}\n`).join(''));
      const end = Buffer.byteLength(prefixText);

      const tail = new FileTail(file);
      tail.offset = end;
      const state = createTranscriptState({ trackPrefix: true });
      for (const line of tail.read().lines) parseLine(state, line, { idPrefix: 'a', now: T0 });
      expect(state.tasks).toEqual([]);
      const tailTokensOut = state.stats.tokensOut;

      const prefix = await scanPrefix(file, end, new Set(state.firstMsgIds));
      mergePrefix(state, prefix.state);
      expect(titleOf(state)).toBe('Projeto antigo');
      expect(state.tasks).toEqual([{ id: '1', title: 'Primeira', status: 'completed' }]);
      expect(state.stats.costUSD).toBe(2);
      expect(state.stats.toolCalls).toBe(3);
      // 'mx' foi contada só pela janela (uso final); 'p1' veio do prefixo.
      expect(state.stats.tokensOut).toBe(tailTokensOut + 5);
    } finally {
      tmp.cleanup();
    }
  });

  it.each(['antes', 'depois'])('TaskCreate preserva a tarefa concluída do prefixo quando o resultado chega %s da mesclagem', (quando) => {
    const prefix = createTranscriptState();
    feed(prefix, [
      L.assistant([L.tool('c1', 'TaskCreate', { subject: 'Antiga' })]),
      L.result('c1', 'Task #1 created successfully'),
      L.assistant([L.tool('u1', 'TaskUpdate', { taskId: '1', status: 'completed' })]),
    ]);
    const state = createTranscriptState({ trackPrefix: true });
    feed(state, [L.assistant([L.tool('c2', 'TaskCreate', { subject: 'Nova' })])]);
    const result = L.result('c2', 'Task #29 created successfully');
    if (quando === 'antes') feed(state, [result]);

    mergePrefix(state, prefix);
    if (quando === 'depois') {
      expect(state.tasks).toHaveLength(2);
      expect(state.tasks[0]).toEqual({ id: '1', title: 'Antiga', status: 'completed' });
      feed(state, [result]);
    }
    expect(state.tasks).toEqual([
      { id: '1', title: 'Antiga', status: 'completed' },
      { id: '29', title: 'Nova', status: 'pending' },
    ]);
  });

  it('applyTaskOp ignora atualização de tarefa desconhecida', () => {
    expect(applyTaskOp([], { op: 'update', id: '9', status: 'completed' })).toEqual([]);
  });
});
