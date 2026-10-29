export type StringKind = 'string' | 'plurals' | 'array'
/** Why a cell is shown but cannot be edited here. */
export type NotEditable = 'markup' | 'plurals' | 'array' | 'not-string'

export interface StringEntry {
  key: string
  kind: StringKind
  /** Display text (escapes decoded); plurals / arrays = items joined by newlines. */
  value: string
  items?: { label: string; value: string }[]
  line: number
  editable: boolean
  why?: NotEditable
  /** Android `translatable="false"`. */
  fixed?: boolean
}

/** Why a whole file is read only. */
export type ReadOnlyReason = 'doctype' | 'structure' | 'duplicate' | 'invalid'

export interface StringsDoc {
  entries: Map<string, StringEntry>
  order: string[]
  writable: boolean
  reason?: ReadOnlyReason
}

export type WriteResult = { ok: true; text: string } | { ok: false; error: 'read-only' | 'not-editable' | 'verify' }
