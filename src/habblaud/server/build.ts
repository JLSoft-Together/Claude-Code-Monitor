// Identificador do build do cliente compilado (dist/client): o nome do bundle principal, que muda a cada
// `npm run build`. Vai no snapshot para que páginas abertas antes de uma atualização percebam e se recarreguem.
// E o carimbo do build do servidor (dist/build.json: commit e "cópia modificada"), para o Habblaud World.
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { BuildInfo } from '../shared/world/protocol';

const BUNDLE = /bundle\/(main-[\w-]+)\.js/;

/** Lê o id do build a partir do index.html compilado (com cache pela data de modificação). */
export function createBuildReader(rootDir: string): () => string | undefined {
  const file = join(rootDir, 'dist', 'client', 'index.html');
  let mtime = -1;
  let id: string | undefined;
  return () => {
    try {
      const m = statSync(file).mtimeMs;
      if (m !== mtime) {
        mtime = m;
        id = BUNDLE.exec(readFileSync(file, 'utf8'))?.[1];
      }
    } catch {
      mtime = -1;
      id = undefined;
    }
    return id;
  };
}

/** O que scripts/build-server.mjs grava em dist/build.json (scripts/build-info.mjs). */
export interface BuildStamp extends BuildInfo {
  /** Quando o build foi feito (ISO); ausente sem o arquivo. */
  builtAt?: string;
}

const UNKNOWN: BuildStamp = { commit: 'unknown', dirty: false };

/**
 * Commit do build em uso e se a cópia estava modificada, de dist/build.json. Vai no `hello` do Habblaud World. Sem o
 * arquivo (modo dev com tsx, ou um build antigo) ou com ele estragado: commit "unknown".
 */
export function readBuildInfo(rootDir: string): BuildStamp {
  try {
    const raw = JSON.parse(readFileSync(join(rootDir, 'dist', 'build.json'), 'utf8')) as Record<string, unknown>;
    if (typeof raw.commit !== 'string' || !/^([0-9a-f]{40}([0-9a-f]{24})?|unknown)$/.test(raw.commit) || typeof raw.dirty !== 'boolean') return { ...UNKNOWN };
    const stamp: BuildStamp = { commit: raw.commit, dirty: raw.dirty };
    if (typeof raw.builtAt === 'string' && raw.builtAt.length <= 40) stamp.builtAt = raw.builtAt;
    return stamp;
  } catch {
    return { ...UNKNOWN };
  }
}
