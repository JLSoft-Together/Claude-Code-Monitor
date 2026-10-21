// Terminal do Codex: converte as linhas do rollout em TerminalEntry (prompts, respostas, raciocínio resumido,
// comandos com a saída, mudanças de arquivo, chamadas MCP), com segredos mascarados e textos truncados pelas mesmas
// regras do terminal do Claude Code (sources/terminal.ts).
//
// No formato paginated a conversa sai dos `item_completed`; os `response_item` são o contexto mandado ao modelo (há
// mensagens injetadas) e ficam de fora. No legacy (threads antigos), o básico: user_message, agent_message,
// agent_reasoning e os pares function_call/function_call_output.
import type { TerminalEntry, TerminalInputKind } from '../../../shared/types';
import { formatDuration, maskSecrets } from '../../../shared/activity';
import { marked, oneLine, prepare, RESULT_MAX, RESULT_MAX_LINES, TEXT_MAX, THINKING_MAX, toolView, INPUT_MAX, type TerminalParser } from '../terminal';
import {
  commandText,
  contentText,
  deliveredMessage,
  fileChanges,
  mcpName,
  parseArguments,
  parseSessionMeta,
  patchFiles,
  pathFromUri,
  promptText,
  userMessagingText,
  type HistoryMode,
} from './rollout';
import { tr } from '../../../shared/i18n';

type Rec = Record<string, unknown>;
type ToolEntry = Extract<TerminalEntry, { kind: 'tool' }>;
type ResultEntry = Extract<TerminalEntry, { kind: 'result' }>;
type SystemEntry = Extract<TerminalEntry, { kind: 'system' }>;

const SEEN_MAX = 20_000;
const SHELL_TOOLS = /^(shell|shell_command|local_shell|exec_command|container\.exec)$/;

function rec(v: unknown): Rec | undefined {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Rec) : undefined;
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v : undefined;
}

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

function toMs(v: unknown): number | undefined {
  if (typeof v !== 'string') return undefined;
  const t = Date.parse(v);
  return Number.isNaN(t) ? undefined : t;
}

/** Texto de um resultado MCP ({content: [{type: 'text', text}...]}) ou de uma saída de função. */
function resultText(raw: unknown): string {
  if (typeof raw === 'string') {
    try {
      const j = rec(JSON.parse(raw));
      if (j && typeof j.output === 'string') return j.output;
    } catch {
      // texto puro
    }
    return raw;
  }
  const o = rec(raw);
  if (o) {
    if (Array.isArray(o.content)) return contentText(o.content).text || (o.structuredContent ? JSON.stringify(o.structuredContent) : '');
    if (typeof o.output === 'string') return o.output;
    if (typeof o.Ok === 'object' || typeof o.Err === 'string') return resultText(o.Ok ?? o.Err);
  }
  if (Array.isArray(raw)) return contentText(raw).text;
  return '';
}

