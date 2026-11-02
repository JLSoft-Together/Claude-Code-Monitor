import type { ToastKind } from '@ccm/shared'

export const SETTINGS_PAGES = ['general', 'appearance', 'editor', 'notify', 'reminders', 'github', 'integrations', 'access', 'data', 'about'] as const
export type SettingsPage = (typeof SETTINGS_PAGES)[number]

export const isSettingsPage = (v: unknown): v is SettingsPage => typeof v === 'string' && (SETTINGS_PAGES as readonly string[]).includes(v)

const PAGE_KEY = 'ccm.settings.page'

export function loadPage(): SettingsPage {
  try {
    const v = localStorage.getItem(PAGE_KEY)
    if (isSettingsPage(v)) return v
  } catch {
    return 'general'
  }
  return 'general'
}

export function savePage(page: SettingsPage): void {
  try {
    localStorage.setItem(PAGE_KEY, page)
  } catch {
    return
  }
}

/** What this build / platform can show; entries and pages without their flag are hidden. */
export interface SettingsEnv {
  terminals: boolean
  mac: boolean
  loginItem: boolean
  zoom: boolean
  awake: boolean
  github: boolean
  run: boolean
  capture: boolean
  agentData: boolean
  phone: boolean
  disk: boolean
  updater: boolean
  backup: boolean
  grants: boolean
  statusLine: boolean
  toast: boolean
  notifyData: boolean
}

export interface SettingsEntry {
  page: SettingsPage
  id: string
  labelKey: string
  hintKey?: string
  needs?: keyof SettingsEnv
}

const PAGE_NEEDS: Partial<Record<SettingsPage, keyof SettingsEnv>> = { editor: 'terminals', github: 'github' }

export const pageVisible = (page: SettingsPage, env: SettingsEnv): boolean => {
  const need = PAGE_NEEDS[page]
  return need ? env[need] : true
}

/** In-app notification switches in `useSettingsStore`, matched to the system-alert kind they mirror. */
export const NOTIFY_ROWS: { kind: ToastKind; inApp?: 'notifyWaiting' | 'notifyDone' | 'notifyStuck' | 'notifyLoop' | 'notifyContext' | 'notifyLimit' }[] = [
  { kind: 'waiting', inApp: 'notifyWaiting' },
  { kind: 'done', inApp: 'notifyDone' },
  { kind: 'stuck', inApp: 'notifyStuck' },
  { kind: 'loop', inApp: 'notifyLoop' },
  { kind: 'context', inApp: 'notifyContext' },
  { kind: 'limit', inApp: 'notifyLimit' },
  { kind: 'job' },
  { kind: 'idle' },
  { kind: 'sensitive' },
  { kind: 'disk' },
]

