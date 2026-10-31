<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { EyeOff, FileDiff, FileText } from 'lucide-vue-next'
import type { ActivityEvent } from '@ccm/shared'
import { hasTerminals } from '../lib/desktop'
import { folderName, relInside, ruleText } from '../lib/sensitive'
import { useCheckpointsStore } from '../stores/checkpoints'
import { useConnectionStore } from '../stores/connection'
import { useSensitiveStore } from '../stores/sensitive'
import { useUiStore } from '../stores/ui'
import { useWorkspaceStore } from '../stores/workspace'

/** Open file / Open diff / Ignore for one `sensitive` activity row (v76 R5). */
const props = defineProps<{ event: ActivityEvent }>()

const { t } = useI18n()
const ui = useUiStore()
const workspace = useWorkspaceStore()
const checkpoints = useCheckpointsStore()
const connection = useConnectionStore()
const sensitive = useSensitiveStore()

const project = computed(() => props.event.data?.project)
const rule = computed(() => props.event.data?.rule)
const inside = computed(() => {
  const file = props.event.data?.file
  return file && project.value && relInside(file, project.value) !== null ? file : null
})
const diffRoot = ref<{ root: string; rel: string } | null>(null)

watch(
  inside,
  async (file) => {
    diffRoot.value = null
    if (!file || !project.value || !hasTerminals) return
    const r = await checkpoints.rootFor(project.value)
    const rel = r?.on && r.list.length ? relInside(file, r.root) : null
    diffRoot.value = r && rel ? { root: r.root, rel } : null
  },
  { immediate: true },
)

const ignored = computed(() => sensitive.ignored(project.value, rule.value))
const ruleName = computed(() => ruleText(rule.value, t))

function openFile(): void {
  if (!inside.value) return
  ui.setView('workspace')
  workspace.openFile(inside.value, undefined, { cwd: project.value })
}

function openDiff(): void {
  if (!diffRoot.value) return
  ui.setView('workspace')
  workspace.openChanges(diffRoot.value.root, { select: diffRoot.value.rel })
}

function ignore(): void {
  if (project.value && rule.value) connection.ignoreSensitive(project.value, rule.value, true)
}
</script>

<template>
  <div class="mt-1 flex flex-wrap items-center gap-1" data-sensitive-actions>
    <button v-if="inside && hasTerminals" type="button" class="ccm-btn-plain h-6 px-1.5! text-2xs" data-sensitive-open @click="openFile">
      <FileText :size="12" aria-hidden="true" />{{ t('sensitive.openFile') }}
    </button>
    <button v-if="diffRoot" type="button" class="ccm-btn-plain h-6 px-1.5! text-2xs" data-sensitive-diff @click="openDiff">
      <FileDiff :size="12" aria-hidden="true" />{{ t('sensitive.openDiff') }}
    </button>
    <button
      v-if="project && rule && !ignored"
      type="button"
      class="ccm-btn-plain h-6 px-1.5! text-2xs"
      :title="t('sensitive.ignoreTitle', { rule: ruleName, project: folderName(project) })"
      data-sensitive-ignore
      @click="ignore"
    >
      <EyeOff :size="12" aria-hidden="true" />{{ t('sensitive.ignore') }}
    </button>
  </div>
</template>
