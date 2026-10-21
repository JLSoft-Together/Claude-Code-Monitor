// Terminal do Codex: linhas sintéticas de rollout (paginated e legacy) viram as entradas do terminal.
import { describe, expect, it } from 'vitest';
import type { TerminalEntry } from '../../../shared/types';
import { R, threadId } from '../../test/codex-fixtures';
import { createCodexTerminalParser } from './terminal';

const T = threadId(1);

function entries(lines: string[]): TerminalEntry[] {
  const p = createCodexTerminalParser();
  return lines.flatMap((l) => p.push(l));
}

describe('terminal do Codex', () => {
  it('paginated: prompt, raciocínio resumido, comando com a saída, diff, MCP e fim do turno', () => {
    const out = entries([
      R.meta(T, { cwd: '/projetos/loja' }),
      R.message('developer', 'instruções injetadas que não aparecem'),
      R.message('user', '<environment_context>nada</environment_context>'),
      R.functionCall('c1', 'exec_command', { cmd: 'npm test' }),
      R.user(T, 't', 'u1', 'Rode os testes com o token sk-ant-abcdefghijklmnop'),
      R.reasoning(T, 't', 'r1', ['**Lendo** o projeto']),
      R.command(T, 't', 'c1', 'npm test', { exit: 1, output: 'FAIL src/a.test.ts\n' }),
      R.fileChange(T, 't', 'p1', { '/projetos/loja/src/a.ts': { type: 'update', unified_diff: '@@ -1 +1 @@\n-velho\n+novo\n' } }),
      R.mcp(T, 't', 'm1', 'github', 'get_issue', { owner: 'o', repo: 'r', issue_number: 1 }, { result: 'Issue 1: bug' }),
      R.agent(T, 't', 'a1', 'Corrigi o **teste**.'),
      R.taskComplete('t', Date.now(), 65_000),
    ]);
    expect(out.map((e) => e.kind)).toEqual(['user', 'thinking', 'tool', 'result', 'tool', 'tool', 'result', 'assistant', 'system']);
    expect(out[0]).toMatchObject({ kind: 'user', id: 'u1:u', text: 'Rode os testes com o token sk-***' });
    expect(out[1]).toMatchObject({ kind: 'thinking', text: '**Lendo** o projeto' });
    expect(out[2]).toMatchObject({ kind: 'tool', id: 'c1', tool: 'Bash', title: 'Bash(npm test)', input: 'npm test', inputKind: 'command' });
    expect(out[3]).toMatchObject({ kind: 'result', toolUseId: 'c1', error: true, text: 'Código de saída 1\nFAIL src/a.test.ts' });
    expect(out[4]).toMatchObject({ kind: 'tool', tool: 'Edit', title: 'Edit(src/a.ts)', inputKind: 'diff' });
    expect((out[4] as { input?: string }).input).toContain('+novo');
    expect(out[5]).toMatchObject({ kind: 'tool', tool: 'mcp__github__get_issue', title: 'github - get_issue (MCP)' });
    expect(out[6]).toMatchObject({ kind: 'result', toolUseId: 'm1', text: 'Issue 1: bug' });
    expect(out[7]).toMatchObject({ kind: 'assistant', text: 'Corrigi o **teste**.' });
    expect(out[8]).toMatchObject({ kind: 'system', text: 'Turno concluído em 1min 5s' });
  });

  it('saída longa: truncada e marcada; turno interrompido', () => {
    const long = Array.from({ length: 400 }, (_, i) => `linha ${i}`).join('\n');
    const out = entries([R.meta(T), R.command(T, 't', 'c1', 'cat log.txt', { output: long }), R.turnAborted('t')]);
    expect(out[1]).toMatchObject({ kind: 'result', truncated: true });
    expect((out[1] as { text: string }).text.split('\n').length).toBeLessThanOrEqual(120);
    expect(out[2]).toMatchObject({ kind: 'system', text: 'Interrompido pelo usuário', level: 'warn' });
  });

  it('legacy: prompt, resposta, raciocínio e o par function_call / saída', () => {
    const out = entries([
      R.meta(T, { history: null }),
      R.legacyUser('Liste os arquivos'),
      R.legacyReasoning('vou listar'),
      R.functionCall('c1', 'shell', { command: ['bash', '-lc', 'ls'] }),
      R.functionOutput('c1', JSON.stringify({ output: 'a.ts\nb.ts', metadata: { exit_code: 0 } })),
      R.legacyAgent('Dois arquivos.'),
    ]);
    expect(out.map((e) => [e.kind, 'text' in e ? e.text : 'title' in e ? e.title : ''])).toEqual([
      ['user', 'Liste os arquivos'],
      ['thinking', 'vou listar'],
      ['tool', 'Bash(ls)'],
      ['result', 'a.ts\nb.ts'],
      ['assistant', 'Dois arquivos.'],
    ]);
  });

  it('code mode do app: a mensagem enviada a você vira resposta, uma vez só', () => {
    const out = entries([
      R.meta(T),
      R.delivered('call_msg', 'Achei o **bug**'),
      R.mcp(T, 't', 'call_msg', 'codex_apps', 'user_messaging_send_message', { text: 'Achei o **bug**' }, { result: 'ok' }),
      R.message('assistant', 'contexto que não aparece'),
    ]);
    expect(out).toEqual([{ kind: 'assistant', id: 'call_msg', at: expect.any(Number), text: 'Achei o **bug**' }]);
  });

  it('paginated ignora os eventos legacy e as chamadas de response_item', () => {
    const out = entries([R.meta(T), R.legacyUser('dup'), R.functionCall('c1', 'exec_command', { cmd: 'ls' }), R.functionOutput('c1', 'x')]);
    expect(out).toEqual([]);
  });
});
