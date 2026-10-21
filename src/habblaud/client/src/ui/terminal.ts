// Terminal: janela flutuante sobre o escritório com a conversa de uma sessão (prompts, respostas, ferramentas e
// resultados) no formato em que o Claude Code a mostra, ao vivo pelo stream SSE GET /api/agents/:id/terminal (`init`
// substitui tudo; `append` acrescenta). O rodapé tem a caixa de mensagem (ui/composer.ts): com o plugin
// habblaud-mensagens, o que você digita ali entra na sessão do agente principal como se fosse digitado no terminal.
// Também mostra as sessões do histórico (ui/history.ts), pelo mesmo protocolo em
// GET /api/sessions/:conta/:sessionId/terminal: o cabeçalho traz projeto, título e data, e o rodapé, "Sessão encerrada às …".
// Busca (Ctrl/⌘+F ou a lupa), filtro e o botão de copiar de cada entrada vêm de ui/termtools.ts.
// O modelo (deduplicação, junção ferramenta -> resultado, limite de entradas, prévias recolhidas e rodapé) é puro e
// testado em ui/terminal.test.ts; a montagem usa só textContent (o markdown das respostas vem de ui/markdown.ts).
// Sessão do Codex: selo "Codex" no cabeçalho e um spinner neutro no rodapé (o ✻ é do Claude Code).
import type { AgentInfo, Provider, RecentSession, TerminalEntry, TerminalInit } from '../../../shared/types';
import { MessageComposer } from './composer';
import type { UiComponent, UiContext } from './context';
import { copyText, h, iconButton, prefersReducedMotion, setAttr, setHidden, setText, setTitle, setVariant } from './dom';
import { calendarDayDiff, formatClock, formatDateTime, formatDuration, formatElapsed, relativeTime } from './format';
import { ICONS } from './icons';
import { maximizeButton, Movable } from './movable';
import type { PtyControl } from './pty';
import { TermActions } from './termactions';
import { TermTabs } from './termtabs';
import { renderMarkdown } from './markdown';
import { roleLabel, shellWaitIn } from './model';
import { providerOf } from './provider';
import {
  clearHits,
  copyTextOf,
  finalAnswerKeys,
  foldQuery,
  globalIndex,
  highlightHits,
  itemVisible,
  refAt,
  searchCounter,
  stepMatch,
  TERMINAL_FILTERS,
  type TerminalFilter,
} from './termtools';
import { createAccountChip, createProviderTag, updateAccountChip, updateProviderTag } from './widgets';
import { intlLocale, tr } from '../../../shared/i18n';

/** Máximo de itens no DOM: os mais antigos saem primeiro. */
export const TERMINAL_DOM_LIMIT = 1500;
/** Linhas do resultado visíveis antes do "… +N linhas". */
export const RESULT_PREVIEW_LINES = 6;
/** Entrada de ferramenta (comando, diff, JSON) longa: recolhida nas primeiras linhas. */
export const INPUT_PREVIEW_LINES = 10;
/** Prompt do usuário muito longo (texto colado): recolhido. */
export const PROMPT_PREVIEW_LINES = 24;

export const TERMINAL_UNAVAILABLE_HINT = tr('O terminal só fica disponível quando o Habblaud roda com acesso local (bind 127.0.0.1)');
const OPEN_ERROR = tr('Não foi possível abrir o terminal. O recurso só funciona no acesso local, com o agente ainda aberto.');
const SESSION_OPEN_ERROR = tr('Não foi possível abrir a sessão. O histórico só funciona no acesso local, com o transcript ainda no disco.');
/** Espera depois da última tecla antes de buscar (a busca percorre toda a conversa na tela). */
const SEARCH_DEBOUNCE_MS = 120;
/** "Copiado" fica à mostra por este tempo. */
const COPIED_MS = 1_500;
const dayFmt = new Intl.DateTimeFormat(intlLocale(), { day: '2-digit', month: 'short' });

/** Distância do fim (px) que ainda conta como "no fim" para seguir as mensagens novas. */
const STICK_PX = 32;
/** EventSource.CLOSED (constante literal, como no store). */
const ES_CLOSED = 2;
/** Quadros do spinner do Claude Code (vai e volta). */
const SPINNER = ['·', '✢', '✳', '✶', '✻', '✽', '✻', '✶', '✳', '✢'];
/** Codex: um spinner neutro (pontos girando), com o mesmo número de quadros. */
const CODEX_SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const SPINNER_MS = 120;
/** "⏺" com seletor de variação de texto: nunca vira emoji colorido (a cor vem do CSS). */
const DOT = '⏺︎';

// ---------------------------------------------------------------- modelo (puro)

export type ToolEntry = Extract<TerminalEntry, { kind: 'tool' }>;
export type ResultEntry = Extract<TerminalEntry, { kind: 'result' }>;
export type PlainEntry = Exclude<TerminalEntry, ToolEntry | ResultEntry>;

/** O que vira uma linha no terminal: uma entrada simples, uma ferramenta (com o resultado, quando chega) ou um resultado órfão. */
export type TerminalItem =
  | { type: 'entry'; key: string; entry: PlainEntry }
  | { type: 'tool'; key: string; tool: ToolEntry; result?: ResultEntry }
  | { type: 'orphan'; key: string; result: ResultEntry };

export interface TerminalBatch {
  /** Itens novos, na ordem (ferramentas já trazem o resultado que chegou no mesmo lote). */
  added: TerminalItem[];
  /** Resultados de ferramentas que já estavam na tela. */
  attached: { toolKey: string; result: ResultEntry }[];
}

/** Chave estável de uma entrada (o tipo entra na chave: o id de um resultado pode repetir o da ferramenta). */
export function entryKey(e: Pick<TerminalEntry, 'kind' | 'id'>): string {
  return `${e.kind}:${e.id}`;
}

export function toolKey(toolUseId: string): string {
  return `tool:${toolUseId}`;
}

export function terminalUrl(agentId: string): string {
  return `/api/agents/${encodeURIComponent(agentId)}/terminal`;
}

/** Stream da conversa de uma sessão do histórico (mesmo protocolo do terminal do agente). */
export function sessionTerminalUrl(account: string, sessionId: string): string {
  return `/api/sessions/${encodeURIComponent(account)}/${encodeURIComponent(sessionId)}/terminal`;
}

/** Chave de uma sessão do histórico aberta no painel (nunca coincide com o id de um agente). */
export function sessionKey(account: string, sessionId: string): string {
  return `session:${account}:${sessionId}`;
}

/** Nome curto do projeto de uma sessão: a última pasta do cwd (ou o nome codificado da pasta em projects/). */
export function sessionProjectName(s: Pick<RecentSession, 'project' | 'projectDir'>): string {
  const path = s.project?.replace(/[\\/]+$/, '');
  if (path) return path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1) || path;
  return s.projectDir;
}

/** Rodapé de uma sessão encerrada: "Sessão encerrada às 14:30" (hoje), "… ontem às 14:30" ou "… em 06 de out. às 14:30". */
export function sessionEndedText(at: number, now: number): string {
  if (!Number.isFinite(at) || at <= 0) return tr('Sessão encerrada');
  const clock = formatClock(at, false);
  const diff = calendarDayDiff(at, now);
  if (diff === 0) return tr('Sessão encerrada às {0}', [clock]);
  if (diff === -1) return tr('Sessão encerrada ontem às {0}', [clock]);
  return tr('Sessão encerrada em {0} às {1}', [dayFmt.format(at), clock]);
}

/**
 * A conversa em memória: deduplica por id, junta cada resultado à sua ferramenta pelo `toolUseId` e limita o total
 * de itens (os mais antigos saem). Não conhece o DOM: devolve o que mudou para a tela aplicar.
 */
export class TerminalLog {
  /** Itens na ordem de chegada (o Map preserva a ordem de inserção: o primeiro é o mais antigo). */
  private items = new Map<string, TerminalItem>();
  /** Chaves de entradas já vistas (inclui os resultados juntados às ferramentas). */
  private seen = new Set<string>();

