// Binário falso do Codex para os testes das mensagens: imita as saídas reais do `codex queue` (0.162) e anota cada
// chamada (argumentos e CODEX_HOME) num arquivo. Nunca chama o Codex de verdade.
// - thread que começa com 0199aaaa: "Error: ... no rollout found for thread id ..." no stderr, retorno 1;
// - thread que começa com 0199bbbb: demora 10 s (para o prazo);
// - opção proibida (-c, --enable, --disable, --no-daemon) ou argumento faltando: retorno 2;
// - senão: "Queued message <id> for thread <thread>." no stdout, retorno 0.
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CODEX_BIN_NAME } from '../messages/codex';

/**
 * O binário falso roda aqui? Ele é um script com shebang, e no Windows o execFile (sem shell) só roda .exe: lá os testes
 * que o executam ficam de fora (a busca pelo nome segue testada).
 */
export const FAKE_CODEX_RUNS = process.platform !== 'win32';

const SCRIPT = `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
if (process.env.FAKE_CODEX_LOG) fs.appendFileSync(process.env.FAKE_CODEX_LOG, JSON.stringify({ args, codexHome: process.env.CODEX_HOME }) + '\\n');
const thread = (args.find((a) => a.startsWith('--thread=')) || '').slice('--thread='.length);
const message = args.find((a) => a.startsWith('--message='));
if (args[0] !== 'queue' || args.some((a) => /^(-c|--config|--enable|--disable|--no-daemon)/.test(a))) {
  process.stderr.write("error: unexpected argument found\\n\\nUsage: codex queue --thread <THREAD> --message <TEXT>\\n");
  process.exit(2);
} else if (!thread || message === undefined) {
  process.stderr.write('error: the following required arguments were not provided:\\n  --thread <THREAD>\\n');
  process.exit(2);
} else if (thread.startsWith('0199aaaa')) {
  process.stderr.write('Error: failed to queue session message: thread/queue/add failed: failed to read thread: invalid thread-store request: no rollout found for thread id ' + thread + ' (code -32603)\\n');
  process.exit(1);
} else if (thread.startsWith('0199bbbb')) {
  setTimeout(() => process.stdout.write('tarde demais\\n'), 10000);
} else {
  process.stdout.write('Queued message 01a11fb4-27d1-7450-947c-e3c97aa47303 for thread ' + thread + '.\\n');
}
`;

/** Grava o binário falso como <dir>/codex (no Windows, codex.exe: o nome que a busca procura) e devolve o caminho. */
export function writeFakeCodex(dir: string): string {
  const bin = join(dir, CODEX_BIN_NAME);
  writeFileSync(bin, SCRIPT);
  chmodSync(bin, 0o755);
  return bin;
}

/** Chamadas anotadas pelo binário falso. */
export function fakeCodexCalls(log: string): Array<{ args: string[]; codexHome?: string }> {
  if (!existsSync(log)) return [];
  return readFileSync(log, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as { args: string[]; codexHome?: string });
}
