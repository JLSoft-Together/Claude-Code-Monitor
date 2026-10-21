// Linha do tempo do escritório (timelapse): formato dos arquivos gravados pelo servidor
// (server/history/timeline.ts) e reconstrução do estado, usada pelo player do cliente.
// Código puro: sem APIs de Node nem de DOM.
//
// Arquivo: <dataDir>/timeline/AAAA-MM-DD.jsonl (dia local do servidor), um registro JSON por linha:
//   {"t":"k",...}    keyframe: o estado completo (salas, agentes e contas);
//   {"t":"d",...}    delta: só o que mudou desde o registro anterior;
//   {"t":"end",...}  o servidor parou (ou o dia chegou ao limite de tamanho).
// Todo arquivo começa com um keyframe e os keyframes se repetem a cada `every` ms; sem nenhum registro
// por bem mais que isso, o servidor estava desligado. Cada registro começa com `t` e `at` (nessa ordem),
// o que permite ler o horário da primeira e da última linha sem interpretar o arquivo inteiro.
//
// Só entram os campos que o mundo e a interface usam para desenhar, com os resumos de atividade já
// mascarados (a mesma exposição do /api/snapshot): nada de detalhe de comando, tarefa ou transcript.
import type { AppearanceParts } from './appearance';
import type { AccountInfo, AccountUsage, Activity, ActivityKind, AgentInfo, AgentKind, AgentStatus, OfficeSnapshot, Provider, RoomInfo, ShellJob } from './types';

export const TIMELINE_VERSION = 1;

/** Títulos e textos longos são cortados (o arquivo do dia tem limite de tamanho). */
const MAX_TITLE = 160;
const MAX_TEXT = 120;

export interface TimelineActivity {
  kind: ActivityKind;
  icon: string;
  text: string;
  at: number;
  tool?: string;
  error?: true;
}

/** Shell resumido (sem o comando completo). */
export interface TimelineShell {
  id: string;
  label: string;
  startedAt: number;
  background: boolean;
  kind: 'shell' | 'monitor';
}

export interface TimelineAgent {
  id: string;
  kind: AgentKind;
  /** Ausente = 'claude' (AgentInfo.provider). */
  provider?: Provider;
  parentId?: string;
  roomId: string;
  name: string;
  look: 'f' | 'm';
  role: string;
  account: string;
  status: AgentStatus;
  statusSince: number;
  startedAt: number;
  waitingFor?: string;
  activity?: TimelineActivity;
  seed: number;
  /** Peças do personagem editado (ver AgentInfo.parts). */
  parts?: AppearanceParts;
  background?: true;
  title?: string;
  shells?: TimelineShell[];
  /** Agente do modo demonstração (id com prefixo "demo:"): o player pode escondê-lo. */
  demo?: true;
}

export interface TimelineRoom {
  id: string;
  name: string;
  path: string;
  slot: number;
  seed: number;
  createdAt: number;
  demo?: true;
}

/** Conta resumida: sem e-mail, organização nem pasta; uso sem o horário da coleta (mudaria a cada resposta). */
export interface TimelineAccount {
  id: string;
  /** Ausente = 'claude' (AccountInfo.provider). */
  provider?: Provider;
  short: string;
  name: string;
  color: string;
  plan?: string;
  sessions: number;
  usage?: Pick<AccountUsage, 'fiveHour' | 'sevenDay' | 'source' | 'noQuota'>;
  usageStatus: AccountInfo['usageStatus'];
  demo?: true;
}

export interface TimelineKeyframe {
  t: 'k';
  at: number;
  v: number;
  /** Intervalo entre keyframes em vigor (ms). */
  every: number;
  /** Primeiro registro depois de o servidor subir. */
  boot?: true;
  rooms: TimelineRoom[];
  agents: TimelineAgent[];
  accounts: TimelineAccount[];
}

/** Campos que mudaram; `null` = o campo deixou de existir. */
export type TimelinePatch<T> = { [K in keyof T]?: T[K] | null };

/** O que mudou entre dois estados. Agente novo vem completo; `null` = saiu. */
export interface TimelineChanges {
  rooms?: [string, TimelineRoom | null][];
  agents?: [string, TimelinePatch<TimelineAgent> | null][];
  accounts?: [string, TimelineAccount | null][];
}

export interface TimelineDelta extends TimelineChanges {
  t: 'd';
  at: number;
}

