import { watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { breakAnchor, breakSlot, BREAK_MINUTES } from '../lib/breaks'
import { now } from '../lib/format'
import { playChime } from '../lib/sound'
import { useExtrasStore } from '../stores/extras'
import { useSettingsStore } from '../stores/settings'
import { useUiStore } from '../stores/ui'

const KEY = 'ccm.breakSeen'

function seen(anchor: number): number | null {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as { anchor?: number; slot?: number } | null
    return raw?.anchor === anchor && typeof raw.slot === 'number' ? raw.slot : null
  } catch {
    return null
  }
}

function markSeen(anchor: number, slot: number): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ anchor, slot }))
  } catch {
    return
  }
}

/** Every 45 minutes from the first collector start of the day: a stretch-and-drink reminder. */
export function useBreakReminder(): void {
  const { t } = useI18n()
  const extras = useExtrasStore()
  const settings = useSettingsStore()
  const ui = useUiStore()

  // Turning reminders back on starts counting from the current interval, not from the ones missed while off.
  watch(
    () => settings.breakReminder,
    (on) => {
      try {
        if (on) localStorage.removeItem(KEY)
      } catch {
        return
      }
    },
  )

  watch(now, (nowMs) => {
    if (!settings.breakReminder) return
    const anchor = breakAnchor(extras.dayStartedAt, nowMs)
    if (anchor === null) return
    const slot = breakSlot(anchor, nowMs)
    const last = seen(anchor)
    // Opening the page mid-interval must not replay reminders that came due while it was closed.
    if (last === null) return markSeen(anchor, slot)
    if (slot <= last) return
    // Shared through localStorage, so only the first open tab reminds.
    markSeen(anchor, slot)
    ui.breakDue = { at: nowMs, minutes: Math.round((nowMs - anchor) / 60_000) }
    if (settings.sound) playChime('waiting')
    if (!settings.notifyEnabled || (document.visibilityState === 'visible' && document.hasFocus())) return
    try {
      new Notification(t('breaks.title'), { body: t('breaks.body', { n: BREAK_MINUTES }), tag: 'ccm-break', icon: '/favicon.svg' })
    } catch {
      return
    }
  })
}
