// Modelo do escritório: agentes (reais e de demonstração), salas, feed e avisos.
// Os observadores de fontes (sources/watcher.ts) chamam os métodos de mutação; o hub SSE
// chama commit() (com throttle) para obter o snapshot novo, o feed e os avisos pendentes.
import type {
  AccountInfo,
  Activity,
  AgentDetail,
  AgentInfo,
  AgentStats,
  AgentStatus,
  FeedItem,
  Notice,
  NoticeLevel,
  OfficeSnapshot,
  PermissionDecision,
  PermissionRequestInfo,
  Provider,
  PtyInfo,
  PtyStatus,
  RoomInfo,
  ShellJob,
  SourceInfo,
  TaskItem,
  UpdateStatus,
} from '../../shared/types';
import { SHELL_WAIT_TOOL, SPECIAL, type ShellOutcome } from '../../shared/activity';
import { nameKey, type AppearanceParts } from '../../shared/appearance';
import { DemoSimulator } from '../../shared/demo/simulator';
import { describeGitHubEvent, githubEventKey, RoomEffects, type GitHubEvent } from '../../shared/github';
import { hash32 } from '../../shared/hash';
import { applyPermission } from '../permissions/registry';
import type { NameStore, StoredCharacter } from './names';
import { normalizeCwd, roomDisplayNames, SlotAllocator } from './rooms';
import { tr } from '../../shared/i18n';
import type { WorldMeta } from '../../shared/world/api';

export const OFFLINE_GRACE_MS = 20_000;
export const DONE_GRACE_MS = 25_000;
export const SLOT_COOLDOWN_MS = 30_000;
export const NOTICE_DEDUPE_MS = 10_000;
/** Aviso "está esperando o shell": no máximo um a cada 10 min por agente. */
export const SHELL_NOTICE_DEDUPE_MS = 600_000;
/** Evento do GitHub mais velho que isto (linha antiga relida) não anima a sala nem gera aviso. */
export const GITHUB_LIVE_MS = 120_000;
const RECENT_LIMIT = 30;
/**
 * Atividades de cada agente que vão no snapshot (SSE). O snapshot inteiro sai a cada mudança, e o
 * `recent` completo era ~87% dele; a linha do tempo longa vem de GET /api/agents/:id e o feed já
 * transmite cada atividade à parte.
 */
export const SNAPSHOT_RECENT = 8;
const HISTORY_LIMIT = 200;
const FEED_LIMIT = 200;

export interface OfficeDeps {
  names: NameStore;
  /** Nome escolhido pelo usuário para a sala da pasta (model/room-aliases.ts), se houver. */
  roomAlias?: (path: string) => string | undefined;
  version: string;
  /** Build do cliente servido (ver OfficeSnapshot.meta.build); ausente no modo dev e nos testes. */
  build?: () => string | undefined;
  startedAt: number;
  /** Contas reais, com o nº de sessões abertas de cada uma. */
  accounts: (sessions: ReadonlyMap<string, number>) => AccountInfo[];
  sources: () => SourceInfo[];
  /** Nome amigável da conta (ex.: "Conta D") para os avisos. */
  accountName: (id: string) => string | undefined;
  /** Terminal ligado (ver OfficeSnapshot.meta.terminal e ServerConfig.terminal). */
  terminal?: boolean;
  /** Pedidos de permissão pendentes por agente (PermissionRegistry.snapshot), postos no snapshot. */
  permissions?: () => ReadonlyMap<string, PermissionRequestInfo>;
  /**
   * Agentes cuja sessão o registro de mensagens vê conectada (MessageRegistry.reachable): viram AgentInfo.canMessage.
   * Ausente = mensagens pelo escritório desligadas (OfficeSnapshot.meta.messages).
   */
  messages?: () => ReadonlySet<string>;
  /** Verificação de versão nova no GitHub (ver OfficeSnapshot.meta.updates). */
  updates?: () => UpdateStatus;
  /** Terminais interativos (PtyManager): estado do recurso e os abertos. */
  ptys?: () => { status: PtyStatus; list: PtyInfo[] };
  /** Habblaud World (WorldService.meta; ver OfficeSnapshot.meta.world). */
  world?: () => WorldMeta;
  now?: () => number;
}

/** O que o transcript sabe sobre o agente (aplicado de uma vez). */
export interface TranscriptSummary {
  title?: string;
  tasks: TaskItem[];
  stats: AgentStats;
  model?: string;
  gitBranch?: string;
  permissionMode?: string;
  /** Primeiro evento conhecido (subagentes: o início real, depois de ler o começo do arquivo). */
  firstAt?: number;
  lastAt?: number;
}

export interface MainInput {
  id: string;
  /** Ferramenta do agente (AgentInfo.provider); ausente = 'claude'. Os subagentes herdam a do principal. */
  provider?: Provider;
  account: string;
  sessionId: string;
  cwd: string;
  role: string;
  startedAt: number;
  status: AgentStatus;
  waitingFor?: string;
}

export interface SubInput {
  id: string;
  parentId: string;
  sessionId: string;
  role: string;
  title?: string;
  background: boolean;
  startedAt: number;
}

interface AgentRecord {
  info: AgentInfo;
  history: Activity[];
  removeAt?: number;
  /** Início do turno atual (para "Concluiu em X"). */
  turnStart?: number;
  /** Atividade "Concluiu" sintetizada pela mudança de status (substituída pela do transcript, se vier). */
  synthDone?: { id: string; at: number };
  /** Atividade "Precisa de você" sintetizada; ao sair da espera, a atividade anterior volta a ser a atual. */
  synthWait?: { id: string; prev?: Activity };
  /** Balão "Esperando o shell" sintetizado neste episódio do status 'shell' (e a atividade que ele cobriu). */
  shellWait?: { id: string; prev?: Activity };
}

/** O que terminou (para a atividade 'ShellDone' e o aviso). */
export interface ShellDoneInput {
  /** Id do job (tarefa em segundo plano ou tool_use): torna a atividade idempotente numa releitura. */
  id: string;
  label: string;
  startedAt: number;
  command?: string;
}

