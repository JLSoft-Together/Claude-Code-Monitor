import { describe, expect, it } from 'vitest';
import type { AgentInfo, ShellJob, TerminalEntry } from '../../../shared/types';
import {
  diffLineKind,
  entryKey,
  footerGlyph,
  entryTimeTitle,
  moreLabel,
  parseAppend,
  parseInit,
  previewText,
  sessionEndedText,
  sessionKey,
  sessionProjectName,
  sessionTerminalUrl,
  showToolInput,
  spinnerFrames,
  splitPreview,
  splitToolTitle,
  TerminalLog,
  terminalFooter,
  terminalUrl,
} from './terminal';

const user = (id: string, text = 'oi'): TerminalEntry => ({ kind: 'user', id, at: 1, text });
const tool = (id: string, title = 'Bash(npm test)'): TerminalEntry => ({ kind: 'tool', id, at: 2, tool: 'Bash', title });
const result = (id: string, toolUseId: string, extra: Partial<Extract<TerminalEntry, { kind: 'result' }>> = {}): TerminalEntry => ({
  kind: 'result',
  id,
  at: 3,
  toolUseId,
  text: 'ok',
  ...extra,
});

function agent(p: Partial<AgentInfo> = {}): AgentInfo {
  return {
    id: 'a1',
    kind: 'main',
    roomId: 'r1',
    name: 'Marina',
    look: 'f',
    role: 'Agente principal',
    sessionId: 's1',
    account: '.claude',
    status: 'working',
    recent: [],
    tasks: [],
    startedAt: 0,
    lastEventAt: 0,
    statusSince: 1_000,
    stats: { toolCalls: 0, tokensIn: 0, tokensOut: 0, subagents: 0 },
    seed: 1,
    ...p,
  };
}

describe('TerminalLog', () => {
  it('junta o resultado à ferramenta do mesmo lote', () => {
    const log = new TerminalLog();
    const b = log.push([user('u1'), tool('t1'), result('r1', 't1')]);
    expect(b.attached).toEqual([]);
    expect(b.added.map((i) => i.type)).toEqual(['entry', 'tool']);
    const t = b.added[1];
    expect(t.type === 'tool' && t.result?.id).toBe('r1');
  });

  it('resultado que chega depois vira uma atualização da ferramenta já na tela', () => {
    const log = new TerminalLog();
    log.push([tool('t1')]);
    const b = log.push([result('r1', 't1', { error: true })]);
    expect(b.added).toEqual([]);
    expect(b.attached).toEqual([{ toolKey: 'tool:t1', result: expect.objectContaining({ id: 'r1', error: true }) }]);
  });

  it('resultado sem a ferramenta (ou repetido para a mesma ferramenta) aparece sozinho', () => {
    const log = new TerminalLog();
    const b = log.push([result('r0', 'sumiu'), tool('t1'), result('r1', 't1'), result('r2', 't1')]);
    expect(b.added.map((i) => `${i.type}:${i.key}`)).toEqual(['orphan:result:r0', 'tool:tool:t1', 'orphan:result:r2']);
  });

  it('deduplica por id (dentro do lote e entre lotes)', () => {
    const log = new TerminalLog();
    expect(log.push([user('u1'), user('u1')]).added).toHaveLength(1);
    expect(log.push([user('u1'), user('u2')]).added.map((i) => i.key)).toEqual(['user:u2']);
    expect(log.size).toBe(2);
  });

  it('o id do resultado pode repetir o da ferramenta sem ser descartado', () => {
    const log = new TerminalLog();
    const b = log.push([tool('x'), result('x', 'x')]);
    const t = b.added[0];
    expect(t.type === 'tool' && t.result?.id).toBe('x');
  });

  it('reset esquece tudo (init substitui a conversa)', () => {
    const log = new TerminalLog();
    log.push([user('u1')]);
    log.reset();
    expect(log.size).toBe(0);
    expect(log.push([user('u1')]).added).toHaveLength(1);
  });

  it('trim descarta os itens mais antigos e libera os ids deles', () => {
    const log = new TerminalLog();
    log.push([user('u1'), tool('t1'), result('r1', 't1'), user('u2'), user('u3')]);
    expect(log.trim(2)).toEqual(['user:u1', 'tool:t1']);
    expect(log.size).toBe(2);
    expect(log.trim(2)).toEqual([]);
    // Um resultado atrasado da ferramenta descartada aparece sozinho.
    expect(log.push([result('r9', 't1')]).added.map((i) => i.type)).toEqual(['orphan']);
  });
});

