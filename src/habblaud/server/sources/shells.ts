// Shells que os agentes de uma sessão estão esperando: Bash em segundo plano (run_in_background, ou
// mandado para o fundo no meio da execução), Bash em primeiro plano ainda sem resultado e Monitor.
//
// Um rastreador por sessão (principal + subagentes): a notificação de término de um shell disparado
// por um subagente pode chegar no transcript do principal, e vice-versa. Os jobs são indexados pelo
// id do tool_use; o id da tarefa em segundo plano ("bo0ov3q3l") chega no tool_result.
//
// Término: <task-notification> (queue-operation 'enqueue', mensagem user ou anexo) casando task-id
// ou tool-use-id; TaskStop/KillShell/KillBash com o id; fim de turno/interrupção (só os em primeiro
// plano); /clear ou sessão encerrada (rastreador descartado); idade.
import type { ShellJob } from '../../shared/types';
import type { ShellOutcome } from '../../shared/activity';

/** Jobs mais velhos que isso são descartados (o processo certamente já morreu ou a notificação se perdeu). */
export const SHELL_MAX_AGE_MS = 24 * 3_600_000;
/** Registro "idle" + shell em segundo plano sem notificação há menos disso = status 'shell' (CLIs antigas). */
export const SHELL_FALLBACK_MAX_AGE_MS = 12 * 3_600_000;
/** Monitor: expira sozinho depois do timeout_ms (padrão 5 min, teto 1 h) + esta folga. */
const MONITOR_DEFAULT_TIMEOUT_MS = 300_000;
const MONITOR_MAX_TIMEOUT_MS = 3_600_000;
const EXPIRY_GRACE_MS = 60_000;
/** Tolerância entre o relógio do transcript e o início do processo no registro. */
const PROCESS_START_SLACK_MS = 2_000;
/** Ids já encerrados guardados (para não ressuscitar um job ao reler o transcript ou mesclar o começo do arquivo). */
const MAX_ENDED = 2_000;
/** Uma notificação repetida (fila -> mensagem) até este tempo depois do fim ainda é "do mesmo término". */
const RECENT_END_MS = 120_000;

/** Início de um Bash/Monitor visto no transcript. */
export interface ShellStart {
  toolUseId: string;
  label: string;
  command?: string;
  /** run_in_background (Bash) ou Monitor. */
  background: boolean;
  kind: 'shell' | 'monitor';
  /** Epoch ms do tool_use. */
  at: number;
  /** timeout_ms do Monitor (expiração). */
  timeoutMs?: number;
}

export interface TrackedShell {
  owner: string;
  toolUseId: string;
  taskId?: string;
  label: string;
  command?: string;
  background: boolean;
  kind: 'shell' | 'monitor';
  /** Início mostrado (o lançamento real, quando o tool_result de um job em segundo plano chega). */
  startedAt: number;
  /** Quando o tool_use foi escrito (base do filtro "anterior ao processo atual"). */
  requestedAt: number;
  timeoutMs?: number;
  /** Primeiro plano esperando aprovação: não aparece e o relógio dele não anda. */
  held?: boolean;
}

export interface ShellFinish {
  job: TrackedShell;
  outcome: ShellOutcome;
  at: number;
  summary?: string;
}

export interface ShellRef {
  toolUseId?: string;
  taskId?: string;
}

const OK = /^(completed?|success|succeeded|done|finished|exited)$/i;
const FAILED = /^(failed|failure|error|errored|timeout|timed[_ -]?out)$/i;
const KILLED = /^(killed|stopped|cancell?ed|aborted|interrupted|terminated)$/i;

/**
 * Resultado de uma notificação: undefined = não terminal (ex.: evento de um Monitor). Sem status,
 * um shell (Bash) só manda uma notificação — a do fim; um Monitor manda uma por evento.
 */
export function notificationOutcome(kind: 'shell' | 'monitor', status: string | undefined, summary: string | undefined): ShellOutcome | undefined {
  const s = status?.trim();
  const exit = summary ? /exit code (-?\d+)/i.exec(summary)?.[1] : undefined;
  if (s && OK.test(s)) return exit !== undefined && exit !== '0' ? 'failed' : 'ok';
  if (s && FAILED.test(s)) return 'failed';
  if (s && KILLED.test(s)) return 'killed';
  if (s || kind === 'monitor') return undefined;
  if (summary && /\b(killed|stopped|interrupted|cancell?ed)\b/i.test(summary)) return 'killed';
  if (summary && /\bfailed\b/i.test(summary)) return 'failed';
  return exit !== undefined && exit !== '0' ? 'failed' : 'ok';
}

export class ShellTracker {
  private jobs = new Map<string, TrackedShell>();
  private taskToTool = new Map<string, string>();
  /** tool_use id / task id já encerrados -> quando. */
  private ended = new Map<string, number>();
  /** Lançamentos cujo tool_use não está na janela lida (casados ao mesclar o começo do arquivo). */
  private orphanLaunches = new Map<string, { taskId?: string; at: number }>();
  /** Ids de shells cujo término já foi informado (notificação/TaskStop) -> quando. */
  private reported = new Map<string, number>();

