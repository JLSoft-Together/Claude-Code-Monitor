const SQL_MAX = 20_000
// No 'replace': it is also a string function; REPLACE INTO is still stopped by query_only.
const WRITES =new Set(['insert', 'update', 'delete', 'create', 'drop', 'alter', 'attach', 'detach', 'vacuum', 'reindex', 'analyze', 'begin', 'commit', 'rollback', 'savepoint', 'release', 'upsert'])

/** Keywords outside string literals, quoted identifiers and comments, lower-cased; null on an unterminated quote / comment. */
export function sqlWords(sql: string): { words: string[]; semis: number[] } | null {
  const words: string[] = []
  const semis: number[] = []
  let i = 0
  while (i < sql.length) {
    const c = sql[i]!
    if (c === "'" || c === '"' || c === '`' || c === '[') {
      const close = c === '[' ? ']' : c
      let j = i + 1
      for (;;) {
        j = sql.indexOf(close, j)
        if (j < 0) return null
        if (close !== ']' && sql[j + 1] === close) j += 2
        else break
      }
      i = j + 1
    } else if (c === '-' && sql[i + 1] === '-') {
      const nl = sql.indexOf('\n', i)
      i = nl < 0 ? sql.length : nl + 1
    } else if (c === '/' && sql[i + 1] === '*') {
      const end = sql.indexOf('*/', i + 2)
      if (end < 0) return null
      i = end + 2
    } else if (c === ';') {
      semis.push(words.length)
      i++
    } else if (/[A-Za-z_]/.test(c)) {
      const m = /^[A-Za-z_][A-Za-z0-9_$]*/.exec(sql.slice(i, i + 128))!
      words.push(m[0].toLowerCase())
      i += m[0].length
    } else i++
  }
  return { words, semis }
}

/**
 * Manual queries: one SELECT, WITH … SELECT, EXPLAIN of those, or a PRAGMA without `=`. The copy is opened with
 * `query_only` too; this check gives a clear message instead of a SQLite error.
 */
export function checkReadOnlySql(raw: unknown): { ok: true; sql: string } | { ok: false; reason: 'empty' | 'too-long' | 'multiple' | 'not-read' | 'syntax' } {
  if (typeof raw !== 'string') return { ok: false, reason: 'empty' }
  const sql = raw.trim()
  if (!sql) return { ok: false, reason: 'empty' }
  if (sql.length > SQL_MAX) return { ok: false, reason: 'too-long' }
  const scan = sqlWords(sql)
  if (!scan) return { ok: false, reason: 'syntax' }
  const { words, semis } = scan
  if (!words.length) return { ok: false, reason: 'empty' }
  if (semis.some((at) => at < words.length)) return { ok: false, reason: 'multiple' }
  let first = words[0]!
  let rest = words
  if (first === 'explain') {
    rest = words[1] === 'query' && words[2] === 'plan' ? words.slice(3) : words.slice(1)
    first = rest[0] ?? ''
  }
  if (first === 'pragma') return /=/.test(sql.replace(/'[^']*'/g, '')) ? { ok: false, reason: 'not-read' } : { ok: true, sql }
  if (first !== 'select' && first !== 'with' && first !== 'values') return { ok: false, reason: 'not-read' }
  if (rest.some((w) => WRITES.has(w))) return { ok: false, reason: 'not-read' }
  return { ok: true, sql }
}

/** `"name"` with inner quotes doubled. */
export const quoteIdent = (name: string): string => `"${name.replace(/"/g, '""')}"`
