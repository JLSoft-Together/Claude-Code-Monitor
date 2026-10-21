// Grava dist/build.json com o commit do Habblaud e se a cópia estava modificada (`npm run build:server` chama). O
// server/build.ts lê o arquivo (readBuildInfo), e o `hello` do Habblaud World manda {commit, dirty} para o servidor
// saber se é uma release oficial (shared/world/protocol.ts, BuildInfo).
//
// - commit: `git rev-parse HEAD`; sem git (pasta baixada como .zip, build do Docker, que não leva o .git) = "unknown".
// - dirty: algum arquivo VERSIONADO modificado (`git status --porcelain --untracked-files=no`). Arquivos fora do git
//   (.env, node_modules como link simbólico, rascunhos) não contam: o build só leva o que o código versionado importa.
// - HABBLAUD_BUILD_COMMIT e HABBLAUD_BUILD_DIRTY (1/true) substituem a leitura do git (para builds sem o .git).
//
// Uso direto: node scripts/build-info.mjs [arquivo]   (padrão: dist/build.json, a partir da pasta atual)
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const COMMIT_RE = /^[0-9a-f]{40}([0-9a-f]{24})?$/;

/** {commit, dirty} da pasta `cwd`. */
export function gitBuildInfo(cwd = process.cwd(), env = process.env) {
  const fromEnv = env.HABBLAUD_BUILD_COMMIT?.trim().toLowerCase();
  if (fromEnv) return { commit: COMMIT_RE.test(fromEnv) ? fromEnv : 'unknown', dirty: /^(1|true)$/i.test(env.HABBLAUD_BUILD_DIRTY?.trim() ?? '') };
  const git = (args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 10_000 }).trim();
  try {
    const commit = git(['rev-parse', 'HEAD']);
    if (!COMMIT_RE.test(commit)) return { commit: 'unknown', dirty: false };
    return { commit, dirty: git(['status', '--porcelain', '--untracked-files=no']).length > 0 };
  } catch {
    return { commit: 'unknown', dirty: false };
  }
}

/** Escreve o arquivo ({commit, dirty, builtAt}) e devolve o que escreveu. */
export function writeBuildInfo(file, cwd = process.cwd(), now = new Date()) {
  const info = { ...gitBuildInfo(cwd), builtAt: now.toISOString() };
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(info, null, 2)}\n`);
  return info;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const info = writeBuildInfo(resolve(process.argv[2] ?? 'dist/build.json'));
  console.log(JSON.stringify(info));
}
