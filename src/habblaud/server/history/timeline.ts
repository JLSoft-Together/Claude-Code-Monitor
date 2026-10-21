// Gravador da linha do tempo do escritório (timelapse). Grava em <dataDir>/timeline/AAAA-MM-DD.jsonl
// (dia local; formato em shared/timeline.ts) um keyframe a cada ~5 min e na virada do dia e, a cada
// snapshot novo do Office em que algo que o player desenha mudou, um delta (no máximo um por segundo).
// Guarda só os resumos que o /api/snapshot já expõe (atividades mascaradas): nada de transcript.
//
// Limites: passou de ~20 MB no dia, grava menos (delta a cada 15 s, keyframe a cada 15 min); passou
// de ~30 MB, para até a virada do dia. Retenção: os últimos 7 dias (os mais antigos são apagados).
// Falha de disco nunca derruba o servidor: o gravador avisa no log uma vez, espera 1 min e tenta de
// novo (com um keyframe, já que os deltas do intervalo se perderam).
import { appendFileSync, closeSync, mkdirSync, openSync, readdirSync, readSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import type { OfficeSnapshot } from '../../shared/types';
import { compactSnapshot, dayKey, diffFrames, isDayKey, isDemoId, keyframeOf, shiftDay, type TimelineFrame, type TimelineRecord } from '../../shared/timeline';
import { errMsg, log } from '../log';
import { tr } from '../../shared/i18n';

/** Pasta dentro do HABBLAUD_DATA_DIR. */
export const TIMELINE_DIR = 'timeline';
export const KEYFRAME_MS = 5 * 60_000;
export const THROTTLE_MS = 1_000;
/** Acima disto (bytes no dia), grava com menos frequência. */
export const SOFT_LIMIT_BYTES = 20 * 1024 * 1024;
/** Acima disto, para de gravar até a virada do dia. */
export const HARD_LIMIT_BYTES = 30 * 1024 * 1024;
export const SLOW_THROTTLE_MS = 15_000;
export const SLOW_KEYFRAME_MS = 15 * 60_000;
export const RETENTION_DAYS = 7;
export const RETRY_MS = 60_000;
const TICK_MS = 500;

const FILE_RE = /^(\d{4}-\d{2}-\d{2})\.jsonl$/;

export interface TimelineRecorderOptions {
  /** Pasta dos arquivos (<dataDir>/timeline). */
  dir: string;
  now?: () => number;
  /** Quem é do modo demonstração (gravado com `demo: true`). Padrão: id com prefixo "demo:". */
  isDemo?: (id: string) => boolean;
  keyframeMs?: number;
  throttleMs?: number;
  softBytes?: number;
  hardBytes?: number;
  slowThrottleMs?: number;
  slowKeyframeMs?: number;
  /** Dias guardados (contando hoje); 0 ou Infinity = nunca apaga. */
  retentionDays?: number;
  retryMs?: number;
}

/** Caminho do arquivo do dia, só para chaves AAAA-MM-DD válidas (nunca monta caminho com texto livre). */
export function timelineFile(dir: string, day: string): string | null {
  return isDayKey(day) ? join(dir, `${day}.jsonl`) : null;
}

export class TimelineRecorder {
  private readonly dir: string;
  private readonly now: () => number;
  private readonly isDemo: (id: string) => boolean;
  private readonly keyframeMs: number;
  private readonly throttleMs: number;
  private readonly softBytes: number;
  private readonly hardBytes: number;
  private readonly slowThrottleMs: number;
  private readonly slowKeyframeMs: number;
  private readonly retentionDays: number;
  private readonly retryMs: number;

  /** Último estado recebido. */
  private latest: TimelineFrame | null = null;
  /** Estado que o arquivo reconstrói até a última linha gravada. */
  private written: TimelineFrame | null = null;
  private day: string | null = null;
  private file = '';
  private bytes = 0;
  private lastKeyAt = 0;
  private lastDeltaAt = 0;
  private pending = false;
  private needKeyframe = true;
  private booted = false;
  /** O dia chegou ao limite: nada mais até a virada. */
  private limited = false;
  private failedAt: number | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(opts: TimelineRecorderOptions) {
    this.dir = opts.dir;
    this.now = opts.now ?? Date.now;
    this.isDemo = opts.isDemo ?? isDemoId;
    this.keyframeMs = opts.keyframeMs ?? KEYFRAME_MS;
    this.throttleMs = opts.throttleMs ?? THROTTLE_MS;
    this.softBytes = opts.softBytes ?? SOFT_LIMIT_BYTES;
    this.hardBytes = opts.hardBytes ?? HARD_LIMIT_BYTES;
    this.slowThrottleMs = opts.slowThrottleMs ?? SLOW_THROTTLE_MS;
    this.slowKeyframeMs = opts.slowKeyframeMs ?? SLOW_KEYFRAME_MS;
    this.retentionDays = opts.retentionDays ?? RETENTION_DAYS;
    this.retryMs = opts.retryMs ?? RETRY_MS;
  }

  /** Relógio interno: deltas pendentes (throttle), keyframes periódicos e virada do dia. */
  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), TICK_MS);
    this.timer.unref?.();
  }

  /** Para o relógio e marca o fim no arquivo (o player mostra "sem dados" depois disso). */
  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    const now = this.now();
    if (!this.written || this.limited || this.day !== dayKey(now) || this.failedAt !== null) return;
    if (this.pending) this.writeDelta(now);
    this.append({ t: 'end', at: now }, now);
  }

  /** Snapshot novo do Office (o hub chama a cada commit com mudança). */
  ingest(snap: OfficeSnapshot): void {
    try {
      this.latest = compactSnapshot(snap, this.isDemo);
      this.pending = true;
    } catch (err) {
      log.warnOnce(`timeline-ingest:${errMsg(err)}`, tr('Snapshot ignorado pela linha do tempo: {0}', [errMsg(err)]));
      return;
    }
    this.tick();
  }

  tick(): void {
    try {
      this.pump();
    } catch (err) {
      log.warnOnce(`timeline-tick:${errMsg(err)}`, tr('Falha no gravador da linha do tempo: {0}', [errMsg(err)]));
    }
  }

  /** Para os testes e o /api/health. */
  get state(): { day: string | null; bytes: number; limited: boolean; failing: boolean; slow: boolean } {
    return { day: this.day, bytes: this.bytes, limited: this.limited, failing: this.failedAt !== null, slow: this.bytes >= this.softBytes };
  }

  // ---------------------------------------------------------------- internos

  private pump(): void {
    if (!this.latest) return;
    const now = this.now();
    if (this.failedAt !== null && now - this.failedAt < this.retryMs) return;
    const day = dayKey(now);
    if (day !== this.day) this.openDay(day);
    if (this.limited) return;
    if (this.bytes >= this.hardBytes) return this.hitLimit(now);
    const slow = this.bytes >= this.softBytes;
    const every = slow ? this.slowKeyframeMs : this.keyframeMs;
    if (this.needKeyframe || !this.written || now - this.lastKeyAt >= every) {
      this.writeKeyframe(now, every);
      return;
    }
    if (this.pending && now - this.lastDeltaAt >= (slow ? this.slowThrottleMs : this.throttleMs)) this.writeDelta(now);
  }

  private openDay(day: string): void {
    this.day = day;
    this.file = join(this.dir, `${day}.jsonl`);
    this.written = null;
    this.needKeyframe = true;
    this.bytes = 0;
    try {
      this.bytes = statSync(this.file).size;
    } catch {
      // arquivo novo
    }
    // Servidor reiniciado depois do limite: continua parado até a virada (o 'end' já está no arquivo).
    this.limited = this.bytes >= this.hardBytes;
    this.prune(day);
  }

  private writeKeyframe(now: number, every: number): void {
    const latest = this.latest!;
    if (!this.append(keyframeOf(latest, now, every, !this.booted), now)) return;
    this.booted = true;
    this.written = latest;
    this.lastKeyAt = now;
    this.lastDeltaAt = now;
    this.pending = false;
    this.needKeyframe = false;
  }

  private writeDelta(now: number): void {
    const latest = this.latest!;
    this.pending = false;
    const changes = this.written ? diffFrames(this.written, latest) : null;
    if (!changes) return;
    if (!this.append({ t: 'd', at: now, ...changes }, now)) return;
    this.written = latest;
    this.lastDeltaAt = now;
  }

  private hitLimit(now: number): void {
    this.limited = true;
    this.append({ t: 'end', at: now, reason: 'limit' }, now);
    log.warn(tr('Linha do tempo de {0} chegou a {1} MB: a gravação para até a virada do dia.', [this.day, Math.round(this.bytes / 1024 / 1024)]));
  }

  private append(rec: TimelineRecord, now: number): boolean {
    const line = `${JSON.stringify(rec)}\n`;
    try {
      mkdirSync(this.dir, { recursive: true });
      appendFileSync(this.file, line);
    } catch (err) {
      this.failedAt = now;
      this.needKeyframe = true;
      log.warnOnce('timeline-write', tr('Não foi possível gravar a linha do tempo em {0} ({1}); tento de novo em {2} s.', [this.file, errMsg(err), Math.round(this.retryMs / 1000)]));
      return false;
    }
    this.bytes += Buffer.byteLength(line);
    if (this.failedAt !== null) {
      this.failedAt = null;
      log.clearOnce('timeline-write');
      log.info(tr('Linha do tempo: voltou a gravar.'));
    }
    return true;
  }

  /** Apaga os dias fora da retenção (só arquivos AAAA-MM-DD.jsonl; o resto da pasta não é tocado). */
  private prune(today: string): void {
    if (!(this.retentionDays > 0) || !Number.isFinite(this.retentionDays)) return;
    const oldest = shiftDay(today, -(this.retentionDays - 1));
    let names: string[];
    try {
      names = readdirSync(this.dir);
    } catch {
      return;
    }
    for (const name of names) {
      const day = FILE_RE.exec(name)?.[1];
      if (!day || !isDayKey(day) || day >= oldest) continue;
      try {
        unlinkSync(join(this.dir, name));
      } catch (err) {
        log.warnOnce(`timeline-prune:${name}`, tr('Não foi possível apagar {0} da linha do tempo ({1}).', [name, errMsg(err)]));
      }
    }
  }
}

