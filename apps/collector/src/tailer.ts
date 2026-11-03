import { open, stat } from 'node:fs/promises'

const NEWLINE = 0x0a
const CHUNK_BYTES = 1024 * 1024

/**
 * Decides per raw line before it is decoded: `undefined` parses it, `null` drops it, any other value stands in for
 * the parsed record. `end` is the byte offset just past the line, `size` the file size at the start of this read.
 */
export type LineFilter = (line: Buffer, end: number, size: number) => unknown

export interface TailOptions {
  /** First read starts this many bytes before the end; the partial line there is dropped. */
  fromEnd?: number
  /** A line longer than this is dropped whole instead of buffered. */
  maxLine?: number
}

export class JsonlTailer {
  private offset = 0
  private remainder: Buffer = Buffer.alloc(0)
  private reading: Promise<void> | null = null
  private started = false
  private skipping = false

  constructor(
    readonly file: string,
    private readonly chunkBytes = CHUNK_BYTES,
    private readonly options: TailOptions = {},
  ) {}

  async read(): Promise<unknown[]> {
    const records: unknown[] = []
    await this.readEach((r) => records.push(r))
    return records
  }

  /**
   * Hands each record over as soon as its line is complete: a large catch-up never holds the whole file's records,
   * and a filter sees the effect of every earlier line.
   */
  readEach(onRecord: (record: unknown) => void, filter?: LineFilter): Promise<void> {
    if (this.reading) return this.reading
    this.reading = this.readNew(onRecord, filter).finally(() => {
      this.reading = null
    })
    return this.reading
  }

  private async readNew(onRecord: (record: unknown) => void, filter?: LineFilter): Promise<void> {
    let size: number
    try {
      size = (await stat(this.file)).size
    } catch {
      return
    }
    if (!this.started) {
      this.started = true
      const from = this.options.fromEnd
      if (from !== undefined && size > from) {
        this.offset = size - from
        this.skipping = true
      }
    } else if (size < this.offset) {
      this.offset = 0
      this.remainder = Buffer.alloc(0)
      this.skipping = false
    }
    if (size === this.offset) return

    const chunk = Buffer.alloc(Math.min(size - this.offset, this.chunkBytes))
    const handle = await open(this.file, 'r')
    try {
      while (this.offset < size) {
        const { bytesRead } = await handle.read(chunk, 0, Math.min(size - this.offset, chunk.length), this.offset)
        if (bytesRead === 0) break
        const base = this.offset - this.remainder.length
        this.offset += bytesRead
        this.consume(chunk.subarray(0, bytesRead), base, size, onRecord, filter)
      }
    } finally {
      await handle.close()
    }
  }

  private consume(chunk: Buffer, base: number, size: number, onRecord: (record: unknown) => void, filter?: LineFilter): void {
    let start = 0
    if (this.skipping) {
      const nl = chunk.indexOf(NEWLINE)
      if (nl === -1) return
      this.skipping = false
      start = nl + 1
    }
    const data = this.remainder.length ? Buffer.concat([this.remainder, chunk]) : chunk
    const maxLine = this.options.maxLine ?? Number.POSITIVE_INFINITY
    let idx: number
    while ((idx = data.indexOf(NEWLINE, start)) !== -1) {
      const raw = data.subarray(start, idx)
      start = idx + 1
      if (raw.length > maxLine) continue
      if (filter) {
        const verdict = filter(raw, base + start, size)
        if (verdict === null) continue
        if (verdict !== undefined) {
          onRecord(verdict)
          continue
        }
      }
      const line = raw.toString('utf8').trim()
      if (!line) continue
      let record: unknown
      try {
        record = JSON.parse(line)
      } catch {
        continue
      }
      onRecord(record)
    }
    const rest = data.subarray(start)
    if (rest.length > maxLine) {
      this.remainder = Buffer.alloc(0)
      this.skipping = true
    } else {
      this.remainder = Buffer.from(rest)
    }
  }
}
