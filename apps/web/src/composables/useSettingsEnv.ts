import { computed } from 'vue'
import { hasAgentData } from '../lib/agentData'
import { hasBackup } from '../lib/backup'
import { hasDisk } from '../lib/buildClean'
import { hasAwake, hasCapture } from '../lib/capture'
import { desktop, hasDeepSeek, hasRun, hasTerminals } from '../lib/desktop'
import { hasGitHub } from '../lib/github'
import { hasPhone } from '../lib/phone'
import { isMac } from '../lib/platform'
import { hasGrants } from '../lib/preview'
import { hasUpdater } from '../lib/update'
import { useExtrasStore } from '../stores/extras'
import type { SettingsEnv } from '../components/settings'

/** Which settings rows this build shows; the same flags SettingsMenu uses, so a palette hit never points at a hidden row. */
export function useSettingsEnv() {
  const extras = useExtrasStore()
  return computed<SettingsEnv>(() => ({
    terminals: hasTerminals,
    mac: isMac,
    loginItem: Boolean(desktop?.loginItem),
    zoom: Boolean(desktop?.zoomApp),
    awake: hasAwake,
    github: hasGitHub,
    run: hasRun,
    capture: hasCapture,
    agentData: hasAgentData,
    phone: hasPhone,
    disk: hasDisk,
    updater: hasUpdater,
    backup: hasBackup,
    grants: hasGrants,
    statusLine: Boolean(extras.statusLineCommand),
    toast: extras.toast === 'on' || extras.toast === 'off',
    notifyData: Boolean(extras.notify),
    deepseek: hasDeepSeek,
  }))
}
