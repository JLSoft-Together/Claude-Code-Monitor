// Interpretação dos rollouts do Codex (<CODEX_HOME>/sessions/AAAA/MM/DD/rollout-<hora>-<thread>.jsonl): cada linha
// atualiza um CodexState (modelo, título, números, turno aberto...) e pode gerar atividades (o que o personagem está
// fazendo) e sinais (turno começou/terminou, uso do plano, evento do GitHub).
//
// Formatos (o `history_mode` do session_meta; ausente = legacy):
// - paginated (padrão desde a 0.158): a conversa sai de `event_msg` `item_completed` (UserMessage, AgentMessage,
//   Reasoning, CommandExecution, FileChange, McpToolCall...). Os `response_item` são o contexto mandado ao modelo
//   (há mensagens injetadas): só as chamadas de ferramenta ainda sem resultado entram, como atividade em andamento;
// - legacy (threads antigos): `event_msg` user_message/agent_message/agent_reasoning e os pares `response_item`
//   function_call/function_call_output (o exec_command_end só existiu em versões antigas). Só o básico.
// Os ids das atividades usam o call_id (= id do item concluído = tool_use_id dos hooks): a chamada vista em
// andamento, o hook PreToolUse e o item concluído caem na mesma atividade.
// Tokens: o `total_token_usage` do token_count é cumulativo e o cache JÁ está dentro de input (não soma de novo).
// Tipos de linha desconhecidos são ignorados; uma linha inválida nunca derruba a leitura.
import { fileURLToPath } from 'node:url';
import { describePrompt, describeTool, maskSecrets, SPECIAL, truncate, type ActivityDescription } from '../../../shared/activity';
import type { GitHubEvent } from '../../../shared/github';
import type { AccountUsage, Activity, AgentStats, TaskItem, TaskStatus, UsageWindow } from '../../../shared/types';
import { detectGitHubResult, githubCallOf } from '../github';
import type { ParsedActivity } from '../transcript';
import { tr } from '../../../shared/i18n';

type Rec = Record<string, unknown>;

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

/** Id de thread do Codex (UUID). */
const THREAD_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isThreadId(v: unknown): v is string {
  return typeof v === 'string' && THREAD_ID.test(v);
}

// ------------------------------------------------------------------ session_meta

export type HistoryMode = 'paginated' | 'legacy';

/** O que o session_meta (1ª linha do rollout) diz sobre o thread. */
export interface RolloutMeta {
  threadId?: string;
  /** Thread raiz da sessão (num subagente, o do agente principal). */
  sessionId?: string;
  cwd?: string;
  cliVersion?: string;
  historyMode: HistoryMode;
  gitBranch?: string;
  startedAt?: number;
  /** Thread interno do Codex (guardian, review, compactação, memória...): fica fora do escritório. */
  internal: boolean;
  /** Subagente (spawn_agent): o thread pai e o que se sabe dele. */
  parentThreadId?: string;
  agentNickname?: string;
  agentRole?: string;
}

/** Chaves de um objeto em minúsculas e sem `_` (o Codex já gravou `subagent`, `subAgent`, `thread_spawn`...). */
function looseGet(o: Rec, name: string): unknown {
  const want = name.toLowerCase().replace(/_/g, '');
  for (const [k, v] of Object.entries(o)) if (k.toLowerCase().replace(/_/g, '') === want) return v;
  return undefined;
}

/**
 * `source` do session_meta: "cli", "vscode", "exec", "mcp", {"custom": ...}, {"internal": "guardian"},
 * {"subagent": "review" | "compact" | "memory_consolidation" | {"other": ...} | {"thread_spawn": {...}}}.
 */
function sourceInfo(src: unknown): { internal: boolean; spawn?: Rec } {
  const o = rec(src);
  if (!o) return { internal: false };
  if (looseGet(o, 'internal') !== undefined) return { internal: true };
  const sub = looseGet(o, 'subagent');
  if (sub === undefined) return { internal: false };
  const so = rec(sub);
  const spawn = so ? rec(looseGet(so, 'thread_spawn')) : undefined;
  // review, compact, memory_consolidation e {"other": "guardian"}: internos, sem pai conhecido.
  return spawn ? { internal: false, spawn } : { internal: true };
}

const INTERNAL_THREAD_SOURCES = new Set(['guardian_review', 'memory_consolidation']);

