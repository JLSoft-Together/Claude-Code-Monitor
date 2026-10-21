#!/usr/bin/env node
// Tap de statusline do Habblaud: captura o uso do plano (5h e semanal) SEM ler credenciais.
//
// O Claude Code envia ao comando de statusline, pelo stdin, um JSON com `rate_limits`
// ({five_hour:{used_percentage, resets_at}, seven_day:{...}}, resets_at em segundos). Este script
// fica "na frente" do statusline original:
//
//   node /caminho/do/habblaud/scripts/statusline-tap.mjs -- <comando original do statusline>
//
// 1. lê todo o stdin;
// 2. se houver rate_limits, grava <HABBLAUD_USAGE_DIR ou ~/.habblaud/usage>/<pasta da conta>.json com
//    SÓ {accountId, configDir, fetchedAt, five_hour, seven_day} (nada mais do stdin, por privacidade);
// 3. roda o comando original com o MESMO stdin, herdando stdout/stderr, e sai com o código dele (no shell em que o
//    Claude Code o rodaria: ver originalShell).
//    Sem comando original, não imprime nada.
//
// Regras: Node puro e sem dependências; qualquer falha na captura é ignorada em silêncio — o
// statusline nunca pode quebrar nem ficar lento por causa do Habblaud. Instalação automática
// (com backup do settings.json): npm run usage:install.
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, realpathSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, delimiter, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Valores idênticos gravados há menos que isto não são regravados. */
const MIN_REWRITE_MS = 10_000;

/** Comando original: tudo depois de `--` (o instalador põe entre aspas simples o que não for trivial). */
export function originalCommand(argv) {
  const i = argv.indexOf('--');
  const rest = i >= 0 ? argv.slice(i + 1) : argv;
  return rest.join(' ').trim();
}

/** Config dir da conta: pelo transcript_path (trecho antes de "/projects/"), CLAUDE_CONFIG_DIR ou ~/.claude. */
export function configDirOf(input, env = process.env, home = env.HOME || homedir()) {
  const tp = typeof input?.transcript_path === 'string' ? input.transcript_path : '';
  const at = tp.lastIndexOf('/projects/');
  if (at > 0) return resolve(tp.slice(0, at));
  const fromEnv = (env.CLAUDE_CONFIG_DIR ?? '').split(',')[0].trim();
  if (fromEnv) return resolve(fromEnv.replace(/^~(?=\/|$)/, home));
  return join(home, '.claude');
}

function percent(w) {
  if (!w || typeof w !== 'object') return undefined;
  const raw = w.used_percentage ?? w.utilization ?? w.used_percent;
  const n = typeof raw === 'string' && raw.trim() ? Number(raw) : raw;
  return typeof n === 'number' && Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : undefined;
}

function windowOf(w) {
  const utilization = percent(w);
  if (utilization === undefined) return undefined;
  const r = w.resets_at;
  const resets = typeof r === 'number' && Number.isFinite(r) ? r : typeof r === 'string' && r.trim() ? r.trim() : undefined;
  return resets === undefined ? { utilization } : { utilization, resets_at: resets };
}

/** Registro gravado (ou undefined, se o JSON não trouxer rate_limits utilizáveis). */
export function usageRecord(input, now, env = process.env, home = env.HOME || homedir()) {
  const rl = input && typeof input === 'object' ? input.rate_limits : undefined;
  if (!rl || typeof rl !== 'object') return undefined;
  const five = windowOf(rl.five_hour);
  const week = windowOf(rl.seven_day);
  if (!five && !week) return undefined;
  const configDir = configDirOf(input, env, home);
  const rec = { accountId: basename(configDir), configDir, fetchedAt: now };
  if (five) rec.five_hour = five;
  if (week) rec.seven_day = week;
  return rec;
}

export function usageDirOf(env = process.env, home = env.HOME || homedir()) {
  const d = (env.HABBLAUD_USAGE_DIR ?? '').trim();
  return d ? resolve(d.replace(/^~(?=\/|$)/, home)) : join(home, '.habblaud', 'usage');
}

