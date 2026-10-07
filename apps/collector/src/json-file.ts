import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'

/** Small JSON state file: debounced atomic writes (tmp + rename), read errors mean "no state". */
export class JsonFile {
  private timer: NodeJS.Timeout | null = null
  private pending: (() => unknown) | null = null
  /** Writes share one tmp file, so they run one after another. */
  private writing: Promise<void> = Promise.resolve()

  constructor(
    private readonly file: string,
    private readonly delayMs: number,
  ) {}

  async read(): Promise<unknown> {
    try {
      return JSON.parse(await readFile(this.file, 'utf8'))
    } catch {
      return null
    }
  }

  schedule(serialize: () => unknown): void {
    this.pending = serialize
    if (this.timer) return
    this.timer = setTimeout(() => {
      this.timer = null
      void this.flush()
    }, this.delayMs)
    this.timer.unref?.()
  }

  flush(serialize?: () => unknown): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    const source = serialize ?? this.pending
    this.pending = null
    if (!source) return this.writing
    this.writing = this.writing.then(() => this.write(source))
    return this.writing
  }

  private async write(source: () => unknown): Promise<void> {
    try {
      await mkdir(path.dirname(this.file), { recursive: true })
      const tmp = `${this.file}.tmp`
      await writeFile(tmp, JSON.stringify(source()))
      await rename(tmp, this.file)
    } catch (err) {
      console.warn(`[collector] cannot save ${path.basename(this.file)}:`, (err as Error).message)
    }
  }
}
