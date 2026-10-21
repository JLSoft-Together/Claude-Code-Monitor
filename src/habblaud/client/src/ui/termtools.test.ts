import { describe, expect, it } from 'vitest';
import type { TerminalEntry } from '../../../shared/types';
import { TerminalLog, type TerminalItem } from './terminal';
import {
  copyTextOf,
  finalAnswerKeys,
  findMatches,
  foldQuery,
  foldText,
  globalIndex,
  itemVisible,
  refAt,
  searchCounter,
  stepMatch,
  type TerminalFilter,
} from './termtools';

const user = (id: string, text = 'oi'): TerminalEntry => ({ kind: 'user', id, at: 1, text });
const say = (id: string, text = 'feito'): TerminalEntry => ({ kind: 'assistant', id, at: 2, text });
const tool = (id: string, extra: Partial<Extract<TerminalEntry, { kind: 'tool' }>> = {}): TerminalEntry => ({ kind: 'tool', id, at: 3, tool: 'Bash', title: 'Bash(npm test)', ...extra });
const result = (id: string, toolUseId: string, text = 'ok'): TerminalEntry => ({ kind: 'result', id, at: 4, toolUseId, text });
const think = (id: string): TerminalEntry => ({ kind: 'thinking', id, at: 5, text: 'hmm' });
const sys = (id: string): TerminalEntry => ({ kind: 'system', id, at: 6, text: 'Contexto compactado', detail: 'resumo' });

/** Itens na ordem da tela, como o painel os vê (ferramentas já com o resultado). */
function items(...entries: TerminalEntry[]): TerminalItem[] {
  const log = new TerminalLog();
  log.push(entries);
  return [...log.values()];
}

/** O texto que um trecho [a, b) do original marca. */
const cut = (text: string, query: string) => findMatches(text, foldQuery(query)).map(([a, b]) => text.slice(a, b));

describe('busca: casamentos', () => {
  it('sem diferenciar maiúsculas nem acentos, nos dois sentidos', () => {
    expect(cut('Ação e ACAO e acao', 'ação')).toEqual(['Ação', 'ACAO', 'acao']);
    expect(cut('Configuração do São João', 'sao joao')).toEqual(['São João']);
    expect(cut('npm test && NPM TEST', 'npm test')).toEqual(['npm test', 'NPM TEST']);
  });

  it('posições no original mesmo com acentos e emojis antes do trecho', () => {
    const text = '🙂 é preciso rodar os TESTES';
    const [[a, b]] = findMatches(text, foldQuery('testes'));
    expect(text.slice(a, b)).toBe('TESTES');
    // Acento decomposto (e + U+0301) também casa e é destacado inteiro.
    expect(cut('café pronto', 'café')).toEqual(['café']);
  });

  it('sem sobreposição, termo vazio ou só espaços não busca', () => {
    expect(cut('aaaa', 'aa')).toEqual(['aa', 'aa']);
    expect(findMatches('qualquer coisa', foldQuery('   '))).toEqual([]);
    expect(findMatches('', foldQuery('x'))).toEqual([]);
    expect(foldQuery('  Olá ')).toBe('  ola ');
  });

  it('foldText: ASCII sem mapa; com acentos, mapa de posições', () => {
    expect(foldText('ABC')).toEqual({ text: 'abc' });
    const f = foldText('Ãb');
    expect(f.text).toBe('ab');
    expect(f.starts).toEqual([0, 1]);
    expect(f.ends).toEqual([1, 2]);
  });
});

