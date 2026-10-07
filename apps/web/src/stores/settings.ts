import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import { i18n, initialLocale, type Locale } from '../i18n'

export type Theme = 'light' | 'dark'
export type Palette = 'ember' | 'cobalt'
export type NotifyPermission = NotificationPermission | 'unsupported'

function initialTheme(): Theme {
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light'
}

function initialPalette(): Palette {
  return document.documentElement.dataset.palette === 'cobalt' ? 'cobalt' : 'ember'
}

function read(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function persist(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    return
  }
}

export const STUCK_CHOICES = [0, 5, 10, 15, 30]
export const ACTIVITY_PAGE_SIZES = [50, 100, 200, 500]

function readPinned(): Set<string> {
  try {
    const list: unknown = JSON.parse(read('ccm.pinned') ?? '[]')
    return new Set(Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string').slice(0, 100) : [])
  } catch {
    return new Set()
  }
}

function permissionNow(): NotifyPermission {
  return typeof Notification === 'undefined' ? 'unsupported' : Notification.permission
}

export const useSettingsStore = defineStore('settings', () => {
  const theme = ref<Theme>(initialTheme())
  const palette = ref<Palette>(initialPalette())
  const locale = ref<Locale>(initialLocale())
  const hideFinished = ref(read('ccm.hideFinished') === '1')
  const notifyEnabled = ref(read('ccm.notify') === '1' && permissionNow() === 'granted')
  const notifyWaiting = ref(read('ccm.notify.waiting') !== '0')
  const notifyDone = ref(read('ccm.notify.done') !== '0')
  const notifyContext = ref(read('ccm.notify.context') !== '0')
  const notifyStuck = ref(read('ccm.notify.stuck') !== '0')
  const notifyLimit = ref(read('ccm.notify.limit') !== '0')
  const notifyLoop = ref(read('ccm.notify.loop') !== '0')
  const notifyPermission = ref<NotifyPermission>(permissionNow())
  const sound = ref(read('ccm.sound') === '1')
  const stuckMinutes = ref(STUCK_CHOICES.includes(Number(read('ccm.stuckMin'))) ? Number(read('ccm.stuckMin')) : 10)
  const hideTools = ref(read('ccm.hideTools') === '1')
  const breakReminder = ref(read('ccm.breakReminder') !== '0')
  const pinned = ref<Set<string>>(readPinned())
  const budgetRaw = Number(read('ccm.budget'))
  /** Daily spend budget in USD at API list prices; 0 = off. */
  const dailyBudget = ref(Number.isFinite(budgetRaw) && budgetRaw > 0 ? budgetRaw : 0)
  const activityPageSize = ref(ACTIVITY_PAGE_SIZES.includes(Number(read('ccm.activityPage'))) ? Number(read('ccm.activityPage')) : 50)

  watch(hideFinished, (value) => persist('ccm.hideFinished', value ? '1' : '0'))
  watch(notifyEnabled, (value) => persist('ccm.notify', value ? '1' : '0'))
  watch(notifyWaiting, (value) => persist('ccm.notify.waiting', value ? '1' : '0'))
  watch(notifyDone, (value) => persist('ccm.notify.done', value ? '1' : '0'))
  watch(notifyContext, (value) => persist('ccm.notify.context', value ? '1' : '0'))
  watch(notifyStuck, (value) => persist('ccm.notify.stuck', value ? '1' : '0'))
  watch(notifyLimit, (value) => persist('ccm.notify.limit', value ? '1' : '0'))
  watch(notifyLoop, (value) => persist('ccm.notify.loop', value ? '1' : '0'))
  watch(sound, (value) => persist('ccm.sound', value ? '1' : '0'))
  watch(stuckMinutes, (value) => persist('ccm.stuckMin', String(value)))
  watch(hideTools, (value) => persist('ccm.hideTools', value ? '1' : '0'))
  watch(breakReminder, (value) => persist('ccm.breakReminder', value ? '1' : '0'))
  watch(pinned, (value) => persist('ccm.pinned', JSON.stringify([...value])))
  watch(activityPageSize, (value) => persist('ccm.activityPage', String(value)))
  watch(dailyBudget, (value) => persist('ccm.budget', String(value)))

  watch(
    theme,
    (value) => {
      document.documentElement.classList.toggle('dark', value === 'dark')
      persist('ccm.theme', value)
    },
    { flush: 'sync' },
  )

  watch(
    palette,
    (value) => {
      document.documentElement.dataset.palette = value
      persist('ccm.palette', value)
    },
    { flush: 'sync' },
  )

  watch(
    locale,
    (value) => {
      i18n.global.locale.value = value
      document.documentElement.lang = value
      persist('ccm.locale', value)
    },
    { immediate: true },
  )

  function toggleTheme(): void {
    theme.value = theme.value === 'dark' ? 'light' : 'dark'
  }

  function setPalette(value: Palette): void {
    palette.value = value
  }

  function toggleLocale(): void {
    locale.value = locale.value === 'en' ? 'vi' : 'en'
  }

  function toggleHideFinished(): void {
    hideFinished.value = !hideFinished.value
  }

  function togglePin(terminalId: string): void {
    const next = new Set(pinned.value)
    if (!next.delete(terminalId)) next.add(terminalId)
    pinned.value = next
  }

  /** Drops pins of sessions that no longer exist (ids are per process, so they never come back). */
  function prunePins(existing: Iterable<string>): void {
    const keep = new Set(existing)
    const next = new Set([...pinned.value].filter((id) => keep.has(id)))
    if (next.size !== pinned.value.size) pinned.value = next
  }

  /** Must run from a click: browsers only show the permission prompt on a user gesture. */
  async function toggleNotifications(): Promise<void> {
    if (notifyEnabled.value) {
      notifyEnabled.value = false
      return
    }
    if (typeof Notification === 'undefined') return
    if (Notification.permission === 'default') {
      try {
        await Notification.requestPermission()
      } catch {
        // Older engines throw instead of resolving; permission stays as is.
      }
    }
    notifyPermission.value = permissionNow()
    notifyEnabled.value = notifyPermission.value === 'granted'
  }

  return {
    theme,
    palette,
    locale,
    hideFinished,
    notifyEnabled,
    notifyWaiting,
    notifyDone,
    notifyContext,
    notifyStuck,
    notifyLimit,
    notifyLoop,
    notifyPermission,
    sound,
    stuckMinutes,
    breakReminder,
    hideTools,
    pinned,
    activityPageSize,
    dailyBudget,
    togglePin,
    prunePins,
    toggleTheme,
    setPalette,
    toggleLocale,
    toggleHideFinished,
    toggleNotifications,
  }
})
