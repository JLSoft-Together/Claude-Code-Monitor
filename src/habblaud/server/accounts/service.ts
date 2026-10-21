// Contas observadas + uso de cada uma: tap de statusline (recomendado) e cache do /usage
// gravado no .claude.json. Só arquivos locais: nada de credenciais nem chamadas de rede.
//
// As contas do Claude Code saem dos config dirs (detectAccounts). As de outras ferramentas (Codex) chegam de fora,
// descobertas pela fonte delas (setProviderAccounts), com ids únicos entre todas as contas; o uso delas também é
// empurrado pela fonte (setUsage), ao lado do statusline e do cache do /usage do Claude Code.
import { basename, resolve } from 'node:path';
import type { AccountInfo, AccountUsage, Provider } from '../../shared/types';
import { log } from '../log';
import { detectAccounts, type DetectedAccount } from './detect';
import { StatuslineUsageReader, type StatuslineUsage } from './statusline';
import { usageFromCache, UsageStore, type UsageSource, type UsageView } from './usage';
import { tr } from '../../shared/i18n';

export interface AccountEntry {
  id: string;
  /** Ferramenta da conta. */
  provider: Provider;
  /** Config dir lido por este processo (no Docker, o caminho montado). */
  dir: string;
  detected: DetectedAccount;
}

/** Conta de outra ferramenta (ex.: um CODEX_HOME), descoberta pela fonte dela. */
export interface ProviderAccountInput {
  /** Pasta lida por este processo (no Docker, o caminho montado). */
  dir: string;
  /**
   * Metadados para exibição. `id` é o desejado (ex.: ".codex"): se outra conta já usa esse id, ganha "~2", "~3"...
   * (o id final volta em setProviderAccounts). `provider` é preenchido pelo serviço.
   */
  detected: DetectedAccount;
}

export interface AccountsServiceOptions {
  dirs: string[];
  home: string;
  env: NodeJS.ProcessEnv;
  onChange: () => void;
  now?: () => number;
  /** Intervalo de releitura do .claude.json (cache de uso). */
  refreshMs?: number;
  /** Pasta com o uso capturado do statusline (scripts/statusline-tap.mjs). Sem ela, a fonte fica desligada. */
  usageDir?: string;
  /** Intervalo de releitura da pasta do statusline (padrão 5 s). */
  statuslineMs?: number;
}

export class AccountsService {
  readonly usage = new UsageStore();
  /** Contas do Claude Code (config dirs). */
  private list_: AccountEntry[] = [];
  /** Contas das outras ferramentas, por ferramenta (setProviderAccounts). */
  private external = new Map<Provider, AccountEntry[]>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private statuslineTimer: ReturnType<typeof setInterval> | null = null;
  private readonly statusline: StatuslineUsageReader | null;
  /** Assinatura do uso exibido (o status muda sozinho com o tempo: ok -> stale, janelas reiniciam). */
  private usageSig = '';
  private readonly now: () => number;

  constructor(private readonly opts: AccountsServiceOptions) {
    this.now = opts.now ?? Date.now;
    this.statusline = opts.usageDir ? new StatuslineUsageReader(opts.usageDir) : null;
    this.refresh();
    this.refreshStatusline();
  }

  /** Relê metadados e o cache de uso (barato: dois ou três JSONs pequenos). */
  refresh(): void {
    let detected: DetectedAccount[];
    try {
      detected = detectAccounts(this.opts.dirs, { home: this.opts.home, env: this.opts.env });
    } catch (err) {
      log.warnOnce('detect-accounts', tr('Falha ao detectar contas: {0}', [String(err).slice(0, 120)]));
      return;
    }
    const next = this.opts.dirs.map((dir, i): AccountEntry => ({ id: detected[i].id, provider: 'claude', dir, detected: detected[i] }));
    let changed = JSON.stringify(next.map((e) => ({ ...e.detected, cachedUsage: undefined }))) !==
      JSON.stringify(this.list_.map((e) => ({ ...e.detected, cachedUsage: undefined })));
    this.list_ = next;
    for (const e of next) {
      const cache = usageFromCache(e.detected.cachedUsage);
      if (cache) changed = this.usage.set(e.id, cache) || changed;
      else changed = this.usage.clear(e.id, 'cache') || changed;
    }
    if (this.usageViewChanged()) changed = true;
    if (changed) this.opts.onChange();
  }

  /**
   * Relê os arquivos do tap de statusline e aplica a cada conta o mais recente que casar
   * (pelo config dir; senão pelo id/basename). Conta sem arquivo perde a fonte 'statusline'.
   */
  refreshStatusline(): void {
    if (!this.statusline) return;
    let files: StatuslineUsage[];
    try {
      files = this.statusline.read(this.now());
    } catch (err) {
      log.warnOnce('statusline-read', tr('Falha ao ler o uso do statusline: {0}', [String(err).slice(0, 120)]));
      return;
    }
    let changed = false;
    for (const e of this.list_) {
      const mine = files.filter((f) => this.fileMatches(e, f));
      const best = mine.reduce<StatuslineUsage | undefined>((acc, f) => (!acc || f.usage.fetchedAt > acc.usage.fetchedAt ? f : acc), undefined);
      if (best) changed = this.usage.set(e.id, best.usage) || changed;
      else changed = this.usage.clear(e.id, 'statusline') || changed;
    }
    if (this.usageViewChanged()) changed = true;
    if (changed) this.opts.onChange();
  }

