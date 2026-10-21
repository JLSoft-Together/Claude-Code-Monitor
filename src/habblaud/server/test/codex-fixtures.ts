// Construtores de linhas SINTÉTICAS de rollout do Codex (formatos paginated e legacy) e de um CODEX_HOME temporário
// (sessions/AAAA/MM/DD/rollout-*.jsonl, archived_sessions/ e thread-writer-locks/), para testes. Os formatos seguem o
// código do Codex 0.162 (codex-rs/protocol); nada aqui vem de conversas reais.
import { mkdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { appendLines, tempDir, writeLines } from './fixtures';

/** Id de thread sintético (UUID v7 de mentira). */
export function threadId(n: number): string {
  return `0199b0c0-0000-7000-8000-${String(n).padStart(12, '0')}`;
}

const ts = (at: number) => new Date(at).toISOString();

function line(type: string, payload: Record<string, unknown>, at: number): string {
  return JSON.stringify({ timestamp: ts(at), type, payload });
}

function item(thread: string, turn: string, it: Record<string, unknown>, at: number): string {
  return line('event_msg', { type: 'item_completed', thread_id: thread, turn_id: turn, item: it, started_at_ms: at - 10, completed_at_ms: at }, at);
}

export interface MetaOpts {
  at?: number;
  cwd?: string;
  /** null = sem history_mode (legacy). */
  history?: 'paginated' | 'legacy' | null;
  source?: unknown;
  sessionId?: string;
  branch?: string;
  threadSource?: string;
}

export interface RateLimitsOpts {
  /** null = sem cota (rate_limit_reached_type). */
  primary?: { used: number; minutes?: number; resetsAt?: number } | null;
  secondary?: { used: number; minutes?: number; resetsAt?: number } | null;
  plan?: string;
  reached?: string;
}

/** Linhas de rollout. `t` = id do thread; `turn` = id do turno. */
export const R = {
  meta(t: string, o: MetaOpts = {}): string {
    const payload: Record<string, unknown> = {
      session_id: o.sessionId ?? t,
      id: t,
      timestamp: ts(o.at ?? Date.now()),
      cwd: o.cwd ?? '/projetos/loja',
      originator: 'codex_cli_rs',
      cli_version: '0.162.0',
      source: o.source ?? 'cli',
      model_provider: 'openai',
      base_instructions: { text: 'Instruções base sintéticas. '.repeat(40) },
      git: { branch: o.branch ?? 'main', commit_hash: 'abc123' },
    };
    if (o.history !== null) payload.history_mode = o.history ?? 'paginated';
    if (o.threadSource) payload.thread_source = o.threadSource;
    return line('session_meta', payload, o.at ?? Date.now());
  },
  turnContext(o: { at?: number; cwd?: string; model?: string } = {}): string {
    return line('turn_context', { cwd: o.cwd ?? '/projetos/loja', model: o.model ?? 'gpt-teste-codex', effort: 'medium', approval_policy: 'on-request' }, o.at ?? Date.now());
  },
  taskStarted(turn: string, at = Date.now(), trigger?: string): string {
    const p: Record<string, unknown> = { type: 'task_started', turn_id: turn, started_at: Math.floor(at / 1000), model_context_window: 200_000 };
    if (trigger) p.turn_attribution = { turn_trigger: trigger };
    return line('event_msg', p, at);
  },
  taskComplete(turn: string, at = Date.now(), durationMs = 4_000): string {
    return line('event_msg', { type: 'task_complete', turn_id: turn, last_agent_message: 'pronto', duration_ms: durationMs }, at);
  },
  turnAborted(turn: string, at = Date.now(), reason = 'interrupted'): string {
    return line('event_msg', { type: 'turn_aborted', turn_id: turn, reason }, at);
  },
  user(t: string, turn: string, id: string, text: string, at = Date.now()): string {
    return item(t, turn, { type: 'UserMessage', id, content: [{ type: 'text', text, text_elements: [] }] }, at);
  },
  agent(t: string, turn: string, id: string, text: string, at = Date.now(), phase = 'final_answer'): string {
    return item(t, turn, { type: 'AgentMessage', id, content: [{ type: 'Text', text }], phase }, at);
  },
  reasoning(t: string, turn: string, id: string, summary: string[], at = Date.now()): string {
    return item(t, turn, { type: 'Reasoning', id, summary_text: summary, raw_content: [] }, at);
  },
  command(t: string, turn: string, id: string, script: string, o: { exit?: number; output?: string; status?: string; at?: number } = {}): string {
    const exit = o.exit ?? 0;
    return item(
      t,
      turn,
      {
        type: 'CommandExecution',
        id,
        command: ['/bin/zsh', '-lc', script],
        cwd: 'file:///projetos/loja',
        parsed_cmd: [{ type: 'unknown', cmd: script }],
        source: 'agent',
        status: o.status ?? (exit === 0 ? 'completed' : 'failed'),
        aggregated_output: o.output ?? '',
        exit_code: exit,
        duration: { secs: 1, nanos: 0 },
      },
      o.at ?? Date.now(),
    );
  },
  /** FileChange no formato do rollout: mapa {caminho: {type: add|delete|update, ...}}. */
  fileChange(t: string, turn: string, id: string, changes: Record<string, Record<string, unknown>>, o: { status?: string; at?: number } = {}): string {
    return item(t, turn, { type: 'FileChange', id, changes, status: o.status ?? 'completed' }, o.at ?? Date.now());
  },
  mcp(t: string, turn: string, id: string, server: string, tool: string, args: Record<string, unknown>, o: { result?: string; error?: string; at?: number } = {}): string {
    const it: Record<string, unknown> = { type: 'McpToolCall', id, server, tool, arguments: args, status: o.error ? 'failed' : 'completed' };
    if (o.result !== undefined) it.result = { content: [{ type: 'text', text: o.result }] };
    if (o.error) it.error = { message: o.error };
    return item(t, turn, it, o.at ?? Date.now());
  },
  tokens(o: { input: number; cached?: number; output: number; reasoning?: number; at?: number; rateLimits?: RateLimitsOpts }): string {
    const usage = {
      input_tokens: o.input,
      cached_input_tokens: o.cached ?? 0,
      cache_write_input_tokens: 0,
      output_tokens: o.output,
      reasoning_output_tokens: o.reasoning ?? 0,
      total_tokens: o.input + o.output,
    };
    const p: Record<string, unknown> = { type: 'token_count', info: { total_token_usage: usage, last_token_usage: usage, model_context_window: 200_000 } };
    if (o.rateLimits) p.rate_limits = R.rateLimits(o.rateLimits);
    return line('event_msg', p, o.at ?? Date.now());
  },
  rateLimits(o: RateLimitsOpts): Record<string, unknown> {
    const win = (w: RateLimitsOpts['primary'], minutes: number) =>
      w ? { used_percent: w.used, window_minutes: w.minutes ?? minutes, resets_at: w.resetsAt ?? 2_000_000_000 } : null;
    return {
      limit_id: 'codex',
      limit_name: null,
      primary: o.primary === undefined ? win({ used: 12.5 }, 300) : win(o.primary, 300),
      secondary: o.secondary === undefined ? win({ used: 40 }, 10080) : win(o.secondary, 10080),
      credits: { has_credits: false, unlimited: false, balance: null },
      plan_type: o.plan ?? 'plus',
      rate_limit_reached_type: o.reached ?? null,
    };
  },
  functionCall(callId: string, name: string, args: Record<string, unknown>, at = Date.now(), namespace?: string): string {
    const p: Record<string, unknown> = { type: 'function_call', name, arguments: JSON.stringify(args), call_id: callId };
    if (namespace) p.namespace = namespace;
    return line('response_item', p, at);
  },
  customToolCall(callId: string, name: string, input: string, at = Date.now()): string {
    return line('response_item', { type: 'custom_tool_call', name, input, call_id: callId, status: 'completed' }, at);
  },
  functionOutput(callId: string, output: string, at = Date.now()): string {
    return line('response_item', { type: 'function_call_output', call_id: callId, output }, at);
  },
  /** Mensagem de contexto (developer/user/assistant) mandada ao modelo: não é a conversa. */
  message(role: string, text: string, at = Date.now()): string {
    return line('response_item', { type: 'message', role, content: [{ type: role === 'assistant' ? 'output_text' : 'input_text', text }] }, at);
  },
  /**
   * Resposta entregue no code mode do app: response_item message/assistant com o marcador em `metadata` (no
   * "incomplete", o texto cortado vem no próprio marcador). `callId` = a chamada user_messaging.send_message.
   */
  delivered(callId: string, text: string, at = Date.now(), complete = true): string {
    return JSON.stringify({
      timestamp: ts(at),
      type: 'response_item',
      payload: {
        type: 'message',
        id: callId,
        role: 'assistant',
        content: [{ type: 'output_text', text: complete ? text : 'The content of a confirmed assistant message is unavailable.' }],
      },
      metadata: { delivered_assistant_message: complete ? 'codex:code-mode-delivery:v1:complete' : `codex:code-mode-delivery:v1:incomplete:${text}`, user_input_order: 3 },
    });
  },
  // ---- legacy
  legacyUser(text: string, at = Date.now()): string {
    return line('event_msg', { type: 'user_message', message: text, images: null }, at);
  },
  legacyAgent(text: string, at = Date.now()): string {
    return line('event_msg', { type: 'agent_message', message: text }, at);
  },
  legacyReasoning(text: string, at = Date.now()): string {
    return line('event_msg', { type: 'agent_reasoning', text }, at);
  },
};

/** session_meta.source de um subagente (thread_spawn) e de threads internos, como o Codex grava. */
export const SOURCES = {
  sub: (parent: string, role = 'explorer') => ({ subagent: { thread_spawn: { parent_thread_id: parent, depth: 1, agent_nickname: 'Kepler', agent_role: role } } }),
  guardian: () => ({ subagent: { other: 'guardian' } }),
  internal: () => ({ internal: 'guardian' }),
  review: () => ({ subagent: 'review' }),
};

/** Um CODEX_HOME temporário (apagado com `cleanup`). */
export function codexHome(name = '.codex') {
  const tmp = tempDir('habblaud-codex-');
  const dir = join(tmp.dir, name);
  mkdirSync(join(dir, 'sessions'), { recursive: true });
  mkdirSync(join(dir, 'thread-writer-locks'), { recursive: true });
  const ctx = {
    home: tmp.dir,
    dir,
    cleanup: tmp.cleanup,
    /** Grava o rollout de um thread (sessions/AAAA/MM/DD por padrão; `archived` em archived_sessions/). */
    rollout(t: string, lines: string[], o: { date?: string; archived?: boolean; mtime?: number } = {}): string {
      const date = o.date ?? '2026/10/09';
      const base = o.archived ? join(dir, 'archived_sessions') : join(dir, 'sessions', ...date.split('/'));
      const path = join(base, `rollout-${date.replace(/\//g, '-')}T09-00-00-${t}.jsonl`);
      writeLines(path, lines);
      if (o.mtime !== undefined) utimesSync(path, o.mtime / 1000, o.mtime / 1000);
      return path;
    },
    append(path: string, lines: string[]): void {
      appendLines(path, lines);
    },
    /** Cria o lock do thread; `createdAt` (epoch ms) recua o mtime (o Codex nunca escreve no lock). */
    lock(t: string, createdAt?: number): string {
      const path = join(dir, 'thread-writer-locks', `${t}.lock`);
      writeFileSync(path, '');
      if (createdAt !== undefined) utimesSync(path, createdAt / 1000, createdAt / 1000);
      return path;
    },
    unlock(t: string): void {
      rmSync(join(dir, 'thread-writer-locks', `${t}.lock`), { force: true });
    },
    touch(path: string, at: number): void {
      utimesSync(path, at / 1000, at / 1000);
    },
  };
  return ctx;
}