  get size(): number {
    return this.items.size;
  }

  /** Itens na ordem da tela (do mais antigo para o mais recente). */
  values(): IterableIterator<TerminalItem> {
    return this.items.values();
  }

  get(key: string): TerminalItem | undefined {
    return this.items.get(key);
  }

  reset(): void {
    this.items.clear();
    this.seen.clear();
  }

  push(entries: readonly TerminalEntry[]): TerminalBatch {
    const added: TerminalItem[] = [];
    const attached: TerminalBatch['attached'] = [];
    const fresh = new Set<string>();
    for (const e of entries) {
      const key = entryKey(e);
      if (this.seen.has(key)) continue;
      this.seen.add(key);
      if (e.kind === 'tool') {
        const item: TerminalItem = { type: 'tool', key, tool: e };
        this.items.set(key, item);
        added.push(item);
        fresh.add(key);
      } else if (e.kind === 'result') {
        const tk = toolKey(e.toolUseId);
        const tool = this.items.get(tk);
        if (tool?.type === 'tool' && !tool.result) {
          tool.result = e;
          // Ferramenta deste mesmo lote: o resultado já sai junto; senão, vira uma atualização da linha existente.
          if (!fresh.has(tk)) attached.push({ toolKey: tk, result: e });
        } else {
          // Ferramenta fora da janela (ou resultado repetido): aparece sozinho.
          const item: TerminalItem = { type: 'orphan', key, result: e };
          this.items.set(key, item);
          added.push(item);
        }
      } else {
        const item: TerminalItem = { type: 'entry', key, entry: e };
        this.items.set(key, item);
        added.push(item);
      }
    }
    return { added, attached };
  }

  /** Descarta os itens mais antigos até sobrar `limit`; devolve as chaves removidas. */
  trim(limit: number): string[] {
    const removed: string[] = [];
    for (const [key, item] of this.items) {
      if (this.items.size <= limit) break;
      this.items.delete(key);
      this.seen.delete(key);
      if (item.type === 'tool' && item.result) this.seen.delete(entryKey(item.result));
      removed.push(key);
    }
    return removed;
  }
}

const KINDS = new Set<TerminalEntry['kind']>(['user', 'assistant', 'thinking', 'tool', 'result', 'system']);

function validEntry(raw: unknown): raw is TerminalEntry {
  if (!raw || typeof raw !== 'object') return false;
  const e = raw as Record<string, unknown>;
  if (typeof e.id !== 'string' || !KINDS.has(e.kind as TerminalEntry['kind'])) return false;
  switch (e.kind) {
    case 'thinking':
      return e.text === undefined || typeof e.text === 'string';
    case 'tool':
      return typeof e.title === 'string';
    case 'result':
      return typeof e.toolUseId === 'string' && typeof e.text === 'string';
    default:
      return typeof e.text === 'string';
  }
}

/** Entradas válidas de um `append` (ou da lista do `init`); o resto é ignorado. */
export function sanitizeEntries(raw: unknown): TerminalEntry[] {
  return Array.isArray(raw) ? raw.filter(validEntry) : [];
}

function parseJson(data: unknown): unknown {
  if (typeof data !== 'string') return undefined;
  try {
    return JSON.parse(data);
  } catch {
    return undefined;
  }
}

/** Dados do evento `init`; null se não forem reconhecíveis. */
export function parseInit(data: unknown): TerminalInit | null {
  const obj = parseJson(data);
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
  const o = obj as Record<string, unknown>;
  return { agentId: typeof o.agentId === 'string' ? o.agentId : '', entries: sanitizeEntries(o.entries), truncated: o.truncated === true };
}

/** Dados do evento `append`. */
export function parseAppend(data: unknown): TerminalEntry[] {
  return sanitizeEntries(parseJson(data));
}

export interface TextPreview {
  /** Texto completo (sem espaços/linhas em branco no fim). */
  text: string;
  /** O que aparece recolhido. */
  head: string;
  /** Há mais do que a prévia mostra. */
  collapsed: boolean;
  /** Linhas escondidas na prévia (0 quando o corte foi no meio de uma linha comprida). */
  hiddenLines: number;
  total: number;
}

/** Onde cortar a prévia: o texto recolhido é `text.slice(0, headEnd)` (mais "…" quando `ellipsis`). */
export interface PreviewSplit {
  text: string;
  headEnd: number;
  /** O corte foi no meio de uma linha comprida (e não numa quebra de linha). */
  ellipsis: boolean;
  collapsed: boolean;
  hiddenLines: number;
  total: number;
}

/**
 * Prévia recolhida de um texto longo: as primeiras `maxLines` linhas (e no máximo `maxChars` caracteres).
 * Só recolhe se sobrarem ao menos 3 linhas (esconder 1 ou 2 linhas atrás de um clique não compensa).
 */
export function splitPreview(raw: string, maxLines: number, maxChars = maxLines * 200): PreviewSplit {
  const text = raw.replace(/\s+$/, '');
  const lines = text === '' ? [] : text.split('\n');
  const total = lines.length;
  if (total <= maxLines + 2 && text.length <= maxChars) return { text, headEnd: text.length, ellipsis: false, collapsed: false, hiddenLines: 0, total };
  let shown = Math.min(total, maxLines);
  let headEnd = lines.slice(0, shown).join('\n').length;
  let ellipsis = false;
  if (headEnd > maxChars) {
    headEnd = text.slice(0, maxChars).replace(/\s+$/, '').length;
    ellipsis = true;
    shown = text.slice(0, headEnd).split('\n').length;
  }
  return { text, headEnd, ellipsis, collapsed: true, hiddenLines: Math.max(0, total - shown), total };
}

/** A mesma prévia como texto (o que aparece recolhido em `head`). */
export function previewText(raw: string, maxLines: number, maxChars = maxLines * 200): TextPreview {
  const p = splitPreview(raw, maxLines, maxChars);
  const head = p.collapsed ? `${p.text.slice(0, p.headEnd)}${p.ellipsis ? '…' : ''}` : p.text;
  return { text: p.text, head, collapsed: p.collapsed, hiddenLines: p.hiddenLines, total: p.total };
}

/** Rótulo do botão que expande: "… +12 linhas" (ou "… mostrar tudo" quando o corte foi numa linha comprida). */
export function moreLabel(hiddenLines: number): string {
  if (hiddenLines <= 0) return tr('… mostrar tudo');
  return `… +${hiddenLines} ${hiddenLines === 1 ? tr('linha') : tr('linhas')}`;
}

/** "Bash(npm test)" -> nome em destaque + argumentos, como o Claude Code mostra. */
export function splitToolTitle(title: string): { name: string; args: string } {
  const i = title.indexOf('(');
  if (i > 0 && title.endsWith(')') && !/\s/.test(title.slice(0, i))) return { name: title.slice(0, i), args: title.slice(i) };
  return { name: title, args: '' };
}

/** Mostra o `input` da ferramenta? Um comando que já cabe inteiro no título não se repete embaixo. */
export function showToolInput(tool: Pick<ToolEntry, 'title' | 'input' | 'inputKind'>): boolean {
  const input = tool.input?.trim();
  if (!input) return false;
  if ((tool.inputKind ?? 'text') === 'command' && !input.includes('\n') && tool.title.includes(input)) return false;
  return true;
}

export type DiffLineKind = 'add' | 'del' | 'hunk' | 'ctx';

export function diffLineKind(line: string): DiffLineKind {
  if (line.startsWith('+')) return 'add';
  if (line.startsWith('-')) return 'del';
  if (line.startsWith('@@')) return 'hunk';
  return 'ctx';
}

