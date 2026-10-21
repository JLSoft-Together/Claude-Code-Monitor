// Fonte de agentes do Claude Code (AgentSource 'claude', ver sources/source.ts).
// Observa as sessões ABERTAS do Claude Code em todas as contas e alimenta o Office:
// registro de sessões (status), transcript da sessão (atividades, tarefas, números) e
// subagentes (arquivos em <sessão>/subagents/, inclusive os de workflows).
//
// Desempenho: o polling de ~1 s toca só nos registros de sessão, nos transcripts das sessões
// abertas e nas pastas subagents/ dessas sessões (nunca no acervo de transcripts antigos).
// fs.watch é só um acelerador (no Docker com bind mount do macOS os eventos podem não chegar).
import { existsSync, readdirSync, readFileSync, statSync, watch, type FSWatcher } from 'node:fs';
import { join } from 'node:path';
import { SPECIAL } from '../../shared/activity';
import type { Activity, AgentStatus, SourceInfo } from '../../shared/types';
import type { AccountsService } from '../accounts/service';
import { errMsg, log } from '../log';
import type { Office, TranscriptSummary } from '../model/office';
import { compareVersions, registryStatus, RegistryReader, SHELL_STATUS_VERSION, type RegistryEntry } from './registry';
import { SHELL_FALLBACK_MAX_AGE_MS, ShellTracker, toShellJob, type ShellFinish } from './shells';
import type { AgentSource } from './source';
import {
  BOOT_RECENT_MS,
  concludedByIdle,
  PENDING_TOOL_TIMEOUT_MS,
  listSubagentFiles,
  parseJournal,
  readSubagentMeta,
  sessionDirOf,
  subagentRole,
  type JournalAgent,
  type SubagentFile,
  type SubagentMeta,
} from './subagents';
import { FileTail } from './tail';
import {
  createTranscriptState,
  mergePrefix,
  parseLine,
  scanPrefix,
  titleOf,
  type LineResult,
  type ParseContext,
  type ShellEvent,
  type SpawnInfo,
  type TranscriptSignal,
  type TranscriptState,
} from './transcript';
import { tr } from '../../shared/i18n';

export interface WatcherOptions {
  accounts: AccountsService;
  office: Office;
  inDocker: boolean;
  now?: () => number;
  pollMs?: number;
  /** Quanto do fim de cada transcript é lido ao abrir a sessão (padrão 1 MB). */
  tailBytes?: number;
  isAlive?: (pid: number) => boolean;
  /** Desliga o fs.watch (testes). */
  watch?: boolean;
}

/** cwd -> nome da pasta em projects/ (todo caractere não alfanumérico vira "-"). */
export function encodeCwd(cwd: string): string {
  return cwd.replace(/[^a-zA-Z0-9]/g, '-');
}

/** Sem status no registro (versões antigas): deduz pelo transcript. */
function statusFromTranscript(state: TranscriptState, now: number): AgentStatus {
  if (state.ended) return 'idle';
  return state.lastAt !== undefined && now - state.lastAt < 90_000 ? 'working' : 'idle';
}

/** Aplica um sinal ao rastreador de shells; devolve o término de um job, quando houver. */
function applyShellSignal(shells: ShellTracker, owner: string, sig: TranscriptSignal, at: number): ShellFinish | undefined {
  switch (sig.type) {
    case 'shellStart':
      shells.start(owner, sig.shell);
      return undefined;
    case 'shellResult':
      shells.result(sig.toolUseId, { taskId: sig.taskId, error: sig.error, at });
      return undefined;
    case 'turnEnd':
      shells.endForeground(owner, at);
      return undefined;
    case 'notification':
      return shells.notify({ toolUseId: sig.toolUseId, taskId: sig.taskId, status: sig.status, summary: sig.summary, at });
    case 'stopped':
      return shells.stop(sig.taskId, at);
    default:
      return undefined;
  }
}

interface SubTracker {
  agentId: string;
  id: string;
  file: SubagentFile;
  meta?: SubagentMeta;
  tail: FileTail;
  state: TranscriptState;
}

interface SessionTracker {
  key: string;
  accountId: string;
  dir: string;
  entry: RegistryEntry;
  sessionId: string;
  transcriptPath?: string;
  nextResolveAt: number;
  tail?: FileTail;
  state: TranscriptState;
  customTitleFile?: string;
  subs: Map<string, SubTracker>;
  /** Arquivos de subagentes já vistos e fora do escritório: tamanho conhecido. */
  known: Map<string, number>;
  spawns: Map<string, SpawnInfo & { owner: string }>;
  launched: Map<string, { agentId?: string; runId?: string }>;
  taskToTool: Map<string, string>;
  runToTool: Map<string, string>;
  finishedTools: Set<string>;
  finishedAgents: Set<string>;
  finishedRuns: Set<string>;
  journals: Map<string, { size: number; agents: Map<string, JournalAgent> }>;
  /** Shells (Bash/Monitor) que o principal e os subagentes desta sessão estão esperando. */
  shells: ShellTracker;
  workflowAgents: number;
  lastSubScanAt: number;
  /** A pasta de subagentes já foi varrida ao menos uma vez. */
  scanned: boolean;
  watchers: FSWatcher[];
  /** fs.watch da pasta subagents/ já instalado (ela pode surgir depois do transcript). */
  watchingSubs: boolean;
  /** Quando a sessão deixou de aparecer no registro. */
  missingSince?: number;
  /** Desde quando o registro (de uma versão que grava "shell") diz "idle". */
  idleSince?: number;
}