describe('busca: navegação', () => {
  const counts: [string, number][] = [
    ['user:u1', 2],
    ['assistant:a1', 0],
    ['tool:t1', 3],
  ];

  it('stepMatch dá a volta e começa do primeiro (ou do último, para trás)', () => {
    expect(stepMatch(-1, 5, 1)).toBe(0);
    expect(stepMatch(-1, 5, -1)).toBe(4);
    expect(stepMatch(4, 5, 1)).toBe(0);
    expect(stepMatch(0, 5, -1)).toBe(4);
    expect(stepMatch(2, 5, 1)).toBe(3);
    expect(stepMatch(7, 5, 1)).toBe(0);
    expect(stepMatch(0, 0, 1)).toBe(-1);
  });

  it('globalIndex e refAt convertem entre "3/17" e (linha, destaque)', () => {
    expect(globalIndex(counts, { key: 'user:u1', index: 1 })).toBe(1);
    expect(globalIndex(counts, { key: 'tool:t1', index: 0 })).toBe(2);
    expect(globalIndex(counts, { key: 'tool:t1', index: 5 })).toBe(-1);
    expect(globalIndex(counts, { key: 'sumiu', index: 0 })).toBe(-1);
    expect(globalIndex(counts, null)).toBe(-1);
    expect(refAt(counts, 0)).toEqual({ key: 'user:u1', index: 0 });
    expect(refAt(counts, 4)).toEqual({ key: 'tool:t1', index: 2 });
    expect(refAt(counts, 5)).toBeNull();
    expect(refAt(counts, -1)).toBeNull();
    // Ida e volta: o próximo do último volta ao primeiro.
    const total = 5;
    expect(refAt(counts, stepMatch(globalIndex(counts, { key: 'tool:t1', index: 2 }), total, 1))).toEqual({ key: 'user:u1', index: 0 });
  });

  it('contador "3/17" (sem atual: "0/17")', () => {
    expect(searchCounter(2, 17)).toBe('3/17');
    expect(searchCounter(-1, 17)).toBe('0/17');
    expect(searchCounter(0, 0)).toBe('0/0');
  });
});

describe('filtro', () => {
  it('respostas finais: o texto sem ferramenta depois dele até o próximo prompt (ou o fim)', () => {
    const list = items(user('u1'), say('a1', 'Vou ler.'), tool('t1'), result('r1', 't1'), say('a2', 'Pronto.'), sys('s1'), user('u2'), say('a3', 'Olhando…'), tool('t2'), say('a4', 'Fim.'));
    expect([...finalAnswerKeys(list)]).toEqual(['assistant:a2', 'assistant:a4']);
    // Ainda trabalhando: o último texto pode deixar de ser final quando chega uma ferramenta.
    expect([...finalAnswerKeys(items(user('u1'), say('a1')))]).toEqual(['assistant:a1']);
    expect([...finalAnswerKeys(items(user('u1'), say('a1'), tool('t1')))]).toEqual([]);
  });

  it('Tudo / Só prompts / Sem ferramentas', () => {
    const list = items(user('u1'), think('th1'), say('a1', 'Vou rodar.'), tool('t1'), result('r1', 't1'), result('r9', 'outra'), say('a2', 'Passou.'), sys('s1'));
    const finals = finalAnswerKeys(list);
    const visible = (f: TerminalFilter) => list.filter((i) => itemVisible(i, f, finals)).map((i) => i.key);
    expect(visible('all')).toEqual(list.map((i) => i.key));
    expect(visible('prompts')).toEqual(['user:u1', 'assistant:a2']);
    expect(visible('noTools')).toEqual(['user:u1', 'thinking:th1', 'assistant:a1', 'assistant:a2', 'system:s1']);
  });
});

describe('copiar', () => {
  it('prompt, resposta, comando (ou o título, sem argumentos), resultado e eventos', () => {
    expect(copyTextOf(user('u1', 'Arruma o carrinho\n\n'))).toBe('Arruma o carrinho');
    expect(copyTextOf(say('a1', '**Pronto**: feito.'))).toBe('**Pronto**: feito.');
    expect(copyTextOf(tool('t1', { input: 'npm run build && npm test\n', inputKind: 'command' }))).toBe('npm run build && npm test');
    expect(copyTextOf(tool('t2', { title: 'Read(server/index.ts)', input: '  ' }))).toBe('Read(server/index.ts)');
    expect(copyTextOf(result('r1', 't1', 'linha 1\nlinha 2\n'))).toBe('linha 1\nlinha 2');
    expect(copyTextOf(sys('s1'))).toBe('Contexto compactado\nresumo');
    expect(copyTextOf({ kind: 'thinking', id: 'x', at: 0 })).toBe('');
  });
});
