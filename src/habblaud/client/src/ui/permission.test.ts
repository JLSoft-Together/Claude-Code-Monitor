import { describe, expect, it } from 'vitest';
import type { AgentInfo, AskQuestion, PermissionRequestInfo } from '../../../shared/types';
import {
  answerFor,
  buildAnswers,
  CODEX_PERMISSION_NOTE,
  destinationLabel,
  expiryText,
  isLocalHostname,
  isQuestionRequest,
  nextPermissionAgent,
  permissionAgents,
  permissionOptions,
  type AskChoice,
} from './permission';

function agent(id: string, permission?: Partial<PermissionRequestInfo>, status: AgentInfo['status'] = 'waiting'): AgentInfo {
  const a: AgentInfo = {
    id,
    kind: 'main',
    roomId: 'r',
    name: id,
    look: 'f',
    role: 'Agente principal',
    sessionId: `s-${id}`,
    account: 'acc',
    status,
    recent: [],
    tasks: [],
    startedAt: 0,
    lastEventAt: 0,
    statusSince: 0,
    stats: { toolCalls: 0, tokensIn: 0, tokensOut: 0, subagents: 0 },
    seed: 1,
  };
  if (permission) a.permission = { id: `p-${id}`, tool: 'Bash', title: 'Bash(ls)', text: 'Listando', icon: '💻', createdAt: 0, expiresAt: 1, ...permission };
  return a;
}

describe('responder pelo escritório (peças puras)', () => {
  it('expiryText: quanto falta para o pedido voltar ao terminal', () => {
    expect(expiryText(10 * 60_000, 0)).toBe('volta ao terminal em 10 min');
    expect(expiryText(30_000, 0)).toBe('volta ao terminal em menos de 1 min');
    expect(expiryText(0, 5)).toBe('voltando ao terminal…');
  });

  it('expiryText com segundos (prazo curto do Codex)', () => {
    expect(expiryText(25_000, 0, true)).toBe('volta ao terminal em 25 s');
    expect(expiryText(25_000, 24_200, true)).toBe('volta ao terminal em 1 s');
    expect(expiryText(25_000, 25_000, true)).toBe('voltando ao terminal…');
    expect(expiryText(5 * 60_000, 0, true)).toBe('volta ao terminal em 5 min');
  });

  it('cartão do Codex: sem "sempre permitir" nem "interromper", recusa com motivo e o aviso do terminal', () => {
    const suggestions = [{ index: 0, rules: ['Bash(npm test:*)'], destination: 'localSettings' }];
    expect(permissionOptions({ provider: 'codex', suggestions }, { kind: 'main' })).toEqual({
      always: false,
      interrupt: false,
      reasonRequired: true,
      seconds: true,
      note: CODEX_PERMISSION_NOTE,
    });
    expect(CODEX_PERMISSION_NOTE).toBe('No Codex, a aprovação só aparece no terminal depois que você responder aqui ou o prazo acabar.');
    // Claude Code: como antes.
    expect(permissionOptions({ suggestions }, { kind: 'main' })).toEqual({ always: true, interrupt: true, reasonRequired: false, seconds: false, note: '' });
    expect(permissionOptions({}, { kind: 'main' }).always).toBe(false);
    expect(permissionOptions({}, { kind: 'sub', background: true }).note).toMatch(/^Este subagente roda em segundo plano/);
  });

  it('destinationLabel', () => {
    expect(destinationLabel('localSettings')).toBe('neste projeto, só para você');
    expect(destinationLabel('userSettings')).toBe('em todos os projetos');
    expect(destinationLabel('session')).toBe('só nesta sessão');
    expect(destinationLabel('outro')).toBe('outro');
  });

  it('fila de pedidos: do mais antigo para o mais recente, passando por todos e voltando ao primeiro', () => {
    const list = [agent('b', { createdAt: 20 }), agent('x'), agent('a', { createdAt: 10 }), agent('gone', { createdAt: 5 }, 'offline')];
    delete list[1].permission;
    expect(permissionAgents(list).map((a) => a.id)).toEqual(['a', 'b']);
    expect(nextPermissionAgent(list)?.id).toBe('a');
    expect(nextPermissionAgent(list, 'a')?.id).toBe('b');
    expect(nextPermissionAgent(list, 'b')?.id).toBe('a');
    expect(nextPermissionAgent(list, 'x')?.id).toBe('a');
    expect(nextPermissionAgent([agent('y')])).toBeUndefined();
  });

  it('isLocalHostname: a mesma regra do servidor para aceitar respostas', () => {
    for (const h of ['localhost', 'habblaud.localhost', '127.0.0.1', '127.1.2.3', '[::1]', '::1', 'LOCALHOST']) expect(isLocalHostname(h), h).toBe(true);
    for (const h of ['192.168.0.10', 'meu-mac.local', 'habblaud.lan', '128.0.0.1', '127.0.0.1.nip.io']) expect(isLocalHostname(h), h).toBe(false);
  });
});

