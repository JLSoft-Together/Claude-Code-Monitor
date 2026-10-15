// Mission Control pane text: memory only, read on demand from mounted xterm buffers; never stored or sent over IPC.
const readers = new Map<string, (rows: number) => string[]>()

export function lastRows(lines: readonly string[], n: number): string {
  let end = lines.length
  while (end > 0 && !lines[end - 1]!.trim()) end--
  return lines.slice(Math.max(0, end - n), end).join('\n')
}

export function registerSnapshot(key: string, read: (rows: number) => string[]): () => void {
  readers.set(key, read)
  return () => {
    if (readers.get(key) === read) readers.delete(key)
  }
}

export function snapshotOf(key: string, rows: number): string {
  const read = readers.get(key)
  return read ? lastRows(read(rows), rows) : ''
}