/** Personagem escolhido no editor (já validado: ver shared/appearance.ts). */
export interface CharacterInput {
  name: string;
  seed: number;
  parts: AppearanceParts;
}

export type CharacterResult = { result: 'ok' } | { result: 'not-found' } | { result: 'conflict'; message: string };

export interface CommitResult {
  snapshot: OfficeSnapshot;
  changed: boolean;
  feed: FeedItem[];
  notices: Notice[];
}

type NoticeKind = 'arrive' | 'room' | 'wait' | 'deliver' | 'done' | 'leave' | 'shell' | 'shellDone' | 'github' | 'character';

/** Pergunta ainda sem resposta (o balão dela já diz que o agente espera você). */
function isOpenQuestion(a: Activity | undefined): boolean {
  return a?.kind === 'ask' && a.text !== SPECIAL.answered().text;
}

function zeroStats(): AgentStats {
  return { toolCalls: 0, tokensIn: 0, tokensOut: 0, subagents: 0 };
}

function cloneAgent(a: AgentInfo): AgentInfo {
  const c: AgentInfo = { ...a, recent: a.recent.slice(), tasks: a.tasks.map((t) => ({ ...t })), stats: { ...a.stats } };
  if (a.shells) c.shells = a.shells.map((j) => ({ ...j }));
  if (a.parts) c.parts = { ...a.parts };
  return c;
}

/**
 * Nomes em uso, comparados sem diferenciar caixa nem forma Unicode: pickName e NameStore.assign só chamam `has`, então
 * "Ana" (guardado ou do pool) conta como ocupado quando "ana" foi escolhido para uma sala.
 */
class NameSet extends Set<string> {
  private folded = new Set<string>();
  override add(name: string): this {
    // O construtor de Set chama add antes dos campos existirem: só use `new NameSet()` sem argumentos.
    this.folded?.add(nameKey(name));
    return super.add(name);
  }
  override has(name: string): boolean {
    return this.folded.has(nameKey(name));
  }
}

const byStart = (a: ShellJob, b: ShellJob) => a.startedAt - b.startedAt || a.id.localeCompare(b.id);

export class Office {
  private agents = new Map<string, AgentRecord>();
  private rooms = new Map<string, { path: string; createdAt: number }>();
  private slots = new SlotAllocator(SLOT_COOLDOWN_MS);
  private roomNames = new Map<string, string>();
  private feed: FeedItem[] = [];
  private pendingFeed: FeedItem[] = [];
  private pendingNotices: Notice[] = [];
  private noticeAt = new Map<string, number>();
  private listeners = new Set<() => void>();
  private rev = 0;
  private dirty = true;
  private last: OfficeSnapshot | null = null;
  private demo: DemoSimulator | null = null;
  private demoSnap: OfficeSnapshot | null = null;
  private booting = false;
  /** Fontes bootando agora (beginBoot/endBoot contados): o boot só termina quando todas terminaram. */
  private bootDepth = 0;
  private bootFeed: FeedItem[] = [];
  /** Festa/alarme das salas (eventos do GitHub). */
  private effects = new RoomEffects();
  private seq = 0;
  private readonly now: () => number;

  constructor(private readonly deps: OfficeDeps) {
    this.now = deps.now ?? Date.now;
  }

  /** Avisado (síncrono) sempre que algo muda; o hub decide quando fazer commit(). */
  onChange(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => void this.listeners.delete(cb);
  }

  markDirty(): void {
    this.dirty = true;
    this.listeners.forEach((cb) => cb());
  }

  // ---------------------------------------------------------------- boot

  /**
   * Durante o boot: sem avisos; o feed é montado em ordem cronológica no final. Contado: cada fonte de agentes
   * (sources/source.ts) chama beginBoot ao começar a reconstruir as sessões abertas e endBoot ao terminar (num
   * `finally`, inclusive se o boot for assíncrono); o escritório só fica "pronto" (feed ordenado, balões de
   * espera, sem avisos atrasados) quando a última termina.
   */
  beginBoot(): void {
    if (this.bootDepth++ > 0) return;
    this.booting = true;
    this.bootFeed = [];
  }

  endBoot(): void {
    if (this.bootDepth === 0) return; // endBoot sem beginBoot: ignorado
    if (--this.bootDepth > 0) return;
    this.booting = false;
    const sorted = this.bootFeed.sort((a, b) => a.activity.at - b.activity.at).slice(-FEED_LIMIT);
    this.bootFeed = [];
    this.feed = [...this.feed, ...sorted].slice(-FEED_LIMIT);
    // Quem já estava esperando por você quando o servidor subiu ganha o balão "Precisa de você"
    // (durante o boot nada é sintetizado; sem aviso, porque não é novidade).
    for (const rec of this.agents.values()) {
      const info = rec.info;
      if (info.status !== 'waiting' || rec.synthWait || isOpenQuestion(info.activity)) continue;
      const prev = info.activity;
      const act: Activity = { id: `${info.id}#wait:${++this.seq}`, at: info.statusSince, ...SPECIAL.waiting(info.waitingFor) };
      this.addActivity(info.id, act, true, { feed: false });
      rec.synthWait = prev ? { id: act.id, prev } : { id: act.id };
    }
    this.markDirty();
  }

  /** Alguma fonte ainda está bootando. */
  isBooting(): boolean {
    return this.booting;
  }

  // ---------------------------------------------------------------- consultas

  has(id: string): boolean {
    return this.agents.has(id);
  }

  get(id: string): AgentInfo | undefined {
    return this.agents.get(id)?.info;
  }

  /** Agentes reais presentes (inclusive em período de graça). */
  list(): AgentInfo[] {
    return [...this.agents.values()].map((r) => r.info);
  }

  /** Pasta do projeto da sala (cwd original, sem normalizar). */
  roomPath(roomId: string): string | undefined {
    return this.rooms.get(roomId)?.path;
  }

  roomName(roomId: string): string {
    return this.roomNames.get(roomId) ?? roomId.split('/').filter(Boolean).pop() ?? roomId;
  }