/** Horário da entrada para a dica: "14:30:05" hoje, "06 de out., 14:30" em outro dia. */
export function entryTimeTitle(at: number, now: number): string {
  if (!Number.isFinite(at) || at <= 0) return '';
  return calendarDayDiff(at, now) === 0 ? formatClock(at) : formatDateTime(at);
}

/** Quadros do spinner do rodapé de cada ferramenta. */
export function spinnerFrames(provider: Provider): readonly string[] {
  return provider === 'codex' ? CODEX_SPINNER : SPINNER;
}

/** Símbolo parado do rodapé (sem animação, ou fora do "trabalhando"). */
export function footerGlyph(kind: TerminalFooterKind, provider: Provider): string {
  if (kind === 'working') return provider === 'codex' ? '•' : '✻';
  return { waiting: '✋', shell: '⏳', idle: '○', ended: '■' }[kind];
}

export type TerminalFooterKind = 'working' | 'waiting' | 'shell' | 'idle' | 'ended';

export interface TerminalFooter {
  kind: TerminalFooterKind;
  text: string;
  /** Desde quando está nesse estado (para o tempo ao lado do texto). */
  since?: number;
}

/** Linha de estado do rodapé, imitando o Claude Code, a partir do agente vivo no snapshot. */
export function terminalFooter(agent: AgentInfo | undefined, agents: readonly AgentInfo[], now: number): TerminalFooter {
  if (!agent || agent.status === 'offline') return { kind: 'ended', text: tr('Sessão encerrada') };
  if (agent.status === 'done') return { kind: 'ended', text: tr('Subagente concluído · sessão encerrada') };
  const wait = shellWaitIn(agent, agents, now);
  if (wait) {
    const label = wait.main?.label?.trim();
    const more = wait.jobs.length > 1 ? ` (+${wait.jobs.length - 1})` : '';
    return { kind: 'shell', text: label ? tr('Esperando o shell: {0}{1}', [label, more]) : tr('Esperando o shell terminar'), since: wait.since };
  }
  switch (agent.status) {
    case 'working': {
      const act = agent.activity?.text?.trim().replace(/(?:…|\.{1,3})$/, '');
      return { kind: 'working', text: `${act || tr('Trabalhando')}…`, since: agent.statusSince };
    }
    case 'waiting': {
      const text = agent.waitingFor ? tr('Esperando você: {0}', [agent.waitingFor]) : tr('Esperando você');
      if (agent.permission) return { kind: 'waiting', text, since: agent.statusSince };
      // Sem o pedido no Habblaud (o hook já devolveu à sessão, a sessão abriu sem o plugin ou não havia página aberta
      // quando ele chegou): os botões não vêm, então diz onde responder.
      const hint =
        agent.provider === 'codex'
          ? tr('{0} · responda no Codex: este pedido não chegou ao Habblaud ou passou do tempo de espera', [text])
          : tr('{0} · responda no Claude Code: este pedido não chegou ao Habblaud ou passou do tempo de espera', [text]);
      return { kind: 'waiting', text: hint, since: agent.statusSince };
    }
    default:
      return { kind: 'idle', text: tr('Aguardando o próximo prompt') };
  }
}

// ---------------------------------------------------------------- linhas (DOM)

type Fill = (target: HTMLElement, text: string) => void;

/** Cria o botão de copiar de uma entrada (`what` = "prompt", "resposta", "comando", "resultado"...). */
type Copier = (text: string, what: string) => HTMLElement;

const fillPlain: Fill = (target, text) => {
  target.textContent = text;
};

/** Diff: uma linha por elemento, com fundo verde (+) ou vermelho (-), como no Claude Code. */
const fillDiff: Fill = (target, text) => {
  const frag = document.createDocumentFragment();
  for (const line of text.split('\n')) frag.append(h('span', { class: `ui-term__dl is-${diffLineKind(line)}`, text: line || ' ' }));
  target.append(frag);
};

/** Blocos que a busca abre ao chegar num resultado escondido neles (prévias recolhidas, raciocínio, detalhes). */
const expandables = new WeakMap<Element, () => void>();

/** Abre os blocos recolhidos que escondem `el` dentro de `stop` (ex.: um resultado da busca no "… +N linhas"). */
function revealWithin(el: Element, stop: Element): void {
  let hidden = false;
  for (let n: Element | null = el; n && n !== stop; n = n.parentElement) {
    if ((n as HTMLElement).hidden) hidden = true;
    const open = expandables.get(n);
    // Só abre quem esconde o trecho (um resultado já visível na prévia não expande o bloco).
    if (open && hidden) {
      open();
      hidden = false;
    }
  }
}

/**
 * Bloco de texto que recolhe quando é longo, com "… +N linhas" para expandir (e "recolher" depois). O texto inteiro
 * fica no DOM (o resto escondido), para a busca achar e destacar o que está recolhido.
 */
function collapsible(raw: string, maxLines: number, cls: string, fill: Fill = fillPlain): HTMLElement {
  const p = splitPreview(raw, maxLines);
  const body = h('div', { class: 'ui-term__pre' });
  const box = h('div', { class: cls }, body);
  if (!p.collapsed) {
    fill(body, p.text);
    return box;
  }
  // Diff: uma linha por elemento (blocos); o resto começa na linha seguinte.
  const block = fill === fillDiff;
  const head = h(block ? 'div' : 'span', {});
  fill(head, p.text.slice(0, p.headEnd));
  const rest = h(block ? 'div' : 'span', { hidden: true });
  fill(rest, block ? p.text.slice(p.headEnd).replace(/^\n/, '') : p.text.slice(p.headEnd));
  const dots = p.ellipsis ? h('span', { class: 'ui-term__dots', text: '…', attrs: { 'aria-hidden': 'true' } }) : null;
  body.append(head, ...(dots ? [dots] : []), rest);
  let open = false;
  const more = h('button', { class: 'ui-term__more', type: 'button', attrs: { 'aria-expanded': 'false' } });
  const set = (v: boolean) => {
    open = v;
    rest.hidden = !open;
    if (dots) dots.hidden = open;
    setText(more, open ? tr('recolher') : moreLabel(p.hiddenLines));
    setAttr(more, 'aria-expanded', String(open));
    setTitle(more, open ? tr('Recolher') : tr('Mostrar tudo ({0} {1})', [p.total, p.total === 1 ? tr('linha') : tr('linhas')]));
  };
  set(false);
  more.addEventListener('click', () => set(!open));
  expandables.set(box, () => {
    if (!open) set(true);
  });
  box.append(more);
  return box;
}

/** Texto que expande num clique (raciocínio, detalhe de evento). */
function expander(label: string, cls: string, detail: string, detailCls: string): HTMLElement {
  const body = h('div', { class: detailCls, text: detail, hidden: true });
  const btn = h('button', { class: cls, type: 'button', text: label, attrs: { 'aria-expanded': 'false' } });
  let open = false;
  const set = (v: boolean) => {
    open = v;
    body.hidden = !open;
    setAttr(btn, 'aria-expanded', String(open));
  };
  btn.addEventListener('click', () => set(!open));
  const wrap = h('div', { class: 'ui-term__exp' }, btn, body);
  expandables.set(wrap, () => set(true));
  return wrap;
}

function mark(text: string, extra = ''): HTMLElement {
  return h('span', { class: `ui-term__mark ${extra}`.trim(), text, attrs: { 'aria-hidden': 'true' } });
}

function row(kind: string, at: number, now: number, ...children: (Node | null)[]): HTMLElement {
  return h('div', { class: `ui-term__row ui-term__row--${kind}`, title: entryTimeTitle(at, now) }, ...children);
}

