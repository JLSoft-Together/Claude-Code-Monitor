import type { AppDbCell, AppDbTable, PrefEntry } from '@ccm/shared'

export const ROWS_PAGE = 200

/** Prompt text for the agent: the CREATE statement only, never row data. */
export function schemaPrompt(pkg: string, db: string, table: AppDbTable): string {
  const kind = table.type === 'view' ? 'view' : 'table'
  return `SQLite ${kind} \`${table.name}\` in \`${db}\` of ${pkg}:\n\n\`\`\`sql\n${table.sql.trim()}\n\`\`\`\n`
}

export const isBlob = (c: AppDbCell): c is { blob: number } => typeof c === 'object' && c !== null

export function cellText(c: AppDbCell): string {
  if (c === null) return 'NULL'
  if (isBlob(c)) return `BLOB · ${c.blob} B`
  return String(c)
}

/** Edit field text of a value: one item per line for a string set. */
export const prefInput = (e: PrefEntry): string => (Array.isArray(e.value) ? e.value.join('\n') : e.value)

export function prefFromInput(e: PrefEntry, text: string): string | string[] {
  if (e.type !== 'set') return e.type === 'string' ? text : text.trim()
  const lines = text.split(/\r?\n/)
  while (lines.length && lines.at(-1) === '') lines.pop()
  return lines
}

/** Same check the desktop runs before writing, so the Save button can say no early. */
export function prefValid(type: PrefEntry['type'], v: string | string[]): boolean {
  if (Array.isArray(v)) return type === 'set'
  switch (type) {
    case 'boolean':
      return v === 'true' || v === 'false'
    case 'int':
      return /^-?\d{1,10}$/.test(v) && Number(v) >= -2147483648 && Number(v) <= 2147483647
    case 'long':
      return /^-?\d{1,19}$/.test(v) && BigInt(v) >= -(2n ** 63n) && BigInt(v) < 2n ** 63n
    case 'float':
      return /^-?(\d+(\.\d*)?|\.\d+)([eE][-+]?\d+)?$/.test(v) && Number.isFinite(Number(v))
    default:
      return type === 'string'
  }
}

export const prefShown = (v: string | string[]): string => (Array.isArray(v) ? v.join(', ') : v)

export const samePref = (a: string | string[], b: string | string[]): boolean =>
  Array.isArray(a) ? Array.isArray(b) && a.length === b.length && a.every((x, i) => x === b[i]) : a === b