const MAX_SET = 2_000;
/** Texto da atividade "Recebeu resultado em segundo plano" (entrega de uma <task-notification>). */
const BACKGROUND_RESULT_TEXT = SPECIAL.backgroundResult().text;
/** Atividades recuperadas do começo do transcript do principal para a linha do tempo longa. */
const PREFIX_HISTORY = 120;
/** Tempo que uma sessão precisa ficar fora do registro para ser dada como encerrada. */
const CLOSE_AFTER_MISSING_MS = 1_500;
/**
 * Registro "idle" (de uma versão que grava "shell") por este tempo = nenhum shell em segundo plano rodando;
 * a folga cobre a notificação de término ainda a caminho do transcript.
 */
const IDLE_CLEARS_SHELLS_MS = 30_000;

function addBounded(set: Set<string>, v: string): void {
  set.add(v);
  if (set.size > MAX_SET) set.delete(set.values().next().value as string);
}

/** Uma linha que falha não descarta as demais já consumidas pelo tail. */
function parseWatchedLine(state: TranscriptState, line: string, ctx: ParseContext): LineResult {
  try {
    return parseLine(state, line, ctx);
  } catch (err) {
    log.warnOnce(`line:${ctx.idPrefix}:${errMsg(err)}`, tr('Linha do transcript de {0} ignorada: {1}', [ctx.idPrefix, errMsg(err)]));
    return { activities: [], signals: [], changed: false, at: ctx.now };
  }
}

export class ClaudeWatcher implements AgentSource {
  readonly provider = 'claude' as const;
  private readers = new Map<string, RegistryReader>();
  private sessions = new Map<string, SessionTracker>();
  private sourceInfo = new Map<string, SourceInfo>();
  private dirWatchers = new Map<string, FSWatcher>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private kick: ReturnType<typeof setTimeout> | null = null;
  private lastPollAt = 0;
  private prefixChain: Promise<void> = Promise.resolve();
  private readonly now: () => number;
  private readonly tailBytes: number;
  private readonly useWatch: boolean;
  private stopped = false;
  /** Menor versão do Claude Code vista gravando "shell" no registro (começa na conhecida). */
  private shellStatusVersion = SHELL_STATUS_VERSION;

  constructor(private readonly opts: WatcherOptions) {
    this.now = opts.now ?? Date.now;
    this.tailBytes = opts.tailBytes ?? 1024 * 1024;
    this.useWatch = opts.watch ?? true;
  }

  /** Boot + polling periódico. */
  start(): void {
    this.boot();
    this.timer = setInterval(() => this.safePoll(), this.opts.pollMs ?? 1_000);
    this.timer.unref?.();
  }

  /** Reconstrói as sessões abertas sem gerar avisos (o feed sai em ordem cronológica). Síncrono. */
  boot(): void {
    this.opts.office.beginBoot();
    try {
      this.poll(true);
    } finally {
      this.opts.office.endBoot();
    }
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    if (this.kick) clearTimeout(this.kick);
    this.timer = null;
    this.kick = null;
    for (const w of this.dirWatchers.values()) w.close();
    this.dirWatchers.clear();
    for (const t of this.sessions.values()) this.closeWatchers(t);
  }

  sources(): SourceInfo[] {
    return this.opts.accounts.entries().map(
      (e) => this.sourceInfo.get(e.dir) ?? { label: e.id, path: e.detected.configDir, sessions: 0, ok: true },
    );
  }

  /**
   * Caminho do transcript de um agente presente (terminal): principal = "<conta>:<pid>"
   * (depois de /clear ou /resume, o transcript novo); subagente = "<sessionId>:<agentId>". Undefined se o
   * agente não é acompanhado (ou o transcript do principal ainda não foi achado).
   */
  transcriptPathOf(agentId: string): string | undefined {
    const main = this.sessions.get(agentId);
    if (main) return main.transcriptPath;
    for (const t of this.sessions.values()) {
      if (!agentId.startsWith(`${t.sessionId}:`)) continue;
      for (const sub of t.subs.values()) if (sub.id === agentId) return sub.file.path;
    }
    return undefined;
  }