export const entries = (mac: boolean): SettingsEntry[] => [
  { page: 'general', id: 'language', labelKey: 'settings.language' },
  { page: 'general', id: 'loginItem', labelKey: mac ? 'settings.loginItemMac' : 'settings.loginItem', hintKey: mac ? 'settings.loginItemHintMac' : 'settings.loginItemHint', needs: 'loginItem' },
  { page: 'general', id: 'restore', labelKey: 'wsRestore.mode', hintKey: 'wsRestore.modeHint', needs: 'terminals' },
  { page: 'general', id: 'awake', labelKey: 'awake.setting', hintKey: 'awake.settingHint', needs: 'awake' },
  { page: 'general', id: 'tips', labelKey: 'tips.setting', hintKey: 'tips.settingHint', needs: 'terminals' },
  { page: 'general', id: 'keyHints', labelKey: 'keys.hints', hintKey: 'keys.hintsHint' },
  { page: 'general', id: 'launch', labelKey: 'settings.launchTerminal', hintKey: 'settings.launchTerminalHint', needs: 'mac' },

  { page: 'appearance', id: 'theme', labelKey: 'settings.theme' },
  { page: 'appearance', id: 'uiFont', labelKey: 'fonts.ui', hintKey: 'fonts.uiHint' },
  { page: 'appearance', id: 'codeFont', labelKey: 'fonts.code', hintKey: 'fonts.codeHint' },
  { page: 'appearance', id: 'codesize', labelKey: 'fonts.size', hintKey: mac ? 'fonts.sizeHintMac' : 'fonts.sizeHint' },
  { page: 'appearance', id: 'appzoom', labelKey: 'fonts.zoom', hintKey: mac ? 'fonts.zoomHintMac' : 'fonts.zoomHint', needs: 'zoom' },
  { page: 'appearance', id: 'fileIcons', labelKey: 'settings.fileIcons', hintKey: 'settings.fileIconsHint', needs: 'terminals' },
  { page: 'appearance', id: 'dust', labelKey: 'settings.dust', hintKey: 'settings.dustHint', needs: 'terminals' },

  { page: 'editor', id: 'autoSave', labelKey: 'settings.autoSave', hintKey: 'settings.autoSaveHint', needs: 'terminals' },
  { page: 'editor', id: 'minimap', labelKey: 'settings.minimap', hintKey: 'settings.minimapHint', needs: 'terminals' },
  { page: 'editor', id: 'dim', labelKey: 'workspace.dim.setting', hintKey: 'workspace.dim.settingHint', needs: 'terminals' },
  { page: 'editor', id: 'shell', labelKey: 'shellMarks.setting', hintKey: 'shellMarks.settingHint', needs: 'terminals' },

  { page: 'notify', id: 'toast', labelKey: 'settings.toast', hintKey: mac ? 'settings.toastHintMac' : 'settings.toastHint', needs: 'toast' },
  { page: 'notify', id: 'notifyEnable', labelKey: 'settings.notifyEnable', hintKey: 'settings.notifyHint' },
  { page: 'notify', id: 'testToast', labelKey: 'settings.toastTest.action', needs: 'toast' },
  ...NOTIFY_ROWS.map((r): SettingsEntry => ({
    page: 'notify',
    id: `event-${r.kind}`,
    labelKey: `settingsV79.events.${r.kind}`,
    hintKey: `settings.toastKind.${r.kind}`,
    needs: r.inApp ? undefined : 'toast',
  })),
  { page: 'notify', id: 'sound', labelKey: 'settings.sound', hintKey: 'settings.soundHint' },
  { page: 'notify', id: 'quiet', labelKey: 'settings.quiet', hintKey: 'settings.quietHint', needs: 'notifyData' },
  { page: 'notify', id: 'idle', labelKey: 'resources.idleSetting', hintKey: 'resources.idleSettingHint', needs: 'notifyData' },
  { page: 'notify', id: 'disk', labelKey: 'disk.setting', hintKey: 'disk.settingHint', needs: 'disk' },
  { page: 'notify', id: 'phone', labelKey: 'phone.section', needs: 'phone' },

  { page: 'reminders', id: 'break', labelKey: 'settings.breakReminder', hintKey: 'settings.breakHint' },
  { page: 'reminders', id: 'stuck', labelKey: 'settings.stuck', hintKey: 'settings.stuckHint' },
  { page: 'reminders', id: 'budget', labelKey: 'settings.budget', hintKey: 'settings.budgetHint' },

  { page: 'github', id: 'github', labelKey: 'github.section', needs: 'github' },

  { page: 'integrations', id: 'statusLine', labelKey: 'limits.setupTitle', hintKey: 'limits.setupHint', needs: 'statusLine' },
  { page: 'integrations', id: 'run', labelKey: 'run.sdk.section', needs: 'run' },
  { page: 'integrations', id: 'capture', labelKey: 'capture.section', hintKey: 'capture.folderHint', needs: 'capture' },

  { page: 'access', id: 'sensitive', labelKey: 'sensitive.section', hintKey: 'sensitive.hint' },
  { page: 'access', id: 'fullAccess', labelKey: 'settings.fullAccess', hintKey: 'settings.fullAccessHint', needs: 'grants' },
  { page: 'access', id: 'forgetGrants', labelKey: 'settings.forgetGrants', hintKey: 'settings.forgetGrantsHint', needs: 'grants' },

  { page: 'data', id: 'agentData', labelKey: 'agentData.section', needs: 'agentData' },
  { page: 'data', id: 'backup', labelKey: 'backup.section', hintKey: 'backup.autoHint', needs: 'backup' },

  { page: 'about', id: 'update', labelKey: 'update.section', needs: 'updater' },
  { page: 'about', id: 'help-whatsNew', labelKey: 'whatsNew.open' },
  { page: 'about', id: 'help-tour', labelKey: 'tour.open', hintKey: 'settings.tourHint' },
  { page: 'about', id: 'help-wsTour', labelKey: 'wsHelp.tour', needs: 'terminals' },
  { page: 'about', id: 'help-diag', labelKey: 'diag.open', hintKey: 'settings.diagHint' },
  { page: 'about', id: 'help-setup', labelKey: 'setup.open', hintKey: 'setup.openHint' },
  { page: 'about', id: 'help-fonts', labelKey: 'fonts.licenses', hintKey: 'fonts.licensesHint' },
  { page: 'about', id: 'help-fileIcons', labelKey: 'settings.fileIconsLicense', hintKey: 'settings.fileIconsLicenseHint', needs: 'terminals' },
  { page: 'about', id: 'help-habblaud', labelKey: 'settings.habblaudLicense', hintKey: 'settings.habblaudLicenseHint' },
]

const fold = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/đ/g, 'd')
    .toLowerCase()

export interface SettingsHit {
  page: SettingsPage
  id: string
  label: string
}

const wordStart = (hay: string, w: string): boolean => {
  for (let i = hay.indexOf(w); i >= 0; i = hay.indexOf(w, i + 1)) if (i === 0 || !/[\p{L}\p{N}]/u.test(hay[i - 1]!)) return true
  return false
}

/**
 * Entries whose label or hint contains every word of `query`; hidden pages / rows are skipped.
 * A query with accents matches exactly first ("âm" must not hit "làm"); accents are ignored only for plain queries or when nothing matched.
 * Order: word starts a label, then inside a label, then hint only.
 */
export function searchSettings(query: string, all: SettingsEntry[], env: SettingsEnv, t: (key: string) => string): SettingsHit[] {
  const raw = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (!raw.length) return []
  const accented = fold(query) !== query.toLowerCase()
  const run = (norm: (s: string) => string, words: string[]): SettingsHit[] => {
    const scored: { hit: SettingsHit; score: number }[] = []
    for (const e of all) {
      if (e.needs && !env[e.needs]) continue
      if (!pageVisible(e.page, env)) continue
      const label = t(e.labelKey)
      const l = norm(label)
      const hay = `${l} ${e.hintKey ? norm(t(e.hintKey)) : ''}`
      if (!words.every((w) => hay.includes(w))) continue
      const score = Math.max(...words.map((w) => (wordStart(l, w) ? 0 : l.includes(w) ? 1 : 2)))
      scored.push({ hit: { page: e.page, id: e.id, label }, score })
    }
    return scored.sort((a, b) => a.score - b.score).map((s) => s.hit)
  }
  if (accented) {
    const exact = run((s) => s.toLowerCase(), raw)
    if (exact.length) return exact
  }
  return run(fold, fold(query).split(/\s+/).filter(Boolean))
}