describe('parseInit / parseAppend', () => {
  it('aceita o init e ignora entradas malformadas', () => {
    const data = JSON.stringify({
      agentId: 'a1',
      truncated: true,
      entries: [user('u1'), { kind: 'user', id: 'sem-texto' }, { kind: 'xyz', id: 'k', text: 'x' }, null, result('r1', 't1'), { kind: 'result', id: 'r2', text: 'x' }],
    });
    const init = parseInit(data);
    expect(init?.agentId).toBe('a1');
    expect(init?.truncated).toBe(true);
    expect(init?.entries.map(entryKey)).toEqual(['user:u1', 'result:r1']);
  });

  it('JSON inválido: init nulo e append vazio', () => {
    expect(parseInit('{')).toBeNull();
    expect(parseInit('[1]')).toBeNull();
    expect(parseAppend('{')).toEqual([]);
    expect(parseAppend(JSON.stringify({ not: 'array' }))).toEqual([]);
  });

  it('append com pensamento sem texto (só assinatura) é válido', () => {
    expect(parseAppend(JSON.stringify([{ kind: 'thinking', id: 'th', at: 1 }]))).toHaveLength(1);
  });
});

describe('previewText', () => {
  it('texto curto não recolhe', () => {
    const p = previewText('a\nb\nc', 6);
    expect(p.collapsed).toBe(false);
    expect(p.head).toBe('a\nb\nc');
  });

  it('não recolhe por só 1 ou 2 linhas a mais', () => {
    expect(previewText(Array.from({ length: 8 }, (_, i) => `l${i}`).join('\n'), 6).collapsed).toBe(false);
  });

  it('texto longo mostra as primeiras linhas e conta as escondidas', () => {
    const text = Array.from({ length: 20 }, (_, i) => `linha ${i + 1}`).join('\n');
    const p = previewText(`${text}\n\n`, 6);
    expect(p.collapsed).toBe(true);
    expect(p.head.split('\n')).toHaveLength(6);
    expect(p.hiddenLines).toBe(14);
    expect(p.total).toBe(20);
    expect(p.text).toBe(text);
  });

  it('linha única comprida demais é cortada por caracteres', () => {
    const p = previewText('x'.repeat(5_000), 6, 100);
    expect(p.collapsed).toBe(true);
    expect(p.head).toHaveLength(101);
    expect(p.head.endsWith('…')).toBe(true);
    expect(p.hiddenLines).toBe(0);
  });

  it('splitPreview: a prévia é um prefixo do texto (o resto fica no DOM, escondido, para a busca)', () => {
    const lines = Array.from({ length: 20 }, (_, i) => `linha ${i + 1}`).join('\n');
    const p = splitPreview(lines, 6);
    expect(p.text.slice(0, p.headEnd)).toBe(previewText(lines, 6).head);
    expect(p.text.slice(p.headEnd).startsWith('\nlinha 7')).toBe(true);
    expect(p.ellipsis).toBe(false);
    const long = splitPreview(`${'x'.repeat(98)}   ${'y'.repeat(50)}`, 6, 100);
    expect(long).toMatchObject({ headEnd: 98, ellipsis: true, collapsed: true, hiddenLines: 0 });
    expect(splitPreview('curto', 6)).toMatchObject({ headEnd: 5, collapsed: false });
  });

  it('rótulo do botão', () => {
    expect(moreLabel(1)).toBe('… +1 linha');
    expect(moreLabel(14)).toBe('… +14 linhas');
    expect(moreLabel(0)).toBe('… mostrar tudo');
  });
});

