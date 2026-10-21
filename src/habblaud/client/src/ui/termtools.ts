// Ferramentas do terminal: busca na conversa (casamentos sem diferenciar maiúsculas nem acentos,
// navegação com contador "3/17"), filtro "Tudo / Só prompts / Sem ferramentas" e o texto copiado de cada entrada.
// As funções do modelo são puras e testadas em ui/termtools.test.ts. O destaque dos resultados troca nós de texto
// por spans criados com createElement/textContent: nenhum texto do transcript passa por innerHTML.
import type { TerminalEntry } from '../../../shared/types';
import type { TerminalItem } from './terminal';
import { tr } from '../../../shared/i18n';

// ---------------------------------------------------------------- filtro

export type TerminalFilter = 'all' | 'prompts' | 'noTools';

export const TERMINAL_FILTERS: readonly [TerminalFilter, string, string][] = [
  ['all', tr('Tudo'), tr('Toda a conversa')],
  ['prompts', tr('Só prompts'), tr('Só os seus prompts e as respostas finais do agente')],
  ['noTools', tr('Sem ferramentas'), tr('Esconde as ferramentas e os resultados')],
];

/**
 * Respostas finais de cada turno: os textos do agente sem nenhuma ferramenta depois deles até o próximo prompt
 * (ou o fim da conversa). Os textos intermediários ("Vou ler o arquivo.") ficam de fora.
 */
export function finalAnswerKeys(items: Iterable<TerminalItem>): Set<string> {
  const finals = new Set<string>();
  let pending: string[] = [];
  for (const item of items) {
    if (item.type !== 'entry') {
      // Ferramenta (ou resultado avulso) depois do texto: ele era só um passo intermediário.
      pending = [];
      continue;
    }
    const kind = item.entry.kind;
    if (kind === 'assistant') pending.push(item.key);
    else if (kind === 'user') {
      for (const k of pending) finals.add(k);
      pending = [];
    }
  }
  for (const k of pending) finals.add(k);
  return finals;
}

/** O item aparece com o filtro? (`finals` = finalAnswerKeys, usado só por "Só prompts".) */
export function itemVisible(item: TerminalItem, filter: TerminalFilter, finals: ReadonlySet<string>): boolean {
  if (filter === 'all') return true;
  if (item.type !== 'entry') return false;
  if (filter === 'noTools') return true;
  return item.entry.kind === 'user' || (item.entry.kind === 'assistant' && finals.has(item.key));
}

// ---------------------------------------------------------------- busca

/** Texto "dobrado" para a busca (minúsculas, sem acentos) e, para cada caractere dele, de onde veio no original. */
export interface FoldedText {
  text: string;
  /** Início e fim (no original) do caractere que gerou cada posição de `text`; ausentes = identidade (ASCII). */
  starts?: number[];
  ends?: number[];
}

const ASCII = /^[\x00-\x7f]*$/;
const COMBINING = /[̀-ͯ]/g;

/** Minúsculas e sem acentos ("Ação" -> "acao"), guardando as posições originais para o destaque. */
export function foldText(s: string): FoldedText {
  if (ASCII.test(s)) return { text: s.toLowerCase() };
  let text = '';
  const starts: number[] = [];
  const ends: number[] = [];
  let i = 0;
  for (const ch of s) {
    const f = ch.normalize('NFD').replace(COMBINING, '').toLowerCase();
    // Acento solto (e + U+0301): some do texto dobrado, mas o destaque da letra anterior o inclui.
    if (!f && ends.length) ends[ends.length - 1] = i + ch.length;
    for (let k = 0; k < f.length; k++) {
      starts.push(i);
      ends.push(i + ch.length);
    }
    text += f;
    i += ch.length;
  }
  return { text, starts, ends };
}

/** Só o texto dobrado, sem o mapa de posições (para descartar rápido o que não tem o termo). */
function foldPlain(s: string): string {
  return ASCII.test(s) ? s.toLowerCase() : s.normalize('NFD').replace(COMBINING, '').toLowerCase();
}

/** Termo da busca já dobrado; só espaços = sem busca (''). */
export function foldQuery(query: string): string {
  return query.trim() ? foldText(query).text : '';
}

/** Trechos [início, fim) do original que casam com o termo (já dobrado por foldQuery), sem sobreposição. */
export function findMatches(text: string, folded: string): [number, number][] {
  if (!folded || !text) return [];
  const f = foldText(text);
  const out: [number, number][] = [];
  for (let i = f.text.indexOf(folded); i !== -1; i = f.text.indexOf(folded, i + folded.length)) {
    const end = i + folded.length;
    out.push(f.starts ? [f.starts[i], f.ends![end - 1]] : [i, end]);
  }
  return out;
}

