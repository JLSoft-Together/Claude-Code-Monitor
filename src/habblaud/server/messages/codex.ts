// Mensagens pelo escritório para as sessões do Codex: `codex queue --thread <threadId> --message <texto>` põe a
// mensagem na fila do thread (ela entra quando a sessão fica ociosa; o dono do thread consulta a fila a cada ~10 s; o
// turno que ela abre traz turn_trigger "queue"). O comando precisa rodar no Mac (host), com o CODEX_HOME da conta:
// - modo Node: o próprio servidor roda o comando (binário HABBLAUD_CODEX_BIN ou `codex` do PATH);
// - Docker: o auxiliar do host (scripts/codex-bridge.ts, npm run codex:bridge) busca as mensagens em
//   POST /api/codex/bridge/poll, roda o mesmo comando e confirma em POST /api/codex/bridge/ack.
// Sem shell (execFile), com prazo, e nunca com -c, --enable, --disable nem --no-daemon (mudariam a configuração ou o
// servidor da sessão). Retorno 0 ("Queued message <id> for thread <thread>.") = entrou na fila — mesmo que ninguém
// esteja com o thread aberto agora; outro retorno = falhou, e a 1ª linha do stderr diz por quê ("Error: ... no rollout
// found for thread id ..."). Se o servidor compartilhado do Codex (daemon) não estiver no ar, o próprio comando o sobe.
// Node puro e sem dependências: também é importado pelo auxiliar do host (via tsx).
import { execFile } from 'node:child_process';
import { accessSync, constants, statSync } from 'node:fs';
import { delimiter, isAbsolute, join } from 'node:path';
import { tr } from '../../shared/i18n';

/** Prazo de um `codex queue`. */
export const QUEUE_TIMEOUT_MS = 20_000;
/** Id de thread do Codex (UUID; `codex queue --thread` também aceitaria nomes, mas o Habblaud só manda ids). */
export const THREAD_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ERROR_MAX = 300;

export interface CodexQueueJob {
  /** Pasta CODEX_HOME da conta (caminho do host). */
  codexHome: string;
  /** Id do thread (AgentInfo.sessionId do agente do Codex). */
  thread: string;
  /** O texto como foi digitado. */
  text: string;
}

export type CodexQueueResult = { ok: true } | { ok: false; error: string };
export type CodexQueueRunner = (job: CodexQueueJob) => Promise<CodexQueueResult>;

function canExecute(p: string): boolean {
  try {
    accessSync(p, constants.X_OK);
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

/**
 * Nome do binário no PATH. No Windows, só o `codex.exe`: o `codex` sem extensão e o `codex.cmd` que o npm põe ao lado
 * são scripts, e o execFile (sem shell) não os roda.
 */
export const CODEX_BIN_NAME = process.platform === 'win32' ? 'codex.exe' : 'codex';

/** Binário do Codex: HABBLAUD_CODEX_BIN (caminho de um executável) ou `codex` no PATH. undefined = não achou. */
export function findCodexBin(env: NodeJS.ProcessEnv, isExecutable: (p: string) => boolean = canExecute): string | undefined {
  const explicit = env.HABBLAUD_CODEX_BIN?.trim();
  if (explicit) return isExecutable(explicit) ? explicit : undefined;
  for (const dir of (env.PATH ?? '').split(delimiter)) {
    if (!dir || !isAbsolute(dir)) continue;
    const p = join(dir, CODEX_BIN_NAME);
    if (isExecutable(p)) return p;
  }
  return undefined;
}

/** Argumentos de `codex queue` (com "=": um texto que começa com "-" nunca vira uma opção). */
export function queueArgs(thread: string, text: string): string[] {
  return ['queue', `--thread=${thread}`, `--message=${text}`];
}

/** Primeira linha não vazia (o Codex escreve o erro como "Error: ..."), cortada. */
export function firstLine(s: string | undefined): string | undefined {
  const line = (s ?? '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find(Boolean);
  if (!line) return undefined;
  return line.length > ERROR_MAX ? `${line.slice(0, ERROR_MAX - 1)}…` : line;
}

/** Roda `codex queue` com o binário dado. Nunca rejeita: falha vira `{ok: false, error}`. */
export function createCodexQueueRunner(bin: string, opts: { env?: NodeJS.ProcessEnv; timeoutMs?: number } = {}): CodexQueueRunner {
  const timeoutMs = opts.timeoutMs ?? QUEUE_TIMEOUT_MS;
  return (job) =>
    new Promise<CodexQueueResult>((done) => {
      if (!THREAD_ID.test(job.thread)) return done({ ok: false, error: tr('id de thread do Codex inválido') });
      if (!isAbsolute(job.codexHome)) return done({ ok: false, error: tr('pasta da conta do Codex inválida') });
      const env = { ...(opts.env ?? process.env), CODEX_HOME: job.codexHome };
      try {
        execFile(bin, queueArgs(job.thread, job.text), { env, timeout: timeoutMs, maxBuffer: 256 * 1024, windowsHide: true, encoding: 'utf8' }, (err, _stdout, stderr) => {
          if (!err) return done({ ok: true });
          const e = err as NodeJS.ErrnoException & { killed?: boolean };
          if (e.killed) return done({ ok: false, error: tr('o codex queue não respondeu em {0} s (a mensagem pode ter entrado na fila mesmo assim)', [Math.round(timeoutMs / 1_000)]) });
          if (e.code === 'ENOENT' || e.code === 'EACCES') return done({ ok: false, error: tr('não consegui rodar o Codex ({0})', [bin]) });
          done({ ok: false, error: firstLine(stderr) ?? tr('o codex queue falhou (código {0})', [String(e.code ?? '?')]) });
        });
      } catch {
        // Argumento que não dá para passar a um processo (ex.: caractere NUL no texto).
        done({ ok: false, error: tr('a mensagem tem caracteres que não dá para mandar ao Codex') });
      }
    });
}
