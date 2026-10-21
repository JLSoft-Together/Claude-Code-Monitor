// Versão nova: consulta a release mais recente do repositório no GitHub
// (GET https://api.github.com/repos/<dono>/<nome>/releases/latest, sem token) e compara com a versão em uso.
// Uma consulta a cada 6 h (1 h depois de uma falha) com ETag: a resposta 304 não gasta o limite de 60
// consultas por hora do GitHub. O resultado fica em <dataDir>/updates.json, para um reinício não repetir a consulta.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { UpdateStatus } from '../../shared/types';
import { errMsg, log } from '../log';
import { tr } from '../../shared/i18n';

export const CHECK_EVERY_MS = 6 * 3_600_000;
export const RETRY_MS = 3_600_000;
/** Primeira consulta depois de subir (não atrasa a inicialização). */
const FIRST_DELAY_MS = 5_000;
/** "Verificar agora" seguidos: no máximo uma consulta a cada 30 s. */
export const MANUAL_GAP_MS = 30_000;
const TIMEOUT_MS = 10_000;

interface Version {
  nums: [number, number, number];
  pre?: string;
}

/** "1.2.3", "v1.2.3" ou "1.2.3-beta.1" (sem metadados de build). */
export function parseVersion(v: string): Version | null {
  const m = /^v?(\d{1,6})\.(\d{1,6})\.(\d{1,6})(?:-([0-9A-Za-z.-]{1,40}))?$/.exec(v.trim());
  if (!m) return null;
  return { nums: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] };
}

/** <0, 0 ou >0, como no semver; versões ilegíveis contam como iguais. */
export function compareVersions(a: string, b: string): number {
  const x = parseVersion(a);
  const y = parseVersion(b);
  if (!x || !y) return 0;
  for (let i = 0; i < 3; i++) if (x.nums[i] !== y.nums[i]) return x.nums[i] - y.nums[i];
  // Sem pré-lançamento vale mais que com (1.0.0 > 1.0.0-beta).
  if (!x.pre || !y.pre) return (x.pre ? -1 : 0) - (y.pre ? -1 : 0);
  return x.pre < y.pre ? -1 : x.pre > y.pre ? 1 : 0;
}

/**
 * "dono/nome" a partir do campo `repository` do package.json: "dono/nome", "github:dono/nome",
 * "https://github.com/dono/nome(.git)", "git+https://...", "git@github.com:dono/nome.git" ou {url}.
 */
export function parseGithubRepo(repository: unknown): string | undefined {
  const raw = typeof repository === 'string' ? repository : (repository as { url?: unknown } | null)?.url;
  if (typeof raw !== 'string') return undefined;
  const s = raw.trim();
  const m =
    /^(?:github:)?([A-Za-z0-9-]{1,39})\/([A-Za-z0-9._-]{1,100})$/.exec(s) ??
    /^(?:git\+)?(?:https?|ssh|git):\/\/(?:git@)?github\.com\/([A-Za-z0-9-]{1,39})\/([A-Za-z0-9._-]{1,100}?)(?:\.git)?\/?$/.exec(s) ??
    /^git@github\.com:([A-Za-z0-9-]{1,39})\/([A-Za-z0-9._-]{1,100}?)(?:\.git)?$/.exec(s);
  if (!m) return undefined;
  const name = m[2].replace(/\.git$/, '');
  return name && name !== '.' && name !== '..' ? `${m[1]}/${name}` : undefined;
}

interface Cached {
  repo: string;
  checkedAt: number;
  etag?: string;
  latest?: string;
  url?: string;
  publishedAt?: number;
}

export interface UpdateCheckerOptions {
  /** Versão em uso (package.json). */
  current: string;
  /** "dono/nome"; ausente = verificação desligada. */
  repo?: string;
  /** HABBLAUD_UPDATE_CHECK=0 desliga. */
  enabled: boolean;
  /** Onde guardar o último resultado; null = só em memória (testes). */
  file: string | null;
  fetch?: typeof fetch;
  now?: () => number;
  /** O status mudou (o servidor republica o snapshot). */
  onChange?: () => void;
}

export class UpdateChecker {
  private cache: Cached | null = null;
  private error: string | undefined;
  private lastAttempt = -Infinity;
  private inflight: Promise<UpdateStatus> | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private announced: string | undefined;
  private readonly fetchFn: typeof fetch;
  private readonly now: () => number;

  constructor(private readonly opts: UpdateCheckerOptions) {
    this.fetchFn = opts.fetch ?? fetch;
    this.now = opts.now ?? Date.now;
  }

  get enabled(): boolean {
    return this.opts.enabled && !!this.opts.repo;
  }

  status(): UpdateStatus {
    if (!this.enabled) return { state: 'off', repo: this.opts.repo, available: false };
    const c = this.cache;
    return {
      state: this.error ? 'error' : c ? 'ok' : 'pending',
      repo: this.opts.repo,
      checkedAt: c?.checkedAt,
      latest: c?.latest,
      url: c?.url,
      publishedAt: c?.publishedAt,
      available: !!c?.latest && compareVersions(c.latest, this.opts.current) > 0,
      error: this.error,
    };
  }

