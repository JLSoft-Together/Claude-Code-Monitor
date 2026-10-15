import { open, stat } from 'node:fs/promises'

const NEWLINE = 0x0a
const CHUNK_BYTES = 1024 * 1024

/**
 * Decides per raw line before it is decoded: `undefined` parses it, `null` drops it, any other value stands in for
 * the parsed record. `end` is the byte offset just past the line, `size` the file size at the start of this read.
 */
export type LineFilter = (line: Buffer, end: number, size: number) => unknown

export class JsonlTailer {
  private offset = 0
  private remainder: Buffer = Buffer.alloc(0)
  private reading: Promise<void> | null = null

  constructor(
    readonly file: string,
    private readonly chunkBytes = CHUNK_BYTES,
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
    if (size < this.offset) {
      this.offset = 0
      this.remainder = Buffer.alloc(0)
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
    const data = this.remainder.length ? Buffer.concat([this.remainder, chunk]) : chunk
    let start = 0
    let idx: number
    while ((idx = data.indexOf(NEWLINE, start)) !== -1) {
      const raw = data.subarray(start, idx)
      start = idx + 1
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
    this.remainder = Buffer.from(data.subarray(start))
  }
}