  detail(id: string): AgentDetail | undefined {
    const rec = this.agents.get(id);
    if (rec) return { agent: cloneAgent(rec.info), history: rec.history.slice() };
    const demo = this.demoSnap?.agents.find((a) => a.id === id);
    return demo ? { agent: cloneAgent(demo), history: demo.recent.slice() } : undefined;
  }

  recentFeed(n: number): FeedItem[] {
    return this.feed.slice(-n);
  }

  isDemo(): boolean {
    return this.demo !== null;
  }

  // ---------------------------------------------------------------- agentes principais

  addMain(p: MainInput): void {
    const now = this.now();
    const existing = this.agents.get(p.id);
    if (existing) {
      // Sessão que voltou durante o período de graça.
      delete existing.removeAt;
      this.setStatus(p.id, p.status, p.waitingFor);
      return;
    }
    const roomId = normalizeCwd(p.cwd);
    this.ensureRoom(roomId, now);
    const chosen = this.roomCharacter(roomId, p.id, p.sessionId);
    // A mesma sessão retomada noutro processo (ex.: "Assumir aqui") mantém o nome, mesmo com o processo antigo
    // ainda saindo do escritório.
    const person = chosen ?? this.deps.names.assign(p.sessionId, this.takenNames(undefined, p.sessionId));
    const info: AgentInfo = {
      id: p.id,
      kind: 'main',
      roomId,
      name: person.name,
      look: person.look,
      role: p.role,
      sessionId: p.sessionId,
      account: p.account,
      status: p.status,
      recent: [],
      tasks: [],
      startedAt: p.startedAt,
      lastEventAt: p.startedAt,
      statusSince: now,
      stats: zeroStats(),
      seed: chosen?.seed ?? hash32(p.id),
    };
    if (p.provider && p.provider !== 'claude') info.provider = p.provider;
    if (chosen) {
      info.custom = true;
      if (chosen.parts) info.parts = { ...chosen.parts };
    }
    if (p.status === 'waiting') info.waitingFor = p.waitingFor ?? tr('responder no terminal');
    const rec: AgentRecord = { info, history: [] };
    if (p.status === 'working') rec.turnStart = now;
    this.agents.set(p.id, rec);
    const acc = this.deps.accountName(p.account);
    this.notice('arrive', p.id, 'info', tr('👋 {0} chegou em {1}{2}', [info.name, this.roomName(roomId), acc ? ` (${acc})` : '']), roomId);
    this.markDirty();
  }

  /** Mesmo processo, sessão nova (/clear, /resume): o personagem continua, tarefas e números zeram. */
  switchSession(id: string, sessionId: string): void {
    const rec = this.agents.get(id);
    if (!rec || rec.info.sessionId === sessionId) return;
    const info = rec.info;
    // Personagem do projeto: o nome escolhido não vira o nome sorteado da sessão nova, e a sessão nova vira a dona dele
    // (se outro agente da sala salvou por último, o dono é ele e fica como está).
    if (info.custom) {
      const owner = this.deps.names.character(info.roomId)?.owner;
      if (owner === undefined || owner === info.sessionId) this.deps.names.claimCharacter(info.roomId, sessionId);
    } else {
      this.deps.names.remember(sessionId, { name: info.name, look: info.look });
    }
    info.sessionId = sessionId;
    info.tasks = [];
    info.stats = zeroStats();
    delete info.title;
    this.addActivity(id, { id: `${id}#clear:${++this.seq}`, at: this.now(), ...SPECIAL.cleared() }, true);
    this.markDirty();
  }

  setStatus(id: string, status: AgentStatus, waitingFor?: string): void {
    const rec = this.agents.get(id);
    if (!rec) return;
    const info = rec.info;
    const prev = info.status;
    const reason = status === 'waiting' ? (waitingFor ?? tr('responder no terminal')) : undefined;
    if (prev === status && info.waitingFor === reason) return;
    const now = this.now();
    if (prev !== status) {
      info.status = status;
      info.statusSince = now;
    }
    if (reason) info.waitingFor = reason;
    else delete info.waitingFor;
    const room = this.roomName(info.roomId);

    if (status === 'working' && (prev === 'idle' || prev === 'shell' || rec.turnStart === undefined)) rec.turnStart = now;
    if (status === 'shell' && prev !== 'shell') {
      // Terminou o turno com shell(s) rodando: o balão (fillShellActivity) e o aviso falam da espera, não de "concluiu".
      const { label } = this.shellSummary(rec);
      this.notice('shell', id, 'info', tr('⏳ {0} está esperando o shell em {1}{2}', [info.name, room, label ? `: ${label}` : '']), info.roomId, {
        dedupeMs: SHELL_NOTICE_DEDUPE_MS,
      });
    }
    if (prev === 'shell' && status !== 'shell' && rec.shellWait) {
      // Saiu da espera sem nada novo no transcript: volta a mostrar o que estava antes do balão sintetizado.
      if (info.activity?.id === rec.shellWait.id && rec.shellWait.prev) info.activity = rec.shellWait.prev;
      delete rec.shellWait;
    }
    if (status === 'waiting' && prev !== 'waiting') {
      if (!this.booting && !isOpenQuestion(info.activity)) {
        const prevActivity = info.activity;
        const act: Activity = { id: `${id}#wait:${++this.seq}`, at: now, ...SPECIAL.waiting(reason) };
        this.addActivity(id, act, true);
        rec.synthWait = prevActivity ? { id: act.id, prev: prevActivity } : { id: act.id };
      }
      this.notice('wait', id, 'alert', tr('✋ {0} precisa de você em {1}: {2}', [info.name, room, reason]), info.roomId);
    }
    if (prev === 'waiting' && status !== 'waiting' && rec.synthWait) {
      // Saiu da espera sem nada novo no transcript: volta a mostrar o que estava fazendo.
      if (info.activity?.id === rec.synthWait.id && rec.synthWait.prev) info.activity = rec.synthWait.prev;
      delete rec.synthWait;
    }
    if (prev === 'working' && status === 'idle') {
      const cur = info.activity;
      const interrupted = cur?.kind === 'wait' && cur.text === SPECIAL.interrupted().text;
      if (!this.booting && cur?.kind !== 'done' && !interrupted) {
        const act: Activity = { id: `${id}#done:${++this.seq}`, at: now, ...SPECIAL.turnDone(rec.turnStart ? now - rec.turnStart : undefined) };
        if (rec.turnStart) act.durationMs = now - rec.turnStart;
        this.addActivity(id, act, true);
        rec.synthDone = { id: act.id, at: now };
      }
      this.notice('done', id, 'success', tr('✅ {0} concluiu em {1}', [info.name, room]), info.roomId);
    }
    this.markDirty();
  }

