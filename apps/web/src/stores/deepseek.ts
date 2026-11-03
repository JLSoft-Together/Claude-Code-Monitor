import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { PtyPreset } from '@ccm/shared'
import { i18n } from '../i18n'
import { deepseekBlocker, type DeepSeekBlocker } from '../lib/deepseekGate'
import { desktop, type DeepSeekStatus } from '../lib/desktop'
import { useToastsStore } from './toasts'
import { useUiStore } from './ui'

export const STATUS_TTL_MS = 60_000

/** Why the Settings › DeepSeek page was opened for the owner; shown as one line on top of it. */
export type DeepSeekNotice = DeepSeekBlocker | 'agent' | 'stale'

/** Codewhale state for the launch gate and Settings › DeepSeek; asked at most once a minute unless forced. */
export const useDeepSeekStore = defineStore('deepseek', () => {
  const status = ref<DeepSeekStatus | null>(null)
  const at = ref(0)
  const notice = ref<DeepSeekNotice | null>(null)
  let inflight: Promise<DeepSeekStatus | null> | null = null

  /** `cache`: this store's copy while under a minute old; `page`: ask main (its own 60 s CLI cache, sync state recomputed); `cli`: run codewhale now. */
  async function refresh(level: 'cache' | 'page' | 'cli' = 'cache', clock = Date.now()): Promise<DeepSeekStatus | null> {
    if (!desktop?.deepseekStatus) return null
    if (level === 'cache' && status.value && clock - at.value < STATUS_TTL_MS) return status.value
    if (inflight && level === 'cache') return inflight
    const ask: Promise<DeepSeekStatus | null> = desktop.deepseekStatus(level === 'cli').then(
      (s) => {
        if (inflight === ask) inflight = null
        if (s) {
          status.value = s
          at.value = clock
        }
        return s
      },
      (e: unknown) => {
        if (inflight === ask) inflight = null
        throw e
      },
    )
    inflight = ask
    return ask
  }

  const blocker = computed(() => deepseekBlocker(status.value))
  const stale = computed(() => status.value?.sync === 'stale')

  function showSetup(reason: DeepSeekNotice): void {
    const ui = useUiStore()
    notice.value = reason
    ui.settingsPage = 'deepseek'
    ui.settingsOpen = true
  }

  /** Owner picked DeepSeek: true = not ready, Settings opened instead. Decides on the cached status. */
  function gate(preset: PtyPreset): boolean {
    if (preset !== 'deepseek') return false
    void refresh()
    const b = blocker.value
    if (b) showSetup(b)
    return !!b
  }

  /** open_session from an agent: true = not ready. A toast offers the setup, so typing in another pane is not interrupted. */
  async function gateAgent(): Promise<boolean> {
    await refresh().catch(() => null)
    if (!blocker.value) return false
    const t = i18n.global.t
    useToastsStore().push({
      id: 'deepseek-setup',
      kind: 'warning',
      text: t('deepseekSetup.agentNotice'),
      timeoutMs: 15_000,
      actions: [{ label: t('deepseekSetup.openSetup'), primary: true, run: () => showSetup('agent') }],
      attrs: { 'data-deepseek-setup-toast': '' },
    })
    return true
  }

  return { status, at, notice, blocker, stale, refresh, showSetup, gate, gateAgent }
})
