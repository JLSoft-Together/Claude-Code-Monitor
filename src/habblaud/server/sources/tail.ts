// Leitura incremental de arquivos append-only (JSONL): devolve só as linhas completas novas,
// guarda a linha parcial para o próximo ciclo (até MAX_LINE_BYTES) e detecta truncamento/rotação.
import { closeSync, fstatSync, openSync, readSync, statSync } from 'node:fs';
import { log } from '../log';
import { tr } from '../../shared/i18n';

export interface TailRead {
  lines: string[];
  /** O arquivo foi truncado ou substituído: a leitura recomeçou do início. */
  reset: boolean;
  /** O arquivo não existe (ainda ou mais). */
  missing: boolean;
  /** Ainda há bytes não lidos (o limite por leitura foi atingido). */
  more: boolean;
}

const NL = 0x0a;
/** Quanto do começo do arquivo guardar para confirmar uma troca que só o birthtime aponta (ver `replaced`). */
const HEAD_BYTES = 256;
/**
 * Teto de uma linha JSONL. Em conversas reais do Claude Code e do Codex a maior linha ficou
 * em 5,8 MiB (tool_result grande, que precisa ser lido inteiro para virar atividade). 8 MiB
 * cobre isso com folga; acima, a linha é descartada até o `\n`.
 */
export const MAX_LINE_BYTES = 8 * 1024 * 1024;

/** Avisa uma vez por arquivo que uma linha passou do teto e foi ignorada. Sem o conteúdo da linha. */
export function warnOversizedLine(path: string): void {
  const mb = MAX_LINE_BYTES / (1024 * 1024);
  log.warnOnce(`oversize-line:${path}`, tr('Linha com mais de {0} MiB em {1} foi ignorada até a próxima quebra.', [mb, path]));
}

/**
 * Linha incompleta em pedaços: só junta quando acha `\n`. Cada leitura copia só o pedaço novo;
 * acima de `max`, solta o acumulado e descarta até a próxima quebra.
 */
export class LineBuffer {
  private pieces: Buffer[] = [];
  private bytes = 0;
  private skipping = false;

  constructor(private readonly max = MAX_LINE_BYTES) {}

  reset(): void {
    this.pieces = [];
    this.bytes = 0;
    this.skipping = false;
  }

  /** Consome `chunk` e devolve as linhas fechadas, sem o `\n`. */
  push(chunk: Buffer): { lines: Buffer[]; discarded: number } {
    const lines: Buffer[] = [];
    let discarded = 0;
    let i = 0;
    while (i < chunk.length) {
      if (this.skipping) {
        const nl = chunk.indexOf(NL, i);
        if (nl === -1) return { lines, discarded };
        this.skipping = false;
        i = nl + 1;
        continue;
      }
      const nl = chunk.indexOf(NL, i);
      if (nl === -1) {
        const rest = chunk.length - i;
        if (rest > 0 && this.bytes + rest > this.max) {
          this.pieces = [];
          this.bytes = 0;
          this.skipping = true;
          discarded++;
        } else if (rest > 0) {
          this.pieces.push(Buffer.from(chunk.subarray(i)));
          this.bytes += rest;
        }
        return { lines, discarded };
      }
      const total = this.bytes + (nl - i);
      if (total > this.max) discarded++;
      else if (total > 0) lines.push(this.take(chunk.subarray(i, nl)));
      this.pieces = [];
      this.bytes = 0;
      i = nl + 1;
    }
    return { lines, discarded };
  }

  /** Resto sem `\n` no fim do arquivo; null se estiver vazio ou se a linha estourou o teto. */
  flush(): Buffer | null {
    if (this.skipping || this.bytes === 0) return null;
    const out = this.pieces.length === 1 ? this.pieces[0] : Buffer.concat(this.pieces);
    this.pieces = [];
    this.bytes = 0;
    return out;
  }

  private take(tail: Buffer): Buffer {
    if (this.pieces.length === 0) return tail;
    if (tail.length === 0) return this.pieces.length === 1 ? this.pieces[0] : Buffer.concat(this.pieces);
    return Buffer.concat([...this.pieces, tail]);
  }
}

/** Os primeiros `max` bytes do arquivo, numa leitura posicional (não mexe no offset da leitura incremental). */
function readHead(fd: number, max: number): Buffer {
  const buf = Buffer.alloc(max);
  return max > 0 ? buf.subarray(0, readSync(fd, buf, 0, max, 0)) : buf;
}

export class FileTail {
  /** Próximo byte a ler. */
  offset = 0;
  size = 0;
  mtimeMs = 0;
  /** Linha ainda sem `\n`. Acima de MAX_LINE_BYTES, o resto é descartado até a quebra. */
  private pending = new LineBuffer();
  private ino: number | undefined;
  /** Momento de criação do arquivo (0 quando o sistema de arquivos não informa). */
  private birthtimeMs = 0;
  /** Começo do arquivo (até HEAD_BYTES); null = ainda não lido. */
  private head: Buffer | null = null;
  private readonly maxChunk: number;

