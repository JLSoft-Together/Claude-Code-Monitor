// Entregas: o fim de cada pedido em que um agente trabalhou, do jeito que um BA receberia. Lidas dos transcripts das
// sessões recentes (o histórico do terminal): um pedido começa num prompt seu e termina no prompt seguinte (ou no fim
// do arquivo, se o agente não está mais trabalhando). Vira entrega quando o agente usou ferramentas e respondeu.
// - manchete: a primeira frase da resposta; resumo: o último parágrafo em texto corrido (o "em linguagem simples");
// - anexos: os arquivos do SendUserFile (com a legenda) e os links para imagem/PDF/vídeo/página na resposta, mais as
//   duas últimas telas capturadas no pedido (as imagens que já vêm dentro do transcript).
// Cada transcript é relido só quando muda (mtime/tamanho). Os anexos ganham ids opacos: o navegador nunca vê caminhos.
import { createHash } from 'node:crypto';
import { statSync } from 'node:fs';
import { isAbsolute, join, normalize } from 'node:path';
import { tr } from '../../shared/i18n';
import type { DeliveryAttachment, DeliveryInfo, Provider, RecentSession, TerminalEntry } from '../../shared/types';
import type { TerminalParser } from '../sources/terminal';
import { FileTail } from '../sources/tail';
import { fileType, pathProblem } from './files';

/** Quanto do fim de cada transcript entra (os pedidos mais antigos de uma sessão longa ficam de fora). */
export const TAIL_BYTES = 6 * 1024 * 1024;
export const MAX_SESSIONS = 30;
export const MAX_DELIVERIES = 60;
const CAPTURES_PER_DELIVERY = 2;
/** Só os últimos pedidos de cada conversa guardam as telas capturadas (base64): o resto da memória fica de fora. */
const TURNS_WITH_CAPTURES = 4;
const HEADLINE_MAX = 180;
const SUMMARY_MAX = 600;
const REQUEST_MAX = 240;
const MIN_TEXT = 30;
const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'apply_patch']);
/** Caminhos de arquivo de ver citados na resposta: em links markdown ou soltos. */
const LINK_RE = /\]\(\s*<?([^)\s>]+?\.(?:png|jpe?g|gif|webp|svg|pdf|mp4|mov|webm|html?))(?::\d+)?>?\s*\)/gi;
const BARE_RE = /(?:^|[\s(`"'])(\/[^\s`"'()<>]+?\.(?:png|jpe?g|gif|webp|svg|pdf|mp4|mov|webm|html?))(?=$|[\s`"'),.;:!?])/gim;

export interface SessionSource {
  path: string;
  createParser: () => TerminalParser;
}

export interface DeliveryIndexOptions {
  sessions: () => Promise<RecentSession[]>;
  resolve: (account: string, sessionId: string) => SessionSource | undefined;
  /** O agente está no meio de um pedido (o último pedido ainda não é entrega). */
  isBusy: (agentId: string) => boolean;
  agentName?: (agentId: string) => string | undefined;
}

export type StoredAttachment =
  | { kind: 'capture'; type: string; data: Buffer; name: string }
  | { kind: 'file'; path: string; name: string; type: string };

interface Turn {
  start: TerminalEntry & { kind: 'user' };
  tools: number;
  edited: Set<string>;
  text: string;
  textAt: number;
  files: Array<{ path: string; caption?: string }>;
  captures: Array<{ type: string; data: string }>;
  /** O transcript marca o motivo de parada (Claude Code): só vale entrega o texto que encerrou a vez (end_turn). */
  marksStop: boolean;
  ended: boolean;
}

interface Parsed {
  mtimeMs: number;
  size: number;
  /** Pedidos terminados (o último também, se o arquivo acabou depois dele). */
  turns: Turn[];
  /** O último pedido do arquivo (pode estar em andamento). */
  last?: Turn;
}

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec | undefined => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Rec) : undefined);

function stripMarkdown(s: string): string {
  return s
    .replace(/`{3}[\s\S]*?`{3}/g, ' ')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/(^|\s)[*_](\S[^*_]*?)[*_](?=\s|$|[.,;:!?])/g, '$1$2')
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+[.)])\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function cut(s: string, max: number): string {
  if (s.length <= max) return s;
  const head = s.slice(0, max - 1);
  const sp = head.lastIndexOf(' ');
  return `${(sp > max * 0.6 ? head.slice(0, sp) : head).replace(/[\s,;:.-]+$/, '')}…`;
}

function paragraphs(text: string): string[] {
  return text
    .replace(/`{3}[\s\S]*?`{3}/g, '\n\n')
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
}

