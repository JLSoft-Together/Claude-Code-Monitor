// Respostas às perguntas do AskUserQuestion pelo escritório (decisão `answer` de POST /api/permissions/:id/decision):
// conferência contra as perguntas do pedido e o resumo para a linha do tempo. Código puro, usado pelo servidor
// (server/permissions/registry.ts), pelo simulador do demo e pela página (cartão de resposta).
import { maskSecrets, truncate } from './activity';
import type { AskQuestion, PermissionAnswer } from './types';
import { tr } from './i18n';

/** Texto livre ("Outro") mais longo aceito numa resposta. */
export const ANSWER_OTHER_MAX = 2_000;
/** Ferramenta das perguntas ao usuário. */
export const ASK_TOOL = 'AskUserQuestion';

const SUMMARY_MAX = 300;

/**
 * Confere as respostas contra as perguntas do pedido e as devolve normalizadas (na ordem das perguntas, opções em
 * ordem crescente, texto livre aparado, sem campos vazios). undefined = não servem: pergunta sem resposta ou
 * respondida duas vezes, pergunta ou opção que o pedido não tem, sem multiSelect algo diferente de exatamente uma
 * opção OU o texto livre, com multiSelect nenhuma escolha.
 */
export function checkAnswers(questions: readonly AskQuestion[], answers: readonly PermissionAnswer[] | undefined): PermissionAnswer[] | undefined {
  if (!questions.length || !Array.isArray(answers) || answers.length !== questions.length) return undefined;
  const byQuestion = new Map<number, PermissionAnswer>();
  for (const a of answers) {
    if (!a || typeof a !== 'object' || byQuestion.has(a.question)) return undefined;
    byQuestion.set(a.question, a);
  }
  const out: PermissionAnswer[] = [];
  for (const q of questions) {
    const a = byQuestion.get(q.index);
    if (!a) return undefined;
    const raw = Array.isArray(a.options) ? a.options : [];
    const options = [...new Set(raw)].sort((x, y) => x - y);
    if (options.length !== raw.length || options.some((i) => !q.options.some((o) => o.index === i))) return undefined;
    const other = typeof a.other === 'string' ? a.other.trim() : '';
    if (other.length > ANSWER_OTHER_MAX) return undefined;
    const picks = options.length + (other ? 1 : 0);
    if (q.multiSelect ? picks < 1 : picks !== 1) return undefined;
    out.push({ question: q.index, ...(options.length ? { options } : {}), ...(other ? { other } : {}) });
  }
  return out;
}

/**
 * Resumo curto das escolhas para a linha do tempo, com os textos já mascarados das perguntas (o texto livre é
 * mascarado aqui): "Banco: Redis · Testes: Unidade, E2E".
 */
export function answerSummary(questions: readonly AskQuestion[], answers: readonly PermissionAnswer[]): string {
  const parts = answers.flatMap((a) => {
    const q = questions.find((x) => x.index === a.question);
    if (!q) return [];
    const labels = (a.options ?? []).map((i) => q.options.find((o) => o.index === i)?.label ?? tr('opção {0}', [i + 1]));
    if (a.other) labels.push(`“${truncate(maskSecrets(a.other.slice(0, ANSWER_OTHER_MAX)), 80)}”`);
    return [`${q.header ?? truncate(q.question, 40)}: ${labels.join(', ')}`];
  });
  return truncate(parts.join(' · '), SUMMARY_MAX);
}