describe('ferramentas', () => {
  it('splitToolTitle separa o nome dos argumentos', () => {
    expect(splitToolTitle('Bash(npm test)')).toEqual({ name: 'Bash', args: '(npm test)' });
    expect(splitToolTitle('Read(server/index.ts)')).toEqual({ name: 'Read', args: '(server/index.ts)' });
    expect(splitToolTitle('Pesquisa na web')).toEqual({ name: 'Pesquisa na web', args: '' });
    expect(splitToolTitle('Tarefa (x)')).toEqual({ name: 'Tarefa (x)', args: '' });
  });

  it('showToolInput não repete o comando que já está no título', () => {
    expect(showToolInput({ title: 'Bash(npm test)', input: 'npm test', inputKind: 'command' })).toBe(false);
    expect(showToolInput({ title: 'Bash(npm run build && …)', input: 'npm run build && npm test', inputKind: 'command' })).toBe(true);
    expect(showToolInput({ title: 'Bash(x)', input: 'x\ny', inputKind: 'command' })).toBe(true);
    expect(showToolInput({ title: 'Edit(a.ts)', input: '- a\n+ b', inputKind: 'diff' })).toBe(true);
    expect(showToolInput({ title: 'Edit(a.ts)', input: '   ' })).toBe(false);
    expect(showToolInput({ title: 'Edit(a.ts)' })).toBe(false);
  });

  it('diffLineKind', () => {
    expect(diffLineKind('+ nova')).toBe('add');
    expect(diffLineKind('- antiga')).toBe('del');
    expect(diffLineKind('@@ -1,2 +1,3 @@')).toBe('hunk');
    expect(diffLineKind('  igual')).toBe('ctx');
  });
});

describe('terminalFooter', () => {
  const now = 100_000;

  it('trabalhando: texto da atividade com reticências (sem duplicar)', () => {
    const a = agent({ activity: { id: 'x', kind: 'edit', icon: '✏️', text: 'Editando App.tsx', at: 0 } });
    expect(terminalFooter(a, [a], now)).toEqual({ kind: 'working', text: 'Editando App.tsx…', since: 1_000 });
    const b = agent({ activity: { id: 'x', kind: 'think', icon: '💭', text: 'Pensando…', at: 0 } });
    expect(terminalFooter(b, [b], now).text).toBe('Pensando…');
    expect(terminalFooter(agent(), [], now).text).toBe('Trabalhando…');
  });

  it('esperando você, ocioso e encerrado', () => {
    const perm = { id: 'p1', tool: 'Bash', title: 'Bash(ls)' } as unknown as NonNullable<AgentInfo['permission']>;
    expect(terminalFooter(agent({ status: 'waiting', waitingFor: 'aprovar uma permissão', permission: perm }), [], now).text).toBe('Esperando você: aprovar uma permissão');
    expect(terminalFooter(agent({ status: 'waiting', waitingFor: 'aprovar uma permissão' }), [], now).text).toBe(
      'Esperando você: aprovar uma permissão · responda no Claude Code: este pedido não chegou ao Habblaud ou passou do tempo de espera',
    );
    expect(terminalFooter(agent({ status: 'waiting', provider: 'codex' }), [], now).text).toMatch(/^Esperando você · responda no Codex:/);
    expect(terminalFooter(agent({ status: 'idle' }), [], now)).toEqual({ kind: 'idle', text: 'Aguardando o próximo prompt' });
    expect(terminalFooter(agent({ status: 'offline' }), [], now).kind).toBe('ended');
    expect(terminalFooter(agent({ kind: 'sub', status: 'done' }), [], now).kind).toBe('ended');
    expect(terminalFooter(undefined, [], now)).toEqual({ kind: 'ended', text: 'Sessão encerrada' });
  });

  it('esperando o shell (segundo plano ou comando longo em primeiro plano)', () => {
    const job: ShellJob = { id: 'j', label: 'Rodar a suíte', startedAt: 40_000, background: true, kind: 'shell' };
    const a = agent({ status: 'shell', shells: [job, { ...job, id: 'k', startedAt: 50_000 }] });
    expect(terminalFooter(a, [a], now)).toEqual({ kind: 'shell', text: 'Esperando o shell: Rodar a suíte (+1)', since: 40_000 });
    const fg = agent({ status: 'working', shells: [{ ...job, background: false, startedAt: now - 60_000 }] });
    expect(terminalFooter(fg, [fg], now).kind).toBe('shell');
  });
});