/** Grava de forma atômica (tmp + rename, modo 600). Devolve false quando nada precisou mudar. */
export function writeUsage(rec, dir, now) {
  const file = join(dir, `${rec.accountId}.json`);
  try {
    const prev = JSON.parse(readFileSync(file, 'utf8'));
    const same =
      JSON.stringify([prev.configDir, prev.five_hour, prev.seven_day]) === JSON.stringify([rec.configDir, rec.five_hour, rec.seven_day]);
    if (same && typeof prev.fetchedAt === 'number' && now - prev.fetchedAt >= 0 && now - prev.fetchedAt < MIN_REWRITE_MS) return false;
  } catch {
    // primeiro registro (ou ilegível): grava
  }
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(rec)}\n`, { mode: 0o600 });
  renameSync(tmp, file);
  return true;
}

function isFile(p) {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

/**
 * Shell do comando original: o mesmo em que o Claude Code roda o statusline. Fora do Windows, o /bin/sh. No Windows,
 * o Git Bash (CLAUDE_CODE_GIT_BASH_PATH ou o bin\bash.exe da instalação do git.exe do PATH; nunca o `bash` do PATH,
 * que pode ser o do WSL); sem ele, o padrão do Node (cmd.exe).
 */
export function originalShell(env = process.env) {
  if (process.platform !== 'win32') return true;
  const explicit = (env.CLAUDE_CODE_GIT_BASH_PATH ?? '').trim();
  if (explicit && isFile(explicit)) return explicit;
  for (const dir of (env.PATH ?? '').split(delimiter)) {
    if (!dir || !isAbsolute(dir) || !isFile(join(dir, 'git.exe'))) continue;
    // git.exe em <Git>\cmd (o do PATH do Windows) ou em <Git>\mingw64\bin (o do PATH do Git Bash).
    const bash = [resolve(dir, '..', 'bin', 'bash.exe'), resolve(dir, '..', '..', 'bin', 'bash.exe')].find(isFile);
    if (bash) return bash;
  }
  return true;
}

/** A captura: nunca lança. */
export function tap(stdinText, env = process.env, now = Date.now()) {
  try {
    if (!stdinText || !stdinText.includes('rate_limits')) return false;
    const rec = usageRecord(JSON.parse(stdinText), now, env);
    return rec ? writeUsage(rec, usageDirOf(env), now) : false;
  } catch {
    return false;
  }
}

async function readStdin() {
  if (process.stdin.isTTY) return Buffer.alloc(0);
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks);
}

async function main() {
  let input = Buffer.alloc(0);
  try {
    input = await readStdin();
  } catch {
    // sem stdin legível: segue só com o comando original
  }
  const command = originalCommand(process.argv.slice(2));
  if (!command) {
    tap(input.toString('utf8'));
    return;
  }
  // O comando original começa antes da captura (que roda enquanto ele trabalha): zero atraso extra.
  let child;
  try {
    child = spawn(command, { shell: originalShell(), stdio: ['pipe', 'inherit', 'inherit'] });
  } catch {
    tap(input.toString('utf8'));
    process.exitCode = 127;
    return;
  }
  const done = new Promise((ok) => {
    child.on('error', () => ok(127));
    child.on('close', (code, signal) => ok(code ?? (signal ? 1 : 0)));
  });
  for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(sig, () => child.kill(sig));
  child.stdin.on('error', () => {}); // o comando pode sair sem ler o stdin (EPIPE)
  child.stdin.end(input);
  tap(input.toString('utf8'));
  process.exitCode = await done;
}

/** Chamado direto (e não importado pelos testes)? Compara caminhos reais (o repo pode ser um symlink). */
function isMain() {
  try {
    return !!process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMain()) {
  main().catch(() => {
    process.exitCode = process.exitCode || 1;
  });
}