export function parseSessionMeta(payload: Rec, at?: number): RolloutMeta {
  const src = sourceInfo(payload.source);
  const meta: RolloutMeta = {
    historyMode: payload.history_mode === 'paginated' ? 'paginated' : 'legacy',
    internal: src.internal || INTERNAL_THREAD_SOURCES.has(String(payload.thread_source ?? '')),
  };
  const id = str(payload.id);
  const sessionId = str(payload.session_id);
  if (id) meta.threadId = id;
  if (sessionId) meta.sessionId = sessionId;
  const cwd = str(payload.cwd);
  if (cwd) meta.cwd = cwd;
  const version = str(payload.cli_version);
  if (version) meta.cliVersion = version;
  const branch = str(rec(payload.git)?.branch);
  if (branch && branch !== 'HEAD') meta.gitBranch = branch;
  const started = toMs(payload.timestamp) ?? at;
  if (started !== undefined) meta.startedAt = started;
  const parent =
    str(src.spawn ? looseGet(src.spawn, 'parent_thread_id') : undefined) ??
    str(payload.parent_thread_id) ??
    (sessionId && id && sessionId !== id && !meta.internal ? sessionId : undefined);
  if (parent && isThreadId(parent) && parent !== id) meta.parentThreadId = parent;
  const nickname = str(src.spawn ? looseGet(src.spawn, 'agent_nickname') : undefined) ?? str(payload.agent_nickname);
  const role = str(src.spawn ? (looseGet(src.spawn, 'agent_role') ?? looseGet(src.spawn, 'agent_type')) : undefined) ?? str(payload.agent_role);
  if (nickname) meta.agentNickname = truncate(nickname, 40);
  if (role) meta.agentRole = truncate(role, 40);
  return meta;
}

// ------------------------------------------------------------------ uso do plano

/** Janelas do Codex pela duração (não pela posição): 300 min = sessão de 5 h, 10080 min = semana. */
const WINDOW_BY_MINUTES: Record<number, 'fiveHour' | 'sevenDay'> = { 300: 'fiveHour', 10080: 'sevenDay' };

function usageWindow(raw: unknown): { key: 'fiveHour' | 'sevenDay'; window: UsageWindow } | undefined {
  const w = rec(raw);
  const minutes = num(w?.window_minutes);
  const used = num(w?.used_percent);
  const key = minutes !== undefined ? WINDOW_BY_MINUTES[minutes] : undefined;
  if (!w || !key || used === undefined) return undefined;
  const window: UsageWindow = { utilization: Math.min(100, Math.max(0, used)) };
  const resets = num(w.resets_at);
  if (resets !== undefined) window.resetsAt = resets < 1e12 ? Math.round(resets * 1000) : Math.round(resets);
  return { key, window };
}

/**
 * `token_count.rate_limits` → uso da conta (source 'codex', `fetchedAt` = horário da linha). `primary` nulo com
 * `rate_limit_reached_type` = sem cota nem créditos (`noQuota`), não 0%. Sem nenhuma janela e com cota = undefined.
 */
export function usageFromRateLimits(raw: unknown, at: number): AccountUsage | undefined {
  const rl = rec(raw);
  if (!rl) return undefined;
  // Só a cota padrão ("codex"); modelos com cota própria (outro limit_id) fariam o número pular entre as duas.
  const limit = str(rl.limit_id);
  if (limit && limit !== 'codex') return undefined;
  const usage: AccountUsage = { source: 'codex', fetchedAt: at };
  for (const w of [rl.primary, rl.secondary]) {
    const parsed = usageWindow(w);
    if (parsed && !usage[parsed.key]) usage[parsed.key] = parsed.window;
  }
  if ((rl.primary === null || rl.primary === undefined) && str(rl.rate_limit_reached_type)) usage.noQuota = true;
  return usage.fiveHour || usage.sevenDay || usage.noQuota ? usage : undefined;
}

// ------------------------------------------------------------------ comandos

const SHELLS = /^(?:.*\/)?(?:ba|z|da|k|fi)?sh$/;

/**
 * O comando legível de um CommandExecution/exec: `command` é uma lista (`["/bin/zsh", "-lc", "npm test"]`) ou um
 * texto. O invólucro do shell (`-lc`, `-c`) sai; o resto é juntado com espaços (palavras com espaço entre aspas).
 */