  /**
   * Ocupado, mas o transcript não diz nada novo há um tempo (a última atividade é o fim do turno
   * anterior — ex.: esperando subagentes em segundo plano): mostra algo coerente com "trabalhando".
   */
  fillWorkingActivity(id: string): void {
    const rec = this.agents.get(id);
    if (!rec || rec.info.status !== 'working') return;
    const cur = rec.info.activity;
    const now = this.now();
    if (cur && (cur.kind !== 'done' || now - cur.at < 15_000)) return;
    // Parado num comando em primeiro plano (sem resultado ainda): não está "pensando", está esperando o comando.
    if (rec.info.shells?.some((j) => !j.background)) return;
    const busySubs = [...this.agents.values()].some((r) => r.info.parentId === id && r.info.status === 'working');
    const desc = busySubs ? SPECIAL.supervising() : SPECIAL.think();
    this.addActivity(id, { id: `${id}#busy:${++this.seq}`, at: now, ...desc }, true, { filler: true });
  }

  // ---------------------------------------------------------------- shells

  /** Shells que o agente está esperando (lista vazia = nenhum; o campo some do snapshot). */
  setShells(id: string, jobs: readonly ShellJob[]): void {
    const rec = this.agents.get(id);
    if (!rec) return;
    const info = rec.info;
    if (info.status === 'offline' || (info.kind === 'sub' && info.status === 'done')) jobs = [];
    const next = jobs.length ? jobs.map((j) => ({ ...j })).sort(byStart) : undefined;
    if (JSON.stringify(info.shells) === JSON.stringify(next)) return;
    if (next) info.shells = next;
    else delete info.shells;
    this.markDirty();
  }

  /**
   * Status 'shell': o balão mostra "Esperando o shell: <rótulo>" — nunca o "Concluiu em …" do fim do turno.
   * Só cobre o que ficou para trás (fim de turno, atividades anteriores à espera, o próprio balão com outro
   * rótulo); o que acontece durante a espera (ex.: o fim de um dos shells) continua aparecendo.
   * O primeiro balão de cada espera vai para o feed; as atualizações, não.
   */
  fillShellActivity(id: string): void {
    const rec = this.agents.get(id);
    if (!rec || rec.info.status !== 'shell') return;
    const info = rec.info;
    const { label, count, detail } = this.shellSummary(rec);
    const desc = SPECIAL.waitingShell(label, count, detail);
    const cur = info.activity;
    const mine = cur?.tool === SHELL_WAIT_TOOL;
    if (mine && cur.text === desc.text) return;
    if (cur && !mine && cur.kind !== 'done' && cur.at > info.statusSince) return;
    const now = this.now();
    const act: Activity = { id: `${id}#shell-wait:${++this.seq}`, at: Math.max(now, info.statusSince), ...desc };
    const first = !rec.shellWait;
    const prev = mine ? rec.shellWait?.prev : cur;
    this.addActivity(id, act, true, { filler: !first || this.booting });
    rec.shellWait = prev ? { id: act.id, prev } : { id: act.id };
  }

  /**
   * Um shell em segundo plano terminou: atividade 'ShellDone' (o mundo comemora; `error` = falhou/morto)
   * e aviso de sucesso/falha. `live: false` = releitura do passado (só histórico, sem aviso).
   */
  shellDone(id: string, job: ShellDoneInput, outcome: ShellOutcome, at: number, opts: { live?: boolean; summary?: string } = {}): void {
    const rec = this.agents.get(id);
    if (!rec) return;
    const info = rec.info;
    const live = opts.live !== false;
    const ms = Math.max(0, at - job.startedAt);
    const act: Activity = { id: `${id}#shell-done:${job.id}`, at, ...SPECIAL.shellDone(job.label, outcome, ms, opts.summary ?? job.command) };
    if (outcome === 'ok') act.durationMs = ms;
    this.addActivity(id, act, true, { feed: live });
    if (!live || outcome === 'killed') return;
    const room = this.roomName(info.roomId);
    const text =
      outcome === 'ok' ? tr('✅ {0}: shell terminou em {1} — {2}', [info.name, room, job.label]) : tr('❌ {0}: shell falhou em {1} — {2}', [info.name, room, job.label]);
    this.notice('shellDone', id, outcome === 'ok' ? 'success' : 'warn', text, info.roomId, { dedupeKey: `${id}|shellDone|${job.id}` });
  }

  /**
   * Evento do GitHub visto no transcript (PR aberto/mergeado, push, CI, release; ver shared/github.ts):
   * atividade no histórico e, ao vivo, aviso e efeito na sala (festa ou alarme). `key` (o tool_use)
   * torna a atividade idempotente numa releitura; `live: false` ou linha antiga = só histórico.
   */
  githubEvent(id: string, ev: GitHubEvent, opts: { key: string; at: number; live?: boolean }): void {
    const rec = this.agents.get(id);
    if (!rec) return;
    const info = rec.info;
    const now = this.now();
    const live = opts.live !== false && !this.booting && now - opts.at < GITHUB_LIVE_MS;
    const d = describeGitHubEvent(ev, info.name, this.roomName(info.roomId));
    this.addActivity(id, { id: `${id}#gh:${opts.key}:${ev.kind}`, at: opts.at, ...d.activity }, true, { feed: live });
    if (!live) return;
    // o mesmo CI visto de novo (gh run view depois do watch) não repete o aviso por 2 min
    const ci = ev.kind === 'ci_failed' || ev.kind === 'ci_passed';
    this.notice('github', id, d.level, d.notice, info.roomId, { dedupeKey: `${info.roomId}|gh|${githubEventKey(ev)}`, dedupeMs: ci ? 120_000 : NOTICE_DEDUPE_MS });
    if (this.effects.apply(info.roomId, ev, now, id)) this.markDirty();
  }

