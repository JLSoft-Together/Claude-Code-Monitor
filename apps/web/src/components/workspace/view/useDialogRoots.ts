import { ref, watch, type Ref } from 'vue'
import { useProjectRoots } from '../../../composables/useProjectRoots'
import { isTerm, useWorkspaceStore, workCwd } from '../../../stores/workspace'
import { useUiStore } from '../../../stores/ui'

type OpenDir = { dir?: string | null } | null | undefined

/** Folder each project dialog opens on, taken when it opens so a later focus change does not swap it under the user. */
export function useDialogRoots(activeProject: Ref<string | null>) {
  const workspace = useWorkspaceStore()
  const ui = useUiStore()
  const { rootOf } = useProjectRoots()

  function rootRef(source: () => OpenDir): Ref<string | null> {
    const root = ref<string | null>(null)
    watch(
      source,
      (open) => {
        if (!open) return
        const dir = open.dir ?? activeProject.value ?? workspace.recentDirs[0] ?? null
        root.value = dir ? (rootOf(dir) ?? dir) : null
      },
      { immediate: true },
    )
    return root
  }

  const planRoot = rootRef(() => ui.planBoard)
  const envRoot = rootRef(() => ui.envCheck)
  const i18nRoot = rootRef(() => ui.i18nScan)
  const stringsRoot = rootRef(() => ui.stringsTable)
  const releaseRoot = rootRef(() => ui.releaseCheck)
  const permRoot = rootRef(() => ui.permAdvisor)

  const ctxTarget = ref<{ cwd: string | null; terminalId: string | null }>({ cwd: null, terminalId: null })
  watch(
    () => ui.contextSources,
    (open) => {
      if (!open) return
      const pane = workspace.active
      const own = !open.cwd && pane && isTerm(pane) ? pane : null
      ctxTarget.value = open.cwd ? { cwd: open.cwd, terminalId: open.terminalId } : { cwd: (own && workCwd(own)) ?? null, terminalId: own?.terminalId ?? null }
    },
    { immediate: true },
  )

  return { planRoot, envRoot, i18nRoot, stringsRoot, releaseRoot, permRoot, ctxTarget }
}
