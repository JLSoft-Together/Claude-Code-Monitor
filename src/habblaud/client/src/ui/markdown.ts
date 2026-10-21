// Markdown pequeno e seguro para as respostas do agente no terminal.
// O tokenizador (blocos e trechos inline) é puro e testado em ui/markdown.test.ts; a montagem usa só
// createElement/textContent: nenhum texto do transcript passa por innerHTML.
//
// Cobertura (o que o Claude Code costuma escrever): blocos ``` com linguagem, `código`, **negrito**, *itálico*,
// títulos #, listas com marcador e numeradas (com aninhamento), citação >, linha horizontal, tabelas
// (preservadas como texto pré-formatado) e links (viram texto; o endereço fica na dica).

export type MdInline =
  | { type: 'text'; text: string }
  | { type: 'code'; text: string }
  | { type: 'strong'; children: MdInline[] }
  | { type: 'em'; children: MdInline[] }
  | { type: 'link'; text: string; href: string };

export interface MdListItem {
  /** Nível de aninhamento (0 = primeiro nível). */
  depth: number;
  /** Marcador original: "-", "*", "+" ou "1.", "2)"... */
  marker: string;
  ordered: boolean;
  text: string;
}

export type MdBlock =
  | { type: 'paragraph'; text: string }
  | { type: 'heading'; level: number; text: string }
  | { type: 'code'; lang: string; text: string }
  | { type: 'list'; ordered: boolean; items: MdListItem[] }
  | { type: 'quote'; text: string }
  | { type: 'table'; text: string }
  | { type: 'rule' };

const MAX_DEPTH = 5;

const FENCE_RE = /^ {0,3}(`{3,}|~{3,})\s*([^\s`]*)/;
const HEADING_RE = /^ {0,3}(#{1,6})(?:\s+(.*?))?\s*$/;
const RULE_RE = /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/;
const QUOTE_RE = /^ {0,3}>\s?(.*)$/;
const LIST_RE = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;
/** Linha separadora de tabela: | --- | :---: | (com ou sem as barras das pontas). */
const TABLE_SEP_RE = /^\s*\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)+\|?\s*$|^\s*\|\s*:?-+:?\s*\|\s*$/;

