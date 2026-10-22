import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import { STUCK_CHOICES } from '@ccm/shared'
import { i18n, initialLocale, type Locale } from '../i18n'
import { readLook } from '../lib/appearance'
import { AUTO_SAVE_DELAY_DEFAULT, AUTO_SAVE_DELAYS, isAutoSaveMode, type AutoSaveMode } from '../lib/autoSave'
import { desktop } from '../lib/desktop'
import { setDustEnabled } from '../lib/dust'
import { clampCodeSize, CODE_SIZE_DEFAULT, fontEntry, fontStack, isFontId } from '../lib/fonts'
import { applyTheme, isThemeId, themeMeta, toggleTarget, type ThemeId } from '../lib/themes'

export type Theme = ThemeId
export type NotifyPermission = NotificationPermission | 'unsupported'

// index.html already applied the stored theme before paint; read it back from the root.
function initialTheme(): Theme {
  const root = document.documentElement
  const id = root.dataset.theme
  return isThemeId(id) ? id : root.classList.contains('dark') ? 'dark' : 'light'
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

export { STUCK_CHOICES }

/** Explorer tree icons: Atom Material (v59) or the lucide glyphs from before. */
export type FileIconStyle = 'atom' | 'simple'
const isFileIconStyle = (value: unknown): value is FileIconStyle => value === 'atom' || value === 'simple'
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
  const stuckMinutes = ref((STUCK_CHOICES as readonly number[]).includes(Number(read('ccm.stuckMin'))) ? Number(read('ccm.stuckMin')) : 10)
  const hideTools = ref(read('ccm.hideTools') === '1')
  const keyHints = ref(read('ccm.keyHints') !== '0')
  const breakReminder = ref(read('ccm.breakReminder') !== '0')
  const minimap = ref(read('ccm.minimap') !== '0')
  const autoSave = ref<AutoSaveMode>(isAutoSaveMode(read('ccm.autoSave')) ? (read('ccm.autoSave') as AutoSaveMode) : 'off')
  const autoSaveDelay = ref(AUTO_SAVE_DELAYS.includes(Number(read('ccm.autoSaveDelay'))) ? Number(read('ccm.autoSaveDelay')) : AUTO_SAVE_DELAY_DEFAULT)
  const dimInactive = ref(read('ccm.workspace.dim') === '1')
  const dustEffect = ref(read('ccm.dust') === '1')
  const fileIcons = ref<FileIconStyle>(isFileIconStyle(read('ccm.fileIcons')) ? (read('ccm.fileIcons') as FileIconStyle) : 'atom')
  const pinned = ref<Set<string>>(readPinned())
  const budgetRaw = Number(read('ccm.budget'))
  /** Daily spend budget in USD at API list prices; 0 = off. */
  const dailyBudget = ref(Number.isFinite(budgetRaw) && budgetRaw > 0 ? budgetRaw : 0)
  const codeFont = ref(isFontId('code', read('ccm.font.code')) ? read('ccm.font.code')! : 'system')
  const uiFont = ref(isFontId('ui', read('ccm.font.ui')) ? read('ccm.font.ui')! : 'system')
  const codeFontSize = ref(read('ccm.font.codeSize') === null ? CODE_SIZE_DEFAULT : clampCodeSize(Number(read('ccm.font.codeSize'))))
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
  watch(keyHints, (value) => persist('ccm.keyHints', value ? '1' : '0'))
  watch(breakReminder, (value) => persist('ccm.breakReminder', value ? '1' : '0'))
  watch(minimap, (value) => persist('ccm.minimap', value ? '1' : '0'))
  watch(autoSave, (value) => persist('ccm.autoSave', value))
  watch(autoSaveDelay, (value) => persist('ccm.autoSaveDelay', String(value)))
  watch(dimInactive, (value) => persist('ccm.workspace.dim', value ? '1' : '0'))
  watch(dustEffect, (value) => persist('ccm.dust', value ? '1' : '0'))
  watch(dustEffect, setDustEnabled, { flush: 'sync', immediate: true })
  watch(fileIcons, (value) => persist('ccm.fileIcons', value))
  watch(pinned, (value) => persist('ccm.pinned', JSON.stringify([...value])))
  watch(activityPageSize, (value) => persist('ccm.activityPage', String(value)))
  watch(dailyBudget, (value) => persist('ccm.budget', String(value)))

  watch(
    theme,
    (value) => {
      applyTheme(document.documentElement, value)
      persist('ccm.theme', value)
      const look = desktop?.setAppearance ? readLook() : null
      if (look) void desktop!.setAppearance!(look)
      else void desktop?.setWindowBackground?.(themeMeta(value).swatch[0])
    },
    { flush: 'sync', immediate: true },
  )

  // Tailwind v4 reads --font-mono / --font-sans through var(), so every font-mono / font-sans text follows.
  watch(
    [codeFont, uiFont, codeFontSize],
    ([code, ui, size]) => {
      const style = document.documentElement.style
      style.setProperty('--font-mono', fontStack(fontEntry('code', code)))
      style.setProperty('--font-sans', fontStack(fontEntry('ui', ui)))
      style.setProperty('--ccm-code-size', `${size}px`)
      persist('ccm.font.code', code)
      persist('ccm.font.ui', ui)
      persist('ccm.font.codeSize', String(size))
    },
    { immediate: true },
  )

  function setCodeFont(id: string): void {
    if (isFontId('code', id)) codeFont.value = id
  }

  function setUiFont(id: string): void {
    if (isFontId('ui', id)) uiFont.value = id
  }

  function stepCodeSize(delta: number): void {
    codeFontSize.value = delta === 0 ? CODE_SIZE_DEFAULT : clampCodeSize(codeFontSize.value + delta)
  }

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
    theme.value = toggleTarget(theme.value)
  }

  function setTheme(id: ThemeId): void {
    if (isThemeId(id)) theme.value = id
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
    keyHints,
    minimap,
    autoSave,
    autoSaveDelay,
    dimInactive,
    dustEffect,
    fileIcons,
    pinned,
    activityPageSize,
    dailyBudget,
    codeFont,
    uiFont,
    codeFontSize,
    setCodeFont,
    setUiFont,
    stepCodeSize,
    togglePin,
    prunePins,
    toggleTheme,
    setTheme,
    toggleLocale,
    toggleHideFinished,
    toggleNotifications,
  }
})