  /** Rótulo do shell mais antigo (Bash antes de Monitor), quantos são e o detalhe (comando). */
  private shellSummary(rec: AgentRecord): { label?: string; count: number; detail?: string } {
    let jobs = rec.info.shells ?? [];
    if (!jobs.length) {
      // Sem shells próprios conhecidos: algum subagente pode ter disparado o comando.
      jobs = this.descendants(rec.info.id)
        .flatMap((r) => r.info.shells ?? [])
        .filter((j) => j.background)
        .sort(byStart);
    }
    const shells = jobs.filter((j) => j.kind === 'shell' && j.background);
    const main = shells[0] ?? jobs.find((j) => j.kind === 'shell') ?? jobs[0];
    if (!main) return { count: 0 };
    // "Esperando 2 shells": conta os Bash em segundo plano (monitores só se não houver nenhum).
    const out: { label?: string; count: number; detail?: string } = { label: main.label, count: shells.length || jobs.length };
    if (main.command) out.detail = main.command;
    return out;
  }

  closeMain(id: string): void {
    const rec = this.agents.get(id);
    if (!rec || rec.info.status === 'offline') return;
    const now = this.now();
    const info = rec.info;
    info.status = 'offline';
    info.statusSince = now;
    delete info.waitingFor;
    // Os shells morrem com a sessão.
    delete info.shells;
    delete rec.shellWait;
    rec.removeAt = now + OFFLINE_GRACE_MS;
    // Subagentes ainda presentes saem junto.
    for (const sub of this.descendants(id)) {
      delete sub.info.shells;
      if (sub.info.status !== 'done') {
        sub.info.status = 'done';
        sub.info.statusSince = now;
      }
      sub.removeAt = Math.min(sub.removeAt ?? Infinity, rec.removeAt);
    }
    this.notice('leave', id, 'info', tr('🚪 {0} encerrou a sessão', [info.name]), info.roomId);
    this.markDirty();
  }

  // ---------------------------------------------------------------- subagentes

  addSub(p: SubInput): boolean {
    const parent = this.agents.get(p.parentId);
    if (!parent) return false;
    const now = this.now();
    const existing = this.agents.get(p.id);
    if (existing) {
      this.reactivateSub(p.id);
      return true;
    }
    const person = this.deps.names.assign(p.id, this.takenNames());
    const info: AgentInfo = {
      id: p.id,
      kind: 'sub',
      parentId: p.parentId,
      roomId: parent.info.roomId,
      name: person.name,
      look: person.look,
      role: p.role,
      sessionId: p.sessionId,
      account: parent.info.account,
      status: 'working',
      recent: [],
      tasks: [],
      startedAt: p.startedAt,
      lastEventAt: p.startedAt,
      statusSince: now,
      stats: zeroStats(),
      seed: hash32(p.id),
    };
    if (parent.info.provider) info.provider = parent.info.provider;
    if (p.title) info.title = p.title;
    if (p.background) info.background = true;
    this.agents.set(p.id, { info, history: [], turnStart: now });
    this.markDirty();
    return true;
  }

  completeSub(id: string, opts: { notify?: boolean } = {}): void {
    const rec = this.agents.get(id);
    if (!rec || rec.info.kind !== 'sub' || rec.info.status === 'done' || rec.info.status === 'offline') return;
    const now = this.now();
    const info = rec.info;
    info.status = 'done';
    info.statusSince = now;
    delete info.shells;
    rec.removeAt = now + DONE_GRACE_MS;
    if (!this.booting && info.activity?.kind !== 'done') {
      const act: Activity = { id: `${id}#done:${++this.seq}`, at: now, ...SPECIAL.turnDone(now - info.startedAt), durationMs: now - info.startedAt };
      this.addActivity(id, act, true);
    }
    if (opts.notify !== false) {
      const parent = info.parentId ? this.agents.get(info.parentId)?.info : undefined;
      const what = info.title ? `“${info.title}”` : tr('o trabalho');
      this.notice('deliver', id, 'success', tr('📦 {0} entregou {1} para {2}', [info.name, what, parent?.name ?? tr('o agente principal')]), info.roomId);
    }
    this.markDirty();
  }

  /** Subagente concluído voltou a escrever (ex.: recebeu nova mensagem): volta ao trabalho. */
  reactivateSub(id: string): void {
    const rec = this.agents.get(id);
    if (!rec || rec.info.kind !== 'sub' || rec.info.status !== 'done') return;
    const parent = rec.info.parentId ? this.agents.get(rec.info.parentId) : undefined;
    if (!parent || parent.info.status === 'offline') return;
    rec.info.status = 'working';
    rec.info.statusSince = this.now();
    delete rec.removeAt;
    this.markDirty();
  }

  isSubDone(id: string): boolean {
    const s = this.agents.get(id)?.info.status;
    return s === 'done' || s === 'offline';
  }

  // ---------------------------------------------------------------- dados do transcript

  applyTranscript(id: string, t: TranscriptSummary): void {
    const rec = this.agents.get(id);
    if (!rec) return;
    const info = rec.info;
    let changed = false;
    const set = <K extends keyof AgentInfo>(k: K, v: AgentInfo[K] | undefined) => {
      if (JSON.stringify(info[k]) === JSON.stringify(v)) return;
      if (v === undefined) delete info[k];
      else info[k] = v;
      changed = true;
    };
    if (info.kind === 'main') set('title', t.title);
    set('tasks', t.tasks.map((x) => ({ ...x })));
    set('stats', { ...t.stats });
    set('model', t.model);
    set('gitBranch', t.gitBranch);
    set('permissionMode', t.permissionMode);
    if (info.kind === 'sub' && t.firstAt !== undefined && t.firstAt < info.startedAt) {
      info.startedAt = t.firstAt;
      changed = true;
    }
    if (t.lastAt !== undefined && t.lastAt > info.lastEventAt) {
      info.lastEventAt = t.lastAt;
      changed = true;
    }
    if (changed) this.markDirty();
  }