// ------------------------------------------------------------------ dias disponíveis

export interface TimelineDayInfo {
  /** AAAA-MM-DD. */
  day: string;
  bytes: number;
  /** Horário do primeiro e do último registro (epoch ms). */
  from: number;
  to: number;
}

const HEAD_BYTES = 512;
const TAIL_BYTES = 64 * 1024;
const cache = new Map<string, { size: number; mtimeMs: number; info: TimelineDayInfo | null }>();

/** `at` do registro (é sempre o primeiro "at" da linha: ver shared/timeline.ts). */
function atOf(line: string): number | null {
  const m = /"at":(\d+)/.exec(line);
  return m ? Number(m[1]) : null;
}

function readSlice(file: string, start: number, length: number): string {
  const fd = openSync(file, 'r');
  try {
    const buf = Buffer.alloc(length);
    const n = readSync(fd, buf, 0, length, start);
    return buf.subarray(0, n).toString('utf8');
  } finally {
    closeSync(fd);
  }
}

/** Primeiro e último horário de um arquivo do dia, lendo só o começo e o fim. */
function summarize(file: string, day: string, size: number): TimelineDayInfo | null {
  if (size <= 0) return null;
  const from = atOf(readSlice(file, 0, Math.min(size, HEAD_BYTES)).split('\n')[0]);
  if (from === null) return null;
  const tailStart = Math.max(0, size - TAIL_BYTES);
  const lines = readSlice(file, tailStart, size - tailStart).split('\n');
  // A primeira linha do trecho final pode estar cortada; a última pode estar incompleta (gravando).
  if (tailStart > 0) lines.shift();
  let to = from;
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (!line.endsWith('}')) continue;
    const at = atOf(line);
    if (at !== null) {
      to = Math.max(from, at);
      break;
    }
  }
  return { day, bytes: size, from, to };
}

/** Dias gravados, do mais recente para o mais antigo. Nunca lança (pasta ausente = nenhum dia). */
export function listTimelineDays(dir: string): TimelineDayInfo[] {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  const out: TimelineDayInfo[] = [];
  for (const name of names) {
    const day = FILE_RE.exec(name)?.[1];
    if (!day || !isDayKey(day)) continue;
    const file = join(dir, name);
    try {
      const st = statSync(file);
      if (!st.isFile()) continue;
      const hit = cache.get(file);
      let info = hit && hit.size === st.size && hit.mtimeMs === st.mtimeMs ? hit.info : undefined;
      if (info === undefined) {
        info = summarize(file, day, st.size);
        cache.set(file, { size: st.size, mtimeMs: st.mtimeMs, info });
      }
      if (info) out.push(info);
    } catch {
      // arquivo sumiu ou ilegível: fica de fora
    }
  }
  return out.sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : 0));
}