export interface TimelineEnd {
  t: 'end';
  at: number;
  /** 'limit' = o dia chegou ao limite de tamanho e a gravação parou até a virada. */
  reason?: 'stop' | 'limit';
}

export type TimelineRecord = TimelineKeyframe | TimelineDelta | TimelineEnd;

/** Estado completo num instante (o que um keyframe descreve). */
export interface TimelineFrame {
  rooms: Map<string, TimelineRoom>;
  agents: Map<string, TimelineAgent>;
  accounts: Map<string, TimelineAccount>;
}

// ------------------------------------------------------------------ dias

const pad2 = (n: number) => String(n).padStart(2, '0');

/** Dia local de um instante, no formato do nome do arquivo (AAAA-MM-DD). */
export function dayKey(at: number): string {
  const d = new Date(at);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** AAAA-MM-DD de uma data que existe no calendário (é o único formato aceito como nome de arquivo). */
export function isDayKey(s: unknown): s is string {
  if (typeof s !== 'string') return false;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (y < 2000 || mo < 1 || mo > 12 || d < 1) return false;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

/** Meia-noite local do dia `key` (epoch ms). */
export function dayStart(key: string): number {
  const [y, mo, d] = key.split('-').map(Number);
  return new Date(y, mo - 1, d).getTime();
}

/** O dia `offset` dias antes/depois de `key` (aritmética de calendário: imune ao horário de verão). */
export function shiftDay(key: string, offset: number): string {
  const [y, mo, d] = key.split('-').map(Number);
  return dayKey(new Date(y, mo - 1, d + offset, 12).getTime());
}

// ------------------------------------------------------------------ snapshot -> registro

const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

export function compactActivity(a: Activity): TimelineActivity {
  const out: TimelineActivity = { kind: a.kind, icon: a.icon, text: clip(a.text, MAX_TEXT), at: a.at };
  if (a.tool) out.tool = a.tool;
  if (a.error) out.error = true;
  return out;
}

export function compactShell(j: ShellJob): TimelineShell {
  return { id: j.id, label: clip(j.label, MAX_TEXT), startedAt: j.startedAt, background: j.background, kind: j.kind };
}

export function compactAgent(a: AgentInfo, demo = false): TimelineAgent {
  const out: TimelineAgent = {
    id: a.id,
    kind: a.kind,
    roomId: a.roomId,
    name: a.name,
    look: a.look,
    role: a.role,
    account: a.account,
    status: a.status,
    statusSince: a.statusSince,
    startedAt: a.startedAt,
    seed: a.seed,
  };
  if (a.provider) out.provider = a.provider;
  if (a.parentId) out.parentId = a.parentId;
  if (a.waitingFor) out.waitingFor = a.waitingFor;
  if (a.activity) out.activity = compactActivity(a.activity);
  if (a.background) out.background = true;
  if (a.parts && Object.keys(a.parts).length) out.parts = { ...a.parts };
  if (a.title) out.title = clip(a.title, MAX_TITLE);
  if (a.shells?.length) out.shells = a.shells.map(compactShell);
  if (demo) out.demo = true;
  return out;
}

export function compactRoom(r: RoomInfo, demo = false): TimelineRoom {
  const out: TimelineRoom = { id: r.id, name: r.name, path: r.path, slot: r.slot, seed: r.seed, createdAt: r.createdAt };
  if (demo) out.demo = true;
  return out;
}

export function compactAccount(a: AccountInfo, demo = false): TimelineAccount {
  const out: TimelineAccount = { id: a.id, short: a.short, name: a.name, color: a.color, sessions: a.sessions, usageStatus: a.usageStatus };
  if (a.provider) out.provider = a.provider;
  if (a.plan) out.plan = a.plan;
  if (a.usage) {
    const u: NonNullable<TimelineAccount['usage']> = { source: a.usage.source };
    if (a.usage.fiveHour) u.fiveHour = { ...a.usage.fiveHour };
    if (a.usage.sevenDay) u.sevenDay = { ...a.usage.sevenDay };
    if (a.usage.noQuota) u.noQuota = true;
    out.usage = u;
  }
  if (demo) out.demo = true;
  return out;
}

/** Agentes, salas e contas do modo demonstração usam o prefixo "demo:" (ver Office.setDemo). */
export const isDemoId = (id: string): boolean => id.startsWith('demo:');

export function compactSnapshot(snap: OfficeSnapshot, isDemo: (id: string) => boolean = isDemoId): TimelineFrame {
  return {
    rooms: new Map(snap.rooms.map((r) => [r.id, compactRoom(r, isDemo(r.id))])),
    agents: new Map(snap.agents.map((a) => [a.id, compactAgent(a, isDemo(a.id))])),
    accounts: new Map(snap.accounts.map((a) => [a.id, compactAccount(a, isDemo(a.id))])),
  };
}

export function keyframeOf(frame: TimelineFrame, at: number, every: number, boot = false): TimelineKeyframe {
  const k: TimelineKeyframe = {
    t: 'k',
    at,
    v: TIMELINE_VERSION,
    every,
    rooms: [...frame.rooms.values()],
    agents: [...frame.agents.values()],
    accounts: [...frame.accounts.values()],
  };
  if (boot) k.boot = true;
  return k;
}

export function frameOf(k: TimelineKeyframe): TimelineFrame {
  return {
    rooms: new Map(k.rooms.map((r) => [r.id, r])),
    agents: new Map(k.agents.map((a) => [a.id, a])),
    accounts: new Map(k.accounts.map((a) => [a.id, a])),
  };
}

export function emptyFrame(): TimelineFrame {
  return { rooms: new Map(), agents: new Map(), accounts: new Map() };
}

// ------------------------------------------------------------------ diferenças

function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

function patchOf<T extends object>(prev: T, next: T): TimelinePatch<T> | null {
  const p = prev as Record<string, unknown>;
  const n = next as Record<string, unknown>;
  let patch: Record<string, unknown> | null = null;
  for (const k of Object.keys(n)) if (!same(p[k], n[k])) (patch ??= {})[k] = n[k];
  for (const k of Object.keys(p)) if (!(k in n)) (patch ??= {})[k] = null;
  return patch as TimelinePatch<T> | null;
}

function diffWhole<T>(prev: Map<string, T>, next: Map<string, T>): [string, T | null][] {
  const out: [string, T | null][] = [];
  for (const [id, v] of next) if (!same(prev.get(id), v)) out.push([id, v]);
  for (const id of prev.keys()) if (!next.has(id)) out.push([id, null]);
  return out;
}

/** O que mudou de `prev` para `next` (null = nada que o player desenhe). */
export function diffFrames(prev: TimelineFrame, next: TimelineFrame): TimelineChanges | null {
  const out: TimelineChanges = {};
  const rooms = diffWhole(prev.rooms, next.rooms);
  if (rooms.length) out.rooms = rooms;
  const agents: [string, TimelinePatch<TimelineAgent> | null][] = [];
  for (const [id, a] of next.agents) {
    const p = prev.agents.get(id);
    if (!p) agents.push([id, a]);
    else {
      const patch = patchOf(p, a);
      if (patch) agents.push([id, patch]);
    }
  }
  for (const id of prev.agents.keys()) if (!next.agents.has(id)) agents.push([id, null]);
  if (agents.length) out.agents = agents;
  const accounts = diffWhole(prev.accounts, next.accounts);
  if (accounts.length) out.accounts = accounts;
  return out.rooms || out.agents || out.accounts ? out : null;
}

const isFullAgent = (p: TimelinePatch<TimelineAgent>): p is TimelineAgent =>
  typeof p.id === 'string' && typeof p.roomId === 'string' && typeof p.name === 'string' && typeof p.status === 'string' && typeof p.seed === 'number';

/**
 * Aplica as mudanças (sem alterar os objetos antigos: agentes alterados viram objetos novos, então
 * snapshots já entregues à interface continuam valendo). Patch de um agente desconhecido que não vem
 * completo (linha perdida no arquivo) é ignorado: o próximo keyframe corrige.
 */
export function applyChanges(frame: TimelineFrame, d: TimelineChanges): void {
  for (const [id, r] of d.rooms ?? []) {
    if (r) frame.rooms.set(id, r);
    else frame.rooms.delete(id);
  }
  for (const [id, acc] of d.accounts ?? []) {
    if (acc) frame.accounts.set(id, acc);
    else frame.accounts.delete(id);
  }
  for (const [id, patch] of d.agents ?? []) {
    if (!patch) {
      frame.agents.delete(id);
      continue;
    }
    const cur = frame.agents.get(id);
    if (!cur) {
      if (isFullAgent(patch)) frame.agents.set(id, withoutNulls(patch) as TimelineAgent);
      continue;
    }
    const next: Record<string, unknown> = { ...cur };
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) delete next[k];
      else next[k] = v;
    }
    frame.agents.set(id, next as unknown as TimelineAgent);
  }
}

