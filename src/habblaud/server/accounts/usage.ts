// Uso do plano (sessão de 5h e semanal) por conta, vindo de fontes locais:
// - 'statusline': rate_limits que o Claude Code envia ao statusline, gravados pelo
//   scripts/statusline-tap.mjs (recomendado: ao vivo);
// - 'cache': cachedUsageUtilization gravado pelo próprio Claude Code (quando alguém roda /usage);
// - 'codex': rate_limits dos arquivos de sessão do Codex, empurrados pela fonte do Codex (AccountsService.setUsage).
// Vale sempre a fonte com os números mais recentes (maior fetchedAt). Nenhuma delas lê credenciais
// nem faz chamadas de rede: são só arquivos que o Claude Code já grava na máquina.
import type { AccountInfo, AccountUsage, UsageWindow } from '../../shared/types';

export type UsageSource = AccountUsage['source'];
export type UsageStatus = AccountInfo['usageStatus'];

/** Números com mais de 30 min são exibidos como "desatualizados". */
export const STALE_AFTER_MS = 30 * 60_000;
const WINDOW_KEYS = ['fiveHour', 'sevenDay', 'sevenDayOpus', 'sevenDaySonnet'] as const;

function num(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() && Number.isFinite(Number(v))) return Number(v);
  return undefined;
}

/** Converte data ISO, epoch em ms ou epoch em segundos para epoch ms. */
export function toEpochMs(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v < 1e12 ? Math.round(v * 1000) : Math.round(v);
  if (typeof v === 'string' && v.trim()) {
    const t = Date.parse(v);
    return Number.isNaN(t) ? undefined : t;
  }
  return undefined;
}

/** Uma janela no formato do Claude Code ({utilization, resets_at}) -> UsageWindow. */
function parseWindow(raw: unknown): UsageWindow | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  const u = num(r.utilization);
  if (u === undefined) return undefined;
  const w: UsageWindow = { utilization: Math.min(100, Math.max(0, u)) };
  const resets = toEpochMs(r.resets_at ?? r.resetsAt);
  if (resets !== undefined) w.resetsAt = resets;
  return w;
}

/**
 * Normaliza as janelas de uso no formato que o Claude Code grava (cache do /usage) e envia ao
 * statusline: {five_hour, seven_day, seven_day_opus, seven_day_sonnet, ...}. Sem nenhuma janela -> undefined.
 */
export function usageFromWindows(raw: unknown, source: UsageSource, fetchedAt: number): AccountUsage | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  const usage: AccountUsage = { source, fetchedAt };
  const five = parseWindow(r.five_hour);
  const week = parseWindow(r.seven_day);
  const opus = parseWindow(r.seven_day_opus);
  const sonnet = parseWindow(r.seven_day_sonnet);
  if (five) usage.fiveHour = five;
  if (week) usage.sevenDay = week;
  if (opus) usage.sevenDayOpus = opus;
  if (sonnet) usage.sevenDaySonnet = sonnet;
  return five || week || opus || sonnet ? usage : undefined;
}

/** `cachedUsageUtilization` do .claude.json ({fetchedAtMs, utilization:{...}}) -> AccountUsage. */
export function usageFromCache(cached: unknown): AccountUsage | undefined {
  if (!cached || typeof cached !== 'object') return undefined;
  const c = cached as Record<string, unknown>;
  const fetchedAt = toEpochMs(c.fetchedAtMs ?? c.fetchedAt);
  if (fetchedAt === undefined) return undefined;
  return usageFromWindows(c.utilization, 'cache', fetchedAt);
}

/**
 * Janelas cujo reinício já passou desde a coleta ficam SEM DADOS (são omitidas): o percentual
 * antigo não vale mais e não dá para saber quanto já foi usado na janela nova — exibir 0% faria
 * a cota parecer cheia. Voltam a aparecer quando a fonte trouxer números novos.
 */
export function rollover(usage: AccountUsage, now: number): AccountUsage {
  const out: AccountUsage = { ...usage };
  for (const key of WINDOW_KEYS) {
    const w = usage[key];
    if (w?.resetsAt !== undefined && w.resetsAt <= now) delete out[key];
  }
  return out;
}

export interface UsageView {
  usage?: AccountUsage;
  status: UsageStatus;
}

/** Guarda os números de cada fonte por conta e decide o que exibir. */
export class UsageStore {
  private entries = new Map<string, Map<UsageSource, AccountUsage>>();

  /** Registra números de uma fonte. Devolve true se algo mudou. */
  set(accountId: string, usage: AccountUsage): boolean {
    let m = this.entries.get(accountId);
    if (!m) this.entries.set(accountId, (m = new Map()));
    const prev = m.get(usage.source);
    m.set(usage.source, usage);
    return JSON.stringify(prev) !== JSON.stringify(usage);
  }

  clear(accountId: string, source: UsageSource): boolean {
    return this.entries.get(accountId)?.delete(source) ?? false;
  }

  /** Esquece todas as origens da conta (ela saiu). Devolve true se havia algo. */
  forget(accountId: string): boolean {
    const had = !!this.entries.get(accountId)?.size;
    this.entries.delete(accountId);
    return had;
  }

  view(accountId: string, now: number): UsageView {
    const all = [...(this.entries.get(accountId)?.values() ?? [])];
    const best = all.reduce<AccountUsage | undefined>((acc, u) => (!acc || u.fetchedAt > acc.fetchedAt ? u : acc), undefined);
    if (!best) return { status: 'disabled' };
    return { usage: rollover(best, now), status: now - best.fetchedAt > STALE_AFTER_MS ? 'stale' : 'ok' };
  }
}
