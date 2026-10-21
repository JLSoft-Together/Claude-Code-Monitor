// Conferir que um PID ainda é aquele Claude Code antes de encerrá-lo ou assumi-lo. O registro de sessões
// (<conta>/sessions/<pid>.json) pode ficar para trás depois de um crash ou de reiniciar o computador, e o PID
// pode ter sido reaproveitado por outro processo do usuário: aí "Encerrar" mandaria o sinal para ele.
// Compara o início real do processo (sistema operacional) com o do registro e o nome do executável.
import { execFile } from 'node:child_process';
import { basename } from 'node:path';

export interface ProcInfo {
  /** Início do processo, em ms desde 1970. */
  startMs: number;
  /** Nome do executável (sem pasta nem extensão). */
  name: string;
  /** Início exato como o Windows informa (FILETIME), o mesmo formato do `procStart` do registro no Windows. */
  fileTime?: string;
}

/** O que o registro de sessões do Claude Code guarda sobre o processo. */
export interface RegisteredProc {
  startedAt?: number;
  procStart?: string;
}

/** Diferença entre 1601 (FILETIME) e 1970, em ms. */
const FILETIME_EPOCH_MS = 11_644_473_600_000;
/** O registro é gravado logo depois que o processo sobe: início real até 2 min antes (ou 5 s depois, relógio). */
const START_BEFORE_MS = 120_000;
const START_AFTER_MS = 5_000;

/** Executável do Claude Code: `claude`, o Node/Bun que roda o pacote npm ou o binário nativo com nome de versão. */
export function looksLikeClaude(name: string): boolean {
  const n = basename(name.trim()).replace(/\.exe$/i, '');
  return /^(claude|node|bun)$/i.test(n) || /^\d+\.\d+\.\d+/.test(n);
}

/** O processo vivo `info` é o mesmo que gravou `reg`? */
export function sameProcess(reg: RegisteredProc, info: ProcInfo): boolean {
  if (!looksLikeClaude(info.name)) return false;
  // Windows: o registro guarda o FILETIME exato do início; quando os dois existem, têm de ser iguais.
  if (reg.procStart && info.fileTime && /^\d+$/.test(reg.procStart)) return reg.procStart === info.fileTime;
  if (typeof reg.startedAt !== 'number' || !Number.isFinite(reg.startedAt)) return false;
  return info.startMs >= reg.startedAt - START_BEFORE_MS && info.startMs <= reg.startedAt + START_AFTER_MS;
}

function run(file: string, args: string[], env?: NodeJS.ProcessEnv): Promise<string | undefined> {
  return new Promise((ok) => {
    execFile(file, args, { windowsHide: true, timeout: 10_000, env }, (err, stdout) => ok(err ? undefined : String(stdout)));
  });
}

/** Início e nome de um processo vivo (undefined se ele não existe ou não deu para saber). */
export async function readProcInfo(pid: number, platform: NodeJS.Platform = process.platform): Promise<ProcInfo | undefined> {
  if (!Number.isSafeInteger(pid) || pid <= 0) return undefined;
  if (platform === 'win32') {
    const out = await run('powershell.exe', [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `$p = Get-Process -Id ${pid} -ErrorAction Stop; $p.StartTime.ToFileTimeUtc(); $p.ProcessName`,
    ]);
    return out === undefined ? undefined : parseWindows(out);
  }
  // macOS e Linux: lstart em inglês (LC_ALL=C) e o nome do executável.
  const out = await run('ps', ['-o', 'lstart=', '-o', 'comm=', '-p', String(pid)], { ...process.env, LC_ALL: 'C', LANG: 'C' });
  return out === undefined ? undefined : parsePs(out);
}

/** Saída do PowerShell: FILETIME na primeira linha, nome na segunda. */
export function parseWindows(out: string): ProcInfo | undefined {
  const [ft, name] = out.trim().split(/\r?\n/).map((s) => s.trim());
  if (!ft || !/^\d+$/.test(ft) || !name) return undefined;
  return { startMs: Number(BigInt(ft) / 10_000n) - FILETIME_EPOCH_MS, name, fileTime: ft };
}

/** Saída do ps: "Mon Oct 12 22:46:14 2026 /caminho/do/comando" (lstart tem sempre 5 campos). */
export function parsePs(out: string): ProcInfo | undefined {
  const m = /^\s*(\w{3}\s+\w{3}\s+\d{1,2}\s+\d{1,2}:\d{2}:\d{2}\s+\d{4})\s+(.+?)\s*$/.exec(out.split('\n')[0] ?? '');
  if (!m) return undefined;
  const startMs = Date.parse(m[1]);
  if (!Number.isFinite(startMs)) return undefined;
  return { startMs, name: basename(m[2]) };
}