  /** Espera as leituras de prefixo pendentes (testes). */
  idle(): Promise<void> {
    return this.prefixChain;
  }

  // ---------------------------------------------------------------- polling

  private safePoll(): void {
    try {
      this.poll(false);
    } catch (err) {
      log.warnOnce(`poll:${errMsg(err)}`, tr('Falha no ciclo de leitura: {0}', [errMsg(err)]));
    }
  }

  /** Acelerador: um evento do fs.watch antecipa o próximo ciclo. */
  private schedule(): void {
    if (this.kick || this.stopped) return;
    const wait = Math.max(60, 150 - (this.now() - this.lastPollAt));
    this.kick = setTimeout(() => {
      this.kick = null;
      this.safePoll();
    }, wait);
    this.kick.unref?.();
  }

  poll(boot = false): void {
    this.lastPollAt = this.now();
    const seen = new Set<string>();
    for (const acc of this.opts.accounts.entries()) {
      let reader = this.readers.get(acc.dir);
      if (!reader) {
        reader = new RegistryReader(acc.dir, { checkPid: !this.opts.inDocker, isAlive: this.opts.isAlive });
        this.readers.set(acc.dir, reader);
        this.watchDir(join(acc.dir, 'sessions'));
      }
      const res = reader.poll();
      const info: SourceInfo = { label: acc.id, path: acc.detected.configDir, sessions: res.entries.length, ok: res.ok };
      if (res.error) info.error = res.error;
      this.sourceInfo.set(acc.dir, info);
      for (const entry of res.entries) {
        const key = `${acc.id}:${entry.pid}`;
        seen.add(key);
        try {
          this.syncSession(key, acc.id, acc.dir, entry, boot);
        } catch (err) {
          log.warnOnce(`session:${key}:${errMsg(err)}`, tr('Sessão {0}: {1}', [key, errMsg(err)]));
        }
      }
    }
    const now = this.now();
    for (const [key, t] of [...this.sessions]) {
      if (seen.has(key)) {
        delete t.missingSince;
        continue;
      }
      // Some do registro por um instante (arquivo sendo regravado)? Só fecha se continuar sumida.
      t.missingSince ??= now;
      if (!boot && now - t.missingSince < CLOSE_AFTER_MISSING_MS) continue;
      this.closeWatchers(t);
      this.sessions.delete(key);
      this.opts.office.closeMain(key);
    }
  }

  private syncSession(key: string, accountId: string, dir: string, entry: RegistryEntry, boot: boolean): void {
    const office = this.opts.office;
    let t = this.sessions.get(key);
    if (!t) {
      t = this.newTracker(key, accountId, dir, entry);
      this.sessions.set(key, t);
      const st = registryStatus(entry);
      office.addMain({
        id: key,
        account: accountId,
        sessionId: entry.sessionId,
        cwd: entry.cwd,
        role: entry.agent ? tr('Agente {0}', [entry.agent]) : tr('Agente principal'),
        startedAt: entry.startedAt ?? this.now(),
        status: st.status ?? 'idle',
        waitingFor: st.waitingFor,
      });
    } else if (t.sessionId !== entry.sessionId) {
      // /clear ou /resume no mesmo processo: mesmo personagem, transcript novo.
      for (const sub of t.subs.values()) office.completeSub(sub.id, { notify: false });
      this.closeWatchers(t);
      const fresh = this.newTracker(key, accountId, dir, entry);
      this.sessions.set(key, fresh);
      office.switchSession(key, entry.sessionId);
      t = fresh;
    }
    t.entry = entry;
    this.pumpMain(t);
    this.scanSubagents(t, boot);
    this.pumpSubs(t);
    const now = this.now();
    const st = registryStatus(entry);
    // Shells morrem com o processo: o que começou antes dele (sessão retomada) não está rodando.
    t.shells.prune(now, entry.startedAt);
    t.shells.holdForeground(st.status === 'waiting', now);
    this.publishShells(t);
    let status = st.status ?? statusFromTranscript(t.state, now);
    const writesShell = this.writesShellStatus(entry);
    if (entry.status === 'idle' && writesShell) {
      // Esta versão grava "shell": "idle" garante que não há Bash em segundo plano (o que sobrou perdeu o término).
      t.idleSince ??= now;
      if (now - t.idleSince >= IDLE_CLEARS_SHELLS_MS && t.shells.dropBackgroundShells(now)) this.publishShells(t);
    } else {
      delete t.idleSince;
      // CLIs antigas não gravam "shell": ocioso com Bash em segundo plano sem notificação = esperando o shell.
      if (status === 'idle' && t.shells.hasBackgroundShell(now, SHELL_FALLBACK_MAX_AGE_MS)) status = 'shell';
    }
    office.setStatus(key, status, st.waitingFor);
    office.fillWorkingActivity(key);
    office.fillShellActivity(key);
  }