/** "  ⎿  resultado" (primeiras linhas, "… +N linhas", o aviso de corte e o botão de copiar). */
function resultBlock(r: ResultEntry, copy: Copier): HTMLElement {
  const out = h('div', { class: 'ui-term__out' });
  const text = r.text.replace(/\s+$/, '');
  if (text) out.append(collapsible(text, RESULT_PREVIEW_LINES, 'ui-term__res-text'));
  else out.append(h('span', { class: 'ui-term__empty', text: r.error ? tr('(erro sem mensagem)') : tr('(sem saída)'), attrs: { 'data-chrome': '' } }));
  if (r.truncated) out.append(h('span', { class: 'ui-term__cut', text: tr('(resultado cortado)'), attrs: { 'data-chrome': '' } }));
  const el = h('div', { class: `ui-term__result${r.error ? ' is-error' : ''}` }, h('span', { class: 'ui-term__elbow', text: '⎿', attrs: { 'aria-hidden': 'true' } }), out);
  if (text) el.append(copy(copyTextOf(r), tr('resultado')));
  return el;
}

function toolInput(t: ToolEntry): HTMLElement | null {
  if (!showToolInput(t)) return null;
  const kind = t.inputKind ?? 'text';
  const input = t.input!.replace(/\s+$/, '');
  if (kind === 'diff') return collapsible(input, INPUT_PREVIEW_LINES, 'ui-term__in ui-term__in--diff', fillDiff);
  if (kind === 'command') {
    const box = collapsible(input, INPUT_PREVIEW_LINES, 'ui-term__in ui-term__in--command');
    box.prepend(h('span', { class: 'ui-term__dollar', text: '$', attrs: { 'aria-hidden': 'true' } }));
    return box;
  }
  return collapsible(input, INPUT_PREVIEW_LINES, `ui-term__in ui-term__in--${kind === 'json' ? 'json' : 'text'}`);
}

interface ToolRefs {
  row: HTMLElement;
  slot: HTMLElement;
}

function toolRow(t: ToolEntry, now: number, copy: Copier): ToolRefs {
  const { name, args } = splitToolTitle(t.title);
  const title = h('div', { class: 'ui-term__title' }, h('strong', { text: name }), args ? document.createTextNode(args) : null);
  const input = toolInput(t);
  // Título + argumentos com o próprio botão de copiar (o comando; sem argumentos, o título).
  const what = t.inputKind === 'command' || t.tool === 'Bash' ? tr('comando') : input ? tr('entrada da ferramenta') : tr('ferramenta');
  const call = h('div', { class: 'ui-term__call' }, title, input, copy(copyTextOf(t), what));
  const slot = h('div', { class: 'ui-term__slot' });
  const el = row('tool', t.at, now, mark(DOT, 'ui-term__dot'), h('div', { class: 'ui-term__col' }, call, slot));
  el.classList.add('is-pending');
  return { row: el, slot };
}

function attachResult(refs: ToolRefs, r: ResultEntry, copy: Copier): void {
  refs.row.classList.remove('is-pending');
  refs.row.classList.toggle('is-error', !!r.error);
  refs.row.classList.toggle('is-ok', !r.error);
  refs.slot.replaceChildren(resultBlock(r, copy));
}

function entryRow(e: PlainEntry, now: number, copy: Copier): HTMLElement {
  switch (e.kind) {
    case 'user': {
      const el = row('user', e.at, now, mark('>'), h('div', { class: 'ui-term__col' }, collapsible(e.text, PROMPT_PREVIEW_LINES, 'ui-term__user-text')));
      el.append(copy(copyTextOf(e), 'prompt'));
      return el;
    }
    case 'assistant': {
      const body = h('div', { class: 'ui-term__col ui-md' });
      body.append(renderMarkdown(e.text));
      const el = row('assistant', e.at, now, mark(DOT, 'ui-term__dot'), body);
      el.append(copy(copyTextOf(e), tr('resposta')));
      return el;
    }
    case 'thinking': {
      const text = e.text?.trim();
      const content = text ? expander(tr('Pensando…'), 'ui-term__think', text, 'ui-term__think-text') : h('span', { class: 'ui-term__think', text: tr('Pensando…'), attrs: { 'data-chrome': '' } });
      return row('thinking', e.at, now, mark('✻'), h('div', { class: 'ui-term__col' }, content));
    }
    case 'system': {
      const text = h('span', { class: 'ui-term__sys-text', text: e.text });
      const col = h('div', { class: 'ui-term__col' }, text);
      if (e.detail?.trim()) col.append(expander(tr('detalhes'), 'ui-term__sys-more', e.detail.trim(), 'ui-term__sys-detail'));
      const el = row('system', e.at, now, mark('※'), col);
      if (e.level === 'warn' || e.level === 'error') el.classList.add(`is-${e.level}`);
      return el;
    }
  }
}

// ---------------------------------------------------------------- janela

/** O que o resto da interface (gaveta, atalhos, histórico) usa do terminal. */
export interface TerminalControl {
  /** Agente com o terminal aberto (null = fechado ou mostrando uma sessão do histórico). */
  readonly agentId: string | null;
  open(agentId: string, opener?: HTMLElement | null): void;
  /** Abre uma sessão do histórico: a conversa do transcript ou, se ela ainda estiver aberta, o terminal ao vivo do agente. */
  openSession(session: RecentSession, opener?: HTMLElement | null): void;
  close(): void;
  toggle(agentId: string, opener?: HTMLElement | null): void;
}

type ConnState = 'connecting' | 'open' | 'reconnecting' | 'failed';

/** Resultado atual da busca: o `index`-ésimo destaque da linha `key`. */
interface SearchRef {
  key: string;
  index: number;
}

const NO_FINALS: ReadonlySet<string> = new Set();

export class TerminalPanel implements UiComponent, TerminalControl {
  readonly el: HTMLElement;
  private id: string | null = null;
  /** Sessão do histórico aberta no painel (null = terminal de um agente). */
  private session: RecentSession | null = null;
  private last: AgentInfo | null = null;
  private source: EventSource | null = null;
  private opener: HTMLElement | null = null;
  private conn: ConnState = 'connecting';
  /** Já recebeu um `init` desta conexão (ou de uma anterior, no mesmo agente). */
  private loaded = false;
  private truncated = false;
  private log = new TerminalLog();
  private rows = new Map<string, HTMLElement>();
  private tools = new Map<string, ToolRefs>();
  /** Grudado no fim: mensagens novas rolam a tela. */
  private follow = true;
  /** Itens que chegaram enquanto o usuário lia lá em cima. */
  private unread = 0;
  private spinTimer: ReturnType<typeof setInterval> | null = null;
  private spinFrame = 0;
  /** Horário da entrada mais recente (o rodapé de uma sessão retomada acompanha). */
  private lastEntryAt = 0;

  private filter: TerminalFilter = 'all';
  private filterBtns: HTMLButtonElement[] = [];
  /** Linhas que aparecem com o filtro atual. */
  private visibleRows = 0;

  private searchOpen = false;
  /** Termo da busca já dobrado (minúsculas, sem acentos); '' = sem busca. */
  private folded = '';
  /** Destaques de cada linha (inclusive as escondidas pelo filtro, que não entram na contagem). */
  private hits = new Map<string, HTMLElement[]>();
  private current: SearchRef | null = null;
  private currentEl: HTMLElement | null = null;
  private searchTimer: ReturnType<typeof setTimeout> | null = null;

  private kindEl: HTMLElement;
  private accEl: HTMLElement;
  private nameEl: HTMLElement;
  /** Selo "Codex" (sessão do Codex). */
  private provEl: HTMLElement;
  /** Quadros do spinner da sessão aberta (Claude Code ou Codex). */
  private frames: readonly string[] = SPINNER;
  private roleEl: HTMLElement;
  private roomEl: HTMLElement;
  private reconnEl: HTMLElement;
  private findBtn: HTMLButtonElement;
  private alertEl: HTMLElement;
  private alertText: HTMLElement;
  private searchBox: HTMLElement;
  private searchInput: HTMLInputElement;
  private countEl: HTMLElement;
  private scroll: HTMLElement;
  private list: HTMLElement;
  private note: HTMLElement;
  private placeholder: HTMLElement;
  private newBtn: HTMLButtonElement;
  private status: HTMLElement;
  private glyph: HTMLElement;
  private statusText: HTMLElement;
  private statusTime: HTMLElement;
  /** "Assumir daqui" e "Encerrar" (terminal interativo ligado) e as abas dos agentes do projeto. */
  private actions: TermActions | null;
  private tabs: TermTabs;
  private movable: Movable;
  /** Caixa de mensagem do rodapé (só a sessão ao vivo de um agente principal). */
  private composer: MessageComposer;

