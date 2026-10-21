// "Onde foi meu dia": amostra o escritório a cada segundo, acumula as estatísticas (shared/daystats.ts) e as
// persiste em ${dataDir}/stats/AAAA-MM-DD.json (um arquivo por dia no fuso do servidor), a cada 30 s e ao
// encerrar. No boot recarrega os arquivos recentes (o dia sobrevive a reinícios), apaga os de mais de 30 dias e
// monta um índice das horas com dados. Erros de disco só viram aviso no log: o servidor nunca cai por isso.
//
// Agentes do demo (prefixo "demo:") nunca entram nos dados reais: com o demo ligado eles alimentam um balde
// separado, só em memória, semeado com um histórico fictício (shared/demo/daystats.ts) para o painel e os prints.
import { mkdirSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AgentInfo, OfficeSnapshot } from '../../shared/types';
import {
  addDays,
  dayKeyOf,
  daysFromHours,
  DayData,
  fileDaysForQuery,
  parseDayFile,
  queryDay,
  RETENTION_DAYS,
  StatsBook,
  StatsTracker,
  systemTimeZone,
  type DayStatsResponse,
  type StatsDaysResponse,
  type StatsSource,
  type StatsView,
} from '../../shared/daystats';
import { seedDemoHistory } from '../../shared/demo/daystats';
import { errMsg, log } from '../log';
import { tr } from '../../shared/i18n';

/** Prefixo dos ids dos agentes do modo demonstração no servidor (ver Office.setDemo). */
export const DEMO_ID_PREFIX = 'demo:';
const FILE_RE = /^(\d{4}-\d{2}-\d{2})\.json$/;

export interface DayStatsDeps {
  /** Pasta dos arquivos (`${dataDir}/stats`); null = só em memória (testes). */
  dir: string | null;
  /** Estado atual do escritório (agentes reais e do demo, salas e contas). */
  snapshot: () => Pick<OfficeSnapshot, 'agents' | 'rooms' | 'accounts' | 'meta'>;
  now?: () => number;
  /** Fuso dos arquivos e da virada do dia (padrão: o do processo; no Docker, UTC). */
  tz?: string;
  sampleMs?: number;
  flushMs?: number;
}

export class DayStatsService {
  readonly tz: string;
  private readonly now: () => number;
  private readonly startedAt: number;
  private readonly book: StatsBook;
  private readonly tracker: StatsTracker;
  private demo: { book: StatsBook; tracker: StatsTracker } | null = null;
  /** Horas com dados de cada arquivo em disco (para listar os dias sem abrir todos). */
  private readonly index = new Map<string, number[]>();
  private sampleTimer: ReturnType<typeof setInterval> | null = null;
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private retentionDay = '';

  constructor(private readonly deps: DayStatsDeps) {
    this.now = deps.now ?? Date.now;
    this.tz = deps.tz ?? systemTimeZone();
    this.startedAt = this.now();
    this.book = new StatsBook(
      (t) => dayKeyOf(t, this.tz),
      (key) => this.readDay(key),
    );
    this.tracker = new StatsTracker(this.book, { startedAt: this.startedAt });
  }

  /** Boot: apaga o que passou da retenção, indexa os arquivos e carrega ontem e hoje na memória. */
  load(): void {
    const today = this.today();
    this.cleanup(today);
    if (this.deps.dir) {
      for (const name of this.listFiles()) {
        const key = FILE_RE.exec(name)![1];
        const d = this.readDay(key);
        if (d) this.index.set(key, d.hoursWithData());
      }
    }
    this.book.day(addDays(today, -1));
    this.book.day(today);
  }

  start(): void {
    this.sampleTimer = setInterval(() => this.safely('sample', () => this.sample()), this.deps.sampleMs ?? 1_000);
    this.flushTimer = setInterval(() => this.safely('flush', () => this.flush()), this.deps.flushMs ?? 30_000);
    this.sampleTimer.unref?.();
    this.flushTimer.unref?.();
  }