  /** A versão desta sessão grava "shell" no registro? (aprende com as sessões que já gravaram) */
  private writesShellStatus(entry: RegistryEntry): boolean {
    if (!entry.version) return false;
    if (entry.status === 'shell' && compareVersions(entry.version, this.shellStatusVersion) < 0) this.shellStatusVersion = entry.version;
    return compareVersions(entry.version, this.shellStatusVersion) >= 0;
  }

  /**
   * Publica os shells de cada agente da sessão. Um shell em segundo plano de um subagente que já saiu
   * continua rodando: passa a aparecer no principal (o registro dele conta esses shells também).
   */
  private publishShells(t: SessionTracker): void {
    const office = this.opts.office;
    const byOwner = new Map<string, ReturnType<typeof toShellJob>[]>();
    for (const job of t.shells.list()) {
      let owner = job.owner;
      if (owner !== t.key && (!office.has(owner) || office.isSubDone(owner))) {
        if (!job.background) continue;
        owner = t.key;
      }
      const list = byOwner.get(owner) ?? [];
      list.push(toShellJob(job));
      byOwner.set(owner, list);
    }
    office.setShells(t.key, byOwner.get(t.key) ?? []);
    for (const sub of t.subs.values()) office.setShells(sub.id, byOwner.get(sub.id) ?? []);
  }

  /** Um shell em segundo plano terminou: atividade 'ShellDone' no dono (ou no principal, se o dono já saiu). */
  private reportShellDone(t: SessionTracker, fin: ShellFinish, live: boolean): void {
    const job = fin.job;
    if (job.kind !== 'shell' || !job.background) return;
    const office = this.opts.office;
    let owner = job.owner;
    if (!office.has(owner) || (owner !== t.key && office.isSubDone(owner))) owner = t.key;
    const exit = fin.summary ? /exit code (-?\d+)/i.exec(fin.summary)?.[1] : undefined;
    const detail = [exit !== undefined ? tr('Código de saída {0}', [exit]) : undefined, job.command].filter(Boolean).join(' — ') || fin.summary;
    const input: { id: string; label: string; startedAt: number; command?: string } = { id: job.taskId ?? job.toolUseId, label: job.label, startedAt: job.startedAt };
    if (job.command) input.command = job.command;
    office.shellDone(owner, input, fin.outcome, fin.at, detail ? { live, summary: detail } : { live });
  }

  private newTracker(key: string, accountId: string, dir: string, entry: RegistryEntry): SessionTracker {
    return {
      key,
      accountId,
      dir,
      entry,
      sessionId: entry.sessionId,
      nextResolveAt: 0,
      state: createTranscriptState(),
      subs: new Map(),
      known: new Map(),
      spawns: new Map(),
      launched: new Map(),
      taskToTool: new Map(),
      runToTool: new Map(),
      finishedTools: new Set(),
      finishedAgents: new Set(),
      finishedRuns: new Set(),
      journals: new Map(),
      shells: new ShellTracker(),
      workflowAgents: 0,
      lastSubScanAt: 0,
      scanned: false,
      watchers: [],
      watchingSubs: false,
    };
  }

  // ---------------------------------------------------------------- transcript principal

  private resolveTranscript(t: SessionTracker): string | undefined {
    const now = this.now();
    if (now < t.nextResolveAt) return undefined;
    t.nextResolveAt = now + 3_000;
    const name = `${t.sessionId}.jsonl`;
    const projects = join(t.dir, 'projects');
    const expected = join(projects, encodeCwd(t.entry.cwd), name);
    if (existsSync(expected)) return expected;
    // Caminhos longos podem ser abreviados pelo Claude Code: procura pelo sessionId.
    try {
      for (const d of readdirSync(projects)) {
        const p = join(projects, d, name);
        if (existsSync(p)) return p;
      }
    } catch {
      // projects/ ainda não existe
    }
    return undefined;
  }

  private pumpMain(t: SessionTracker): void {
    if (!t.tail) {
      const path = this.resolveTranscript(t);
      if (!path) return;
      t.transcriptPath = path;
      this.loadMain(t, path);
      this.watchSession(t);
      return;
    }
    for (let i = 0; i < 4; i++) {
      const r = t.tail.read();
      if (r.reset) {
        log.warn(tr('Transcript da sessão {0} foi truncado/substituído; relendo.', [t.key]));
        this.loadMain(t, t.tail.path);
        return;
      }
      this.applyMainLines(t, r.lines, true);
      if (r.lines.length) this.applyMainSummary(t);
      if (!r.more) break;
    }
  }

