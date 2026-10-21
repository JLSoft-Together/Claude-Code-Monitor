// Fonte 'statusline' de uso: arquivos <usageDir>/<conta>.json gravados por scripts/statusline-tap.mjs
// a partir do JSON que o próprio Claude Code envia ao comando de statusline (campo rate_limits), ou
// pelo mod do Claude Code (mod/habblaud, a partir de `$.session.usage()`), no mesmo formato.
// Não lê credenciais nem chama API nenhuma: só arquivos pequenos, relidos a cada ~5 s.
//
// Formato (o tap grava SÓ isto; o mod acrescenta "source": "mod", que vira AccountUsage.via):
//   {"accountId": ".claude-conta2", "configDir": "/Users/x/.claude-conta2", "fetchedAt": 1790000000000,
//    "five_hour": {"utilization": 42, "resets_at": 1790003600}, "seven_day": {"utilization": 15, "resets_at": 1790500000}}
// `resets_at` vem em segundos (como o Claude Code envia); `fetchedAt` em ms.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { AccountUsage } from '../../shared/types';
import { toEpochMs, usageFromWindows } from './usage';

/** Arquivos maiores que isto não são do tap (o tap grava ~250 bytes): ignorados. */
const MAX_FILE_BYTES = 64 * 1024;

export interface StatuslineUsage {
  /** Arquivo de origem (para diagnóstico). */
  file: string;
  accountId?: string;
  configDir?: string;
  usage: AccountUsage;
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

/**
 * Interpreta o conteúdo de um arquivo do tap. `mtimeMs` é usado quando falta `fetchedAt`;
 * datas no futuro (relógios diferentes) são limitadas a `now`.
 */
export function parseStatuslineFile(raw: string, file: string, now: number, mtimeMs?: number): StatuslineUsage | undefined {
  let j: unknown;
  try {
    j = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (!j || typeof j !== 'object' || Array.isArray(j)) return undefined;
  const r = j as Record<string, unknown>;
  const fetched = toEpochMs(r.fetchedAt) ?? (mtimeMs !== undefined ? Math.round(mtimeMs) : undefined);
  if (fetched === undefined) return undefined;
  const usage = usageFromWindows({ five_hour: r.five_hour, seven_day: r.seven_day }, 'statusline', Math.min(now, fetched));
  if (!usage) return undefined;
  usage.via = r.source === 'mod' ? 'mod' : 'tap';
  const out: StatuslineUsage = { file, usage };
  const accountId = str(r.accountId);
  const configDir = str(r.configDir);
  if (accountId) out.accountId = accountId;
  if (configDir) out.configDir = configDir;
  return out;
}

/** Lê <dir>/*.json com cache por arquivo (só reinterpreta o que mudou de tamanho ou data). */
export class StatuslineUsageReader {
  private cache = new Map<string, { size: number; mtimeMs: number; parsed?: StatuslineUsage }>();

  constructor(readonly dir: string) {}

  read(now: number): StatuslineUsage[] {
    let names: string[];
    try {
      names = readdirSync(this.dir);
    } catch {
      // Pasta ainda não existe (tap não instalado ou nenhuma sessão desde a instalação).
      this.cache.clear();
      return [];
    }
    const seen = new Set<string>();
    const out: StatuslineUsage[] = [];
    for (const name of names) {
      if (!name.endsWith('.json')) continue;
      const path = join(this.dir, name);
      let size: number;
      let mtimeMs: number;
      try {
        const st = statSync(path);
        if (!st.isFile()) continue;
        size = st.size;
        mtimeMs = st.mtimeMs;
      } catch {
        continue;
      }
      seen.add(path);
      const cached = this.cache.get(path);
      if (cached && cached.size === size && cached.mtimeMs === mtimeMs) {
        if (cached.parsed) out.push(cached.parsed);
        continue;
      }
      if (size > MAX_FILE_BYTES) {
        this.cache.set(path, { size, mtimeMs }); // grande demais: não é do tap nem do mod
        continue;
      }
      let parsed: StatuslineUsage | undefined;
      try {
        parsed = parseStatuslineFile(readFileSync(path, 'utf8'), path, now, mtimeMs);
      } catch {
        parsed = undefined; // sumiu entre o stat e a leitura
      }
      if (parsed) {
        this.cache.set(path, { size, mtimeMs, parsed });
        out.push(parsed);
        continue;
      }
      // Vazio, JSON pela metade ou ilegível: o mod grava com $.fs.write, que NÃO é atômico (o tap usa tmp +
      // rename), então dá para pegar o arquivo no meio da escrita. Vale o último registro bom deste arquivo,
      // e a assinatura nova não entra no cache: o arquivo é relido no próximo ciclo (são poucos bytes).
      if (cached?.parsed) out.push(cached.parsed);
    }
    for (const path of [...this.cache.keys()]) if (!seen.has(path)) this.cache.delete(path);
    return out;
  }
}