  private fileMatches(e: AccountEntry, f: StatuslineUsage): boolean {
    if (f.configDir) {
      const dir = resolve(f.configDir);
      if (dir === resolve(e.detected.configDir) || dir === resolve(e.dir)) return true;
      // Mesmo nome de pasta mas caminho diferente: só vale se nenhuma outra conta tiver esse caminho.
      if (this.list_.some((o) => resolve(o.detected.configDir) === dir || resolve(o.dir) === dir)) return false;
      return basename(dir) === e.id;
    }
    return !!f.accountId && f.accountId === e.id;
  }

  /**
   * Substitui as contas de uma ferramenta que não é o Claude Code (a fonte dela chama a cada descoberta). Ids
   * únicos entre todas as contas: um id já usado (por uma conta do Claude Code, de outra ferramenta ou repetido
   * na lista) ganha "~2", "~3"... na ordem da lista. Devolve as entradas com os ids finais, na mesma ordem: são
   * eles que vão em AgentInfo.account. Conta que saiu perde o uso guardado.
   */
  setProviderAccounts(provider: Exclude<Provider, 'claude'>, list: readonly ProviderAccountInput[]): readonly AccountEntry[] {
    const taken = new Set(this.list_.map((e) => e.id));
    for (const [p, entries] of this.external) if (p !== provider) for (const e of entries) taken.add(e.id);
    const next = list.map((input): AccountEntry => {
      const base = input.detected.id || basename(input.dir) || input.dir;
      let id = base;
      for (let n = 2; taken.has(id); n++) id = `${base}~${n}`;
      taken.add(id);
      return { id, provider, dir: input.dir, detected: { ...input.detected, id, provider } };
    });
    const prev = this.external.get(provider) ?? [];
    let changed = JSON.stringify(prev) !== JSON.stringify(next);
    for (const e of prev) if (!next.some((n) => n.id === e.id)) changed = this.usage.forget(e.id) || changed;
    if (next.length) this.external.set(provider, next);
    else this.external.delete(provider);
    if (this.usageViewChanged()) changed = true;
    if (changed) this.opts.onChange();
    return next;
  }

  /**
   * Uso empurrado por uma fonte (ex.: a do Codex, lido dos arquivos de sessão): guardado pela origem
   * (`usage.source`), ao lado das outras; vale a mais recente (maior fetchedAt). Devolve true se algo mudou.
   */
  setUsage(accountId: string, usage: AccountUsage): boolean {
    const changed = this.usage.set(accountId, usage);
    const viewChanged = this.usageViewChanged();
    if (changed || viewChanged) this.opts.onChange();
    return changed;
  }

  /** Esquece o uso de uma origem da conta (ex.: a fonte não tem mais números). Devolve true se algo mudou. */
  clearUsage(accountId: string, source: UsageSource): boolean {
    const changed = this.usage.clear(accountId, source);
    const viewChanged = this.usageViewChanged();
    if (changed || viewChanged) this.opts.onChange();
    return changed;
  }

  /** O uso exibido mudou (inclusive sozinho, com o tempo: ok -> stale, janelas reiniciam)? */
  private usageViewChanged(): boolean {
    const now = this.now();
    const sig = JSON.stringify(this.allEntries().map((e) => this.usage.view(e.id, now)));
    if (sig === this.usageSig) return false;
    this.usageSig = sig;
    return true;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.refresh(), this.opts.refreshMs ?? 60_000);
    this.timer.unref?.();
    if (this.statusline) {
      this.statuslineTimer = setInterval(() => this.refreshStatusline(), this.opts.statuslineMs ?? 5_000);
      this.statuslineTimer.unref?.();
    }
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.statuslineTimer) clearInterval(this.statuslineTimer);
    this.timer = null;
    this.statuslineTimer = null;
  }

  /** Contas do Claude Code (o watcher, o histórico e o statusline são só delas). */
  entries(): readonly AccountEntry[] {
    return this.list_;
  }

  /** Contas de uma ferramenta. */
  entriesOf(provider: Provider): readonly AccountEntry[] {
    return provider === 'claude' ? this.list_ : (this.external.get(provider) ?? []);
  }

  /** Contas de todas as ferramentas: as do Claude Code primeiro. */
  allEntries(): readonly AccountEntry[] {
    if (!this.external.size) return this.list_;
    return [...this.list_, ...[...this.external.values()].flat()];
  }

  idForDir(dir: string): string | undefined {
    const abs = resolve(dir);
    return this.allEntries().find((e) => resolve(e.dir) === abs)?.id;
  }

  find(id: string): AccountEntry | undefined {
    return this.allEntries().find((e) => e.id === id);
  }

  usageView(id: string): UsageView {
    return this.usage.view(id, this.now());
  }

  /** Contas (de todas as ferramentas) no formato do protocolo; `sessions` = sessões abertas por conta. */
  list(sessions: ReadonlyMap<string, number>): AccountInfo[] {
    const now = this.now();
    return this.allEntries().map((e) => {
      const d = e.detected;
      const view = this.usage.view(e.id, now);
      const info: AccountInfo = {
        id: e.id,
        short: d.short,
        name: d.name,
        color: d.color,
        configDir: d.configDir,
        sessions: sessions.get(e.id) ?? 0,
        usageStatus: view.status,
      };
      // Ausente = 'claude' (o snapshot das contas do Claude Code não muda).
      if (e.provider !== 'claude') info.provider = e.provider;
      if (d.email) info.email = d.email;
      if (d.organization) info.organization = d.organization;
      if (d.plan) info.plan = d.plan;
      if (view.usage) info.usage = view.usage;
      return info;
    });
  }
}