  /** Lê o fim do transcript (≈1 MB) e agenda a leitura do começo em segundo plano. */
  private loadMain(t: SessionTracker, path: string): void {
    const tail = new FileTail(path);
    const start = tail.seekTail(this.tailBytes);
    t.tail = tail;
    t.state = createTranscriptState({ trackPrefix: start > 0 });
    for (let i = 0; i < 64; i++) {
      const r = tail.read();
      this.applyMainLines(t, r.lines, false);
      if (!r.more) break;
    }
    t.customTitleFile = readCustomTitleFile(sessionDirOf(path));
    if (t.customTitleFile) t.state.customTitle ??= t.customTitleFile;
    this.applyMainSummary(t);
    const state = t.state;
    if (start > 0) {
      this.queuePrefix(
        path,
        start,
        state,
        (signals, older, shellEvents) => {
          if (this.sessions.get(t.key) !== t || t.state !== state) return;
          for (const sig of signals) this.applySignal(t, t.key, sig);
          this.mergeOlderShells(t, t.key, shellEvents);
          if (t.customTitleFile) state.customTitle ??= t.customTitleFile;
          this.applyMainSummary(t);
          // A janela do fim (≈1 MB) pode cobrir só minutos de uma sessão longa: completa a linha do tempo.
          this.opts.office.mergeHistory(t.key, older);
        },
        { idPrefix: t.key, keepActivities: PREFIX_HISTORY },
      );
    }
  }

  /**
   * Aplica um lote de linhas do principal. O Claude Code só grava a chamada de AskUserQuestion junto
   * com a resposta: se a pergunta chega no lote já respondida, ela vira "Recebeu a sua resposta"
   * (no lugar certo do feed) em vez de um "Fazendo uma pergunta" atrasado.
   */
  private applyMainLines(t: SessionTracker, lines: string[], live: boolean): void {
    const results = lines.map((line) => parseWatchedLine(t.state, line, { idPrefix: t.key, now: this.now() }));
    for (const r of results) {
      for (const a of r.activities) {
        if (a.activity.kind === 'ask' && a.toolUseId && !t.state.pendingTools.has(a.toolUseId)) {
          a.activity = { ...a.activity, ...SPECIAL.answered(a.activity.detail) };
        }
      }
      this.applyResult(t, t.key, r, live);
    }
  }

  private applyMainSummary(t: SessionTracker): void {
    const s = t.state;
    const summary: TranscriptSummary = {
      tasks: s.tasks,
      stats: { ...s.stats, subagents: s.stats.subagents + t.workflowAgents },
    };
    const title = titleOf(s);
    if (title) summary.title = title;
    if (s.model) summary.model = s.model;
    if (s.gitBranch) summary.gitBranch = s.gitBranch;
    if (s.permissionMode) summary.permissionMode = s.permissionMode;
    if (s.lastAt !== undefined) summary.lastAt = s.lastAt;
    this.opts.office.applyTranscript(t.key, summary);
  }

  private queuePrefix(
    path: string,
    end: number,
    state: TranscriptState,
    done: (signals: TranscriptSignal[], older: Activity[], shellEvents: ShellEvent[]) => void,
    opts: { idPrefix?: string; keepActivities?: number } = {},
  ): void {
    const skip = new Set(state.firstMsgIds ?? []);
    this.prefixChain = this.prefixChain
      .then(async () => {
        if (this.stopped) return;
        const prefix = await scanPrefix(path, end, skip, opts);
        mergePrefix(state, prefix.state);
        done(prefix.signals, prefix.activities, prefix.shellEvents);
      })
      .catch((err) => log.warnOnce(`prefix:${path}`, tr('Não foi possível ler o início de um transcript ({0}).', [errMsg(err)])));
  }

  /**
   * Shells em segundo plano que ficaram abertos no começo do arquivo (lido depois da janela do fim):
   * entram no rastreador, a não ser que a janela já tenha mostrado o término deles.
   */
  private mergeOlderShells(t: SessionTracker, owner: string, events: readonly ShellEvent[]): void {
    if (!events.length) return;
    const older = new ShellTracker();
    for (const e of events) applyShellSignal(older, owner, e.signal, e.at);
    if (t.shells.merge(older.openBackground())) t.shells.prune(this.now(), t.entry.startedAt);
  }

  /** Aplica atividades e sinais de uma linha (do principal ou de um subagente). */
  private applyResult(t: SessionTracker, agentId: string, r: LineResult, live: boolean): void {
    const office = this.opts.office;
    // A fila já informou o fim deste shell ('ShellDone'): a entrega da mesma notificação ao agente vai só
    // para o histórico, sem tirar o 'ShellDone' do balão (o mundo comemora pela atividade atual).
    const note = r.signals.find((sig) => sig.type === 'notification');
    const reported = note?.type === 'notification' && t.shells.reportedRecently(note, r.at);
    for (const a of r.activities) {
      const current = a.current && !(reported && a.activity.text === BACKGROUND_RESULT_TEXT);
      office.addActivity(agentId, a.activity, current, { feed: live });
    }
    for (const sig of r.signals) this.applySignal(t, agentId, sig, r.at, live);
  }

