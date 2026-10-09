import { badgeCount, parseToastMessage } from '@ccm/shared'

export interface Dock {
  setBadge(text: string): void
  bounce(type: 'critical'): number
  cancelBounce(id: number): void
}

export interface Attention {
  handle(data: unknown): void
  settle(): void
  clear(): void
}

export function createAttention(dock: Dock): Attention {
  const shown = new Map<string, { persistent: boolean }>()
  const bounces: number[] = []

  const refreshBadge = (): void => {
    const count = badgeCount(shown.values())
    dock.setBadge(count > 0 ? String(count) : '')
  }
  const cancelBounces = (): void => {
    for (const id of bounces.splice(0)) dock.cancelBounce(id)
  }

  return {
    handle(data) {
      const msg = parseToastMessage(data)
      if (!msg) return
      if (msg.type === 'toast.show') {
        if (!shown.has(msg.tag)) bounces.push(dock.bounce('critical'))
        shown.set(msg.tag, { persistent: msg.persistent })
      } else {
        shown.delete(msg.tag)
      }
      refreshBadge()
    },
    settle() {
      cancelBounces()
      for (const [tag, entry] of shown) if (!entry.persistent) shown.delete(tag)
    },
    clear() {
      cancelBounces()
      shown.clear()
      dock.setBadge('')
    },
  }
}
