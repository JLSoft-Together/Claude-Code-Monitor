// Logs curtos e sem conteúdo de conversas (nunca registre prompts, respostas ou segredos).

type Level = 'info' | 'warn' | 'error';

let quiet = false;

/** Silencia os logs (usado nos testes). */
export function setQuiet(q: boolean): void {
  quiet = q;
}

function write(level: Level, msg: string): void {
  if (quiet) return;
  const line = `[habblaud] ${msg}`;
  if (level === 'info') console.log(line);
  else if (level === 'warn') console.warn(line);
  else console.error(line);
}

/** Mensagem curta de erro (sem stack), segura para log. */
export function errMsg(err: unknown): string {
  if (err && typeof err === 'object') {
    const e = err as { code?: unknown; message?: unknown };
    if (typeof e.code === 'string') return e.code;
    if (typeof e.message === 'string') return e.message.slice(0, 160);
  }
  return String(err).slice(0, 160);
}

const once = new Set<string>();

export const log = {
  info: (msg: string) => write('info', msg),
  warn: (msg: string) => write('warn', msg),
  error: (msg: string) => write('error', msg),
  /** Registra só a primeira ocorrência de `key` (evita inundar o log no polling). */
  warnOnce: (key: string, msg: string) => {
    if (once.has(key)) return;
    once.add(key);
    write('warn', msg);
  },
  /** Permite que `key` volte a ser registrado (ex.: o problema foi resolvido). */
  clearOnce: (key: string) => void once.delete(key),
};
