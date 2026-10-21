// Visão completa do transcript para o terminal: converte as linhas JSONL do Claude Code
// em TerminalEntry (prompts, respostas, ferramentas e seus resultados), com segredos mascarados e
// textos truncados. Independente do parser de atividades (transcript.ts): aqui o objetivo é mostrar a
// conversa como o Claude Code a exibe, não resumir o que o personagem está fazendo.
//
// O que os transcripts trazem (só a estrutura) e que molda as regras abaixo:
// - cada linha de assistant traz UM bloco (thinking, text ou tool_use); a mesma mensagem (message.id)
//   se espalha por várias linhas. O thinking quase sempre vem vazio (só a assinatura);
// - um prompt digitado com o agente ocupado chega como attachment `queued_command` (commandMode
//   'prompt'), não como linha user; notificações de tarefas em segundo plano chegam como linha user ou
//   como attachment `queued_command` (as linhas queue-operation são só a fila e são ignoradas);
// - comandos de barra locais e a saída deles vêm em linhas system `local_command`;
// - erros da API: uma linha system `api_error` por tentativa e, quando o Claude Code desiste, uma
//   mensagem sintética do assistant com `isApiErrorMessage`.
import type { TerminalEntry, TerminalInputKind } from '../../shared/types';
import { formatDuration, maskSecrets, truncate } from '../../shared/activity';
import { forkDirective, parseTaskNotification } from './transcript';
import { tr } from '../../shared/i18n';

export interface TerminalParser {
  /** Interpreta uma linha do JSONL. Linhas inválidas ou irrelevantes devolvem []. */
  push(line: string): TerminalEntry[];
}

// ------------------------------------------------------------------ limites (caracteres)

/** Prompts do usuário e respostas do agente. */
export const TEXT_MAX = 20_000;
export const THINKING_MAX = 8_000;
/** Argumentos de uma ferramenta (comando, diff, JSON...). */
export const INPUT_MAX = 2_000;
/** Resultado de uma ferramenta: caracteres e linhas (o que passar disso vem com `truncated`). */
export const RESULT_MAX = 4_000;
export const RESULT_MAX_LINES = 120;
/** Detalhe de uma entrada 'system' (saída de comando, resumo da compactação...). */
export const DETAIL_MAX = 4_000;
/** Argumento exibido no título de uma ferramenta: "Bash(…)". */
export const TITLE_ARG_MAX = 100;
/** Texto (uma linha) de uma entrada 'system'. */
const SYSTEM_TEXT_MAX = 200;
/**
 * Ao recortar um texto ANTES de mascarar (para não rodar as expressões sobre megabytes que não serão
 * mostrados), o fim do recorte pode ter meio segredo que as expressões não reconhecem: esses últimos
 * caracteres são descartados.
 */
const TAIL_GUARD = 256;
/** Ids já emitidos que são lembrados (duplicatas são locais: a mesma linha ou mensagem repetida). */
const SEEN_MAX = 20_000;
const MSG_BLOCKS_MAX = 64;

type Rec = Record<string, unknown>;
type Level = 'info' | 'warn' | 'error';
type ToolEntry = Extract<TerminalEntry, { kind: 'tool' }>;
type ResultEntry = Extract<TerminalEntry, { kind: 'result' }>;
type ThinkingEntry = Extract<TerminalEntry, { kind: 'thinking' }>;
type SystemEntry = Extract<TerminalEntry, { kind: 'system' }>;

function rec(v: unknown): Rec | undefined {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Rec) : undefined;
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v : undefined;
}

function toMs(v: unknown): number | undefined {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (typeof v !== 'string') return undefined;
  const t = Date.parse(v);
  return Number.isNaN(t) ? undefined : t;
}

// ------------------------------------------------------------------ texto: limpeza, máscara e corte

const REMINDER = /<system-reminder>[\s\S]*?(?:<\/system-reminder>|$)/g;
// Sequências ANSI (cores, cursor, títulos OSC) e demais caracteres de controle, menos \t e \n.
const ANSI = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)?|\x1b[@-_]/g;
const CONTROL = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g;

/** Tira lembretes de sistema (opcional), cores ANSI e o que o \r de barras de progresso sobrescreveu. */
function clean(s: string, reminders: boolean): string {
  let out = reminders && s.includes('<system-reminder>') ? s.replace(REMINDER, '') : s;
  if (out.includes('\x1b')) out = out.replace(ANSI, '');
  if (out.includes('\r')) {
    out = out
      .replace(/\r+\n/g, '\n')
      .split('\n')
      .map((l) => {
        const i = l.replace(/\r+$/, '').lastIndexOf('\r');
        return i >= 0 ? l.slice(i + 1) : l.replace(/\r+$/, '');
      })
      .join('\n');
  }
  return out.replace(CONTROL, '');
}