  /**
   * Registra uma atividade. `feed: false` = só histórico (ex.: releitura do fim de um transcript
   * antigo ao abrir uma sessão retomada — não é novidade para o feed ao vivo).
   */
  addActivity(id: string, activity: Activity, current: boolean, opts: { feed?: boolean; filler?: boolean } = {}): void {
    const rec = this.agents.get(id);
    if (!rec) return;
    const info = rec.info;
    // "Concluiu" vindo do transcript substitui o que sintetizamos pela mudança de status.
    if (activity.kind === 'done' && rec.synthDone && activity.at - rec.synthDone.at < 60_000) {
      const synthId = rec.synthDone.id;
      const replaced: Activity = { ...activity, id: synthId };
      const swap = (list: Activity[]) => list.map((a) => (a.id === synthId ? replaced : a));
      info.recent = swap(info.recent);
      rec.history = swap(rec.history);
      if (info.activity?.id === synthId) info.activity = replaced;
      delete rec.synthDone;
      this.markDirty();
      return;
    }
    // Releitura de um transcript regravado: não duplica o que já está no histórico.
    if (info.recent.some((a) => a.id === activity.id)) return;
    if (activity.kind !== 'done') delete rec.synthDone;
    info.recent = [...info.recent, activity].slice(-RECENT_LIMIT);
    rec.history.push(activity);
    if (rec.history.length > HISTORY_LIMIT) rec.history.splice(0, rec.history.length - HISTORY_LIMIT);
    if (current || !info.activity) info.activity = activity;
    if (activity.at > info.lastEventAt) info.lastEventAt = activity.at;
    // Uma instrução nova começa um turno (base do "Concluiu em X").
    if (activity.kind === 'prompt') rec.turnStart = activity.at;
    // `filler` (só preenche o balão do personagem) nunca vai para o feed.
    if (!opts.filler) {
      const item: FeedItem = {
        id: activity.id,
        agentId: id,
        roomId: info.roomId,
        agentName: info.name,
        roomName: this.roomName(info.roomId),
        account: info.account,
        activity,
      };
      if (this.booting) this.bootFeed.push(item);
      else if (opts.feed !== false) this.pushFeed([item]);
    }
    this.markDirty();
  }

  /**
   * Atividades anteriores à janela lida no boot (do começo do transcript, lido em segundo plano):
   * entram só no histórico longo (GET /api/agents/:id), sem feed, sem mudar a atividade atual.
   */
  mergeHistory(id: string, older: readonly Activity[]): void {
    const rec = this.agents.get(id);
    if (!rec || !older.length) return;
    const seen = new Set(rec.history.map((a) => a.id));
    const add = older.filter((a) => !seen.has(a.id));
    if (!add.length) return;
    rec.history = [...add, ...rec.history].sort((a, b) => a.at - b.at).slice(-HISTORY_LIMIT);
  }

  // ---------------------------------------------------------------- pedidos de permissão (server/permissions)

  /**
   * Aviso de pedido de permissão (ou de pergunta do AskUserQuestion) vindo do hook; usa o dedupe do "precisa de
   * você" (o mesmo pedido, outro caminho).
   */
  noticePermission(id: string, what: string, kind: 'permission' | 'question' = 'permission'): void {
    const info = this.agents.get(id)?.info;
    if (!info) return;
    const room = this.roomName(info.roomId);
    const text = kind === 'question' ? tr('❓ {0} tem uma pergunta em {1}: {2}', [info.name, room, what]) : tr('🔐 {0} pede permissão em {1}: {2}', [info.name, room, what]);
    this.notice('wait', id, 'alert', text, info.roomId);
    this.markDirty();
  }

  /** Decisão para um pedido fictício do demo. true = o pedido era do demo (e foi respondido). */
  decideDemoPermission(requestId: string, d: PermissionDecision): boolean {
    if (!this.demo) return false;
    const now = this.now();
    if (!this.demo.decidePermission(requestId, d, now)) return false;
    this.demoSnap = this.demo.snapshot(now);
    this.markDirty();
    return true;
  }

  /** Pedido fictício do demo (já vem completo no snapshot). */
  demoPermission(requestId: string): PermissionRequestInfo | undefined {
    return this.demoSnap?.agents.find((a) => a.permission?.id === requestId)?.permission;
  }

  // ---------------------------------------------------------------- mensagens pelo escritório (server/messages)

  /** Agente fictício do demo (só existe no snapshot), para o registro de mensagens. */
  demoAgent(id: string): AgentInfo | undefined {
    return this.demoSnap?.agents.find((a) => a.id === id);
  }

  /** Entrega fictícia de uma mensagem a um agente do demo. false = ele já saiu (ou o demo foi desligado). */
  deliverDemoMessage(agentId: string, text: string): boolean {
    if (!this.demo) return false;
    const now = this.now();
    if (!this.demo.receiveMessage(agentId, text, now)) return false;
    this.demoSnap = this.demo.snapshot(now);
    this.markDirty();
    return true;
  }

  // ---------------------------------------------------------------- demonstração

  setDemo(enabled: boolean): void {
    if (enabled === this.isDemo()) return;
    const now = this.now();
    if (enabled) {
      this.demo = new DemoSimulator({ idPrefix: 'demo:' }, now);
      this.demoSnap = this.demo.snapshot(now);
    } else {
      this.demo = null;
      this.demoSnap = null;
    }
    this.recomputeRoomNames();
    this.markDirty();
  }

  // ---------------------------------------------------------------- personagem do projeto (editor)

