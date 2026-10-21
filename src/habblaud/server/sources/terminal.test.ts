import { describe, expect, it } from 'vitest';
import type { TerminalEntry } from '../../shared/types';
import { L } from '../test/fixtures';
import { createTerminalParser, DETAIL_MAX, INPUT_MAX, RESULT_MAX, RESULT_MAX_LINES, TEXT_MAX, THINKING_MAX } from './terminal';

const T0 = Date.parse('2026-10-06T10:00:00Z');
// Token falso montado em partes (nada de segredo literal no repositório).
const TOKEN = ['sk', 'ant', 'api03', 'testeFALSO0123456789abcdefXYZ'].join('-');

function run(lines: string[]): TerminalEntry[] {
  const p = createTerminalParser();
  return lines.flatMap((l) => p.push(l));
}

function only<K extends TerminalEntry['kind']>(entries: TerminalEntry[], kind: K): Array<Extract<TerminalEntry, { kind: K }>> {
  return entries.filter((e): e is Extract<TerminalEntry, { kind: K }> => e.kind === kind);
}

/** Linha attachment `queued_command` (prompt digitado com o agente ocupado ou notificação entregue no meio do turno). */
function queued(prompt: unknown, extra: Record<string, unknown> = {}, at = T0): string {
  return JSON.stringify({
    type: 'attachment',
    uuid: `att-${Math.random().toString(36).slice(2)}`,
    timestamp: new Date(at).toISOString(),
    sessionId: 'sess-teste',
    cwd: '/projetos/demo',
    attachment: { type: 'queued_command', prompt, ...extra },
  });
}

function userBlocks(blocks: Array<Record<string, unknown>>, at = T0): string {
  return JSON.stringify({ type: 'user', uuid: `u-${Math.random().toString(36).slice(2)}`, timestamp: new Date(at).toISOString(), cwd: '/projetos/demo', message: { role: 'user', content: blocks } });
}

describe('terminal — prompts do usuário', () => {
  it('prompt vira user; meta e lembretes de sistema somem; at vem do timestamp', () => {
    const e = run([
      L.meta('Caveat: mensagens locais'),
      L.prompt('<system-reminder>contexto interno</system-reminder>\nArruma o bug do carrinho\n\ncom calma', { at: T0 }),
      L.prompt('<system-reminder>só isso</system-reminder>'),
    ]);
    expect(e).toHaveLength(1);
    expect(e[0]).toMatchObject({ kind: 'user', at: T0, text: 'Arruma o bug do carrinho\n\ncom calma' });
  });

  it('imagens viram "[imagem]" (sem repetir quando o texto já traz "[Image #1]")', () => {
    const img = { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } };
    const e = run([
      userBlocks([{ type: 'text', text: 'olha isso' }, img, img]),
      userBlocks([{ type: 'text', text: '[Image #1] quero assim' }, img]),
      userBlocks([img]),
    ]);
    expect(only(e, 'user').map((x) => x.text)).toEqual(['olha isso\n[imagem] [imagem]', '[Image #1] quero assim', '[imagem]']);
  });

  it('comandos de barra viram "/x args" e a saída local vira system (inclusive nas linhas system local_command)', () => {
    const e = run([
      L.prompt('<command-message>review</command-message>\n<command-name>/review</command-name>\n<command-args>123</command-args>'),
      L.prompt('<local-command-stdout>\x1b[1mRevisão pronta\x1b[22m</local-command-stdout>'),
      L.system('local_command', { content: '<command-name>/model</command-name>\n<command-message>model</command-message>\n<command-args></command-args>', level: 'info' }),
      L.system('local_command', { content: '<local-command-stdout>Modelo mantido</local-command-stdout>', level: 'info' }),
      L.system('local_command', { content: '<local-command-stdout></local-command-stdout>', level: 'info' }),
    ]);
    expect(e.map((x) => [x.kind, x.kind === 'system' ? `${x.text} | ${x.detail}` : 'text' in x ? x.text : ''])).toEqual([
      ['user', '/review 123'],
      ['system', 'Saída de /review | Revisão pronta'],
      ['user', '/model'],
      ['system', 'Saída de /model | Modelo mantido'],
    ]);
  });

  it('modo bash do usuário: "! cmd" e a saída como system', () => {
    const e = run([L.prompt('<bash-input>ls -la</bash-input>'), L.prompt('<bash-stdout>a.txt\nb.txt</bash-stdout><bash-stderr></bash-stderr>')]);
    expect(e[0]).toMatchObject({ kind: 'user', text: '! ls -la' });
    expect(e[1]).toMatchObject({ kind: 'system', text: 'Saída do comando', detail: 'a.txt\nb.txt', level: 'info' });
  });

  it('prompt digitado com o agente ocupado (queued_command) vira user; mensagens de outros agentes (meta) não', () => {
    const e = run([
      queued('e também o rodapé', { commandMode: 'prompt', origin: { kind: 'human' } }),
      queued([{ type: 'text', text: 'olha a tela' }, { type: 'image', source: { type: 'base64', data: 'AA' } }], { commandMode: 'prompt' }),
      queued('mensagem de outro agente', { commandMode: 'prompt', isMeta: true, origin: { kind: 'peer' } }),
    ]);
    expect(only(e, 'user').map((x) => x.text)).toEqual(['e também o rodapé', 'olha a tela\n[imagem]']);
    expect(e).toHaveLength(2);
  });

  it('tarefa agendada vira o prompt de dentro', () => {
    const e = run([L.prompt('<scheduled-task name="x" file="/tmp/x.md">\nConfere os PRs abertos\n</scheduled-task>')]);
    expect(e).toEqual([expect.objectContaining({ kind: 'user', text: 'Confere os PRs abertos' })]);
  });
});