  constructor(
    readonly path: string,
    opts: { maxChunk?: number } = {},
  ) {
    this.maxChunk = opts.maxChunk ?? 8 * 1024 * 1024;
  }

  /**
   * Posiciona a leitura nos últimos `maxBytes` do arquivo, alinhada no início da linha seguinte
   * (a linha cortada é descartada). Devolve o offset escolhido (0 = arquivo inteiro).
   */
  seekTail(maxBytes: number): number {
    this.pending.reset();
    let fd: number;
    try {
      fd = openSync(this.path, 'r');
    } catch {
      this.offset = 0;
      return 0;
    }
    try {
      const st = fstatSync(fd);
      this.ino = st.ino;
      this.birthtimeMs = st.birthtimeMs;
      this.size = st.size;
      this.mtimeMs = st.mtimeMs;
      this.head = readHead(fd, Math.min(st.size, HEAD_BYTES));
      if (st.size <= maxBytes) {
        this.offset = 0;
        return 0;
      }
      // Procura a primeira quebra de linha a partir de (início da janela - 1).
      let pos = st.size - maxBytes - 1;
      const buf = Buffer.allocUnsafe(64 * 1024);
      while (pos < st.size) {
        const n = readSync(fd, buf, 0, buf.length, pos);
        if (n <= 0) break;
        const i = buf.subarray(0, n).indexOf(NL);
        if (i !== -1) {
          this.offset = pos + i + 1;
          return this.offset;
        }
        pos += n;
      }
      this.offset = st.size;
      return this.offset;
    } finally {
      closeSync(fd);
    }
  }

  /** Posiciona no fim do arquivo (só o que for escrito daqui em diante será lido). */
  seekEnd(): void {
    this.pending.reset();
    this.head = null;
    try {
      const st = statSync(this.path);
      this.ino = st.ino;
      this.birthtimeMs = st.birthtimeMs;
      this.size = st.size;
      this.mtimeMs = st.mtimeMs;
      this.offset = st.size;
    } catch {
      this.offset = 0;
    }
  }

  /**
   * O arquivo foi trocado por outro? O inode diferente basta, mas o sistema de arquivos pode reaproveitar o
   * número de um arquivo apagado (ext4): por isso, quando os dois lados informam o momento de criação, ele também
   * conta. Só que no Linux sem statx (WSL1, seccomp antigo) o Node devolve o ctime no lugar dele, e o ctime muda a
   * cada escrita: a mudança do birthtime só vale se o começo do arquivo também mudou. Um arquivo novo que comece com
   * os mesmos bytes passa como o mesmo, como antes de o birthtime contar.
   * O mesmo vale para o mtime: reescrever o arquivo no mesmo inode (`writeFileSync` sobre ele) não muda o inode nem o
   * birthtime, e com o mesmo tamanho (ou maior) o `size < offset` também não pega. Acrescentar linhas muda o mtime
   * sem mexer no começo, então só uma mudança no começo conta como troca.
   */
  private replaced(fd: number, st: { ino: number; birthtimeMs: number; mtimeMs: number }): boolean {
    if (this.ino === undefined) return false;
    if (st.ino !== this.ino) return true;
    const born = this.birthtimeMs > 0 && st.birthtimeMs > 0 && st.birthtimeMs !== this.birthtimeMs;
    const written = st.mtimeMs !== this.mtimeMs;
    if (!born && !written) return false;
    return !!this.head && !readHead(fd, this.head.length).equals(this.head);
  }

  read(): TailRead {
    let fd: number;
    try {
      fd = openSync(this.path, 'r');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { lines: [], reset: false, missing: true, more: false };
      throw err;
    }
    try {
      const st = fstatSync(fd);
      let reset = false;
      if (this.replaced(fd, st) || st.size < this.offset) {
        this.offset = 0;
        this.pending.reset();
        this.head = null;
        reset = true;
      }
      this.ino = st.ino;
      this.birthtimeMs = st.birthtimeMs;
      this.size = st.size;
      this.mtimeMs = st.mtimeMs;
      // O começo só é relido enquanto o arquivo ainda não chegou a HEAD_BYTES.
      const headLen = Math.min(st.size, HEAD_BYTES);
      if (!this.head || this.head.length < headLen) this.head = readHead(fd, headLen);
      const avail = st.size - this.offset;
      if (avail <= 0) return { lines: [], reset, missing: false, more: false };
      const len = Math.min(avail, this.maxChunk);
      const chunk = Buffer.allocUnsafe(len);
      const n = readSync(fd, chunk, 0, len, this.offset);
      this.offset += n;
      const fed = this.pending.push(chunk.subarray(0, n));
      if (fed.discarded) warnOversizedLine(this.path);
      const lines: string[] = [];
      for (const buf of fed.lines) {
        const line = buf.toString('utf8').replace(/\r$/, '');
        if (line.trim()) lines.push(line);
      }
      return { lines, reset, missing: false, more: avail > len };
    } finally {
      closeSync(fd);
    }
  }
}