  /** Escolhe nome e aparência do agente principal `id` e grava como o personagem da sala dele. */
  setCharacter(id: string, input: CharacterInput): CharacterResult {
    const rec = this.editable(id);
    if (!rec) return { result: 'not-found' };
    const info = rec.info;
    // Quem está saindo conta aqui: ao reabrir dentro do período de graça, ele volta com o nome dele.
    const conflict = this.nameConflict(input.name, id, info.roomId, true);
    if (conflict) return { result: 'conflict', message: conflict };
    const before = info.name;
    const parts = Object.keys(input.parts).length ? { ...input.parts } : undefined;
    // Outro principal da sala que estava com o personagem continua com o nome atual, agora guardado como o da sessão
    // dele: depois de um reinício, cada sessão volta quem era, e não com o personagem que esta salvou.
    for (const r of this.agents.values()) {
      const o = r.info;
      if (o.id === id || o.kind !== 'main' || o.roomId !== info.roomId || !o.custom) continue;
      this.deps.names.remember(o.sessionId, { name: o.name, look: o.look });
      delete o.custom;
    }
    this.deps.names.setCharacter(info.roomId, { name: input.name, look: info.look, seed: input.seed, ...(parts ? { parts } : {}), owner: info.sessionId });
    info.name = input.name;
    info.seed = input.seed;
    if (parts) info.parts = parts;
    else delete info.parts;
    info.custom = true;
    const room = this.roomName(info.roomId);
    const text = before === input.name ? tr('✏️ {0} mudou de visual em {1}', [input.name, room]) : tr('✏️ {0} agora é {1} em {2}', [before, input.name, room]);
    this.notice('character', id, 'info', text, info.roomId, { dedupeMs: 0 });
    this.markDirty();
    return { result: 'ok' };
  }

  /**
   * "Voltar ao sorteio": o agente volta ao nome da sessão e à seed do id; a sala só perde o personagem se ele for desta
   * sessão (o que outra sessão da sala salvou depois continua dela).
   */
  resetCharacter(id: string): 'ok' | 'not-found' {
    const rec = this.editable(id);
    if (!rec) return 'not-found';
    const info = rec.info;
    const owner = this.deps.names.character(info.roomId)?.owner;
    if (owner === undefined || owner === info.sessionId) this.deps.names.clearCharacter(info.roomId);
    if (info.custom) {
      const person = this.deps.names.assign(info.sessionId, this.takenNames(id));
      info.name = person.name;
      info.look = person.look;
      info.seed = hash32(id);
      delete info.parts;
      delete info.custom;
    }
    this.markDirty();
    return 'ok';
  }

  /** Agente principal real e presente (nem subagente, nem demo, nem saindo). */
  private editable(id: string): AgentRecord | undefined {
    const rec = this.agents.get(id);
    return rec && rec.info.kind === 'main' && rec.removeAt === undefined ? rec : undefined;
  }

  /**
   * Personagem escolhido para a sala, se o nome dele estiver livre; quem o recebe vira a dona. Quem está saindo não
   * conta: costuma ser a mesma sessão reaberta (pid novo) dentro do período de graça. Uma sessão que não é a dona e já
   * tem nome guardado mantém o dela: depois de um reinício, a ordem de chegada não troca identidades nem muda o
   * personagem de uma sessão no meio dela.
   */
  private roomCharacter(roomId: string, id: string, sessionId: string): StoredCharacter | undefined {
    const c = this.deps.names.character(roomId);
    if (!c) return undefined;
    if (c.owner !== undefined && c.owner !== sessionId && this.deps.names.get(sessionId)) return undefined;
    if (this.nameConflict(c.name, id, roomId)) return undefined;
    this.deps.names.claimCharacter(roomId, sessionId);
    return c;
  }

  /**
   * Por que `name` não pode ser o personagem de `id` na sala `roomId` (undefined = pode). Quem está saindo só conta com
   * `leaving`: na chegada costuma ser a mesma sessão reaberta; no editor, é alguém que pode voltar com esse nome.
   */
  private nameConflict(name: string, id: string, roomId: string, leaving = false): string | undefined {
    const key = nameKey(name);
    for (const r of this.agents.values()) {
      if (r.info.id === id || (r.removeAt !== undefined && !leaving) || nameKey(r.info.name) !== key) continue;
      return tr('{0} já está no escritório em {1}', [r.info.name, this.roomName(r.info.roomId)]);
    }
    for (const a of this.demoSnap?.agents ?? []) {
      if (nameKey(a.name) === key) return tr('{0} já está no escritório em {1}', [a.name, this.roomName(a.roomId)]);
    }
    for (const [n, room] of this.deps.names.reservedNames(roomId)) {
      if (nameKey(n) === key) return tr('{0} já é o personagem de {1}', [n, this.roomName(room)]);
    }
    return undefined;
  }

  // ---------------------------------------------------------------- relógio

  /** Avança o demo e remove quem já cumpriu o período de graça. Chamar a cada ~250 ms. */
  tick(): void {
    const now = this.now();
    if (this.demo) {
      const r = this.demo.tick(now);
      if (r.changed) {
        this.demoSnap = this.demo.snapshot(now);
        this.recomputeRoomNames();
        this.dirty = true;
      }
      if (r.feed.length) this.pushFeed(r.feed);
      this.pendingNotices.push(...r.notices);
      if (r.changed || r.feed.length || r.notices.length) this.markDirty();
    }
    let removed = false;
    for (const [id, rec] of this.agents) {
      if (rec.removeAt !== undefined && now >= rec.removeAt) {
        this.agents.delete(id);
        removed = true;
      }
    }
    // festa acabou / alarme expirou: o snapshot sai sem o efeito
    if (this.effects.prune(now)) this.markDirty();
    if (removed) {
      const occupied = new Set([...this.agents.values()].map((r) => r.info.roomId));
      for (const id of [...this.rooms.keys()]) if (!occupied.has(id)) this.rooms.delete(id);
      this.recomputeRoomNames();
      this.markDirty();
    }
  }

  /** Fecha uma revisão: devolve o snapshot (novo, se algo mudou), o feed e os avisos pendentes. */
  commit(): CommitResult {
    const feed = this.pendingFeed;
    const notices = this.pendingNotices;
    this.pendingFeed = [];
    this.pendingNotices = [];
    if (!this.dirty && this.last) return { snapshot: this.last, changed: false, feed, notices };
    this.rev++;
    this.dirty = false;
    this.last = this.build();
    return { snapshot: this.last, changed: true, feed, notices };
  }

  // ---------------------------------------------------------------- internos

