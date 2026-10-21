// Publica a versão do package.json no GitHub: confere se o CHANGELOG.md tem a seção dela, cria a tag vX.Y.Z e a
// release com o texto dessa seção como notas (é o que o Habblaud abre em Configurações › Sobre › Ver o que mudou).
//   npm run release                -> publica (precisa do gh autenticado)
//   npm run release -- --dry-run   -> só confere e mostra as notas
// Antes: suba a versão no package.json (npm version minor --no-git-tag-version), escreva a seção no CHANGELOG.md e
// faça o merge na main.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export interface ReleaseArgs {
  dryRun: boolean;
  help: boolean;
}

export function parseReleaseArgs(argv: string[]): ReleaseArgs {
  const args: ReleaseArgs = { dryRun: false, help: false };
  for (const a of argv) {
    if (a === '--dry-run') args.dryRun = true;
    else if (a === '--help' || a === '-h') args.help = true;
    else throw new Error(`opção desconhecida: ${a}`);
  }
  return args;
}

/**
 * Texto da seção `## [versão]` do CHANGELOG (sem o título e sem os links do fim), ou undefined se não houver
 * seção ou se ela estiver vazia.
 */
export function changelogSection(changelog: string, version: string): string | undefined {
  const lines = changelog.split(/\r?\n/);
  const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const head = new RegExp(`^## \\[?v?${escaped}\\]?(?:\\s|$)`);
  const start = lines.findIndex((l) => head.test(l));
  if (start < 0) return undefined;
  const body: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^## /.test(line) || /^\[[^\]]+\]:\s/.test(line)) break;
    body.push(line);
  }
  const text = body.join('\n').trim();
  return text || undefined;
}

/**
 * Junta as linhas quebradas só para caber em 120 colunas: nas notas da release o GitHub mostra cada quebra de linha,
 * e as frases apareceriam cortadas no meio. Títulos, itens novos, citações, tabelas e blocos de código ficam como estão.
 */
export function unwrapMarkdown(text: string): string {
  const out: string[] = [];
  let fence = false;
  let joinable = false;
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (/^(```|~~~)/.test(t)) {
      fence = !fence;
      out.push(line);
      joinable = false;
      continue;
    }
    const startsBlock = !t || fence || /^(#{1,6}\s|[-*+]\s|\d+[.)]\s|>|\|)/.test(t);
    if (joinable && !startsBlock) out[out.length - 1] += ` ${t}`;
    else out.push(line);
    joinable = !fence && !!t && !/^(#{1,6}\s|\|)/.test(t);
  }
  return out.join('\n');
}

function run(cmd: string, args: string[], opts: { quiet?: boolean } = {}): string {
  return execFileSync(cmd, args, { cwd: ROOT, encoding: 'utf8', stdio: opts.quiet ? ['ignore', 'pipe', 'ignore'] : ['ignore', 'pipe', 'inherit'] }).trim();
}

function fail(msg: string): never {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

function main(argv: string[]): void {
  let args: ReleaseArgs;
  try {
    args = parseReleaseArgs(argv);
  } catch (err) {
    fail((err as Error).message);
  }
  if (args.help) {
    console.log('Uso: npm run release [-- --dry-run]\nPublica a versão do package.json no GitHub com as notas do CHANGELOG.md.');
    return;
  }

  const version = (JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { version: string }).version;
  const tag = `v${version}`;
  const section = changelogSection(readFileSync(join(ROOT, 'CHANGELOG.md'), 'utf8'), version);
  if (!section) fail(`o CHANGELOG.md não tem a seção "## [${version}]" (ou ela está vazia): escreva o que entrou nesta versão.`);

  const branch = run('git', ['rev-parse', '--abbrev-ref', 'HEAD']);
  if (branch !== 'main') fail(`publique a partir da main (você está em ${branch}).`);
  if (run('git', ['status', '--porcelain'])) fail('há mudanças não commitadas.');
  run('git', ['fetch', '--quiet', '--tags', 'origin']);
  if (run('git', ['rev-parse', 'HEAD']) !== run('git', ['rev-parse', 'origin/main'])) fail('a main local não está igual à origin/main (faça git pull ou git push).');
  let tagExists = true;
  try {
    run('git', ['rev-parse', '--quiet', '--verify', `refs/tags/${tag}`], { quiet: true });
  } catch {
    tagExists = false;
  }
  if (tagExists) fail(`a tag ${tag} já existe: suba a versão no package.json antes.`);
  const notes = unwrapMarkdown(section);

  console.log(`Habblaud ${tag}\n\n${notes}\n`);
  if (args.dryRun) {
    console.log('(--dry-run: nada foi publicado)');
    return;
  }

  const dir = mkdtempSync(join(tmpdir(), 'habblaud-release-'));
  try {
    const file = join(dir, 'notas.md');
    writeFileSync(file, `${notes}\n`);
    run('git', ['tag', '-a', tag, '-m', `Habblaud ${tag}`]);
    run('git', ['push', 'origin', tag]);
    const url = run('gh', ['release', 'create', tag, '--verify-tag', '--title', `Habblaud ${tag}`, '--notes-file', file]);
    console.log(`✓ Release publicada: ${url}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2));
}
