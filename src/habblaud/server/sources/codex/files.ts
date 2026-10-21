// Arquivos de uma pasta do Codex (CODEX_HOME) que a fonte lê: os rollouts (sessions/AAAA/MM/DD/ e
// archived_sessions/) e os locks dos threads carregados (thread-writer-locks/<thread>.lock). Só leitura: nada é
// criado e os locks são só conferidos pela EXISTÊNCIA (abrir com flock seguraria o lock e quebraria o Codex).
// auth.json, config.toml, history.jsonl, shell_snapshots/, logs e os SQLite nunca são abertos.
import { closeSync, existsSync, openSync, readdirSync, readSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createCodexState, metaFromLine, parseRolloutLine, type RolloutMeta } from './rollout';

/** rollout-<AAAA-MM-DDThh-mm-ss>-<thread>[_<rollout>].jsonl[.zst] (o `_<rollout>` é de thread revertido). */
const ROLLOUT_FILE = /^rollout-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:_[0-9a-f-]{36})?\.jsonl(\.zst)?$/i;
const LOCK_FILE = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.lock$/i;

export const SESSIONS_DIR = 'sessions';
export const ARCHIVED_DIR = 'archived_sessions';
export const LOCKS_DIR = 'thread-writer-locks';

/** Thread e compactação pelo nome do arquivo; undefined = não é um rollout. */
export function parseRolloutName(name: string): { threadId: string; compressed: boolean } | undefined {
  const m = ROLLOUT_FILE.exec(name);
  return m ? { threadId: m[1].toLowerCase(), compressed: !!m[2] } : undefined;
}

function listDir(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

/**
 * Pastas com rollouts: os dias de sessions/AAAA/MM/DD (do mais novo para o mais antigo: a pasta é a data de CRIAÇÃO
 * da conversa) e archived_sessions/ por último.
 */
export function rolloutDirs(home: string): string[] {
  const out: string[] = [];
  const desc = (names: string[], re: RegExp) => names.filter((n) => re.test(n)).sort((a, b) => b.localeCompare(a));
  const sessions = join(home, SESSIONS_DIR);
  for (const y of desc(listDir(sessions), /^\d{4}$/)) {
    for (const m of desc(listDir(join(sessions, y)), /^\d{2}$/)) {
      for (const d of desc(listDir(join(sessions, y, m)), /^\d{2}$/)) out.push(join(sessions, y, m, d));
    }
  }
  out.push(join(home, ARCHIVED_DIR));
  return out;
}

export interface LockInfo {
  threadId: string;
  /** Criação do lock (o Codex nunca escreve nele: o mtime é o momento em que foi criado). */
  createdAt: number;
}

/**
 * Locks dos threads carregados agora; null = a pasta não existe (versão do Codex sem locks, ou não montada no
 * Docker). O `.coordination.lock` e qualquer outro arquivo ficam de fora.
 */
export function readLocks(home: string): Map<string, LockInfo> | null {
  const dir = join(home, LOCKS_DIR);
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return null;
  }
  const out = new Map<string, LockInfo>();
  for (const name of names) {
    const m = LOCK_FILE.exec(name);
    if (!m) continue;
    try {
      const st = statSync(join(dir, name));
      const born = st.birthtimeMs > 0 ? Math.min(st.birthtimeMs, st.mtimeMs) : st.mtimeMs;
      out.set(m[1].toLowerCase(), { threadId: m[1].toLowerCase(), createdAt: born });
    } catch {
      // sumiu entre a listagem e o stat
    }
  }
  return out;
}

interface Found {
  path: string;
  mtimeMs: number;
}

/**
 * Onde está o rollout de cada thread (pelo id no nome do arquivo), com cache. Um thread retomado continua no arquivo
 * antigo (a pasta é a da criação), então a procura varre as pastas por data; um thread revertido tem mais de um
 * arquivo e vale o modificado por último. As pastas dos dias mais recentes são revistas a cada 2 s e a
 * varredura completa, no máximo a cada 30 s.
 */
export class RolloutIndex {
  private paths = new Map<string, Found>();
  /** Threads cujo único rollout está compactado (.jsonl.zst): ainda não dá para ler. */
  private compressedOnly = new Set<string>();
  private lastRecentScan = -Infinity;
  private lastFullScan = -Infinity;

  constructor(
    readonly home: string,
    private readonly now: () => number = Date.now,
  ) {}

  /** Caminho do rollout (não compactado) do thread; undefined = ainda não existe (ou não foi achado). */
  find(threadId: string): string | undefined {
    const id = threadId.toLowerCase();
    const hit = this.paths.get(id);
    if (hit && !existsSync(hit.path)) this.paths.delete(id);
    const now = this.now();
    if (now - this.lastRecentScan >= 2_000) {
      this.lastRecentScan = now;
      this.scan(rolloutDirs(this.home).slice(0, 2));
    }
    if (now - this.lastFullScan >= 30_000) this.scanAll();
    return this.paths.get(id)?.path;
  }

  /** O thread só tem rollout compactado (.zst). */
  isCompressedOnly(threadId: string): boolean {
    return this.compressedOnly.has(threadId.toLowerCase()) && !this.paths.has(threadId.toLowerCase());
  }

