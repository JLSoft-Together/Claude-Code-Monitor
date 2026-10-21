import { effectScope, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { compactState, compactTick, handoffFile, type CompactFlow, type CompactState } from '../lib/compactHandoff'
import { desktop } from '../lib/desktop'
import { isTerm, presetOf, useWorkspaceStore, type Pane } from '../stores/workspace'
import { usePaneInfo } from './usePaneInfo'

function createCompact() {
  const { t } = useI18n()
  const workspace = useWorkspaceStore()
  const info = usePaneInfo()
  const notice = ref<{ n: number; text: string } | null>(null)
  const checking = new Set<string>()

  const paneOf = (key: string): Pane | undefined => workspace.panes.find((p) => p.key === key)
  const say = (text: string): void => {
    notice.value = { n: (notice.value?.n ?? 0) + 1, text }
  }
  const nameOf = (pane: Pane): string => info.titleOf(pane)
  const compactionsOf = (pane: Pane): number => info.sessionOf(pane)?.compactions ?? 0

  function stateOf(pane: Pane | undefined): CompactState | null {
    if (!pane || !isTerm(pane) || presetOf(pane) === 'shell') return null
    return compactState(info.statusOf(pane), pane.compact)
  }

  function start(key: string): boolean {
    const pane = paneOf(key)
    if (!pane || stateOf(pane) !== 'ready') return false
    const cwd = info.sessionOf(pane)?.cwd || pane.cwd
    if (!cwd) return false
    const file = handoffFile(cwd, new Date())
    const flow: CompactFlow = { step: 'writing', file, base: compactionsOf(pane), worked: false }
    workspace.update(key, { prefill: t('workspace.compact.prompt', { file }), prefillSubmit: true, compact: flow })
    say(t('workspace.compact.said.started', { name: nameOf(pane) }))
    return true
  }

  function cancel(key: string): void {
    const pane = paneOf(key)
    if (!pane?.compact) return
    workspace.update(key, { compact: undefined, ...(pane.prefillSubmit ? { prefill: undefined, prefillSubmit: undefined } : {}) })
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
      workspace.update(key, { compact: { ...pane.compact, step: 'compact', missing: undefined, base: compactionsOf(pane) }, prefill: '/compact', prefillSubmit: undefined })
      say(t('workspace.compact.said.ready', { name: nameOf(pane) }))
    } finally {
      checking.delete(key)
    }
  }

  function resume(pane: Pane, flow: CompactFlow): void {
    workspace.update(pane.key, { compact: undefined, prefill: t('workspace.compact.resume', { file: flow.file }), prefillSubmit: undefined })
    say(t('workspace.compact.said.resumed', { name: nameOf(pane) }))
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

  return { notice, stateOf, start, cancel }
}

let shared: ReturnType<typeof createCompact> | undefined

export function useCompact() {
  shared ??= effectScope(true).run(createCompact)!
  return shared
}