  /** Para os relógios, faz a última amostra e grava (chame antes de desligar o hub). */
  stop(): void {
    if (this.sampleTimer) clearInterval(this.sampleTimer);
    if (this.flushTimer) clearInterval(this.flushTimer);
    this.sampleTimer = null;
    this.flushTimer = null;
    this.safely('sample', () => this.sample());
    this.flush();
  }

  /** Uma amostra do escritório (o relógio chama a cada segundo). */
  sample(now = this.now()): void {
    const snap = this.deps.snapshot();
    const realAgents: AgentInfo[] = [];
    const demoAgents: AgentInfo[] = [];
    // Demo = id e conta com o prefixo do simulador (uma pasta de conta chamada "demo" não vira demo).
    for (const a of snap.agents) (a.id.startsWith(DEMO_ID_PREFIX) && a.account.startsWith(DEMO_ID_PREFIX) ? demoAgents : realAgents).push(a);
    const real: StatsView = { agents: realAgents, rooms: snap.rooms, accounts: snap.accounts };
    const demo: StatsView = { agents: demoAgents, rooms: snap.rooms, accounts: snap.accounts };
    this.tracker.observe(real, now);
    if (snap.meta.demo) {
      if (!this.demo) {
        const book = new StatsBook((t) => dayKeyOf(t, this.tz));
        seedDemoHistory(book, { ...demo, accounts: snap.accounts.filter((a) => a.id.startsWith(DEMO_ID_PREFIX)) }, now, this.tz);
        this.demo = { book, tracker: new StatsTracker(book, { startedAt: now }) };
      }
      this.demo.tracker.observe(demo, now);
    } else {
      this.demo = null;
    }
  }

  /** Grava os dias que mudaram, aplica a retenção na virada do dia e libera da memória os dias antigos. */
  flush(): void {
    const today = this.today();
    if (today !== this.retentionDay) this.cleanup(today);
    for (const d of this.book.list()) {
      if (!d.dirty) continue;
      if (this.writeDay(d)) {
        d.dirty = false;
        this.index.set(d.key, d.hoursWithData());
      }
    }
    // Sem disco, nada é tirado da memória (o que ficou sujo continua lá até gravar).
    this.book.evictBefore(addDays(today, -1));
    this.demo?.book.evictBefore(addDays(today, -1));
  }

  isDemo(): boolean {
    return this.demo !== null;
  }

  /** Hoje no fuso `tz`. */
  today(tz = this.tz): string {
    return dayKeyOf(this.now(), tz);
  }

  /** Dias com dados (no fuso `tz`), do mais recente ao mais antigo, dentro da retenção. */
  days(tz: string): StatsDaysResponse {
    const today = this.today(tz);
    const oldest = addDays(today, -RETENTION_DAYS);
    const real = new Set<string>();
    for (const [key, hours] of this.index) if (!this.book.peek(key)) for (const d of daysFromHours(hours, tz)) real.add(d);
    for (const d of this.book.list()) for (const k of daysFromHours(d.hoursWithData(), tz)) real.add(k);
    real.add(today);
    const list = (set: Set<string>) => [...set].filter((d) => d >= oldest && d <= today).sort().reverse();
    const out: StatsDaysResponse = { tz, today, days: list(real), demoAvailable: this.demo !== null };
    if (this.demo) {
      const demoDays = new Set([today]);
      for (const d of this.demo.book.list()) for (const k of daysFromHours(d.hoursWithData(), tz)) demoDays.add(k);
      out.demoDays = list(demoDays);
    }
    return out;
  }

