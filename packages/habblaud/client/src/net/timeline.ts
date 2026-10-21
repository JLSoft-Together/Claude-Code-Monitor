// Timelapse no navegador: busca a linha do tempo gravada pelo servidor (GET /api/timeline/*) e
// reconstrói o escritório num instante qualquer do dia (formato em shared/timeline.ts). A reconstrução
// parte do keyframe anterior e aplica os deltas até o instante; andando para a frente, só aplica o que
// falta. Também resume o dia (agentes presentes e trabalhando por minuto) para o gráfico e os picos.
import type { Activity, OfficeSnapshot } from '../../../shared/types';
import {
  applyChanges,
  emptyFrame,
  frameOf,
  isDayKey,
  parseTimeline,
  toAccountInfo,
  toActivity,
  toAgentInfo,
  toRoomInfo,
  type TimelineAgent,
  type TimelineFrame,
  type TimelineRecord,
} from '../../../shared/timeline';
import { tr } from '../../../shared/i18n';

export interface TimelineDayInfo {
  /** AAAA-MM-DD. */
  day: string;
  bytes: number;
  /** Primeiro e último registro do dia (epoch ms). */
  from: number;
  to: number;
}

export interface TimelineDays {
  /** O servidor está gravando (HABBLAUD_TIMELINE não desligou). */
  recording: boolean;
  days: TimelineDayInfo[];
}