class CodexTerminalParser implements TerminalParser {
  private out: TerminalEntry[] = [];
  private readonly seen = new Set<string>();
  private mode?: HistoryMode;
  private cwd?: string;
  private lastAt?: number;
  private seq = 0;
  /** Chamadas do legacy (call_id → nome), para rotular o resultado. */
  private readonly calls = new Map<string, string>();

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
    const p = rec(j?.payload);
    if (!j || !p) return;
    const ts = toMs(j.timestamp);
    if (ts !== undefined) this.lastAt = ts;
    const at = ts ?? this.lastAt ?? Date.now();
    const key = typeof j.ordinal === 'number' ? `o${j.ordinal}` : `l${++this.seq}`;
    switch (j.type) {
      case 'session_meta': {
        const meta = parseSessionMeta(p);
        this.mode = meta.historyMode;
        this.cwd = meta.cwd;
        return;
      }
      case 'turn_context':
        this.cwd ??= str(p.cwd);
        return;
      case 'event_msg':
        return this.event(p, at, key);
      case 'response_item': {
        // Resposta entregue no code mode do app: vale em qualquer formato (o id é o da chamada que a mandou).
        const delivered = deliveredMessage(j);
        if (delivered) return this.assistant(delivered.id ?? key, at, delivered.text);
        if (this.mode === 'legacy') this.responseItem(p, at, key);
        return;
      }
      case 'compacted':
        if (this.mode === 'legacy') this.sys(key, at, tr('Conversa compactada'));
        return;
      default:
        return;
    }
  }

  // ---------------------------------------------------------------- entradas

  private user(id: string, at: number, raw: string, images = 0): void {
    const clean = promptText(raw);
    const pics = images ? Array.from({ length: Math.min(images, 10) }, () => tr('[imagem]')).join(' ') : '';
    const text = marked(prepare([clean, pics].filter(Boolean).join('\n'), TEXT_MAX));
    if (text) this.emit({ kind: 'user', id: `${id}:u`, at, text });
  }

  private assistant(id: string, at: number, raw: string): void {
    const text = marked(prepare(raw, TEXT_MAX));
    if (text) this.emit({ kind: 'assistant', id, at, text });
  }

  private thinking(id: string, at: number, raw: string): void {
    const text = raw.trim() ? marked(prepare(raw, THINKING_MAX)) : '';
    this.emit(text ? { kind: 'thinking', id, at, text } : { kind: 'thinking', id, at });
  }

  private sys(id: string, at: number, text: string, o: { level?: SystemEntry['level']; detail?: string } = {}): void {
    const e: SystemEntry = { kind: 'system', id: `${id}:s`, at, text: maskSecrets(text), level: o.level ?? 'info' };
    if (o.detail?.trim()) {
      const detail = marked(prepare(o.detail, 4_000));
      if (detail) e.detail = detail;
    }
    this.emit(e);
  }

  private tool(id: string, at: number, tool: string, view: { title: string; input?: string; inputKind?: TerminalInputKind }): void {
    const e: ToolEntry = { kind: 'tool', id, at, tool, title: maskSecrets(view.title) };
    if (view.input) {
      e.input = view.input;
      e.inputKind = view.inputKind;
    }
    this.emit(e);
  }

  private result(toolId: string, at: number, raw: string, error: boolean): void {
    const p = prepare(raw, RESULT_MAX, RESULT_MAX_LINES);
    const e: ResultEntry = { kind: 'result', id: `${toolId}:r`, at, toolUseId: toolId, text: p.text || tr('(sem saída)') };
    if (error) e.error = true;
    if (p.truncated) e.truncated = true;
    this.emit(e);
  }

  // ---------------------------------------------------------------- event_msg

  private event(p: Rec, at: number, key: string): void {
    switch (p.type) {
      case 'item_completed':
        return this.item(rec(p.item), at, key);
      case 'task_complete':
      case 'turn_complete': {
        const ms = num(p.duration_ms);
        const err = rec(p.error);
        if (err) this.sys(`${str(p.turn_id) ?? key}:err`, at, tr('Erro: {0}', [oneLine(str(err.message) ?? tr('desconhecido'), 160)]), { level: 'error' });
        if (ms !== undefined && ms >= 0) this.sys(`${str(p.turn_id) ?? key}:done`, at, tr('Turno concluído em {0}', [formatDuration(ms)]));
        return;
      }
      case 'turn_aborted':
        if (p.reason === 'interrupted' || p.reason === undefined) this.sys(`${str(p.turn_id) ?? key}:int`, at, tr('Interrompido pelo usuário'), { level: 'warn' });
        return;
      // ---- legacy
      case 'user_message':
        if (this.mode === 'paginated') return;
        this.mode ??= 'legacy';
        return this.user(key, at, str(p.message) ?? '', Array.isArray(p.images) ? p.images.length : 0);
      case 'agent_message':
        if (this.mode === 'paginated') return;
        this.mode ??= 'legacy';
        return this.assistant(key, at, str(p.message) ?? '');
      case 'agent_reasoning':
        if (this.mode === 'paginated') return;
        return this.thinking(key, at, str(p.text) ?? '');
      case 'exec_command_end':
        if (this.mode === 'paginated') return;
        return this.command(str(p.call_id) ?? key, at, p.command, str(p.aggregated_output) ?? str(p.formatted_output) ?? str(p.stdout) ?? '', num(p.exit_code), str(p.status));
      case 'context_compacted':
        if (this.mode === 'paginated') return;
        return this.sys(key, at, tr('Conversa compactada'));
      default:
        return;
    }
  }

  private item(item: Rec | undefined, at: number, key: string): void {
    if (!item) return;
    const id = str(item.id) ?? key;
    switch (item.type) {
      case 'UserMessage': {
        this.mode ??= 'paginated';
        const { text, images } = contentText(item.content);
        return this.user(id, at, text, images);
      }
      case 'AgentMessage':
        this.mode ??= 'paginated';
        return this.assistant(id, at, contentText(item.content).text);
      case 'Reasoning': {
        this.mode ??= 'paginated';
        const summary = Array.isArray(item.summary_text) ? item.summary_text.filter((s): s is string => typeof s === 'string').join('\n\n') : '';
        return this.thinking(id, at, summary);
      }
      case 'CommandExecution':
        this.mode ??= 'paginated';
        return this.command(id, at, item.command, str(item.aggregated_output) ?? '', num(item.exit_code), str(item.status));
      case 'FileChange':
        this.mode ??= 'paginated';
        return this.fileChange(id, at, item.changes, str(item.status));
      case 'McpToolCall': {
        this.mode ??= 'paginated';
        // Code mode: a mensagem para você é a resposta (mesmo id da entrega gravada como response_item).
        const said = userMessagingText(item.server, item.tool, item.arguments);
        if (said) return this.assistant(id, at, said);
        const name = mcpName(item.server, item.tool);
        this.tool(id, at, name, toolView(name, rec(item.arguments) ?? parseArguments(item.arguments), this.cwd));
        const error = str(rec(item.error)?.message);
        if (error || item.result !== undefined) this.result(id, at, error ?? resultText(item.result), !!error || item.status === 'failed');
        return;
      }
      case 'WebSearch':
        return this.tool(id, at, 'WebSearch', toolView('WebSearch', { query: str(item.query) ?? '' }, this.cwd));
      case 'ImageView':
        return this.tool(id, at, 'view_image', toolView('Read', { file_path: pathFromUri(item.path) ?? '' }, this.cwd));
      case 'ContextCompaction':
        return this.sys(id, at, tr('Conversa compactada'));
      case 'CollabAgentToolCall': {
        const tool = str(item.tool) ?? 'spawn_agent';
        return this.tool(id, at, tool, toolView(tool, str(item.prompt) ? { prompt: item.prompt } : {}, this.cwd));
      }
      case 'Plan':
        return this.assistant(id, at, str(item.text) ?? '');
      default:
        return;
    }
  }

  private command(id: string, at: number, cmd: unknown, output: string, exitCode: number | undefined, status: string | undefined): void {
    const command = commandText(cmd);
    this.tool(id, at, 'Bash', toolView('Bash', { command }, this.cwd));
    if (status === 'declined') return this.result(id, at, tr('Recusado pelo usuário'), true);
    const failed = status === 'failed' || (exitCode !== undefined && exitCode !== 0);
    const text = failed && exitCode !== undefined && exitCode !== 0 ? tr('Código de saída {0}\n{1}', [exitCode, output]) : output;
    this.result(id, at, text, failed);
  }

  private fileChange(id: string, at: number, raw: unknown, status: string | undefined): void {
    const changes = fileChanges(raw);
    const rel = (p: string) => toolView('Read', { file_path: p }, this.cwd).title.replace(/^Read\(|\)$/g, '');
    const names = changes.map((c) => rel(c.movePath ?? c.path));
    const arg = names.length > 2 ? tr('{0} e mais {1}', [names[0], names.length - 1]) : names.join(', ');
    const tool = changes.length && changes.every((c) => c.kind === 'add') ? 'Write' : 'Edit';
    const diff = changes
      .slice(0, 12)
      .map((c) => {
        const head = `*** ${c.kind === 'add' ? tr('Novo') : c.kind === 'delete' ? tr('Apagado') : tr('Alterado')}: ${rel(c.path)}${c.movePath ? ` → ${rel(c.movePath)}` : ''}`;
        const body = c.kind === 'update' ? c.text : c.text.replace(/\n$/, '').split('\n').map((l) => `${c.kind === 'add' ? '+' : '-'} ${l}`).join('\n');
        return `${head}\n${body}`;
      })
      .join('\n');
    const input = diff.trim() ? marked(prepare(diff, INPUT_MAX, Infinity, false)) : '';
    this.tool(id, at, tool, input ? { title: arg ? `${tool}(${arg})` : tool, input, inputKind: 'diff' } : { title: arg ? `${tool}(${arg})` : tool });
    if (status === 'declined') this.result(id, at, tr('Recusado pelo usuário'), true);
    else if (status === 'failed') this.result(id, at, tr('A mudança não foi aplicada'), true);
  }

  // ---------------------------------------------------------------- response_item (só no legacy)

  private responseItem(p: Rec, at: number, key: string): void {
    switch (p.type) {
      case 'function_call':
      case 'custom_tool_call': {
        const id = str(p.call_id) ?? key;
        const name = str(p.name) ?? 'ferramenta';
        this.calls.set(id, name);
        if (this.calls.size > 512) this.calls.delete(this.calls.keys().next().value as string);
        if (p.type === 'custom_tool_call' && name === 'apply_patch') {
          const patch = typeof p.input === 'string' ? p.input : '';
          const files = patchFiles(patch).map((f) => f.path);
          const title = files.length ? `Edit(${files.length > 2 ? tr('{0} e mais {1}', [files[0], files.length - 1]) : files.join(', ')})` : 'Edit';
          const input = patch.trim() ? marked(prepare(patch, INPUT_MAX, Infinity, false)) : '';
          return this.tool(id, at, 'Edit', input ? { title, input, inputKind: 'diff' } : { title });
        }
        const args = p.type === 'custom_tool_call' ? { input: p.input } : parseArguments(p.arguments);
        if (SHELL_TOOLS.test(name)) return this.tool(id, at, 'Bash', toolView('Bash', { command: commandText(args.cmd ?? args.command) }, this.cwd));
        return this.tool(id, at, name, toolView(name, args, this.cwd));
      }
      case 'local_shell_call': {
        const id = str(p.call_id) ?? key;
        this.calls.set(id, 'local_shell');
        return this.tool(id, at, 'Bash', toolView('Bash', { command: commandText(rec(p.action)?.command) }, this.cwd));
      }
      case 'function_call_output':
      case 'custom_tool_call_output': {
        const id = str(p.call_id);
        if (!id || !this.calls.has(id)) return;
        const text = resultText(p.output);
        const exit = /^Exit code:\s*(-?\d+)/m.exec(text.slice(0, 500))?.[1];
        return this.result(id, at, text, exit !== undefined && exit !== '0');
      }
      default:
        return;
    }
  }
}

/** Parser com estado do terminal do Codex: uma instância por leitura de arquivo, alimentada na ordem do arquivo. */
export function createCodexTerminalParser(): TerminalParser {
  return new CodexTerminalParser();
}