const isProse = (p: string) => !/^(\||#|>|[-*+]\s|\d+[.)]\s|`{3})/.test(p) && !/^[A-Z_ ]+:\s/.test(p);

/** Primeira frase da resposta (a manchete), sem markdown. */
export function headlineOf(text: string): string {
  const first = paragraphs(text).find(isProse) ?? paragraphs(text)[0] ?? '';
  const plain = stripMarkdown(first);
  const m = /^(.+?[.!?])(\s|$)/.exec(plain);
  return cut(m ? m[1] : plain, HEADLINE_MAX);
}

/** Último parágrafo em texto corrido (o resumo em linguagem simples), se for diferente da manchete. */
export function summaryOf(text: string, headline: string): string | undefined {
  const paras = paragraphs(text).filter(isProse);
  const last = paras[paras.length - 1];
  if (!last || paras.length < 2) return undefined;
  const plain = stripMarkdown(last);
  if (plain.length < 60 || plain.startsWith(headline.replace(/…$/, ''))) return undefined;
  return cut(plain, SUMMARY_MAX);
}

/** Caminhos de arquivos de ver citados na resposta (absolutos, ou relativos à pasta do projeto). */
export function linkedFiles(text: string, project?: string): string[] {
  const out = new Set<string>();
  const add = (raw: string) => {
    let p = raw.trim();
    try {
      p = decodeURIComponent(p);
    } catch {
      // fica como veio
    }
    if (p.startsWith('file://')) p = p.slice(7);
    if (/^[a-z]+:/i.test(p)) return;
    if (!isAbsolute(p)) {
      if (!project) return;
      p = join(project, p);
    }
    p = normalize(p);
    if (!pathProblem(p)) out.add(p);
  };
  for (const m of text.matchAll(LINK_RE)) add(m[1]);
  for (const m of text.matchAll(BARE_RE)) add(m[1]);
  return [...out];
}

function newTurn(start: TerminalEntry & { kind: 'user' }): Turn {
  return { start, tools: 0, edited: new Set(), text: '', textAt: start.at, files: [], captures: [], marksStop: false, ended: false };
}

/** Imagens dentro de resultados de ferramenta (capturas de tela), em ordem. */
function capturesIn(line: string): Array<{ type: string; data: string }> {
  if (!line.includes('"image"')) return [];
  let d: Rec | undefined;
  try {
    d = rec(JSON.parse(line));
  } catch {
    return [];
  }
  const content = rec(d?.message)?.content;
  if (d?.type !== 'user' || !Array.isArray(content)) return [];
  const out: Array<{ type: string; data: string }> = [];
  const take = (b: unknown) => {
    const src = rec(rec(b)?.source);
    if (rec(b)?.type === 'image' && src?.type === 'base64' && typeof src.data === 'string' && typeof src.media_type === 'string' && /^image\/(png|jpeg|webp|gif)$/.test(src.media_type)) {
      out.push({ type: src.media_type, data: src.data });
    }
  };
  for (const b of content) {
    if (rec(b)?.type === 'tool_result' && Array.isArray(rec(b)?.content)) (rec(b)!.content as unknown[]).forEach(take);
  }
  return out;
}

/** Arquivos mandados com SendUserFile (caminho e legenda). */
function sentFilesIn(line: string): Array<{ path: string; caption?: string }> {
  if (!line.includes('"SendUserFile"')) return [];
  let d: Rec | undefined;
  try {
    d = rec(JSON.parse(line));
  } catch {
    return [];
  }
  const content = rec(d?.message)?.content;
  if (d?.type !== 'assistant' || !Array.isArray(content)) return [];
  const out: Array<{ path: string; caption?: string }> = [];
  for (const b of content) {
    const r = rec(b);
    if (r?.type !== 'tool_use' || r.name !== 'SendUserFile') continue;
    const input = rec(r.input);
    const caption = typeof input?.caption === 'string' && input.caption.trim() ? input.caption.trim() : undefined;
    for (const f of Array.isArray(input?.files) ? input.files : []) if (typeof f === 'string') out.push({ path: f, caption });
  }
  return out;
}

/** Motivo de parada de uma linha de resposta do Claude Code ('end_turn', 'tool_use'...), se houver. */
function stopReasonOf(line: string): string | null | undefined {
  if (!line.includes('"stop_reason"')) return undefined;
  const m = /"stop_reason"\s*:\s*(null|"([a-z_]+)")/.exec(line);
  return m ? (m[2] ?? null) : undefined;
}

/** Lê o fim de um transcript e separa os pedidos. */
export function parseTurns(lines: Iterable<string>, parser: TerminalParser): { turns: Turn[]; last?: Turn } {
  const turns: Turn[] = [];
  let cur: Turn | undefined;
  for (const line of lines) {
    for (const e of parser.push(line)) {
      if (e.kind === 'user') {
        if (cur) turns.push(cur);
        cur = newTurn(e);
      } else if (!cur) continue;
      else if (e.kind === 'assistant') {
        cur.text = e.text;
        cur.textAt = e.at;
        const stop = stopReasonOf(line);
        if (stop !== undefined && stop !== null) {
          cur.marksStop = true;
          cur.ended = stop === 'end_turn';
        }
      } else if (e.kind === 'tool') {
        cur.tools++;
        if (EDIT_TOOLS.has(e.tool)) cur.edited.add(e.title);
      }
    }
    if (!cur) continue;
    cur.files.push(...sentFilesIn(line));
    const caps = capturesIn(line);
    if (caps.length) cur.captures = [...cur.captures, ...caps].slice(-CAPTURES_PER_DELIVERY);
  }
  return { turns, last: cur };
}

const shortId = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 20);
const baseName = (p: string) => p.split(/[\\/]/).pop() || p;

