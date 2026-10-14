<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { CircleX, LoaderCircle, PlayCircle } from 'lucide-vue-next'
import { isRunLive } from '@ccm/shared'
import { hasRun } from '../../lib/desktop'
import { baseName } from '../../lib/preview'
import { inRoot, runBadge, type RunBadge } from '../../lib/runUi'
import { useRunStore } from '../../stores/run'
import { useUiStore } from '../../stores/ui'
import { useWorkspaceStore } from '../../stores/workspace'

/** Run state of the project at `dir`; `liveOnly` hides the Failed state (session cards). */
const props = withDefaults(defineProps<{ dir: string; liveOnly?: boolean }>(), { liveOnly: false })

const { t } = useI18n()
const run = useRunStore()
const workspace = useWorkspaceStore()
const ui = useUiStore()

onMounted(() => {
  if (hasRun) void run.ensure()
})

const badge = computed<RunBadge | null>(() => {
  if (!hasRun) return null
  const list = run.sessionsFor(props.dir)
  const b = runBadge(props.liveOnly ? list.filter((s) => isRunLive(s.state)) : list)
  return b
})

const ICON = { busy: LoaderCircle, running: PlayCircle, failed: CircleX }
const TONE: Record<RunBadge, string> = {
  busy: 'bg-st-working-soft text-st-working',
  running: 'bg-st-working-soft text-st-working',
  failed: 'bg-st-error-soft text-st-error',
}

/** The run pane already covering this project, else a new one at `dir`. */
function show(): void {
  const open = workspace.panes.find((p) => p.kind === 'run' && !!p.cwd && (inRoot(props.dir, p.cwd) || inRoot(p.cwd, props.dir)))
  workspace.openRun(open?.cwd ?? props.dir)
  if (ui.view !== 'workspace') ui.setView('workspace')
}
</script>

<template>
  <button
    v-if="badge"
    type="button"
    class="inline-flex h-5 shrink-0 cursor-pointer items-center gap-1 rounded-full px-1.5 text-2xs font-semibold whitespace-nowrap"
    :class="TONE[badge]"
    :title="t('run.badge.open', { name: baseName(dir) })"
    :data-run-badge="badge"
    @click.stop="show"
  >
    <component :is="ICON[badge]" :size="11" :class="badge === 'busy' ? 'ccm-spin' : ''" aria-hidden="true" />{{ t(`run.badge.${badge}`) }}
  </button>
</template>