/**
 * Limpa e mascara no máximo `window` caracteres de `raw`. `cut` = o texto original era maior (e o fim
 * do recorte, onde poderia haver meio segredo, foi descartado). Todo corte posterior é seguro.
 */
function safeText(raw: string, window: number, reminders = true): { text: string; cut: boolean } {
  if (raw.length <= window) return { text: maskSecrets(clean(raw, reminders)), cut: false };
  const masked = maskSecrets(clean(raw.slice(0, window), reminders));
  return { text: masked.slice(0, Math.max(0, masked.length - TAIL_GUARD)), cut: true };
}

/** Corta um texto já mascarado em `max` caracteres e `maxLines` linhas, preservando as quebras. */
function clip(s: string, max: number, maxLines = Infinity): { text: string; truncated: boolean } {
  let end = Math.min(s.length, max);
  if (maxLines !== Infinity) {
    let nl = -1;
    for (let n = 0; n < maxLines; n++) {
      nl = s.indexOf('\n', nl + 1);
      if (nl === -1 || nl >= end) break;
    }
    if (nl !== -1 && nl < end) end = nl;
  }
  if (end >= s.length) return { text: s, truncated: false };
  // Não corta um caractere fora do plano básico (emoji) ao meio.
  const code = s.charCodeAt(end - 1);
  if (end > 0 && code >= 0xd800 && code <= 0xdbff) end--;
  return { text: s.slice(0, end).trimEnd(), truncated: true };
}

export interface Prepared {
  text: string;
  truncated: boolean;
}

/**
 * Texto multilinha pronto para exibir: limpo, mascarado, sem linhas vazias nas pontas e cortado. Também usado pelo
 * terminal do Codex (sources/codex/terminal.ts), como `marked` e `oneLine`.
 */
export function prepare(raw: string, max: number, maxLines = Infinity, reminders = true): Prepared {
  const safe = safeText(raw, max * 2 + 1_024, reminders);
  const c = clip(safe.text.replace(/^(?:[ \t]*\n)+/, '').trimEnd(), max, maxLines);
  return { text: c.text, truncated: c.truncated || safe.cut };
}

/** Para entradas sem o campo `truncated`: o corte vira uma última linha "…". */
export function marked(p: Prepared): string {
  return p.truncated && p.text ? `${p.text}\n…` : p.text;
}

/** Primeira linha não vazia, mascarada e cortada em `max` (com " …" se havia mais linhas). */
export function oneLine(raw: string, max: number, reminders = true): string {
  const { text, cut } = safeText(raw, max * 4 + TAIL_GUARD * 2, reminders);
  const lines = text.split('\n');
  const i = lines.findIndex((l) => l.trim());
  if (i < 0) return '';
  const line = truncate(lines[i], max);
  const more = cut || lines.slice(i + 1).some((l) => l.trim());
  return more && !line.endsWith('…') ? `${line} …` : line;
}

/** Uma linha para o `text` de uma entrada 'system' e, se ela perdeu informação, o texto todo no `detail`. */
function lineAndDetail(raw: string, max = SYSTEM_TEXT_MAX): { line: string; detail?: string } {
  const line = oneLine(raw, max);
  return line.endsWith('…') ? { line, detail: raw } : { line };
}

