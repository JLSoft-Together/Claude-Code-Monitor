// Registro de sessões ABERTAS do Claude Code: <configDir>/sessions/<pid>.json.
// O arquivo existe enquanto o processo vive. Fora do Docker também confirmamos o PID
// (um arquivo pode sobrar se o processo morrer sem limpar); no Docker os PIDs são do host.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { AgentStatus } from '../../shared/types';
import { describeWaitingFor } from '../../shared/activity';
import { tr } from '../../shared/i18n';

export interface RegistryEntry {
  pid: number;
  sessionId: string;
  cwd: string;
  startedAt?: number;
  version?: string;
  kind?: string;
  entrypoint?: string;
  name?: string;
  /** 'busy' | 'idle' | 'waiting' | 'shell' (versões antigas não têm; 'shell' = ocioso com shell em segundo plano). */
  status?: string;
  waitingFor?: string;
  /** Agente customizado da sessão (`claude --agent frinus`). */
  agent?: string;
  updatedAt?: number;
  statusUpdatedAt?: number;
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

/** Valida o JSON de um registro. Campos essenciais ausentes -> undefined. */
export function parseRegistryEntry(raw: string): RegistryEntry | undefined {
  let j: Record<string, unknown>;
  try {
    j = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return undefined;
  }
  if (!j || typeof j !== 'object') return undefined;
  const pid = num(j.pid);
  const sessionId = str(j.sessionId);
  const cwd = str(j.cwd);
  if (pid === undefined || !sessionId || !cwd) return undefined;
  const e: RegistryEntry = { pid, sessionId, cwd };
  const optional: Array<[keyof RegistryEntry, unknown]> = [
    ['startedAt', num(j.startedAt)],
    ['version', str(j.version)],
    ['kind', str(j.kind)],
    ['entrypoint', str(j.entrypoint)],
    ['name', str(j.name)],
    ['status', str(j.status)],
    ['waitingFor', str(j.waitingFor)],
    ['agent', str(j.agent)],
    ['updatedAt', num(j.updatedAt)],
    ['statusUpdatedAt', num(j.statusUpdatedAt)],
  ];
  for (const [k, v] of optional) if (v !== undefined) (e as unknown as Record<string, unknown>)[k] = v;
  return e;
}

/**
 * Primeira versão do Claude Code sabidamente gravando "shell" no registro (ocioso com shell em segundo plano).
 * Dela em diante, "idle" é a palavra final sobre shells: nada em segundo plano rodando.
 */
export const SHELL_STATUS_VERSION = '2.1.292';

/** Compara versões "x.y.z" (sufixos como "-beta" são ignorados). */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(/[.-]/).slice(0, 3).map((x) => Number.parseInt(x, 10) || 0);
  const pb = b.split(/[.-]/).slice(0, 3).map((x) => Number.parseInt(x, 10) || 0);
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  return 0;
}

/** Status do registro -> status do personagem (undefined = desconhecido; o transcript decide). */
export function registryStatus(e: RegistryEntry): { status?: AgentStatus; waitingFor?: string } {
  switch (e.status) {
    case 'busy':
      return { status: 'working' };
    case 'idle':
      return { status: 'idle' };
    // Ocioso, mas com shell(s) em segundo plano rodando (monitores não contam): esperando o shell.
    case 'shell':
      return { status: 'shell' };
    case 'waiting':
      return { status: 'waiting', waitingFor: describeWaitingFor(e.waitingFor) };
    default:
      return {};
  }
}

export function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM: o processo existe, só não é nosso.
    return (err as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}

export interface RegistryPoll {
  entries: RegistryEntry[];
  ok: boolean;
  error?: string;
}

interface Cached {
  mtimeMs: number;
  size: number;
  entry: RegistryEntry | undefined;
}

export class RegistryReader {
  private cache = new Map<string, Cached>();
  private readonly sessionsDir: string;
  private readonly isAlive: (pid: number) => boolean;

  constructor(
    readonly configDir: string,
    private readonly opts: { checkPid: boolean; isAlive?: (pid: number) => boolean },
  ) {
    this.sessionsDir = join(configDir, 'sessions');
    this.isAlive = opts.isAlive ?? pidAlive;
  }

  poll(): RegistryPoll {
    let names: string[];
    try {
      names = readdirSync(this.sessionsDir);
    } catch (err) {
      this.cache.clear();
      const code = (err as NodeJS.ErrnoException).code;
      return { entries: [], ok: false, error: code === 'ENOENT' ? tr('pasta sessions/ não encontrada') : tr('sessions/ ilegível ({0})', [code ?? tr('erro')]) };
    }
    const seen = new Set<string>();
    const entries: RegistryEntry[] = [];
    for (const name of names) {
      if (!name.endsWith('.json')) continue;
      const file = join(this.sessionsDir, name);
      seen.add(file);
      let st;
      try {
        st = statSync(file);
      } catch {
        continue;
      }
      let cached = this.cache.get(file);
      if (!cached || cached.mtimeMs !== st.mtimeMs || cached.size !== st.size) {
        let entry: RegistryEntry | undefined;
        try {
          entry = parseRegistryEntry(readFileSync(file, 'utf8'));
        } catch {
          entry = undefined;
        }
        if (entry) cached = { mtimeMs: st.mtimeMs, size: st.size, entry };
        // JSON inválido (arquivo sendo gravado): mantém a última versão boa e tenta de novo no próximo ciclo.
        else cached = cached ? { ...cached } : { mtimeMs: 0, size: -1, entry: undefined };
        this.cache.set(file, cached);
      }
      const e = cached.entry;
      if (!e) continue;
      if (this.opts.checkPid && !this.isAlive(e.pid)) continue;
      entries.push(e);
    }
    for (const file of [...this.cache.keys()]) if (!seen.has(file)) this.cache.delete(file);
    return { entries, ok: true };
  }
}
