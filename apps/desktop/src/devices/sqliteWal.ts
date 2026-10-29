const WAL_HEADER = 32
const FRAME_HEADER = 24

function checksum(buf: Buffer, start: number, end: number, big: boolean, s: [number, number]): [number, number] {
  let [s0, s1] = s
  for (let i = start; i < end; i += 8) {
    const a = big ? buf.readUInt32BE(i) : buf.readUInt32LE(i)
    const b = big ? buf.readUInt32BE(i + 4) : buf.readUInt32LE(i + 4)
    s0 = (s0 + a + s1) >>> 0
    s1 = (s1 + b + s0) >>> 0
  }
  return [s0, s1]
}

export interface WalApplied {
  db: Buffer
  /** Frames copied into the database (committed transactions only). */
  frames: number
  /** A frame with this WAL's salts failed its checksum: what came after it was left out. */
  partial: boolean
}

/**
 * sql.js reads one in-memory file and cannot open a WAL, so the committed frames of `-wal` are copied into the
 * pulled database, the way a checkpoint would (salts + checksum chain checked, only up to the last commit frame).
 * The header is then switched to the rollback journal (bytes 18–19 = 1) so the copy opens without a WAL.
 */
export function applyWal(db: Buffer, wal: Buffer | null): WalApplied {
  let out = Buffer.from(db)
  let frames = 0
  let partial = false
  if (wal && wal.length >= WAL_HEADER) {
    const magic = wal.readUInt32BE(0)
    const pageSize = wal.readUInt32BE(8)
    const validSize = pageSize >= 512 && pageSize <= 65536 && (pageSize & (pageSize - 1)) === 0
    if ((magic === 0x377f0682 || magic === 0x377f0683) && validSize) {
      const big = magic === 0x377f0683
      let sum = checksum(wal, 0, 24, big, [0, 0])
      if (sum[0] === wal.readUInt32BE(24) && sum[1] === wal.readUInt32BE(28)) {
        const salt1 = wal.readUInt32BE(16)
        const salt2 = wal.readUInt32BE(20)
        const pages = new Map<number, number>()
        let pending: [number, number][] = []
        let dbPages = 0
        for (let at = WAL_HEADER; at + FRAME_HEADER + pageSize <= wal.length; at += FRAME_HEADER + pageSize) {
          if (wal.readUInt32BE(at + 8) !== salt1 || wal.readUInt32BE(at + 12) !== salt2) break
          sum = checksum(wal, at, at + 8, big, sum)
          sum = checksum(wal, at + FRAME_HEADER, at + FRAME_HEADER + pageSize, big, sum)
          if (sum[0] !== wal.readUInt32BE(at + 16) || sum[1] !== wal.readUInt32BE(at + 20)) {
            partial = true
            break
          }
          const pgno = wal.readUInt32BE(at)
          pending.push([pgno, at + FRAME_HEADER])
          const commit = wal.readUInt32BE(at + 4)
          if (commit) {
            for (const [p, off] of pending) pages.set(p, off)
            frames += pending.length
            pending = []
            dbPages = commit
          }
        }
        if (dbPages) {
          const next = Buffer.alloc(dbPages * pageSize)
          out.copy(next, 0, 0, Math.min(out.length, next.length))
          for (const [p, off] of pages) if (p >= 1 && p <= dbPages) wal.copy(next, (p - 1) * pageSize, off, off + pageSize)
          out = next
        }
      }
    }
  }
  if (out.length >= 100 && out.toString('latin1', 0, 16) === 'SQLite format 3\0') {
    out[18] = 1
    out[19] = 1
  }
  return { db: out, frames, partial }
}

export const isSqlite = (b: Buffer): boolean => b.length >= 100 && b.toString('latin1', 0, 16) === 'SQLite format 3\0'