function isFenceClose(line: string, fence: string): boolean {
  const m = /^ {0,3}(`{3,}|~{3,})\s*$/.exec(line);
  return !!m && m[1][0] === fence[0] && m[1].length >= fence.length;
}

function isTableStart(lines: readonly string[], i: number): boolean {
  const line = lines[i];
  if (!line.includes('|')) return false;
  if (i + 1 < lines.length && TABLE_SEP_RE.test(lines[i + 1])) return true;
  // Sem separador: só conta como tabela se houver ao menos duas linhas seguidas começando com "|".
  return line.trimStart().startsWith('|') && i + 1 < lines.length && lines[i + 1].trimStart().startsWith('|');
}

/** Uma linha que interrompe um parágrafo (começa outro bloco). */
function startsBlock(lines: readonly string[], i: number): boolean {
  const line = lines[i];
  if (FENCE_RE.test(line) || HEADING_RE.test(line) || QUOTE_RE.test(line) || RULE_RE.test(line)) return true;
  const li = LIST_RE.exec(line);
  // Como no CommonMark, uma lista numerada só interrompe um parágrafo se começar em 1.
  if (li && (!/^\d/.test(li[2]) || /^1[.)]$/.test(li[2]))) return true;
  return isTableStart(lines, i);
}

const blank = (line: string) => line.trim() === '';

/** Divide o texto em blocos. Puro. */
export function tokenizeBlocks(src: string): MdBlock[] {
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  const out: MdBlock[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (blank(line)) {
      i++;
      continue;
    }

    const fence = FENCE_RE.exec(line);
    if (fence) {
      const indent = line.length - line.trimStart().length;
      const body: string[] = [];
      i++;
      // Bloco sem fechamento (resposta ainda sendo escrita ou cortada): vai até o fim.
      while (i < lines.length && !isFenceClose(lines[i], fence[1])) {
        body.push(lines[i].replace(new RegExp(`^ {0,${indent}}`), ''));
        i++;
      }
      i++;
      out.push({ type: 'code', lang: fence[2] ?? '', text: body.join('\n') });
      continue;
    }

    const heading = HEADING_RE.exec(line);
    if (heading) {
      out.push({ type: 'heading', level: heading[1].length, text: (heading[2] ?? '').replace(/\s+#+$/, '') });
      i++;
      continue;
    }

    if (RULE_RE.test(line)) {
      out.push({ type: 'rule' });
      i++;
      continue;
    }

    if (isTableStart(lines, i)) {
      const rows: string[] = [];
      while (i < lines.length && !blank(lines[i]) && lines[i].includes('|')) rows.push(lines[i++]);
      out.push({ type: 'table', text: rows.join('\n') });
      continue;
    }

    if (QUOTE_RE.test(line)) {
      const body: string[] = [];
      let m: RegExpExecArray | null;
      while (i < lines.length && (m = QUOTE_RE.exec(lines[i]))) {
        body.push(m[1]);
        i++;
      }
      out.push({ type: 'quote', text: body.join('\n') });
      continue;
    }

    if (LIST_RE.test(line)) {
      const items: MdListItem[] = [];
      const indents: number[] = [];
      const indentOf = (m: RegExpExecArray) => m[1].replace(/\t/g, '    ').length;
      // Trocar de marcador para número (ou o contrário) no primeiro nível começa outra lista.
      const sameList = (m: RegExpExecArray) => !items.length || indentOf(m) > indents[0] || /^\d/.test(m[2]) === items[0].ordered;
      while (i < lines.length) {
        const cur = lines[i];
        const m = LIST_RE.exec(cur);
        if (m && sameList(m)) {
          const indent = indentOf(m);
          while (indents.length && indent < indents[indents.length - 1]) indents.pop();
          if (!indents.length || indent > indents[indents.length - 1]) indents.push(indent);
          const ordered = /^\d/.test(m[2]);
          items.push({ depth: Math.min(MAX_DEPTH, indents.length - 1), marker: m[2], ordered, text: m[3] });
          i++;
          continue;
        }
        if (blank(cur)) {
          // Lista "solta" (itens separados por linha em branco): continua se o próximo item vier logo depois.
          let j = i;
          while (j < lines.length && blank(lines[j])) j++;
          const next = j < lines.length ? LIST_RE.exec(lines[j]) : null;
          if (next && sameList(next)) {
            i = j;
            continue;
          }
          break;
        }
        // Continuação do item anterior (linha recuada que não é outro bloco).
        if (/^\s{2,}\S/.test(cur) && !FENCE_RE.test(cur)) {
          items[items.length - 1].text += `\n${cur.trim()}`;
          i++;
          continue;
        }
        break;
      }
      out.push({ type: 'list', ordered: items[0].ordered, items });
      continue;
    }

    const para: string[] = [line];
    i++;
    while (i < lines.length && !blank(lines[i]) && !startsBlock(lines, i)) para.push(lines[i++]);
    out.push({ type: 'paragraph', text: para.join('\n') });
  }
  return out;
}

const PUNCT = /[!-/:-@[-`{-~]/;
const WORD = /[\p{L}\p{N}]/u;

function pushText(out: MdInline[], text: string): void {
  if (!text) return;
  const last = out[out.length - 1];
  if (last?.type === 'text') last.text += text;
  else out.push({ type: 'text', text });
}

/** Fim de um delimitador simples (* ou _) a partir de `from`, pulando os duplos (**, __). -1 se não houver. */
function findSingleClose(src: string, from: number, ch: string): number {
  let j = from;
  while (j < src.length) {
    if (src[j] === '\\') {
      j += 2;
      continue;
    }
    if (src[j] === '`') {
      // Não fecha dentro de código inline.
      const end = src.indexOf('`', j + 1);
      if (end === -1) return -1;
      j = end + 1;
      continue;
    }
    if (src[j] === ch) {
      if (src[j + 1] === ch) {
        j += 2;
        continue;
      }
      if (!/\s/.test(src[j - 1] ?? ' ') && (ch !== '_' || !WORD.test(src[j + 1] ?? ''))) return j;
    }
    j++;
  }
  return -1;
}

/** Trechos inline de uma linha/parágrafo (código, negrito, itálico, links). Puro. */
export function tokenizeInline(src: string): MdInline[] {
  const out: MdInline[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];

    if (ch === '\\' && i + 1 < src.length && PUNCT.test(src[i + 1])) {
      pushText(out, src[i + 1]);
      i += 2;
      continue;
    }

    if (ch === '`') {
      let run = 1;
      while (src[i + run] === '`') run++;
      const fence = '`'.repeat(run);
      let j = src.indexOf(fence, i + run);
      // A sequência de fechamento precisa ter exatamente o mesmo tamanho.
      while (j !== -1 && src[j + run] === '`') {
        let k = j;
        while (src[k] === '`') k++;
        j = src.indexOf(fence, k);
      }
      if (j === -1) {
        pushText(out, fence);
        i += run;
        continue;
      }
      let code = src.slice(i + run, j).replace(/\n/g, ' ');
      if (code.length > 2 && code.startsWith(' ') && code.endsWith(' ') && code.trim()) code = code.slice(1, -1);
      out.push({ type: 'code', text: code });
      i = j + run;
      continue;
    }

    if (ch === '[') {
      const close = src.indexOf(']', i + 1);
      if (close > i + 1 && src[close + 1] === '(') {
        const end = src.indexOf(')', close + 2);
        const href = end === -1 ? '' : src.slice(close + 2, end).trim();
        if (end !== -1 && href && !/\s/.test(href.split(/\s+"/)[0])) {
          out.push({ type: 'link', text: src.slice(i + 1, close), href: href.split(/\s+"/)[0] });
          i = end + 1;
          continue;
        }
      }
    }

    if ((ch === '*' || ch === '_') && src[i + 1] === ch) {
      const prev = src[i - 1] ?? ' ';
      const opensOk = !/\s/.test(src[i + 2] ?? ' ') && (ch === '*' || !WORD.test(prev));
      const close = opensOk ? src.indexOf(ch + ch, i + 2) : -1;
      if (close > i + 2 && !/\s/.test(src[close - 1]) && (ch === '*' || !WORD.test(src[close + 2] ?? ''))) {
        out.push({ type: 'strong', children: tokenizeInline(src.slice(i + 2, close)) });
        i = close + 2;
        continue;
      }
      pushText(out, ch + ch);
      i += 2;
      continue;
    }

    if (ch === '*' || ch === '_') {
      const prev = src[i - 1] ?? ' ';
      const opensOk = !/\s/.test(src[i + 1] ?? ' ') && (ch === '*' || !WORD.test(prev));
      const close = opensOk ? findSingleClose(src, i + 1, ch) : -1;
      if (close > i + 1) {
        out.push({ type: 'em', children: tokenizeInline(src.slice(i + 1, close)) });
        i = close + 1;
        continue;
      }
    }

    pushText(out, ch);
    i++;
  }
  return out;
}

// ---------------------------------------------------------------- montagem (DOM)

/** Marcadores de lista por nível, como no Claude Code. */
const BULLETS = ['•', '◦', '▪', '▫'];

function appendInline(parent: HTMLElement, nodes: readonly MdInline[]): void {
  for (const n of nodes) {
    switch (n.type) {
      case 'text':
        parent.append(document.createTextNode(n.text));
        break;
      case 'code': {
        const el = document.createElement('code');
        el.className = 'ui-md__code';
        el.textContent = n.text;
        parent.append(el);
        break;
      }
      case 'strong':
      case 'em': {
        const el = document.createElement(n.type);
        appendInline(el, n.children);
        parent.append(el);
        break;
      }
      case 'link': {
        // Link vira texto (nada clicável vindo do transcript); o endereço fica na dica.
        const el = document.createElement('span');
        el.className = 'ui-md__link';
        el.textContent = n.text || n.href;
        el.title = n.href;
        parent.append(el);
        break;
      }
    }
  }
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = cls;
  return node;
}

/** Monta o markdown como nós de DOM (só textContent: seguro para texto vindo do transcript). */
export function renderMarkdown(src: string): DocumentFragment {
  const frag = document.createDocumentFragment();
  for (const b of tokenizeBlocks(src)) {
    switch (b.type) {
      case 'paragraph': {
        const p = el('p', 'ui-md__p');
        appendInline(p, tokenizeInline(b.text));
        frag.append(p);
        break;
      }
      case 'heading': {
        const p = el('p', `ui-md__h ui-md__h${Math.min(b.level, 3)}`);
        appendInline(p, tokenizeInline(b.text));
        frag.append(p);
        break;
      }
      case 'code': {
        const box = el('div', 'ui-md__block');
        if (b.lang) {
          const lang = el('span', 'ui-md__lang');
          lang.textContent = b.lang;
          box.append(lang);
        }
        const pre = el('pre', 'ui-md__pre');
        pre.textContent = b.text;
        box.append(pre);
        frag.append(box);
        break;
      }
      case 'list': {
        const list = el(b.ordered ? 'ol' : 'ul', 'ui-md__list');
        for (const it of b.items) {
          const li = el('li', 'ui-md__li');
          li.style.setProperty('--d', String(it.depth));
          const mark = el('span', 'ui-md__mark');
          mark.textContent = it.ordered ? it.marker : BULLETS[it.depth % BULLETS.length];
          mark.setAttribute('aria-hidden', 'true');
          const body = el('span', 'ui-md__item');
          appendInline(body, tokenizeInline(it.text));
          li.append(mark, body);
          list.append(li);
        }
        frag.append(list);
        break;
      }
      case 'quote': {
        const q = el('blockquote', 'ui-md__quote');
        appendInline(q, tokenizeInline(b.text));
        frag.append(q);
        break;
      }
      case 'table': {
        const pre = el('pre', 'ui-md__table');
        pre.textContent = b.text;
        frag.append(pre);
        break;
      }
      case 'rule':
        frag.append(el('hr', 'ui-md__rule'));
        break;
    }
  }
  return frag;
}