function withoutNulls<T extends object>(o: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) if (v !== null) out[k] = v;
  return out as T;
}

// ------------------------------------------------------------------ leitura

/**
 * Interpreta o conteúdo de um arquivo do dia. Linhas inválidas (cortadas, corrompidas) são ignoradas;
 * um relógio que voltou no tempo não desordena os registros (o horário é segurado no anterior).
 */
export function parseTimeline(text: string): TimelineRecord[] {
  const out: TimelineRecord[] = [];
  let last = -Infinity;
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let rec: unknown;
    try {
      rec = JSON.parse(line);
    } catch {
      continue;
    }
    if (!isRecord(rec)) continue;
    if (rec.at < last) rec.at = last;
    last = rec.at;
    out.push(rec);
  }
  return out;
}

function isRecord(r: unknown): r is TimelineRecord {
  if (!r || typeof r !== 'object') return false;
  const o = r as Record<string, unknown>;
  if (typeof o.at !== 'number' || !Number.isFinite(o.at)) return false;
  if (o.t === 'k') return Array.isArray(o.rooms) && Array.isArray(o.agents) && Array.isArray(o.accounts) && typeof o.every === 'number';
  if (o.t === 'd') return ['rooms', 'agents', 'accounts'].every((k) => o[k] === undefined || Array.isArray(o[k]));
  return o.t === 'end';
}