export async function fetchTimelineDays(signal?: AbortSignal): Promise<TimelineDays> {
  const res = await fetch('/api/timeline/days', { signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = (await res.json()) as Partial<TimelineDays>;
  const days = Array.isArray(body.days) ? body.days.filter((d) => isDayKey(d?.day) && Number.isFinite(d.from) && Number.isFinite(d.to)) : [];
  return { recording: body.recording === true, days };
}

export async function fetchTimelineDay(day: string, signal?: AbortSignal): Promise<TimelineRecord[]> {
  if (!isDayKey(day)) throw new Error(tr('dia inválido'));
  const res = await fetch(`/api/timeline/${day}`, { signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return parseTimeline(await res.text());
}

/** Um minuto da linha do tempo: o máximo de agentes presentes, trabalhando e esperando você. */
export interface TimelineBucket {
  at: number;
  present: number;
  working: number;
  waiting: number;
}

export interface TimelinePeak {
  at: number;
  working: number;
  present: number;
}

export const BUCKET_MS = 60_000;
/** Atividades recentes de cada agente no snapshot reconstruído (como o SNAPSHOT_RECENT do servidor). */
const RECENT = 8;
/** Folga sobre ~1,5 intervalo de keyframe sem nenhum registro: daí em diante, "sem dados". */
const GAP_SLACK_MS = 60_000;
const PEAKS = 4;
/** Distância mínima entre dois picos: 1/8 do período gravado, entre 10 min e 1 h. */
const peakSpacing = (span: number) => Math.min(60 * 60_000, Math.max(10 * 60_000, span / 8));

export interface ReplayView {
  /** Mostrar os agentes do modo demonstração. */
  includeDemo: boolean;
}

const visible = (demo: boolean | undefined, view: ReplayView) => view.includeDemo || !demo;

export class TimelineReplay {
  readonly from: number;
  readonly to: number;
  readonly hasDemo: boolean;
  readonly hasReal: boolean;
  /** Índices dos keyframes em `records`. */
  private readonly keys: number[] = [];
  private frame: TimelineFrame = emptyFrame();
  /** Último registro aplicado (-1 = antes do primeiro). */
  private cursor = -1;
  /** Intervalo de keyframes em vigor no ponto atual. */
  private every = 300_000;
  private recent = new Map<string, Activity[]>();
  private rev = 0;
  private readonly createdAt = Date.now();
  private bucketCache = new Map<boolean, TimelineBucket[]>();

  constructor(
    readonly day: string,
    readonly records: TimelineRecord[],
  ) {
    let demo = false;
    let real = false;
    records.forEach((r, i) => {
      if (r.t === 'k') {
        this.keys.push(i);
        for (const a of r.agents) a.demo ? (demo = true) : (real = true);
      } else if (r.t === 'd') {
        for (const [, p] of r.agents ?? []) if (p && typeof p.id === 'string') p.demo ? (demo = true) : (real = true);
      }
    });
    this.hasDemo = demo;
    this.hasReal = real;
    this.from = records[0]?.at ?? 0;
    this.to = records[records.length - 1]?.at ?? this.from;
  }

  get empty(): boolean {
    return this.records.length === 0;
  }

  /** Leva a reconstrução até o instante `t` (para trás ou longe: recomeça do keyframe anterior). */
  moveTo(t: number): void {
    const target = this.indexAt(t);
    if (target === this.cursor) return;
    if (target < 0) {
      this.frame = emptyFrame();
      this.recent.clear();
      this.cursor = -1;
      return;
    }
    let start: number;
    if (target < this.cursor || this.cursor < 0) {
      // Para trás (ou do zero): recomeça do keyframe anterior, sem atividades "do futuro" no recent.
      start = this.keyAtOrBefore(target);
      this.recent.clear();
      if (start < 0) {
        this.frame = emptyFrame();
        start = 0;
      }
    } else {
      // Para a frente: se houver um keyframe no caminho, pula direto para ele.
      start = this.cursor + 1;
      const k = this.keyAtOrBefore(target);
      if (k > this.cursor) start = k;
    }
    for (let i = start; i <= target; i++) this.apply(i);
    this.cursor = target;
  }

  /** Sem dados em `t`: antes da gravação, servidor parado (fim marcado) ou silêncio longo demais. */
  isOff(t: number): boolean {
    if (this.cursor < 0) return true;
    const last = this.records[this.cursor];
    if (last.t === 'end') return true;
    return t - last.at > this.every * 1.5 + GAP_SLACK_MS;
  }

  /** O fim marcado mais recente foi pelo limite de tamanho do dia. */
  get limited(): boolean {
    const last = this.records[this.cursor];
    return last?.t === 'end' && last.reason === 'limit';
  }

  /** Snapshot do instante `t` (chame moveTo(t) antes), como se viesse do servidor. */
  snapshot(t: number, view: ReplayView): OfficeSnapshot {
    const off = this.isOff(t);
    const agents = off
      ? []
      : [...this.frame.agents.values()].filter((a) => visible(a.demo, view)).map((a) => toAgentInfo(a, this.recent.get(a.id) ?? []));
    const rooms = off ? [] : [...this.frame.rooms.values()].filter((r) => visible(r.demo, view)).map(toRoomInfo);
    const accounts = [...this.frame.accounts.values()].filter((a) => visible(a.demo, view)).map((a) => toAccountInfo(a, t));
    return {
      rev: ++this.rev,
      serverTime: t,
      rooms: rooms.sort((a, b) => a.slot - b.slot),
      agents,
      accounts,
      meta: {
        demo: agents.some((a) => this.frame.agents.get(a.id)?.demo),
        sources: [],
        startedAt: this.createdAt,
        version: 'timelapse',
        // Sem terminal no replay: a conversa é do presente, não do instante reproduzido.
        terminal: false,
      },
    };
  }

  /** Agentes presentes, trabalhando e esperando, minuto a minuto (para o gráfico da linha do tempo). */
  buckets(view: ReplayView): TimelineBucket[] {
    const hit = this.bucketCache.get(view.includeDemo);
    if (hit) return hit;
    const out: TimelineBucket[] = [];
    if (this.empty) return out;
    const base = Math.floor(this.from / BUCKET_MS) * BUCKET_MS;
    const n = Math.min(2 * 1441, Math.floor((this.to - base) / BUCKET_MS) + 1);
    for (let i = 0; i < n; i++) out.push({ at: base + i * BUCKET_MS, present: 0, working: 0, waiting: 0 });
    const frame = emptyFrame();
    let every = 300_000;
    let ended = false;
    let counts = { present: 0, working: 0, waiting: 0 };
    let lastAt = this.from;
    const fill = (fromAt: number, toAt: number, c: typeof counts) => {
      // Do registro anterior até este, o estado não mudou (salvo silêncio longo = servidor parado).
      const until = ended ? fromAt : Math.min(toAt, fromAt + every * 1.5 + GAP_SLACK_MS);
      for (let i = Math.max(0, Math.floor((fromAt - base) / BUCKET_MS)); i < n && base + i * BUCKET_MS <= until; i++) {
        const b = out[i];
        b.present = Math.max(b.present, c.present);
        b.working = Math.max(b.working, c.working);
        b.waiting = Math.max(b.waiting, c.waiting);
      }
    };
    for (const r of this.records) {
      fill(lastAt, r.at, counts);
      if (r.t === 'k') {
        const f = frameOf(r);
        frame.agents = f.agents;
        frame.rooms = f.rooms;
        frame.accounts = f.accounts;
        every = r.every;
        ended = false;
      } else if (r.t === 'd') {
        applyChanges(frame, r);
        ended = false;
      } else ended = true;
      counts = ended ? { present: 0, working: 0, waiting: 0 } : count(frame, view);
      lastAt = r.at;
      fill(r.at, r.at, counts);
    }
    this.bucketCache.set(view.includeDemo, out);
    return out;
  }

  /** Momentos de pico (mais agentes trabalhando ao mesmo tempo), espaçados, em ordem cronológica. */
  peaks(view: ReplayView): TimelinePeak[] {
    const ranked = this.buckets(view)
      .filter((b) => b.working > 0)
      .sort((a, b) => b.working - a.working || b.present - a.present || a.at - b.at);
    const out: TimelinePeak[] = [];
    const spacing = peakSpacing(this.to - this.from);
    for (const b of ranked) {
      if (out.length >= PEAKS) break;
      if (out.some((p) => Math.abs(p.at - b.at) < spacing)) continue;
      out.push({ at: b.at, working: b.working, present: b.present });
    }
    return out.sort((a, b) => a.at - b.at);
  }

  // ---------------------------------------------------------------- internos

  private apply(i: number): void {
    const r = this.records[i];
    if (r.t === 'k') {
      this.frame = frameOf(r);
      this.every = r.every;
      for (const id of [...this.recent.keys()]) if (!this.frame.agents.has(id)) this.recent.delete(id);
      for (const a of r.agents) this.remember(a);
    } else if (r.t === 'd') {
      applyChanges(this.frame, r);
      for (const [id, p] of r.agents ?? []) {
        if (!p) this.recent.delete(id);
        else if (p.activity) {
          const a = this.frame.agents.get(id);
          if (a) this.remember(a);
        }
      }
    }
  }

  /** Acumula a atividade atual no `recent` do agente (sem repetir a última). */
  private remember(a: TimelineAgent): void {
    if (!a.activity) return;
    const act = toActivity(a.id, a.activity);
    const list = this.recent.get(a.id) ?? [];
    if (list[list.length - 1]?.id === act.id) return;
    list.push(act);
    if (list.length > RECENT) list.splice(0, list.length - RECENT);
    this.recent.set(a.id, list);
  }

  /** Último registro com `at` <= t (-1 = antes do primeiro). Os registros estão em ordem de `at`. */
  private indexAt(t: number): number {
    let lo = 0;
    let hi = this.records.length - 1;
    let ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (this.records[mid].at <= t) {
        ans = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    return ans;
  }

  /** Índice do último keyframe em ou antes do registro `i` (-1 = nenhum). */
  private keyAtOrBefore(i: number): number {
    let ans = -1;
    for (const k of this.keys) {
      if (k > i) break;
      ans = k;
    }
    return ans;
  }
}

function count(frame: TimelineFrame, view: ReplayView): { present: number; working: number; waiting: number } {
  let present = 0;
  let working = 0;
  let waiting = 0;
  for (const a of frame.agents.values()) {
    if (!visible(a.demo, view) || a.status === 'offline' || a.status === 'done') continue;
    present++;
    if (a.status === 'working') working++;
    else if (a.status === 'waiting') waiting++;
  }
  return { present, working, waiting };
}