export function commandText(cmd: unknown): string {
  if (typeof cmd === 'string') return cmd.trim();
  if (!Array.isArray(cmd)) return '';
  const words = cmd.filter((w): w is string => typeof w === 'string');
  if (words.length >= 3 && SHELLS.test(words[0]) && /^-[a-z]*c$/.test(words[1])) return words.slice(2).join(' ').trim();
  return words
    .map((w) => (/^[\w@%+=:,./-]+$/.test(w) ? w : `'${w.replace(/'/g, `'\\''`)}'`))
    .join(' ')
    .trim();
}

/** Arquivos tocados por um patch do apply_patch ("*** Add File: x", "*** Update File: y", "*** Delete File: z"). */
export function patchFiles(patch: string): Array<{ path: string; kind: 'add' | 'update' | 'delete' }> {
  const out: Array<{ path: string; kind: 'add' | 'update' | 'delete' }> = [];
  for (const m of patch.slice(0, 200_000).matchAll(/^\*\*\* (Add|Update|Delete) File: (.+)$/gm)) {
    out.push({ path: m[2].trim(), kind: m[1].toLowerCase() as 'add' | 'update' | 'delete' });
  }
  return out;
}

/** Uma mudança de arquivo de um FileChange: o mapa {caminho: {type, content | unified_diff}} ou a lista {path, kind, diff}. */
export interface FileChangeEntry {
  path: string;
  kind: 'add' | 'update' | 'delete';
  /** Diff unificado (update) ou o conteúdo (add/delete). */
  text: string;
  movePath?: string;
}

function changeKind(v: unknown): FileChangeEntry['kind'] {
  const k = typeof v === 'string' ? v : str(rec(v)?.type);
  return k === 'add' || k === 'delete' ? k : 'update';
}

export function fileChanges(raw: unknown): FileChangeEntry[] {
  const out: FileChangeEntry[] = [];
  const push = (path: unknown, c: Rec) => {
    const p = str(path);
    if (!p) return;
    const kind = changeKind(c.type ?? c.kind);
    const text = str(c.unified_diff) ?? str(c.diff) ?? str(c.content) ?? '';
    const e: FileChangeEntry = { path: p, kind, text };
    const move = str(c.move_path) ?? str(rec(c.kind)?.move_path);
    if (move) e.movePath = move;
    out.push(e);
  };
  if (Array.isArray(raw)) for (const c of raw) push(rec(c)?.path, rec(c) ?? {});
  else if (rec(raw)) for (const [path, c] of Object.entries(rec(raw)!)) push(path, rec(c) ?? {});
  return out;
}

/** Caminho de um `file://` (cwd e caminhos do Codex vêm como URL). Drive ou host UNC viram caminho
 *  Windows: o rollout pode ter sido gravado em outro sistema. */
export function pathFromUri(v: unknown): string | undefined {
  const s = str(v);
  if (!s) return undefined;
  if (!s.startsWith('file://')) return s;
  try {
    const url = new URL(s);
    const path = decodeURIComponent(url.pathname);
    // localhost o parser do file:// já esvazia; host que sobra é UNC. Letra de drive também é Windows.
    const windows = (url.hostname !== '' && url.hostname !== 'localhost') || /^\/[A-Za-z]:/.test(path);
    return fileURLToPath(url, { windows });
  } catch {
    try {
      return decodeURIComponent(new URL(s).pathname);
    } catch {
      return s.slice('file://'.length);
    }
  }
}

/** Argumentos de uma chamada de função: string JSON (o normal) ou objeto. */
export function parseArguments(raw: unknown): Rec {
  if (rec(raw)) return rec(raw)!;
  if (typeof raw !== 'string' || !raw.trim()) return {};
  try {
    return rec(JSON.parse(raw)) ?? {};
  } catch {
    return {};
  }
}

/** Nome MCP no formato do Claude Code: `mcp__<servidor>__<ferramenta>`. */
export function mcpName(server: unknown, tool: unknown): string {
  return `mcp__${String(server ?? '?')}__${String(tool ?? '?')}`;
}

/**
 * Mensagem do agente para você no code mode do app: a ferramenta `user_messaging.send_message` (MCP do próprio app,
 * `{text}`) faz o papel da resposta. Devolve o texto, ou undefined se não for essa ferramenta.
 */
export function userMessagingText(server: unknown, tool: unknown, args: unknown): string | undefined {
  if (!/user_messag(?:e|ing)[_.]*send_message$/i.test(`${String(server ?? '')}__${String(tool ?? '')}`)) return undefined;
  const text = rec(args)?.text ?? parseArguments(args).text;
  return typeof text === 'string' && text.trim() ? text : undefined;
}

const DELIVERY_COMPLETE = 'codex:code-mode-delivery:v1:complete';
const DELIVERY_INCOMPLETE = 'codex:code-mode-delivery:v1:incomplete:';

/**
 * Resposta entregue no code mode, gravada como `response_item` message/assistant com
 * `metadata.delivered_assistant_message` (o marcador; no "incomplete", o texto cortado vem nele). Undefined = não é.
 */
export function deliveredMessage(line: Rec): { id?: string; text: string } | undefined {
  const marker = str(rec(line.metadata)?.delivered_assistant_message);
  const p = rec(line.payload);
  if (!marker || !p || p.type !== 'message' || p.role !== 'assistant') return undefined;
  let text = '';
  if (marker === DELIVERY_COMPLETE) text = contentText(p.content).text;
  else if (marker.startsWith(DELIVERY_INCOMPLETE)) text = marker.slice(DELIVERY_INCOMPLETE.length);
  if (!text.trim()) return undefined;
  const id = str(p.id);
  return id ? { id, text } : { text };
}

/** Atividade de uma instrução recebida pelo Codex: "Recebeu “…”" (kind 'prompt', a base do "Concluiu em X"). */
export function describeCodexPrompt(text: string): ActivityDescription {
  const shown = truncate(maskSecrets(text.slice(0, 1_000)), 34);
  return { ...describePrompt(text), text: truncate(tr('Recebeu “{0}”', [shown]), 46) };
}

const PLAN_STATUS = new Set<string>(['pending', 'in_progress', 'completed']);

/** Passos do `update_plan` ({plan: [{step, status}]}) como tarefas. */
export function planTasks(args: Rec): TaskItem[] | undefined {
  if (!Array.isArray(args.plan)) return undefined;
  const out: TaskItem[] = [];
  args.plan.forEach((raw, i) => {
    const p = rec(raw);
    const title = str(p?.step);
    if (!p || !title) return;
    const status = typeof p.status === 'string' && PLAN_STATUS.has(p.status) ? (p.status as TaskStatus) : 'pending';
    out.push({ id: String(i + 1), title: truncate(maskSecrets(title.slice(0, 480)), 120), status });
  });
  return out;
}

/**
 * Atividade de uma ferramenta do Codex pelo nome que ela tem no rollout, no hook ou no app (exec_command, shell,
 * Bash, apply_patch, mcp__…, spawn_agent, exec do code mode...). `name` volta normalizado (Bash, Edit, Write,
 * mcp__…) para o Activity.tool.
 */
export function describeCodexTool(rawName: string, input: Rec, namespace?: string): { desc: ActivityDescription; tool: string } {
  const name = namespace && /^mcp__/.test(namespace) ? `${namespace.replace(/_+$/, '')}__${rawName}` : rawName;
  switch (name) {
    case 'Bash':
    case 'shell':
    case 'shell_command':
    case 'local_shell':
    case 'exec_command':
    case 'container.exec': {
      const command = commandText(input.cmd ?? input.command);
      return { desc: describeTool('Bash', { command, description: input.description }), tool: 'Bash' };
    }
    case 'write_stdin':
      return { desc: { kind: 'run', icon: '⌨️', text: tr('Interagindo com um comando') }, tool: name };
    case 'apply_patch': {
      const patch = typeof input.command === 'string' ? input.command : typeof input.input === 'string' ? input.input : typeof input.patch === 'string' ? input.patch : '';
      const files = patchFiles(patch);
      const first = files[0];
      if (!first) return { desc: describeTool('Edit', {}), tool: 'Edit' };
      const tool = first.kind === 'add' ? 'Write' : 'Edit';
      const desc = describeTool(tool, { file_path: first.path });
      if (files.length > 1) desc.detail = truncate(files.map((f) => f.path).join(', '), 300);
      return { desc, tool };
    }
    case 'exec':
      // Code mode do app: o argumento é JavaScript; o comando legível só aparece no CommandExecution ao concluir.
      return { desc: { kind: 'run', icon: '⚙️', text: tr('Executando código') }, tool: name };
    case 'update_plan':
      return { desc: { kind: 'plan', icon: '🗒️', text: tr('Atualizando o plano') }, tool: name };
    case 'view_image': {
      const path = str(input.path);
      return { desc: describeTool('Read', { file_path: path ?? 'imagem.png' }), tool: 'Read' };
    }
    case 'web_search':
    case 'web_search_preview':
      return { desc: describeTool('WebSearch', { query: input.query }), tool: 'WebSearch' };
    case 'spawn_agent':
    case 'Agent': {
      const prompt = str(input.message) ?? str(input.prompt) ?? str(input.task);
      return { desc: describeTool('Agent', { description: prompt ? truncate(prompt, 60) : undefined, subagent_type: input.agent_type }), tool: 'Agent' };
    }
    case 'wait':
    case 'wait_agent':
      return { desc: { kind: 'delegate', icon: '⏳', text: tr('Esperando os subagentes') }, tool: name };
    case 'send_input':
    case 'send_message':
    case 'followup_task':
      return { desc: { kind: 'communicate', icon: '💬', text: tr('Mensagem para um subagente') }, tool: name };
    case 'close_agent':
      return { desc: { kind: 'delegate', icon: '👥', text: tr('Encerrando um subagente') }, tool: name };
    case 'request_permissions':
      return { desc: { kind: 'wait', icon: '🔐', text: tr('Pedindo permissões') }, tool: name };
    default:
      return { desc: describeTool(name, input), tool: name };
  }
}

// ------------------------------------------------------------------ estado

export interface CodexState {
  /** session_meta (lido do começo do arquivo, à parte da janela do fim). */
  meta?: RolloutMeta;
  /** Formato: o do session_meta; sem ele, deduzido (o primeiro item paginated ou evento legacy decide). */
  mode?: HistoryMode;
  model?: string;
  gitBranch?: string;
  /** Primeira instrução (título da sessão), já mascarada e cortada. */
  title?: string;
  tasks: TaskItem[];
  stats: AgentStats;
  /** Turno aberto (task_started sem task_complete/turn_aborted); undefined = nenhum evento de turno visto. */
  turnOpen?: boolean;
  firstAt?: number;
  lastAt?: number;
  /** Chamadas de ferramenta ainda sem resultado (call_id → nome). */
  pending: Map<string, string>;
  /** Uso do plano mais recente (rate_limits) e o plano. */
  usage?: AccountUsage;
  planType?: string;
  current?: { id: string; kind: Activity['kind']; at: number; callId?: string };
}

export function createCodexState(meta?: RolloutMeta): CodexState {
  const s: CodexState = { tasks: [], stats: { toolCalls: 0, tokensIn: 0, tokensOut: 0, subagents: 0 }, pending: new Map() };
  if (meta) applyMeta(s, meta);
  return s;
}

/** Aplica o session_meta ao estado (formato, branch). */
export function applyMeta(s: CodexState, meta: RolloutMeta): void {
  s.meta = meta;
  s.mode = meta.historyMode;
  if (meta.gitBranch) s.gitBranch ??= meta.gitBranch;
}

/** Sinais de uma linha para quem acompanha o thread. */
export type CodexSignal =
  | { type: 'turnStart' }
  | { type: 'turnEnd'; aborted: boolean }
  /** Algo concluiu dentro do turno (tira a espera por aprovação). */
  | { type: 'progress' }
  | { type: 'usage'; usage: AccountUsage; plan?: string }
  | { type: 'github'; event: GitHubEvent; key: string }
  | { type: 'meta'; meta: RolloutMeta };

export interface CodexLineResult {
  activities: ParsedActivity[];
  signals: CodexSignal[];
  /** Título, números, modelo ou tarefas mudaram. */
  changed: boolean;
  /** Epoch ms da linha (o `timestamp` dela ou o `now` do contexto). */
  at: number;
}

export interface CodexParseContext {
  /** Prefixo dos ids de atividade (o id do agente). */
  idPrefix: string;
  now: number;
  /** false = só atualiza o estado (sem montar atividades). */
  activities?: boolean;
}

const TITLE_MAX = 90;
const MAX_PENDING = 128;
/** Texto injetado pelo Codex que não é instrução sua. */
const INJECTED = /^<(environment_context|user_instructions|turn_aborted|subagent_notification|user_shell_command_output|collaboration_mode)\b/;

/** Texto de UserMessage.content ([{type: 'text', text}, {type: 'image'...}]) ou de uma lista de blocos {text}. */
export function contentText(content: unknown): { text: string; images: number } {
  if (typeof content === 'string') return { text: content, images: 0 };
  if (!Array.isArray(content)) return { text: '', images: 0 };
  const texts: string[] = [];
  let images = 0;
  for (const raw of content) {
    const b = rec(raw);
    if (!b) continue;
    const type = String(b.type ?? '').toLowerCase();
    if (typeof b.text === 'string') texts.push(b.text);
    else if (type === 'image' || type === 'local_image' || type === 'input_image') images++;
  }
  return { text: texts.join(''), images };
}

/** Instrução de verdade (não contexto injetado), limpa; '' = nada a mostrar. */
export function promptText(raw: string): string {
  const text = raw.trim();
  if (!text || INJECTED.test(text)) return '';
  return text;
}

/** Saída de uma ferramenta (function_call_output): texto, JSON {output, metadata: {exit_code}} ou blocos. */
function outputOf(raw: unknown): { text: string; exitCode?: number } {
  if (typeof raw === 'string') {
    try {
      const j = rec(JSON.parse(raw));
      if (j && typeof j.output === 'string') return { text: j.output, exitCode: num(rec(j.metadata)?.exit_code) };
    } catch {
      // texto puro
    }
    const exit = /^Exit code:\s*(-?\d+)/m.exec(raw.slice(0, 500))?.[1];
    return { text: raw, exitCode: exit !== undefined ? Number(exit) : undefined };
  }
  const o = rec(raw);
  if (o) return outputOf(o.content ?? o.output ?? o.body ?? '');
  if (Array.isArray(raw)) return { text: contentText(raw).text };
  return { text: '' };
}

function firstLine(s: string, max = 140): string | undefined {
  const line = s.split('\n').find((l) => l.trim());
  return line ? truncate(line, max) : undefined;
}

class RolloutLineParser {
  readonly out: CodexLineResult;
  private readonly withActivities: boolean;

  constructor(
    private readonly s: CodexState,
    private readonly ctx: CodexParseContext,
    private readonly j: Rec,
    private readonly at: number,
  ) {
    this.withActivities = ctx.activities !== false;
    this.out = { activities: [], signals: [], changed: false, at };
  }

  /**
   * Chave estável de uma atividade sem id próprio: o `ordinal` da linha (quando o Codex grava) ou o horário dela,
   * mais a posição dentro da linha. Uma releitura do arquivo gera as mesmas chaves (o Office não duplica).
   */
  private autoKey(): string {
    const ordinal = num(this.j.ordinal);
    const base = ordinal !== undefined ? `o${ordinal}` : `t${this.at.toString(36)}`;
    const n = this.autoKeys++;
    return n ? `${base}:${n}` : base;
  }

  private autoKeys = 0;

  private push(desc: ActivityDescription, opts: { key?: string; tool?: string; current?: boolean; durationMs?: number; callId?: string } = {}): void {
    if (!this.withActivities) return;
    const key = opts.key ?? this.autoKey();
    const activity: Activity = { id: `${this.ctx.idPrefix}#${key}`, at: this.at, ...desc };
    if (opts.tool) activity.tool = opts.tool;
    if (opts.durationMs !== undefined) activity.durationMs = opts.durationMs;
    if (desc.kind === 'error') activity.error = true;
    const current = opts.current ?? true;
    this.out.activities.push(opts.callId ? { activity, current, toolUseId: opts.callId } : { activity, current });
    if (current) this.s.current = { id: activity.id, kind: desc.kind, at: this.at, callId: opts.callId };
  }

  private changed(): void {
    this.out.changed = true;
  }

  private paginated(): boolean {
    return this.s.mode === 'paginated';
  }

  /** Um item paginated visto: o formato é esse (a janela do fim pode não ter o session_meta). */
  private sawPaginated(): void {
    this.s.mode ??= 'paginated';
  }

  run(): void {
    const p = rec(this.j.payload);
    if (!p) return;
    switch (this.j.type) {
      case 'session_meta': {
        const meta = parseSessionMeta(p, this.at);
        applyMeta(this.s, meta);
        this.out.signals.push({ type: 'meta', meta });
        this.changed();
        return;
      }
      case 'turn_context':
        return this.model(p.model);
      case 'event_msg':
        return this.event(p);
      case 'response_item':
        return this.responseItem(p);
      case 'compacted':
        if (!this.paginated()) this.push(SPECIAL.compact());
        return;
      default:
        return;
    }
  }

  private model(v: unknown): void {
    const m = str(v);
    if (!m || m === this.s.model) return;
    this.s.model = m;
    this.changed();
  }

  // ---------------------------------------------------------------- event_msg

  private event(p: Rec): void {
    switch (p.type) {
      case 'item_completed':
        return this.item(rec(p.item));
      case 'task_started':
      case 'turn_started':
        this.s.turnOpen = true;
        this.out.signals.push({ type: 'turnStart' });
        return;
      case 'task_complete':
      case 'turn_complete': {
        this.endTurn(false);
        const ms = num(p.duration_ms);
        const err = rec(p.error);
        const turn = str(p.turn_id) ?? this.autoKey();
        if (err) this.push(SPECIAL.error(undefined, firstLine(str(err.message) ?? '')), { key: `${turn}:err`, current: false });
        this.push(SPECIAL.turnDone(ms), { key: `${turn}:done`, durationMs: ms });
        return;
      }
      case 'turn_aborted':
        this.endTurn(true);
        if (p.reason === 'interrupted' || p.reason === undefined) this.push(SPECIAL.interrupted(), { key: `${str(p.turn_id) ?? this.autoKey()}:int` });
        return;
      case 'token_count':
        return this.tokens(p);
      case 'thread_settings_applied':
        return this.model(rec(p.thread_settings)?.model);
      // ---- legacy (threads antigos): só o básico
      case 'user_message':
        if (this.paginated()) return;
        this.s.mode ??= 'legacy';
        return this.prompt(str(p.message) ?? '', Array.isArray(p.images) ? p.images.length : 0);
      case 'agent_message': {
        if (this.paginated()) return;
        this.s.mode ??= 'legacy';
        const text = str(p.message);
        if (text) this.push(SPECIAL.respond(text));
        this.progress();
        return;
      }
      case 'agent_reasoning':
        if (this.paginated()) return;
        return this.think();
      case 'exec_command_end':
        if (this.paginated()) return;
        return this.command({ id: str(p.call_id), command: p.command, exitCode: num(p.exit_code), output: str(p.aggregated_output) ?? str(p.formatted_output) ?? str(p.stdout) ?? '', status: str(p.status) });
      case 'patch_apply_end':
        if (this.paginated()) return;
        return this.fileChange(str(p.call_id), p.changes, p.success === false ? 'failed' : str(p.status));
      case 'mcp_tool_call_end': {
        if (this.paginated()) return;
        const inv = rec(p.invocation) ?? {};
        return this.mcp(str(p.call_id), inv.server, inv.tool, inv.arguments, rec(p.result), undefined);
      }
      case 'context_compacted':
        if (this.paginated()) return;
        this.push(SPECIAL.compact());
        return;
      default:
        return;
    }
  }

  private endTurn(aborted: boolean): void {
    this.s.turnOpen = false;
    this.s.pending.clear();
    this.out.signals.push({ type: 'turnEnd', aborted });
  }

  private progress(): void {
    this.out.signals.push({ type: 'progress' });
  }

  private tokens(p: Rec): void {
    const total = rec(rec(p.info)?.total_token_usage);
    if (total) {
      // Cumulativo: atribui (o input já inclui o cache; o output já inclui o raciocínio).
      const tin = num(total.input_tokens) ?? 0;
      const tout = num(total.output_tokens) ?? 0;
      if (tin !== this.s.stats.tokensIn || tout !== this.s.stats.tokensOut) {
        this.s.stats.tokensIn = tin;
        this.s.stats.tokensOut = tout;
        this.changed();
      }
    }
    const rl = rec(p.rate_limits);
    if (!rl) return;
    const plan = str(rl.plan_type);
    if (plan) this.s.planType = plan;
    const usage = usageFromRateLimits(rl, this.at);
    if (!usage) return;
    if (!this.s.usage || usage.fetchedAt >= this.s.usage.fetchedAt) this.s.usage = usage;
    this.out.signals.push(plan ? { type: 'usage', usage, plan } : { type: 'usage', usage });
  }

  private think(key?: string): void {
    const cur = this.s.current;
    // Um único "Pensando…" seguido (o raciocínio vem em vários pedaços).
    if (cur?.kind === 'think' && this.at - cur.at < 30_000) return;
    this.push(SPECIAL.think(), { key });
  }

  private prompt(raw: string, images: number, key?: string): void {
    const text = promptText(raw) || (images ? tr('[imagem]') : '');
    if (!text) return;
    if (this.s.title === undefined) {
      this.s.title = truncate(maskSecrets(text.slice(0, 1_000)), TITLE_MAX);
      this.changed();
    }
    this.push(describeCodexPrompt(text), { key });
  }

  // ---------------------------------------------------------------- item_completed (paginated)

  private item(item: Rec | undefined): void {
    if (!item) return;
    const id = str(item.id);
    switch (item.type) {
      case 'UserMessage': {
        this.sawPaginated();
        const { text, images } = contentText(item.content);
        return this.prompt(text, images, id);
      }
      case 'AgentMessage': {
        this.sawPaginated();
        const text = contentText(item.content).text.trim();
        if (text) this.push(SPECIAL.respond(text), { key: id });
        this.progress();
        return;
      }
      case 'Reasoning':
        this.sawPaginated();
        this.progress();
        return this.think(id);
      case 'CommandExecution':
        this.sawPaginated();
        this.s.stats.toolCalls++;
        this.changed();
        return this.command({ id, command: item.command, exitCode: num(item.exit_code), output: str(item.aggregated_output) ?? '', status: str(item.status) });
      case 'FileChange':
        this.sawPaginated();
        this.s.stats.toolCalls++;
        this.changed();
        return this.fileChange(id, item.changes, str(item.status));
      case 'McpToolCall':
        this.sawPaginated();
        this.s.stats.toolCalls++;
        this.changed();
        return this.mcp(id, item.server, item.tool, item.arguments, rec(item.result), str(rec(item.error)?.message), str(item.status));
      case 'WebSearch':
        this.sawPaginated();
        this.s.stats.toolCalls++;
        this.changed();
        this.done(id);
        this.push(describeTool('WebSearch', { query: item.query }), { key: id, tool: 'WebSearch', callId: id });
        return;
      case 'ImageView': {
        this.sawPaginated();
        const path = pathFromUri(item.path);
        this.done(id);
        this.push(describeTool('Read', { file_path: path ?? 'imagem.png' }), { key: id, tool: 'Read', callId: id });
        return;
      }
      case 'ContextCompaction':
        this.sawPaginated();
        this.push(SPECIAL.compact(), { key: id });
        return;
      case 'CollabAgentToolCall': {
        this.sawPaginated();
        const tool = str(item.tool) ?? 'spawn_agent';
        if (tool === 'spawn_agent') {
          this.s.stats.subagents++;
          this.changed();
        }
        this.done(id);
        const { desc, tool: name } = describeCodexTool(tool, { prompt: item.prompt });
        this.push(desc, { key: id, tool: name, callId: id });
        this.progress();
        return;
      }
      case 'Plan':
        this.sawPaginated();
        this.push(describeTool('ExitPlanMode', {}), { key: id, tool: 'Plan' });
        return;
      case 'DynamicToolCall': {
        this.sawPaginated();
        this.done(id);
        const { desc, tool } = describeCodexTool(str(item.tool) ?? 'ferramenta', rec(item.arguments) ?? {}, str(item.namespace));
        this.push(desc, { key: id, tool, callId: id });
        return;
      }
      default:
        return;
    }
  }

  /** Chamada concluída: sai da lista das em andamento e tira a espera por aprovação. */
  private done(callId: string | undefined): void {
    if (callId) this.s.pending.delete(callId);
    this.progress();
  }

  private command(c: { id?: string; command: unknown; exitCode?: number; output: string; status?: string }): void {
    const command = commandText(c.command);
    this.done(c.id);
    const key = c.id ?? this.autoKey();
    this.push(describeTool('Bash', { command }), { key, tool: 'Bash', callId: c.id });
    if (c.status === 'declined') {
      this.push(SPECIAL.rejected('Bash'), { key: `${key}:r` });
      return;
    }
    const failed = c.status === 'failed' || (c.exitCode !== undefined && c.exitCode !== 0);
    if (failed) this.push(SPECIAL.error('Bash', firstLine(c.output) ?? (c.exitCode !== undefined ? tr('Código de saída {0}', [c.exitCode]) : undefined)), { key: `${key}:e`, tool: 'Bash' });
    // GitHub: a mesma detecção do Claude Code, com o comando, a saída e o código de saída.
    const gh = command ? githubCallOf('Bash', { command }) : undefined;
    if (gh && c.status !== 'declined') {
      const content = failed ? `Exit code ${c.exitCode ?? 1}\n${c.output}` : c.output;
      const event = detectGitHubResult(gh, { content, tur: {}, isError: failed, branch: this.s.gitBranch });
      if (event) this.out.signals.push({ type: 'github', event, key });
    }
  }

  private fileChange(id: string | undefined, changes: unknown, status: string | undefined): void {
    this.done(id);
    const key = id ?? this.autoKey();
    const list = fileChanges(changes).slice(0, 8);
    if (!list.length) this.push(describeTool('Edit', {}), { key, tool: 'Edit', callId: id });
    list.forEach((f, i) => {
      const tool = f.kind === 'add' ? 'Write' : 'Edit';
      this.push(describeTool(tool, { file_path: f.movePath ?? f.path }), { key: i ? `${key}:${i}` : key, tool, callId: i ? undefined : id });
    });
    if (status === 'declined') this.push(SPECIAL.rejected('Edit'), { key: `${key}:r` });
    else if (status === 'failed') this.push(SPECIAL.error('Edit'), { key: `${key}:e`, tool: 'Edit' });
  }

  private mcp(id: string | undefined, server: unknown, tool: unknown, args: unknown, result: Rec | undefined, error: string | undefined, status?: string): void {
    this.done(id);
    const name = mcpName(server, tool);
    const input = rec(args) ?? parseArguments(args);
    const key = id ?? this.autoKey();
    // Code mode: a mensagem para você é a resposta (a mesma chave da entrega gravada como response_item).
    const said = userMessagingText(server, tool, input);
    if (said) {
      this.push(SPECIAL.respond(said), { key });
      return;
    }
    this.push(describeTool(name, input), { key, tool: name, callId: id });
    const failed = !!error || status === 'failed' || result?.isError === true || result?.is_error === true;
    if (failed) this.push(SPECIAL.error(name, firstLine(error ?? contentText(result?.content).text)), { key: `${key}:e`, tool: name });
    const gh = githubCallOf(name, input);
    if (gh) {
      const event = detectGitHubResult(gh, { content: contentText(result?.content).text, tur: {}, isError: failed, branch: this.s.gitBranch });
      if (event) this.out.signals.push({ type: 'github', event, key });
    }
  }

  // ---------------------------------------------------------------- response_item

  private responseItem(p: Rec): void {
    switch (p.type) {
      case 'message': {
        // Só a resposta entregue no code mode (as outras mensagens são o contexto mandado ao modelo).
        const delivered = deliveredMessage(this.j);
        if (delivered) {
          this.push(SPECIAL.respond(delivered.text), { key: delivered.id });
          this.progress();
        }
        return;
      }
      case 'function_call':
      case 'custom_tool_call': {
        const callId = str(p.call_id) ?? str(p.id);
        const name = str(p.name) ?? 'ferramenta';
        const input = p.type === 'custom_tool_call' ? { input: p.input, command: p.input } : parseArguments(p.arguments);
        if (callId) {
          this.s.pending.set(callId, name);
          if (this.s.pending.size > MAX_PENDING) this.s.pending.delete(this.s.pending.keys().next().value as string);
        }
        if (this.s.mode === 'legacy') {
          this.s.stats.toolCalls++;
          this.changed();
        }
        if (name === 'update_plan') {
          const tasks = planTasks(input);
          if (tasks) {
            this.s.tasks = tasks;
            this.changed();
          }
        }
        // Atividade em andamento: o item concluído (paginated) chega depois com o mesmo id e não duplica.
        const { desc, tool } = describeCodexTool(name, input, str(p.namespace));
        this.push(desc, { key: callId, tool, callId });
        return;
      }
      case 'local_shell_call': {
        const callId = str(p.call_id) ?? str(p.id);
        if (callId) this.s.pending.set(callId, 'local_shell');
        if (this.s.mode === 'legacy') {
          this.s.stats.toolCalls++;
          this.changed();
        }
        this.push(describeTool('Bash', { command: commandText(rec(p.action)?.command) }), { key: callId, tool: 'Bash', callId });
        return;
      }
      case 'function_call_output':
      case 'custom_tool_call_output': {
        const callId = str(p.call_id);
        const name = callId ? this.s.pending.get(callId) : undefined;
        if (callId) this.s.pending.delete(callId);
        if (this.paginated()) return;
        // Legacy: o resultado de um comando (o item concluído não existe nesse formato).
        if (!name || !/^(shell|shell_command|local_shell|exec_command|container\.exec)$/.test(name)) return;
        const out = outputOf(p.output);
        if (out.exitCode !== undefined && out.exitCode !== 0) {
          this.push(SPECIAL.error('Bash', firstLine(out.text)), { key: `${callId}:e`, tool: 'Bash', current: this.s.current?.callId === callId });
        }
        this.progress();
        return;
      }
      case 'web_search_call':
        if (this.paginated()) return;
        this.push(describeTool('WebSearch', { query: rec(p.action)?.query }), { tool: 'WebSearch' });
        return;
      default:
        return;
    }
  }
}

/** Interpreta uma linha do rollout. Linhas inválidas ou desconhecidas não geram nada. */
export function parseRolloutLine(state: CodexState, raw: string, ctx: CodexParseContext): CodexLineResult {
  let j: unknown;
  try {
    j = JSON.parse(raw);
  } catch {
    return { activities: [], signals: [], changed: false, at: ctx.now };
  }
  const r = rec(j);
  if (!r) return { activities: [], signals: [], changed: false, at: ctx.now };
  const at = toMs(r.timestamp);
  if (at !== undefined) {
    if (state.firstAt === undefined || at < state.firstAt) state.firstAt = at;
    if (state.lastAt === undefined || at > state.lastAt) state.lastAt = at;
  }
  const p = new RolloutLineParser(state, ctx, r, at ?? ctx.now);
  try {
    p.run();
  } catch {
    // linha estranha demais: fica o que já tiver saído dela
  }
  return p.out;
}

/** O session_meta de uma linha (a primeira do rollout), ou undefined. */
export function metaFromLine(raw: string): RolloutMeta | undefined {
  try {
    const j = rec(JSON.parse(raw));
    const p = rec(j?.payload);
    return j?.type === 'session_meta' && p ? parseSessionMeta(p, toMs(j.timestamp)) : undefined;
  } catch {
    return undefined;
  }
}
