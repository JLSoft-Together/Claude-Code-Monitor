// Interpretação dos transcripts JSONL do Claude Code (sessão principal e subagentes).
// Cada linha atualiza um TranscriptState (títulos, tarefas, estatísticas...) e pode gerar
// atividades (o que o personagem está fazendo) e sinais (ciclo de vida de subagentes).
// Tipos de linha desconhecidos são ignorados; uma linha inválida nunca derruba a leitura.
import { createReadStream } from 'node:fs';
import type { Activity, AgentStats, TaskItem, TaskStatus } from '../../shared/types';
import { describePrompt, describeShellJob, describeTool, maskSecrets, SPECIAL, truncate, type ActivityDescription } from '../../shared/activity';
import type { GitHubEvent } from '../../shared/github';
import { detectGitHubNotification, detectGitHubResult, githubCallOf, type GitHubCall } from './github';
import type { ShellStart } from './shells';
import { LineBuffer, warnOversizedLine } from './tail';

// ------------------------------------------------------------------ tarefas

export type TaskOp =
  | { op: 'replace'; tasks: TaskItem[] }
  | { op: 'create'; id: string; title: string; activeForm?: string }
  | { op: 'update'; id: string; status?: TaskStatus | 'deleted'; title?: string; activeForm?: string }
  | { op: 'rename'; from: string; to: string };

const TASK_STATUSES = new Set<string>(['pending', 'in_progress', 'completed']);

export function applyTaskOp(tasks: TaskItem[], op: TaskOp): TaskItem[] {
  switch (op.op) {
    case 'replace':
      return op.tasks.map((t) => ({ ...t }));
    case 'create': {
      const t: TaskItem = { id: op.id, title: op.title, status: 'pending' };
      if (op.activeForm) t.activeForm = op.activeForm;
      return [...tasks.filter((x) => x.id !== op.id), t];
    }
    case 'update': {
      const status = op.status;
      if (status === 'deleted') return tasks.filter((t) => t.id !== op.id);
      if (!tasks.some((t) => t.id === op.id)) return tasks;
      return tasks.map((t) => {
        if (t.id !== op.id) return t;
        const next: TaskItem = { ...t };
        if (status) next.status = status;
        if (op.title) next.title = op.title;
        if (op.activeForm) next.activeForm = op.activeForm;
        return next;
      });
    }
    case 'rename':
      return tasks.map((t) => (t.id === op.from ? { ...t, id: op.to } : t));
  }
}

function todosToTasks(raw: unknown): TaskItem[] {
  if (!Array.isArray(raw)) return [];
  const out: TaskItem[] = [];
  raw.forEach((item, i) => {
    if (!item || typeof item !== 'object') return;
    const t = item as Record<string, unknown>;
    const title = str(t.content) ?? str(t.subject) ?? str(t.title);
    if (!title) return;
    const status = typeof t.status === 'string' && TASK_STATUSES.has(t.status) ? (t.status as TaskStatus) : 'pending';
    const task: TaskItem = { id: str(t.id) ?? String(i + 1), title: truncate(title, 120), status };
    const af = str(t.activeForm);
    if (af) task.activeForm = truncate(af, 120);
    out.push(task);
  });
  return out;
}

// ------------------------------------------------------------------ estado

export interface SpawnInfo {
  toolUseId: string;
  /** 'Agent' | 'Task' | 'Workflow'. */
  tool: string;
  description?: string;
  subagentType?: string;
  name?: string;
  background: boolean;
  at: number;
}

/**
 * Sinais para o ciclo de vida dos subagentes (extraídos do transcript de quem os disparou) e dos
 * shells que o agente espera (Bash/Monitor; ver shells.ts).
 */
export type TranscriptSignal =
  | { type: 'spawn'; spawn: SpawnInfo }
  | { type: 'launched'; toolUseId: string; agentId?: string; runId?: string; taskId?: string }
  | { type: 'finished'; toolUseId: string; agentId?: string; runId?: string; error: boolean }
  | { type: 'notification'; toolUseId?: string; taskId?: string; status?: string; summary?: string }
  | { type: 'stopped'; taskId: string }
  /** Bash (primeiro ou segundo plano) ou Monitor chamado. */
  | { type: 'shellStart'; shell: ShellStart }
  /** tool_result de um Bash/Monitor: `taskId` = id da tarefa em segundo plano, quando houver. */
  | { type: 'shellResult'; toolUseId: string; taskId?: string; error: boolean }
  /** Fim de turno ou interrupção: nenhum comando em primeiro plano segue rodando. */
  | { type: 'turnEnd' }
  /** Evento do GitHub (PR, merge, push, CI, release) no resultado de uma ferramenta; ver github.ts. */
  | { type: 'github'; event: GitHubEvent; toolUseId: string };