describe('terminal — eventos da sessão', () => {
  it('interrupção (com e sem ferramenta) vira aviso', () => {
    const e = run([L.prompt('[Request interrupted by user]'), userBlocks([{ type: 'text', text: '[Request interrupted by user for tool use]' }])]);
    expect(e.map((x) => x.kind === 'system' && [x.text, x.level])).toEqual([
      ['Interrompido pelo usuário', 'warn'],
      ['Interrompido pelo usuário', 'warn'],
    ]);
  });

  it('notificação de tarefa em segundo plano (linha user e attachment), com resultado no detalhe', () => {
    const withResult =
      '<task-notification>\n<task-id>a1</task-id>\n<status>completed</status>\n<summary>Agent "Mapear arquivos" completed</summary>\n<result>Encontrei 3 arquivos.</result>\n</task-notification>';
    const e = run([
      L.notification('toolu_bg', 'completed', 'Background command "Rodar testes" completed (exit code 0)'),
      L.shellNotification('message', { taskId: 'b2', status: 'failed', summary: 'Background command "build" failed' }),
      queued(withResult, { commandMode: 'task-notification' }),
      // A fila (queue-operation) não é a entrega: ignorada.
      L.shellNotification('queue', { taskId: 'b3', status: 'completed' }),
    ]);
    const s = only(e, 'system');
    expect(s.map((x) => [x.text, x.level])).toEqual([
      ['Tarefa em segundo plano concluída: Background command "Rodar testes" completed (exit code 0)', 'info'],
      ['Tarefa em segundo plano falhou: Background command "build" failed', 'warn'],
      ['Tarefa em segundo plano concluída: Agent "Mapear arquivos" completed', 'info'],
    ]);
    expect(s[0].detail).toBeUndefined();
    expect(s[2].detail).toBe('Encontrei 3 arquivos.');
    expect(e).toHaveLength(3);
  });

  it('compactação: fronteira e resumo (truncado no detalhe)', () => {
    const summary = `Resumo da conversa anterior.\n${'linha de resumo\n'.repeat(1_000)}`;
    const e = run([
      L.system('compact_boundary', { content: 'Conversation compacted', compactMetadata: { trigger: 'auto' } }),
      JSON.stringify({ ...JSON.parse(L.prompt(summary)), isCompactSummary: true, isVisibleInTranscriptOnly: true }),
      L.system('compact_boundary', { compactMetadata: { trigger: 'manual' } }),
    ]);
    const s = only(e, 'system');
    expect(s.map((x) => x.text)).toEqual(['Conversa compactada automaticamente', 'Resumo da conversa compactada', 'Conversa compactada (/compact)']);
    expect(s[1].detail!.startsWith('Resumo da conversa anterior.')).toBe(true);
    expect(s[1].detail!.length).toBeLessThanOrEqual(DETAIL_MAX + 2);
    expect(s[1].detail!.endsWith('\n…')).toBe(true);
    expect(e.some((x) => x.kind === 'user')).toBe(false);
  });

  it('erros da API: uma entrada por sequência de tentativas e a mensagem sintética de erro', () => {
    const err = { message: '529 overloaded', formatted: 'Servidor sobrecarregado (529)' };
    const e = run([
      L.system('api_error', { level: 'error', error: err, retryAttempt: 1, maxRetries: 10, retryInMs: 500 }),
      L.system('api_error', { level: 'error', error: err, retryAttempt: 2, maxRetries: 10, retryInMs: 1000 }),
      L.system('api_error', { level: 'error', error: err, retryAttempt: 3, maxRetries: 10, retryInMs: 2000 }),
      JSON.stringify({ ...JSON.parse(L.assistant([L.text('API Error: 529 Overloaded. Try again.')], { model: '<synthetic>' })), isApiErrorMessage: true, error: 'server_error' }),
      L.assistant([L.text('No response requested.')], { model: '<synthetic>' }),
    ]);
    expect(e.map((x) => x.kind === 'system' && [x.text, x.level])).toEqual([
      ['Erro da API: Servidor sobrecarregado (529) — tentando de novo (até 10 vezes)', 'error'],
      ['API Error: 529 Overloaded. Try again.', 'error'],
    ]);
  });

  it('fim de turno, avisos informativos e recapitulação', () => {
    const e = run([
      L.system('turn_duration', { durationMs: 65_000 }),
      L.system('informational', { content: 'Unknown command: /xyz', level: 'warning' }),
      L.system('away_summary', { content: 'Você pediu X e está pronto.' }),
      L.system('stop_hook_summary', { level: 'suggestion', hookCount: 1 }),
      L.system('bridge_status', { content: '/remote-control is active · https://exemplo.invalid/sessao' }),
    ]);
    expect(e.map((x) => x.kind === 'system' && [x.text, x.level])).toEqual([
      ['Turno concluído em 1min 5s', 'info'],
      ['Unknown command: /xyz', 'warn'],
      ['Recapitulação: Você pediu X e está pronto.', 'info'],
    ]);
  });

  it('ignora o resto sem lançar', () => {
    const p = createTerminalParser();
    const junk = [
      L.raw('summary', { summary: 'x', leafUuid: 'y' }),
      L.raw('file-history-snapshot', { snapshot: {} }),
      L.raw('custom-title', { customTitle: 'Loja' }),
      L.raw('progress', { data: { type: 'hook_progress' } }),
      L.raw('last-prompt', { lastPrompt: 'oi' }),
      JSON.stringify({ type: 'queue-operation', operation: 'enqueue', content: 'oi' }),
      queued('x', { commandMode: 'bash' }),
      JSON.stringify({ type: 'attachment', attachment: { type: 'hook_success', content: 'ok' } }),
      L.raw('tipo-do-futuro', { x: 1 }),
      JSON.stringify({ type: 'assistant', message: { content: [null, 42, { type: 'tool_use' }, { type: 'text', text: 7 }] } }),
      JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result' }] } }),
      JSON.stringify({ type: 'user', message: null }),
      'isto não é json',
      '{"type":"user","message":{"content":"corta',
      '[]',
      'null',
      '"texto"',
      '',
    ];
    const out = junk.flatMap((l) => p.push(l));
    // A única entrada aproveitável: o tool_use sem nome nem id ainda aparece.
    expect(out.map((e) => e.kind)).toEqual(['tool']);
  });
});

