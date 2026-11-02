import { BellOff, BellRing, Code, Cpu, FolderOpen, Pencil, Pin, PinOff, RotateCcw, Snowflake, StickyNote, Star, Trash2 } from 'lucide-vue-next'
import type { OpenApp } from '@ccm/shared'
import { openAppKey } from './platform'
import type { MenuEntry } from './menu'

export const CARD_ACTION = 'card:'

export type CardAction =
  | 'rename'
  | 'reset-name'
  | 'note'
  | 'pin'
  | 'star'
  | 'dismiss'
  | 'unsnooze'
  | `open:${OpenApp}`
  | `snooze:${number}`

export interface CardMenuState {
  ended: boolean
  codex: boolean
  pinned: boolean
  starred: boolean
  hasCwd: boolean
  hasNote: boolean
  hasAlias: boolean
  /** Waiting sessions can be snoozed; `snoozed` swaps the choices for "Remind now". */
  waiting: boolean
  snoozed: boolean
  snoozeChoices: readonly number[]
  /** Read-only lines for what no longer sits on the card (RAM / CPU, warm cache). */
  info: readonly { kind: 'usage' | 'cache'; label: string }[]
  originalTitle: string
  title: string
}

type T = (key: string, args?: Record<string, unknown>) => string

export function cardActionOf(id: string): CardAction | null {
  return id.startsWith(CARD_ACTION) ? (id.slice(CARD_ACTION.length) as CardAction) : null
}

const act = (a: CardAction): string => `${CARD_ACTION}${a}`

/** Entries the dashboard card adds around the shared node menu: what used to be hover buttons and signal lines. */
export function cardMenu(s: CardMenuState, t: T, openApps: readonly OpenApp[]): { head: MenuEntry[]; tail: MenuEntry[] } {
  const head: MenuEntry[] = []
  if (!s.codex) {
    head.push({ id: act('rename'), label: t('terminal.rename'), icon: Pencil })
    if (s.hasAlias) head.push({ id: act('reset-name'), label: t('terminal.renameReset', { title: s.originalTitle }), icon: RotateCcw })
    head.push({ id: act('note'), label: t(s.hasNote ? 'terminal.noteEdit' : 'terminal.noteAdd'), icon: StickyNote })
  }
  if (!s.ended) head.push({ id: act('pin'), label: t(s.pinned ? 'terminal.unpin' : 'terminal.pin'), icon: s.pinned ? PinOff : Pin })
  if (s.hasCwd && !s.codex) head.push({ id: act('star'), label: t(s.starred ? 'favorites.unstar' : 'favorites.star'), icon: Star })
  if (s.hasCwd) for (const app of openApps) head.push({ id: act(`open:${app}`), label: t('open.title', { app: t(`open.app.${openAppKey(app)}`) }), icon: app === 'vscode' ? Code : FolderOpen })
  if (s.waiting && !s.ended) {
    if (s.snoozed) head.push({ id: act('unsnooze'), label: t('snooze.undo'), icon: BellRing })
    else
      head.push({
        id: 'card:snooze',
        label: t('snooze.label'),
        icon: BellOff,
        children: s.snoozeChoices.map((n) => ({ id: act(`snooze:${n}`), label: t('snooze.minutes', { n }) })),
      })
  }
  if (s.info.length) {
    head.push({ separator: true })
    for (const i of s.info) head.push({ id: `card:info-${i.kind}`, label: i.label, icon: i.kind === 'usage' ? Cpu : Snowflake, disabled: true })
  }
  const tail: MenuEntry[] = s.ended ? [{ separator: true }, { id: act('dismiss'), label: t('terminal.dismiss', { title: s.title }), icon: Trash2 }] : []
  return { head, tail }
}