  private applySignal(t: SessionTracker, owner: string, sig: TranscriptSignal, at = this.now(), live = true): void {
    const fin = applyShellSignal(t.shells, owner, sig, at);
    if (fin) this.reportShellDone(t, fin, live);
    switch (sig.type) {
      case 'spawn':
        t.spawns.set(sig.spawn.toolUseId, { ...sig.spawn, owner });
        if (t.spawns.size > MAX_SET) t.spawns.delete(t.spawns.keys().next().value as string);
        return;
      case 'launched':
        t.launched.set(sig.toolUseId, { agentId: sig.agentId, runId: sig.runId });
        if (sig.taskId) t.taskToTool.set(sig.taskId, sig.toolUseId);
        if (sig.runId) t.runToTool.set(sig.runId, sig.toolUseId);
        return;
      case 'finished':
        this.finishTool(t, sig.toolUseId);
        if (sig.agentId) addBounded(t.finishedAgents, sig.agentId);
        if (sig.runId) addBounded(t.finishedRuns, sig.runId);
        return;
      case 'notification': {
        const tool = sig.toolUseId ?? (sig.taskId ? t.taskToTool.get(sig.taskId) : undefined);
        if (tool) this.finishTool(t, tool);
        return;
      }
      case 'stopped': {
        const tool = t.taskToTool.get(sig.taskId);
        if (tool) this.finishTool(t, tool);
        return;
      }
      case 'github':
        // Só o que chega ao vivo anima a sala; a carga inicial (boot, sessão retomada) vai para o histórico.
        this.opts.office.githubEvent(owner, sig.event, { key: sig.toolUseId, at, live });
        return;
      default:
        return;
    }
  }

  private finishTool(t: SessionTracker, toolUseId: string): void {
    addBounded(t.finishedTools, toolUseId);
    const l = t.launched.get(toolUseId);
    if (l?.agentId) addBounded(t.finishedAgents, l.agentId);
    if (l?.runId) addBounded(t.finishedRuns, l.runId);
  }

  // ---------------------------------------------------------------- subagentes

  private isFinished(t: SessionTracker, file: SubagentFile, meta: SubagentMeta | undefined): boolean {
    if (meta?.toolUseId && t.finishedTools.has(meta.toolUseId)) return true;
    if (t.finishedAgents.has(file.agentId)) return true;
    if (file.runId) {
      if (t.finishedRuns.has(file.runId)) return true;
      const tool = t.runToTool.get(file.runId);
      if (tool && t.finishedTools.has(tool)) return true;
      if (this.journal(t, file.runId).get(file.agentId)?.done) return true;
    }
    return false;
  }

  private journal(t: SessionTracker, runId: string): Map<string, JournalAgent> {
    if (!t.transcriptPath) return new Map();
    const path = join(sessionDirOf(t.transcriptPath), 'subagents', 'workflows', runId, 'journal.jsonl');
    let size = -1;
    try {
      size = statSync(path).size;
    } catch {
      // workflow sem journal
    }
    const cached = t.journals.get(runId);
    if (cached && cached.size === size) return cached.agents;
    let agents = new Map<string, JournalAgent>();
    if (size >= 0) {
      try {
        agents = parseJournal(readFileSync(path, 'utf8'));
      } catch {
        // ilegível agora: tenta no próximo ciclo
      }
    }
    t.journals.set(runId, { size, agents });
    return agents;
  }

  private scanSubagents(t: SessionTracker, boot: boolean): void {
    if (!t.transcriptPath) return;
    const now = this.now();
    const busy = (t.entry.status !== 'idle' && t.entry.status !== 'shell') || t.subs.size > 0;
    if (!boot && !busy && now - t.lastSubScanAt < 5_000) return;
    t.lastSubScanAt = now;
    this.watchSubagents(t);
    const files = listSubagentFiles(sessionDirOf(t.transcriptPath));
    const workflowAgents = files.filter((f) => f.runId).length;
    if (workflowAgents !== t.workflowAgents) {
      t.workflowAgents = workflowAgents;
      this.applyMainSummary(t);
    }
    // Primeira varredura da sessão (boot ou sessão retomada): só entra quem foi escrito há pouco —
    // ou quem ainda está no meio de uma ferramenta (ex.: comando longo, sem gravar nada há minutos).
    const firstScan = !t.scanned;
    for (const file of files) {
      if (t.subs.has(file.agentId)) continue;
      let size: number;
      let mtimeMs: number;
      try {
        const st = statSync(file.path);
        size = st.size;
        mtimeMs = st.mtimeMs;
      } catch {
        continue;
      }
      const known = t.known.get(file.path);
      if (known === undefined) {
        if (firstScan && now - mtimeMs > BOOT_RECENT_MS && !this.maybeStillRunning(t, file, now - mtimeMs)) {
          t.known.set(file.path, size);
          continue;
        }
        this.openSub(t, file, firstScan ? 'replay' : 'new');
      } else if (size > known) {
        this.openSub(t, file, 'regrown');
      }
    }
    t.scanned = true;
  }

