import { defineStore } from 'pinia'
import { nextTick, shallowRef } from 'vue'
import { i18n } from '../i18n'
import {
  delayTo,
  fillOrder,
  nextFire,
  parseEntries,
  RESET_GRACE_MS,
  RESUME_STORAGE_KEY,
  RESUME_TEXT_KEY,
  resetLabel,
  splitDue,
  upsert,
  without,
  type ResumeEntry,
} from '../lib/resumeSchedule'
import { useSettingsStore } from './settings'
import { useUiStore } from './ui'
import { useWorkspaceStore } from './workspace'

function read(key: string): string | null {
  try {
    return sessionStorage.getItem(key)
  } catch {
    return null
  }
}

/**
 * "Continue at reset" per agent pane: one setTimeout to the earliest entry, then the text is prefilled with
 * `insertInto` (never Enter). Kept in sessionStorage like the prompt queue.
 */
export const useResumeScheduleStore = defineStore('resumeSchedule', () => {
  const entries = shallowRef<ResumeEntry[]>(parseEntries(read(RESUME_STORAGE_KEY), Date.now()))
  /** Last fire, for the panes' notice. */
  const fired = shallowRef<{ id: number; keys: string[] } | null>(null)
  let timer: ReturnType<typeof setTimeout> | null = null
  let fireSeq = 0

  function put(list: ResumeEntry[]): void {
    entries.value = list
    try {
      if (list.length) sessionStorage.setItem(RESUME_STORAGE_KEY, JSON.stringify(list))
      else sessionStorage.removeItem(RESUME_STORAGE_KEY)
    } catch {
      // Storage blocked: the schedule still runs in this page.
    }
    arm()
  }

  function arm(): void {
    if (timer) clearTimeout(timer)
    timer = null
    const at = nextFire(entries.value)
    if (at !== null) timer = setTimeout(() => void fire(), delayTo(at, Date.now()))
  }

  function notifyOs(keys: string[]): void {
    const settings = useSettingsStore()
    if (!settings.notifyEnabled || !settings.notifyLimit) return
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return
    try {
      const t = i18n.global.t
      new Notification(t('limitResume.toastTitle'), { body: t('limitResume.toastBody', { n: keys.length }, keys.length), tag: 'ccm-limit-resume', icon: '/favicon.svg' })
    } catch {
      // Notifications unavailable; the panes show their own notice.
    }
  }

  async function fire(): Promise<void> {
    timer = null
    const { due, rest } = splitDue(entries.value, Date.now())
    put(rest)
    if (!due.length) return
    const workspace = useWorkspaceStore()
    const filled: string[] = []
    for (const e of fillOrder(due)) {
      if (workspace.panes.find((p) => p.key === e.paneKey)?.state !== 'running') continue
      workspace.insertInto(e.paneKey, e.text)
      filled.push(e.paneKey)
      // insertRequest holds one request at a time.
      await nextTick()
    }
    if (!filled.length) return
    const ui = useUiStore()
    if (ui.view !== 'workspace') ui.setView('workspace')
    fired.value = { id: ++fireSeq, keys: filled }
    notifyOs(filled)
  }

  const get = (paneKey: string): ResumeEntry | undefined => entries.value.find((e) => e.paneKey === paneKey)

  function schedule(paneKey: string, text: string, resetAt: number): void {
    put(upsert(entries.value, { paneKey, text, at: resetAt + RESET_GRACE_MS, createdAt: Date.now() }))
    try {
      if (text === i18n.global.t('limitResume.defaultText')) localStorage.removeItem(RESUME_TEXT_KEY)
      else localStorage.setItem(RESUME_TEXT_KEY, text)
    } catch {
      // Only the remembered default is lost.
    }
  }

  const cancel = (paneKey: string): void => {
    if (get(paneKey)) put(without(entries.value, paneKey))
  }

  /** Text last scheduled, else the locale default ("continue" / "tiếp tục"). */
  function defaultText(): string {
    try {
      const saved = localStorage.getItem(RESUME_TEXT_KEY)
      if (saved) return saved
    } catch {
      // fall through to the locale default
    }
    return i18n.global.t('limitResume.defaultText')
  }

  const label = (at: number): string => resetLabel(at, Date.now(), i18n.global.locale.value)

  arm()
  return { entries, fired, get, schedule, cancel, defaultText, label }
})
