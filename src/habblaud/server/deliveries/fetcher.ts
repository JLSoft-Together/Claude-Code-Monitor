// Lê os arquivos das entregas para o escritório. No modo Node o próprio servidor lê; no Docker, o que está numa pasta
// montada (as pastas das contas, ex.: capturas em projects/) é lido aqui, e o resto o auxiliar do host busca:
// POST /api/host/files/poll entrega os caminhos pedidos e /api/host/files/ack devolve o conteúdo (base64). Toda leitura
// passa por checkFile (deliveries/files.ts), aqui e no auxiliar. Os arquivos lidos ficam num cache pequeno em memória.
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { tr } from '../../shared/i18n';
import { HostWait, pollWithWait } from '../host-wait';
import { checkFile, DELIVERY_FILE_MAX_BYTES } from './files';

export const HOST_PRESENCE_MS = 10_000;
export const WAIT_MS = 20_000;
const CACHE_MAX_BYTES = 80 * 1024 * 1024;
const MAX_PENDING = 16;

export type FetchResult = { data: Buffer } | { error: string; status: number };

interface Pending {
  id: string;
  path: string;
  sent: boolean;
  at: number;
  done: (r: FetchResult) => void;
}

export interface FileFetcherOptions {
  /** Modo Node: lê direto do disco. */
  direct?: boolean;
  /** Docker: o caminho do host dentro do container, quando a pasta está montada (undefined = não está). */
  mapHostPath?: (path: string) => string | undefined;
  read?: (path: string) => Buffer;
  check?: typeof checkFile;
  now?: () => number;
}

export class FileFetcher {
  private readonly cache = new Map<string, Buffer>();
  private cacheBytes = 0;
  private readonly pending = new Map<string, Pending>();
  private readonly host: HostWait;
  private readonly now: () => number;

  constructor(private readonly opts: FileFetcherOptions = {}) {
    this.now = opts.now ?? Date.now;
    this.host = new HostWait(HOST_PRESENCE_MS, this.now);
  }

  hostAvailable(): boolean {
    return this.host.present();
  }

  async get(path: string): Promise<FetchResult> {
    const hit = this.cache.get(path);
    if (hit) {
      this.cache.delete(path);
      this.cache.set(path, hit);
      return { data: hit };
    }
    const local = this.opts.direct ? path : this.opts.mapHostPath?.(path);
    if (local) {
      const r = this.readLocal(local);
      if ('data' in r || this.opts.direct) return r;
    }
    if (this.opts.direct) return { error: tr('arquivo não encontrado'), status: 404 };
    if (!this.hostAvailable()) return { error: tr('o auxiliar do computador (npm run codex:bridge) não está rodando'), status: 503 };
    if (this.pending.size >= MAX_PENDING) return { error: tr('arquivos demais sendo buscados: tente de novo'), status: 429 };
    const r = await new Promise<FetchResult>((done) => {
      const p: Pending = { id: randomUUID(), path, sent: false, at: this.now(), done };
      this.pending.set(p.id, p);
      this.host.wake();
      setTimeout(() => {
        if (this.pending.delete(p.id)) done({ error: tr('o computador não respondeu a tempo'), status: 504 });
      }, WAIT_MS).unref?.();
    });
    if ('data' in r) this.remember(path, r.data);
    return r;
  }

  /** Rodada do auxiliar: marca presença e entrega os caminhos pedidos. */
  poll(): Array<{ id: string; path: string }> {
    this.host.seen();
    const out: Array<{ id: string; path: string }> = [];
    for (const p of this.pending.values()) {
      if (p.sent) continue;
      p.sent = true;
      out.push({ id: p.id, path: p.path });
    }
    return out;
  }

  /** Rodada com espera (?wait=1): sem nada pedido, fica parada até chegar um pedido ou passar `ms`. */
  pollWait(ms: number, signal?: AbortSignal): Promise<Array<{ id: string; path: string }>> {
    return pollWithWait(this.host, () => this.poll(), ms, signal);
  }

  ack(raw: unknown): void {
    this.host.seen();
    const list = raw && typeof raw === 'object' && Array.isArray((raw as { results?: unknown }).results) ? (raw as { results: unknown[] }).results : [];
    for (const r of list) {
      const x = r && typeof r === 'object' ? (r as Record<string, unknown>) : {};
      const p = typeof x.id === 'string' ? this.pending.get(x.id) : undefined;
      if (!p) continue;
      this.pending.delete(p.id);
      if (x.ok === true && typeof x.data === 'string' && /^[A-Za-z0-9+/]*={0,2}$/.test(x.data)) {
        const data = Buffer.from(x.data, 'base64');
        if (data.length <= DELIVERY_FILE_MAX_BYTES) {
          p.done({ data });
          continue;
        }
      }
      p.done({ error: typeof x.error === 'string' && x.error ? x.error.slice(0, 200) : tr('o computador não leu o arquivo'), status: 404 });
    }
  }

  private readLocal(path: string): FetchResult {
    const c = (this.opts.check ?? checkFile)(path);
    if ('error' in c) return { error: c.error, status: c.error === tr('arquivo não encontrado') ? 404 : 403 };
    try {
      const data = (this.opts.read ?? readFileSync)(c.path);
      this.remember(path, data);
      return { data };
    } catch {
      return { error: tr('arquivo ilegível'), status: 404 };
    }
  }

  private remember(path: string, data: Buffer): void {
    if (data.length > CACHE_MAX_BYTES / 4) return;
    this.cache.set(path, data);
    this.cacheBytes += data.length;
    for (const [k, v] of this.cache) {
      if (this.cacheBytes <= CACHE_MAX_BYTES) break;
      this.cache.delete(k);
      this.cacheBytes -= v.length;
    }
  }
}