/** `<tag>conteúdo</tag>` (o primeiro). */
const TAGS = new Map<string, RegExp>();
function inner(text: string, tag: string): string | undefined {
  let re = TAGS.get(tag);
  if (!re) TAGS.set(tag, (re = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`)));
  return re.exec(text)?.[1];
}

// ------------------------------------------------------------------ ferramentas

interface ToolView {
  title: string;
  input?: string;
  inputKind?: TerminalInputKind;
}

function relPath(p: string, cwd: string | undefined): string {
  if (!cwd || !p.startsWith('/')) return p;
  const base = cwd.replace(/\/+$/, '');
  if (!base || p === base) return base ? '.' : p;
  return p.startsWith(`${base}/`) ? p.slice(base.length + 1) : p;
}

function titled(label: string, arg: string | undefined): string {
  const shown = arg ? oneLine(arg, TITLE_ARG_MAX, false) : '';
  return shown ? `${label}(${shown})` : label;
}

/** O argumento cabe inteiro no título (então não precisa se repetir no JSON). */
function fitsTitle(v: string): boolean {
  return !v.includes('\n') && v.trim().length <= TITLE_ARG_MAX;
}

function textInput(raw: string | undefined, kind: TerminalInputKind = 'text'): Pick<ToolView, 'input' | 'inputKind'> {
  if (!raw?.trim()) return {};
  const input = marked(prepare(raw, INPUT_MAX, Infinity, false));
  return input ? { input, inputKind: kind } : {};
}

/** JSON indentado dos argumentos, sem as chaves já mostradas no título; nada se não sobrar nada. */
function jsonInput(input: Rec, omit: readonly string[] = [], cwd?: string): Pick<ToolView, 'input' | 'inputKind'> {
  const restObj: Rec = {};
  let n = 0;
  for (const [k, v] of Object.entries(input)) {
    if (omit.includes(k) || v === undefined || v === null || v === '') continue;
    restObj[k] = k === 'path' && typeof v === 'string' ? relPath(v, cwd) : v;
    n++;
  }
  if (!n) return {};
  let json: string;
  try {
    json = JSON.stringify(restObj, null, 2);
  } catch {
    return {};
  }
  return textInput(json, 'json');
}

/** Prefixa cada linha ("- " / "+ ") até `budget` caracteres; o corte vira uma linha "<prefixo>…". */
function prefixLines(text: string, prefix: string, budget: number, sourceCut: boolean): string {
  const src = text.replace(/\n$/, '');
  const out: string[] = [];
  let used = 0;
  let start = 0;
  for (;;) {
    const nl = src.indexOf('\n', start);
    const line = `${prefix}${src.slice(start, nl === -1 ? src.length : nl)}`;
    if (used + line.length > budget) {
      // Linha que não cabe (ex.: conteúdo minificado): mostra o começo dela.
      const room = Math.floor(budget - used);
      out.push(room > prefix.length + 20 ? `${line.slice(0, room).trimEnd()}…` : `${prefix}…`);
      return out.join('\n');
    }
    out.push(line);
    used += line.length + 1;
    if (nl === -1) break;
    start = nl + 1;
  }
  if (sourceCut) out.push(`${prefix}…`);
  return out.join('\n');
}

/** Linhas "- antiga" / "+ nova" (mascaradas antes de qualquer corte). */
function diffText(oldRaw: string, newRaw: string, budget = INPUT_MAX): string {
  const o = oldRaw ? safeText(oldRaw, budget * 2, false) : { text: '', cut: false };
  const n = newRaw ? safeText(newRaw, budget * 2, false) : { text: '', cut: false };
  const newCost = Math.min(budget, Math.ceil(n.text.length * 1.1) + 8);
  const oldPart = o.text ? prefixLines(o.text, '- ', n.text ? Math.max(budget / 2, budget - newCost) : budget, o.cut) : '';
  const newPart = n.text ? prefixLines(n.text, '+ ', Math.max(budget / 4, budget - oldPart.length), n.cut) : '';
  return [oldPart, newPart].filter(Boolean).join('\n');
}

function diffInput(oldRaw: string, newRaw: string): Pick<ToolView, 'input' | 'inputKind'> {
  const text = diffText(oldRaw, newRaw);
  return text ? { input: text, inputKind: 'diff' } : {};
}

const TODO_MARK: Record<string, string> = { completed: '☒', in_progress: '◐', pending: '☐' };
const TASK_STATUS: Record<string, string> = { completed: tr('concluída'), in_progress: tr('em andamento'), pending: 'pendente', deleted: 'removida' };

function todoList(raw: unknown): { list: string; done: number; total: number } {
  const items = Array.isArray(raw) ? raw.map(rec).filter((t): t is Rec => !!t) : [];
  const lines = items.map((t) => `${TODO_MARK[String(t.status)] ?? '☐'} ${str(t.content) ?? str(t.subject) ?? str(t.title) ?? tr('(sem título)')}`);
  return { list: lines.join('\n'), done: items.filter((t) => t.status === 'completed').length, total: items.length };
}

function questionsText(raw: unknown): string {
  const qs = Array.isArray(raw) ? raw.map(rec).filter((q): q is Rec => !!q) : [];
  return qs
    .map((q) => {
      const opts = Array.isArray(q.options) ? q.options.map(rec).filter((o): o is Rec => !!o) : [];
      return [str(q.question) ?? '', ...opts.map((o) => `  - ${str(o.label) ?? ''}${str(o.description) ? `: ${o.description}` : ''}`)].join('\n');
    })
    .join('\n\n');
}

/**
 * Título e argumentos de uma chamada de ferramenta, no estilo do Claude Code: "Bash(npm test)".
 * Também usado pelos pedidos de permissão (server/permissions/).
 */
export function toolView(name: string, input: Rec, cwd?: string): ToolView {
  const s = (k: string) => str(input[k]);
  const path = s('file_path') ?? s('notebook_path') ?? s('path');
  const rel = path ? relPath(path, cwd) : undefined;
  switch (name) {
    case 'Bash':
      return { title: titled('Bash', s('command')), ...textInput(s('command'), 'command') };
    case 'Monitor':
      return { title: titled('Monitor', s('description') ?? s('command')), ...textInput(s('command'), 'command') };
    case 'Read':
    case 'LS':
      return { title: titled(name, rel), ...jsonInput(input, ['file_path', 'path'], cwd) };
    case 'Edit':
      return { title: titled('Edit', rel), ...diffInput(typeof input.old_string === 'string' ? input.old_string : '', typeof input.new_string === 'string' ? input.new_string : '') };
    case 'MultiEdit': {
      const edits = Array.isArray(input.edits) ? input.edits.map(rec).filter((e): e is Rec => !!e) : [];
      const per = Math.max(200, Math.floor(INPUT_MAX / Math.max(1, edits.length)));
      const text = edits
        .slice(0, 12)
        .map((e) => diffText(typeof e.old_string === 'string' ? e.old_string : '', typeof e.new_string === 'string' ? e.new_string : '', per))
        .filter(Boolean)
        .join('\n@@\n');
      return { title: titled('MultiEdit', rel), ...(text ? { input: marked(clip(text, INPUT_MAX)), inputKind: 'diff' as const } : {}) };
    }
    case 'Write':
      return { title: titled('Write', rel), ...diffInput('', typeof input.content === 'string' ? input.content : '') };
    case 'NotebookEdit':
      return { title: titled('NotebookEdit', rel), ...diffInput('', typeof input.new_source === 'string' ? input.new_source : '') };
    case 'Grep':
    case 'Glob':
      return { title: titled(name, s('pattern')), ...jsonInput(input, ['pattern'], cwd) };
    case 'WebFetch':
      return { title: titled('WebFetch', s('url')), ...textInput(s('prompt')) };
    case 'WebSearch':
      return { title: titled('WebSearch', s('query')), ...jsonInput(input, ['query'], cwd) };
    case 'Agent':
    case 'Task': {
      const type = s('subagent_type');
      const desc = s('description');
      const arg = type && desc ? `${type}: ${desc}` : (desc ?? type);
      return { title: titled(name, arg), ...textInput(s('prompt')) };
    }
    case 'TodoWrite': {
      const t = todoList(input.todos);
      return { title: t.total ? tr('TodoWrite({0}/{1} concluídas)', [t.done, t.total]) : 'TodoWrite', ...textInput(t.list) };
    }
    case 'TaskCreate':
      return { title: titled('TaskCreate', s('subject')), ...textInput(s('description')) };
    case 'TaskUpdate': {
      const id = s('taskId') ?? (typeof input.taskId === 'number' ? String(input.taskId) : undefined);
      const st = s('status');
      const arg = id ? `#${id}${st ? ` → ${TASK_STATUS[st] ?? st}` : ''}` : st;
      return { title: titled('TaskUpdate', arg), ...jsonInput(input, ['taskId', 'status'], cwd) };
    }
    case 'Skill':
      return { title: titled('Skill', s('skill') ?? s('command')), ...textInput(s('args')) };
    case 'SendMessage':
      return { title: titled('SendMessage', s('to')), ...textInput(s('message') ?? s('content')) };
    case 'AskUserQuestion': {
      const first = Array.isArray(input.questions) ? str(rec(input.questions[0])?.question) : undefined;
      return { title: titled('AskUserQuestion', first), ...textInput(questionsText(input.questions)) };
    }
    case 'ExitPlanMode':
      return { title: 'ExitPlanMode', ...textInput(s('plan')) };
    case 'SubagentHandback':
    case 'StructuredOutput':
      return { title: name, ...(s('message') ? textInput(s('message')) : jsonInput(input, [], cwd)) };
    default:
      break;
  }
  if (name.startsWith('mcp__')) {
    const [, server = '', ...rest] = name.split('__');
    const srv = server.replace(/^claude_ai_/, '').replace(/_/g, ' ');
    return { title: `${srv} - ${rest.join('__') || '?'} (MCP)`, ...jsonInput(input, [], cwd) };
  }
  // Padrão: Nome(primeiro argumento de texto) + os demais argumentos em JSON.
  const first = Object.entries(input).find(([, v]) => typeof v === 'string' && v.trim()) as [string, string] | undefined;
  return { title: titled(name, first?.[1]), ...jsonInput(input, first && fitsTitle(first[1]) ? [first[0]] : [], cwd) };
}