describe('terminal — respostas e ferramentas', () => {
  it('texto (markdown cru) e thinking (com e sem texto)', () => {
    const e = run([
      L.assistant([{ type: 'thinking', thinking: 'Vou olhar o carrinho primeiro.', signature: 'sig1' }], { msgId: 'm1' }),
      L.assistant([{ type: 'thinking', thinking: '', signature: 'sig2' }], { msgId: 'm1' }),
      L.assistant([{ type: 'redacted_thinking', data: 'opaco' }], { msgId: 'm1' }),
      L.assistant([L.text('## Pronto\n\n- corrigi o **total**\n- `npm test` passa')], { msgId: 'm1', stop: 'end_turn' }),
      L.assistant([L.text('   \n')], { msgId: 'm1' }),
    ]);
    expect(e.map((x) => x.kind)).toEqual(['thinking', 'thinking', 'thinking', 'assistant']);
    expect((e[0] as { text?: string }).text).toBe('Vou olhar o carrinho primeiro.');
    expect('text' in e[1]).toBe(false);
    expect('text' in e[2]).toBe(false);
    expect(e[3]).toMatchObject({ text: '## Pronto\n\n- corrigi o **total**\n- `npm test` passa' });
  });

  it('títulos no estilo do Claude Code, caminhos relativos ao cwd e argumentos', () => {
    const tools = [
      L.tool('t1', 'Bash', { command: 'npm test -- --run\necho fim', description: 'Roda os testes' }),
      L.tool('t2', 'Read', { file_path: '/projetos/demo/src/Cart.tsx' }),
      L.tool('t3', 'Read', { file_path: '/outro/lugar/x.ts', offset: 10, limit: 20 }),
      L.tool('t4', 'Edit', { file_path: '/projetos/demo/src/a.ts', old_string: 'const a = 1;\nconst b = 2;', new_string: 'const a = 3;' }),
      L.tool('t5', 'Write', { file_path: '/projetos/demo/README.md', content: '# Demo\n\nOlá\n' }),
      L.tool('t6', 'Grep', { pattern: 'useCart', path: '/projetos/demo/src', output_mode: 'content' }),
      L.tool('t7', 'Glob', { pattern: '**/*.ts' }),
      L.tool('t8', 'WebFetch', { url: 'https://exemplo.invalid/docs', prompt: 'Resuma a API' }),
      L.tool('t9', 'WebSearch', { query: 'pix devolução api' }),
      L.tool('t10', 'Agent', { description: 'Mapear arquivos', subagent_type: 'Explore', prompt: 'Liste os arquivos do checkout' }),
      L.tool('t11', 'mcp__claude_ai_Exemplo__buscar_itens', { termo: 'x', limite: 3 }),
      L.tool('t12', 'TodoWrite', {
        todos: [
          { content: 'Ler código', status: 'completed' },
          { content: 'Corrigir', status: 'in_progress' },
          { content: 'Testar', status: 'pending' },
        ],
      }),
      L.tool('t13', 'TaskUpdate', { taskId: '3', status: 'completed' }),
      L.tool('t14', 'FerramentaNova', { alvo: 'servidor', vezes: 2 }),
      L.tool('t15', 'mcp__srv__ping', {}),
      L.tool('t16', 'MultiEdit', { file_path: '/projetos/demo/b.ts', edits: [{ old_string: 'x', new_string: 'y' }, { old_string: 'p', new_string: 'q' }] }),
    ];
    const e = only(run([L.assistant(tools, { msgId: 'm1' })]), 'tool');
    const view = (id: string) => {
      const t = e.find((x) => x.id === id)!;
      return { title: t.title, input: t.input, kind: t.inputKind };
    };
    expect(e.map((x) => x.tool)).toEqual(tools.map((t) => t.name));
    expect(view('t1')).toEqual({ title: 'Bash(npm test -- --run …)', input: 'npm test -- --run\necho fim', kind: 'command' });
    expect(view('t2')).toEqual({ title: 'Read(src/Cart.tsx)', input: undefined, kind: undefined });
    expect(view('t3')).toEqual({ title: 'Read(/outro/lugar/x.ts)', input: '{\n  "offset": 10,\n  "limit": 20\n}', kind: 'json' });
    expect(view('t4')).toEqual({ title: 'Edit(src/a.ts)', input: '- const a = 1;\n- const b = 2;\n+ const a = 3;', kind: 'diff' });
    expect(view('t5')).toEqual({ title: 'Write(README.md)', input: '+ # Demo\n+ \n+ Olá', kind: 'diff' });
    expect(view('t6')).toEqual({ title: 'Grep(useCart)', input: '{\n  "path": "src",\n  "output_mode": "content"\n}', kind: 'json' });
    expect(view('t7')).toEqual({ title: 'Glob(**/*.ts)', input: undefined, kind: undefined });
    expect(view('t8')).toEqual({ title: 'WebFetch(https://exemplo.invalid/docs)', input: 'Resuma a API', kind: 'text' });
    expect(view('t9')).toEqual({ title: 'WebSearch(pix devolução api)', input: undefined, kind: undefined });
    expect(view('t10')).toEqual({ title: 'Agent(Explore: Mapear arquivos)', input: 'Liste os arquivos do checkout', kind: 'text' });
    expect(view('t11')).toEqual({ title: 'Exemplo - buscar_itens (MCP)', input: '{\n  "termo": "x",\n  "limite": 3\n}', kind: 'json' });
    expect(view('t12')).toEqual({ title: 'TodoWrite(1/3 concluídas)', input: '☒ Ler código\n◐ Corrigir\n☐ Testar', kind: 'text' });
    expect(view('t13').title).toBe('TaskUpdate(#3 → concluída)');
    expect(view('t14')).toEqual({ title: 'FerramentaNova(servidor)', input: '{\n  "vezes": 2\n}', kind: 'json' });
    expect(view('t15')).toEqual({ title: 'srv - ping (MCP)', input: undefined, kind: undefined });
    expect(view('t16')).toEqual({ title: 'MultiEdit(b.ts)', input: '- x\n+ y\n@@\n- p\n+ q', kind: 'diff' });
  });

  it('resultados: texto, blocos, imagem, erro, recusa e id próprio', () => {
    const e = run([
      L.assistant([L.tool('a', 'Bash', { command: 'npm test' }), L.tool('b', 'Read', { file_path: '/projetos/demo/logo.png' })], { at: T0 }),
      L.result('a', '\x1b[32m✓ 42 testes passaram\x1b[0m\n', { at: T0 + 2_000 }),
      userBlocks([{ type: 'tool_result', tool_use_id: 'b', content: [{ type: 'text', text: 'Imagem lida' }, { type: 'image', source: { type: 'base64', data: 'AA' } }] }]),
      L.result('c', '<tool_use_error>Arquivo inexistente</tool_use_error>', { error: true }),
      L.result('d', "The user doesn't want to proceed with this tool use. The tool use was rejected. To tell you how to proceed, the user said:\nusa a outra pasta", { error: true }),
      L.result('e', ''),
    ]);
    const r = only(e, 'result');
    expect(r.map((x) => [x.id, x.toolUseId, x.text, x.error ?? false])).toEqual([
      ['a:r', 'a', '✓ 42 testes passaram', false],
      ['b:r', 'b', 'Imagem lida\n[imagem]', false],
      ['c:r', 'c', 'Arquivo inexistente', true],
      ['d:r', 'd', 'Recusado pelo usuário: usa a outra pasta', true],
      ['e:r', 'e', '(sem saída)', false],
    ]);
    expect(r[0].at).toBe(T0 + 2_000);
    expect(r.every((x) => x.truncated === undefined)).toBe(true);
  });

  it('fork: a cópia da chamada do pai não aparece; a instrução vira o prompt', () => {
    const e = run([...L.forkStart('afork1', 'toolu_pai', 'Revisa o checkout'), L.assistant([L.tool('f1', 'Read', { file_path: '/projetos/demo/a.ts' })])]);
    expect(e.map((x) => [x.kind, x.kind === 'user' ? x.text : x.id])).toEqual([
      ['user', 'Revisa o checkout'],
      ['tool', 'f1'],
    ]);
  });
});

