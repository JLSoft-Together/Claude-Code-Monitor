export type PlanState = 'todo' | 'done' | 'partial'

export interface PlanItem {
  /** 1-based line in the file as read. */
  line: number
  /** Nesting level among the file's checklist items (0 = top). */
  depth: number
  state: PlanState
  text: string
}

export interface PlanFile {
  path: string
  name: string
  mtimeMs: number
  items: PlanItem[]
}

export const PLAN_FILE = /^(?:PLAN|PROGRESS|SPEC|TODO)-.*\.md$/i
export const PLAN_MAX_FILES = 80

const ITEM = /^([ \t]*)(?:[-*+]|\d+[.)])[ \t]+\[([ xX~])\][ \t]+(.*)$/
const FENCE = /^[ \t]*(```|~~~)/

const stateOf = (mark: string): PlanState => (mark === ' ' ? 'todo' : mark === '~' ? 'partial' : 'done')

const columns = (indent: string): number => [...indent].reduce((n, c) => n + (c === '\t' ? 4 - (n % 4) : 1), 0)

export function splitLines(text: string): string[] {
  return text.split(/\r\n|\n|\r/)
}

export function parsePlanItems(text: string): PlanItem[] {
  const items: PlanItem[] = []
  const stack: number[] = []
  let fence: string | null = null
  splitLines(text).forEach((raw, i) => {
    const f = FENCE.exec(raw)
    if (f) {
      if (!fence) fence = f[1]!
      else if (fence === f[1]) fence = null
      return
    }
    if (fence) return
    const m = ITEM.exec(raw)
    if (!m) return
    const col = columns(m[1]!)
    while (stack.length && stack[stack.length - 1]! >= col) stack.pop()
    items.push({ line: i + 1, depth: stack.length, state: stateOf(m[2]!), text: m[3]!.trim() })
    stack.push(col)
  })
  return items
}

export const nextState = (state: PlanState): PlanState => (state === 'done' ? 'todo' : 'done')

/**
 * Flips the box on `item.line` (`[ ]` ↔ `[x]`, `[~]` → `[x]`) keeping every other byte, line breaks included.
 * Null when that line is no longer the same item (the file changed under the board).
 */
export function toggleItem(text: string, item: Pick<PlanItem, 'line' | 'text' | 'state'>): string | null {
  const parts = text.split(/(\r\n|\n|\r)/)
  const at = (item.line - 1) * 2
  const raw = parts[at]
  if (raw === undefined) return null
  const m = ITEM.exec(raw)
  if (!m || m[3]!.trim() !== item.text || stateOf(m[2]!) !== item.state) return null
  const mark = nextState(item.state) === 'done' ? 'x' : ' '
  const open = raw.indexOf('[', m[1]!.length)
  parts[at] = raw.slice(0, open + 1) + mark + raw.slice(open + 2)
  return parts.join('')
}

export const pendingItems = (items: readonly PlanItem[]): PlanItem[] => items.filter((x) => x.state !== 'done')

export function planCounts(items: readonly PlanItem[]): { done: number; total: number } {
  return { done: items.filter((x) => x.state === 'done').length, total: items.length }
}

export const sortPlanFiles = (files: readonly PlanFile[]): PlanFile[] => [...files].sort((a, b) => b.mtimeMs - a.mtimeMs || a.name.localeCompare(b.name))
