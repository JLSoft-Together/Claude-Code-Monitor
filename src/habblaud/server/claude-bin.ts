// Onde está o `claude` do Claude Code neste computador. Usado pelo terminal interativo (pty/manager.ts), pelo Novo
// agente (spawn/spawn.ts) e pelo auxiliar do host (scripts/codex-bridge.ts). Node puro e sem dependências.
import { accessSync, constants, statSync } from 'node:fs';
import { extname, resolve } from 'node:path';

/** O arquivo existe e pode ser executado (no Windows basta existir: lá não há permissão de execução). */
export function isExecutableFile(file: string, platform: NodeJS.Platform = process.platform): boolean {
  try {
    if (!statSync(file).isFile()) return false;
    if (platform !== 'win32') accessSync(file, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** Procura um executável no PATH (no Windows, também com as extensões de PATHEXT, se o nome não tiver uma). */
export function findExecutable(name: string, env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): string | undefined {
  const sep = platform === 'win32' ? ';' : ':';
  const exts =
    platform === 'win32' && !extname(name) ? ['.exe', ...(env.PATHEXT ?? '.COM;.CMD;.BAT').split(';').filter(Boolean).map((e) => e.toLowerCase())] : [''];
  const dirs = (env.PATH ?? env.Path ?? '').split(sep).filter(Boolean);
  for (const dir of dirs) {
    for (const ext of exts) {
      const file = resolve(dir, name + ext);
      if (isExecutableFile(file, platform)) return file;
    }
  }
  return undefined;
}

/**
 * O executável do Claude Code: HABBLAUD_CLAUDE_BIN (um caminho, ou um nome procurado
 * no PATH) ou o `claude` do PATH. undefined se não achar.
 */
export function claudeBinFrom(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): string | undefined {
  const set = env.HABBLAUD_CLAUDE_BIN?.trim();
  if (!set) return findExecutable('claude', env, platform);
  return /[\\/]/.test(set) ? resolve(set) : findExecutable(set, env, platform);
}

/** O `claude` que dá para rodar: o de claudeBinFrom, se o arquivo existe e é executável. */
export function runnableClaudeBin(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): string | undefined {
  const bin = claudeBinFrom(env, platform);
  return bin && isExecutableFile(bin, platform) ? bin : undefined;
}