/** Sinais que interessam ao rastreador de shells (inclusive no começo do arquivo, lido em segundo plano). */
const SHELL_SIGNALS = new Set<TranscriptSignal['type']>(['shellStart', 'shellResult', 'notification', 'stopped', 'turnEnd']);

export interface ParsedActivity {
  activity: Activity;
  /** Torna-se a atividade atual do agente (erros de ferramentas antigas só vão para o histórico). */
  current: boolean;
  /** Chamada de ferramenta que originou a atividade, quando houver. */
  toolUseId?: string;
}

export interface TranscriptState {
  customTitle?: string;
  agentName?: string;
  aiTitle?: string;
  lastPrompt?: string;
  tasks: TaskItem[];
  /** TaskCreate aguardando o id real (tool_use id -> id provisório). */
  pendingTaskCreates: Map<string, string>;
  /** Operações de tarefas feitas desde o início da janela lida (até o prefixo do arquivo ser mesclado). */
  taskOpsLog: TaskOp[] | null;
  sawTaskReplace: boolean;
  stats: AgentStats;
  costSeen: boolean;
  model?: string;
  gitBranch?: string;
  permissionMode?: string;
  firstAt?: number;
  lastAt?: number;
  /** stop_reason da última linha de assistant. */
  lastStopReason?: string | null;
  /** O turno terminou (fim de turno, end_turn ou interrupção) e nada novo começou. */
  ended: boolean;
  /** Ferramentas chamadas que ainda não tiveram resultado. */
  pendingTools: Map<string, string>;
  /** Nomes das ferramentas por tool_use id (para erros e resultados de subagentes). */
  toolNames: Map<string, string>;
  /** TaskStop/KillShell: tool_use id -> id da tarefa parada. */
  stopRequests: Map<string, string>;
  /** Chamadas que podem virar evento do GitHub (gh/git push, MCP do GitHub), até o resultado. */
  github: Map<string, GitHubCall>;
  /** Uso de tokens já contado por mensagem (as linhas de uma mensagem trazem o uso parcial). */
  usageByMsg: Map<string, { tin: number; tout: number }>;
  /** Ids das primeiras mensagens da janela lida (para não contar duas vezes ao mesclar o prefixo). */
  firstMsgIds: Set<string> | null;
  /** Mensagens cujo uso não deve ser contado (pertencem à janela já lida). */
  skipUsage?: ReadonlySet<string>;
  current?: { id: string; toolUseId?: string; kind: Activity['kind']; at: number; msgId?: string };
  seq: number;
  /**
   * Transcript de um fork (subagente que herda o contexto do pai). Ele começa com uma linha
   * 'fork-context-ref' e a CÓPIA da chamada Agent do pai seguida do resultado dela ("Fork started…")
   * junto com a instrução do fork. 'expect-spawn' = a próxima linha de assistant é essa cópia.
   */
  fork?: 'expect-spawn' | 'expect-result';
  /** tool_use id da chamada herdada (o mesmo do meta.json do fork): não é uma ferramenta do fork. */
  inheritedSpawn?: string;
}

export function createTranscriptState(opts: { trackPrefix?: boolean } = {}): TranscriptState {
  return {
    tasks: [],
    pendingTaskCreates: new Map(),
    taskOpsLog: opts.trackPrefix ? [] : null,
    sawTaskReplace: false,
    stats: { toolCalls: 0, tokensIn: 0, tokensOut: 0, subagents: 0 },
    costSeen: false,
    ended: false,
    pendingTools: new Map(),
    toolNames: new Map(),
    stopRequests: new Map(),
    github: new Map(),
    usageByMsg: new Map(),
    firstMsgIds: opts.trackPrefix ? new Set() : null,
    seq: 0,
  };
}

export interface ParseContext {
  /** Prefixo dos ids de atividade (o id do agente), para que sejam únicos no escritório. */
  idPrefix: string;
  now: number;
  /** false = só atualiza o estado (leitura do prefixo em segundo plano). */
  activities?: boolean;
}

export interface LineResult {
  activities: ParsedActivity[];
  signals: TranscriptSignal[];
  /** Título, tarefas, estatísticas ou metadados mudaram. */
  changed: boolean;
  /** Epoch ms da linha (o `timestamp` dela ou, sem ele, o `now` do contexto). */
  at: number;
}

// ------------------------------------------------------------------ utilidades

const MAX_TRACKED = 512;
const FIRST_MSG_IDS = 48;

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v : undefined;
}

function truthy(v: unknown): boolean {
  return v === true || (typeof v === 'string' && /^(true|1|yes)$/i.test(v.trim()));
}

function remember<K, V>(map: Map<K, V>, key: K, value: V, max = MAX_TRACKED): void {
  map.delete(key);
  map.set(key, value);
  if (map.size > max) map.delete(map.keys().next().value as K);
}

function toMs(v: unknown): number | undefined {
  if (typeof v !== 'string') return undefined;
  const t = Date.parse(v);
  return Number.isNaN(t) ? undefined : t;
}