  /**
   * Subagente quieto há mais de BOOT_RECENT_MS na primeira varredura, mas que pode estar trabalhando:
   * a última mensagem dele chamou uma ferramenta que ainda não respondeu (comando longo) ou o journal
   * do workflow diz que começou e não terminou. A decisão final continua com openSub (isFinished e
   * concludedByIdle, que espera até PENDING_TOOL_TIMEOUT_MS com ferramenta pendente).
   */
  private maybeStillRunning(t: SessionTracker, file: SubagentFile, quietMs: number): boolean {
    if (quietMs >= PENDING_TOOL_TIMEOUT_MS) return false;
    if (file.runId && !t.finishedRuns.has(file.runId)) {
      const j = this.journal(t, file.runId).get(file.agentId);
      if (j && !j.done) return true;
    }
    return pendingToolAtEnd(file.path);
  }

  /**
   * Coloca um subagente no escritório. 'new' = arquivo surgiu agora (tudo é novidade);
   * 'replay' = já existia ao abrir a sessão; 'regrown' = voltou a ser escrito depois de sair.
   */
  private openSub(t: SessionTracker, file: SubagentFile, mode: 'new' | 'replay' | 'regrown'): void {
    try {
      this.openSubUnsafe(t, file, mode);
    } catch (err) {
      // Arquivo problemático: ignora até ele mudar de tamanho de novo.
      try {
        t.known.set(file.path, statSync(file.path).size);
      } catch {
        t.known.set(file.path, 0);
      }
      log.warnOnce(`sub-open:${file.path}`, tr('Subagente {0} ignorado: {1}', [file.agentId, errMsg(err)]));
    }
  }

  private openSubUnsafe(t: SessionTracker, file: SubagentFile, mode: 'new' | 'replay' | 'regrown'): void {
    const office = this.opts.office;
    const now = this.now();
    const meta = readSubagentMeta(file.metaPath);
    const tail = new FileTail(file.path);
    // Arquivo novo e pequeno: seekTail devolve 0 e lê tudo; grande: só o fim.
    const start = tail.seekTail(this.tailBytes);
    const state = createTranscriptState({ trackPrefix: start > 0 });
    const id = `${t.sessionId}:${file.agentId}`;
    const results: LineResult[] = [];
    for (let i = 0; i < 64; i++) {
      const r = tail.read();
      for (const line of r.lines) results.push(parseWatchedLine(state, line, { idPrefix: id, now }));
      if (!r.more) break;
    }
    const finished =
      this.isFinished(t, file, meta) ||
      (mode !== 'new' && concludedByIdle({ now, lastWriteAt: tail.mtimeMs, ended: state.ended, pendingTool: state.pendingTools.size > 0 }));
    if (finished) {
      t.known.set(file.path, tail.size);
      return;
    }
    const spawn = meta?.toolUseId ? t.spawns.get(meta.toolUseId) : undefined;
    const parentId = spawn && spawn.owner !== t.key && office.has(spawn.owner) && !office.isSubDone(spawn.owner) ? spawn.owner : t.key;
    const journalLabel = file.runId ? this.journal(t, file.runId).get(file.agentId)?.label : undefined;
    const title = meta?.description ?? spawn?.description ?? journalLabel;
    const background = meta?.requestShape ? meta.requestShape !== 'foreground' || !!spawn?.background : !!spawn?.background;
    const added = office.addSub({
      id,
      parentId,
      sessionId: t.sessionId,
      role: subagentRole(meta, spawn?.subagentType),
      title,
      background,
      startedAt: state.firstAt ?? now,
    });
    if (!added) return;
    t.known.delete(file.path);
    const sub: SubTracker = { agentId: file.agentId, id, file, meta, tail, state };
    t.subs.set(file.agentId, sub);
    for (const r of results) this.applyResult(t, id, r, mode === 'new');
    this.applySubSummary(sub);
    if (start > 0) this.queuePrefix(file.path, start, state, (_signals, _older, shellEvents) => {
      if (t.subs.get(file.agentId) !== sub) return;
      this.applySubSummary(sub);
      this.mergeOlderShells(t, id, shellEvents);
    });
  }

