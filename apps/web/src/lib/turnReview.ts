import type { Checkpoint } from './preview'

const splitLabel = (label: string): { kind: string; title: string } => {
  const i = label.indexOf(':')
  return i < 0 ? { kind: label, title: '' } : { kind: label.slice(0, i), title: label.slice(i + 1) }
}

/**
 * The `before:` / `after:` checkpoints of the turn `id` belongs to (list newest first). An `after:` pairs with the
 * nearest older `before:`; a `before:` with the nearest newer `after:` — no other `before:` in between.
 */
export function turnPair(list: readonly Checkpoint[], id: string): { before: Checkpoint; after: Checkpoint; title: string } | null {
  const i = list.findIndex((c) => c.id === id)
  const cp = list[i]
  if (!cp) return null
  const { kind, title } = splitLabel(cp.label)
  if (kind === 'after') {
    for (let j = i + 1; j < list.length; j++) {
      const k = splitLabel(list[j]!.label).kind
      if (k === 'before') return { before: list[j]!, after: cp, title }
      if (k === 'after') return null
    }
  } else if (kind === 'before') {
    for (let j = i - 1; j >= 0; j--) {
      const k = splitLabel(list[j]!.label).kind
      if (k === 'after') return { before: cp, after: list[j]!, title: splitLabel(list[j]!.label).title || title }
      if (k === 'before') return null
    }
  }
  return null
}