  /** Lê o último resultado guardado (ignorado se for de outro repositório). */
  load(): void {
    const repo = this.opts.repo;
    if (!this.opts.file || !this.enabled || !repo) return;
    try {
      const j = JSON.parse(readFileSync(this.opts.file, 'utf8')) as Partial<Cached>;
      if (j.repo !== repo || typeof j.checkedAt !== 'number' || !Number.isFinite(j.checkedAt)) return;
      const latest = typeof j.latest === 'string' && parseVersion(j.latest) ? j.latest : undefined;
      this.cache = {
        repo,
        checkedAt: j.checkedAt,
        etag: typeof j.etag === 'string' ? j.etag.slice(0, 200) : undefined,
        latest,
        url: latest ? safeReleaseUrl(j.url, repo) : undefined,
        publishedAt: latest && typeof j.publishedAt === 'number' ? j.publishedAt : undefined,
      };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') log.warn(tr('updates.json ilegível ({0}); verificando de novo.', [errMsg(err)]));
    }
  }

  /** Agenda a primeira consulta: logo depois de subir ou quando o resultado guardado vencer. */
  start(): void {
    if (!this.enabled) return;
    const due = this.cache ? this.cache.checkedAt + CHECK_EVERY_MS - this.now() : 0;
    this.schedule(Math.max(FIRST_DELAY_MS, due));
    this.announce();
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /**
   * Consulta o GitHub agora. `manual` ("Verificar agora"): se a última tentativa foi há menos de 30 s,
   * devolve o status atual sem consultar.
   */
  check(opts: { manual?: boolean } = {}): Promise<UpdateStatus> {
    if (!this.enabled) return Promise.resolve(this.status());
    if (this.inflight) return this.inflight;
    if (opts.manual && this.now() - this.lastAttempt < MANUAL_GAP_MS) return Promise.resolve(this.status());
    this.inflight = this.run().finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  private async run(): Promise<UpdateStatus> {
    const before = JSON.stringify(this.status());
    this.lastAttempt = this.now();
    try {
      await this.fetchLatest();
      this.error = undefined;
      log.clearOnce('updates');
    } catch (err) {
      this.error = describeError(err);
      log.warnOnce('updates', tr('Verificação de versão nova falhou: {0}.', [this.error]));
    }
    this.schedule(this.error ? RETRY_MS : CHECK_EVERY_MS);
    this.announce();
    const after = this.status();
    if (JSON.stringify(after) !== before) this.opts.onChange?.();
    return after;
  }

  private async fetchLatest(): Promise<void> {
    const repo = this.opts.repo!;
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'User-Agent': `habblaud/${this.opts.current}`,
      'X-GitHub-Api-Version': '2022-11-28',
    };
    if (this.cache?.etag) headers['If-None-Match'] = this.cache.etag;
    const res = await this.fetchFn(`https://api.github.com/repos/${repo}/releases/latest`, {
      headers,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const now = this.now();
    if (res.status === 304 && this.cache) {
      this.cache = { ...this.cache, checkedAt: now };
    } else if (res.status === 404) {
      // Nenhuma release publicada (ou repositório que não existe mais).
      this.cache = { repo, checkedAt: now };
    } else if (res.ok) {
      const body = ((await res.json()) ?? {}) as { tag_name?: unknown; html_url?: unknown; published_at?: unknown };
      const tag = typeof body.tag_name === 'string' ? body.tag_name : '';
      const v = parseVersion(tag);
      if (!v) log.warnOnce(`updates:tag:${tag.slice(0, 40)}`, tr('A release mais recente de {0} tem uma tag fora do padrão de versão ({1}): ignorada.', [repo, tag.slice(0, 40)]));
      const latest = v ? `${v.nums.join('.')}${v.pre ? `-${v.pre}` : ''}` : undefined;
      const published = typeof body.published_at === 'string' ? Date.parse(body.published_at) : NaN;
      this.cache = {
        repo,
        checkedAt: now,
        etag: res.headers.get('etag')?.slice(0, 200) || undefined,
        latest,
        url: latest ? safeReleaseUrl(body.html_url, repo) : undefined,
        publishedAt: latest && Number.isFinite(published) ? published : undefined,
      };
    } else if (res.status === 403 || res.status === 429) {
      throw new Error(tr('limite de consultas do GitHub atingido; tento de novo mais tarde'));
    } else {
      throw new Error(tr('o GitHub respondeu {0}', [res.status]));
    }
    this.save();
  }

  private save(): void {
    const file = this.opts.file;
    if (!file || !this.cache) return;
    try {
      mkdirSync(dirname(file), { recursive: true });
      const tmp = `${file}.tmp`;
      writeFileSync(tmp, `${JSON.stringify(this.cache, null, 2)}\n`);
      renameSync(tmp, file);
    } catch (err) {
      log.warnOnce('updates:save', tr('Não deu para gravar {0}: {1}.', [file, errMsg(err)]));
    }
  }

  private schedule(ms: number): void {
    this.stop();
    this.timer = setTimeout(() => void this.check(), Math.min(ms, 2 ** 31 - 1));
    this.timer.unref?.();
  }

  /** Avisa no log uma vez por versão nova encontrada. */
  private announce(): void {
    const s = this.status();
    if (!s.available || s.latest === this.announced) return;
    this.announced = s.latest;
    log.info(tr('⬆️  Nova versão do Habblaud: v{0} (em uso: v{1}). Novidades: {2}', [s.latest, this.opts.current, s.url]));
  }
}

/** Só links de página do próprio GitHub (a interface põe o endereço num link). */
function safeReleaseUrl(url: unknown, repo: string): string {
  if (typeof url === 'string' && url.length <= 300 && url.toLowerCase().startsWith(`https://github.com/${repo.toLowerCase()}/`)) return url;
  return `https://github.com/${repo}/releases/latest`;
}

function describeError(err: unknown): string {
  const name = (err as { name?: unknown })?.name;
  if (name === 'TimeoutError' || name === 'AbortError') return tr('o GitHub não respondeu a tempo');
  if (err instanceof TypeError) return tr('sem conexão com o GitHub');
  return errMsg(err);
}