  constructor(
    private ctx: UiContext,
    pty?: PtyControl,
  ) {
    this.actions = pty ? new TermActions(ctx, pty, true) : null;
    this.tabs = new TermTabs(ctx);
    const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '');
    const findKey = mac ? '⌘F' : 'Ctrl+F';
    const icon = h('span', { class: 'ui-term__icon', attrs: { 'aria-hidden': 'true' } });
    icon.innerHTML = ICONS.terminal;
    this.kindEl = h('span', { class: 'ui-term__kind', text: 'terminal' });
    this.accEl = createAccountChip('sm');
    this.accEl.hidden = true;
    this.nameEl = h('strong', { class: 'ui-term__name' });
    this.provEl = createProviderTag('ui-prov--xs');
    this.roleEl = h('span', { class: 'ui-role' });
    this.roomEl = h('span', { class: 'ui-term__room' });
    this.reconnEl = h('span', { class: 'ui-term__reconn', text: tr('reconectando…'), hidden: true, role: 'status' });
    this.findBtn = iconButton(ICONS.search, tr('Buscar na conversa ({0})', [findKey]), () => this.toggleSearch(), 'ui-icon-btn--sm ui-term__find');
    setAttr(this.findBtn, 'aria-expanded', 'false');
    const close = iconButton(ICONS.close, tr('Fechar terminal (Esc)'), () => this.close(), 'ui-icon-btn--sm ui-term__close');
    const bar = h(
      'div',
      { class: 'ui-term__bar' },
      icon,
      this.kindEl,
      h('div', { class: 'ui-term__who' }, this.accEl, this.nameEl, this.provEl, this.roleEl, this.roomEl),
      this.reconnEl,
      this.findBtn,
      ...(this.actions ? [this.actions.el] : []),
      maximizeButton(() => this.movable),
      close,
    );