  private build(): OfficeSnapshot {
    const now = this.now();
    const entries = new Map(this.rooms);
    for (const r of this.demoSnap?.rooms ?? []) entries.set(r.id, { path: r.path, createdAt: r.createdAt });
    this.slots.sync(entries.keys(), now);
    const rooms: RoomInfo[] = [...entries]
      .map(([id, r]) => ({
        id,
        name: this.roomName(id),
        path: r.path,
        slot: this.slots.slotOf(id) ?? 0,
        seed: hash32(id),
        createdAt: r.createdAt,
      }))
      .sort((a, b) => a.slot - b.slot);
    // festa/alarme (eventos do GitHub): das salas reais ou do demo
    for (const room of rooms) {
      const effect = this.effects.get(room.id, now) ?? this.demoSnap?.rooms.find((r) => r.id === room.id)?.effect;
      if (effect) room.effect = { ...effect };
    }
    const perms = this.deps.permissions?.();
    const real = [...this.agents.values()].map((r) => applyPermission(cloneAgent(r.info), perms?.get(r.info.id)));
    const reach = this.deps.messages?.();
    // Mensagens pelo escritório: principais presentes cuja sessão está com o plugin conectado. No demo quem decide é
    // o simulador; com o recurso desligado, ninguém recebe.
    for (const a of real) if (reach?.has(a.id) && a.kind === 'main' && a.status !== 'offline' && a.status !== 'done') a.canMessage = true;
    const demoAgents = (this.demoSnap?.agents ?? []).map((a) => {
      if (reach || !a.canMessage) return a;
      const { canMessage: _off, ...rest } = a;
      return rest;
    });
    const trim = (a: AgentInfo): AgentInfo => (a.recent.length > SNAPSHOT_RECENT ? { ...a, recent: a.recent.slice(-SNAPSHOT_RECENT) } : a);
    const sessions = new Map<string, number>();
    for (const a of real) if (a.kind === 'main' && a.status !== 'offline') sessions.set(a.account, (sessions.get(a.account) ?? 0) + 1);
    const ptys = this.deps.ptys?.();
    return {
      rev: this.rev,
      serverTime: now,
      rooms,
      agents: [...real, ...demoAgents].map(trim),
      accounts: [...this.deps.accounts(sessions), ...(this.demoSnap?.accounts ?? [])],
      ...(ptys ? { ptys: ptys.list } : {}),
      meta: {
        demo: this.isDemo(),
        sources: this.deps.sources(),
        startedAt: this.deps.startedAt,
        version: this.deps.version,
        build: this.deps.build?.(),
        terminal: this.deps.terminal === true,
        messages: this.deps.messages !== undefined,
        ...(ptys ? { pty: ptys.status } : {}),
        updates: this.deps.updates?.(),
        ...(this.deps.world ? { world: this.deps.world() } : {}),
      },
    };
  }

  /**
   * Nomes que o sorteio não pode dar: os de quem está no escritório (menos `exceptId` e os agentes principais da sessão
   * `exceptSession`) e os escolhidos para as salas.
   */
  private takenNames(exceptId?: string, exceptSession?: string): Set<string> {
    const used = new NameSet();
    for (const r of this.agents.values()) {
      if (r.info.id === exceptId || (exceptSession && r.info.kind === 'main' && r.info.sessionId === exceptSession)) continue;
      used.add(r.info.name);
    }
    for (const a of this.demoSnap?.agents ?? []) used.add(a.name);
    for (const n of this.deps.names.reservedNames().keys()) used.add(n);
    return used;
  }

  private descendants(id: string): AgentRecord[] {
    const out: AgentRecord[] = [];
    const queue = [id];
    while (queue.length) {
      const cur = queue.shift()!;
      for (const rec of this.agents.values()) {
        if (rec.info.parentId === cur) {
          out.push(rec);
          queue.push(rec.info.id);
        }
      }
    }
    return out;
  }

  private ensureRoom(roomId: string, now: number): void {
    if (this.rooms.has(roomId)) return;
    this.rooms.set(roomId, { path: roomId, createdAt: now });
    this.recomputeRoomNames();
    this.notice('room', roomId, 'info', tr('🏗️ Nova sala: {0}', [this.roomName(roomId)]), roomId);
  }

  private recomputeRoomNames(): void {
    const paths = new Map([...this.rooms].map(([id, r]) => [id, r.path]));
    for (const r of this.demoSnap?.rooms ?? []) paths.set(r.id, r.path);
    this.roomNames = roomDisplayNames(paths);
    for (const [id, path] of paths) {
      const alias = this.deps.roomAlias?.(path);
      if (alias) this.roomNames.set(id, alias);
    }
  }

  /** Um nome de sala mudou (renomear): recalcula e transmite. */
  refreshRoomNames(): void {
    this.recomputeRoomNames();
    this.markDirty();
  }

  private pushFeed(items: FeedItem[]): void {
    this.pendingFeed.push(...items);
    this.feed.push(...items);
    if (this.feed.length > FEED_LIMIT) this.feed.splice(0, this.feed.length - FEED_LIMIT);
  }

  private notice(
    kind: NoticeKind,
    key: string,
    level: NoticeLevel,
    text: string,
    roomId?: string,
    opts: { dedupeKey?: string; dedupeMs?: number } = {},
  ): void {
    if (this.booting) return;
    const now = this.now();
    const k = opts.dedupeKey ?? `${key}|${kind}`;
    const window = opts.dedupeMs ?? NOTICE_DEDUPE_MS;
    const last = this.noticeAt.get(k);
    if (last !== undefined && now - last < window) return;
    this.noticeAt.set(k, now);
    if (this.noticeAt.size > 2_000) {
      // Só esquece o que já passou da janela mais longa (a do aviso de shell).
      for (const [nk, t] of this.noticeAt) if (now - t > Math.max(NOTICE_DEDUPE_MS, SHELL_NOTICE_DEDUPE_MS)) this.noticeAt.delete(nk);
    }
    const n: Notice = { id: `n-${now.toString(36)}-${++this.seq}`, level, text, at: now };
    if (kind !== 'room') n.agentId = key;
    if (roomId) n.roomId = roomId;
    this.pendingNotices.push(n);
  }
}