describe('utilitários', () => {
  it('terminalUrl codifica o id', () => {
    expect(terminalUrl('.claude:123')).toBe('/api/agents/.claude%3A123/terminal');
    expect(terminalUrl('s/1:a b')).toBe('/api/agents/s%2F1%3Aa%20b/terminal');
  });

  it('sessões do histórico: URL do stream, chave e nome do projeto', () => {
    const sid = '00000000-0000-4000-8000-000000000001';
    expect(sessionTerminalUrl('.claude-conta2', sid)).toBe(`/api/sessions/.claude-conta2/${sid}/terminal`);
    expect(sessionTerminalUrl('a/b', 'x y')).toBe('/api/sessions/a%2Fb/x%20y/terminal');
    expect(sessionKey('.claude', sid)).toBe(`session:.claude:${sid}`);
    expect(sessionProjectName({ project: '/Users/ana/projetos/loja/', projectDir: '-x' })).toBe('loja');
    expect(sessionProjectName({ project: 'C:\\proj\\api', projectDir: '-x' })).toBe('api');
    expect(sessionProjectName({ projectDir: '-Users-ana-projetos-site' })).toBe('-Users-ana-projetos-site');
  });

  it('rodapé da sessão encerrada: hoje, ontem ou a data', () => {
    const now = new Date(2026, 9, 8, 15, 0, 0).getTime();
    expect(sessionEndedText(new Date(2026, 9, 8, 14, 30).getTime(), now)).toBe('Sessão encerrada às 14:30');
    expect(sessionEndedText(new Date(2026, 9, 7, 23, 5).getTime(), now)).toBe('Sessão encerrada ontem às 23:05');
    expect(sessionEndedText(new Date(2026, 9, 3, 9, 0).getTime(), now)).toMatch(/^Sessão encerrada em 03 de out\.? às 09:00$/);
    expect(sessionEndedText(NaN, now)).toBe('Sessão encerrada');
  });

  it('entryTimeTitle: horário hoje, data em outro dia, vazio sem horário', () => {
    const now = new Date(2026, 9, 8, 15, 0, 0).getTime();
    expect(entryTimeTitle(new Date(2026, 9, 8, 14, 30, 5).getTime(), now)).toMatch(/14:30:05/);
    expect(entryTimeTitle(new Date(2026, 9, 6, 9, 5).getTime(), now)).toMatch(/06.*09:05/);
    expect(entryTimeTitle(NaN, now)).toBe('');
  });
});

describe('rodapé do Codex', () => {
  it('spinner e símbolo neutros (o ✻ é do Claude Code); o resto é igual', () => {
    expect(spinnerFrames('claude')).toContain('✻');
    expect(spinnerFrames('codex')).not.toContain('✻');
    expect(spinnerFrames('codex')).toHaveLength(spinnerFrames('claude').length);
    expect(footerGlyph('working', 'claude')).toBe('✻');
    expect(footerGlyph('working', 'codex')).toBe('•');
    expect(footerGlyph('waiting', 'codex')).toBe('✋');
    expect(footerGlyph('ended', 'claude')).toBe('■');
  });
});