describe('cartão de pergunta (AskUserQuestion)', () => {
  // Posições do original: a opção 1 da primeira pergunta e a pergunta 1 foram puladas.
  const single: AskQuestion = { index: 0, header: 'Banco', question: 'Qual banco usar?', options: [{ index: 0, label: 'Postgres' }, { index: 2, label: 'SQLite' }] };
  const multi: AskQuestion = { index: 2, question: 'Quais testes rodar?', multiSelect: true, options: [{ index: 0, label: 'Unidade' }, { index: 1, label: 'E2E' }] };
  const choice = (options: number[], otherOn = false, otherText = ''): AskChoice => ({ options, otherOn, otherText });

  it('isQuestionRequest: só AskUserQuestion com perguntas', () => {
    expect(isQuestionRequest({ tool: 'AskUserQuestion', questions: [single] })).toBe(true);
    expect(isQuestionRequest({ tool: 'AskUserQuestion', questions: [] })).toBe(false);
    expect(isQuestionRequest({ tool: 'Bash' })).toBe(false);
    expect(isQuestionRequest(undefined)).toBe(false);
    // O Codex não pergunta pelo escritório: nunca vira cartão de pergunta.
    expect(isQuestionRequest({ tool: 'AskUserQuestion', questions: [single], provider: 'codex' })).toBe(false);
  });

  it('answerFor: escolha única = a opção OU o "Outro"; várias = tudo junto; "Outro" sem texto = sem resposta', () => {
    expect(answerFor(single, choice([2]))).toEqual({ question: 0, options: [2] });
    expect(answerFor(single, choice([2], true, '  MySQL '))).toEqual({ question: 0, other: 'MySQL' });
    expect(answerFor(single, choice([], true, '   '))).toBeUndefined();
    expect(answerFor(single, choice([]))).toBeUndefined();
    expect(answerFor(single, undefined)).toBeUndefined();
    expect(answerFor(multi, choice([1, 0], true, 'lint'))).toEqual({ question: 2, options: [1, 0], other: 'lint' });
    expect(answerFor(multi, choice([0], false, 'ignorado'))).toEqual({ question: 2, options: [0] });
    expect(answerFor(multi, choice([0], true, ''))).toBeUndefined();
    // Posição que a pergunta não mostra: fica de fora.
    expect(answerFor(multi, choice([7]))).toBeUndefined();
    expect(answerFor(single, choice([], true, 'x'.repeat(2_500)))!.other).toHaveLength(2_000);
  });

  it('buildAnswers: o corpo só sai com todas as perguntas respondidas (normalizado como o servidor confere)', () => {
    const qs = [single, multi];
    expect(buildAnswers(qs, new Map([[0, choice([0])]]))).toBeUndefined();
    expect(buildAnswers(qs, new Map([[0, choice([0])], [2, choice([])]]))).toBeUndefined();
    const ready = new Map([
      [2, choice([1, 0], true, ' lint ')],
      [0, choice([2])],
    ]);
    expect(buildAnswers(qs, ready)).toEqual([
      { question: 0, options: [2] },
      { question: 2, options: [0, 1], other: 'lint' },
    ]);
  });
});