    // Barra de ferramentas: filtro (segmentado) e a busca, que aparece com Ctrl/⌘+F ou a lupa.
    const filters = h('div', { class: 'ui-seg ui-term__filter', role: 'radiogroup', attrs: { 'aria-label': tr('Filtrar a conversa') } });
    for (const [value, text, hint] of TERMINAL_FILTERS) {
      const b = h('button', { class: 'ui-seg__opt', type: 'button', role: 'radio', text, title: hint, attrs: { 'aria-checked': 'false' } });
      b.addEventListener('click', () => this.setFilter(value));
      b.addEventListener('keydown', (e) => this.filterKey(e, value));
      this.filterBtns.push(b);
      filters.append(b);
    }
    const searchIcon = h('span', { class: 'ui-term__search-icon', attrs: { 'aria-hidden': 'true' } });
    searchIcon.innerHTML = ICONS.search;
    this.searchInput = h('input', {
      class: 'ui-term__search-input',
      type: 'text',
      attrs: { placeholder: tr('Buscar na conversa'), 'aria-label': tr('Buscar na conversa'), autocomplete: 'off', spellcheck: 'false', enterkeyhint: 'search' },
    });
    this.searchInput.addEventListener('input', () => this.scheduleSearch());
    this.searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.go(e.shiftKey ? -1 : 1);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        this.closeSearch(true);
      }
    });
    this.countEl = h('span', { class: 'ui-term__count', attrs: { 'aria-live': 'polite' } });
    this.searchBox = h(
      'div',
      { class: 'ui-term__search', role: 'search', hidden: true },
      searchIcon,
      this.searchInput,
      this.countEl,
      iconButton(ICONS.chevronUp, tr('Resultado anterior (Shift+Enter)'), () => this.go(-1), 'ui-icon-btn--sm ui-term__step'),
      iconButton(ICONS.chevronDown, tr('Próximo resultado (Enter)'), () => this.go(1), 'ui-icon-btn--sm ui-term__step'),
      iconButton(ICONS.close, tr('Fechar a busca (Esc)'), () => this.closeSearch(true), 'ui-icon-btn--sm ui-term__step'),
    );
    const tools = h('div', { class: 'ui-term__tools' }, filters, this.searchBox);

    const retry = h('button', { class: 'ui-btn ui-btn--sm', type: 'button', text: tr('Tentar de novo'), on: { click: () => this.connect() } });
    this.alertText = h('span', { class: 'ui-term__alert-text', text: OPEN_ERROR });
    this.alertEl = h('div', { class: 'ui-term__alert', role: 'alert', hidden: true }, this.alertText, retry);
    this.note = h('p', { class: 'ui-term__note', text: tr('Conversa anterior não carregada'), hidden: true });
    this.list = h('div', { class: 'ui-term__list' });
    this.placeholder = h('p', { class: 'ui-term__placeholder' });
    this.scroll = h('div', { class: 'ui-term__scroll', tabIndex: 0, attrs: { 'aria-label': tr('Conversa da sessão') } }, this.note, this.list, this.placeholder);
    this.scroll.addEventListener('scroll', () => this.onScroll(), { passive: true });
    this.newBtn = h('button', { class: 'ui-term__new', type: 'button', hidden: true, on: { click: () => this.jumpToEnd() } });

    this.glyph = h('span', { class: 'ui-term__glyph', attrs: { 'aria-hidden': 'true' } });
    this.statusText = h('span', { class: 'ui-term__status-text' });
    this.statusTime = h('span', { class: 'ui-term__status-time' });
    this.status = h('p', { class: 'ui-term__status' }, this.glyph, this.statusText, this.statusTime);
    // Esc na caixa devolve o foco à conversa (o próximo fecha o terminal).
    this.composer = new MessageComposer(ctx, 'terminal', { onEscape: () => this.focusLog() });

    this.el = h(
      'section',
      { class: 'ui-term', role: 'dialog', hidden: true, tabIndex: -1, attrs: { 'aria-label': tr('Terminal') } },
      bar,
      this.tabs.el,
      tools,
      h('div', { class: 'ui-term__body' }, this.alertEl, this.scroll, this.newBtn),
      h('div', { class: 'ui-term__foot' }, this.status, this.composer.el),
    );
    this.el.addEventListener('keydown', (e) => this.onKey(e));
    // Arrastar pela barra solta a janela (ui/movable.ts).
    this.movable = new Movable(this.el, bar, { key: 'habblaud.move.term', enabled: () => !ctx.isNarrow() });
    this.renderFilter();
    // Janela redimensionada: quem está no fim continua vendo o fim.
    if (typeof ResizeObserver === 'function') new ResizeObserver(() => this.follow && this.scrollToEnd()).observe(this.scroll);
  }

  get agentId(): string | null {
    return this.session ? null : this.id;
  }

  get isOpen(): boolean {
    return this.id !== null;
  }

  open(agentId: string, opener: HTMLElement | null = activeElement()): void {
    this.start(agentId, null, opener);
  }

  openSession(session: RecentSession, opener: HTMLElement | null = activeElement()): void {
    // Ainda aberta e no escritório: o terminal ao vivo do agente (com status no rodapé).
    if (session.open && session.agentId && this.ctx.agent(session.agentId)) return this.open(session.agentId, opener);
    this.start(sessionKey(session.account, session.sessionId), session, opener);
  }

  close(): void {
    if (this.id === null) return;
    this.disconnect();
    this.stopSpinner();
    this.closeSearch(false);
    const hadFocus = this.el.contains(document.activeElement) || document.activeElement === document.body;
    this.id = null;
    this.session = null;
    this.last = null;
    this.el.hidden = true;
    this.clear();
    const opener = this.opener;
    this.opener = null;
    if (hadFocus && opener?.isConnected) opener.focus({ preventScroll: true });
    this.ctx.invalidate();
  }

  toggle(agentId: string, opener: HTMLElement | null = activeElement()): void {
    if (this.agentId === agentId) this.close();
    else this.open(agentId, opener);
  }

  /** Esc: o primeiro fecha a busca; o seguinte, o terminal. Devolve false se não havia nada aberto. */
  escape(): boolean {
    if (this.id === null) return false;
    if (this.searchOpen) this.closeSearch(this.el.contains(document.activeElement));
    else this.close();
    return true;
  }

  render(): void {
    if (this.id === null) return;
    if (this.session) this.renderSessionHead(this.session);
    else this.renderAgentHead();
    const live = this.session ? null : (this.ctx.agent(this.id) ?? null);
    this.actions?.render(live);
    this.tabs.render(live ? live.id : null);
    this.renderFooter();
    this.renderState();
    // Mensagens só para a sessão ao vivo (no histórico, a caixa diz que a sessão foi encerrada).
    this.composer.render(this.session ? undefined : this.ctx.agent(this.id), this.id);
  }

  /** Abre o painel numa conversa nova (agente ou sessão do histórico); a mesma conversa só recebe o foco. */
  private start(id: string, session: RecentSession | null, opener: HTMLElement | null): void {
    if (opener && !this.el.contains(opener)) this.opener = opener;
    if (this.id === id) {
      this.focusLog();
      return;
    }
    // Um terminal por vez: abrir outro substitui o atual (a busca e o filtro continuam valendo).
    this.disconnect();
    this.clear();
    this.id = id;
    this.session = session;
    this.last = session ? null : (this.ctx.agent(id) ?? null);
    this.loaded = false;
    this.truncated = false;
    this.follow = true;
    this.unread = 0;
    this.lastEntryAt = 0;
    if (this.el.hidden) this.movable.restore();
    this.el.hidden = false;
    this.el.classList.toggle('is-session', !!session);
    this.connect();
    this.render();
    this.focusLog();
    this.ctx.invalidate();
  }

  private renderAgentHead(): void {
    const live = this.ctx.agent(this.id!);
    if (live) this.last = live;
    const a = this.last;
    const name = a?.name ?? tr('Agente');
    setText(this.kindEl, 'terminal');
    setHidden(this.accEl, true);
    setText(this.nameEl, name);
    setTitle(this.nameEl, '');
    updateProviderTag(this.provEl, providerOf(a));
    setText(this.roleEl, a ? roleLabel(a) : '');
    setHidden(this.roleEl, !a);
    if (a) setVariant(this.roleEl, 'ui-role--', a.kind);
    const room = a ? this.ctx.store.room(a.roomId) : undefined;
    setText(this.roomEl, room ? tr('sala {0}', [room.name]) : '');
    setTitle(this.roomEl, room?.path ?? '');
    setHidden(this.roomEl, !room);
    setAttr(this.el, 'aria-label', tr('Terminal de {0}', [name]));
    this.el.classList.toggle('is-gone', !live);
  }

  /** Sessão do histórico: conta, título, projeto e a data de início. */
  private renderSessionHead(s: RecentSession): void {
    const title = s.title?.trim() || tr('Sessão sem título');
    setText(this.kindEl, tr('histórico'));
    updateAccountChip(this.accEl, this.ctx.account(s.account), s.account, s.provider);
    setHidden(this.accEl, false);
    setText(this.nameEl, title);
    setTitle(this.nameEl, title);
    updateProviderTag(this.provEl, providerOf(s));
    setHidden(this.roleEl, true);
    setText(this.roomEl, `${sessionProjectName(s)} · ${formatDateTime(s.firstAt ?? s.lastAt)}`);
    setTitle(this.roomEl, s.project ?? s.projectDir);
    setHidden(this.roomEl, false);
    setAttr(this.el, 'aria-label', tr('Terminal da sessão {0}', [title]));
    this.el.classList.remove('is-gone');
  }

  private onKey(e: KeyboardEvent): void {
    if (e.defaultPrevented) return;
    const mod = (e.ctrlKey || e.metaKey) && !e.altKey;
    const key = e.key.toLowerCase();
    // Ctrl/⌘+F com o terminal em foco busca na conversa (fora dele, continua sendo a busca do navegador).
    if (mod && !e.shiftKey && key === 'f') {
      e.preventDefault();
      e.stopPropagation();
      this.openSearch();
      return;
    }
    if (mod && key === 'g' && this.searchOpen) {
      e.preventDefault();
      this.go(e.shiftKey ? -1 : 1);
      return;
    }
    if (e.key !== 'Escape' || e.ctrlKey || e.metaKey || e.altKey) return;
    e.preventDefault();
    e.stopPropagation();
    this.escape();
  }

  // ---------------------------------------------------------------- stream

  private connect(): void {
    this.disconnect();
    const id = this.id;
    if (id === null) return;
    this.conn = 'connecting';
    let es: EventSource;
    try {
      es = new EventSource(this.session ? sessionTerminalUrl(this.session.account, this.session.sessionId) : terminalUrl(id));
    } catch {
      this.conn = 'failed';
      this.renderState();
      return;
    }
    this.source = es;
    es.addEventListener('open', () => {
      if (this.source !== es) return;
      this.conn = 'open';
      this.renderState();
    });
    es.addEventListener('init', (ev) => {
      if (this.source !== es) return;
      const data = parseInit((ev as MessageEvent).data);
      if (data) this.onInit(data);
    });
    es.addEventListener('append', (ev) => {
      if (this.source !== es) return;
      const entries = parseAppend((ev as MessageEvent).data);
      if (entries.length) this.ingest(entries, false);
    });
    es.addEventListener('error', () => {
      if (this.source !== es) return;
      // Fechado = o servidor recusou (403/404/429) ou o navegador desistiu; senão, ele mesmo tenta reconectar.
      if (es.readyState === ES_CLOSED) {
        es.close();
        this.source = null;
        this.conn = 'failed';
      } else {
        this.conn = 'reconnecting';
      }
      this.renderState();
    });
    this.renderState();
  }

  private disconnect(): void {
    this.source?.close();
    this.source = null;
  }

  private onInit(data: TerminalInit): void {
    // Reconexão com o usuário lendo lá em cima: tenta manter a mesma entrada no mesmo lugar.
    const anchor = this.follow ? null : this.captureAnchor();
    this.clear();
    this.conn = 'open';
    this.loaded = true;
    this.truncated = data.truncated;
    this.unread = 0;
    this.ingest(data.entries, true);
    // A conversa foi remontada: a busca refaz os destaques (mantendo o resultado atual, se ele ainda existir).
    if (this.folded) this.runSearch(false);
    const target = anchor ? this.rows.get(anchor.key) : undefined;
    if (anchor && target) this.scroll.scrollTop = target.offsetTop - anchor.offset;
    else {
      this.follow = true;
      this.scrollToEnd();
    }
    this.renderState();
  }

  /** Aplica um lote: cria as linhas novas num fragmento, junta resultados e descarta as linhas mais antigas. */
  private ingest(entries: readonly TerminalEntry[], initial: boolean): void {
    for (const e of entries) if (e.at > this.lastEntryAt) this.lastEntryAt = e.at;
    const batch = this.log.push(entries);
    const evicted = this.log.trim(TERMINAL_DOM_LIMIT);
    if (evicted.length) {
      const before = this.follow ? 0 : this.scroll.scrollHeight;
      for (const key of evicted) {
        this.rows.get(key)?.remove();
        this.rows.delete(key);
        this.tools.delete(key);
        this.hits.delete(key);
        if (this.current?.key === key) this.current = null;
      }
      // Lendo lá em cima: compensa a altura que saiu do topo para o texto não pular.
      if (!this.follow) this.scroll.scrollTop -= before - this.scroll.scrollHeight;
    }
    const touched: string[] = [];
    for (const { toolKey: key, result } of batch.attached) {
      const refs = this.tools.get(key);
      if (!refs) continue;
      attachResult(refs, result, this.copier);
      touched.push(key);
    }
    const gone = new Set(evicted);
    const now = this.ctx.now();
    const frag = document.createDocumentFragment();
    let added = 0;
    for (const item of batch.added) {
      if (gone.has(item.key)) continue;
      const el = this.buildRow(item, now);
      el.dataset.key = item.key;
      this.rows.set(item.key, el);
      frag.append(el);
      touched.push(item.key);
      added++;
    }
    this.list.append(frag);
    this.applyFilter();
    // A busca continua valendo: destaca o que chegou (sem mudar o resultado atual).
    if (!initial && this.folded) this.refreshHits(touched);
    if (!initial) {
      if (this.follow) this.scrollToEnd();
      else this.unread += added + batch.attached.length;
      this.renderState();
    }
  }

  private buildRow(item: TerminalItem, now: number): HTMLElement {
    if (item.type === 'entry') return entryRow(item.entry, now, this.copier);
    if (item.type === 'orphan') {
      const el = row('orphan', item.result.at, now, mark(''), h('div', { class: 'ui-term__col' }, resultBlock(item.result, this.copier)));
      if (!el.title) el.title = tr('Resultado de uma ferramenta anterior');
      return el;
    }
    const refs = toolRow(item.tool, now, this.copier);
    this.tools.set(item.key, refs);
    if (item.result) attachResult(refs, item.result, this.copier);
    return refs.row;
  }

  private clear(): void {
    this.log.reset();
    this.rows.clear();
    this.tools.clear();
    this.hits.clear();
    this.current = null;
    this.currentEl = null;
    this.visibleRows = 0;
    this.list.replaceChildren();
  }

  // ---------------------------------------------------------------- copiar

  /** Botão discreto (aparece no hover ou no foco) que copia o texto de uma entrada e confirma com "Copiado". */
  private copier: Copier = (text, what) => {
    const label = tr('Copiar {0}', [what]);
    const icon = h('span', { class: 'ui-term__copy-icon', attrs: { 'aria-hidden': 'true' } });
    icon.innerHTML = ICONS.copy;
    const done = h('span', { class: 'ui-term__copy-done', text: tr('Copiado') });
    const btn = h('button', { class: 'ui-term__copy', type: 'button', title: label, attrs: { 'aria-label': label } }, icon, done);
    let timer: ReturnType<typeof setTimeout> | null = null;
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const ok = await copyText(text);
      btn.classList.toggle('is-done', ok);
      btn.classList.toggle('is-fail', !ok);
      icon.innerHTML = ok ? ICONS.check : ICONS.copy;
      setText(done, ok ? tr('Copiado') : tr('Não foi possível copiar'));
      setTitle(btn, ok ? tr('Copiado') : tr('Não foi possível copiar'));
      this.ctx.announce(ok ? tr('Copiado.') : tr('Não foi possível copiar.'));
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        btn.classList.remove('is-done', 'is-fail');
        icon.innerHTML = ICONS.copy;
        setText(done, tr('Copiado'));
        setTitle(btn, label);
      }, COPIED_MS);
    });
    return btn;
  };

  // ---------------------------------------------------------------- filtro

  private setFilter(f: TerminalFilter): void {
    if (f === this.filter) return;
    this.filter = f;
    this.renderFilter();
    this.applyFilter();
    // O resultado atual pode ter sumido com o filtro.
    if (this.folded) {
      this.markCurrent(false);
      this.renderSearch();
    }
    if (this.follow) this.scrollToEnd();
    this.renderState();
  }

  /** Setas entre as opções do filtro (padrão de radiogroup). */
  private filterKey(e: KeyboardEvent, value: TerminalFilter): void {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    e.stopPropagation();
    const i = TERMINAL_FILTERS.findIndex(([v]) => v === value);
    const n = TERMINAL_FILTERS.length;
    const next = (i + (e.key === 'ArrowRight' ? 1 : n - 1)) % n;
    this.setFilter(TERMINAL_FILTERS[next][0]);
    this.filterBtns[next].focus();
  }

  private renderFilter(): void {
    TERMINAL_FILTERS.forEach(([value], i) => {
      const on = value === this.filter;
      setAttr(this.filterBtns[i], 'aria-checked', String(on));
      this.filterBtns[i].tabIndex = on ? 0 : -1;
    });
  }

  /** Mostra ou esconde cada linha conforme o filtro ("Só prompts" depende do que vem depois de cada resposta). */
  private applyFilter(): void {
    const finals = this.filter === 'prompts' ? finalAnswerKeys(this.log.values()) : NO_FINALS;
    let visible = 0;
    for (const item of this.log.values()) {
      const el = this.rows.get(item.key);
      if (!el) continue;
      const show = itemVisible(item, this.filter, finals);
      el.classList.toggle('is-filtered', !show);
      if (show) visible++;
    }
    this.visibleRows = visible;
  }

  // ---------------------------------------------------------------- busca

  private toggleSearch(): void {
    if (this.searchOpen) this.closeSearch(true);
    else this.openSearch();
  }

  private openSearch(): void {
    if (this.id === null) return;
    const wasOpen = this.searchOpen;
    this.searchOpen = true;
    setHidden(this.searchBox, false);
    setAttr(this.findBtn, 'aria-expanded', 'true');
    this.findBtn.classList.add('is-on');
    this.searchInput.focus();
    this.searchInput.select();
    // Reaberta com o termo anterior: destaca de novo.
    if (!wasOpen && this.searchInput.value.trim()) this.runSearch(true);
    else this.renderSearch();
  }

  private closeSearch(focusLog: boolean): void {
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = null;
    if (!this.searchOpen) return;
    this.searchOpen = false;
    setHidden(this.searchBox, true);
    setAttr(this.findBtn, 'aria-expanded', 'false');
    this.findBtn.classList.remove('is-on');
    this.runSearch(false);
    if (focusLog) this.focusLog();
  }

  private scheduleSearch(): void {
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => this.runSearch(true), SEARCH_DEBOUNCE_MS);
  }

  /** Busca pendente (o usuário apertou Enter logo depois de digitar): roda agora. */
  private flushSearch(): void {
    if (!this.searchTimer) return;
    clearTimeout(this.searchTimer);
    this.runSearch(true);
  }

  /**
   * Refaz todos os destaques. `reset` = termo novo: o resultado atual passa a ser o primeiro a partir do que está
   * na tela; senão, mantém o atual (se ele ainda existir).
   */
  private runSearch(reset: boolean): void {
    this.searchTimer = null;
    const folded = this.searchOpen ? foldQuery(this.searchInput.value) : '';
    for (const spans of this.hits.values()) clearHits(spans);
    this.hits.clear();
    this.currentEl = null;
    const prev = this.current;
    this.current = null;
    this.folded = folded;
    if (folded) {
      for (const [key, el] of this.rows) {
        const spans = highlightHits(el, folded);
        if (spans.length) this.hits.set(key, spans);
      }
      this.current = reset ? this.firstHitInView() : prev;
      this.markCurrent(reset);
    }
    this.renderSearch();
  }

  /** Destaques de linhas novas ou alteradas (resultado que chegou), sem mexer no resultado atual. */
  private refreshHits(keys: readonly string[]): void {
    for (const key of keys) {
      const old = this.hits.get(key);
      if (old) clearHits(old);
      this.hits.delete(key);
      const el = this.rows.get(key);
      const spans = el ? highlightHits(el, this.folded) : [];
      if (spans.length) this.hits.set(key, spans);
    }
    this.markCurrent(false);
    this.renderSearch();
  }

  /** [linha, nº de destaques] das linhas visíveis, na ordem da tela. */
  private visibleCounts(): [string, number][] {
    const out: [string, number][] = [];
    for (const [key, el] of this.rows) {
      const spans = this.hits.get(key);
      if (spans && !el.classList.contains('is-filtered')) out.push([key, spans.length]);
    }
    return out;
  }

  /** O primeiro resultado visível a partir do topo da tela (ou o primeiro de todos, se não houver nenhum abaixo). */
  private firstHitInView(): SearchRef | null {
    const top = this.scroll.getBoundingClientRect().top;
    let first: SearchRef | null = null;
    for (const [key] of this.visibleCounts()) {
      first ??= { key, index: 0 };
      if (this.rows.get(key)!.getBoundingClientRect().bottom < top) continue;
      const i = this.hits.get(key)!.findIndex((s) => s.getBoundingClientRect().bottom >= top);
      if (i >= 0) return { key, index: i };
    }
    return first;
  }

  /** Próximo (1) ou anterior (-1) resultado: abre os blocos recolhidos que o escondem e rola até ele. */
  private go(dir: 1 | -1): void {
    if (!this.searchOpen) return this.openSearch();
    this.flushSearch();
    const counts = this.visibleCounts();
    const total = counts.reduce((n, [, c]) => n + c, 0);
    if (!total) return;
    this.current = refAt(counts, stepMatch(globalIndex(counts, this.current), total, dir));
    this.markCurrent(true);
    this.renderSearch(counts);
  }

  /** Marca o resultado atual (some se a linha saiu ou foi escondida pelo filtro); com `scroll`, leva até ele. */
  private markCurrent(scroll: boolean): void {
    this.currentEl?.classList.remove('is-current');
    this.currentEl = null;
    const ref = this.current;
    if (!ref) return;
    const el = this.rows.get(ref.key);
    const spans = this.hits.get(ref.key);
    if (!el || !spans?.length || el.classList.contains('is-filtered')) {
      this.current = null;
      return;
    }
    const index = Math.min(ref.index, spans.length - 1);
    const span = spans[index];
    this.current = { key: ref.key, index };
    revealWithin(span, el);
    span.classList.add('is-current');
    this.currentEl = span;
    if (scroll) this.scrollToHit(span);
  }

  private scrollToHit(span: HTMLElement): void {
    const r = span.getBoundingClientRect();
    const c = this.scroll.getBoundingClientRect();
    if (r.top < c.top + 8 || r.bottom > c.bottom - 8) this.scroll.scrollTop += r.top - c.top - (c.height - r.height) / 2;
    // Saiu do fim para ler o resultado: as mensagens novas não puxam a tela de volta.
    this.follow = this.distanceToEnd() <= STICK_PX;
    this.renderNewButton();
  }

  private renderSearch(counts = this.visibleCounts()): void {
    const total = counts.reduce((n, [, c]) => n + c, 0);
    const active = this.searchOpen && !!this.folded;
    setText(this.countEl, active ? searchCounter(globalIndex(counts, this.current), total) : '');
    setTitle(this.countEl, active ? (total ? `${total} ${total === 1 ? tr('resultado') : tr('resultados')}` : tr('Nenhum resultado')) : '');
    this.searchBox.classList.toggle('is-miss', active && total === 0);
  }

  // ---------------------------------------------------------------- rolagem

  private distanceToEnd(): number {
    const s = this.scroll;
    return s.scrollHeight - s.scrollTop - s.clientHeight;
  }

  private onScroll(): void {
    const atEnd = this.distanceToEnd() <= STICK_PX;
    if (atEnd === this.follow) return;
    this.follow = atEnd;
    if (atEnd) this.unread = 0;
    this.renderNewButton();
  }

  private scrollToEnd(): void {
    this.scroll.scrollTop = this.scroll.scrollHeight;
  }

  private jumpToEnd(): void {
    this.follow = true;
    this.unread = 0;
    this.scrollToEnd();
    this.renderNewButton();
  }

  private captureAnchor(): { key: string; offset: number } | null {
    const top = this.scroll.scrollTop;
    for (const [key, el] of this.rows) {
      if (el.classList.contains('is-filtered')) continue;
      if (el.offsetTop + el.offsetHeight > top) return { key, offset: el.offsetTop - top };
    }
    return null;
  }

  private focusLog(): void {
    this.scroll.focus({ preventScroll: true });
  }

  // ---------------------------------------------------------------- estado e rodapé

  private renderState(): void {
    setHidden(this.reconnEl, this.conn !== 'reconnecting');
    setHidden(this.alertEl, this.conn !== 'failed');
    setText(this.alertText, this.session ? SESSION_OPEN_ERROR : OPEN_ERROR);
    setHidden(this.note, !(this.loaded && this.truncated));
    const empty = this.rows.size === 0;
    const filteredOut = !empty && this.visibleRows === 0;
    setHidden(this.placeholder, !(empty || filteredOut) || this.conn === 'failed');
    if (filteredOut) setText(this.placeholder, tr('Nada para mostrar com este filtro.'));
    else if (empty) setText(this.placeholder, !this.loaded ? tr('Abrindo o terminal…') : this.session ? tr('Nenhuma mensagem nesta sessão.') : tr('Nenhuma mensagem nesta sessão ainda.'));
    this.renderNewButton();
  }

  private renderNewButton(): void {
    setHidden(this.newBtn, this.follow || this.visibleRows === 0);
    setText(this.newBtn, this.unread > 0 ? tr('↓ Novas mensagens') : tr('↓ Ir para o fim'));
  }

  private renderFooter(): void {
    if (this.id === null) return;
    const now = this.ctx.now();
    if (this.session) {
      // Sessão do histórico: horário da última atividade (o transcript pode ter crescido desde a listagem).
      const at = Math.max(this.session.lastAt, this.lastEntryAt);
      const text = sessionEndedText(at, now);
      this.stopSpinner();
      setVariant(this.status, 'is-', 'ended');
      setText(this.statusText, text);
      setTitle(this.status, `${text} (${formatDateTime(at)})`);
      setText(this.statusTime, '');
      setHidden(this.statusTime, true);
      setText(this.glyph, '■');
      return;
    }
    const agent = this.ctx.agent(this.id);
    const provider = providerOf(agent ?? this.last);
    this.frames = spinnerFrames(provider);
    const f = terminalFooter(agent, this.ctx.store.snapshot?.agents ?? [], now);
    setVariant(this.status, 'is-', f.kind);
    setText(this.statusText, f.text);
    setTitle(this.status, f.text);
    let time = '';
    if (f.since !== undefined) {
      const ms = Math.max(0, now - f.since);
      if (f.kind === 'working') time = `(${formatDuration(ms)})`;
      else if (f.kind === 'shell') time = formatElapsed(ms);
      else if (f.kind === 'waiting') time = relativeTime(f.since, now);
    }
    setText(this.statusTime, time);
    setHidden(this.statusTime, !time);
    if (f.kind === 'working' && !prefersReducedMotion()) this.startSpinner();
    else {
      this.stopSpinner();
      setText(this.glyph, footerGlyph(f.kind, provider));
    }
  }

  private startSpinner(): void {
    if (this.spinTimer) return;
    setText(this.glyph, this.frames[this.spinFrame % this.frames.length]);
    this.spinTimer = setInterval(() => {
      this.spinFrame = (this.spinFrame + 1) % (this.frames.length * 8);
      setText(this.glyph, this.frames[this.spinFrame % this.frames.length]);
      // O tempo ao lado do texto anda a cada ~1 s, mesmo sem snapshot novo.
      if (this.spinFrame % 8 === 0) this.renderFooter();
    }, SPINNER_MS);
  }

  private stopSpinner(): void {
    if (this.spinTimer) clearInterval(this.spinTimer);
    this.spinTimer = null;
  }
}

function activeElement(): HTMLElement | null {
  return typeof document !== 'undefined' && document.activeElement instanceof HTMLElement ? document.activeElement : null;
}