  /**
   * Estatísticas do dia `day` (fuso `tz`). `source` ausente: o demo quando ele está ligado e o dia é hoje,
   * senão os dados reais. null = não há dados desse dia (ou o demo pedido está desligado).
   */
  day(day: string, tz: string, source?: StatsSource): DayStatsResponse | null {
    const now = this.now();
    const today = this.today(tz);
    const src: StatsSource = source ?? (this.demo && day === today ? 'demo' : 'real');
    if (src === 'demo' && !this.demo) return null;
    const known = src === 'demo' ? this.days(tz).demoDays ?? [] : this.days(tz).days;
    if (day !== today && !known.includes(day)) return null;
    const book = src === 'demo' ? this.demo!.book : this.book;
    const datas: DayData[] = [];
    for (const key of fileDaysForQuery(day, tz, this.tz)) {
      const d = book.peek(key) ?? (src === 'real' && this.index.has(key) ? this.readDay(key) : null);
      if (d) datas.push(d);
    }
    return { source: src, demoAvailable: this.demo !== null, today, serverTime: now, stats: queryDay(datas, day, tz, now) };
  }

  // ---------------------------------------------------------------- disco

  private file(key: string): string | null {
    return this.deps.dir ? join(this.deps.dir, `${key}.json`) : null;
  }

  private listFiles(): string[] {
    if (!this.deps.dir) return [];
    try {
      return readdirSync(this.deps.dir).filter((n) => FILE_RE.test(n));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') log.warnOnce('stats-dir', tr('Não foi possível ler {0} ({1}).', [this.deps.dir, errMsg(err)]));
      return [];
    }
  }

  /** Lê um dia do disco; arquivo ilegível é posto de lado (`.corrupt`) e o dia recomeça vazio. */
  private readDay(key: string): DayData | null {
    const file = this.file(key);
    if (!file) return null;
    let raw: string;
    try {
      raw = readFileSync(file, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') log.warnOnce(`stats-read:${key}`, tr('Não foi possível ler {0} ({1}).', [file, errMsg(err)]));
      return null;
    }
    let data: DayData | null = null;
    try {
      data = parseDayFile(JSON.parse(raw), key);
    } catch {
      data = null;
    }
    if (data) return data;
    log.warnOnce(`stats-corrupt:${key}`, tr('{0} está ilegível; guardado como .corrupt e o dia recomeça do zero.', [file]));
    try {
      renameSync(file, `${file}.corrupt`);
    } catch {
      // sem permissão: será sobrescrito na próxima gravação
    }
    this.index.delete(key);
    return null;
  }

  private writeDay(d: DayData): boolean {
    const file = this.file(d.key);
    if (!file) return false;
    try {
      mkdirSync(this.deps.dir!, { recursive: true });
      const tmp = `${file}.${process.pid}.tmp`;
      writeFileSync(tmp, JSON.stringify(d.toFile()));
      renameSync(tmp, file);
      log.clearOnce('stats-write');
      return true;
    } catch (err) {
      log.warnOnce('stats-write', tr('Não foi possível gravar {0} ({1}); as estatísticas seguem só na memória.', [file, errMsg(err)]));
      return false;
    }
  }

  /** Apaga os arquivos de mais de RETENTION_DAYS dias. */
  private cleanup(today: string): void {
    this.retentionDay = today;
    const oldest = addDays(today, -RETENTION_DAYS);
    for (const key of [...this.index.keys()]) if (key < oldest) this.index.delete(key);
    for (const name of this.listFiles()) {
      const key = FILE_RE.exec(name)![1];
      if (key >= oldest) continue;
      try {
        unlinkSync(join(this.deps.dir!, name));
      } catch (err) {
        log.warnOnce(`stats-rm:${key}`, tr('Não foi possível apagar {0} ({1}).', [name, errMsg(err)]));
      }
    }
  }

  private safely(what: string, fn: () => void): void {
    try {
      fn();
      log.clearOnce(`stats-${what}-fail`);
    } catch (err) {
      log.warnOnce(`stats-${what}-fail`, tr('Falha nas estatísticas do dia ({0}): {1}', [what, errMsg(err)]));
    }
  }
}