// ------------------------------------------------------------------ registro -> snapshot

const ZERO_STATS = { toolCalls: 0, tokensIn: 0, tokensOut: 0, subagents: 0 };

/** Id estável de uma atividade reconstruída (o arquivo não guarda o id original). */
export function activityId(agentId: string, a: Pick<TimelineActivity, 'at' | 'kind'>): string {
  return `tl:${agentId}:${a.at}:${a.kind}`;
}

export function toActivity(agentId: string, a: TimelineActivity): Activity {
  const out: Activity = { id: activityId(agentId, a), kind: a.kind, icon: a.icon, text: a.text, at: a.at };
  if (a.tool) out.tool = a.tool;
  if (a.error) out.error = true;
  return out;
}

/** AgentInfo completo a partir do resumo gravado (campos que o arquivo não guarda ficam vazios). */
export function toAgentInfo(t: TimelineAgent, recent: Activity[] = []): AgentInfo {
  const activity = t.activity ? toActivity(t.id, t.activity) : undefined;
  const a: AgentInfo = {
    id: t.id,
    kind: t.kind,
    roomId: t.roomId,
    name: t.name,
    look: t.look,
    role: t.role,
    sessionId: t.id,
    account: t.account,
    status: t.status,
    recent: recent.length ? recent.slice() : activity ? [activity] : [],
    tasks: [],
    startedAt: t.startedAt,
    lastEventAt: Math.max(t.statusSince, activity?.at ?? 0),
    statusSince: t.statusSince,
    stats: { ...ZERO_STATS },
    seed: t.seed,
  };
  if (t.provider) a.provider = t.provider;
  if (t.parentId) a.parentId = t.parentId;
  if (t.title) a.title = t.title;
  if (t.waitingFor) a.waitingFor = t.waitingFor;
  if (activity) a.activity = activity;
  if (t.shells?.length) a.shells = t.shells.map((j) => ({ ...j }));
  if (t.background) a.background = true;
  if (t.parts) a.parts = { ...t.parts };
  return a;
}

export function toRoomInfo(r: TimelineRoom): RoomInfo {
  return { id: r.id, name: r.name, path: r.path, slot: r.slot, seed: r.seed, createdAt: r.createdAt };
}

export function toAccountInfo(a: TimelineAccount, at: number): AccountInfo {
  const out: AccountInfo = { id: a.id, short: a.short, name: a.name, color: a.color, configDir: '', sessions: a.sessions, usageStatus: a.usageStatus };
  if (a.provider) out.provider = a.provider;
  if (a.plan) out.plan = a.plan;
  if (a.usage) {
    const u: AccountUsage = { source: a.usage.source, fetchedAt: at };
    if (a.usage.fiveHour) u.fiveHour = { ...a.usage.fiveHour };
    if (a.usage.sevenDay) u.sevenDay = { ...a.usage.sevenDay };
    if (a.usage.noQuota) u.noQuota = true;
    out.usage = u;
  }
  return out;
}
