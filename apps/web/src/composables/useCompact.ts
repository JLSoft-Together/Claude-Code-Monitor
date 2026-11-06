import { effectScope, ref, watch } from 'vue'
import type { PtyPreset } from '@ccm/shared'
import { useI18n } from 'vue-i18n'
import { COMPACT_STEP_TIMEOUT_MS, compactState, compactTick, handoffFile, type CompactFlow, type CompactState } from '../lib/compactHandoff'
import { desktop } from '../lib/desktop'
import { isTerm, presetOf, useWorkspaceStore, type Pane } from '../stores/workspace'
import { useSettingsStore } from '../stores/settings'
import { usePaneInfo } from './usePaneInfo'

// The flow waits on collector status and the agent's own /compact; DeepSeek panes have neither yet.
const COMPACTS = new Set<PtyPreset>(['claude', 'codex'])

function createCompact() {
  const { t } = useI18n()
  const workspace = useWorkspaceStore()
  const info = usePaneInfo()
  const settings = useSettingsStore()
  const notice = ref<{ n: number; text: string } | null>(null)
  const checking = new Set<string>()

  const paneOf = (key: string): Pane | undefined => workspace.panes.find((p) => p.key === key)
  const say = (text: string): void => {
    notice.value = { n: (notice.value?.n ?? 0) + 1, text }
  }
  const nameOf = (pane: Pane): string => info.titleOf(pane)
  const compactionsOf = (pane: Pane): number => info.sessionOf(pane)?.compactions ?? 0

  function stateOf(pane: Pane | undefined): CompactState | null {
    if (!pane || !isTerm(pane) || !COMPACTS.has(presetOf(pane))) return null
    return compactState(info.statusOf(pane), pane.compact)
  }

  function start(key: string): boolean {
    const pane = paneOf(key)
    if (!pane || stateOf(pane) !== 'ready') return false
    const cwd = info.sessionOf(pane)?.cwd || pane.cwd
    if (!cwd) return false
    const file = handoffFile(cwd, new Date())
    const flow: CompactFlow = { step: 'writing', file, base: compactionsOf(pane), worked: false, auto: settings.compactAuto, at: Date.now() }
    workspace.update(key, { prefill: t('workspace.compact.prompt', { file }), prefillSubmit: true, compact: flow })
    if (flow.auto) armTimer()
    say(t('workspace.compact.said.started', { name: nameOf(pane) }))
    return true
  }

  function cancel(key: string): void {
    const pane = paneOf(key)
    if (!pane?.compact) return
    workspace.update(key, { compact: undefined, ...(pane.prefillSubmit ? { prefill: undefined, prefillSubmit: undefined, prefillAuto: undefined } : {}) })
    say(t('workspace.compact.said.cancelled', { name: nameOf(pane) }))
  }

  async function check(key: string, flow: CompactFlow): Promise<void> {
    if (checking.has(key)) return
    checking.add(key)
    try {
      const view = desktop?.readFile ? await desktop.readFile(flow.file).catch(() => null) : null
      const pane = paneOf(key)
      if (!pane || pane.compact?.file !== flow.file) return
      if (view?.kind === 'missing') {
        if (!pane.compact.missing) say(t('workspace.compact.said.missing', { name: nameOf(pane), file: flow.file }))
        workspace.update(key, { compact: { ...pane.compact, missing: true } })
        return
      }
      const auto = !!pane.compact.auto
      workspace.update(key, {
        compact: { ...pane.compact, step: 'compact', missing: undefined, base: compactionsOf(pane), at: Date.now() },
        prefill: '/compact',
        prefillSubmit: auto ? true : undefined,
        prefillAuto: auto ? Date.now() : undefined,
      })
      say(t(auto ? 'workspace.compact.said.readyAuto' : 'workspace.compact.said.ready', { name: nameOf(pane) }))
    } finally {
      checking.delete(key)
    }
  }

  function resume(pane: Pane, flow: CompactFlow): void {
    const auto = !!flow.auto
    workspace.update(pane.key, {
      compact: undefined,
      prefill: t('workspace.compact.resume', { file: flow.file }),
      prefillSubmit: auto ? true : undefined,
      prefillAuto: auto ? Date.now() : undefined,
    })
    if (auto) armTimer()
    say(t(auto ? 'workspace.compact.said.resumedAuto' : 'workspace.compact.said.resumed', { name: nameOf(pane) }))
  }

  // Typing lands in the same input box the auto Enter would submit, so any manual input hands the rest back to the owner.
  function disarm(pane: Pane, why: 'manual' | 'timeout'): void {
    const patch: Partial<Pane> = {}
    if (pane.compact?.auto) patch.compact = { ...pane.compact, auto: false }
    if (pane.prefillAuto) Object.assign(patch, { prefillSubmit: undefined, prefillAuto: undefined })
    if (!Object.keys(patch).length) return
    workspace.update(pane.key, patch)
    say(t(`workspace.compact.said.${why}`, { name: nameOf(pane) }))
  }

  function stopAuto(key: string): void {
    const pane = paneOf(key)
    if (pane) disarm(pane, 'manual')
  }

  let timer: ReturnType<typeof setInterval> | null = null
  function armTimer(): void {
    timer ??= setInterval(sweep, 15_000)
  }

  function sweep(): void {
    const now = Date.now()
    let live = false
    for (const pane of workspace.panes) {
      const since = pane.prefillAuto ?? (pane.compact?.auto ? pane.compact.at : undefined)
      if (since === undefined) continue
      if (now - since > COMPACT_STEP_TIMEOUT_MS) disarm(pane, 'timeout')
      else live = true
    }
    if (!live && timer) {
      clearInterval(timer)
      timer = null
    }
  }

  watch(
    () => workspace.panes.filter((p) => p.compact).map((p) => `${p.key}|${p.compact!.step}|${p.compact!.worked}|${info.statusOf(p) ?? ''}|${compactionsOf(p)}`),
    () => {
      for (const pane of workspace.panes) {
        const flow = pane.compact
        if (!flow) continue
        if (pane.state !== 'running') {
          workspace.update(pane.key, { compact: undefined })
          continue
        }
        const { flow: next, action } = compactTick(flow, { status: info.statusOf(pane), compactions: compactionsOf(pane) })
        if (action === 'resume') resume(pane, flow)
        else {
          if (next !== flow) workspace.update(pane.key, { compact: next })
          if (action === 'check') void check(pane.key, next)
        }
      }
    },
  )

  return { notice, stateOf, start, cancel, stopAuto }
}

let shared: ReturnType<typeof createCompact> | undefined

export function useCompact() {
  shared ??= effectScope(true).run(createCompact)!
  return shared
}