function textOf(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((b) => (b && typeof b === 'object' && typeof (b as { text?: unknown }).text === 'string' ? (b as { text: string }).text : ''))
      .join('\n');
  }
  return '';
}

function firstLine(s: string, max = 140): string | undefined {
  const line = s.split('\n').find((l) => l.trim());
  return line ? truncate(line.replace(/<\/?[a-z_-]+>/gi, ''), max) : undefined;
}

/** Extrai os campos de um `<task-notification>` (resultado de tarefa em segundo plano). */
export function parseTaskNotification(text: string): { taskId?: string; toolUseId?: string; status?: string; summary?: string } {
  const tag = (name: string) => new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(text)?.[1]?.trim() || undefined;
  return { taskId: tag('task-id'), toolUseId: tag('tool-use-id'), status: tag('status'), summary: tag('summary') };
}

/**
 * Id da tarefa em segundo plano no tool_result de um Bash/Monitor: `toolUseResult.backgroundTaskId`
 * ("Command running in background with ID: bo0ov3q3l..." no texto) ou campos equivalentes.
 */
export function backgroundIdOf(tur: Record<string, unknown>, content: unknown, tool?: string): string | undefined {
  for (const k of ['backgroundTaskId', 'backgroundId', 'shellId', 'bash_id', 'monitorId']) {
    const v = str(tur[k]);
    if (v) return v.trim();
  }
  if (tool === 'Monitor') {
    const v = str(tur.taskId) ?? str(tur.task_id);
    if (v) return v.trim();
  }
  if (tool !== 'Bash' && tool !== 'Monitor') return undefined;
  // Só o começo do texto, na forma do próprio Claude Code ("Command running in background with ID: x"):
  // a saída de um comando em primeiro plano pode conter qualquer coisa (inclusive essa frase).
  const head = textOf(content).trimStart().split('\n', 1)[0].slice(0, 300);
  const re =
    tool === 'Monitor'
      ? /^(?:Monitor|Started|Watching|Task)\b[^"]{0,80}?\b(?:task|monitor)?\s*id\b[':\s]*([A-Za-z0-9_-]{4,})/i
      : /^Command\b[^"]{0,60}?\bbackground\w*\b[^"]{0,60}?\bID:\s*([A-Za-z0-9_-]{4,})/i;
  return re.exec(head)?.[1];
}

const INTERRUPTED = /^\[Request interrupted by user/;
const REJECTED = /doesn't want to proceed|tool use was rejected|user rejected/i;
// Mensagens "de sistema" gravadas como user (comandos locais, lembretes, saída de bash...).
const SYSTEM_TAG = /^<(local-command-[\w-]+|command-stdout|command-stderr|system-reminder|bash-[\w-]+|user-memory-input|user-prompt-submit-hook|persisted-output)\b/;
// Comandos de barra que não são instruções de trabalho.
const LOCAL_COMMANDS = new Set([
  '/clear', '/compact', '/model', '/cost', '/usage', '/status', '/config', '/login', '/logout', '/exit', '/quit', '/resume',
  '/context', '/mcp', '/help', '/permissions', '/memory', '/doctor', '/theme', '/vim', '/terminal-setup', '/rename', '/agents',
  '/hooks', '/ide', '/statusline', '/output-style', '/add-dir', '/plugin', '/rewind', '/export', '/release-notes', '/upgrade',
]);

// ------------------------------------------------------------------ parser

class LineParser {
  readonly out: LineResult;
  private readonly withActivities: boolean;

  constructor(
    private readonly s: TranscriptState,
    private readonly ctx: ParseContext,
    private readonly j: Record<string, unknown>,
    private readonly at: number,
  ) {
    this.withActivities = ctx.activities !== false;
    this.out = { activities: [], signals: [], changed: false, at };
  }

  private nextId(suffix: string): string {
    const uuid = str(this.j.uuid);
    return `${this.ctx.idPrefix}#${uuid ?? `x${++this.s.seq}`}${suffix}`;
  }

  private push(desc: ActivityDescription, opts: { suffix?: string; tool?: string; toolUseId?: string; current?: boolean; durationMs?: number; msgId?: string } = {}): void {
    if (!this.withActivities) return;
    const activity: Activity = { id: this.nextId(opts.suffix ?? ''), at: this.at, ...desc };
    if (opts.tool) activity.tool = opts.tool;
    if (opts.durationMs !== undefined) activity.durationMs = opts.durationMs;
    if (desc.kind === 'error') activity.error = true;
    const current = opts.current ?? true;
    this.out.activities.push(opts.toolUseId ? { activity, current, toolUseId: opts.toolUseId } : { activity, current });
    if (current) this.s.current = { id: activity.id, toolUseId: opts.toolUseId, kind: desc.kind, at: this.at, msgId: opts.msgId };
  }

  private changed(): void {
    this.out.changed = true;
  }

  private taskOp(op: TaskOp): void {
    const s = this.s;
    if (op.op === 'replace') s.sawTaskReplace = true;
    s.tasks = applyTaskOp(s.tasks, op);
    s.taskOpsLog?.push(op);
    this.changed();
  }

  run(): void {
    const j = this.j;
    const branch = str(j.gitBranch);
    if (branch && branch !== 'HEAD' && branch !== this.s.gitBranch) {
      this.s.gitBranch = branch;
      this.changed();
    }
    switch (j.type) {
      case 'assistant':
        return this.assistant();
      case 'user':
        return this.user();
      case 'system':
        return this.system();
      case 'custom-title':
        return this.meta('customTitle', j.customTitle);
      case 'agent-name':
        return this.meta('agentName', j.agentName);
      case 'ai-title':
        return this.meta('aiTitle', j.aiTitle);
      case 'last-prompt': {
        const p = str(j.lastPrompt);
        if (p && !p.trimStart().startsWith('<')) this.meta('lastPrompt', truncate(maskSecrets(p.slice(0, 1_000)), 200));
        return;
      }
      case 'permission-mode':
        return this.meta('permissionMode', j.permissionMode);
      case 'fork-context-ref':
        this.s.fork = 'expect-spawn';
        return;
      case 'cost-state':
        return this.cost();
      case 'queue-operation': {
        const content = str(j.content);
        if (j.operation === 'enqueue' && content?.trimStart().startsWith('<task-notification>')) this.notification(content, false);
        return;
      }
      case 'attachment': {
        const att = j.attachment as Record<string, unknown> | undefined;
        const prompt = str(att?.prompt);
        if (att?.type === 'queued_command' && prompt?.trimStart().startsWith('<task-notification>')) this.notification(prompt, false);
        return;
      }
      default:
        return;
    }
  }

  private meta(key: 'customTitle' | 'agentName' | 'aiTitle' | 'lastPrompt' | 'permissionMode', v: unknown): void {
    const value = str(v)?.trim();
    if (!value || this.s[key] === value) return;
    this.s[key] = value;
    this.changed();
  }

  private cost(): void {
    const j = this.j;
    const stats = this.s.stats;
    if (typeof j.totalCostUSD === 'number') stats.costUSD = Math.round(j.totalCostUSD * 10_000) / 10_000;
    if (typeof j.totalLinesAdded === 'number') stats.linesAdded = j.totalLinesAdded;
    if (typeof j.totalLinesRemoved === 'number') stats.linesRemoved = j.totalLinesRemoved;
    this.s.costSeen = true;
    this.changed();
  }

  private usage(msgId: string, u: unknown): void {
    if (!u || typeof u !== 'object') return;
    const r = u as Record<string, unknown>;
    const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
    const tin = n(r.input_tokens) + n(r.cache_read_input_tokens) + n(r.cache_creation_input_tokens);
    const tout = n(r.output_tokens);
    const s = this.s;
    if (s.skipUsage?.has(msgId)) return;
    if (s.firstMsgIds && s.firstMsgIds.size < FIRST_MSG_IDS && !s.usageByMsg.has(msgId)) s.firstMsgIds.add(msgId);
    // Linhas da mesma mensagem repetem o uso (às vezes parcial): conta só o acréscimo.
    const prev = s.usageByMsg.get(msgId) ?? { tin: 0, tout: 0 };
    const dIn = Math.max(0, tin - prev.tin);
    const dOut = Math.max(0, tout - prev.tout);
    remember(s.usageByMsg, msgId, { tin: Math.max(tin, prev.tin), tout: Math.max(tout, prev.tout) }, 256);
    if (dIn || dOut) {
      s.stats.tokensIn += dIn;
      s.stats.tokensOut += dOut;
      this.changed();
    }
  }

  private assistant(): void {
    const j = this.j;
    const m = j.message as Record<string, unknown> | undefined;
    if (!m || typeof m !== 'object') return;
    const s = this.s;
    if (s.fork === 'expect-spawn') {
      // Cópia da chamada que criou o fork (vem do transcript do pai): não conta como atividade,
      // ferramenta, uso de tokens nem disparo de subagente do próprio fork.
      const spawn = Array.isArray(m.content)
        ? (m.content as Array<Record<string, unknown>>).find((b) => b?.type === 'tool_use' && (b.name === 'Agent' || b.name === 'Task'))
        : undefined;
      const id = spawn ? str(spawn.id) : undefined;
      if (id) {
        s.fork = 'expect-result';
        s.inheritedSpawn = id;
        return;
      }
      s.fork = undefined;
    }
    const model = str(m.model);
    if (model && model !== '<synthetic>' && model !== s.model) {
      s.model = model;
      this.changed();
    }
    const msgId = str(m.id) ?? str(j.requestId) ?? str(j.uuid) ?? `x${++s.seq}`;
    this.usage(msgId, m.usage);
    s.lastStopReason = typeof m.stop_reason === 'string' ? m.stop_reason : null;
    s.ended = m.stop_reason === 'end_turn' && s.pendingTools.size === 0;

    const blocks = Array.isArray(m.content) ? (m.content as Array<Record<string, unknown>>) : [];
    blocks.forEach((b, i) => {
      if (!b || typeof b !== 'object') return;
      const suffix = `:${i}`;
      if (b.type === 'thinking' || b.type === 'redacted_thinking') {
        // Um único "Pensando…" por mensagem.
        const cur = s.current;
        if (cur?.kind === 'think' && (cur.msgId === msgId || this.at - cur.at < 30_000)) return;
        this.push(SPECIAL.think(), { suffix, msgId });
      } else if (b.type === 'text') {
        const text = str(b.text);
        if (text) this.push(SPECIAL.respond(text), { suffix, msgId });
      } else if (b.type === 'tool_use') {
        this.toolUse(b, suffix, msgId);
      }
    });
  }

  private toolUse(b: Record<string, unknown>, suffix: string, msgId: string): void {
    const s = this.s;
    const name = str(b.name) ?? 'ferramenta';
    const id = str(b.id) ?? `${msgId}${suffix}`;
    const input = (b.input && typeof b.input === 'object' ? b.input : {}) as Record<string, unknown>;
    s.stats.toolCalls++;
    s.ended = false;
    remember(s.toolNames, id, name);
    remember(s.pendingTools, id, name, 128);
    this.changed();
    this.push(describeTool(name, input), { suffix, tool: name, toolUseId: id, msgId });
    const gh = githubCallOf(name, input);
    if (gh) remember(s.github, id, gh, 64);

    switch (name) {
      case 'Agent':
      case 'Task':
      case 'Workflow': {
        if (name !== 'Workflow') s.stats.subagents++;
        const spawn: SpawnInfo = { toolUseId: id, tool: name, background: truthy(input.run_in_background), at: this.at };
        const description = str(input.description);
        const subagentType = str(input.subagent_type);
        const agentName = str(input.name);
        if (description) spawn.description = description;
        if (subagentType) spawn.subagentType = subagentType;
        if (agentName) spawn.name = agentName;
        this.out.signals.push({ type: 'spawn', spawn });
        break;
      }
      case 'TodoWrite':
        this.taskOp({ op: 'replace', tasks: todosToTasks(input.todos) });
        break;
      case 'TaskCreate': {
        const title = str(input.subject) ?? str(input.description);
        if (!title) break;
        const tid = `pending:${id}`;
        remember(s.pendingTaskCreates, id, tid, 64);
        const af = str(input.activeForm);
        this.taskOp(af ? { op: 'create', id: tid, title: truncate(title, 120), activeForm: truncate(af, 120) } : { op: 'create', id: tid, title: truncate(title, 120) });
        break;
      }
      case 'TaskUpdate': {
        const tid = str(input.taskId) ?? (typeof input.taskId === 'number' ? String(input.taskId) : undefined);
        if (!tid) break;
        const status = typeof input.status === 'string' && (TASK_STATUSES.has(input.status) || input.status === 'deleted') ? (input.status as TaskStatus | 'deleted') : undefined;
        const op: TaskOp = { op: 'update', id: tid };
        if (status) op.status = status;
        const title = str(input.subject);
        if (title) op.title = truncate(title, 120);
        const af = str(input.activeForm);
        if (af) op.activeForm = truncate(af, 120);
        this.taskOp(op);
        break;
      }
      case 'TaskStop':
      case 'KillShell':
      case 'KillBash': {
        const tid = str(input.task_id) ?? str(input.taskId) ?? str(input.shell_id) ?? str(input.bash_id) ?? str(input.id);
        if (tid) remember(s.stopRequests, id, tid, 64);
        break;
      }
      case 'Bash':
      case 'Monitor': {
        const job = describeShellJob(name, input);
        const shell: ShellStart = {
          toolUseId: id,
          label: job.label,
          background: name === 'Monitor' || truthy(input.run_in_background),
          kind: job.kind,
          at: this.at,
        };
        if (job.command) shell.command = job.command;
        if (name === 'Monitor' && typeof input.timeout_ms === 'number' && Number.isFinite(input.timeout_ms)) shell.timeoutMs = input.timeout_ms;
        this.out.signals.push({ type: 'shellStart', shell });
        break;
      }
      default:
        break;
    }
  }

  private user(): void {
    const j = this.j;
    if (j.isMeta === true) return;
    const m = j.message as Record<string, unknown> | undefined;
    const content = m?.content;
    if (typeof content === 'string') return this.userText(content);
    if (!Array.isArray(content)) return;
    const texts: string[] = [];
    const results: Array<Record<string, unknown>> = [];
    for (const b of content as Array<Record<string, unknown>>) {
      if (!b || typeof b !== 'object') continue;
      if (b.type === 'tool_result') results.push(b);
      else if (b.type === 'text' && typeof b.text === 'string') texts.push(b.text);
    }
    if (this.s.fork === 'expect-result' && results.some((r) => str(r.tool_use_id) === this.s.inheritedSpawn)) {
      // Resultado da chamada herdada ("Fork started…"): não é o fim de nada. A instrução do fork vem
      // no texto, depois do bloco <fork-boilerplate>: é o "prompt" dele.
      this.s.fork = undefined;
      const directive = forkDirective(texts.join('\n'));
      if (directive) this.userText(directive);
      return;
    }
    const interrupted = texts.some((t) => INTERRUPTED.test(t.trimStart()));
    for (const r of results) this.toolResult(r, interrupted);
    if (interrupted) this.interrupted();
    else if (!results.length && texts.length) this.userText(texts.join('\n'));
  }

  private interrupted(): void {
    this.s.ended = true;
    this.s.pendingTools.clear();
    this.out.signals.push({ type: 'turnEnd' });
    this.push(SPECIAL.interrupted(), { suffix: ':int' });
  }

  private userText(raw: string): void {
    const text = raw.trimStart();
    if (!text) return;
    if (text.startsWith('<task-notification>')) return this.notification(text, true);
    if (INTERRUPTED.test(text)) return this.interrupted();
    if (SYSTEM_TAG.test(text) || text.startsWith('Caveat:')) return;
    let prompt = text;
    if (/^<command-(name|message|args)>/.test(text)) {
      const cmd = /<command-name>([\s\S]*?)<\/command-name>/.exec(text)?.[1]?.trim();
      const args = /<command-args>([\s\S]*?)<\/command-args>/.exec(text)?.[1]?.trim() ?? '';
      if (!cmd || LOCAL_COMMANDS.has(cmd)) return;
      prompt = `${cmd} ${args}`.trim();
    }
    this.s.ended = false;
    this.meta('lastPrompt', truncate(maskSecrets(prompt.slice(0, 1_000)), 200));
    this.push(describePrompt(prompt));
  }

  private notification(text: string, withActivity: boolean): void {
    const n = parseTaskNotification(text);
    const sig: TranscriptSignal = { type: 'notification' };
    if (n.toolUseId) sig.toolUseId = n.toolUseId;
    if (n.taskId) sig.taskId = n.taskId;
    if (n.status) sig.status = n.status;
    if (n.summary) sig.summary = n.summary;
    this.out.signals.push(sig);
    if (withActivity) this.push(SPECIAL.backgroundResult(n.summary));
    // CI lançado em segundo plano: o desfecho é o código de saída da notificação
    const gh = n.toolUseId ? this.s.github.get(n.toolUseId) : undefined;
    if (gh?.background && n.toolUseId) {
      this.s.github.delete(n.toolUseId);
      const event = detectGitHubNotification(gh, n.status, n.summary, this.s.gitBranch);
      if (event) this.out.signals.push({ type: 'github', event, toolUseId: n.toolUseId });
    }
  }

  private toolResult(b: Record<string, unknown>, interrupted: boolean): void {
    const s = this.s;
    const id = str(b.tool_use_id);
    if (!id) return;
    const name = s.toolNames.get(id);
    s.pendingTools.delete(id);
    const isError = b.is_error === true;
    const tur = (this.j.toolUseResult && typeof this.j.toolUseResult === 'object' ? this.j.toolUseResult : {}) as Record<string, unknown>;

    if (isError && !interrupted) {
      const content = textOf(b.content);
      if (REJECTED.test(content)) {
        this.push(SPECIAL.rejected(name), { suffix: `:r:${id}` });
      } else {
        // Só vira a atividade atual se for o erro da ferramenta em andamento.
        const current = !s.current || s.current.toolUseId === id;
        this.push(SPECIAL.error(name, firstLine(content)), { suffix: `:e:${id}`, tool: name, current });
      }
    }

    const isSpawn = name === 'Agent' || name === 'Task' || name === 'Workflow' || typeof tur.agentId === 'string' || typeof tur.runId === 'string';
    if (isSpawn) {
      const agentId = str(tur.agentId);
      const runId = str(tur.runId);
      if (tur.status === 'async_launched' || tur.isAsync === true) {
        const sig: TranscriptSignal = { type: 'launched', toolUseId: id };
        if (agentId) sig.agentId = agentId;
        if (runId) sig.runId = runId;
        const taskId = str(tur.taskId);
        if (taskId) sig.taskId = taskId;
        this.out.signals.push(sig);
      } else {
        const sig: TranscriptSignal = { type: 'finished', toolUseId: id, error: isError };
        if (agentId) sig.agentId = agentId;
        if (runId) sig.runId = runId;
        this.out.signals.push(sig);
      }
    }

    const provisional = s.pendingTaskCreates.get(id);
    if (provisional !== undefined) {
      s.pendingTaskCreates.delete(id);
      const task = tur.task && typeof tur.task === 'object' ? (tur.task as Record<string, unknown>) : undefined;
      const rawId = task?.id ?? tur.taskId ?? tur.id;
      const real =
        (typeof rawId === 'string' || typeof rawId === 'number' ? String(rawId) : undefined) ?? /#(\w+)/.exec(textOf(b.content))?.[1];
      if (real && real !== provisional) this.taskOp({ op: 'rename', from: provisional, to: real });
    }

    const stopped = s.stopRequests.get(id);
    if (stopped !== undefined) {
      s.stopRequests.delete(id);
      if (!isError) this.out.signals.push({ type: 'stopped', taskId: stopped });
    }

    // Bash/Monitor: em segundo plano o resultado traz o id da tarefa; em primeiro plano, é o fim do comando.
    const bgId = backgroundIdOf(tur, b.content, name);
    if (name === 'Bash' || name === 'Monitor' || (name === undefined && bgId)) {
      const sig: TranscriptSignal = { type: 'shellResult', toolUseId: id, error: isError };
      if (bgId && !isError) sig.taskId = bgId;
      this.out.signals.push(sig);
    }

    // Eventos do GitHub: em segundo plano, o desfecho chega na notificação de término.
    const gh = s.github.get(id);
    if (gh) {
      s.github.delete(id);
      if (bgId && !isError) remember(s.github, id, { ...gh, background: true }, 64);
      else {
        const event = detectGitHubResult(gh, { content: b.content, tur, isError, branch: s.gitBranch });
        if (event) this.out.signals.push({ type: 'github', event, toolUseId: id });
      }
    }
  }

  private system(): void {
    const j = this.j;
    switch (j.subtype) {
      case 'turn_duration': {
        const ms = typeof j.durationMs === 'number' ? j.durationMs : undefined;
        this.s.ended = true;
        this.out.signals.push({ type: 'turnEnd' });
        this.push(SPECIAL.turnDone(ms), ms !== undefined ? { durationMs: ms } : {});
        return;
      }
      case 'compact_boundary':
        this.push(SPECIAL.compact());
        return;
      case 'api_error':
        if (this.s.current?.kind === 'wait' && this.at - this.s.current.at < 60_000) return;
        this.push(SPECIAL.apiRetry());
        return;
      default:
        return;
    }
  }
}

/** Instrução de um fork: o texto depois do bloco <fork-boilerplate>, sem o rótulo "Your directive:". */
export function forkDirective(text: string): string {
  const end = text.lastIndexOf('</fork-boilerplate>');
  const rest = end >= 0 ? text.slice(end + '</fork-boilerplate>'.length) : text;
  return rest.trim().replace(/^your directive:\s*/i, '').trim();
}

/** Interpreta uma linha JSONL. Linhas inválidas ou desconhecidas não geram nada. */
export function parseLine(state: TranscriptState, raw: string, ctx: ParseContext): LineResult {
  let j: unknown;
  try {
    j = JSON.parse(raw);
  } catch {
    return { activities: [], signals: [], changed: false, at: ctx.now };
  }
  if (!j || typeof j !== 'object' || Array.isArray(j)) return { activities: [], signals: [], changed: false, at: ctx.now };
  const rec = j as Record<string, unknown>;
  const at = toMs(rec.timestamp);
  if (at !== undefined) {
    if (state.firstAt === undefined || at < state.firstAt) state.firstAt = at;
    if (state.lastAt === undefined || at > state.lastAt) state.lastAt = at;
  }
  const p = new LineParser(state, ctx, rec, at ?? ctx.now);
  p.run();
  return p.out;
}

/** Título exibido: custom-title > agent-name > ai-title > último prompt (truncado). */
export function titleOf(state: TranscriptState): string | undefined {
  const t = state.customTitle ?? state.agentName ?? state.aiTitle ?? state.lastPrompt;
  return t ? truncate(t, 90) : undefined;
}

// ------------------------------------------------------------------ prefixo do arquivo

// Linhas que importam para títulos/tarefas/estatísticas anteriores à janela lida no boot.
const PREFIX_MARKERS = [
  '"type":"assistant"',
  '"type":"custom-title"',
  '"type":"agent-name"',
  '"type":"ai-title"',
  '"type":"last-prompt"',
  '"type":"cost-state"',
  '"type":"permission-mode"',
  // Início de um fork: a cópia da chamada Agent do pai que vem logo depois não é dele.
  '"type":"fork-context-ref"',
  // Lançamentos em segundo plano (para casar a notificação de término com o subagente/workflow).
  '"async_launched"',
  // Shells em segundo plano: lançamento e término (para saber quais ainda rodam).
  '"backgroundTaskId"',
  '<task-notification>',
];

function prefixRelevant(state: TranscriptState, line: string): boolean {
  if (PREFIX_MARKERS.some((m) => line.includes(m))) return true;
  if ((state.pendingTaskCreates.size || state.stopRequests.size) && line.includes('"tool_result"')) {
    for (const id of state.pendingTaskCreates.keys()) if (line.includes(id)) return true;
    for (const id of state.stopRequests.keys()) if (line.includes(id)) return true;
  }
  return false;
}

/** Sinal de shell com o horário da linha que o gerou. */
export interface ShellEvent {
  signal: TranscriptSignal;
  at: number;
}

/**
 * Lê em stream (sem bloquear o event loop) os bytes [0, end) de um transcript, só para
 * recuperar títulos, tarefas e estatísticas anteriores à janela lida no boot — e os
 * lançamentos em segundo plano ('launched'), que casam notificações futuras com subagentes,
 * e os sinais de shells (`shellEvents`), para achar shells em segundo plano ainda abertos.
 * Com `keepActivities`, também devolve as últimas N atividades desse trecho (ids com `idPrefix`),
 * para a linha do tempo longa não começar só no fim do arquivo.
 */
export async function scanPrefix(
  path: string,
  end: number,
  skipUsage: ReadonlySet<string>,
  opts: { idPrefix?: string; keepActivities?: number } = {},
): Promise<{ state: TranscriptState; signals: TranscriptSignal[]; activities: Activity[]; shellEvents: ShellEvent[] }> {
  const state = createTranscriptState();
  const signals: TranscriptSignal[] = [];
  const shellEvents: ShellEvent[] = [];
  let activities: Activity[] = [];
  state.skipUsage = skipUsage;
  if (end <= 0) return { state, signals, activities, shellEvents };
  const keep = Math.max(0, opts.keepActivities ?? 0);
  const ctx: ParseContext = { idPrefix: opts.idPrefix ?? '', now: Date.now(), activities: keep > 0 };
  const take = (line: string) => {
    if (!keep && !prefixRelevant(state, line)) return;
    const r = parseLine(state, line, ctx);
    for (const sig of r.signals) {
      if (sig.type === 'launched') signals.push(sig);
      if (SHELL_SIGNALS.has(sig.type)) shellEvents.push({ signal: sig, at: r.at });
    }
    if (keep && r.activities.length) {
      for (const a of r.activities) activities.push(a.activity);
      if (activities.length > keep * 2) activities = activities.slice(-keep);
    }
  };
  const pending = new LineBuffer();
  let discarded = 0;
  const stream = createReadStream(path, { start: 0, end: end - 1, highWaterMark: 1024 * 1024 });
  for await (const chunk of stream as AsyncIterable<Buffer>) {
    const fed = pending.push(chunk);
    discarded += fed.discarded;
    for (const buf of fed.lines) {
      const line = buf.toString('utf8');
      if (line) take(line);
    }
  }
  const rest = pending.flush();
  if (rest?.length) {
    const line = rest.toString('utf8');
    if (line) take(line);
  }
  if (discarded) warnOversizedLine(path);
  state.skipUsage = undefined;
  return { state, signals, activities: activities.slice(-keep), shellEvents };
}

/** Mescla o que veio do prefixo do arquivo no estado montado a partir da janela final. */
export function mergePrefix(state: TranscriptState, prefix: TranscriptState): void {
  state.customTitle ??= prefix.customTitle;
  state.agentName ??= prefix.agentName;
  state.aiTitle ??= prefix.aiTitle;
  state.lastPrompt ??= prefix.lastPrompt;
  state.model ??= prefix.model;
  state.gitBranch ??= prefix.gitBranch;
  state.permissionMode ??= prefix.permissionMode;
  if (prefix.firstAt !== undefined && (state.firstAt === undefined || prefix.firstAt < state.firstAt)) state.firstAt = prefix.firstAt;
  if (!state.sawTaskReplace && state.taskOpsLog) state.tasks = state.taskOpsLog.reduce(applyTaskOp, prefix.tasks);
  state.taskOpsLog = null;
  state.stats.toolCalls += prefix.stats.toolCalls;
  state.stats.tokensIn += prefix.stats.tokensIn;
  state.stats.tokensOut += prefix.stats.tokensOut;
  state.stats.subagents += prefix.stats.subagents;
  if (!state.costSeen && prefix.costSeen) {
    state.costSeen = true;
    if (prefix.stats.costUSD !== undefined) state.stats.costUSD = prefix.stats.costUSD;
    if (prefix.stats.linesAdded !== undefined) state.stats.linesAdded = prefix.stats.linesAdded;
    if (prefix.stats.linesRemoved !== undefined) state.stats.linesRemoved = prefix.stats.linesRemoved;
  }
  state.firstMsgIds = null;
}