export class DeliveryIndex {
  private readonly cache = new Map<string, Parsed>();
  private files = new Map<string, StoredAttachment>();

  constructor(private readonly opts: DeliveryIndexOptions) {}

  /** Anexo pelo id opaco (só os das entregas da última listagem). */
  attachment(id: string): StoredAttachment | undefined {
    return this.files.get(id);
  }

  async list(): Promise<DeliveryInfo[]> {
    const sessions = (await this.opts.sessions()).slice(0, MAX_SESSIONS);
    const out: DeliveryInfo[] = [];
    const files = new Map<string, StoredAttachment>();
    const seen = new Set<string>();
    for (const s of sessions) {
      const src = this.opts.resolve(s.account, s.sessionId);
      if (!src) continue;
      seen.add(src.path);
      const parsed = this.read(src);
      if (!parsed) continue;
      const busy = !!s.agentId && this.opts.isBusy(s.agentId);
      const turns = parsed.last && !busy ? [...parsed.turns, parsed.last] : parsed.turns;
      for (const t of turns) {
        const d = this.toDelivery(s, t, files);
        if (d) out.push(d);
      }
    }
    for (const path of this.cache.keys()) if (!seen.has(path)) this.cache.delete(path);
    this.files = files;
    return out.sort((a, b) => b.finishedAt - a.finishedAt).slice(0, MAX_DELIVERIES);
  }

  private read(src: SessionSource): Parsed | undefined {
    let st: { mtimeMs: number; size: number };
    try {
      st = statSync(src.path);
    } catch {
      return undefined;
    }
    const cached = this.cache.get(src.path);
    if (cached && cached.mtimeMs === st.mtimeMs && cached.size === st.size) return cached;
    const tail = new FileTail(src.path);
    try {
      tail.seekTail(TAIL_BYTES);
      const lines: string[] = [];
      for (let i = 0; i < 64; i++) {
        const r = tail.read();
        lines.push(...r.lines);
        if (!r.more) break;
      }
      const { turns, last } = parseTurns(lines, src.createParser());
      for (const t of turns.slice(0, Math.max(0, turns.length - (last ? TURNS_WITH_CAPTURES - 1 : TURNS_WITH_CAPTURES)))) t.captures = [];
      const parsed: Parsed = { mtimeMs: st.mtimeMs, size: st.size, turns, last };
      this.cache.set(src.path, parsed);
      return parsed;
    } catch {
      return undefined;
    }
  }

  private toDelivery(s: RecentSession, t: Turn, files: Map<string, StoredAttachment>): DeliveryInfo | undefined {
    const text = t.text.trim();
    if (!t.tools || text.length < MIN_TEXT || (t.marksStop && !t.ended)) return undefined;
    const id = `${s.account}:${s.sessionId}:${t.start.id}`;
    const attachments: DeliveryAttachment[] = [];
    const paths = new Map<string, string | undefined>();
    for (const f of t.files) if (!pathProblem(f.path) && !paths.has(f.path)) paths.set(f.path, f.caption);
    for (const p of linkedFiles(text, s.project)) if (!paths.has(p)) paths.set(p, undefined);
    for (const [path, caption] of paths) {
      const ft = fileType(path);
      if (!ft) continue;
      const aid = shortId(`${id}|${path}`);
      files.set(aid, { kind: 'file', path, name: baseName(path), type: ft.type });
      attachments.push({ id: aid, name: baseName(path), kind: ft.kind, ...(caption ? { caption } : {}) });
    }
    t.captures.forEach((c, i) => {
      const aid = shortId(`${id}|capture|${i}`);
      const ext = c.type.split('/')[1] === 'jpeg' ? 'jpg' : c.type.split('/')[1];
      const name = `tela-${i + 1}.${ext}`;
      files.set(aid, { kind: 'capture', type: c.type, data: Buffer.from(c.data, 'base64'), name });
      attachments.push({ id: aid, name, kind: 'image', caption: tr('Tela capturada pelo agente'), capture: true });
    });
    const headline = headlineOf(text);
    const summary = summaryOf(text, headline);
    const agentName = s.agentId ? this.opts.agentName?.(s.agentId) : undefined;
    const provider: Provider | undefined = s.provider;
    return {
      id,
      account: s.account,
      ...(provider && provider !== 'claude' ? { provider } : {}),
      sessionId: s.sessionId,
      ...(s.agentId ? { agentId: s.agentId } : {}),
      ...(agentName || s.title ? { agentName: agentName ?? s.title } : {}),
      ...(s.project ? { project: s.project } : {}),
      request: cut(stripMarkdown(t.start.text), REQUEST_MAX),
      headline,
      ...(summary ? { summary } : {}),
      text: text.slice(0, 40_000),
      startedAt: t.start.at,
      finishedAt: t.textAt,
      tools: t.tools,
      edited: t.edited.size,
      attachments,
    };
  }
}