/** Texto de um tool_result: string ou blocos (texto; imagem → "[imagem]"; referência de ferramenta → nome). */
function resultText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  const parts: string[] = [];
  for (const raw of content) {
    const b = rec(raw);
    if (!b) continue;
    if (b.type === 'text' && typeof b.text === 'string') parts.push(b.text);
    else if (b.type === 'image') parts.push(tr('[imagem]'));
    else if (b.type === 'document') parts.push('[documento]');
    else if (b.type === 'tool_reference' && typeof b.tool_name === 'string') parts.push(b.tool_name);
  }
  return parts.join('\n');
}

// ------------------------------------------------------------------ parser

const INTERRUPTED = /^\[Request interrupted by user/;
const REJECTED = /doesn't want to proceed|tool use was rejected|user rejected/i;
const NO_RESPONSE = /^No response requested\.?$/;
const OUTPUT_TAGS = ['local-command-stdout', 'local-command-stderr', 'command-stdout', 'command-stderr'] as const;

interface Ctx {
  j: Rec;
  at: number;
  uuid: string;
  cwd?: string;
}

class Parser implements TerminalParser {
  private out: TerminalEntry[] = [];
  private lastAt?: number;
  private seq = 0;
  private readonly seen = new Set<string>();
  /** Blocos de texto/thinking já vistos por mensagem (uma mensagem repetida não duplica entradas). */
  private readonly msgBlocks = new Map<string, Set<string>>();
  /** Último comando de barra (para rotular a saída que vem na linha seguinte). */
  private lastCommand?: string;
  /**
   * Transcript de um fork: começa com 'fork-context-ref', a CÓPIA da chamada Agent do pai e o resultado
   * dela junto com a instrução do fork (depois do bloco <fork-boilerplate>). A cópia não é do fork.
   */
  private fork?: 'expect-spawn' | 'expect-result';
  private inheritedSpawn?: string;

  push(line: string): TerminalEntry[] {
    this.out = [];
    try {
      this.line(line);
    } catch {
      // Linha estranha demais: fica o que já tiver saído dela; a leitura segue.
    }
    return this.out;
  }

  private emit(e: TerminalEntry): void {
    if (this.seen.has(e.id)) return;
    this.seen.add(e.id);
    if (this.seen.size > SEEN_MAX) this.seen.delete(this.seen.values().next().value as string);
    this.out.push(e);
  }

  private line(raw: string): void {
    if (raw.length < 2) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }
    const j = rec(parsed);
    if (!j) return;
    const ts = toMs(j.timestamp) ?? toMs(rec(j.attachment)?.timestamp);
    if (ts !== undefined) this.lastAt = ts;
    const c: Ctx = { j, at: ts ?? this.lastAt ?? Date.now(), uuid: str(j.uuid) ?? `x${++this.seq}`, cwd: str(j.cwd) };
    switch (j.type) {
      case 'user':
        return this.user(c);
      case 'assistant':
        return this.assistant(c);
      case 'system':
        return this.system(c);
      case 'attachment':
        return this.attachment(c);
      case 'fork-context-ref':
        this.fork = 'expect-spawn';
        return;
      default:
        // summary, file-history-snapshot, queue-operation, custom-title, progress...
        return;
    }
  }

  // ---------------------------------------------------------------- entradas

  private userEntry(c: Ctx, raw: string): void {
    const text = marked(prepare(raw, TEXT_MAX));
    if (text) this.emit({ kind: 'user', id: `${c.uuid}:u`, at: c.at, text });
  }

  /** `text` deve vir numa linha só (oneLine) ou ser fixo; a máscara aqui é a última garantia. */
  private sys(c: Ctx, text: string, o: { level?: Level; detail?: string; suffix?: string } = {}): void {
    if (!text) return;
    const e: SystemEntry = { kind: 'system', id: `${c.uuid}${o.suffix ?? ':s'}`, at: c.at, text: maskSecrets(text), level: o.level ?? 'info' };
    if (o.detail?.trim()) {
      const detail = marked(prepare(o.detail, DETAIL_MAX));
      if (detail) e.detail = detail;
    }
    this.emit(e);
  }

  /** Conteúdo livre de uma linha system: primeira linha no texto (com prefixo opcional), o resto no detalhe. */
  private sysContent(c: Ctx, content: string, level: Level, label?: string, suffix?: string): void {
    if (!content.trim()) return;
    const { line, detail } = lineAndDetail(content, label ? 160 : SYSTEM_TEXT_MAX);
    this.sys(c, label ? `${label}: ${line}` : line, { level, detail, suffix });
  }

  // ---------------------------------------------------------------- user

  private user(c: Ctx): void {
    const j = c.j;
    if (j.isMeta === true) return;
    const content = rec(j.message)?.content;
    if (j.isCompactSummary === true) {
      const text = typeof content === 'string' ? content : resultText(content);
      this.sys(c, tr('Resumo da conversa compactada'), { detail: text });
      return;
    }
    if (typeof content === 'string') return this.userText(c, content);
    if (!Array.isArray(content)) return;
    const texts: string[] = [];
    let images = 0;
    let results = 0;
    let forkResult = false;
    for (const raw of content) {
      const b = rec(raw);
      if (!b) continue;
      if (b.type === 'tool_result') {
        results++;
        if (this.fork === 'expect-result' && str(b.tool_use_id) === this.inheritedSpawn) forkResult = true;
        else this.toolResult(c, b);
      } else if (b.type === 'text' && typeof b.text === 'string') texts.push(b.text);
      else if (b.type === 'image') images++;
    }
    if (forkResult) {
      // Resultado da chamada herdada ("Fork started…"): a instrução do fork vem no texto. É o prompt dele.
      this.fork = undefined;
      const directive = forkDirective(texts.join('\n'));
      if (directive) this.userEntry(c, directive);
      return;
    }
    // Imagem ao lado de um tool_result pertence ao resultado; sozinha (ou com texto), é do prompt.
    if (texts.length || (images && !results)) this.userText(c, texts.join('\n'), results ? 0 : images);
  }

  private userText(c: Ctx, raw: string, images = 0): void {
    const text = (raw.includes('<system-reminder>') ? raw.replace(REMINDER, '') : raw).trim();
    const pics = images ? Array.from({ length: Math.min(images, 10) }, () => tr('[imagem]')).join(' ') : '';
    if (!text) {
      if (pics) this.userEntry(c, pics);
      return;
    }
    if (text.startsWith('<task-notification>')) return this.notification(c, text);
    if (INTERRUPTED.test(text)) return this.sys(c, tr('Interrompido pelo usuário'), { level: 'warn' });
    if (text.startsWith('Caveat:')) return;
    const tag = /^<([a-z][\w-]*)/.exec(text)?.[1];
    switch (tag) {
      case 'command-name':
      case 'command-message':
      case 'command-args': {
        const msg = inner(text, 'command-message')?.trim();
        const name = inner(text, 'command-name')?.trim() || (msg ? `/${msg}` : undefined);
        if (!name) return;
        const cmd = name.startsWith('/') ? name : `/${name}`;
        this.lastCommand = cmd;
        this.userEntry(c, `${cmd} ${inner(text, 'command-args')?.trim() ?? ''}`.trim());
        return;
      }
      case 'local-command-stdout':
      case 'local-command-stderr':
      case 'command-stdout':
      case 'command-stderr': {
        const out = OUTPUT_TAGS.map((t) => inner(text, t)?.trim())
          .filter(Boolean)
          .join('\n');
        if (out) this.sys(c, this.lastCommand ? tr('Saída de {0}', [this.lastCommand]) : tr('Saída do comando'), { detail: out });
        return;
      }
      case 'bash-input': {
        // Modo bash do usuário ("! comando"): a saída vem na linha seguinte.
        const cmd = inner(text, 'bash-input')?.trim();
        if (cmd) this.userEntry(c, `! ${cmd}`);
        return;
      }
      case 'bash-stdout':
      case 'bash-stderr': {
        const out = [inner(text, 'bash-stdout'), inner(text, 'bash-stderr')]
          .map((x) => x?.trim())
          .filter(Boolean)
          .join('\n');
        this.sys(c, tr('Saída do comando'), { detail: out || tr('(sem saída)') });
        return;
      }
      case 'scheduled-task': {
        const body = text.replace(/^<scheduled-task\b[^>]*>/, '').replace(/<\/scheduled-task>\s*$/, '');
        if (body.trim()) this.userEntry(c, body);
        return;
      }
      case 'fork-boilerplate': {
        const directive = forkDirective(text);
        if (directive) this.userEntry(c, directive);
        return;
      }
      case 'user-memory-input': {
        const memory = inner(text, 'user-memory-input')?.trim();
        if (memory) this.userEntry(c, `# ${memory}`);
        return;
      }
      case 'local-command-caveat':
      case 'user-prompt-submit-hook':
        return;
      default:
        break;
    }
    // Imagens coladas já aparecem no texto como "[Image #1]"; sem essa marca, o marcador vai no fim.
    this.userEntry(c, pics && !/\[Image\b/.test(text) ? `${text}\n${pics}` : text);
  }

  private notification(c: Ctx, text: string): void {
    const n = parseTaskNotification(text);
    const status = n.status?.toLowerCase();
    const result = inner(text, 'result')?.trim();
    const event = inner(text, 'event')?.trim();
    let label = tr('Notificação de tarefa em segundo plano');
    let level: Level = 'info';
    if (status === 'completed') label = tr('Tarefa em segundo plano concluída');
    else if (status === 'failed' || status === 'error') {
      label = tr('Tarefa em segundo plano falhou');
      level = 'warn';
    } else if (status === 'killed' || status === 'stopped' || status === 'cancelled') {
      label = tr('Tarefa em segundo plano interrompida');
      level = 'warn';
    } else if (event) label = tr('Evento de tarefa em segundo plano');
    const summary = n.summary ? oneLine(n.summary, 160) : '';
    const detail = [summary.endsWith('…') ? n.summary : undefined, event, result].filter(Boolean).join('\n\n');
    this.sys(c, summary ? `${label}: ${summary}` : label, { level, detail });
  }

  private toolResult(c: Ctx, b: Rec): void {
    const id = str(b.tool_use_id);
    if (!id) return;
    const error = b.is_error === true;
    let raw = resultText(b.content);
    const wrapped = /^\s*<tool_use_error>/.test(raw) ? inner(raw, 'tool_use_error') : undefined;
    if (wrapped !== undefined) raw = wrapped;
    if (error && REJECTED.test(raw.slice(0, 300))) {
      const feedback = /the user said:\s*([\s\S]*)$/i.exec(raw)?.[1]?.trim();
      raw = feedback ? tr('Recusado pelo usuário: {0}', [feedback]) : tr('Recusado pelo usuário');
    }
    const p = prepare(raw, RESULT_MAX, RESULT_MAX_LINES);
    const e: ResultEntry = { kind: 'result', id: `${id}:r`, at: c.at, toolUseId: id, text: p.text || tr('(sem saída)') };
    if (error) e.error = true;
    if (p.truncated) e.truncated = true;
    this.emit(e);
  }

  // ---------------------------------------------------------------- assistant

  /** A mensagem já trouxe este bloco (linhas repetidas ou cumulativas da mesma mensagem). */
  private repeated(msgId: string, key: string): boolean {
    let set = this.msgBlocks.get(msgId);
    if (!set) {
      this.msgBlocks.set(msgId, (set = new Set()));
      if (this.msgBlocks.size > MSG_BLOCKS_MAX) this.msgBlocks.delete(this.msgBlocks.keys().next().value as string);
    }
    if (set.has(key)) return true;
    set.add(key);
    return false;
  }

  private assistant(c: Ctx): void {
    const m = rec(c.j.message);
    if (!m) return;
    const blocks: unknown[] = Array.isArray(m.content) ? m.content : typeof m.content === 'string' ? [{ type: 'text', text: m.content }] : [];
    if (this.fork === 'expect-spawn') {
      const spawn = blocks.map(rec).find((b) => b?.type === 'tool_use' && (b.name === 'Agent' || b.name === 'Task'));
      const id = str(spawn?.id);
      this.fork = id ? 'expect-result' : undefined;
      if (id) {
        this.inheritedSpawn = id;
        return;
      }
    }
    const synthetic = m.model === '<synthetic>';
    if (c.j.isApiErrorMessage === true || (synthetic && str(c.j.error))) {
      const text = blocks.map((b) => rec(b)?.text).filter((t): t is string => typeof t === 'string').join('\n');
      return this.sysContent(c, text || tr('Erro da API'), 'error');
    }
    const msgId = str(m.id) ?? c.uuid;
    blocks.forEach((raw, i) => {
      const b = rec(raw);
      if (!b) return;
      const id = `${c.uuid}:${i}`;
      switch (b.type) {
        case 'text': {
          const t = typeof b.text === 'string' ? b.text : '';
          if (!t.trim() || this.repeated(msgId, `t${t.length}:${t.slice(0, 64)}`)) return;
          if (synthetic) {
            if (!NO_RESPONSE.test(t.trim())) this.sysContent(c, t, 'info', undefined, `:${i}`);
            return;
          }
          const text = marked(prepare(t, TEXT_MAX));
          if (text) this.emit({ kind: 'assistant', id, at: c.at, text });
          return;
        }
        case 'thinking':
        case 'redacted_thinking': {
          const t = typeof b.thinking === 'string' ? b.thinking : '';
          const sig = typeof b.signature === 'string' ? b.signature : typeof b.data === 'string' ? b.data : '';
          if (this.repeated(msgId, `k${t.length}:${t.slice(0, 64)}:${sig.length}:${sig.slice(-24)}`)) return;
          const e: ThinkingEntry = { kind: 'thinking', id, at: c.at };
          if (b.type === 'thinking' && t.trim()) {
            const text = marked(prepare(t, THINKING_MAX));
            if (text) e.text = text;
          }
          this.emit(e);
          return;
        }
        case 'tool_use':
        case 'server_tool_use': {
          const name = str(b.name) ?? 'ferramenta';
          const view = toolView(name, rec(b.input) ?? {}, c.cwd);
          const e: ToolEntry = { kind: 'tool', id: str(b.id) ?? id, at: c.at, tool: name, title: maskSecrets(view.title) };
          if (view.input) {
            e.input = view.input;
            e.inputKind = view.inputKind;
          }
          this.emit(e);
          return;
        }
        default:
          return;
      }
    });
  }

  // ---------------------------------------------------------------- system e attachment

  private system(c: Ctx): void {
    const j = c.j;
    const content = typeof j.content === 'string' ? j.content : '';
    switch (j.subtype) {
      case 'compact_boundary': {
        const trigger = rec(j.compactMetadata)?.trigger;
        return this.sys(c, trigger === 'manual' ? tr('Conversa compactada (/compact)') : trigger === 'auto' ? tr('Conversa compactada automaticamente') : tr('Conversa compactada'));
      }
      case 'api_error': {
        // Uma linha por tentativa: só a primeira de cada sequência vira entrada.
        const attempt = typeof j.retryAttempt === 'number' ? j.retryAttempt : undefined;
        if (attempt !== undefined && attempt > 1) return;
        const err = rec(j.error);
        const why = str(err?.formatted) ?? str(err?.message) ?? str(j.error);
        const max = typeof j.maxRetries === 'number' ? j.maxRetries : undefined;
        const retry = attempt !== undefined ? tr(' — tentando de novo{0}', [max ? tr(' (até {0} vezes)', [max]) : '']) : '';
        return this.sys(c, tr('Erro da API{0}{1}', [why ? `: ${oneLine(why, 140)}` : '', retry]), { level: 'error' });
      }
      case 'local_command':
        return this.userText(c, content);
      case 'turn_duration':
        if (typeof j.durationMs === 'number' && j.durationMs >= 0) this.sys(c, tr('Turno concluído em {0}', [formatDuration(j.durationMs)]));
        return;
      case 'informational':
        return this.sysContent(c, content, j.level === 'warning' ? 'warn' : j.level === 'error' ? 'error' : 'info');
      case 'model_refusal_fallback':
        return this.sysContent(c, content, 'warn');
      case 'away_summary':
        return this.sysContent(c, content, 'info', tr('Recapitulação'));
      default:
        // stop_hook_summary, bridge_status (traz o link da sessão remota)... só erros passam.
        if (j.level === 'error') this.sysContent(c, content, 'error');
        return;
    }
  }

  private attachment(c: Ctx): void {
    const a = rec(c.j.attachment);
    // Só os comandos enfileirados interessam; os de outros agentes (peer/coordinator) são meta.
    if (!a || a.type !== 'queued_command' || a.isMeta === true || c.j.isMeta === true) return;
    let text = '';
    let images = 0;
    if (typeof a.prompt === 'string') text = a.prompt;
    else if (Array.isArray(a.prompt)) {
      const texts: string[] = [];
      for (const raw of a.prompt) {
        const b = rec(raw);
        if (b?.type === 'text' && typeof b.text === 'string') texts.push(b.text);
        else if (b?.type === 'image') images++;
      }
      text = texts.join('\n');
    }
    if (text.trimStart().startsWith('<task-notification>')) return this.notification(c, text.trim());
    if (a.commandMode !== undefined && a.commandMode !== 'prompt') return;
    this.userText(c, text, images);
  }
}

/** Parser com estado: uma instância por leitura de arquivo, alimentada linha a linha, na ordem do arquivo. */
export function createTerminalParser(): TerminalParser {
  return new Parser();
}
