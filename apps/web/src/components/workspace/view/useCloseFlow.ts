import { computed, nextTick, ref, watch, type Ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Undo2 } from 'lucide-vue-next'
import { usePaneInfo } from '../../../composables/usePaneInfo'
import { dropKept, dustIn, dustOn, dustOutAll, hasKept, onDustLeave } from '../../../lib/dust'
import { motionMs, withViewTransition } from '../../../lib/motion'
import { isMac } from '../../../lib/platform'
import { baseName } from '../../../lib/preview'
import { shortcutText } from '../../../lib/shortcuts'
import { leaves } from '../../../lib/splitLayout'
import { closedPanes, isTerm, useWorkspaceStore, type ClosedEntry, type Pane } from '../../../stores/workspace'
import { useSettingsStore } from '../../../stores/settings'
import { useToastsStore } from '../../../stores/toasts'

export interface CloseFlowDeps {
  canvas: Ref<HTMLElement | null>
  visible: () => boolean
  shownKeys: () => ReadonlyMap<string, unknown>
  paneOf: (key: string) => Pane | undefined
  focusActivePane: () => void
  announce: (text: string) => void
  adoptNew: <T>(change: () => T) => T
}

/** Closing panes: save / confirm sheet, dust-out animation, and the undo toast with its dust-in reopen. */
export function useCloseFlow(deps: CloseFlowDeps) {
  const { canvas, paneOf, focusActivePane, announce, adoptNew } = deps
  const { t } = useI18n()
  const workspace = useWorkspaceStore()
  const settings = useSettingsStore()
  const toasts = useToastsStore()
  const { isBusy } = usePaneInfo()

  const closing = computed(() => (workspace.pendingClose ?? []).map((k) => workspace.panes.find((p) => p.key === k)).filter((p): p is Pane => !!p))
  const closeDialog = ref<{ focus: () => void } | null>(null)
  let confirmReturn: HTMLElement | null = null
  // v42 unsaved file editors in the close sheet: Save (then close) / Don't save / Cancel.
  const closingDirty = computed(() => closing.value.filter((p) => p.dirty))
  const closingBusy = computed(() => closing.value.filter((p) => isBusy(p)))
  const closeSaving = ref(false)
  const closeErrors = ref<string[]>([])
  async function saveAndClose(): Promise<void> {
    if (closeSaving.value) return
    closeSaving.value = true
    const failed = await workspace.saveFiles(closingDirty.value.map((p) => p.key))
    closeSaving.value = false
    closeErrors.value = failed.map((f) => t('editor.close.failed', { name: baseName(paneOf(f.key)?.path ?? f.key), reason: f.error }))
    if (!failed.length) await confirmPending()
  }

  watch(
    () => workspace.pendingClose,
    async (keys, before) => {
      closeErrors.value = []
      if (keys && !before) confirmReturn = document.activeElement as HTMLElement | null
      await nextTick()
      if (keys) return closeDialog.value?.focus()
      if (!before) return
      const back = confirmReturn
      confirmReturn = null
      if (back?.isConnected && back.getClientRects().length) back.focus()
      else focusActivePane()
    },
  )

  /** Panes that close without asking morph away; a confirmation sheet opens without one. */
  function closePanes(keys: string[], opts: { record?: boolean } = {}): void {
    // v62: with auto save on, dirty file panes save first; only the ones that fail still ask.
    if (settings.autoSave !== 'off' && keys.some((k) => paneOf(k)?.dirty)) {
      void workspace.saveFiles(keys).then(() => closeNow(keys, opts))
      return
    }
    closeNow(keys, opts)
  }

  function closeNow(keys: string[], opts: { record?: boolean }): void {
    // v42: a file pane with unsaved edits asks too (Save / Don't save / Cancel in the same sheet).
    const asksFor = (pane: Pane): boolean => isBusy(pane) || !!pane.dirty
    const open = keys.filter((k) => !dusting.has(k))
    if (!open.length) return
    const asks = open.some((k) => {
      const pane = paneOf(k)
      return !!pane && asksFor(pane)
    })
    if (asks) return workspace.requestClose(open, asksFor, opts)
    if (!canDust() || !open.some((k) => shownPane(k))) return removePanes(open, asksFor, opts)
    void dustPanes(open, opts.record !== false).then((els) => {
      removePanes(open, asksFor, opts, false)
      if (workspace.pendingClose) revive(els)
    })
  }

  function removePanes(keys: string[], asksFor: (pane: Pane) => boolean, opts: { record?: boolean }, morph = true): void {
    markClosingTabs(keys)
    if (morph) withViewTransition(() => workspace.requestClose(keys, asksFor, opts))
    else workspace.requestClose(keys, asksFor, opts)
  }

  const dusting = new Set<string>()
  const closingTabs = new Set<string>()
  const closeOut = ref(false)
  const canDust = dustOn

  function shownPane(key: string): HTMLElement | null {
    if (!deps.visible() || !deps.shownKeys().has(key)) return null
    return canvas.value?.querySelector<HTMLElement>(`[data-pane="${CSS.escape(key)}"]`) ?? null
  }

  function markClosingTabs(keys: readonly string[]): void {
    const gone = new Set(keys)
    for (const tab of workspace.tabs) {
      if (!leaves(tab.root).every((k) => gone.has(k))) continue
      const key = tab.key
      closingTabs.add(key)
      setTimeout(() => closingTabs.delete(key), 2000)
    }
  }

  function leavingChrome(keys: readonly string[]): Element[] {
    const gone = new Set(keys)
    const tabs = workspace.tabs.filter((tab) => leaves(tab.root).every((k) => gone.has(k))).map((tab) => tab.key)
    const pick = (sel: string): Element[] => [...document.querySelectorAll(sel)]
    return [
      ...tabs.flatMap((k) => pick(`[data-tab-item="${CSS.escape(k)}"], li[data-leave-tab="${CSS.escape(k)}"]`)),
      ...keys.flatMap((k) => pick(`li[data-leave-pane="${CSS.escape(k)}"]`)),
    ].filter((el) => el.getClientRects().length > 0)
  }

  async function dustPanes(keys: readonly string[], keep = true): Promise<HTMLElement[]> {
    const els = keys.map((k) => shownPane(k)).filter((el): el is HTMLElement => !!el)
    for (const k of keys) dusting.add(k)
    try {
      await dustOutAll(els, leavingChrome(keys), keep ? { keep: (el) => el.dataset.pane } : undefined)
    } finally {
      for (const k of keys) dusting.delete(k)
    }
    return els
  }

  const undoShown = ref<number | null>(null)
  let undoSeen = 0
  watch(
    () => workspace.closedStack.at(-1)?.id ?? 0,
    (id) => {
      if (id > undoSeen) {
        undoSeen = id
        undoShown.value = id
      } else if (undoShown.value !== null && !workspace.closedStack.some((e) => e.id === undoShown.value)) undoShown.value = null
    },
  )
  watch(
    deps.visible,
    (shown) => {
      if (!shown) undoShown.value = null
    },
  )

  function closedText(entry: ClosedEntry, word: 'closed' | 'reopened'): string {
    const list = closedPanes(entry)
    return list.length === 1 ? t(`workspace.undo.${word}`, { name: list[0]!.name }) : t(`workspace.undo.${word}Many`, { n: list.length }, list.length)
  }

  const undoKeys = shortcutText('wsReopen', isMac)

  watch(
    () => {
      const entry = deps.visible() ? workspace.closedStack.find((e) => e.id === undoShown.value) : undefined
      if (!entry) return null
      return { text: closedText(entry, 'closed'), shells: closedPanes(entry).filter((p) => isTerm(p) && p.preset === 'shell').length }
    },
    (info) => {
      if (!info) return toasts.remove('ws-undo')
      const shellNote = info.shells ? t('workspace.undo.shellNote', info.shells) : ''
      toasts.push({
        id: 'ws-undo',
        kind: 'undo',
        text: info.text,
        detail: shellNote || undefined,
        attrs: { 'data-undo-toast': '' },
        dismissAttrs: { 'data-undo-dismiss': '' },
        actions: [
          {
            label: t('workspace.undo.action'),
            title: [t('workspace.undo.actionTitle', { keys: undoKeys }), shellNote].filter(Boolean).join('\n'),
            keys: undoKeys,
            icon: Undo2,
            attrs: { 'data-undo': '' },
            run: () => void reopenLast(),
          },
        ],
        onDismiss: (reason) => {
          undoShown.value = null
          if (reason !== 'timeout') focusActivePane()
        },
      })
    },
    { immediate: true },
  )

  function cssVar(name: string, fallback: string): string {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback
  }

  function fadeIn(el: HTMLElement): void {
    const ms = motionMs(Number.parseFloat(cssVar('--ccm-dur-base', '220')) || 220)
    if (!ms) return
    el.animate([{ opacity: 0, transform: 'scale(0.98)' }, { opacity: 1, transform: 'none' }], { duration: ms, easing: cssVar('--ease-out-quint', 'ease-out') })
  }

  let reopening = false

  async function reopenLast(): Promise<void> {
    const entry = workspace.closedStack.at(-1)
    if (!entry || reopening) return
    reopening = true
    try {
      const said = closedText(entry, 'reopened')
      if (!canDust() || !deps.visible() || !closedPanes(entry).some((p) => hasKept(p.key))) {
        withViewTransition(() => {
          adoptNew(() => workspace.reopenClosed())
          void nextTick(focusActivePane)
        })
        announce(said)
        return
      }
      const res = adoptNew(() => workspace.reopenClosed())
      announce(said)
      if (!res?.keys.length) return
      await nextTick()
      const back = res.keys.map((key, i) => ({ el: shownPane(key), from: res.from[i]! }))
      const holds = back.map(({ el }) => el?.animate({ opacity: [0, 0] }, { duration: 4000, fill: 'both' }))
      focusActivePane()
      await nextFrame()
      await Promise.all(
        back.map(async ({ el, from }, i) => {
          if (!el) return dropKept(from)
          const played = await dustIn(el, from).catch(() => false)
          holds[i]?.cancel()
          if (played) return
          dropKept(from)
          fadeIn(el)
        }),
      )
    } finally {
      reopening = false
    }
  }

  function revive(els: readonly HTMLElement[]): void {
    for (const el of els) Object.assign(el.style, { visibility: '', opacity: '', transition: '', animation: '' })
  }

  const wait = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms))
  const nextFrame = (): Promise<void> => new Promise((done) => requestAnimationFrame(() => done()))

  async function confirmPending(): Promise<void> {
    const keys = [...(workspace.pendingClose ?? [])]
    if (!keys.length || closeOut.value) return
    const shown = keys.filter((k) => shownPane(k))
    if (!shown.length) {
      markClosingTabs(keys)
      workspace.confirmClose()
      return
    }
    const dust = canDust()
    closeOut.value = true
    await wait(motionMs(180))
    await nextFrame()
    if (dust) await dustPanes(shown)
    markClosingTabs(keys)
    if (dust) workspace.confirmClose()
    else withViewTransition(() => workspace.confirmClose())
    closeOut.value = false
  }

  function onTabLeave(el: Element, done: () => void): void {
    const key = (el as HTMLElement).dataset.tabItem
    if (key && closingTabs.delete(key) && canDust()) return onDustLeave(el, done)
    setTimeout(done, motionMs(150))
  }
  return { closing, closingDirty, closingBusy, closeSaving, closeErrors, closeDialog, closeOut, saveAndClose, closePanes, confirmPending, onTabLeave, reopenLast }
}
