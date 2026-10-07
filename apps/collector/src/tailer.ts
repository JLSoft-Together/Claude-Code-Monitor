import { open, stat } from 'node:fs/promises'

const NEWLINE = 0x0a

export class JsonlTailer {
  private offset = 0
  private remainder: Buffer = Buffer.alloc(0)
  private reading: Promise<unknown[]> | null = null

  constructor(readonly file: string) {}

  read(): Promise<unknown[]> {
    if (!this.reading) {
      this.reading = this.readNew().finally(() => {
        this.reading = null
      })
    }
    return this.reading
  }

  private async readNew(): Promise<unknown[]> {
    let size: number
    try {
      size = (await stat(this.file)).size
    } catch {
      return []
    }
    if (size < this.offset) {
      this.offset = 0
      this.remainder = Buffer.alloc(0)
    }
    if (size === this.offset) return []

    const length = size - this.offset
    const chunk = Buffer.alloc(length)
    const handle = await open(this.file, 'r')
    try {
      const { bytesRead } = await handle.read(chunk, 0, length, this.offset)
      this.offset += bytesRead
      return this.consume(chunk.subarray(0, bytesRead))
    } finally {
      await handle.close()
    }
  }

  private consume(chunk: Buffer): unknown[] {
    const data = this.remainder.length ? Buffer.concat([this.remainder, chunk]) : chunk
    const records: unknown[] = []
    let start = 0
    let idx: number
    while ((idx = data.indexOf(NEWLINE, start)) !== -1) {
      const line = data.subarray(start, idx).toString('utf8').trim()
      start = idx + 1
      if (!line) continue
      try {
        records.push(JSON.parse(line))
      } catch {
        continue
      }
    }
    this.remainder = Buffer.from(data.subarray(start))
    return records
  }
}