describe('terminal — segurança, limites e duplicatas', () => {
  it('mascara segredos em todo texto exposto', () => {
    const e = run([
      L.prompt(`usa a chave ${TOKEN} pra testar`),
      L.assistant([{ type: 'thinking', thinking: `a chave é ${TOKEN}`, signature: 's' }]),
      L.assistant([L.text(`Configurei ${TOKEN}.`)]),
      L.assistant([L.tool('t1', 'Bash', { command: `ANTHROPIC_API_KEY=${TOKEN} npm start` })]),
      L.assistant([L.tool('t2', 'WebFetch', { url: `https://api.exemplo.invalid/?k=${TOKEN}`, prompt: `token ${TOKEN}` })]),
      L.assistant([L.tool('t3', 'mcp__x__y', { header: `Authorization: Bearer ${TOKEN}` })]),
      L.assistant([L.tool('t4', 'Edit', { file_path: '/projetos/demo/.env', old_string: 'KEY=antiga', new_string: `KEY=${TOKEN}` })]),
      L.result('t1', `iniciado com ${TOKEN}`),
      L.prompt(`<local-command-stdout>${TOKEN}</local-command-stdout>`),
      L.notification('toolu_bg', 'completed', `resumo ${TOKEN}`),
      L.system('informational', { content: `aviso ${TOKEN}`, level: 'notice' }),
    ]);
    expect(e.length).toBeGreaterThanOrEqual(11);
    const json = JSON.stringify(e);
    expect(json).not.toContain('testeFALSO');
    expect(json).toContain('sk-***');
  });

  it('resultado longo: corta em linhas e caracteres e marca truncated', () => {
    const manyLines = Array.from({ length: 500 }, (_, i) => `linha ${i + 1}`).join('\n');
    const wide = 'x'.repeat(RESULT_MAX * 5);
    const r = only(run([L.result('a', manyLines), L.result('b', wide), L.result('c', 'curto')]), 'result');
    expect(r[0].text.split('\n')).toHaveLength(RESULT_MAX_LINES);
    expect(r[0].text.endsWith(`linha ${RESULT_MAX_LINES}`)).toBe(true);
    expect(r[0].truncated).toBe(true);
    expect(r[1].text.length).toBeLessThanOrEqual(RESULT_MAX);
    expect(r[1].truncated).toBe(true);
    expect(r[2].truncated).toBeUndefined();
  });

  it('textos longos: user/assistant, thinking e argumentos ficam nos limites', () => {
    const huge = 'palavra '.repeat(10_000);
    const e = run([
      L.prompt(huge),
      L.assistant([L.text(huge)]),
      L.assistant([{ type: 'thinking', thinking: huge, signature: 's' }]),
      L.assistant([L.tool('t1', 'Bash', { command: huge })]),
      L.assistant([L.tool('t2', 'Write', { file_path: '/projetos/demo/a.txt', content: 'linha\n'.repeat(5_000) })]),
    ]);
    const len = (x: TerminalEntry) => ('text' in x && x.text ? x.text.length : 0);
    expect(len(e[0])).toBeLessThanOrEqual(TEXT_MAX + 2);
    expect(len(e[1])).toBeLessThanOrEqual(TEXT_MAX + 2);
    expect(len(e[2])).toBeLessThanOrEqual(THINKING_MAX + 2);
    expect((e[0] as { text: string }).text.endsWith('\n…')).toBe(true);
    for (const t of only(e, 'tool')) {
      expect(t.input!.length).toBeLessThanOrEqual(INPUT_MAX + 8);
      expect(t.title.length).toBeLessThanOrEqual(120);
    }
    expect(only(e, 'tool')[1].input!.endsWith('+ …')).toBe(true);
  });

  it('mascara antes de cortar: um segredo na fronteira do corte não vaza pela metade', () => {
    for (const pad of [RESULT_MAX - 10, RESULT_MAX * 2 + 1_024 - 12, RESULT_MAX * 2 + 1_024 - 30]) {
      const r = only(run([L.result('a', `${'a'.repeat(pad)} ${TOKEN} fim`)]), 'result')[0];
      expect(r.text).not.toMatch(/sk-ant|testeFALSO|testeF/);
    }
    const t = only(run([L.assistant([L.tool('t', 'Bash', { command: `${'b'.repeat(INPUT_MAX - 6)} ${TOKEN}` })])]), 'tool')[0];
    expect(t.input).not.toMatch(/sk-ant|teste/);
    // Muitos segredos encolhem o texto ao mascarar: o fim do recorte prévio (com meio token, curto demais
    // para as expressões) ficaria visível se não fosse descartado.
    const window = RESULT_MAX * 2 + 1_024;
    const step = TOKEN.length + 1;
    const lead = window - 9 - step * 200 - 1; // o recorte deixa só "sk-ant-ap"
    const r = only(run([L.result('b', `${'z'.repeat(lead)} ${`${TOKEN} `.repeat(400)}`)]), 'result')[0];
    expect(r.truncated).toBe(true);
    expect(r.text).toContain('sk-***');
    expect(r.text).not.toMatch(/sk-ant|testeF/);
  });

  it('sem duplicatas: linha repetida, mensagem em várias linhas e bloco repetido', () => {
    const think = L.assistant([{ type: 'thinking', thinking: '', signature: 'abc' }], { msgId: 'm1' });
    const lines = [
      L.prompt('oi', { at: T0 }),
      think,
      think,
      L.assistant([L.text('Primeiro')], { msgId: 'm1' }),
      L.assistant([L.tool('t1', 'Bash', { command: 'ls' })], { msgId: 'm1' }),
      // Linha cumulativa (outra uuid, repetindo os blocos anteriores da mesma mensagem).
      L.assistant([L.text('Primeiro'), L.tool('t1', 'Bash', { command: 'ls' }), L.text('Segundo')], { msgId: 'm1' }),
      L.result('t1', 'ok'),
    ];
    const e = run([...lines, lines[6]]);
    expect(e.map((x) => x.kind)).toEqual(['user', 'thinking', 'assistant', 'tool', 'assistant', 'result']);
    expect(only(e, 'assistant').map((x) => x.text)).toEqual(['Primeiro', 'Segundo']);
    expect(new Set(e.map((x) => x.id)).size).toBe(e.length);
  });

  it('linha sem timestamp usa o último visto', () => {
    const noTs = JSON.parse(L.prompt('sem hora')) as Record<string, unknown>;
    delete noTs.timestamp;
    const e = run([L.prompt('com hora', { at: T0 + 5_000 }), JSON.stringify(noTs)]);
    expect(e.map((x) => x.at)).toEqual([T0 + 5_000, T0 + 5_000]);
  });

  it('aguenta ~4 MB de JSONL rapidamente', () => {
    const lines: string[] = [];
    let bytes = 0;
    for (let i = 0; bytes < 4 * 1024 * 1024; i++) {
      const batch = [
        L.assistant([L.tool(`t${i}`, 'Bash', { command: `npm run build -- --step ${i}` })], { at: T0 + i }),
        L.result(`t${i}`, `saída ${i}\n`.repeat(200), { at: T0 + i }),
        L.assistant([L.text(`Passo ${i} pronto. ${'texto '.repeat(50)}`)], { at: T0 + i }),
      ];
      for (const l of batch) {
        lines.push(l);
        bytes += l.length + 1;
      }
    }
    const start = performance.now();
    const e = run(lines);
    const ms = performance.now() - start;
    expect(e.length).toBe(lines.length);
    expect(ms).toBeLessThan(3_000);
  });
});