  private applySubSummary(sub: SubTracker): void {
    const s = sub.state;
    const summary: TranscriptSummary = { tasks: s.tasks, stats: { ...s.stats } };
    if (s.firstAt !== undefined) summary.firstAt = s.firstAt;
    if (s.model) summary.model = s.model;
    if (s.gitBranch) summary.gitBranch = s.gitBranch;
    if (s.permissionMode) summary.permissionMode = s.permissionMode;
    if (s.lastAt !== undefined) summary.lastAt = s.lastAt;
    this.opts.office.applyTranscript(sub.id, summary);
  }

  private pumpSubs(t: SessionTracker): void {
    const office = this.opts.office;
    const now = this.now();
    for (const sub of [...t.subs.values()]) {
      if (!office.has(sub.id)) {
        // Já saiu do escritório (período de graça encerrado).
        t.subs.delete(sub.agentId);
        t.known.set(sub.file.path, sub.tail.size);
        continue;
      }
      sub.meta ??= readSubagentMeta(sub.file.metaPath);
      let fresh = 0;
      for (let i = 0; i < 4; i++) {
        let r;
        try {
          r = sub.tail.read();
        } catch (err) {
          log.warnOnce(`sub:${sub.id}`, tr('Subagente {0}: {1}', [sub.id, errMsg(err)]));
          break;
        }
        for (const line of r.lines) {
          const res = parseWatchedLine(sub.state, line, { idPrefix: sub.id, now });
          fresh += res.activities.length;
          this.applyResult(t, sub.id, res, true);
        }
        if (r.lines.length) this.applySubSummary(sub);
        if (!r.more) break;
      }
      if (office.isSubDone(sub.id)) {
        if (fresh > 0 && !this.isFinished(t, sub.file, sub.meta)) {
          const since = office.get(sub.id)?.statusSince ?? now;
          if (now - since > 3_000) office.reactivateSub(sub.id);
        }
        continue;
      }
      const done =
        this.isFinished(t, sub.file, sub.meta) ||
        concludedByIdle({ now, lastWriteAt: sub.tail.mtimeMs, ended: sub.state.ended, pendingTool: sub.state.pendingTools.size > 0 });
      if (done) {
        office.completeSub(sub.id);
        // Concluiu: nada dele roda em primeiro plano (o que estiver em segundo plano passa para o principal).
        t.shells.endForeground(sub.id, now);
      }
    }
  }

  // ---------------------------------------------------------------- fs.watch (acelerador)

  private watchDir(dir: string): void {
    if (!this.useWatch || this.dirWatchers.has(dir)) return;
    try {
      const w = watch(dir, { persistent: false }, () => this.schedule());
      w.on('error', () => {
        w.close();
        this.dirWatchers.delete(dir);
      });
      this.dirWatchers.set(dir, w);
    } catch {
      // sem suporte/pasta inexistente: o polling cobre
    }
  }

  private addWatch(t: SessionTracker, path: string, recursive: boolean): boolean {
    try {
      const w = watch(path, { persistent: false, recursive }, () => this.schedule());
      w.on('error', () => w.close());
      t.watchers.push(w);
      return true;
    } catch {
      return false; // sem suporte: o polling cobre
    }
  }

  private watchSession(t: SessionTracker): void {
    if (!this.useWatch || !t.transcriptPath) return;
    this.addWatch(t, t.transcriptPath, false);
    this.watchSubagents(t);
  }

  private watchSubagents(t: SessionTracker): void {
    if (!this.useWatch || t.watchingSubs || !t.transcriptPath) return;
    const subDir = join(sessionDirOf(t.transcriptPath), 'subagents');
    if (existsSync(subDir)) t.watchingSubs = this.addWatch(t, subDir, true);
  }

  private closeWatchers(t: SessionTracker): void {
    for (const w of t.watchers) w.close();
    t.watchers = [];
    t.watchingSubs = false;
  }
}

/** Fim do transcript lido para saber se há ferramenta sem resultado (sem montar atividades). */
const PENDING_PROBE_BYTES = 256 * 1024;

/** A última mensagem do transcript chamou uma ferramenta que ainda não teve resultado? */
export function pendingToolAtEnd(path: string): boolean {
  try {
    const tail = new FileTail(path);
    tail.seekTail(PENDING_PROBE_BYTES);
    const state = createTranscriptState();
    for (let i = 0; i < 8; i++) {
      const r = tail.read();
      for (const line of r.lines) parseLine(state, line, { idPrefix: '', now: 0, activities: false });
      if (!r.more) break;
    }
    return state.pendingTools.size > 0 && !state.ended;
  } catch {
    return false;
  }
}

/** <sessão>/custom-title.json {"customTitle": "..."} (título dado com /rename). */
export function readCustomTitleFile(sessionDir: string): string | undefined {
  try {
    const j = JSON.parse(readFileSync(join(sessionDir, 'custom-title.json'), 'utf8')) as { customTitle?: unknown };
    return typeof j.customTitle === 'string' && j.customTitle.trim() ? j.customTitle.trim() : undefined;
  } catch {
    return undefined;
  }
}
