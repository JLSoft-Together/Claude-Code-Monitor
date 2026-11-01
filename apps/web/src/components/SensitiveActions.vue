<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { EyeOff, FileDiff, FileText, ShieldBan, ShieldCheck } from 'lucide-vue-next'
import { denyRulesFor, type ActivityEvent, type DenyScope } from '@ccm/shared'
import { hasTerminals } from '../lib/desktop'
import { folderName, hasDeny, relInside, ruleText, sensitiveDeny } from '../lib/sensitive'
import { useCheckpointsStore } from '../stores/checkpoints'
import { useConnectionStore } from '../stores/connection'
import { useSensitiveStore } from '../stores/sensitive'
import { useUiStore } from '../stores/ui'
import { useWorkspaceStore } from '../stores/workspace'
import SensitiveDenyMenu from './SensitiveDenyMenu.vue'

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

const tool = computed(() => props.event.data?.tool)
const denyRules = computed(() => (hasDeny && project.value ? denyRulesFor(rule.value, tool.value) : []))
const denyButton = ref<HTMLElement | null>(null)
const denyAnchor = ref<DOMRect | null>(null)
const denyBusy = ref(false)
const denyNote = ref<{ ok: boolean; text: string } | null>(null)

function toggleDeny(): void {
  denyAnchor.value = denyAnchor.value ? null : (denyButton.value?.getBoundingClientRect() ?? null)
}

async function blockNextTime(scope: DenyScope): Promise<void> {
  if (!project.value || !rule.value || !tool.value || denyBusy.value) return
  denyBusy.value = true
  denyNote.value = null
  const res = await sensitiveDeny({ project: project.value, rule: rule.value, tool: tool.value, scope })
  denyBusy.value = false
  if (res.ok) denyNote.value = { ok: true, text: t(res.added.length ? 'sensitive.deny.done' : 'sensitive.deny.already', { file: t(`sensitive.deny.file.${scope}`) }) }
  else if (res.error !== 'cancelled') denyNote.value = { ok: false, text: t(`sensitive.deny.error.${res.error}`) }
}
</script>

<template>
  <div class="mt-1 flex flex-wrap items-center gap-1" data-sensitive-actions :data-sensitive-rule="rule">
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
    <button
      v-if="denyRules.length"
      ref="denyButton"
      type="button"
      class="ccm-btn-plain h-6 px-1.5! text-2xs"
      :title="t('sensitive.deny.title')"
      :aria-expanded="!!denyAnchor"
      aria-haspopup="menu"
      :disabled="denyBusy"
      data-sensitive-deny
      @click="toggleDeny"
    >
      <ShieldBan :size="12" aria-hidden="true" />{{ t('sensitive.deny.button') }}
    </button>
    <span
      v-if="denyNote"
      class="inline-flex items-center gap-1 text-2xs"
      :class="denyNote.ok ? 'text-ink-muted' : 'text-st-error'"
      role="status"
      :data-sensitive-deny-note="denyNote.ok ? 'ok' : 'error'"
    >
      <ShieldCheck v-if="denyNote.ok" :size="12" class="text-success" aria-hidden="true" />{{ denyNote.text }}
    </span>
    <SensitiveDenyMenu v-if="denyAnchor" :anchor="denyAnchor" :rules="denyRules" :trigger="denyButton" @pick="blockNextTime" @close="denyAnchor = null" />
  </div>
</template>
