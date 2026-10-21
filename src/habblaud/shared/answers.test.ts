// Respostas do AskUserQuestion pelo escritório: conferência contra as perguntas (por posição) e o resumo.
import { describe, expect, it } from 'vitest';
import { answerSummary, checkAnswers } from './answers';
import type { AskQuestion } from './types';

// Posições do original: a pergunta 1 era inválida (pulada) e a opção 1 da primeira também.
const QS: AskQuestion[] = [
  { index: 0, header: 'Banco', question: 'Qual banco usar?', options: [{ index: 0, label: 'Postgres' }, { index: 2, label: 'SQLite' }] },
  { index: 2, question: 'Quais testes rodar antes do commit?', multiSelect: true, options: [{ index: 0, label: 'Unidade' }, { index: 1, label: 'E2E' }] },
];

describe('checkAnswers', () => {
  it('normaliza: ordem das perguntas, opções em ordem crescente, texto aparado, sem campos vazios', () => {
    expect(checkAnswers(QS, [{ question: 2, options: [1, 0], other: '  lint  ' }, { question: 0, options: [2], other: '   ' }])).toEqual([
      { question: 0, options: [2] },
      { question: 2, options: [0, 1], other: 'lint' },
    ]);
    // Sem multiSelect, o texto livre vale no lugar de uma opção; com multiSelect, sozinho também.
    expect(checkAnswers(QS, [{ question: 0, other: 'MySQL' }, { question: 2, other: 'nenhum' }])).toEqual([
      { question: 0, other: 'MySQL' },
      { question: 2, other: 'nenhum' },
    ]);
  });

  it('cada pergunta exatamente uma vez', () => {
    expect(checkAnswers(QS, [{ question: 0, options: [0] }])).toBeUndefined();
    expect(checkAnswers(QS, [{ question: 0, options: [0] }, { question: 0, options: [2] }])).toBeUndefined();
    expect(checkAnswers(QS, [{ question: 0, options: [0] }, { question: 1, options: [0] }])).toBeUndefined();
    expect(checkAnswers(QS, [{ question: 0, options: [0] }, { question: 2, options: [0] }, { question: 2, options: [1] }])).toBeUndefined();
    expect(checkAnswers(QS, undefined)).toBeUndefined();
    expect(checkAnswers([], [])).toBeUndefined();
  });

  it('escolha única: exatamente uma opção OU o texto livre', () => {
    const multi = { question: 2, options: [0] };
    expect(checkAnswers(QS, [{ question: 0, options: [0, 2] }, multi])).toBeUndefined();
    expect(checkAnswers(QS, [{ question: 0, options: [0], other: 'e mais' }, multi])).toBeUndefined();
    expect(checkAnswers(QS, [{ question: 0 }, multi])).toBeUndefined();
    expect(checkAnswers(QS, [{ question: 0, options: [] }, multi])).toBeUndefined();
  });

  it('várias: ao menos uma escolha; opções que a pergunta não mostra ou repetidas não valem', () => {
    const single = { question: 0, options: [0] };
    expect(checkAnswers(QS, [single, { question: 2 }])).toBeUndefined();
    expect(checkAnswers(QS, [{ question: 0, options: [1] }, { question: 2, options: [0] }])).toBeUndefined();
    expect(checkAnswers(QS, [single, { question: 2, options: [0, 0] }])).toBeUndefined();
    expect(checkAnswers(QS, [single, { question: 2, options: [5] }])).toBeUndefined();
    expect(checkAnswers(QS, [single, { question: 2, other: 'x'.repeat(2_001) }])).toBeUndefined();
  });
});

describe('answerSummary', () => {
  it('cabeçalho (ou a pergunta) e os rótulos escolhidos; texto livre entre aspas e mascarado', () => {
    expect(answerSummary(QS, [{ question: 0, options: [2] }, { question: 2, options: [0, 1], other: 'pode rodar' }])).toBe(
      'Banco: SQLite · Quais testes rodar antes do commit?: Unidade, E2E, “pode rodar”',
    );
    const secret = answerSummary(QS, [{ question: 0, other: 'token ghp_abcdefghijklmnopqrstuvwxyz0123456789' }]);
    expect(secret).toMatch(/^Banco: “token .+”$/);
    expect(secret).not.toContain('abcdefghijklmnop');
  });
});