/** Próximo (dir = 1) ou anterior (-1) resultado, dando a volta; sem resultado atual (-1), começa do primeiro ou do último. */
export function stepMatch(current: number, total: number, dir: 1 | -1): number {
  if (total <= 0) return -1;
  if (current < 0 || current >= total) return dir === 1 ? 0 : total - 1;
  return (current + dir + total) % total;
}

/** Posição do resultado atual numa lista de [chave da linha, nº de resultados] (na ordem da tela); -1 se não estiver lá. */
export function globalIndex(counts: readonly (readonly [string, number])[], ref: { key: string; index: number } | null): number {
  if (!ref) return -1;
  let base = 0;
  for (const [key, n] of counts) {
    if (key === ref.key) return ref.index < n ? base + ref.index : -1;
    base += n;
  }
  return -1;
}

/** O resultado de número `index` (0 = primeiro) na mesma lista. */
export function refAt(counts: readonly (readonly [string, number])[], index: number): { key: string; index: number } | null {
  if (index < 0) return null;
  let rest = index;
  for (const [key, n] of counts) {
    if (rest < n) return { key, index: rest };
    rest -= n;
  }
  return null;
}

/** Contador da busca: "3/17"; sem resultado atual, "0/17". */
export function searchCounter(index: number, total: number): string {
  return `${index >= 0 && index < total ? index + 1 : 0}/${total}`;
}

// ---------------------------------------------------------------- cópia

/** O que o botão de copiar de uma entrada põe na área de transferência (o comando, no caso de uma ferramenta). */
export function copyTextOf(e: TerminalEntry): string {
  switch (e.kind) {
    case 'tool':
      return e.input?.trim() ? e.input.replace(/\s+$/, '') : e.title;
    case 'thinking':
      return e.text ?? '';
    case 'system':
      return e.detail?.trim() ? `${e.text}\n${e.detail.replace(/\s+$/, '')}` : e.text;
    default:
      return e.text.replace(/\s+$/, '');
  }
}

// ---------------------------------------------------------------- destaque (DOM)

export const HIT_CLASS = 'ui-term__hit';

/** Elementos que não fazem parte da conversa: botões, marcas decorativas e rótulos (ex.: "Pensando…", "$", "⎿"). */
function isChrome(el: Element): boolean {
  return el.tagName === 'BUTTON' || el.getAttribute('aria-hidden') === 'true' || el.hasAttribute('data-chrome') || el.classList.contains('ui-md__lang');
}

/** Desfaz os destaques (`hits`) de uma linha, juntando de novo os nós de texto. */
export function clearHits(hits: readonly HTMLElement[]): void {
  const parents = new Set<Node>();
  for (const span of hits) {
    const parent = span.parentNode;
    if (!parent) continue;
    parent.replaceChild(document.createTextNode(span.textContent ?? ''), span);
    parents.add(parent);
  }
  for (const p of parents) p.normalize();
}

/**
 * Destaca em `root` os trechos que casam com o termo (já dobrado) e devolve os spans na ordem do documento. Só olha
 * nós de texto da conversa (inclusive os de blocos recolhidos, que ficam no DOM escondidos); um trecho que atravessa
 * dois elementos (ex.: **neg**rito) não casa.
 */
export function highlightHits(root: HTMLElement, folded: string): HTMLElement[] {
  if (!folded || !foldPlain(root.textContent ?? '').includes(folded)) return [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.nodeType === Node.TEXT_NODE ? NodeFilter.FILTER_ACCEPT : isChrome(n as Element) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_SKIP),
  });
  const nodes: Text[] = [];
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);
  const out: HTMLElement[] = [];
  for (const node of nodes) {
    const text = node.data;
    const ranges = findMatches(text, folded);
    if (!ranges.length) continue;
    const frag = document.createDocumentFragment();
    let last = 0;
    for (const [a, b] of ranges) {
      if (a > last) frag.append(text.slice(last, a));
      const span = document.createElement('span');
      span.className = HIT_CLASS;
      span.textContent = text.slice(a, b);
      frag.append(span);
      out.push(span);
      last = b;
    }
    if (last < text.length) frag.append(text.slice(last));
    node.replaceWith(frag);
  }
  return out;
}