  get size(): number {
    return this.jobs.size;
  }

  /** Bash/Monitor chamado. Ignora o que já terminou (releitura do transcript). */
  start(owner: string, s: ShellStart): void {
    if (this.jobs.has(s.toolUseId) || this.ended.has(s.toolUseId)) return;
    const job: TrackedShell = {
      owner,
      toolUseId: s.toolUseId,
      label: s.label,
      background: s.background,
      kind: s.kind,
      startedAt: s.at,
      requestedAt: s.at,
    };
    if (s.command) job.command = s.command;
    if (s.timeoutMs !== undefined) job.timeoutMs = s.timeoutMs;
    this.jobs.set(s.toolUseId, job);
    const orphan = this.orphanLaunches.get(s.toolUseId);
    if (orphan) {
      this.orphanLaunches.delete(s.toolUseId);
      this.launch(job, orphan.taskId, orphan.at);
    }
  }

  /**
   * tool_result do Bash/Monitor. Com id de tarefa em segundo plano (ou se já era em segundo plano), o job
   * passa a esperar a notificação; senão (primeiro plano terminou, erro, recusa) sai da lista.
   */
  result(toolUseId: string, opts: { taskId?: string; error: boolean; at: number }): void {
    const job = this.jobs.get(toolUseId);
    if (!job) {
      if (opts.taskId && !opts.error && !this.ended.has(toolUseId)) {
        this.orphanLaunches.set(toolUseId, { taskId: opts.taskId, at: opts.at });
        if (this.orphanLaunches.size > 256) this.orphanLaunches.delete(this.orphanLaunches.keys().next().value as string);
      }
      return;
    }
    if (opts.error || (!job.background && !opts.taskId)) {
      this.remove(job, opts.at);
      return;
    }
    this.launch(job, opts.taskId, opts.at);
  }

  private launch(job: TrackedShell, taskId: string | undefined, at: number): void {
    if (taskId && this.ended.has(taskId)) {
      this.remove(job, at);
      return;
    }
    // Pedido em segundo plano: começa de fato no lançamento (depois de uma eventual aprovação). Mandado
    // para o fundo no meio da execução (primeiro plano): continua contando desde o início.
    if (job.background) job.startedAt = Math.max(job.startedAt, at);
    job.background = true;
    delete job.held;
    if (taskId) {
      job.taskId = taskId;
      this.taskToTool.set(taskId, job.toolUseId);
    }
  }

  private find(ref: ShellRef): TrackedShell | undefined {
    if (ref.toolUseId) {
      const j = this.jobs.get(ref.toolUseId);
      if (j) return j;
    }
    if (ref.taskId) {
      const tool = this.taskToTool.get(ref.taskId);
      if (tool) return this.jobs.get(tool);
    }
    return undefined;
  }

  private markEnded(id: string | undefined, at: number): void {
    if (!id) return;
    this.ended.delete(id);
    this.ended.set(id, at);
    if (this.ended.size > MAX_ENDED) this.ended.delete(this.ended.keys().next().value as string);
  }

  private remove(job: TrackedShell, at: number): void {
    this.jobs.delete(job.toolUseId);
    if (job.taskId) this.taskToTool.delete(job.taskId);
    this.markEnded(job.toolUseId, at);
    this.markEnded(job.taskId, at);
  }

  /** <task-notification>: devolve o término (uma vez só) de um job conhecido. */
  notify(ref: ShellRef & { status?: string; summary?: string; at: number }): ShellFinish | undefined {
    const job = this.find(ref);
    if (!job) {
      // Desconhecido (subagente, ou o tool_use ficou antes da janela lida): lembra para não ressuscitar.
      if (!ref.status || OK.test(ref.status) || FAILED.test(ref.status) || KILLED.test(ref.status)) {
        this.markEnded(ref.toolUseId, ref.at);
        this.markEnded(ref.taskId, ref.at);
      }
      return undefined;
    }
    const outcome = notificationOutcome(job.kind, ref.status, ref.summary);
    if (!outcome) return undefined;
    this.remove(job, ref.at);
    this.markReported(job, ref.at);
    const fin: ShellFinish = { job, outcome, at: ref.at };
    if (ref.summary) fin.summary = ref.summary;
    return fin;
  }

  private markReported(job: TrackedShell, at: number): void {
    for (const id of [job.toolUseId, job.taskId]) {
      if (!id) continue;
      this.reported.set(id, at);
      if (this.reported.size > 256) this.reported.delete(this.reported.keys().next().value as string);
    }
  }

  /** TaskStop/KillShell/KillBash aceito. */
  stop(taskId: string, at: number): ShellFinish | undefined {
    const job = this.find({ taskId, toolUseId: taskId });
    if (!job) {
      this.markEnded(taskId, at);
      return undefined;
    }
    this.remove(job, at);
    this.markReported(job, at);
    return { job, outcome: 'killed', at };
  }