  /** Avisa onde está o rollout (ex.: o `transcript_path` de um hook, já validado). */
  hint(threadId: string, path: string): void {
    try {
      this.paths.set(threadId.toLowerCase(), { path, mtimeMs: statSync(path).mtimeMs });
    } catch {
      // ainda não existe
    }
  }

  /** Varredura completa (sem stat, a não ser para desempatar um thread com mais de um arquivo). */
  scanAll(): void {
    this.lastFullScan = this.lastRecentScan = this.now();
    this.scan(rolloutDirs(this.home));
  }

  private scan(dirs: string[]): void {
    for (const dir of dirs) {
      for (const name of listDir(dir)) {
        const r = parseRolloutName(name);
        if (!r) continue;
        if (r.compressed) {
          this.compressedOnly.add(r.threadId);
          continue;
        }
        const path = join(dir, name);
        const prev = this.paths.get(r.threadId);
        if (prev?.path === path) continue;
        let mtimeMs = 0;
        try {
          mtimeMs = statSync(path).mtimeMs;
        } catch {
          continue;
        }
        if (prev) {
          try {
            prev.mtimeMs = statSync(prev.path).mtimeMs;
          } catch {
            prev.mtimeMs = -Infinity;
          }
        }
        if (!prev || mtimeMs >= prev.mtimeMs) this.paths.set(r.threadId, { path, mtimeMs });
      }
    }
  }

  /**
   * Rollouts modificados nos últimos `maxAgeMs` (com stat de cada um): a presença no modo sem locks. Atualiza o
   * cache de caminhos de passagem.
   */
  recentlyModified(maxAgeMs: number): Array<{ threadId: string; path: string; mtimeMs: number }> {
    const now = this.now();
    const out = new Map<string, { threadId: string; path: string; mtimeMs: number }>();
    for (const dir of rolloutDirs(this.home)) {
      for (const name of listDir(dir)) {
        const r = parseRolloutName(name);
        if (!r || r.compressed) continue;
        const path = join(dir, name);
        let mtimeMs: number;
        try {
          mtimeMs = statSync(path).mtimeMs;
        } catch {
          continue;
        }
        const prev = this.paths.get(r.threadId);
        if (!prev || mtimeMs >= prev.mtimeMs) this.paths.set(r.threadId, { path, mtimeMs });
        if (now - mtimeMs > maxAgeMs) continue;
        const cur = out.get(r.threadId);
        if (!cur || mtimeMs > cur.mtimeMs) out.set(r.threadId, { threadId: r.threadId, path, mtimeMs });
      }
    }
    this.lastFullScan = this.lastRecentScan = now;
    return [...out.values()];
  }
}

// ------------------------------------------------------------------ começo do rollout

/** Máximo lido atrás do fim da 1ª linha (o session_meta traz as instruções base: dezenas de KB). */
export const META_MAX_BYTES = 4 * 1024 * 1024;
/** Trecho depois do session_meta lido atrás da primeira instrução (o título). */
export const HEAD_SCAN_BYTES = 256 * 1024;

export interface RolloutHead {
  meta?: RolloutMeta;
  /** Primeira instrução (já mascarada e cortada). */
  title?: string;
  firstAt?: number;
}

/** Lê `length` bytes a partir de `start` (síncrono). */
function readRange(fd: number, start: number, length: number): Buffer {
  const buf = Buffer.alloc(Math.max(0, length));
  const n = length > 0 ? readSync(fd, buf, 0, length, start) : 0;
  return buf.subarray(0, n);
}

/**
 * O começo do rollout: o session_meta (1ª linha) e a primeira instrução. A janela do fim lida ao abrir uma sessão
 * longa não tem nenhum dos dois.
 */
export function readRolloutHead(path: string): RolloutHead {
  let fd: number;
  try {
    fd = openSync(path, 'r');
  } catch {
    return {};
  }
  try {
    const chunks: Buffer[] = [];
    let pos = 0;
    let nl = -1;
    while (pos < META_MAX_BYTES) {
      const chunk = readRange(fd, pos, 64 * 1024);
      if (!chunk.length) break;
      const i = chunk.indexOf(0x0a);
      if (i !== -1) {
        chunks.push(chunk.subarray(0, i));
        nl = pos + i;
        break;
      }
      chunks.push(chunk);
      pos += chunk.length;
    }
    const first = Buffer.concat(chunks).toString('utf8');
    const head: RolloutHead = {};
    const meta = metaFromLine(first);
    if (meta) {
      head.meta = meta;
      if (meta.startedAt !== undefined) head.firstAt = meta.startedAt;
    }
    if (nl < 0) return head;
    const rest = readRange(fd, nl + 1, HEAD_SCAN_BYTES).toString('utf8').split('\n');
    rest.pop(); // a última linha pode ter sido cortada
    const state = createCodexState(meta);
    const ctx = { idPrefix: '', now: 0, activities: false };
    for (const line of rest) {
      if (!line.trim()) continue;
      parseRolloutLine(state, line, ctx);
      if (state.title !== undefined) break;
    }
    if (state.title) head.title = state.title;
    if (head.firstAt === undefined && state.firstAt !== undefined) head.firstAt = state.firstAt;
    return head;
  } catch {
    return {};
  } finally {
    closeSync(fd);
  }
}
