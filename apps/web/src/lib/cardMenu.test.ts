import { describe, expect, it } from 'vitest'
import { cardActionOf, cardMenu, type CardMenuState } from './cardMenu'
import { isSeparator, type MenuEntry } from './menu'

const t = (key: string, args?: Record<string, unknown>) => (args ? `${key}:${JSON.stringify(args)}` : key)
const base: CardMenuState = {
  ended: false,
  codex: false,
  pinned: false,
  starred: false,
  hasCwd: true,
  hasNote: false,
  hasAlias: false,
  waiting: false,
  snoozed: false,
  snoozeChoices: [15, 60],
  info: [],
  originalTitle: 'orig',
  title: 'T',
}
const ids = (es: MenuEntry[]) => es.filter((e) => !isSeparator(e)).map((e) => (e as { id: string }).id)

describe('cardMenu', () => {
  it('offers every action the hover buttons had', () => {
    const { head, tail } = cardMenu(base, t, ['explorer', 'vscode'])
    expect(ids(head)).toEqual(['card:rename', 'card:note', 'card:pin', 'card:star', 'card:open:explorer', 'card:open:vscode'])
    expect(tail).toEqual([])
  })

  it('adds snooze choices for a waiting session and "remind now" once snoozed', () => {
    const wait = cardMenu({ ...base, waiting: true }, t, []).head.find((e) => !isSeparator(e) && e.id === 'card:snooze')
    expect(wait && !isSeparator(wait) && wait.children?.map((c) => !isSeparator(c) && c.id)).toEqual(['card:snooze:15', 'card:snooze:60'])
    expect(ids(cardMenu({ ...base, waiting: true, snoozed: true }, t, []).head)).toContain('card:unsnooze')
  })

  it('an ended session can be dismissed but not pinned or snoozed', () => {
    const { head, tail } = cardMenu({ ...base, ended: true, waiting: true }, t, [])
    expect(ids(head)).not.toContain('card:pin')
    expect(ids(head)).not.toContain('card:snooze')
    expect(ids(tail)).toEqual(['card:dismiss'])
  })

  it('a Codex run has no rename, note or star', () => {
    expect(ids(cardMenu({ ...base, codex: true }, t, []).head)).toEqual(['card:pin'])
  })

  it('lists info lines as disabled rows', () => {
    const { head } = cardMenu({ ...base, info: [{ kind: 'usage', label: 'RAM 50 MB' }] }, t, [])
    const row = head.find((e) => !isSeparator(e) && e.id === 'card:info-usage')
    expect(row && !isSeparator(row) && row.disabled).toBe(true)
  })

  it('parses card action ids', () => {
    expect(cardActionOf('card:open:vscode')).toBe('open:vscode')
    expect(cardActionOf('copy-name')).toBeNull()
  })
})