  /** Fim de turno ou interrupção: nenhum comando em primeiro plano continua rodando. */
  endForeground(owner: string | undefined, at: number): void {
    for (const job of [...this.jobs.values()]) if (!job.background && (owner === undefined || job.owner === owner)) this.remove(job, at);
  }

  /**
   * A sessão espera aprovação (registro 'waiting'): comandos em primeiro plano ainda não começaram —
   * somem da lista e o relógio deles recomeça quando a espera acabar.
   */
  holdForeground(waiting: boolean, now: number): void {
    for (const job of this.jobs.values()) {
      if (job.background) continue;
      if (waiting) {
        job.held = true;
        job.startedAt = Math.max(job.startedAt, now);
      } else delete job.held;
    }
  }

  /**
   * O término deste shell já foi informado há pouco (ex.: a fila avisou e agora a mesma notificação é
   * entregue ao agente)? Só vale para shells rastreados (não para subagentes).
   */
  reportedRecently(ref: ShellRef, at: number): boolean {
    for (const id of [ref.toolUseId, ref.taskId]) {
      const t = id ? this.reported.get(id) : undefined;
      if (t !== undefined && Math.abs(at - t) <= RECENT_END_MS) return true;
    }
    return false;
  }

  /**
   * Descarta o que não pode estar rodando: mais de 24 h, anterior ao processo atual do Claude Code
   * (shells morrem com ele — ex.: sessão retomada) e monitores além do próprio timeout.
   */
  prune(now: number, processStart?: number): boolean {
    let changed = false;
    for (const job of [...this.jobs.values()]) {
      let drop = now - job.requestedAt > SHELL_MAX_AGE_MS;
      if (processStart !== undefined && job.requestedAt < processStart - PROCESS_START_SLACK_MS) drop = true;
      if (job.kind === 'monitor') {
        const limit = Math.min(job.timeoutMs ?? MONITOR_DEFAULT_TIMEOUT_MS, MONITOR_MAX_TIMEOUT_MS);
        if (now - job.startedAt > limit + EXPIRY_GRACE_MS) drop = true;
      }
      if (drop) {
        this.remove(job, now);
        changed = true;
      }
    }
    return changed;
  }

  /** Há Bash em segundo plano rodando (iniciado há menos de `maxAgeMs`)? Monitores não contam (como no Claude Code). */
  hasBackgroundShell(now: number, maxAgeMs = SHELL_FALLBACK_MAX_AGE_MS): boolean {
    for (const job of this.jobs.values()) if (job.background && job.kind === 'shell' && now - job.startedAt < maxAgeMs) return true;
    return false;
  }

  /**
   * O registro (versão que grava "shell") diz que não há shell em segundo plano rodando: o que sobrou aqui
   * perdeu a notificação. Descarta os Bash em segundo plano (monitores não entram nessa conta do Claude Code).
   */
  dropBackgroundShells(now: number): boolean {
    let changed = false;
    for (const job of [...this.jobs.values()]) {
      if (!job.background || job.kind !== 'shell') continue;
      this.remove(job, now);
      changed = true;
    }
    return changed;
  }

  /** Jobs visíveis (sem os em primeiro plano aguardando aprovação), do mais antigo para o mais novo. */
  list(): TrackedShell[] {
    return [...this.jobs.values()].filter((j) => !j.held).sort((a, b) => a.startedAt - b.startedAt || a.toolUseId.localeCompare(b.toolUseId));
  }

  /**
   * Jobs em segundo plano que ficaram abertos no começo do arquivo (lido depois da janela do fim): entram,
   * a não ser que a janela já tenha mostrado o término deles.
   */
  merge(jobs: readonly TrackedShell[]): boolean {
    let changed = false;
    for (const j of jobs) {
      if (!j.background || this.jobs.has(j.toolUseId) || this.ended.has(j.toolUseId) || (j.taskId && this.ended.has(j.taskId))) continue;
      const job: TrackedShell = { ...j };
      this.jobs.set(job.toolUseId, job);
      const orphan = this.orphanLaunches.get(job.toolUseId);
      if (orphan) {
        this.orphanLaunches.delete(job.toolUseId);
        this.launch(job, orphan.taskId, orphan.at);
      } else if (job.taskId) this.taskToTool.set(job.taskId, job.toolUseId);
      changed = true;
    }
    return changed;
  }

  /** Jobs em segundo plano ainda abertos (para mesclar o começo do arquivo). */
  openBackground(): TrackedShell[] {
    return [...this.jobs.values()].filter((j) => j.background).map((j) => ({ ...j }));
  }
}

/** ShellJob publicado (sem os campos internos). */
export function toShellJob(j: TrackedShell): ShellJob {
  const job: ShellJob = { id: j.taskId ?? j.toolUseId, label: j.label, startedAt: j.startedAt, background: j.background, kind: j.kind };
  if (j.command) job.command = j.command;
  return job;
}
